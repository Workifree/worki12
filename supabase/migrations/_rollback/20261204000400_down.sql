-- ROLLBACK de 20261204000400_lojas_etiquetas_equipe_unificada.sql
-- Gerado em 27/11/2026 de pg_get_functiondef das funcoes VIVAS em producao (consulta --read-only) ANTES de aplicar.
-- NAO e migration (fica em _rollback/). Rodar a mao. So e seguro se nao existir manager confirmado por este fluxo
-- nem loja padrao em uso (default_tag_id); caso contrario o rollback reabre Gestor sem confirmacao.
BEGIN;

-- 1. Remove o que a migration criou
DROP FUNCTION IF EXISTS public.set_member_default_tag(uuid, uuid, uuid);
DROP FUNCTION IF EXISTS public.rename_company_tag(uuid, text);
DROP FUNCTION IF EXISTS public.internal_member_default_tag(uuid, uuid);
DROP FUNCTION IF EXISTS public.invite_company_member(uuid, text, text, text, uuid);

-- 2. Policies para o estado anterior
ALTER POLICY company_tags_select ON public.company_tags USING (is_company_member(company_id));
ALTER POLICY rc_select_partes_ou_gestor ON public.responsibility_coverages USING ((is_company_owner(company_id) OR (((from_user_id = ( SELECT auth.uid() AS uid)) OR (to_user_id = ( SELECT auth.uid() AS uid))) AND is_company_member(company_id))));

-- 3. Restaura as funcoes (definicoes vivas)
-- accept_company_member_invite(p_token text, p_accept_tos boolean)
CREATE OR REPLACE FUNCTION public.accept_company_member_invite(p_token text, p_accept_tos boolean)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
    v_uid      uuid := auth.uid();
    v_tok      text := NULLIF(btrim(COALESCE(p_token, '')), '');
    v_hash     text;
    v_row      public.company_members;
    v_existing uuid;
    v_email    text;
    v_verified boolean;
    v_g        uuid;
    v_cn       text;
    v_company  uuid;
    v_masked   text;
    v_notice   text;
BEGIN
    IF v_uid IS NULL THEN
        RETURN jsonb_build_object('outcome', 'unauthenticated');
    END IF;
    IF v_tok IS NULL THEN
        RETURN jsonb_build_object('outcome', 'invalid_input');
    END IF;

    v_hash := encode(sha256(convert_to(v_tok, 'UTF8')), 'hex');

    SELECT cm.company_id INTO v_company FROM public.company_members cm
     WHERE cm.invite_token = v_tok OR cm.invite_token_hash = v_hash
     LIMIT 1;
    IF v_company IS NULL THEN
        RETURN jsonb_build_object('outcome', 'not_found');
    END IF;
    PERFORM pg_advisory_xact_lock(hashtext('worki:team:' || v_company::text)::bigint);

    SELECT * INTO v_row FROM public.company_members cm
     WHERE cm.company_id = v_company
       AND (cm.invite_token = v_tok OR cm.invite_token_hash = v_hash)
     FOR UPDATE;

    IF v_row.id IS NULL THEN
        RETURN jsonb_build_object('outcome', 'not_found');
    END IF;

    IF v_row.invite_token IS DISTINCT FROM v_tok THEN
        IF v_row.status = 'active' AND v_row.user_id = v_uid THEN
            RETURN jsonb_build_object('outcome', 'already_accepted',
                                      'company_id', v_row.company_id, 'member_id', v_row.id,
                                      'role', v_row.role, 'confirmed', v_row.confirmed_at IS NOT NULL);
        ELSIF v_row.status = 'active' THEN
            RETURN jsonb_build_object('outcome', 'token_already_used');
        ELSIF v_row.status = 'removed' THEN
            RETURN jsonb_build_object('outcome', 'revoked');
        END IF;
        RETURN jsonb_build_object('outcome', 'not_found');
    END IF;

    IF v_row.status <> 'invited' THEN
        RETURN jsonb_build_object('outcome', 'revoked');
    END IF;
    IF v_row.expires_at IS NOT NULL AND v_row.expires_at <= now() THEN
        RETURN jsonb_build_object('outcome', 'expired');
    END IF;

    IF v_row.role <> 'encarregado' THEN
        RETURN jsonb_build_object('outcome', 'use_manager_invite');
    END IF;

    IF p_accept_tos IS DISTINCT FROM true THEN
        RETURN jsonb_build_object('outcome', 'tos_required');
    END IF;

    IF EXISTS (SELECT 1 FROM public.workers w WHERE w.id = v_uid) THEN
        RETURN jsonb_build_object('outcome', 'worker_cannot_be_manager');
    END IF;

    IF public.is_company_owner(v_row.company_id) THEN
        RETURN jsonb_build_object('outcome', 'already_operator');
    END IF;

    SELECT lower(btrim(u.email)), (u.email_confirmed_at IS NOT NULL)
      INTO v_email, v_verified
      FROM auth.users u WHERE u.id = v_uid;
    IF v_email IS NULL OR NOT COALESCE(v_verified, false) THEN
        RETURN jsonb_build_object('outcome', 'email_not_verified');
    END IF;

    -- ADR-20261127: convite preso ao e-mail exige sessao == invited_email (sem consumir o token).
    IF v_row.invited_email IS NOT NULL
       AND v_email <> lower(btrim(v_row.invited_email)) THEN
        RETURN jsonb_build_object('outcome', 'email_mismatch');
    END IF;

    UPDATE public.company_members
       SET status = 'removed', removed_at = now(), removed_by = NULL, invite_token = NULL
     WHERE company_id = v_row.company_id
       AND user_id    = v_uid
       AND status     = 'active'
       AND role       = 'encarregado'
       AND confirmed_at IS NULL
       AND COALESCE(accepted_at, invited_at) <= now() - interval '72 hours'
       AND id <> v_row.id;

    SELECT cm.id INTO v_existing
      FROM public.company_members cm
     WHERE cm.company_id = v_row.company_id
       AND cm.user_id    = v_uid
       AND cm.status     = 'active'
       AND cm.id <> v_row.id;
    IF v_existing IS NOT NULL THEN
        UPDATE public.company_members
           SET status = 'removed', removed_at = now(), invite_token = NULL, invite_token_hash = v_hash
         WHERE id = v_row.id;
        RETURN jsonb_build_object('outcome', 'already_accepted',
                                  'company_id', v_row.company_id, 'member_id', v_existing);
    END IF;

    PERFORM public.internal_revoke_member_coverages(v_row.company_id, v_uid);

    BEGIN
        UPDATE public.company_members
           SET user_id           = v_uid,
               status            = 'active',
               accepted_at       = now(),
               accepted_email    = v_email,
               accepted_tos_at   = now(),
               confirmed_at      = NULL,
               confirmed_by      = NULL,
               invite_token      = NULL,
               invite_token_hash = v_hash
         WHERE id = v_row.id;
    EXCEPTION WHEN unique_violation THEN
        GET STACKED DIAGNOSTICS v_cn = CONSTRAINT_NAME;
        IF v_cn IS DISTINCT FROM 'uq_company_members_company_user' THEN
            RAISE;
        END IF;
        SELECT cm.id INTO v_existing
          FROM public.company_members cm
         WHERE cm.company_id = v_row.company_id AND cm.user_id = v_uid
           AND cm.status = 'active' AND cm.id <> v_row.id;
        UPDATE public.company_members
           SET status = 'removed', removed_at = now(), invite_token = NULL, invite_token_hash = v_hash
         WHERE id = v_row.id;
        RETURN jsonb_build_object('outcome', 'already_accepted',
                                  'company_id', v_row.company_id, 'member_id', v_existing);
    END;

    PERFORM public.internal_drop_empty_company_shell(v_uid);

    v_masked := left(split_part(v_email, '@', 1),
                     CASE WHEN length(split_part(v_email, '@', 1)) > 2 THEN 2 ELSE 1 END)
                || '***@' || split_part(v_email, '@', 2);

    IF v_row.invited_email IS NOT NULL THEN
        v_notice := format(
            '%s entrou na equipe como Encarregado (%s — e-mail informado por você, não verificado). Entrada em %s (horário de São Paulo). É a pessoa certa? Confirme em até 72 horas ou revogue o acesso.',
            COALESCE(v_row.display_name, 'Alguém'),
            v_masked,
            to_char(now() AT TIME ZONE 'America/Sao_Paulo', 'DD/MM/YYYY HH24:MI')
        );
    ELSE
        v_notice := format(
            '%s entrou na equipe como Encarregado (%s). Entrada em %s (horário de São Paulo). É a pessoa certa? Confirme em até 72 horas ou revogue o acesso.',
            COALESCE(v_row.display_name, 'Alguém'),
            v_masked,
            to_char(now() AT TIME ZONE 'America/Sao_Paulo', 'DD/MM/YYYY HH24:MI')
        );
    END IF;

    FOR v_g IN SELECT g FROM public.internal_company_gestor_ids(v_row.company_id) AS g WHERE g <> v_uid
    LOOP
        PERFORM public.internal_notify_member_event(
            v_g,
            'Nova pessoa na equipe',
            v_notice,
            '/company/configuracoes/equipe?membro=' || v_row.id::text
        );
    END LOOP;

    RETURN jsonb_build_object('outcome', 'accepted',
                              'company_id', v_row.company_id, 'member_id', v_row.id,
                              'role', v_row.role, 'confirmed', false);
