-- Migration: reconvidar quem JA e gerente ativo para de criar convite impossivel de aceitar
-- Achado: C-INVITE-REACCEPT-23505
-- Depende de: 20260818100300 (cria as RPCs), 20260821001100 (guarda exaustiva do DELETE)
--
-- O DEFEITO, REPRODUZIDO EM PRODUCAO (22/08/2026, em bloco com ROLLBACK proposital):
--
--   1 convite:   invited
--   2 aceite:    accepted
--   3 RECONVITE: invited     <-- deveria recusar; cria uma segunda linha 'invited'
--   4 2o aceite: EXCEPTION, SQLSTATE 23505, uq_company_members_company_user
--   company_members: 2 linhas para a mesma unidade (uma ativa, uma pendurada)
--
-- POR QUE ACONTECE (as duas premissas foram conferidas no catalogo, nao presumidas):
--   a) `accept_manager_invite` ativa a linha mas NAO limpa `invited_email` — o e-mail continua
--      la, agora numa linha 'active'.
--   b) `uq_company_members_pending_email` e PARCIAL: `WHERE status = 'invited'`. Como a linha
--      existente virou 'active', ela sai do indice, e o INSERT do reconvite NAO conflita.
--   O convite nasce valido e so explode no ACEITE, contra
--   `uq_company_members_company_user (company_id, user_id) WHERE user_id IS NOT NULL` — que e
--   justamente o indice que garante "uma pessoa, uma linha por unidade". A excecao sobe crua e
--   o PostgREST devolve 500 com texto de constraint. Quem convidou nao entende, e quem foi
--   convidado leva um erro tecnico numa tela de aceite.
--
-- CONSERTO NAS DUAS PONTAS, de proposito:
--   1. `invite_company_manager` para de CRIAR o convite impossivel (causa).
--   2. `accept_manager_invite` para de EXPLODIR se um convite desses existir (defesa).
-- So (1) deixaria os convites ja pendurados em producao continuarem explodindo. So (2) trataria
-- o sintoma e manteria a linha-lixo nascendo. Article 8: nada aqui toca saldo.

