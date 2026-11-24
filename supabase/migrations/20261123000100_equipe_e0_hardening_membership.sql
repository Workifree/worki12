-- Migration: Equipe e encarregados, E0 — fechar a escalada silenciosa ANTES de existir papel novo
-- File: supabase/migrations/20261123000100_equipe_e0_hardening_membership.sql
-- Spec:  .harness/spec/equipe-encarregados/spec.md (R1)
-- Gate:  .harness/spec/equipe-encarregados/gate-architect.md (G1, D1, D4)
--
-- O DEFEITO LATENTE
-- ============================================================================
-- Todo leitor de `company_members` que significa "Gestor da unidade" decide por
-- `status = 'active'` e MAIS NADA. Hoje isso e inofensivo porque o CHECK
-- `company_members_role_check` so aceita role = 'manager'. No dia em que o CHECK aceitar
-- 'encarregado' (E4), TODO encarregado ativo viraria dono da empresa em ~15 policies sem que
-- ninguem toque nelas: session_operates_company_membership -> is_company_owner -> policies.
-- Esta migration estreita cada leitor para `role = 'manager'` ANTES de o papel existir. Papel novo
-- nasce SEM nenhum acesso e ganha por policy explicita (fail-safe).
--
-- O QUE MUDA (UP)
-- ----------------------------------------------------------------------------
--   1. session_operates_company_membership(uuid)  + `cm.role = 'manager'` (ramo company_members)
--   2. is_organization_member(uuid)               + `cm.role = 'manager'` (decisao explicita: o
--      Encarregado NAO ve a linha de `organizations`; hierarquia de rede e assunto de Gestor)
--   3. get_my_companies()                         + `cm.role = 'manager'` (E4 devolve o papel real)
--   4. session_company_member_role(uuid)          NOVA, DEFINER, sempre sobre auth.uid()
--   5. can_review_for_job(uuid, uuid)             delega a is_job_owner (G1). Corrige um bug
--      PREEXISTENTE: lia `company_members.status = 'accepted'`, valor que o CHECK nem permite,
--      entao o gerente nunca conseguia avaliar o freela da unidade que ele opera.
--
--   6. invite_company_manager / accept_manager_invite / revoke_company_manager (F13) passam a
--      filtrar role = 'manager' (secao 2b): sem isso, quando E4 alargar o CHECK elas devolveriam
--      token de convite de encarregado, apagariam convite de encarregado, aceitariam token de
--      encarregado pelo caminho antigo e revogariam encarregado.
--
-- NO-OP PARA AS CONTAS ATUAIS: `company_members` esta VAZIA em producao (verificado 23/11/2026),
-- 13 companies, todas com id = owner_id, zero jobs orfaos. Nenhuma pessoa real muda de
-- comportamento. A unica mudanca observavel e a do item 5 para um gerente/operador (que passa a
-- poder avaliar) — e nao existe nenhum.
--
-- METODO: edicao por pg_get_functiondef + ASSERCAO de presenca do trecho antigo (condicao D4 do
-- gate; precedente 20260824000200/000300). Regex SEM barra invertida e SEM retrovisao: classes
-- POSIX e colchetes, o trecho casado e re-injetado por replace() literal. Motivo: a licao de
-- 20260824000900 (conexao com standard_conforming_strings OFF transforma sequencia com barra
-- invertida em byte de controle).
--
-- Article 8: nada aqui toca wallets / escrow_transactions / wallet_transactions / RPC de saldo.
--
-- DOWN (rollback) — seguro enquanto C6 do gate mostrar ZERO linhas com role <> 'manager':
--   -- (1)(2)(3): reverter o predicado, com a MESMA tecnica (catalogo + replace literal):
--   --   v_def := pg_get_functiondef('public.session_operates_company_membership(uuid)'::regprocedure);
--   --   EXECUTE replace(v_def, ' AND cm.role = ''manager''', '');
--   --   idem para public.is_organization_member(uuid) e public.get_my_companies().
--   -- (6): replace literal inverso: remover ' AND cm.role = ''manager''' / ' AND role = ''manager'''
--   --      de invite_company_manager, accept_manager_invite e revoke_company_manager.
--   -- (4): DROP FUNCTION IF EXISTS public.session_company_member_role(uuid);
--   -- (5): recriar can_review_for_job com o corpo de 20260825000400 (secao #11 daquele arquivo).
--   --      ATENCAO: esse corpo tem `m.status = 'accepted'` (o bug). Reverter devolve o bug.

-- ============================================================================
-- 0. ASSERCOES — o catalogo precisa ser o que esta migration espera
-- ============================================================================
DO $mig$
BEGIN
    IF to_regprocedure('public.session_operates_company_membership(uuid)') IS NULL
       OR to_regprocedure('public.is_organization_member(uuid)') IS NULL
       OR to_regprocedure('public.get_my_companies()') IS NULL
       OR to_regprocedure('public.can_review_for_job(uuid, uuid)') IS NULL
       OR to_regprocedure('public.is_job_owner(uuid)') IS NULL THEN
        RAISE EXCEPTION
          'ASSERCAO E0: funcao do seam ausente no catalogo. Aplicar 20260818100000/100200/100300 e '
          '20260825000400 antes. HALT -> architect.';
    END IF;

    -- O CHECK vigente precisa ser o de F13 (so manager). Se ja aceitar outro valor, a premissa
    -- "no-op" desta migration deixou de valer e a ordem E0 -> E4 foi violada.
    IF EXISTS (SELECT 1 FROM public.company_members WHERE role <> 'manager') THEN
        RAISE EXCEPTION
          'ASSERCAO E0: existe company_members com role <> manager. E0 precisa vir ANTES de qualquer '
          'papel novo. HALT -> architect.';
    END IF;
END
$mig$;

-- ============================================================================
-- 1. session_company_member_role — "qual e o meu papel ATIVO nesta empresa?"
--    DEFINER minimo, sempre sobre auth.uid(), nunca aceita "por qual usuario perguntar".
--    Devolve NULL para quem nao tem linha ativa em company_members (dono direto e operador de
--    organizacao NAO tem linha la — a ausencia nao significa "sem acesso", significa "o acesso
--    vem de outro ramo do seam"). Quem precisa do acesso pleno pergunta a is_company_owner.
-- ============================================================================
CREATE OR REPLACE FUNCTION public.session_company_member_role(p_company_id uuid)
RETURNS text
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
    SELECT cm.role
      FROM public.company_members cm
     WHERE (SELECT auth.uid()) IS NOT NULL
       AND p_company_id IS NOT NULL
       AND cm.company_id = p_company_id
       AND cm.user_id    = (SELECT auth.uid())
       AND cm.status     = 'active'
     LIMIT 1;
$$;

COMMENT ON FUNCTION public.session_company_member_role(uuid) IS
    'Papel ATIVO da sessao em company_members para a empresa (manager | encarregado) ou NULL. '
    'DEFINER para nao recursar na RLS de company_members (precedente session_operates_company_'
    'membership). So company_members: dono direto e operador de organizacao nao tem linha la. '
    'Equipe e encarregados (E0, 20261123000100). Nao aceita uid de terceiro.';

REVOKE ALL ON FUNCTION public.session_company_member_role(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.session_company_member_role(uuid) TO authenticated, service_role;

-- ============================================================================
-- 2. Os tres leitores de company_members que significam "Gestor" passam a exigir role='manager'
--    Padrao: acha o trecho `cm.user_id = (SELECT auth.uid()) AND cm.status = 'active'`
--    (qualquer espacamento/quebra de linha), exige EXATAMENTE 1 ocorrencia, acrescenta o filtro.
-- ============================================================================
DO $mig$
DECLARE
    v_alvo  text;
    v_def   text;
    v_pat   text :=
        'cm[.]user_id[[:space:]]*=[[:space:]]*[(]SELECT auth[.]uid[(][)][)]'
        '[[:space:]]+AND cm[.]status[[:space:]]*=[[:space:]]*''active''';
    v_hit   text;
    v_n     integer;
    v_novo  text;
BEGIN
    FOREACH v_alvo IN ARRAY ARRAY[
        'public.session_operates_company_membership(uuid)',
        'public.is_organization_member(uuid)',
        'public.get_my_companies()'
    ]
    LOOP
        v_def := pg_get_functiondef(v_alvo::regprocedure);

        -- Idempotencia: ja endurecida em rodada anterior -> nada a fazer, sem erro.
        IF position('cm.role = ''manager''' IN v_def) > 0 THEN
            CONTINUE;
        END IF;

        SELECT count(*) INTO v_n FROM regexp_matches(v_def, v_pat, 'g');
        IF v_n <> 1 THEN
            RAISE EXCEPTION
              'ASSERCAO E0: % tem % ocorrencia(s) do predicado de company_members (esperado 1). '
              'A funcao mudou no catalogo -- reconferir antes de reescrever. HALT.', v_alvo, v_n;
        END IF;

        v_hit  := (regexp_match(v_def, v_pat))[1];
        v_novo := replace(v_def, v_hit, v_hit || ' AND cm.role = ''manager''');

        IF position('cm.role = ''manager''' IN v_novo) = 0 THEN
            RAISE EXCEPTION 'ASSERCAO E0: a substituicao nao produziu o filtro de papel em %. HALT.', v_alvo;
        END IF;

        EXECUTE v_novo;
    END LOOP;
END
$mig$;

-- ============================================================================
-- 2b. As tres RPCs de convite/remocao de GERENTE (F13) tambem leem company_members sem filtrar
--     papel. Quando E4 alargar o CHECK, sem filtro elas (i) devolveriam o TOKEN de um convite de
--     encarregado ao reconvidar o mesmo e-mail (already_invited), (ii) apagariam convite de
--     encarregado no passo "vencido -> removed", (iii) aceitariam, pelo caminho antigo
--     (/convite-gerente), um token de encarregado — pulando TOS, OTP e confirmacao — e (iv)
--     revoke_company_manager removeria encarregado. Cada edicao: catalogo + replace LITERAL +
--     assercao de contagem exata (D4). Fonte: 20260822000300 (invite/accept) e 20260818100300
--     (revoke).
-- ============================================================================
DO $mig$
DECLARE
    v_def   text;
    v_novo  text;
    v_hit   text;
    v_n     integer;
    c_role  constant text := ' AND cm.role = ''manager''';
BEGIN
    -- ---------------- invite_company_manager: 3 pontos ----------------
    v_def := pg_get_functiondef('public.invite_company_manager(uuid, text)'::regprocedure);
    IF position('role = ''manager''' IN v_def) = 0 THEN
        v_novo := v_def;

        -- (1) already_active
        SELECT count(*) INTO v_n FROM regexp_matches(v_novo,
            'AND cm[.]status = ''active''[[:space:]]+AND [(][[:space:]]*lower[(]cm[.]invited_email[)] = v_email', 'g');
        IF v_n <> 1 THEN
            RAISE EXCEPTION 'ASSERCAO E0(invite/already_active): % ocorrencia(s) (esperado 1). HALT.', v_n;
        END IF;
        v_hit  := (regexp_match(v_novo,
            'AND cm[.]status = ''active''[[:space:]]+AND [(][[:space:]]*lower[(]cm[.]invited_email[)] = v_email'))[1];
        v_novo := replace(v_novo, v_hit,
            'AND cm.status = ''active''' || c_role || chr(10) ||
            '       AND ( lower(cm.invited_email) = v_email');

        -- (2) already_invited (nao devolver token de convite de OUTRO papel)
        SELECT count(*) INTO v_n FROM regexp_matches(v_novo, 'AND cm[.]expires_at > now[(][)]', 'g');
        IF v_n <> 1 THEN
            RAISE EXCEPTION 'ASSERCAO E0(invite/already_invited): % ocorrencia(s) (esperado 1). HALT.', v_n;
        END IF;
        v_novo := replace(v_novo, 'AND cm.expires_at > now()', 'AND cm.expires_at > now()' || c_role);

        -- (3) "vencido -> removed" so de convite de gerente
        SELECT count(*) INTO v_n FROM regexp_matches(v_novo,
            'AND status = ''invited''[[:space:]]+AND lower[(]invited_email[)] = v_email', 'g');
        IF v_n <> 1 THEN
            RAISE EXCEPTION 'ASSERCAO E0(invite/vencido): % ocorrencia(s) (esperado 1). HALT.', v_n;
        END IF;
        v_hit  := (regexp_match(v_novo,
            'AND status = ''invited''[[:space:]]+AND lower[(]invited_email[)] = v_email'))[1];
        v_novo := replace(v_novo, v_hit, v_hit || ' AND role = ''manager''');

        EXECUTE v_novo;
    END IF;

    -- ---------------- accept_manager_invite: lookup do token + 2 EXISTS "ja ativo" ----------------
    v_def := pg_get_functiondef('public.accept_manager_invite(text)'::regprocedure);
    IF position('role = ''manager''' IN v_def) = 0 THEN
        v_novo := v_def;

        SELECT count(*) INTO v_n FROM regexp_matches(v_novo, 'cm[.]invite_token = trim[(]p_token[)]', 'g');
        IF v_n <> 1 THEN
            RAISE EXCEPTION 'ASSERCAO E0(accept/token): % ocorrencia(s) (esperado 1). HALT.', v_n;
        END IF;
        v_novo := replace(v_novo, 'cm.invite_token = trim(p_token)', 'cm.invite_token = trim(p_token)' || c_role);

        -- os dois SELECT de v_existing (caminho sequencial e handler de corrida) terminam em
        -- `AND cm.id <> v_row.id`
        v_n := (length(v_novo) - length(replace(v_novo, 'AND cm.id <> v_row.id', '')))
               / length('AND cm.id <> v_row.id');
        IF v_n <> 2 THEN
            RAISE EXCEPTION 'ASSERCAO E0(accept/v_existing): % ocorrencia(s) (esperado 2). HALT.', v_n;
        END IF;
        v_novo := replace(v_novo, 'AND cm.id <> v_row.id', 'AND cm.id <> v_row.id' || c_role);

        EXECUTE v_novo;
    END IF;

    -- ---------------- revoke_company_manager ----------------
    v_def := pg_get_functiondef('public.revoke_company_manager(uuid, uuid)'::regprocedure);
    IF position('role = ''manager''' IN v_def) = 0 THEN
        v_n := (length(v_def) - length(replace(v_def, 'AND status IN (''invited'', ''active'');', '')))
               / length('AND status IN (''invited'', ''active'');');
        IF v_n <> 1 THEN
            RAISE EXCEPTION 'ASSERCAO E0(revoke): % ocorrencia(s) (esperado 1). HALT.', v_n;
        END IF;
        EXECUTE replace(v_def, 'AND status IN (''invited'', ''active'');',
                        'AND status IN (''invited'', ''active'') AND role = ''manager'';');
    END IF;

    -- Verificacao final: as tres filtram papel.
    IF position('role = ''manager''' IN pg_get_functiondef('public.invite_company_manager(uuid, text)'::regprocedure)) = 0
       OR position('role = ''manager''' IN pg_get_functiondef('public.accept_manager_invite(text)'::regprocedure)) = 0
       OR position('role = ''manager''' IN pg_get_functiondef('public.revoke_company_manager(uuid, uuid)'::regprocedure)) = 0 THEN
        RAISE EXCEPTION 'ASSERCAO E0: invite/accept/revoke_company_manager nao filtram papel apos a edicao. HALT.';
    END IF;
END
$mig$;

COMMENT ON FUNCTION public.session_operates_company_membership(uuid) IS
    'Branch de multi-unidade do seam de autorizacao. DEFINER de proposito: se fosse INVOKER, a '
    'policy de company_members chamaria is_company_owner que chamaria esta funcao que releria '
    'company_members = recursao 42P17 EM RUNTIME. Chamada por public.is_company_owner. '
    'Desde 20261123000100 (E0) o ramo company_members exige role = manager: papel novo '
    '(encarregado) NUNCA herda acesso pleno por aqui. Ver ddl-aprovado.md §4 e '
    'ADR-20261123-responsavel-efetivo-derivado-no-seam.';

-- ============================================================================
-- 3. can_review_for_job — o lado "empresa avalia o freela" passa a perguntar ao seam
--    Baseline: 20260825000400 (unica definicao no repo). Assercao de presenca do bug antigo.
--    O ramo (b) (freela avalia a empresa) fica LITERALMENTE como estava.
-- ============================================================================
DO $mig$
DECLARE
    v_def text := pg_get_functiondef('public.can_review_for_job(uuid, uuid)'::regprocedure);
BEGIN
    IF position('is_job_owner' IN v_def) > 0 THEN
        RAISE NOTICE 'E0: can_review_for_job ja delega a is_job_owner; nada a fazer.';
    ELSIF position('''accepted''' IN v_def) = 0
       OR position('company_members' IN v_def) = 0 THEN
        RAISE EXCEPTION
          'ASSERCAO E0: can_review_for_job nao tem o corpo de 20260825000400 (company_members + '
          'status accepted). A funcao mudou no catalogo -- reconferir antes de reescrever. HALT.';
    END IF;
END
$mig$;

CREATE OR REPLACE FUNCTION public.can_review_for_job(p_job_id uuid, p_reviewed_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
    SELECT p_job_id IS NOT NULL
       AND p_reviewed_id IS NOT NULL
       AND auth.uid() IS NOT NULL
       AND auth.uid() <> p_reviewed_id          -- ninguem avalia a si mesmo
       AND EXISTS (
        SELECT 1
          FROM public.applications a
          JOIN public.jobs j ON j.id = a.job_id
         WHERE a.job_id = p_job_id
           AND a.status = 'completed'
           AND (
                -- (a) quem OPERA ESTE TURNO avalia o freela daquele turno. is_job_owner e o seam:
                --     dono, gerente ativo, operador de organizacao e (a partir de E2) o
                --     encarregado responsavel. Antes: ancoragem escrita a mao + tabela de membros
                --     com status 'accepted' (valor que o CHECK nao permite -> gerente nunca avaliava).
                (    a.worker_id = p_reviewed_id
                 AND public.is_job_owner(a.job_id)
                )
             OR -- (b) freela avalia a empresa do turno que ele concluiu (INALTERADO)
                (    a.worker_id = auth.uid()
                 AND (   j.company_id = p_reviewed_id
                      OR j.company_id IN (SELECT c.id FROM public.companies c WHERE c.owner_id = p_reviewed_id))
                )
           )
       );
$$;

COMMENT ON FUNCTION public.can_review_for_job(uuid, uuid) IS
    'Responde "auth.uid() pode avaliar p_reviewed_id pelo turno p_job_id?". Exige applications '
    'concluída ligando as duas partes, nos dois sentidos, e recusa auto-avaliação. O lado empresa '
    'DELEGA a is_job_owner (E0, 20261123000100): gerente passa a conseguir avaliar (antes lia '
    'company_members.status=accepted, valor impossível) e o encarregado herda o escopo por turno '
    'quando E2 mudar is_job_owner. DEFINER de propósito: pergunta de autorização, não de '
    'visibilidade (débito #11).';

REVOKE ALL ON FUNCTION public.can_review_for_job(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.can_review_for_job(uuid, uuid) TO authenticated, service_role;

-- ============================================================================
-- VERIFICACAO (read-only, ROLLBACK) — rodar ANTES e DEPOIS; resultado tem de ser IDENTICO
-- ----------------------------------------------------------------------------
--   BEGIN; SET LOCAL ROLE authenticated;
--   SET LOCAL request.jwt.claims = '{"sub":"<uid de um dono real>","role":"authenticated"}';
--   SELECT c.id, public.is_company_owner(c.id) FROM public.companies c ORDER BY 1;
--   SELECT j.id, public.is_job_owner(j.id)     FROM public.jobs j WHERE j.status <> 'deleted' ORDER BY 1;
--   SELECT * FROM public.get_my_companies();
--   SELECT public.is_organization_member(c.organization_id) FROM public.companies c ORDER BY c.id;
--   ROLLBACK;
-- Repetir para: cada dono real, uma conta de freela (tudo false / vazio) e uma conta de empresa
-- sem vinculo. Auditoria estrutural completa: supabase/tests/equipe_e0_e3_auditoria.sql.
-- ============================================================================