END;
$function$;

-- accept_manager_invite(p_token text)
CREATE OR REPLACE FUNCTION public.accept_manager_invite(p_token text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
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
     WHERE cm.invite_token = trim(p_token) AND cm.role = 'manager'
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
       AND cm.id <> v_row.id AND cm.role = 'manager';
    IF v_existing IS NOT NULL THEN
        UPDATE public.company_members
           SET status = 'removed', invite_token = NULL
         WHERE id = v_row.id;
        RETURN jsonb_build_object('outcome', 'already_accepted',
                                  'company_id', v_row.company_id, 'member_id', v_existing);
    END IF;

    -- ---- CORRIDA RESIDUAL: dois tokens distintos, mesma pessoa, mesma unidade ----
    -- O `FOR UPDATE` acima trava a LINHA DO CONVITE, nao o par (company_id, user_id). Duas
    -- sessoes aceitando tokens DIFERENTES da mesma unidade travam linhas diferentes, nao se
    -- enxergam, ambas leem `v_existing IS NULL`, e colidem no UPDATE abaixo — o mesmo 23505 que
    -- esta migration existe para eliminar. E possivel porque `uq_company_members_pending_email`
    -- so impede duplicata do MESMO e-mail: dois e-mails diferentes que pertencem a mesma pessoa
    -- geram dois convites validos.
    --
    -- Tratado por EXCEPTION e nao por advisory lock: o handler cobre TODA colisao contra este
    -- indice, inclusive as que eu nao previ, enquanto um lock so cobre a corrida que eu imaginei.
    -- Aqui o banco ja garante a invariante ("uma pessoa, uma linha por unidade") — o que faltava
    -- era traduzir a violacao em resposta honesta em vez de deixar vazar 500 para a tela.
    BEGIN
        UPDATE public.company_members
           SET user_id      = v_uid,
               status       = 'active',
               accepted_at  = now(),
               invite_token = NULL
         WHERE id = v_row.id;
    EXCEPTION WHEN unique_violation THEN
        -- A outra sessao venceu a corrida e ja ativou a pessoa nesta unidade. Este convite virou
        -- redundante: queima e devolve o mesmo `already_accepted` do caminho sequencial, para as
        -- duas sessoes concorrentes verem a MESMA coisa.
        SELECT cm.id INTO v_existing
          FROM public.company_members cm
         WHERE cm.company_id = v_row.company_id
           AND cm.user_id    = v_uid
           AND cm.status     = 'active'
           AND cm.id <> v_row.id AND cm.role = 'manager';

        UPDATE public.company_members
           SET status = 'removed', invite_token = NULL
         WHERE id = v_row.id;

        RETURN jsonb_build_object('outcome', 'already_accepted',
                                  'company_id', v_row.company_id,
                                  'member_id', v_existing);
    END;

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

-- archive_company_tag(p_tag_id uuid)
CREATE OR REPLACE FUNCTION public.archive_company_tag(p_tag_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
    v_uid uuid := (SELECT auth.uid());
    v_tag public.company_tags%ROWTYPE;
BEGIN
    IF v_uid IS NULL THEN
        RETURN jsonb_build_object('outcome', 'unauthenticated');
    END IF;
    IF p_tag_id IS NULL THEN
        RETURN jsonb_build_object('outcome', 'invalid_input');
    END IF;

    SELECT * INTO v_tag FROM public.company_tags WHERE id = p_tag_id;
    IF NOT FOUND THEN
        RETURN jsonb_build_object('outcome', 'not_found');
    END IF;
    IF NOT public.is_company_owner(v_tag.company_id) THEN
        RETURN jsonb_build_object('outcome', 'forbidden');
    END IF;
    -- L-3: so trava DEPOIS de autorizar; relê o estado sob o lock
    SELECT t.archived_at INTO v_tag.archived_at FROM public.company_tags t WHERE t.id = p_tag_id FOR UPDATE;
    IF v_tag.archived_at IS NOT NULL THEN
        RETURN jsonb_build_object('outcome', 'already_archived');
    END IF;

    UPDATE public.company_tags SET archived_at = now() WHERE id = p_tag_id;
    RETURN jsonb_build_object('outcome', 'archived');
END;
$function$;

-- confirm_company_member(p_company_id uuid, p_user_id uuid, p_typed_name text)
CREATE OR REPLACE FUNCTION public.confirm_company_member(p_company_id uuid, p_user_id uuid, p_typed_name text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
    v_uid uuid := auth.uid();
    v_row public.company_members;
BEGIN
    IF v_uid IS NULL THEN
        RETURN jsonb_build_object('outcome', 'unauthenticated');
    END IF;
    IF p_company_id IS NULL OR p_user_id IS NULL THEN
        RETURN jsonb_build_object('outcome', 'invalid_input');
    END IF;
    -- Mesmo lock de equipe das demais mudancas (e da cobertura da E5), ANTES de qualquer
    -- FOR UPDATE; a autorizacao e o estado da linha sao avaliados SOB o lock (READ COMMITTED:
    -- cada comando seguinte ja ve o que a transacao concorrente gravou).
    PERFORM pg_advisory_xact_lock(hashtext('worki:team:' || p_company_id::text)::bigint);
    IF NOT public.is_company_owner(p_company_id) THEN
        RETURN jsonb_build_object('outcome', 'forbidden');
    END IF;
    IF p_user_id = v_uid THEN
        RETURN jsonb_build_object('outcome', 'forbidden');
    END IF;

    SELECT * INTO v_row FROM public.company_members cm
     WHERE cm.company_id = p_company_id AND cm.user_id = p_user_id AND cm.status = 'active'
       AND cm.role = 'encarregado'
     FOR UPDATE;
    IF v_row.id IS NULL THEN
        RETURN jsonb_build_object('outcome', 'not_found');
    END IF;

    IF v_row.confirmed_at IS NOT NULL THEN
        RETURN jsonb_build_object('outcome', 'already_confirmed', 'member_id', v_row.id);
    END IF;

    -- Expiracao preguicosa: 72h sem confirmacao. A escrita persiste (retorno normal, sem excecao).
    IF COALESCE(v_row.accepted_at, v_row.invited_at) <= now() - interval '72 hours' THEN
        UPDATE public.company_members
           SET status = 'removed', removed_at = now(), removed_by = NULL, invite_token = NULL
         WHERE id = v_row.id;
        PERFORM public.internal_revoke_member_coverages(p_company_id, p_user_id);
        RETURN jsonb_build_object('outcome', 'expired', 'member_id', v_row.id);
    END IF;

    IF public.normalize_member_name(p_typed_name) = ''
       OR public.normalize_member_name(p_typed_name)
          IS DISTINCT FROM public.normalize_member_name(v_row.display_name) THEN
        RETURN jsonb_build_object('outcome', 'name_mismatch', 'member_id', v_row.id);
    END IF;

    UPDATE public.company_members
       SET confirmed_at = now(), confirmed_by = v_uid
     WHERE id = v_row.id;

    PERFORM public.internal_notify_member_event(
        p_user_id,
        'Acesso confirmado',
        'O Gestor confirmou o seu acesso à equipe. Você já pode usar o Elenco.',
        '/company/hoje'
    );

    RETURN jsonb_build_object('outcome', 'confirmed', 'member_id', v_row.id);
END;
$function$;

-- create_company_tag(p_company_id uuid, p_name text)
CREATE OR REPLACE FUNCTION public.create_company_tag(p_company_id uuid, p_name text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
    v_uid  uuid := (SELECT auth.uid());
    v_name text := btrim(COALESCE(p_name, ''));
    v_tag  public.company_tags%ROWTYPE;
    v_id   uuid;
BEGIN
    IF v_uid IS NULL THEN
        RETURN jsonb_build_object('outcome', 'unauthenticated');
    END IF;
    IF p_company_id IS NULL OR length(v_name) < 1 OR length(v_name) > 40 OR v_name ~ '[[:cntrl:]]' THEN
        RETURN jsonb_build_object('outcome', 'invalid_input');
    END IF;
    IF NOT public.is_company_owner(p_company_id) THEN
        RETURN jsonb_build_object('outcome', 'forbidden');
    END IF;

    -- (empresa, nome sem caixa) e UNICO inclusive entre arquivadas: nome arquivado e REATIVADO, nao duplicado.
    SELECT * INTO v_tag FROM public.company_tags t
     WHERE t.company_id = p_company_id AND lower(btrim(t.name)) = lower(v_name)
     FOR UPDATE;
    IF FOUND THEN
        IF v_tag.archived_at IS NULL THEN
            RETURN jsonb_build_object('outcome', 'already_exists', 'tag_id', v_tag.id);
        END IF;
        UPDATE public.company_tags SET archived_at = NULL WHERE id = v_tag.id;
        RETURN jsonb_build_object('outcome', 'reactivated', 'tag_id', v_tag.id);
    END IF;

    BEGIN
        INSERT INTO public.company_tags (company_id, name, created_by)
        VALUES (p_company_id, v_name, v_uid)
        RETURNING id INTO v_id;
    EXCEPTION WHEN unique_violation THEN
        SELECT t.id INTO v_id FROM public.company_tags t
         WHERE t.company_id = p_company_id AND lower(btrim(t.name)) = lower(v_name);
        RETURN jsonb_build_object('outcome', 'already_exists', 'tag_id', v_id);
    END;

    RETURN jsonb_build_object('outcome', 'created', 'tag_id', v_id);
END;
$function$;

-- get_invite_preview(p_token text)
CREATE OR REPLACE FUNCTION public.get_invite_preview(p_token text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
    -- Resposta unica para TODA falha: nada distingue inexistente, expirado, revogado ou malformado.
    c_not_found constant jsonb :=
        '{"outcome": "not_found", "inviter_name": null, "kind": null}'::jsonb;
    v_name text;
    v_kind text;
BEGIN
    -- Tamanho antes de qualquer regex ou consulta.
    IF p_token IS NULL OR octet_length(p_token) NOT IN (48, 64) THEN
        RETURN c_not_found;
    END IF;
    IF p_token !~ '^[0-9a-f]+$' THEN
        RETURN c_not_found;
    END IF;

    IF octet_length(p_token) = 48 THEN
        v_kind := 'elenco';
        SELECT c.name INTO v_name
          FROM public.company_invite_links l
          JOIN public.companies c ON c.id = l.company_id
         WHERE l.token = p_token
           AND c.anonymized_at IS NULL;
    ELSE
        v_kind := 'gerente';
        SELECT c.name INTO v_name
          FROM public.company_members m
          JOIN public.companies c ON c.id = m.company_id
         WHERE m.invite_token = p_token
           AND m.role = 'manager'
           AND m.status = 'invited'
           AND m.expires_at > now()
           AND c.anonymized_at IS NULL;
    END IF;

    v_name := NULLIF(btrim(COALESCE(v_name, '')), '');
    IF v_name IS NULL THEN
        RETURN c_not_found;
    END IF;

    RETURN jsonb_build_object('outcome', 'ok', 'inviter_name', v_name, 'kind', v_kind);
END;
$function$;

-- get_member_invite_preview(p_token text)
CREATE OR REPLACE FUNCTION public.get_member_invite_preview(p_token text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
    v_tok          text := NULLIF(btrim(COALESCE(p_token, '')), '');
    v_row          public.company_members;
    v_name         text;
    v_email        text;
    v_email_masked text;
BEGIN
    IF v_tok IS NULL OR length(v_tok) <> 64 OR v_tok !~ '^[0-9a-f]+$' THEN
        RETURN jsonb_build_object('outcome', 'not_found');
    END IF;

    SELECT * INTO v_row FROM public.company_members cm WHERE cm.invite_token = v_tok;
    IF v_row.id IS NULL OR v_row.status <> 'invited' OR v_row.role <> 'encarregado' THEN
        RETURN jsonb_build_object('outcome', 'not_found');
    END IF;

    SELECT c.name INTO v_name FROM public.companies c WHERE c.id = v_row.company_id;

    v_email := NULLIF(lower(btrim(COALESCE(v_row.invited_email, ''))), '');
    IF v_email IS NOT NULL AND position('@' IN v_email) > 1 THEN
        v_email_masked := left(split_part(v_email, '@', 1),
                               CASE WHEN length(split_part(v_email, '@', 1)) > 2 THEN 2 ELSE 1 END)
                          || '***@' || split_part(v_email, '@', 2);
    END IF;

    RETURN jsonb_build_object(
        'outcome',      CASE WHEN v_row.expires_at IS NOT NULL AND v_row.expires_at <= now()
                             THEN 'expired' ELSE 'ok' END,
        'company_name', v_name,
        'role',         v_row.role,
        'email_masked', v_email_masked,
        'email_bound',  (v_email IS NOT NULL)
    );
END;
$function$;

-- get_my_companies()
CREATE OR REPLACE FUNCTION public.get_my_companies()
 RETURNS TABLE(company_id uuid, company_name text, role text, organization_id uuid, organization_name text, onboarding_completed boolean, accepted_tos boolean, confirmed boolean, team_enabled boolean)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
    SELECT b.id,
           b.name,
           CASE
               WHEN b.is_owner          THEN 'owner'
               WHEN b.is_operator       THEN 'operator'
               WHEN b.m_role = 'manager' THEN 'manager'
               ELSE 'encarregado'
           END AS role,
           b.organization_id,
           b.org_name,
           COALESCE(b.onboarding_completed, false),
           -- Article 12 por PESSOA: o encarregado nao herda o aceite de Termos da empresa.
           CASE
               WHEN NOT b.is_owner AND NOT b.is_operator AND b.m_role = 'encarregado'
                   THEN b.m_tos_at IS NOT NULL
               ELSE COALESCE(b.accepted_tos, false) OR b.m_tos_at IS NOT NULL
           END,
           -- Gestor (dono, operador de organizacao, manager) e confirmado por definicao; so o
           -- encarregado depende de confirmed_at (R22).
           (b.is_owner OR b.is_operator OR b.m_role = 'manager' OR b.m_confirmed_at IS NOT NULL),
           -- R23 (divulgacao progressiva): ha ao menos uma pessoa nao removida na equipe. Vale para o
           -- encarregado tambem (a propria linha dele e nao removida).
           b.has_team
      FROM (
            SELECT c.id,
                   c.name,
                   c.organization_id,
                   o.name AS org_name,
                   c.onboarding_completed,
                   c.accepted_tos,
                   COALESCE((c.owner_id = (SELECT auth.uid()) OR c.id = (SELECT auth.uid())), false) AS is_owner,
                   EXISTS (SELECT 1 FROM public.organization_members om
                            WHERE om.organization_id = c.organization_id
                              AND om.user_id = (SELECT auth.uid())
                              AND om.status  = 'active'
                              AND om.role IN ('owner', 'operator')) AS is_operator,
                   mm.m_role,
                   mm.m_confirmed_at,
                   mm.m_tos_at,
                   EXISTS (SELECT 1 FROM public.company_members cx
                            WHERE cx.company_id = c.id AND cx.status <> 'removed') AS has_team
              FROM public.companies c
              LEFT JOIN public.organizations o ON o.id = c.organization_id
              LEFT JOIN LATERAL (
                       SELECT cm.role AS m_role, cm.confirmed_at AS m_confirmed_at,
                              cm.accepted_tos_at AS m_tos_at
                         FROM public.company_members cm
                        WHERE cm.company_id = c.id
                          AND cm.user_id    = (SELECT auth.uid())
                          AND cm.status     = 'active'
                        ORDER BY (cm.role = 'manager') DESC
                        LIMIT 1
                   ) mm ON true
             WHERE (SELECT auth.uid()) IS NOT NULL
           ) b
     WHERE b.is_owner OR b.is_operator OR b.m_role IS NOT NULL
     -- Prioridade EXPLICITA de poder (a primeira linha e a empresa onde a pessoa pode mais), depois
     -- nome. Nao ordena pelo texto do papel (alfabetico poria 'encarregado' antes de 'owner').
     ORDER BY CASE WHEN b.is_owner          THEN 1
                   WHEN b.is_operator       THEN 2
                   WHEN b.m_role = 'manager' THEN 3
                   ELSE 4 END,
              b.name, b.id;
$function$;

-- internal_company_confirmed_operator(p_company_id uuid, p_user_id uuid)
CREATE OR REPLACE FUNCTION public.internal_company_confirmed_operator(p_company_id uuid, p_user_id uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
    SELECT public.internal_company_active_operator(p_company_id, p_user_id)
       AND NOT EXISTS (
            SELECT 1 FROM public.company_members cm
             WHERE cm.company_id   = p_company_id
               AND cm.user_id      = p_user_id
               AND cm.status       = 'active'
               AND cm.role         = 'encarregado'
               AND cm.confirmed_at IS NULL
       );
$function$;

-- internal_company_gestor_ids(p_company_id uuid)
CREATE OR REPLACE FUNCTION public.internal_company_gestor_ids(p_company_id uuid)
 RETURNS SETOF uuid
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
    SELECT COALESCE(c.owner_id, c.id)
      FROM public.companies c
     WHERE c.id = p_company_id
    UNION
    SELECT cm.user_id
      FROM public.company_members cm
     WHERE cm.company_id = p_company_id
       AND cm.status = 'active'
       AND cm.role   = 'manager'
       AND cm.user_id IS NOT NULL
    UNION
    SELECT om.user_id
      FROM public.organization_members om
      JOIN public.companies c2 ON c2.organization_id = om.organization_id
     WHERE c2.id = p_company_id
       AND om.status = 'active'
       AND om.role IN ('owner', 'operator')
       AND om.user_id IS NOT NULL;
$function$;

-- internal_company_has_gestor_besides_member(p_company_id uuid, p_user_id uuid)
CREATE OR REPLACE FUNCTION public.internal_company_has_gestor_besides_member(p_company_id uuid, p_user_id uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
    SELECT EXISTS (SELECT 1 FROM public.companies c
                     JOIN auth.users u ON u.id = COALESCE(c.owner_id, c.id)
                    WHERE c.id = p_company_id AND c.anonymized_at IS NULL)
        OR EXISTS (SELECT 1 FROM public.organization_members om
                     JOIN public.companies c2 ON c2.organization_id = om.organization_id
                    WHERE c2.id = p_company_id AND om.status = 'active'
                      AND om.role IN ('owner', 'operator') AND om.user_id IS NOT NULL)
        OR EXISTS (SELECT 1 FROM public.company_members cm
                    WHERE cm.company_id = p_company_id AND cm.status = 'active'
                      AND cm.role = 'manager' AND cm.user_id IS DISTINCT FROM p_user_id);
$function$;

-- internal_team_invite_provision_check(p_token text)
CREATE OR REPLACE FUNCTION public.internal_team_invite_provision_check(p_token text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
    v_tok     text := NULLIF(btrim(COALESCE(p_token, '')), '');
    v_row     public.company_members;
    v_email   text;
    v_uid     uuid;
    v_conf_at timestamptz;
    v_account text;
BEGIN
    IF v_tok IS NULL OR length(v_tok) <> 64 OR v_tok !~ '^[0-9a-f]+$' THEN
        RETURN jsonb_build_object('outcome', 'not_found');
    END IF;

    SELECT * INTO v_row FROM public.company_members cm WHERE cm.invite_token = v_tok;
    IF v_row.id IS NULL OR v_row.status <> 'invited' OR v_row.role <> 'encarregado' THEN
        RETURN jsonb_build_object('outcome', 'not_found');
    END IF;

    IF v_row.expires_at IS NOT NULL AND v_row.expires_at <= now() THEN
        RETURN jsonb_build_object('outcome', 'expired');
    END IF;

    v_email := NULLIF(lower(btrim(COALESCE(v_row.invited_email, ''))), '');
    IF v_email IS NULL THEN
        RETURN jsonb_build_object('outcome', 'legacy_invite');
    END IF;

    SELECT u.id, u.email_confirmed_at
      INTO v_uid, v_conf_at
      FROM auth.users u
     WHERE lower(btrim(COALESCE(u.email, ''))) = v_email
     LIMIT 1;

    IF v_uid IS NULL THEN
        v_account := 'none';
    ELSIF EXISTS (SELECT 1 FROM public.workers w WHERE w.id = v_uid) THEN
        v_account := 'worker';
    ELSIF v_conf_at IS NULL THEN
        v_account := 'unconfirmed';
    ELSE
        v_account := 'company';
    END IF;

    RETURN jsonb_build_object(
        'outcome', 'ok',
        'email',   v_email,
        'account', v_account
    );
END;
$function$;

-- invite_company_manager(p_company_id uuid, p_email text)
CREATE OR REPLACE FUNCTION public.invite_company_manager(p_company_id uuid, p_email text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
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
    -- ⚠️ PRECEDENTE NOVO: esta e a primeira RPC de dominio do projeto a ler `auth.users` fora de
    --    um trigger da propria `auth.users`. E seguro aqui por tres razoes que precisam continuar
    --    valendo se alguem copiar este padrao: (1) o gate `is_organization_operator` acontece
    --    ANTES desta linha, entao chamador nao autorizado nunca chega aqui — nao ha oraculo de
    --    "este e-mail tem conta?"; (2) so o `id` e lido, e ele nunca sai da funcao; (3) o outcome
    --    `already_active` revela apenas o que este mesmo operador ja le direto em
    --    `company_members` pela policy `cm_select_self_or_operator`. Verificar apos o deploy que
    --    a leitura de fato resolve: alguns ambientes restringem `auth` ate para o dono da funcao.
    SELECT u.id INTO v_target FROM auth.users u WHERE lower(u.email) = v_email;

    SELECT cm.id INTO v_id
      FROM public.company_members cm
     WHERE cm.company_id = p_company_id
       AND cm.status = 'active' AND cm.role = 'manager'
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
       AND cm.expires_at > now() AND cm.role = 'manager';
    IF v_id IS NOT NULL THEN
        RETURN jsonb_build_object('outcome', 'already_invited',
                                  'member_id', v_id, 'invite_token', v_token);
    END IF;

    -- Convite vencido para o mesmo e-mail: marca como removido e emite um novo.
    UPDATE public.company_members
       SET status = 'removed'
     WHERE company_id = p_company_id
       AND status = 'invited'
       AND lower(invited_email) = v_email AND role = 'manager';

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

-- invite_company_member(p_company_id uuid, p_display_name text, p_role text, p_email text)
CREATE OR REPLACE FUNCTION public.invite_company_member(p_company_id uuid, p_display_name text, p_role text, p_email text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
    v_uid     uuid := auth.uid();
    v_name    text := btrim(COALESCE(p_display_name, ''));
    v_email   text := NULLIF(lower(btrim(COALESCE(p_email, ''))), '');
    v_row     public.company_members;
    v_token   text;
    v_id      uuid;
    v_exp     timestamptz;
    v_cn      text;
BEGIN
    IF v_uid IS NULL THEN
        RETURN jsonb_build_object('outcome', 'unauthenticated');
    END IF;
    IF p_company_id IS NULL
       OR p_role IS DISTINCT FROM 'encarregado'
       OR length(v_name) < 1 OR length(v_name) > 80
       OR v_name ~ '[[:cntrl:]]' THEN
        RETURN jsonb_build_object('outcome', 'invalid_input');
    END IF;

    IF v_email IS NULL THEN
        RETURN jsonb_build_object('outcome', 'email_required');
    END IF;
    IF length(v_email) < 3 OR length(v_email) > 254
       OR v_email ~ '[[:cntrl:]]'
       OR v_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' THEN
        RETURN jsonb_build_object('outcome', 'invalid_email');
    END IF;

    PERFORM 1 FROM public.companies c WHERE c.id = p_company_id;
    IF NOT FOUND THEN
        RETURN jsonb_build_object('outcome', 'not_found');
    END IF;

    IF NOT public.is_company_owner(p_company_id) THEN
        RETURN jsonb_build_object('outcome', 'forbidden');
    END IF;

    -- Nome armazenado com espacos colapsados (acentos PRESERVADOS: e texto visivel).
    v_name := btrim(regexp_replace(replace(v_name, chr(160), ' '), '[[:space:]]+', ' ', 'g'));
    IF public.normalize_member_name(v_name) = '' THEN
        RETURN jsonb_build_object('outcome', 'invalid_input');
    END IF;

    PERFORM pg_advisory_xact_lock(hashtext('worki:team:' || p_company_id::text)::bigint);

    -- Recusa no convite se o e-mail ja e conta de freela (Article 1).
    IF EXISTS (
        SELECT 1
          FROM auth.users u
          JOIN public.workers w ON w.id = u.id
         WHERE lower(btrim(COALESCE(u.email, ''))) = v_email
    ) THEN
        RETURN jsonb_build_object('outcome', 'worker_cannot_be_manager');
    END IF;

    -- Se o e-mail ja pertence a um membro ATIVO desta empresa, devolve already_member.
    IF EXISTS (
        SELECT 1
          FROM public.company_members cm
          LEFT JOIN auth.users u ON u.id = cm.user_id
         WHERE cm.company_id = p_company_id
           AND cm.status = 'active'
           AND (
               lower(btrim(COALESCE(cm.accepted_email, ''))) = v_email
               OR lower(btrim(COALESCE(u.email, ''))) = v_email
           )
    ) THEN
        RETURN jsonb_build_object('outcome', 'already_member');
    END IF;

    -- Idempotencia por (empresa, e-mail): se houver convite pendente para o mesmo e-mail,
    -- devolve o vigente ou reemite se vencido.
    SELECT * INTO v_row FROM public.company_members cm
     WHERE cm.company_id = p_company_id
       AND cm.status = 'invited'
       AND cm.role = p_role
       AND cm.invited_email IS NOT NULL
       AND lower(btrim(cm.invited_email)) = v_email
     ORDER BY cm.invited_at, cm.id
     LIMIT 1
     FOR UPDATE;

    IF v_row.id IS NOT NULL THEN
        IF v_row.expires_at IS NOT NULL AND v_row.expires_at > now() THEN
            RETURN jsonb_build_object('outcome', 'already_invited', 'member_id', v_row.id,
                                      'invite_token', v_row.invite_token, 'expires_at', v_row.expires_at);
        END IF;
        v_token := public.generate_invite_token();
        UPDATE public.company_members
           SET invite_token = v_token,
               expires_at   = now() + interval '14 days'
         WHERE id = v_row.id
        RETURNING expires_at INTO v_exp;
        RETURN jsonb_build_object('outcome', 'reinvited', 'member_id', v_row.id,
                                  'invite_token', v_token, 'expires_at', v_exp);
    END IF;

    -- Se houver convite pendente com o mesmo nome normalizado e outro e-mail, nao sobrescreve.
    IF EXISTS (
        SELECT 1 FROM public.company_members cm
         WHERE cm.company_id = p_company_id
           AND cm.status = 'invited'
           AND cm.role = p_role
           AND cm.display_name IS NOT NULL
           AND public.normalize_member_name(cm.display_name) = public.normalize_member_name(v_name)
    ) THEN
        RETURN jsonb_build_object('outcome', 'name_already_invited');
    END IF;

    v_token := public.generate_invite_token();
    BEGIN
        INSERT INTO public.company_members
            (company_id, user_id, role, status, display_name, invited_email, invite_token, expires_at, created_by)
        VALUES
            (p_company_id, NULL, p_role, 'invited', v_name, v_email, v_token, now() + interval '14 days', v_uid)
        RETURNING id, expires_at INTO v_id, v_exp;
    EXCEPTION WHEN unique_violation THEN
        GET STACKED DIAGNOSTICS v_cn = CONSTRAINT_NAME;
        IF v_cn = 'uq_company_members_pending_email' THEN
            SELECT * INTO v_row FROM public.company_members cm
             WHERE cm.company_id = p_company_id
               AND cm.status = 'invited'
               AND cm.invited_email IS NOT NULL
               AND lower(btrim(cm.invited_email)) = v_email
             ORDER BY cm.invited_at, cm.id
             LIMIT 1;
            RETURN jsonb_build_object('outcome', 'already_invited', 'member_id', v_row.id,
                                      'invite_token', v_row.invite_token, 'expires_at', v_row.expires_at);
        ELSIF v_cn = 'uq_company_members_invited_name_role' THEN
            RETURN jsonb_build_object('outcome', 'name_already_invited');
        ELSE
            RAISE;
        END IF;
    END;

    RETURN jsonb_build_object('outcome', 'invited', 'member_id', v_id,
                              'invite_token', v_token, 'expires_at', v_exp);
END;
$function$;

-- is_organization_member(p_organization_id uuid)
CREATE OR REPLACE FUNCTION public.is_organization_member(p_organization_id uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
    SELECT (SELECT auth.uid()) IS NOT NULL
       AND p_organization_id IS NOT NULL
       AND (
            EXISTS (SELECT 1 FROM public.organization_members om
                     WHERE om.organization_id = p_organization_id
                       AND om.user_id = (SELECT auth.uid())
                       AND om.status  = 'active')
         OR EXISTS (SELECT 1 FROM public.company_members cm
                      JOIN public.companies c ON c.id = cm.company_id
                     WHERE c.organization_id = p_organization_id
                       AND cm.user_id = (SELECT auth.uid())
                       AND cm.status  = 'active' AND cm.role = 'manager')
         OR EXISTS (SELECT 1 FROM public.companies c2
                     WHERE c2.organization_id = p_organization_id
                       AND (c2.owner_id = (SELECT auth.uid()) OR c2.id = (SELECT auth.uid())))
       );
$function$;

-- jobs_responsible_guard()
CREATE OR REPLACE FUNCTION public.jobs_responsible_guard()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
    v_uid          uuid := auth.uid();
    v_company      uuid;
    v_is_insert    boolean := (TG_OP = 'INSERT');
    v_resp_changed boolean;
    v_tag_changed  boolean;
    v_moved        boolean := false;
BEGIN
    IF v_uid IS NULL THEN
        RETURN NEW;
    END IF;

    -- OLD so e lido no ramo UPDATE (em INSERT o registro OLD nao existe).
    IF v_is_insert THEN
        v_company      := NEW.company_id;
        v_resp_changed := NEW.responsible_id IS NOT NULL;
        v_tag_changed  := NEW.tag_id IS NOT NULL;
    ELSE
        v_company      := OLD.company_id;
        v_resp_changed := NEW.responsible_id IS DISTINCT FROM OLD.responsible_id;
        v_tag_changed  := NEW.tag_id IS DISTINCT FROM OLD.tag_id;
        v_moved        := NEW.company_id IS DISTINCT FROM OLD.company_id
                          OR NEW.series_id IS DISTINCT FROM OLD.series_id;
    END IF;

    -- R3: o cliente NAO e a fonte da verdade do responsavel. Sem valor informado, o criador (se
    -- opera a empresa) assume. Nunca company_id = auth.uid() na mao: a pergunta e do seam.
    IF v_is_insert
       AND NEW.responsible_id IS NULL
       AND public.internal_company_confirmed_operator(NEW.company_id, v_uid) THEN
        NEW.responsible_id := v_uid;
        v_resp_changed := true;
    END IF;

    -- Encarregado: opera o turno, mas nao reatribui nem move turno entre empresas/series.
    IF public.session_company_member_role(v_company) = 'encarregado'
       AND NOT public.is_company_owner(v_company) THEN
        IF (CASE WHEN v_is_insert THEN false ELSE (v_moved OR (v_resp_changed AND COALESCE(current_setting('app.job_reassign', true), '') <> NEW.id::text)) END) THEN
            RAISE EXCEPTION 'jobs: encarregado não altera company_id, responsible_id nem series_id (use "Passar para...").'
                USING ERRCODE = '42501';
        END IF;
        IF v_is_insert AND NEW.series_id IS NOT NULL THEN
            RAISE EXCEPTION 'jobs: série recorrente é do Gestor (v1).'
                USING ERRCODE = '42501';
        END IF;
    END IF;

    -- Validacao de operador ativo, SO quando o valor muda.
    IF NEW.responsible_id IS NOT NULL AND v_resp_changed THEN
        IF NOT public.internal_company_confirmed_operator(NEW.company_id, NEW.responsible_id) THEN
            RAISE EXCEPTION 'jobs: responsible_id precisa ser operador ativo e confirmado da empresa.'
                USING ERRCODE = '23514';
        END IF;
    END IF;

    -- Tag: mesma empresa e nao arquivada (so quando o valor muda).
    IF NEW.tag_id IS NOT NULL AND v_tag_changed THEN
        IF NOT EXISTS (SELECT 1 FROM public.company_tags t
                        WHERE t.id = NEW.tag_id
                          AND t.company_id = NEW.company_id
                          AND t.archived_at IS NULL) THEN
            RAISE EXCEPTION 'jobs: tag inexistente, arquivada ou de outra empresa.'
                USING ERRCODE = '23514';
        END IF;
    END IF;

    RETURN NEW;
END;
$function$;

-- list_company_members(p_company_id uuid, p_include_removed boolean)
CREATE OR REPLACE FUNCTION public.list_company_members(p_company_id uuid, p_include_removed boolean DEFAULT false)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
    v_items jsonb;
BEGIN
    IF auth.uid() IS NULL THEN
        RETURN jsonb_build_object('outcome', 'unauthenticated');
    END IF;
    IF p_company_id IS NULL OR NOT public.is_company_owner(p_company_id) THEN
        RETURN jsonb_build_object('outcome', 'forbidden');
    END IF;

    SELECT COALESCE(jsonb_agg(
               jsonb_build_object(
                   'member_id',      cm.id,
                   'user_id',        cm.user_id,
                   'display_name',   cm.display_name,
                   'role',           cm.role,
                   'status',         cm.status,
                   'state',          CASE
                                         WHEN cm.status = 'removed' THEN 'removed'
                                         WHEN cm.status = 'invited'
                                              AND (cm.expires_at IS NULL OR cm.expires_at <= now())
                                              THEN 'invite_expired'
                                         WHEN cm.status = 'invited' THEN 'invited'
                                         WHEN cm.role = 'encarregado' AND cm.confirmed_at IS NULL
                                              AND COALESCE(cm.accepted_at, cm.invited_at) <= now() - interval '72 hours'
                                              THEN 'pending_expired'
                                         WHEN cm.role = 'encarregado' AND cm.confirmed_at IS NULL
                                              THEN 'awaiting_confirmation'
                                         ELSE 'active'
                                     END,
                   'confirmed',      cm.confirmed_at IS NOT NULL,
                   'confirmation_expires_at',
                                     CASE WHEN cm.status = 'active' AND cm.role = 'encarregado'
                                               AND cm.confirmed_at IS NULL
                                          THEN COALESCE(cm.accepted_at, cm.invited_at) + interval '72 hours'
                                     END,
                   'accepted_email', cm.accepted_email,
                   'invited_email',  cm.invited_email,
                   'invited_at',     cm.invited_at,
                   'expires_at',     cm.expires_at,
                   'accepted_at',    cm.accepted_at,
                   'confirmed_at',   cm.confirmed_at,
                   'removed_at',     cm.removed_at
               )
               ORDER BY (cm.status = 'active' AND cm.confirmed_at IS NULL) DESC,
                        cm.status, lower(cm.display_name), cm.id
           ), '[]'::jsonb)
      INTO v_items
      FROM public.company_members cm
     WHERE cm.company_id = p_company_id
       AND (COALESCE(p_include_removed, false) OR cm.status <> 'removed');

    RETURN jsonb_build_object(
        'outcome', 'ok',
        'items', v_items,
        'elenco_link_rotation_pending',
        EXISTS (
            SELECT 1 FROM public.company_members rm
             WHERE rm.company_id = p_company_id
               AND rm.status = 'removed'
               AND rm.role IN ('manager', 'encarregado')
               AND (rm.confirmed_at IS NOT NULL
                    OR (rm.role = 'manager' AND rm.accepted_at IS NOT NULL))
               AND rm.removed_at > COALESCE(
                       (SELECT l.rotated_at FROM public.company_invite_links l
                         WHERE l.company_id = p_company_id),
                       '-infinity'::timestamptz)
        )
    );
END;
$function$;

-- notification_recipients_for_job(p_job_id uuid)
CREATE OR REPLACE FUNCTION public.notification_recipients_for_job(p_job_id uuid)
 RETURNS SETOF uuid
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
    WITH j AS (
        SELECT jb.company_id, jb.responsible_id
          FROM public.jobs jb
         WHERE jb.id = p_job_id
    )
    -- dono: mesmo destinatario de antes (companies.id = owner_id nas 13 contas atuais)
    SELECT COALESCE(c.owner_id, c.id)
      FROM public.companies c
      JOIN j ON j.company_id = c.id
    UNION
    -- todos os Gestores ativos da empresa (manager)
    SELECT cm.user_id
      FROM public.company_members cm
      JOIN j ON j.company_id = cm.company_id
     WHERE cm.status = 'active'
       AND cm.role   = 'manager'
       AND cm.user_id IS NOT NULL
    UNION
    -- operadores de ORGANIZACAO desta company (R8/R21; ADR encarregado-confirmado, decisao 3):
    -- so owner/operator ativos da organizacao dona DAQUELA company, nao de toda a rede.
    SELECT om.user_id
      FROM public.organization_members om
      JOIN public.companies c2 ON c2.organization_id = om.organization_id
      JOIN j ON j.company_id = c2.id
     WHERE om.status = 'active'
       AND om.role IN ('owner', 'operator')
       AND om.user_id IS NOT NULL
    UNION
    -- responsavel efetivo: so se ainda for operador ativo E (se encarregado) confirmado
    SELECT j.responsible_id
      FROM j
     WHERE j.responsible_id IS NOT NULL
       AND public.internal_company_confirmed_operator(j.company_id, j.responsible_id);
$function$;

-- reject_company_member(p_company_id uuid, p_user_id uuid)
CREATE OR REPLACE FUNCTION public.reject_company_member(p_company_id uuid, p_user_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
    v_uid uuid := auth.uid();
    v_row public.company_members;
BEGIN
    IF v_uid IS NULL THEN
        RETURN jsonb_build_object('outcome', 'unauthenticated');
    END IF;
    IF p_company_id IS NULL OR p_user_id IS NULL THEN
        RETURN jsonb_build_object('outcome', 'invalid_input');
    END IF;
    -- Mesmo lock de equipe das demais mudancas (e da cobertura da E5), ANTES de qualquer
    -- FOR UPDATE; a autorizacao e o estado da linha sao avaliados SOB o lock (READ COMMITTED:
    -- cada comando seguinte ja ve o que a transacao concorrente gravou).
    PERFORM pg_advisory_xact_lock(hashtext('worki:team:' || p_company_id::text)::bigint);
    IF NOT public.is_company_owner(p_company_id) THEN
        RETURN jsonb_build_object('outcome', 'forbidden');
    END IF;
    IF p_user_id = v_uid THEN
        RETURN jsonb_build_object('outcome', 'forbidden');
    END IF;

    -- So encarregado passa por confirmacao (Gestor sai por remove_company_member).
    SELECT * INTO v_row FROM public.company_members cm
     WHERE cm.company_id = p_company_id AND cm.user_id = p_user_id AND cm.status = 'active'
       AND cm.role = 'encarregado'
     FOR UPDATE;
    IF v_row.id IS NULL THEN
        RETURN jsonb_build_object('outcome', 'not_found');
    END IF;

    IF v_row.confirmed_at IS NOT NULL THEN
        RETURN jsonb_build_object('outcome', 'not_pending_confirmation', 'member_id', v_row.id);
    END IF;

    UPDATE public.company_members
       SET status = 'removed', removed_at = now(), removed_by = v_uid, invite_token = NULL
     WHERE id = v_row.id;
    PERFORM public.internal_revoke_member_coverages(p_company_id, p_user_id);

    RETURN jsonb_build_object('outcome', 'rejected', 'member_id', v_row.id);
END;
$function$;

-- remove_company_member(p_company_id uuid, p_user_id uuid, p_dry_run boolean)
CREATE OR REPLACE FUNCTION public.remove_company_member(p_company_id uuid, p_user_id uuid, p_dry_run boolean DEFAULT false)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
    v_uid        uuid := auth.uid();
    v_row        public.company_members;
    v_open_jobs  integer;
    v_rotate     boolean;
BEGIN
    IF v_uid IS NULL THEN
        RETURN jsonb_build_object('outcome', 'unauthenticated');
    END IF;
    IF p_company_id IS NULL OR p_user_id IS NULL THEN
        RETURN jsonb_build_object('outcome', 'invalid_input');
    END IF;
    -- Serializa mudancas de equipe da empresa ANTES da autorizacao: dois Gestores se removendo ao
    -- mesmo tempo nao podem ambos passar pelo teste de "sobra outro Gestor" (dry-run nao trava).
    IF NOT COALESCE(p_dry_run, false) THEN
        PERFORM pg_advisory_xact_lock(hashtext('worki:team:' || p_company_id::text)::bigint);
    END IF;
    IF NOT public.is_company_owner(p_company_id) THEN
        RETURN jsonb_build_object('outcome', 'forbidden');
    END IF;
    IF p_user_id = v_uid THEN
        RETURN jsonb_build_object('outcome', 'cannot_remove_self');
    END IF;

    -- Dry-run NAO toma lock (nao escreve); so a remocao real trava a linha.
    IF COALESCE(p_dry_run, false) THEN
        SELECT * INTO v_row FROM public.company_members cm
         WHERE cm.company_id = p_company_id AND cm.user_id = p_user_id AND cm.status = 'active';
    ELSE
        SELECT * INTO v_row FROM public.company_members cm
         WHERE cm.company_id = p_company_id AND cm.user_id = p_user_id AND cm.status = 'active'
         FOR UPDATE;
    END IF;
    IF v_row.id IS NULL THEN
        -- Idempotente (L1): quem ja foi removido responde `removed` com already_removed, sem escrever
        -- (em dry-run: `would_remove`, tambem com already_removed). A autorizacao (Gestor da empresa)
        -- ja foi checada acima.
        IF EXISTS (SELECT 1 FROM public.company_members cm
                    WHERE cm.company_id = p_company_id AND cm.user_id = p_user_id
                      AND cm.status = 'removed') THEN
            RETURN jsonb_build_object(
                'outcome', CASE WHEN COALESCE(p_dry_run, false) THEN 'would_remove' ELSE 'removed' END,
                'already_removed', true);
        END IF;
        RETURN jsonb_build_object('outcome', 'not_found');
    END IF;

    -- Simetria com "Gestor nao convida Gestor": so dono/operador de organizacao remove Gestor.
    IF v_row.role = 'manager'
       AND NOT public.is_organization_operator(public.company_organization_id(p_company_id)) THEN
        RETURN jsonb_build_object('outcome', 'forbidden');
    END IF;

    -- D3: a empresa nunca fica sem nenhum Gestor/dono ativo (defesa em profundidade: por estas RPCs
    -- quem remove ja e Gestor e nao se remove, mas a invariante nao depende disso).
    IF v_row.role = 'manager'
       AND NOT public.internal_company_has_gestor_besides_member(p_company_id, p_user_id) THEN
        RETURN jsonb_build_object('outcome', 'last_manager');
    END IF;

    -- Turnos realmente ABERTOS e FUTUROS cujo responsavel registrado e a pessoa: ficam com o Gestor
    -- como responsavel efetivo (R19), sem escrita em jobs. jobs.status so admite open | paused |
    -- deleted (CHECK de 20260822000400): "aberto" = open ou paused; deleted nao conta. So informativo.
    SELECT count(*) INTO v_open_jobs
      FROM public.jobs j
     WHERE j.company_id     = p_company_id
       AND j.responsible_id = p_user_id
       AND j.status        IN ('open', 'paused')
       AND j.start_date    >= now();

    -- Quem estava confirmado (ou e Gestor) pode ter lido o link de convite do Elenco: avisar o Gestor
    -- para rotaciona-lo (B4/B5 de seguranca; rotacionar e manual, nunca automatico).
    v_rotate := (v_row.role = 'manager' OR v_row.confirmed_at IS NOT NULL);

    IF COALESCE(p_dry_run, false) THEN
        RETURN jsonb_build_object('outcome', 'would_remove', 'member_id', v_row.id,
                                  'display_name', v_row.display_name, 'role', v_row.role,
                                  'open_jobs', v_open_jobs,
                                  'elenco_link_rotation_advised', v_rotate);
    END IF;

    UPDATE public.company_members
       SET status = 'removed', removed_at = now(), removed_by = v_uid, invite_token = NULL
     WHERE id = v_row.id;
    -- Cobertura ZUMBI: sem revogar, remover + reconvidar + confirmar reviveria a cobertura antiga
    -- (o seam exige membership ativa, mas a linha continuaria valida quando ela voltasse).
    PERFORM public.internal_revoke_member_coverages(p_company_id, p_user_id);

    RETURN jsonb_build_object('outcome', 'removed', 'member_id', v_row.id,
                              'display_name', v_row.display_name, 'role', v_row.role,
                              'open_jobs', v_open_jobs,
                              'elenco_link_rotation_advised', v_rotate);
END;
$function$;

-- resend_member_invite(p_member_id uuid)
CREATE OR REPLACE FUNCTION public.resend_member_invite(p_member_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
    v_uid     uuid := auth.uid();
    v_row     public.company_members;
    v_allowed boolean;
    v_token   text;
    v_exp     timestamptz;
BEGIN
    IF v_uid IS NULL THEN
        RETURN jsonb_build_object('outcome', 'unauthenticated');
    END IF;
    IF p_member_id IS NULL THEN
        RETURN jsonb_build_object('outcome', 'invalid_input');
    END IF;

    SELECT * INTO v_row FROM public.company_members cm WHERE cm.id = p_member_id FOR UPDATE;
    IF v_row.id IS NULL THEN
        RETURN jsonb_build_object('outcome', 'not_found');
    END IF;

    -- Convite de Gestor nao e desta RPC (usa invite_company_manager / revoke_company_manager).
    IF v_row.role <> 'encarregado' THEN
        RETURN jsonb_build_object('outcome', 'not_found');
    END IF;
    IF NOT public.is_company_owner(v_row.company_id) THEN
        RETURN jsonb_build_object('outcome', 'forbidden');
    END IF;

    IF v_row.status <> 'invited' THEN
        RETURN jsonb_build_object('outcome', 'not_pending');
    END IF;

    v_token := public.generate_invite_token();
    UPDATE public.company_members
       SET invite_token = v_token,
           expires_at   = now() + interval '14 days'
     WHERE id = v_row.id
    RETURNING expires_at INTO v_exp;

    RETURN jsonb_build_object('outcome', 'resent', 'member_id', v_row.id,
                              'invite_token', v_token, 'expires_at', v_exp);
END;
$function$;

-- revoke_company_manager(p_company_id uuid, p_user_id uuid)
CREATE OR REPLACE FUNCTION public.revoke_company_manager(p_company_id uuid, p_user_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
    v_uid uuid := auth.uid();
    v_org uuid;
    v_n   integer;
BEGIN
    IF v_uid IS NULL THEN
        RETURN jsonb_build_object('outcome', 'unauthenticated');
    END IF;

    SELECT c.organization_id INTO v_org FROM public.companies c WHERE c.id = p_company_id;
    IF v_org IS NULL THEN
        RETURN jsonb_build_object('outcome', 'not_found');
    END IF;
    IF NOT public.is_organization_operator(v_org) THEN
        RETURN jsonb_build_object('outcome', 'forbidden');
    END IF;

    PERFORM pg_advisory_xact_lock(hashtext('worki:team:' || p_company_id::text)::bigint);
    IF EXISTS (SELECT 1 FROM public.company_members cmx
                WHERE cmx.company_id = p_company_id AND cmx.user_id = p_user_id
                  AND cmx.status = 'active' AND cmx.role = 'manager') THEN
        IF NOT public.internal_company_has_gestor_besides_member(p_company_id, p_user_id) THEN
            RETURN jsonb_build_object('outcome', 'last_manager');
        END IF;
        PERFORM public.internal_revoke_member_coverages(p_company_id, p_user_id);
    END IF;

    UPDATE public.company_members
       SET status = 'removed', removed_at = now(), removed_by = v_uid, invite_token = NULL
     WHERE company_id = p_company_id
       AND (user_id = p_user_id OR (p_user_id IS NULL AND user_id IS NULL))
       AND status IN ('invited', 'active') AND role = 'manager';
    GET DIAGNOSTICS v_n = ROW_COUNT;

    -- NUNCA DELETE: o historico de quem operou a unidade e quando fica. jobs / team_connections /
    -- shift_payments criados pelo gerente continuam pertencendo a UNIDADE, intocados.
    RETURN jsonb_build_object('outcome', CASE WHEN v_n > 0 THEN 'revoked' ELSE 'not_found' END,
                              'affected', v_n);
END;
$function$;

-- revoke_member_invite(p_member_id uuid)
CREATE OR REPLACE FUNCTION public.revoke_member_invite(p_member_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
    v_uid     uuid := auth.uid();
    v_row     public.company_members;
    v_allowed boolean;
BEGIN
    IF v_uid IS NULL THEN
        RETURN jsonb_build_object('outcome', 'unauthenticated');
    END IF;
    IF p_member_id IS NULL THEN
        RETURN jsonb_build_object('outcome', 'invalid_input');
    END IF;

    SELECT * INTO v_row FROM public.company_members cm WHERE cm.id = p_member_id FOR UPDATE;
    IF v_row.id IS NULL THEN
        RETURN jsonb_build_object('outcome', 'not_found');
    END IF;

    IF v_row.role <> 'encarregado' THEN
        RETURN jsonb_build_object('outcome', 'not_found');
    END IF;
    IF NOT public.is_company_owner(v_row.company_id) THEN
        RETURN jsonb_build_object('outcome', 'forbidden');
    END IF;

    IF v_row.status <> 'invited' THEN
        RETURN jsonb_build_object('outcome', 'not_pending');
    END IF;

    UPDATE public.company_members
       SET status            = 'removed',
           removed_at        = now(),
           removed_by        = v_uid,
           invite_token_hash = CASE WHEN invite_token IS NOT NULL
                                    THEN encode(sha256(convert_to(invite_token, 'UTF8')), 'hex')
                                    ELSE invite_token_hash END,
           invite_token      = NULL
     WHERE id = v_row.id;

    RETURN jsonb_build_object('outcome', 'revoked', 'member_id', v_row.id);
END;
$function$;

-- session_operates_company_membership(p_company_id uuid)
CREATE OR REPLACE FUNCTION public.session_operates_company_membership(p_company_id uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
    SELECT (SELECT auth.uid()) IS NOT NULL
       AND p_company_id IS NOT NULL
       AND (
            EXISTS (
                SELECT 1 FROM public.company_members cm
                 WHERE cm.company_id = p_company_id
                   AND cm.user_id = (SELECT auth.uid())
                   AND cm.status  = 'active' AND cm.role = 'manager'
            )
         OR EXISTS (
                SELECT 1
                  FROM public.organization_members om
                  JOIN public.companies c ON c.organization_id = om.organization_id
                 WHERE c.id = p_company_id
                   AND om.user_id = (SELECT auth.uid())
                   AND om.status  = 'active'
                   AND om.role IN ('owner', 'operator')
            )
       );
$function$;

-- 4. Privilegios de EXECUTE como estavam (has_function_privilege)
-- accept_company_member_invite(p_token text, p_accept_tos boolean): anon=false authenticated=true service_role=true
REVOKE ALL ON FUNCTION public.accept_company_member_invite(text, boolean) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.accept_company_member_invite(text, boolean) TO authenticated, service_role;
-- accept_manager_invite(p_token text): anon=false authenticated=true service_role=true
REVOKE ALL ON FUNCTION public.accept_manager_invite(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.accept_manager_invite(text) TO authenticated, service_role;
-- archive_company_tag(p_tag_id uuid): anon=false authenticated=true service_role=true
REVOKE ALL ON FUNCTION public.archive_company_tag(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.archive_company_tag(uuid) TO authenticated, service_role;
-- confirm_company_member(p_company_id uuid, p_user_id uuid, p_typed_name text): anon=false authenticated=true service_role=true
REVOKE ALL ON FUNCTION public.confirm_company_member(uuid, uuid, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.confirm_company_member(uuid, uuid, text) TO authenticated, service_role;
-- create_company_tag(p_company_id uuid, p_name text): anon=false authenticated=true service_role=true
REVOKE ALL ON FUNCTION public.create_company_tag(uuid, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.create_company_tag(uuid, text) TO authenticated, service_role;
-- get_invite_preview(p_token text): anon=true authenticated=true service_role=true
REVOKE ALL ON FUNCTION public.get_invite_preview(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_invite_preview(text) TO anon, authenticated, service_role;
-- get_member_invite_preview(p_token text): anon=true authenticated=true service_role=true
REVOKE ALL ON FUNCTION public.get_member_invite_preview(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_member_invite_preview(text) TO anon, authenticated, service_role;
-- get_my_companies(): anon=false authenticated=true service_role=true
REVOKE ALL ON FUNCTION public.get_my_companies() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_my_companies() TO authenticated, service_role;
-- internal_company_confirmed_operator(p_company_id uuid, p_user_id uuid): anon=false authenticated=false service_role=true
REVOKE ALL ON FUNCTION public.internal_company_confirmed_operator(uuid, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.internal_company_confirmed_operator(uuid, uuid) TO service_role;
-- internal_company_gestor_ids(p_company_id uuid): anon=false authenticated=false service_role=true
REVOKE ALL ON FUNCTION public.internal_company_gestor_ids(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.internal_company_gestor_ids(uuid) TO service_role;
-- internal_company_has_gestor_besides_member(p_company_id uuid, p_user_id uuid): anon=false authenticated=false service_role=true
REVOKE ALL ON FUNCTION public.internal_company_has_gestor_besides_member(uuid, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.internal_company_has_gestor_besides_member(uuid, uuid) TO service_role;
-- internal_team_invite_provision_check(p_token text): anon=false authenticated=false service_role=true
REVOKE ALL ON FUNCTION public.internal_team_invite_provision_check(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.internal_team_invite_provision_check(text) TO service_role;
-- invite_company_manager(p_company_id uuid, p_email text): anon=false authenticated=true service_role=true
REVOKE ALL ON FUNCTION public.invite_company_manager(uuid, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.invite_company_manager(uuid, text) TO authenticated, service_role;
-- invite_company_member(p_company_id uuid, p_display_name text, p_role text, p_email text): anon=false authenticated=true service_role=true
REVOKE ALL ON FUNCTION public.invite_company_member(uuid, text, text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.invite_company_member(uuid, text, text, text) TO authenticated, service_role;
-- is_organization_member(p_organization_id uuid): anon=false authenticated=true service_role=true
REVOKE ALL ON FUNCTION public.is_organization_member(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.is_organization_member(uuid) TO authenticated, service_role;
-- jobs_responsible_guard(): anon=false authenticated=true service_role=true
REVOKE ALL ON FUNCTION public.jobs_responsible_guard() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.jobs_responsible_guard() TO authenticated, service_role;
-- list_company_members(p_company_id uuid, p_include_removed boolean): anon=false authenticated=true service_role=true
REVOKE ALL ON FUNCTION public.list_company_members(uuid, boolean) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.list_company_members(uuid, boolean) TO authenticated, service_role;
-- notification_recipients_for_job(p_job_id uuid): anon=false authenticated=false service_role=true
REVOKE ALL ON FUNCTION public.notification_recipients_for_job(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.notification_recipients_for_job(uuid) TO service_role;
-- reject_company_member(p_company_id uuid, p_user_id uuid): anon=false authenticated=true service_role=true
REVOKE ALL ON FUNCTION public.reject_company_member(uuid, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.reject_company_member(uuid, uuid) TO authenticated, service_role;
-- remove_company_member(p_company_id uuid, p_user_id uuid, p_dry_run boolean): anon=false authenticated=true service_role=true
REVOKE ALL ON FUNCTION public.remove_company_member(uuid, uuid, boolean) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.remove_company_member(uuid, uuid, boolean) TO authenticated, service_role;
-- resend_member_invite(p_member_id uuid): anon=false authenticated=true service_role=true
REVOKE ALL ON FUNCTION public.resend_member_invite(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.resend_member_invite(uuid) TO authenticated, service_role;
-- revoke_company_manager(p_company_id uuid, p_user_id uuid): anon=false authenticated=true service_role=true
REVOKE ALL ON FUNCTION public.revoke_company_manager(uuid, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.revoke_company_manager(uuid, uuid) TO authenticated, service_role;
-- revoke_member_invite(p_member_id uuid): anon=false authenticated=true service_role=true
REVOKE ALL ON FUNCTION public.revoke_member_invite(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.revoke_member_invite(uuid) TO authenticated, service_role;
-- session_operates_company_membership(p_company_id uuid): anon=false authenticated=true service_role=true
REVOKE ALL ON FUNCTION public.session_operates_company_membership(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.session_operates_company_membership(uuid) TO authenticated, service_role;

-- 5. Esquema (so se nenhuma loja padrao estiver em uso)
ALTER TABLE public.company_members DROP CONSTRAINT IF EXISTS company_members_default_tag_role_chk;
ALTER TABLE public.company_members DROP CONSTRAINT IF EXISTS company_members_default_tag_fk;
ALTER TABLE public.company_members DROP COLUMN IF EXISTS default_tag_id;
ALTER TABLE public.company_tags DROP CONSTRAINT IF EXISTS company_tags_company_id_id_key;

COMMIT;