-- =============================================
-- 1. invite_company_manager — recusa limpa quando a pessoa ja e gerente ativo
-- =============================================
CREATE OR REPLACE FUNCTION public.invite_company_manager(p_company_id uuid, p_email text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
    v_uid    uuid := auth.uid();
    v_org    uuid;
    v_token  text;
    v_id     uuid;
    v_email  text;
    v_target uuid;
BEGIN
    IF v_uid IS NULL THEN
        RETURN jsonb_build_object('outcome', 'unauthenticated');
    END IF;
    IF p_company_id IS NULL OR NULLIF(trim(COALESCE(p_email, '')), '') IS NULL THEN
        RETURN jsonb_build_object('outcome', 'invalid_input');
    END IF;
    v_email := lower(trim(p_email));

    SELECT c.organization_id INTO v_org FROM public.companies c WHERE c.id = p_company_id;
    IF v_org IS NULL THEN
        RETURN jsonb_build_object('outcome', 'not_found');
    END IF;

    -- Gerente NAO convida gerente: exige organization_members owner/operator.
    IF NOT public.is_organization_operator(v_org) THEN
        RETURN jsonb_build_object('outcome', 'forbidden');
    END IF;

    -- ---- NOVO: a pessoa ja e gerente ATIVO desta unidade? ----
    -- DOIS criterios, porque nenhum sozinho cobre:
    --   (a) `invited_email` da linha ativa — cobre o caminho normal (convite -> aceite), que e
    --       exatamente o que reproduzimos. Sobrevive ao aceite porque ele nao limpa a coluna.
    --   (b) resolucao e-mail -> auth.users.id -> membership ativa — cobre quem entrou por outro
    --       caminho, ou cujo e-mail de convite diferia do e-mail da conta.
    -- Sem (b), reconvidar pelo e-mail REAL de um gerente que foi convidado num e-mail antigo
    -- reproduziria o mesmo 23505. Sem (a), um gerente cuja conta trocou de e-mail escaparia.
    SELECT u.id INTO v_target FROM auth.users u WHERE lower(u.email) = v_email;

    SELECT cm.id INTO v_id
      FROM public.company_members cm
     WHERE cm.company_id = p_company_id
       AND cm.status = 'active'
       AND ( lower(cm.invited_email) = v_email
             OR (v_target IS NOT NULL AND cm.user_id = v_target) );
    IF v_id IS NOT NULL THEN
        -- NAO devolve token: nao ha nada a aceitar, e devolver token de linha ativa seria
        -- reemitir credencial portadora para quem ja tem acesso.
        RETURN jsonb_build_object('outcome', 'already_active', 'member_id', v_id);
    END IF;

    -- Convite pendente para o mesmo e-mail nesta unidade: devolve o token existente
    -- (idempotente; nao empilha tokens validos para a mesma pessoa).
    SELECT cm.id, cm.invite_token INTO v_id, v_token
      FROM public.company_members cm
     WHERE cm.company_id = p_company_id
       AND cm.status = 'invited'
       AND lower(cm.invited_email) = v_email
       AND cm.expires_at > now();
    IF v_id IS NOT NULL THEN
        RETURN jsonb_build_object('outcome', 'already_invited',
                                  'member_id', v_id, 'invite_token', v_token);
    END IF;

    -- Convite vencido para o mesmo e-mail: marca como removido e emite um novo.
    UPDATE public.company_members
       SET status = 'removed'
     WHERE company_id = p_company_id
       AND status = 'invited'
       AND lower(invited_email) = v_email;

    v_token := public.generate_invite_token();

    INSERT INTO public.company_members
        (company_id, user_id, role, status, invited_email, invite_token, expires_at, created_by)
    VALUES
        (p_company_id, NULL, 'manager', 'invited', v_email, v_token,
         now() + interval '7 days', v_uid)
    RETURNING id INTO v_id;

    RETURN jsonb_build_object('outcome', 'invited', 'member_id', v_id, 'invite_token', v_token);
END;
$function$;

COMMENT ON FUNCTION public.invite_company_manager(uuid, text) IS
    'Convida gerente para uma unidade. Exige organization_members owner/operator (gerente nao '
    'convida gerente). Idempotente: convite pendente devolve o mesmo token; quem JA e gerente '
    'ativo recebe outcome=already_active SEM token novo (ver 20260822000300 — antes isso criava '
    'convite que explodia com 23505 no aceite).';

-- =============================================
-- 2. accept_manager_invite — nunca mais 23505 cru
-- =============================================
-- Corpo IDENTICO ao de 20260821001100 (as 14 guardas do DELETE preservadas na integra), com UMA
-- adicao: antes do UPDATE, se o chamador ja tiver linha ATIVA nesta unidade, o convite pendurado
-- e QUEIMADO (status='removed', token anulado) e devolvemos `already_accepted`. Idempotente e
-- honesto: a pessoa ja e gerente, o convite extra some, ninguem ve erro tecnico.
CREATE OR REPLACE FUNCTION public.accept_manager_invite(p_token text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
    v_uid uuid := auth.uid();
    v_row public.company_members;
    v_existing uuid;
BEGIN
    IF v_uid IS NULL THEN
        RETURN jsonb_build_object('outcome', 'unauthenticated');
    END IF;
    IF NULLIF(trim(COALESCE(p_token, '')), '') IS NULL THEN
        RETURN jsonb_build_object('outcome', 'invalid_input');
    END IF;

    SELECT * INTO v_row FROM public.company_members cm
     WHERE cm.invite_token = trim(p_token)
     FOR UPDATE;

    IF v_row.id IS NULL THEN
        RETURN jsonb_build_object('outcome', 'not_found');
    END IF;

    IF v_row.status = 'active' AND v_row.user_id = v_uid THEN
        RETURN jsonb_build_object('outcome', 'already_accepted',
                                  'company_id', v_row.company_id, 'member_id', v_row.id);
    END IF;
    IF v_row.user_id IS NOT NULL AND v_row.user_id <> v_uid THEN
        RETURN jsonb_build_object('outcome', 'token_already_used');
    END IF;
    IF v_row.status <> 'invited' THEN
        RETURN jsonb_build_object('outcome', 'revoked');
    END IF;
    IF v_row.expires_at IS NOT NULL AND v_row.expires_at <= now() THEN
        RETURN jsonb_build_object('outcome', 'expired');
    END IF;
    IF EXISTS (SELECT 1 FROM public.workers w WHERE w.id = v_uid) THEN
        RETURN jsonb_build_object('outcome', 'worker_cannot_be_manager');
    END IF;

    -- ---- NOVO: ja sou gerente ativo desta unidade por OUTRA linha? ----
    -- Sem isto o UPDATE abaixo viola uq_company_members_company_user e a excecao sobe crua
    -- (23505 -> 500 do PostgREST). Convites pendurados que JA existem em producao passam por
    -- aqui, e e por isso que a defesa fica mesmo com a causa corrigida acima.
    SELECT cm.id INTO v_existing
      FROM public.company_members cm
     WHERE cm.company_id = v_row.company_id
       AND cm.user_id    = v_uid
       AND cm.status     = 'active'
       AND cm.id <> v_row.id;
    IF v_existing IS NOT NULL THEN
        UPDATE public.company_members
           SET status = 'removed', invite_token = NULL
         WHERE id = v_row.id;
        RETURN jsonb_build_object('outcome', 'already_accepted',
                                  'company_id', v_row.company_id, 'member_id', v_existing);
    END IF;

    UPDATE public.company_members
       SET user_id      = v_uid,
           status       = 'active',
           accepted_at  = now(),
           invite_token = NULL
     WHERE id = v_row.id;

    -- Limpeza da CASCA de companies criada por handle_new_user para o signup user_type='hire'.
    -- Lista EXAUSTIVA das 14 tabelas dependentes de companies(id) — identica a 20260821001100,
    -- cuja assercao garante que nenhuma ficou fora.
    DELETE FROM public.companies c
     WHERE c.id = v_uid
       AND COALESCE(c.onboarding_completed, false) = false
       AND NOT EXISTS (SELECT 1 FROM public.jobs                       j    WHERE j.company_id   = c.id)
       AND NOT EXISTS (SELECT 1 FROM public.team_connections           tc   WHERE tc.company_id  = c.id)
       AND NOT EXISTS (SELECT 1 FROM public.shift_payments             sp   WHERE sp.company_id  = c.id)
       AND NOT EXISTS (SELECT 1 FROM public.company_members            cm   WHERE cm.company_id  = c.id)
       AND NOT EXISTS (SELECT 1 FROM public.team_lists                 tl   WHERE tl.company_id  = c.id)
       AND NOT EXISTS (SELECT 1 FROM public.job_series                 js   WHERE js.company_id  = c.id)
       AND NOT EXISTS (SELECT 1 FROM public.payment_methods            pm   WHERE pm.company_id  = c.id)
       AND NOT EXISTS (SELECT 1 FROM public.company_spend_limits       csl  WHERE csl.company_id = c.id)
       AND NOT EXISTS (SELECT 1 FROM public.company_monthly_revenue    cmr  WHERE cmr.company_id = c.id)
       AND NOT EXISTS (SELECT 1 FROM public.worker_trainings           wt   WHERE wt.company_id  = c.id)
       AND NOT EXISTS (SELECT 1 FROM public.worker_certifications      wc   WHERE wc.verified_by_company_id = c.id)
       AND NOT EXISTS (SELECT 1 FROM public.worker_company_badge_prefs wcbp WHERE wcbp.company_id = c.id)
       AND NOT EXISTS (
             SELECT 1 FROM public.worker_referrals wr
              WHERE wr.referring_company_id = c.id OR wr.requesting_company_id = c.id
           )
       AND NOT EXISTS (SELECT 1 FROM public.service_terms st WHERE st.company_id = c.id);

    RETURN jsonb_build_object('outcome', 'accepted',
                              'company_id', v_row.company_id, 'member_id', v_row.id);
END;
$function$;

REVOKE ALL ON FUNCTION public.invite_company_manager(uuid, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.accept_manager_invite(text)        FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.invite_company_manager(uuid, text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.accept_manager_invite(text)        TO authenticated, service_role;

-- ============================================================================
-- DOWN: reaplicar os corpos de 20260818100300 (invite_company_manager) e de
--       20260821001100 (accept_manager_invite). Ambos os arquivos vivem nesta mesma branch.
--
-- VERIFICACAO (bloco com ROLLBACK proposital — o mesmo que reproduziu o defeito):
--   convidar -> aceitar -> RECONVIDAR o mesmo e-mail -> tentar aceitar de novo.
--   ANTES:  invited / accepted / invited / EXCEPTION 23505
--   DEPOIS: invited / accepted / already_active / (sem 4o passo — nao ha token novo)
--   E company_members precisa ficar com UMA linha para aquela unidade, nao duas.
-- ============================================================================
