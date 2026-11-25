-- Migration: Equipe e encarregados, E5 — operação (conflito, passar/cobrir, cancelar turno, tags, risco, avisos)
-- File: supabase/migrations/20261123000600_equipe_e5_operacao.sql
-- Spec:  .harness/spec/equipe-encarregados/spec.md (R7b, R14, R18, R20, R21, R25-R27; A5, A6, A14-A18, A25-A27)
-- Gate:  .harness/spec/equipe-encarregados/gate-architect.md (secao D: D1-D4, D8)
-- ADRs:  ADR-20261123-responsavel-efetivo-derivado-no-seam, ADR-20261123-encarregado-confirmado-e-pii,
--        ADR-20261123-remover-pessoa-so-corta-acesso, ADR-20261123-elenco-unico-da-company
--
-- DATA LOCAL DO TURNO (expressao canonica desta E5 e do seam de E2):
--   (jobs.start_date AT TIME ZONE 'America/Sao_Paulo')::date
-- E EQUIVALENTE a public.job_local_date (20260817000600), que faz start_date::timestamptz::date com
-- SET timezone = 'America/Sao_Paulo': sendo start_date timestamptz (assercao de E1), ambas convertem o
-- mesmo instante para a data civil de Sao Paulo, sem depender do TimeZone da sessao. A E5 usa a forma
-- explicita porque tem a linha em maos (job_local_date reconsulta jobs por id).
--
-- ORDEM DE APLICACAO: E0, E1, E2, E3, E4 e SO ENTAO esta E5 (nunca antes da E4: usa
-- internal_notify_member_event / internal_company_gestor_ids / get_my_companies de E4; o bloco 0 da HALT).
-- PRECONDICAO DE DADOS: nenhum turno orfao (jobs.company_id sem linha em companies) — o bloco 0 da HALT
-- se houver (notification_recipients_for_job ficaria sem destinatario). O bloco 0 tambem CONTA, em modo
-- aviso, as pessoas que operam 2+ companies.
-- DEPENDE de E0-E4 (assercoes no bloco 0). NAO edita nenhuma das migrations anteriores: toda mudanca
-- em corpo ja existente e feita por pg_get_functiondef + replace literal com ASSERCAO de contagem (D4).
--
-- O QUE ENTRA (UP)
-- ----------------------------------------------------------------------------
--   1. jobs_responsible_guard (E2) — UMA edicao (ADR-20261123-troca-de-responsavel-so-pela-rpc): o ramo do
--      encarregado continua ESTRITO (nao troca company_id/series_id/responsible_id), com UMA excecao: a GUC
--      LOCAL `app.job_reassign` = id do turno, que so reassign_job_responsible escreve (set_config
--      is_local=true, valor = r.id::text, zerada logo apos o UPDATE). PATCH direto do responsavel
--      continua RECUSADO; o sinal de um turno nao libera outro. Nenhuma funcao de public pode chamar
--      set_config com texto vindo do chamador (verificado no bloco 11).
--   2. get_busy_workers (R14)           conflito de freela na company inteira; SO worker_id.
--   3. reassign_job_responsible (R18)   "Passar para..." (1..100 turnos, transacao unica).
--      create_responsibility_coverage / end_responsibility_coverage  "Cobrir X de A a B" (sem cron).
--   4. cancel_job (R27)                 cancela o turno inteiro; unica porta para turno populado.
--   5. create_company_tag / archive_company_tag / set_job_tag (R20)  nunca DELETE.
--   6. my_link_risk_config(p_company_id uuid DEFAULT NULL) (R7b): DROP da assinatura antiga + CREATE.
--   7. Roteamento de aviso "a empresa": claim_shift_slot, decline_shift_call,
--      respond_attendance_confirmation passam a avisar notification_recipients_for_job (R21).
--   8b. list_company_operators (user_id + rotulo + papel gestor|encarregado; destinos de Passar/Cobrir para o encarregado confirmado)
--   8. list_jobs_by_responsible (v1 minimo, Gestor-only): responsavel visivel + filtro por pessoa/tag.
--   9. internal_member_label (helper interno, sem EXECUTE para o client).
--
-- NOME DAS RPCs: seguem a SPEC (R18: reassign_job_responsible / create_responsibility_coverage), que
-- tambem e como E1 e o ADR responsavel-efetivo as citam. "Passar para..." e "Cobrir" sao rotulos de UI.
--
-- DECISAO A18 x R27 (que o teste de E3 deixou anotada): quando a EMPRESA cancela, o trigger
-- trg_notify_counterpart_on_application_cancel avisa SO o freela (por candidatura). O aviso de RASTRO
-- ao responsavel + Gestores + dono e feito pela RPC cancel_job, UMA vez por turno (nao por candidatura:
-- um turno de 8 freelas viraria 8 avisos iguais por Gestor). Quem cancelou nao recebe o proprio aviso.
-- O trigger NAO e tocado. Cancelar o turno por UPDATE cru continua so no turno vazio (E3).
--
-- DECISAO get_busy_workers: devolve TABLE(worker_id uuid) (payload SO com worker_id, A5) e RAISE 42501
-- para quem nao e membro confirmado — nunca "zero linhas" para quem nao pode saber (falso "livre").
-- A UI trata erro como "sem aviso" + log (regra F5). Janela do turno = data local de start_date +
-- work_start_time..work_end_time (cruza a meia-noite se fim <= inicio); sem horario = o dia local inteiro.
--
-- COMPORTAMENTO PARA AS CONTAS ATUAIS (NAO e no-op puro): nenhum encarregado existe e nenhuma RPC nova e
-- chamada por codigo existente, MAS (R21) as tres funcoes de aviso (claim/decline/respond) passam a avisar
-- tambem Gestores 'manager' ativos e operadores de organizacao (notification_recipients_for_job = dono
-- UNION managers ativos UNION operadores de organizacao UNION responsavel efetivo); conta sem manager nem
-- operador recebe exatamente o que recebia (COALESCE(owner_id, id)).
-- my_link_risk_config sem parametro devolve o MESMO {enabled, threshold} (+ "outcome":"ok") para quem opera
-- exatamente 1 company; quem opera 2+ (operador de organizacao com varias unidades, gerente de duas
-- companies) passa a receber company_required. NAO se afirma que ninguem e afetado: o portao (bloco 0)
-- CONTA as pessoas que operam 2+ companies e as reporta em RAISE WARNING.
-- CONTRATO PARA O FRONTEND (linkRiskService.getConfig chama o RPC sem parametro): tratar outcome != 'ok'
-- como "usar o default LIGADO/2" e passar a company corrente (p_company_id).
-- PENDENCIA R7b: auditar as OUTRAS RPCs/resolvedores que escolhem empresa por LIMIT 1 (so
-- my_link_risk_config foi corrigida aqui).
--
-- Article 8: nada aqui toca wallets / escrow_transactions / wallet_transactions / RPCs de escrow.
-- cancel_job NAO estorna escrow: RECUSA (outcome active_escrow) se houver escrow_transactions
-- reserved|authorized|captured do turno. Escrow e shift_payments so sao LIDOS. A tabela nova
-- job_cancellations (L-4) e so auditoria (ator, motivo, contagens), sem DELETE e sem FK.
--
-- SEGURANCA (D1-D3): toda RPC DEFINER com SET search_path = ''; REVOKE FROM PUBLIC, anon; GRANT TO
-- authenticated, service_role; nenhuma aceita "por qual usuario perguntar" (o unico helper que aceita uid,
-- internal_member_label, nao tem EXECUTE para authenticated/anon); nenhuma com anon. Nenhum predicado
-- novo com company_id/owner_id = auth.uid(): a pergunta e sempre is_company_owner / is_job_owner /
-- is_company_member_confirmed / session_company_member_*. O que o bloco 11 VERIFICA sobre set_config: nenhuma
-- funcao de public alem de reassign_job_responsible contem `set_config` (comentarios de linha descartados) e
-- essa funcao so o chama 2x (app.job_reassign = r.id::text e ''). Sessao nula atravessa o unico trigger tocado
-- (jobs_responsible_guard: IF v_uid IS NULL THEN RETURN NEW intacto).
--
-- DOWN (rollback) — seguro em qualquer momento (nada aqui cria dado que outra migration exija):
--   DROP FUNCTION IF EXISTS public.list_company_operators(uuid);
--   DROP FUNCTION IF EXISTS public.list_jobs_by_responsible(uuid, date, date, uuid, uuid);
--   -- (cancel_job grava em job_cancellations: dropar a funcao ANTES da tabela)
--   DROP FUNCTION IF EXISTS public.set_job_tag(uuid, uuid);
--   DROP FUNCTION IF EXISTS public.archive_company_tag(uuid);
--   DROP FUNCTION IF EXISTS public.create_company_tag(uuid, text);
--   DROP FUNCTION IF EXISTS public.cancel_job(uuid, text);
--   DROP FUNCTION IF EXISTS public.end_responsibility_coverage(uuid);
--   DROP FUNCTION IF EXISTS public.create_responsibility_coverage(uuid, uuid, uuid, date, date);
--   DROP FUNCTION IF EXISTS public.reassign_job_responsible(uuid[], uuid);
--   DROP FUNCTION IF EXISTS public.get_busy_workers(uuid, timestamptz, timestamptz, uuid[], uuid);
--   DROP FUNCTION IF EXISTS public.internal_member_label(uuid, uuid);   -- por ULTIMO (as de cima a usam)
--   -- my_link_risk_config: recriar a assinatura antiga e soltar a nova
--   DROP FUNCTION IF EXISTS public.my_link_risk_config(uuid);
--   CREATE OR REPLACE FUNCTION public.my_link_risk_config()
--   RETURNS jsonb LANGUAGE sql STABLE SECURITY INVOKER SET search_path = ''
--   AS $f$ SELECT COALESCE((SELECT jsonb_build_object('enabled', c.link_risk_alert_enabled,
--          'threshold', c.link_risk_alert_threshold) FROM public.companies c
--          WHERE (SELECT auth.uid()) IS NOT NULL AND (c.id = (SELECT auth.uid()) OR c.owner_id = (SELECT auth.uid()))
--          ORDER BY (c.id = (SELECT auth.uid())) DESC, c.id LIMIT 1), jsonb_build_object('enabled', true, 'threshold', 2)); $f$;
--   REVOKE ALL ON FUNCTION public.my_link_risk_config() FROM PUBLIC, anon;
--   GRANT EXECUTE ON FUNCTION public.my_link_risk_config() TO authenticated, service_role;
--   DROP TABLE IF EXISTS public.job_cancellations;   -- auditoria L-4 (perde so o historico de cancelamentos)
--   -- claim_shift_slot / decline_shift_call / respond_attendance_confirmation: bloco DO pronto (replace INVERSO)
--   DO $d$
--   DECLARE v_alvo text; v_comp text; v_def text; v_hit text; v_rest text; v_novo text;
--   BEGIN
--     FOR v_alvo, v_comp IN SELECT * FROM (VALUES
--         ('public.claim_shift_slot(uuid)', 'v_call.company_id'),
--         ('public.decline_shift_call(uuid)', 'v_call.company_id'),
--         ('public.respond_attendance_confirmation(uuid, text)', 'v_company_id')) AS t(a, b)
--     LOOP
--       v_def := pg_get_functiondef(v_alvo::regprocedure);
--       v_hit := (regexp_match(v_def, 'SELECT rcp,.*?[[:space:]]FROM public[.]notification_recipients_for_job[(][a-z_.]+[)] AS rcp;'))[1];
--       IF v_hit IS NULL THEN RAISE EXCEPTION 'DOWN E5: % nao esta roteada (nada a reverter).', v_alvo; END IF;
--       v_rest := substr(v_hit, length('SELECT rcp,') + 1);
--       v_rest := regexp_replace(v_rest, '[[:space:]]FROM public[.]notification_recipients_for_job[(][a-z_.]+[)] AS rcp;$', '');
--       v_novo := replace(v_def, v_hit, 'VALUES (v_company_user,' || v_rest || ');');
--       v_novo := replace(v_novo, '-- E5: destinatarios = responsavel efetivo + Gestores + dono (ver a chamada logo abaixo).',
--           'SELECT c.owner_id INTO v_company_user FROM public.companies c WHERE c.id = ' || v_comp || '; '
--           || 'IF v_company_user IS NULL THEN v_company_user := ' || v_comp || '; END IF;');
--       IF v_novo = v_def OR position('INTO v_company_user' IN v_novo) = 0 THEN RAISE EXCEPTION 'DOWN E5: reversao de % falhou.', v_alvo; END IF;
--       EXECUTE v_novo;
--     END LOOP;
--   END $d$;
--   -- jobs_responsible_guard: bloco DO pronto (replace INVERSO do v_new do bloco 1)
--   DO $d$
--   DECLARE v_def text := pg_get_functiondef('public.jobs_responsible_guard()'::regprocedure); v_novo text;
--   BEGIN
--     v_novo := replace(v_def,
--       'IF (CASE WHEN v_is_insert THEN false ELSE (v_moved OR (v_resp_changed AND COALESCE(current_setting(''app.job_reassign'', true), '''') <> NEW.id::text)) END) THEN',
--       'IF NOT v_is_insert AND (v_moved OR v_resp_changed) THEN');
--     IF v_novo = v_def THEN RAISE EXCEPTION 'DOWN E5: guard nao estava editado.'; END IF;
--     EXECUTE v_novo;
--   END $d$;

-- ============================================================================
-- 0. ASSERCOES (portao) — o catalogo precisa ser o que esta migration espera
-- ============================================================================
DO $mig$
DECLARE
    r       record;
    v_def   text;
    v_n     integer;
    v_dep   text;
BEGIN
    -- (a) E0-E4 aplicadas: helpers do seam e das RPCs de equipe
    FOR r IN SELECT unnest(ARRAY[
        'public.session_company_member_role(uuid)',
        'public.session_company_member_confirmed(uuid)',
        'public.is_company_member_confirmed(uuid)',
        'public.internal_company_active_operator(uuid, uuid)',
        'public.internal_company_confirmed_operator(uuid, uuid)',
        'public.session_can_operate_job(uuid, uuid, date)',
        'public.notification_recipients_for_job(uuid)',
        'public.jobs_responsible_guard()',
        'public.jobs_soft_delete_guard()',
        'public.notify_counterpart_on_application_cancel()',
        'public.internal_notify_member_event(uuid, text, text, text)',
        'public.internal_company_gestor_ids(uuid)',
        'public.invite_company_member(uuid, text, text)',
        'public.get_my_companies()',
        'public.claim_shift_slot(uuid)',
        'public.decline_shift_call(uuid)',
        'public.respond_attendance_confirmation(uuid, text)'
    ]) AS sig
    LOOP
        IF to_regprocedure(r.sig) IS NULL THEN
            RAISE EXCEPTION 'ASSERCAO E5: % ausente no catalogo. Aplicar E0-E4 (20261123000100..500) antes. HALT.', r.sig;
        END IF;
    END LOOP;

    IF to_regclass('public.company_tags') IS NULL OR to_regclass('public.responsibility_coverages') IS NULL
       OR to_regclass('public.escrow_transactions') IS NULL OR to_regclass('public.shift_payments') IS NULL THEN
        RAISE EXCEPTION 'ASSERCAO E5: company_tags / responsibility_coverages (E1) ou escrow_transactions / shift_payments ausentes. HALT.';
    END IF;

    -- turnos ORFAOS (jobs.company_id sem linha em companies): notification_recipients_for_job nao teria
    -- destinatario e os avisos de cancel_job falhariam em silencio (C10 do gate). Esperado 0.
    SELECT count(*) INTO v_n FROM public.jobs j
     WHERE NOT EXISTS (SELECT 1 FROM public.companies c WHERE c.id = j.company_id);
    IF v_n <> 0 THEN
        RAISE EXCEPTION 'ASSERCAO E5: % turno(s) orfao(s) (jobs.company_id sem companies). HALT -> architect.', v_n;
    END IF;

    -- MODO AVISO (nao bloqueia): pessoas que operam 2+ companies. Para elas my_link_risk_config() sem
    -- parametro passa a devolver company_required. Conta dono (owner_id/id), membro ativo e operador de
    -- organizacao.
    SELECT count(*) INTO v_n FROM (
        SELECT t.uid FROM (
            SELECT COALESCE(c.owner_id, c.id) AS uid, c.id AS cid FROM public.companies c
            UNION
            SELECT cm.user_id, cm.company_id FROM public.company_members cm
             WHERE cm.status = 'active' AND cm.role IN ('manager', 'encarregado') AND cm.user_id IS NOT NULL
            UNION
            SELECT om.user_id, c2.id FROM public.organization_members om
              JOIN public.companies c2 ON c2.organization_id = om.organization_id
             WHERE om.status = 'active' AND om.role IN ('owner', 'operator') AND om.user_id IS NOT NULL
        ) t GROUP BY t.uid HAVING count(DISTINCT t.cid) > 1
    ) x;
    IF v_n > 0 THEN
        RAISE WARNING 'E5 (aviso): % pessoa(s) operam 2+ companies; my_link_risk_config() sem parametro devolve company_required para elas ate o frontend passar a empresa corrente.', v_n;
    ELSE
        RAISE NOTICE 'E5: nenhuma pessoa opera 2+ companies hoje (medido, nao presumido).';
    END IF;

    -- get_my_companies precisa ser a versao de E4 (colunas confirmed/team_enabled): my_link_risk_config
    -- decide "opero exatamente uma company" por ela.
    IF position('confirmed' IN pg_get_function_result('public.get_my_companies()'::regprocedure)) = 0 THEN
        RAISE EXCEPTION 'ASSERCAO E5: get_my_companies nao e a versao de E4 (sem coluna confirmed). HALT.';
    END IF;

    -- (b) colunas de que as RPCs dependem (jobs/applications/shift_calls tem DDL fora do repo)
    SELECT count(*) INTO v_n FROM information_schema.columns
     WHERE table_schema = 'public'
       AND (table_name, column_name) IN (
            ('jobs', 'start_date'), ('jobs', 'work_start_time'), ('jobs', 'work_end_time'),
            ('jobs', 'slots'), ('jobs', 'title'), ('jobs', 'responsible_id'), ('jobs', 'tag_id'),
            ('applications', 'worker_checkin_at'), ('applications', 'company_checkin_confirmed_at'),
            ('applications', 'company_checkout_confirmed_at'),
            ('shift_calls', 'closed_at'), ('shift_calls', 'expires_at'), ('shift_calls', 'origin'),
            ('shift_call_targets', 'response'), ('shift_call_targets', 'responded_at'),
            ('shift_call_targets', 'origin'), ('shift_call_targets', 'worker_id'),
            ('companies', 'link_risk_alert_enabled'), ('companies', 'link_risk_alert_threshold'));
    IF v_n <> 19 THEN
        RAISE EXCEPTION 'ASSERCAO E5: % de 19 colunas esperadas existem (jobs/applications/shift_calls/targets/companies). HALT.', v_n;
    END IF;

    -- (c) jobs_responsible_guard: ou ja editado, ou com a linha esperada (exatamente 1)
    v_def := pg_get_functiondef('public.jobs_responsible_guard()'::regprocedure);
    IF position('app.job_reassign' IN v_def) = 0 THEN
        v_n := (length(v_def) - length(replace(v_def, 'IF NOT v_is_insert AND (v_moved OR v_resp_changed) THEN', '')))
               / length('IF NOT v_is_insert AND (v_moved OR v_resp_changed) THEN');
        IF v_n <> 1 THEN
            RAISE EXCEPTION 'ASSERCAO E5(guard): % ocorrencia(s) da condicao do ramo encarregado em jobs_responsible_guard (esperado 1). Funcao mudou -- HALT.', v_n;
        END IF;
    END IF;

    -- (d) my_link_risk_config: a antiga (sem parametro) ou a nova (reaplicacao); nenhum dependente por pg_depend
    IF to_regprocedure('public.my_link_risk_config()') IS NOT NULL THEN
        SELECT string_agg(pg_describe_object(d.classid, d.objid, d.objsubid), ', ') INTO v_dep
          FROM pg_depend d
         WHERE d.refclassid = 'pg_proc'::regclass
           AND d.refobjid   = 'public.my_link_risk_config()'::regprocedure
           AND d.deptype    = 'n';
        IF v_dep IS NOT NULL THEN
            RAISE EXCEPTION 'ASSERCAO E5: objetos dependem de my_link_risk_config() por pg_depend: %. DROP quebraria. HALT.', v_dep;
        END IF;
    END IF;

    -- (e) as tres funcoes de aviso: ou ja roteadas, ou com o bloco/INSERT antigo exatamente 1 vez
    FOR r IN SELECT unnest(ARRAY[
        'public.claim_shift_slot(uuid)',
        'public.decline_shift_call(uuid)',
        'public.respond_attendance_confirmation(uuid, text)'
    ]) AS sig
    LOOP
        v_def := pg_get_functiondef(r.sig::regprocedure);
        IF position('notification_recipients_for_job' IN v_def) = 0 THEN
            SELECT count(*) INTO v_n FROM regexp_matches(v_def,
                'SELECT c[.]owner_id INTO v_company_user[[:space:]]+FROM public[.]companies c WHERE c[.]id = [a-z_.]+;[[:space:]]+IF v_company_user IS NULL THEN[[:space:]]+v_company_user := [a-z_.]+;[[:space:]]+END IF;', 'g');
            IF v_n <> 1 THEN
                RAISE EXCEPTION 'ASSERCAO E5(aviso): % ocorrencia(s) do bloco owner_id -> v_company_user em % (esperado 1). Funcao mudou -- HALT.', v_n, r.sig;
            END IF;
        END IF;
    END LOOP;
END
$mig$;

-- ============================================================================
-- 1. jobs_responsible_guard — encarregado passa o PROPRIO turno (ver cabecalho)
-- ============================================================================
DO $mig$
DECLARE
    v_def   text;
    v_old   text := 'IF NOT v_is_insert AND (v_moved OR v_resp_changed) THEN';
    -- CASE: ordem de avaliacao garantida (OLD nao existe em INSERT; AND nao garante curto-circuito).
    v_new   text := 'IF (CASE WHEN v_is_insert THEN false ELSE (v_moved OR (v_resp_changed AND COALESCE(current_setting(''app.job_reassign'', true), '''') <> NEW.id::text)) END) THEN';
    v_novo  text;
BEGIN
    v_def := pg_get_functiondef('public.jobs_responsible_guard()'::regprocedure);
    IF position('app.job_reassign' IN v_def) > 0 THEN
        RAISE NOTICE 'E5: jobs_responsible_guard ja editado; nada a fazer.';
        RETURN;
    END IF;
    v_novo := replace(v_def, v_old, v_new);
    IF v_novo = v_def OR position(v_new IN v_novo) = 0 THEN
        RAISE EXCEPTION 'ASSERCAO E5(guard): a substituicao nao produziu a condicao nova. HALT.';
    END IF;
    EXECUTE v_novo;
END
$mig$;

COMMENT ON FUNCTION public.jobs_responsible_guard() IS
    'BEFORE INSERT / UPDATE OF (company_id, responsible_id, series_id, tag_id) em jobs. Preenche '
    'responsible_id com o criador quando ele opera a empresa; valida operador ativo e confirmado so '
    'quando o valor muda; tag da mesma empresa e nao arquivada. Encarregado NUNCA troca company_id/'
    'series_id e so troca responsible_id enquanto reassign_job_responsible sinaliza a GUC LOCAL '
    'app.job_reassign = id do turno (ADR troca-de-responsavel-so-pela-rpc; PATCH direto e recusado). '
    'Sessao nula (cron/service_role) passa. '
    'Nao toca saldo (Article 8). R3 / G5 de equipe-encarregados.';

-- ============================================================================
-- 2. internal_member_label — nome que o Gestor deu a pessoa (rotulo de aviso/relatorio)
--    Aceita uid de terceiro => SEM EXECUTE para authenticated/anon (so funcoes DEFINER do schema).
--    Inclui 'removed' (rastro "ex-{nome}"); anonymize_account anula display_name.
-- ============================================================================
CREATE OR REPLACE FUNCTION public.internal_member_label(p_company_id uuid, p_user_id uuid)
RETURNS text
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $fn$
    SELECT NULLIF(btrim(cm.display_name), '')
      FROM public.company_members cm
     WHERE cm.company_id = p_company_id
       AND cm.user_id    = p_user_id
       AND cm.role       IN ('manager', 'encarregado')
       AND cm.status     IN ('active', 'removed')
     ORDER BY (cm.status = 'active') DESC, cm.id
     LIMIT 1;
$fn$;

COMMENT ON FUNCTION public.internal_member_label(uuid, uuid) IS
    'INTERNA. display_name da pessoa na equipe (ativa de preferencia; removida mantem o rotulo do '
    'rastro) ou NULL. Aceita uid de terceiro, por isso SEM EXECUTE para authenticated/anon: so as RPCs '
    'DEFINER de E5 a chamam, para montar texto de aviso e o relatorio Gestor-only.';

REVOKE ALL ON FUNCTION public.internal_member_label(uuid, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.internal_member_label(uuid, uuid) TO service_role;

-- ============================================================================
-- 3. get_busy_workers (R14, A5, A6) — conflito de freela na COMPANY inteira
--    Ocupado = candidatura hired|in_progress|invited em turno que se sobrepoe a janela, OU alvo
--    pendente (response NULL) de chamado ABERTO e nao vencido de turno que se sobrepoe. Vale para
--    qualquer responsavel. Retorno: SO worker_id (nada de turno, titulo, responsavel ou motivo).
--    Sem oraculo (A6): so considera ids com team_connections ACEITA na company; um id fora do Elenco
--    nao volta nem como ocupado nem como livre. Exige membro confirmado (is_company_member_confirmed).
--    So conta turnos DA company pedida (nunca cross-company).
-- ============================================================================
CREATE OR REPLACE FUNCTION public.get_busy_workers(
    p_company_id     uuid,
    p_start          timestamptz,
    p_end            timestamptz,
    p_worker_ids     uuid[],
    p_exclude_job_id uuid DEFAULT NULL
)
RETURNS TABLE (worker_id uuid)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $fn$
#variable_conflict use_column
BEGIN
    IF (SELECT auth.uid()) IS NULL THEN
        RAISE EXCEPTION 'unauthenticated' USING ERRCODE = '42501', DETAIL = 'outcome=unauthenticated';
    END IF;
    IF p_company_id IS NULL OR NOT public.is_company_member_confirmed(p_company_id) THEN
        RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501', DETAIL = 'outcome=forbidden';
    END IF;
    IF p_start IS NULL OR p_end IS NULL OR p_end <= p_start THEN
        RAISE EXCEPTION 'invalid_input' USING ERRCODE = '22023', DETAIL = 'outcome=invalid_input';
    END IF;
    IF p_worker_ids IS NULL OR cardinality(p_worker_ids) = 0 THEN
        RETURN;
    END IF;
    IF cardinality(p_worker_ids) > 200 THEN
        RAISE EXCEPTION 'invalid_input' USING ERRCODE = '22023', DETAIL = 'outcome=invalid_input';
    END IF;

    RETURN QUERY
    WITH elenco AS (
        SELECT DISTINCT tc.worker_id AS wid
          FROM public.team_connections tc
         WHERE tc.company_id = p_company_id
           AND tc.status     = 'accepted'
           AND tc.worker_id  = ANY (p_worker_ids)
    ),
    turnos AS (
        SELECT j.id AS job_id,
               tstzrange(w.ini, w.fim, '[)') AS janela
          FROM public.jobs j
          CROSS JOIN LATERAL (
                SELECT (j.start_date AT TIME ZONE 'America/Sao_Paulo')::date AS d
          ) dd
          CROSS JOIN LATERAL (
                SELECT
                    CASE WHEN (CASE WHEN j.work_start_time ~ '^([01]?[0-9]|2[0-3]):[0-5][0-9](:[0-5][0-9])?$' THEN j.work_start_time::time END) IS NULL
                         THEN (dd.d::timestamp AT TIME ZONE 'America/Sao_Paulo')
                         ELSE ((dd.d + (CASE WHEN j.work_start_time ~ '^([01]?[0-9]|2[0-3]):[0-5][0-9](:[0-5][0-9])?$' THEN j.work_start_time::time END)) AT TIME ZONE 'America/Sao_Paulo')
                    END AS ini,
                    CASE WHEN (CASE WHEN j.work_start_time ~ '^([01]?[0-9]|2[0-3]):[0-5][0-9](:[0-5][0-9])?$' THEN j.work_start_time::time END) IS NULL OR (CASE WHEN j.work_end_time ~ '^([01]?[0-9]|2[0-3]):[0-5][0-9](:[0-5][0-9])?$' THEN j.work_end_time::time END) IS NULL
                         THEN (((dd.d + 1)::timestamp) AT TIME ZONE 'America/Sao_Paulo')
                         WHEN (CASE WHEN j.work_end_time ~ '^([01]?[0-9]|2[0-3]):[0-5][0-9](:[0-5][0-9])?$' THEN j.work_end_time::time END) > (CASE WHEN j.work_start_time ~ '^([01]?[0-9]|2[0-3]):[0-5][0-9](:[0-5][0-9])?$' THEN j.work_start_time::time END)
                         THEN ((dd.d + (CASE WHEN j.work_end_time ~ '^([01]?[0-9]|2[0-3]):[0-5][0-9](:[0-5][0-9])?$' THEN j.work_end_time::time END)) AT TIME ZONE 'America/Sao_Paulo')
                         ELSE (((dd.d + 1) + (CASE WHEN j.work_end_time ~ '^([01]?[0-9]|2[0-3]):[0-5][0-9](:[0-5][0-9])?$' THEN j.work_end_time::time END)) AT TIME ZONE 'America/Sao_Paulo')
                    END AS fim
          ) w
         WHERE j.company_id = p_company_id
           AND j.start_date IS NOT NULL
           AND COALESCE(j.status, '') <> 'deleted'
           AND (p_exclude_job_id IS NULL OR j.id <> p_exclude_job_id)
    ),
    ocupados AS (
        SELECT a.worker_id AS wid
          FROM public.applications a
          JOIN turnos t ON t.job_id = a.job_id
         WHERE a.worker_id IN (SELECT e.wid FROM elenco e)
           AND a.status IN ('hired', 'in_progress', 'invited')
           AND t.janela && tstzrange(p_start, p_end, '[)')
        UNION
        SELECT tg.worker_id AS wid
          FROM public.shift_call_targets tg
          JOIN public.shift_calls sc ON sc.id = tg.call_id
          JOIN turnos t ON t.job_id = sc.job_id
         WHERE tg.worker_id IN (SELECT e.wid FROM elenco e)
           AND tg.response IS NULL
           AND sc.status = 'open'
           AND sc.expires_at > now()
           AND t.janela && tstzrange(p_start, p_end, '[)')
    )
    SELECT o.wid FROM ocupados o;
END;
$fn$;

COMMENT ON FUNCTION public.get_busy_workers(uuid, timestamptz, timestamptz, uuid[], uuid) IS
    'Quais freelas do Elenco ACEITO da company ja estao ocupados na janela [p_start, p_end), em turno '
    'de QUALQUER responsavel da mesma company (R14). Ocupado = candidatura hired|in_progress|invited, '
    'ou alvo pendente de chamado aberto e nao vencido. Retorna TABLE(worker_id) e NADA mais (sem turno, '
    'titulo, responsavel, motivo: A5); id fora do Elenco aceito nao volta (A6, sem oraculo). Exige '
    'is_company_member_confirmed: quem nao pode saber recebe ERRO 42501, nunca zero linhas (falso "livre"). '
    'Janela do turno = data local de start_date + work_start_time..work_end_time (cruza meia-noite); sem '
    'horario = dia local inteiro. p_exclude_job_id tira o proprio turno. So avisa — nunca bloqueia.';

-- ============================================================================
-- 4. "Passar para..." e "Cobrir X de A a B" (R18, A14, A15)
-- ============================================================================

-- 4.1 reassign_job_responsible(p_job_ids, p_to) -> {outcome, moved, skipped}
--     Gestor passa qualquer turno da company que opera; encarregado confirmado passa SO os proprios
--     (responsible_id = ele; cobertura nao da direito de passar). Destino = operador ativo e confirmado
--     da company do turno. Turno inexistente, deletado, alheio ou sem direito = skipped (sem distinguir:
--     nao e oraculo). Idempotente (ja e do destino = skipped). UPDATE otimista por (id, responsible_id
--     lido) — sem lock em turno que o chamador nao opera.
CREATE OR REPLACE FUNCTION public.reassign_job_responsible(p_job_ids uuid[], p_to uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $fn$
DECLARE
    v_uid      uuid := (SELECT auth.uid());
    v_ids      uuid[];
    v_total    integer;
    v_moved    integer := 0;
    v_rows     integer;
    v_can      boolean;
    v_origins  uuid[] := ARRAY[]::uuid[];
    v_company1 uuid;
    v_to_name  text;
    v_cur_resp   uuid;
    v_cur_status text;
    v_cur_start  timestamptz;
    v_today      date := (now() AT TIME ZONE 'America/Sao_Paulo')::date;
    v_past       integer := 0;
    v_is_gestor  boolean;
    v_enc_moves  uuid[] := ARRAY[]::uuid[];   -- company_id de cada turno passado por quem NAO e Gestor
    g            record;
    r          record;
    o          record;
BEGIN
    IF v_uid IS NULL THEN
        RETURN jsonb_build_object('outcome', 'unauthenticated');
    END IF;
    IF p_to IS NULL OR p_job_ids IS NULL THEN
        RETURN jsonb_build_object('outcome', 'invalid_input');
    END IF;

    SELECT COALESCE(array_agg(DISTINCT x), ARRAY[]::uuid[]) INTO v_ids
      FROM unnest(p_job_ids) AS x WHERE x IS NOT NULL;
    v_total := cardinality(v_ids);
    IF v_total = 0 OR v_total > 100 THEN
        RETURN jsonb_build_object('outcome', 'invalid_input');
    END IF;

    FOR r IN
        SELECT j.id, j.company_id, j.responsible_id, j.status, j.start_date
          FROM public.jobs j
         WHERE j.id = ANY (v_ids)
         ORDER BY j.id
    LOOP
        CONTINUE WHEN COALESCE(r.status, '') = 'deleted';
        CONTINUE WHEN r.responsible_id IS NOT DISTINCT FROM p_to;

        v_can := COALESCE(
                    public.is_company_owner(r.company_id)
                    OR ( public.session_company_member_role(r.company_id) = 'encarregado'
                         AND public.session_company_member_confirmed(r.company_id)
                         AND r.responsible_id = v_uid ),
                    false);
        CONTINUE WHEN NOT v_can;
        CONTINUE WHEN NOT public.internal_company_confirmed_operator(r.company_id, p_to);

        -- M2: quem NAO e Gestor nao passa turno antigo (data local < hoje - 1): daria ao colega acesso a
        -- turnos/pagamentos concluidos, contornando o bloqueio de cobertura retroativa. So conta como
        -- `skipped_past` DEPOIS de v_can (turno alheio continua indistinguivel). Revalidado sob o lock.
        v_is_gestor := public.is_company_owner(r.company_id);
        IF NOT v_is_gestor AND (r.start_date AT TIME ZONE 'America/Sao_Paulo')::date < v_today - 1 THEN
            v_past := v_past + 1;
            CONTINUE;
        END IF;

        -- M-2: trava a linha so DEPOIS de autorizar (quem nao opera o turno nao o trava) e REAVALIA a
        -- autorizacao sobre o valor travado (outra sessao pode ter passado/cancelado o turno no meio).
        SELECT j.responsible_id, j.status, j.start_date INTO v_cur_resp, v_cur_status, v_cur_start
          FROM public.jobs j WHERE j.id = r.id FOR UPDATE;
        CONTINUE WHEN NOT FOUND OR COALESCE(v_cur_status, '') = 'deleted' OR v_cur_resp IS NOT DISTINCT FROM p_to;
        v_can := COALESCE(
                    public.is_company_owner(r.company_id)
                    OR ( public.session_company_member_role(r.company_id) = 'encarregado'
                         AND public.session_company_member_confirmed(r.company_id)
                         AND v_cur_resp = v_uid ),
                    false);
        CONTINUE WHEN NOT v_can;
        v_is_gestor := public.is_company_owner(r.company_id);
        IF NOT v_is_gestor AND (v_cur_start AT TIME ZONE 'America/Sao_Paulo')::date < v_today - 1 THEN
            v_past := v_past + 1;
            CONTINUE;
        END IF;

        -- Sinal ao guard de jobs (ADR troca-de-responsavel-so-pela-rpc): GUC LOCAL = id deste turno, zerada
        -- logo apos o UPDATE (antes de qualquer CONTINUE). O texto vem SEMPRE de r.id (nunca do chamador).
        PERFORM set_config('app.job_reassign', r.id::text, true);
        UPDATE public.jobs
           SET responsible_id = p_to
         WHERE id = r.id
           AND responsible_id IS NOT DISTINCT FROM v_cur_resp;
        GET DIAGNOSTICS v_rows = ROW_COUNT;
        PERFORM set_config('app.job_reassign', '', true);
        CONTINUE WHEN v_rows <> 1;

        v_moved := v_moved + 1;
        IF NOT v_is_gestor THEN
            v_enc_moves := v_enc_moves || r.company_id;
        END IF;
        IF v_company1 IS NULL THEN
            v_company1 := r.company_id;
        END IF;
        IF v_cur_resp IS NOT NULL
           AND public.internal_company_confirmed_operator(r.company_id, v_cur_resp) THEN
            v_origins := v_origins || v_cur_resp;
        END IF;
    END LOOP;

    IF v_moved > 0 THEN
        v_to_name := COALESCE(public.internal_member_label(v_company1, p_to), 'o Gestor');

        -- destino (nao avisa a si mesmo: o Gestor que assume o turno ja sabe)
        IF p_to <> v_uid THEN
            PERFORM public.internal_notify_member_event(
                p_to,
                CASE WHEN v_moved = 1 THEN 'Turno passado para você' ELSE 'Turnos passados para você' END,
                CASE WHEN v_moved = 1 THEN 'Um turno foi passado para você. Veja em Hoje.'
                     ELSE v_moved::text || ' turnos foram passados para você. Veja em Hoje.' END,
                '/company/hoje');
        END IF;

        -- origem: cada responsavel anterior (inclusive quem passou: fica o registro do gesto)
        FOR o IN SELECT x AS uid, count(*)::integer AS n
                   FROM unnest(v_origins) AS x
                  WHERE x <> p_to
                  GROUP BY x
        LOOP
            PERFORM public.internal_notify_member_event(
                o.uid,
                CASE WHEN o.n = 1 THEN 'Turno passado' ELSE 'Turnos passados' END,
                CASE WHEN o.uid = v_uid
                     THEN 'Você passou ' || CASE WHEN o.n = 1 THEN 'um turno' ELSE o.n::text || ' turnos' END
                          || ' para ' || v_to_name || '.'
                     ELSE CASE WHEN o.n = 1 THEN 'Um turno seu foi passado' ELSE o.n::text || ' turnos seus foram passados' END
                          || ' para ' || v_to_name || '.'
                END,
                '/company/hoje');
        END LOOP;
    END IF;

    -- M2: turnos passados por encarregado => os Gestores ficam sabendo (uma notificacao por Gestor e
    -- company, com a contagem; quem agiu e o destino, ja avisados, ficam de fora).
    -- L7: o texto guarda NOMES (de quem passou e de quem recebeu) na caixa dos Gestores.
    FOR o IN SELECT x AS cid, count(*)::integer AS n FROM unnest(v_enc_moves) AS x GROUP BY x
    LOOP
        FOR g IN SELECT gi AS uid FROM public.internal_company_gestor_ids(o.cid) AS gi
                  WHERE gi NOT IN (v_uid, p_to)
        LOOP
            PERFORM public.internal_notify_member_event(
                g.uid, 'Turnos passados na equipe',
                COALESCE(public.internal_member_label(o.cid, v_uid), 'Um encarregado') || ' passou '
                    || CASE WHEN o.n = 1 THEN 'um turno' ELSE o.n::text || ' turnos' END
                    || ' para ' || COALESCE(public.internal_member_label(o.cid, p_to), 'o Gestor') || '.',
                '/company/hoje');
        END LOOP;
    END LOOP;

    RETURN jsonb_build_object(
        'outcome',      CASE WHEN v_moved > 0 THEN 'ok' ELSE 'nothing_moved' END,
        'moved',        v_moved,
        'skipped',      v_total - v_moved,
        'skipped_past', v_past       -- subconjunto de skipped: turno antigo, bloqueado a quem nao e Gestor
    );
END;
$fn$;

COMMENT ON FUNCTION public.reassign_job_responsible(uuid[], uuid) IS
    '"Passar para..." (R18/A14): troca jobs.responsible_id de 1..100 turnos em transacao unica. Gestor: '
    'qualquer turno da company que opera. Encarregado confirmado: so os PROPRIOS (responsible_id = ele; '
    'cobertura nao da direito). Destino: operador ativo e confirmado da company do turno. Devolve '
    '{outcome: ok|nothing_moved|invalid_input|unauthenticated, moved, skipped, skipped_past}. Quem NAO e '
    'Gestor nao passa turno com data local anterior a hoje - 1 (skipped_past, revalidado sob lock); passagem '
    'por encarregado avisa os Gestores (o aviso guarda nomes nas caixas deles). skipped agrega turno '
    'inexistente/deletado/alheio/sem direito/ja do destino (sem oraculo). Avisa destino e origem(ns) '
    '(uma notificacao por pessoa, com a contagem). Nao reescreve nada alem de jobs.responsible_id. '
    'Nao move saldo (Article 8).';

-- 4.2 create_responsibility_coverage — "Cobrir X de A a B": janela por DATA, fim automatico, sem cron.
--     Gestor cobre qualquer `from`; encarregado confirmado so com from = ele. from e to PRECISAM ser
--     encarregados ativos e confirmados (cobertura de Gestor/dono e inerte no seam — M1 de E2).
CREATE OR REPLACE FUNCTION public.create_responsibility_coverage(
    p_company_id uuid,
    p_from       uuid,
    p_to         uuid,
    p_starts_on  date,
    p_ends_on    date
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $fn$
DECLARE
    v_uid     uuid := (SELECT auth.uid());
    v_today   date := (now() AT TIME ZONE 'America/Sao_Paulo')::date;
    v_id      uuid;
    v_gestor  boolean;
    v_self    boolean;
    v_from_nm text;
    v_to_nm   text;
    v_period  text;
    v_ex_start date;
    v_ex_end   date;
    g          record;
BEGIN
    IF v_uid IS NULL THEN
        RETURN jsonb_build_object('outcome', 'unauthenticated');
    END IF;
    IF p_company_id IS NULL OR p_from IS NULL OR p_to IS NULL OR p_starts_on IS NULL OR p_ends_on IS NULL
       OR p_from = p_to THEN
        RETURN jsonb_build_object('outcome', 'invalid_input');
    END IF;

    v_gestor := public.is_company_owner(p_company_id);
    v_self   := COALESCE(
                    public.session_company_member_role(p_company_id) = 'encarregado'
                    AND public.session_company_member_confirmed(p_company_id)
                    AND p_from = v_uid, false);
    IF NOT (v_gestor OR v_self) THEN
        RETURN jsonb_build_object('outcome', 'forbidden');
    END IF;

    -- L4: MESMA chave de lock das mudancas de equipe da E4 (remove_company_member / revoke_company_manager /
    -- convite). Sem isto uma remocao concorrente revogaria as coberturas ANTES de esta nascer (cobertura
    -- orfa). Tambem serializa criacoes concorrentes (overlaps). Tomado so depois de autorizar; a
    -- autorizacao e REAVALIADA sob o lock, e as checagens de from/to abaixo ja rodam sob ele.
    PERFORM pg_advisory_xact_lock(hashtext('worki:team:' || p_company_id::text)::bigint);
    v_gestor := public.is_company_owner(p_company_id);
    v_self   := COALESCE(
                    public.session_company_member_role(p_company_id) = 'encarregado'
                    AND public.session_company_member_confirmed(p_company_id)
                    AND p_from = v_uid, false);
    IF NOT (v_gestor OR v_self) THEN
        RETURN jsonb_build_object('outcome', 'forbidden');
    END IF;

    IF p_ends_on < p_starts_on THEN
        RETURN jsonb_build_object('outcome', 'invalid_window');
    END IF;
    IF (p_ends_on - p_starts_on) + 1 > 60 THEN
        RETURN jsonb_build_object('outcome', 'window_too_long', 'max_days', 60);
    END IF;
    IF p_ends_on < v_today THEN
        RETURN jsonb_build_object('outcome', 'in_the_past');
    END IF;
    -- Sem cobertura RETROATIVA: starts_on no passado daria acesso a turnos, pagamentos e recibos ja
    -- concluidos. Tolerancia de 1 dia (data local) so para o turno que cruza a meia-noite.
    IF p_starts_on < v_today - 1 THEN
        RETURN jsonb_build_object('outcome', 'starts_in_the_past');
    END IF;
    IF p_starts_on > v_today + 365 THEN
        RETURN jsonb_build_object('outcome', 'too_far');
    END IF;

    -- L-2: quem tambem e Gestor/dono/operador de organizacao nao tem o que ser coberto (cobertura inerte
    -- e enganosa): recusa mesmo que exista linha de encarregado.
    IF EXISTS (SELECT 1 FROM public.internal_company_gestor_ids(p_company_id) AS gi WHERE gi = p_from) THEN
        RETURN jsonb_build_object('outcome', 'from_is_gestor');
    END IF;

    -- from e to: encarregado ATIVO E CONFIRMADO desta company (a leitura de company_members declara o papel)
    IF NOT EXISTS (SELECT 1 FROM public.company_members cm
                    WHERE cm.company_id = p_company_id AND cm.user_id = p_from
                      AND cm.role = 'encarregado' AND cm.status = 'active' AND cm.confirmed_at IS NOT NULL) THEN
        RETURN jsonb_build_object('outcome', 'from_not_encarregado');
    END IF;
    IF NOT EXISTS (SELECT 1 FROM public.company_members cm
                    WHERE cm.company_id = p_company_id AND cm.user_id = p_to
                      AND cm.role = 'encarregado' AND cm.status = 'active' AND cm.confirmed_at IS NOT NULL) THEN
        RETURN jsonb_build_object('outcome', 'to_not_encarregado');
    END IF;

    -- janela que sobrepoe cobertura vigente do MESMO par: se a vigente ja cobre tudo = already_covered;
    -- senao `overlaps` com a janela existente (nada e criado nem estendido em silencio).
    SELECT rc.id, rc.starts_on, rc.ends_on INTO v_id, v_ex_start, v_ex_end
      FROM public.responsibility_coverages rc
     WHERE rc.company_id   = p_company_id
       AND rc.from_user_id = p_from
       AND rc.to_user_id   = p_to
       AND rc.revoked_at IS NULL
       AND rc.starts_on <= p_ends_on AND rc.ends_on >= p_starts_on
     ORDER BY rc.starts_on
     LIMIT 1;
    IF v_id IS NOT NULL THEN
        IF v_ex_start <= p_starts_on AND v_ex_end >= p_ends_on THEN
            RETURN jsonb_build_object('outcome', 'already_covered', 'coverage_id', v_id);
        END IF;
        RETURN jsonb_build_object('outcome', 'overlaps', 'coverage_id', v_id,
                                  'existing_starts_on', v_ex_start, 'existing_ends_on', v_ex_end);
    END IF;

    INSERT INTO public.responsibility_coverages
        (company_id, from_user_id, to_user_id, starts_on, ends_on, created_by)
    VALUES
        (p_company_id, p_from, p_to, p_starts_on, p_ends_on, v_uid)
    RETURNING id INTO v_id;

    v_from_nm := COALESCE(public.internal_member_label(p_company_id, p_from), 'um colega');
    v_to_nm   := COALESCE(public.internal_member_label(p_company_id, p_to),   'um colega');
    v_period  := CASE WHEN p_starts_on = p_ends_on
                      THEN 'em ' || to_char(p_starts_on, 'DD/MM')
                      ELSE 'de ' || to_char(p_starts_on, 'DD/MM') || ' a ' || to_char(p_ends_on, 'DD/MM') END;

    PERFORM public.internal_notify_member_event(
        p_to, 'Você vai cobrir turnos',
        'Você vai cobrir os turnos de ' || v_from_nm || ' ' || v_period || '. Eles aparecem em Hoje nesses dias.',
        '/company/hoje');
    PERFORM public.internal_notify_member_event(
        p_from, 'Seus turnos terão cobertura',
        v_to_nm || ' vai cobrir seus turnos ' || v_period || '. O responsável registrado continua sendo você.',
        '/company/hoje');

    -- Criada por ENCARREGADO (abre acesso a um colega sem passar pelo Gestor): os Gestores ficam sabendo.
    -- L7: o texto do aviso guarda os NOMES (from e to) nas caixas dos Gestores; anonymize_account nao
    -- reescreve notificacoes ja entregues a terceiros.
    IF NOT v_gestor THEN
        FOR g IN SELECT gi AS uid FROM public.internal_company_gestor_ids(p_company_id) AS gi
                  WHERE gi NOT IN (v_uid, p_from, p_to)
        LOOP
            PERFORM public.internal_notify_member_event(
                g.uid, 'Cobertura criada na equipe',
                v_to_nm || ' vai cobrir os turnos de ' || v_from_nm || ' ' || v_period || '.',
                '/company/hoje');
        END LOOP;
    END IF;

    RETURN jsonb_build_object('outcome', 'created', 'coverage_id', v_id);
END;
$fn$;

COMMENT ON FUNCTION public.create_responsibility_coverage(uuid, uuid, uuid, date, date) IS
    '"Cobrir X de A a B" (R18/A15): to_user opera os turnos de from_user entre starts_on e ends_on '
    '(datas locais America/Sao_Paulo, janela maxima 60 dias). FIM AUTOMATICO = a janela, avaliada no '
    'predicado de session_can_operate_job: sem cron, nada a reverter; jobs.responsible_id NAO muda. '
    'Gestor cobre qualquer from; encarregado confirmado so com from = ele. from e to precisam ser '
    'encarregados ativos e confirmados (cobertura de Gestor/dono e inerte). Avisa os dois. '
    'Sem retroatividade: starts_on >= hoje - 1. Criada por encarregado, avisa tambem os Gestores. '
    'Outcomes: created|already_covered|overlaps|starts_in_the_past|from_is_gestor|invalid_input|invalid_window|window_too_long|in_the_past|too_far|'
    'from_not_encarregado|to_not_encarregado|forbidden|unauthenticated.';

-- 4.3 end_responsibility_coverage — encerrar antes da janela
CREATE OR REPLACE FUNCTION public.end_responsibility_coverage(p_coverage_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $fn$
DECLARE
    v_uid uuid := (SELECT auth.uid());
    v_rc  public.responsibility_coverages%ROWTYPE;
BEGIN
    IF v_uid IS NULL THEN
        RETURN jsonb_build_object('outcome', 'unauthenticated');
    END IF;
    IF p_coverage_id IS NULL THEN
        RETURN jsonb_build_object('outcome', 'invalid_input');
    END IF;

    SELECT * INTO v_rc FROM public.responsibility_coverages WHERE id = p_coverage_id;
    IF NOT FOUND THEN
        RETURN jsonb_build_object('outcome', 'not_found');
    END IF;

    IF NOT ( public.is_company_owner(v_rc.company_id)
             OR ( public.session_company_member_confirmed(v_rc.company_id)
                  AND v_uid IN (v_rc.from_user_id, v_rc.to_user_id) ) ) THEN
        RETURN jsonb_build_object('outcome', 'forbidden');
    END IF;

    -- L-3: so trava DEPOIS de autorizar; relê o estado sob o lock
    SELECT rc.revoked_at INTO v_rc.revoked_at
      FROM public.responsibility_coverages rc WHERE rc.id = p_coverage_id FOR UPDATE;
    IF v_rc.revoked_at IS NOT NULL THEN
        RETURN jsonb_build_object('outcome', 'already_ended');
    END IF;

    UPDATE public.responsibility_coverages SET revoked_at = now() WHERE id = p_coverage_id;

    IF v_rc.from_user_id <> v_uid THEN
        PERFORM public.internal_notify_member_event(
            v_rc.from_user_id, 'Cobertura encerrada',
            'A cobertura dos seus turnos foi encerrada antes do fim.', '/company/hoje');
    END IF;
    IF v_rc.to_user_id <> v_uid THEN
        PERFORM public.internal_notify_member_event(
            v_rc.to_user_id, 'Cobertura encerrada',
            'Você não cobre mais os turnos que estavam na sua cobertura.', '/company/hoje');
    END IF;

    RETURN jsonb_build_object('outcome', 'ended');
END;
$fn$;

COMMENT ON FUNCTION public.end_responsibility_coverage(uuid) IS
    'Encerra uma cobertura antes do fim da janela (revoked_at = now(); nunca DELETE). Gestor, ou quem '
    'esta na cobertura (from/to) enquanto confirmado. Avisa a outra parte. Outcomes: ended|already_ended|'
    'not_found|forbidden|invalid_input|unauthenticated.';

-- ============================================================================
-- 4b. job_cancellations (L-4) — trilha persistente de QUEM cancelou o turno e por que
--     Sem FK (nao entra na lista de dependentes de companies da guarda da casca vazia de E4) e sem
--     DELETE. Escrita SO por cancel_job (DEFINER); leitura so Gestor. LGPD: cancelled_by e uuid
--     pseudonimo RETIDO (mesma regua de company_tags.created_by); reason e texto livre <= 200 chars
--     escrito pela empresa — nao coletar dado de saude/pessoal na copy da UI.
-- ============================================================================
CREATE TABLE IF NOT EXISTS public.job_cancellations (
    id                     uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
    job_id                 uuid        NOT NULL,
    company_id             uuid        NOT NULL,
    cancelled_by           uuid        NOT NULL,
    reason                 text        CHECK (reason IS NULL OR length(reason) <= 200),
    cancelled_applications integer     NOT NULL DEFAULT 0,
    cancelled_calls        integer     NOT NULL DEFAULT 0,
    closed_candidates      integer     NOT NULL DEFAULT 0,
    cancelled_at           timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_job_cancellations_job ON public.job_cancellations (job_id);
CREATE INDEX IF NOT EXISTS idx_job_cancellations_company ON public.job_cancellations (company_id, cancelled_at DESC);

COMMENT ON TABLE public.job_cancellations IS
    'Auditoria de cancel_job (R27/L-4): quem (cancelled_by, uuid pseudonimo retido), por que (reason, '
    'texto livre <= 200) e quanto (contagens). Sem FK, sem DELETE, sem policy de escrita: so cancel_job '
    '(DEFINER) insere. Leitura: Gestor da company. Nao toca saldo (Article 8).';

REVOKE ALL ON public.job_cancellations FROM anon, authenticated, service_role;
GRANT SELECT ON public.job_cancellations TO authenticated;
GRANT SELECT, INSERT ON public.job_cancellations TO service_role;

DROP POLICY IF EXISTS "job_cancellations_select_gestor" ON public.job_cancellations;
CREATE POLICY "job_cancellations_select_gestor" ON public.job_cancellations
    FOR SELECT TO authenticated
    USING (public.is_company_owner(company_id));

ALTER TABLE public.job_cancellations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.job_cancellations NO FORCE ROW LEVEL SECURITY;

-- ============================================================================
-- 5. cancel_job (R27, A26, A27) — cancela o turno inteiro (soft delete)
--    Ordem, tudo em UMA transacao, com lock no turno (o MESMO recurso que claim_shift_slot trava):
--      guardas (recusa sem alterar nada) -> candidaturas invited|hired -> cancelled (o trigger existente
--      avisa cada freela) -> candidaturas de FLUXO PULL ainda pre-contratacao -> cancelled + aviso proprio
--      (o trigger nao as cobre) -> chamados abertos -> cancelled + alvos pendentes fechados e avisados ->
--      rastro ao responsavel/Gestores/dono -> jobs.status='deleted'. O UPDATE final cai em turno VAZIO,
--      que e o que jobs_soft_delete_guard (E3) exige de quem nao e Gestor.
--    Elenco intocado (team_connections/team_lists/historico do freela): cancelar nao e penalidade.
-- ============================================================================
CREATE OR REPLACE FUNCTION public.cancel_job(p_job_id uuid, p_reason text DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $fn$
DECLARE
    v_uid      uuid := (SELECT auth.uid());
    v_now      timestamptz := now();
    v_job      public.jobs%ROWTYPE;
    v_reason   text;
    v_n_apps   integer := 0;
    v_n_pull   integer := 0;
    v_n_calls  integer := 0;
    v_workers  uuid[]  := ARRAY[]::uuid[];
    v_pull     uuid[]  := ARRAY[]::uuid[];
    v_calls    uuid[]  := ARRAY[]::uuid[];
    v_title    text;
    v_when     text;
    v_actor    text;
    v_msg      text;
    v_start_ts timestamptz;
    r          record;
BEGIN
    IF v_uid IS NULL THEN
        RETURN jsonb_build_object('outcome', 'unauthenticated');
    END IF;
    IF p_job_id IS NULL THEN
        RETURN jsonb_build_object('outcome', 'invalid_input');
    END IF;

    v_reason := NULLIF(btrim(COALESCE(p_reason, '')), '');
    IF v_reason IS NOT NULL AND (length(v_reason) > 200 OR v_reason ~ '[[:cntrl:]]') THEN
        RETURN jsonb_build_object('outcome', 'invalid_input');
    END IF;

    PERFORM 1 FROM public.jobs j WHERE j.id = p_job_id;
    IF NOT FOUND THEN
        RETURN jsonb_build_object('outcome', 'not_found');
    END IF;

    -- DEFINER desliga a RLS: a autorizacao e explicita, na unha. Gestor: qualquer turno da company;
    -- encarregado confirmado: so os proprios (ou cobertos) — is_job_owner.
    IF NOT public.is_job_owner(p_job_id) THEN
        RETURN jsonb_build_object('outcome', 'forbidden');
    END IF;

    -- Lock no turno (mesmo recurso de claim_shift_slot): um aceite concorrente espera e, ao reler, ve
    -- status='deleted' e fecha o chamado como 'cancelled'.
    SELECT * INTO v_job FROM public.jobs WHERE id = p_job_id FOR UPDATE;
    -- M-2: reavalia a autorizacao sobre o turno TRAVADO (responsavel/cobertura/papel podem ter mudado
    -- entre a checagem acima e o lock).
    IF NOT public.is_job_owner(p_job_id) THEN
        RETURN jsonb_build_object('outcome', 'forbidden');
    END IF;
    IF COALESCE(v_job.status, '') = 'deleted' THEN
        RETURN jsonb_build_object('outcome', 'already_cancelled');
    END IF;

    -- L-1: quem nao e Gestor nao cancela turno que ja comecou/passou (inicio = data local + work_start_time;
    -- sem horario = 00:00 local). O Gestor segue podendo (correcao de cadastro).
    IF NOT public.is_company_owner(v_job.company_id) AND v_job.start_date IS NOT NULL THEN
        v_start_ts := (((v_job.start_date AT TIME ZONE 'America/Sao_Paulo')::date
                        + COALESCE((CASE WHEN v_job.work_start_time ~ '^([01]?[0-9]|2[0-3]):[0-5][0-9](:[0-5][0-9])?$' THEN v_job.work_start_time::time END), TIME '00:00')) AT TIME ZONE 'America/Sao_Paulo');
        IF v_start_ts < now() THEN
            RETURN jsonb_build_object('outcome', 'job_in_the_past');
        END IF;
    END IF;

    -- Recusas: nada e alterado. Mesma guarda de dismissFromShift (pagamento ativo; presenca iniciada).
    IF EXISTS (SELECT 1 FROM public.shift_payments sp
                WHERE sp.job_id = p_job_id AND sp.status IN ('scheduled', 'recorded')) THEN
        RETURN jsonb_build_object('outcome', 'active_payment');
    END IF;
    -- M-1: escrow vivo do turno (status reais: reserved | authorized | captured; released/refunded = encerrado).
    -- Article 8: so LE; devolver o saldo e do fluxo de escrow, nunca do cancelamento.
    IF EXISTS (SELECT 1 FROM public.escrow_transactions et
                WHERE et.job_id = p_job_id AND et.status IN ('reserved', 'authorized', 'captured')) THEN
        RETURN jsonb_build_object('outcome', 'active_escrow');
    END IF;
    IF EXISTS (SELECT 1 FROM public.applications a
                WHERE a.job_id = p_job_id
                  AND ( a.status IN ('in_progress', 'completed')
                     OR ( a.status = 'hired'
                          AND ( a.worker_checkin_at IS NOT NULL
                             OR a.company_checkin_confirmed_at IS NOT NULL
                             OR a.company_checkout_confirmed_at IS NOT NULL ) ) )) THEN
        RETURN jsonb_build_object('outcome', 'attendance_started');
    END IF;

    v_title := COALESCE(v_job.title, 'sem título');
    v_when  := COALESCE(' de ' || to_char((v_job.start_date AT TIME ZONE 'America/Sao_Paulo')::date, 'DD/MM'), '');

    -- (1) convidados e contratados -> cancelled. O trigger notify_counterpart_on_application_cancel
    --     avisa CADA freela ("Turno cancelado pela empresa" / "Convite de turno cancelado").
    WITH c AS (
        UPDATE public.applications
           SET status = 'cancelled'
         WHERE job_id = p_job_id AND status IN ('invited', 'hired')
        RETURNING worker_id
    )
    SELECT count(*)::integer, COALESCE(array_agg(worker_id), ARRAY[]::uuid[]) INTO v_n_apps, v_workers FROM c;

    -- (2) fluxo pull ainda pre-contratacao: sem isto sobrariam candidaturas "vivas" num turno deletado
    --     (e o trigger de E3 recusaria o UPDATE final do nao-Gestor). O trigger de aviso nao cobre estes
    --     estados, entao o aviso ao freela e feito aqui.
    WITH c AS (
        UPDATE public.applications
           SET status = 'cancelled'
         WHERE job_id = p_job_id
           AND status IN ('pending', 'reviewing', 'interview', 'applied', 'accepted', 'approved')
        RETURNING worker_id
    )
    SELECT count(*)::integer, COALESCE(array_agg(worker_id), ARRAY[]::uuid[]) INTO v_n_pull, v_pull FROM c;

    IF v_n_pull > 0 THEN
        INSERT INTO public.notifications (user_id, type, title, message, link)
        SELECT w, 'status_change', 'Vaga encerrada',
               'A empresa encerrou a vaga "' || v_title || '"' || v_when || '. Sua candidatura foi encerrada.',
               '/my-jobs'
          FROM unnest(v_pull) AS w;
    END IF;

    -- (3) chamados abertos -> cancelled (mesma logica de cancel_shift_call); alvos pendentes fechados.
    WITH c AS (
        UPDATE public.shift_calls
           SET status = 'cancelled', closed_at = v_now
         WHERE job_id = p_job_id AND status = 'open'
        RETURNING id
    )
    SELECT count(*)::integer, COALESCE(array_agg(id), ARRAY[]::uuid[]) INTO v_n_calls, v_calls FROM c;

    IF v_n_calls > 0 THEN
        UPDATE public.shift_call_targets
           SET response = 'closed', responded_at = v_now
         WHERE call_id = ANY (v_calls) AND response IS NULL;

        -- Quem ja foi avisado acima (cancelado como invited/hired/pull) nao recebe um segundo aviso.
        -- Texto por origin: quem veio de SOS nao e "do Elenco" (C7 do ADR-20260821).
        INSERT INTO public.notifications (user_id, type, title, message, link)
        SELECT t.worker_id,
               'status_change',
               'Chamado cancelado',
               CASE WHEN t.origin = 'sos'
                    THEN 'A empresa cancelou o turno deste chamado de urgência. Nada muda para você.'
                    ELSE 'A empresa cancelou o turno deste chamado. Nada muda para você — você continua no elenco.'
               END,
               '/my-jobs'
          FROM public.shift_call_targets t
         WHERE t.call_id      = ANY (v_calls)
           AND t.response     = 'closed'
           AND t.responded_at = v_now
           AND t.worker_id   <> ALL (v_workers || v_pull);
    END IF;

    -- (4) soft delete (nunca DELETE). Neste ponto o turno esta vazio para o guard de E3.
    UPDATE public.jobs SET status = 'deleted' WHERE id = p_job_id;

    -- (5) rastro: responsavel efetivo + Gestores + dono (+ operadores de organizacao), UMA vez por
    --     turno e sem avisar quem cancelou. Falha de aviso vira WARNING (helper), nunca derruba o gesto.
    -- quem age sem vinculo de equipe (dono) e "o Gestor", nunca "alguem da equipe".
    v_actor := COALESCE('por ' || public.internal_member_label(v_job.company_id, v_uid), 'pelo Gestor');
    v_msg   := 'O turno "' || v_title || '"' || v_when || ' foi cancelado ' || v_actor || '. '
               || CASE WHEN v_n_apps + v_n_pull = 0 THEN 'Nenhum freela estava no turno.'
                       WHEN v_n_apps + v_n_pull = 1 THEN '1 candidatura foi encerrada e o freela foi avisado.'
                       ELSE (v_n_apps + v_n_pull)::text || ' candidaturas foram encerradas e os freelas foram avisados.' END
               || COALESCE(' Motivo: ' || v_reason || '.', '');
    -- L-4: trilha PERSISTENTE (ator, motivo, contagens), alem do aviso. Sem FK e sem DELETE.
    INSERT INTO public.job_cancellations
        (job_id, company_id, cancelled_by, reason, cancelled_applications, cancelled_calls, closed_candidates)
    VALUES (p_job_id, v_job.company_id, v_uid, v_reason, v_n_apps, v_n_calls, v_n_pull);

    FOR r IN SELECT rcp AS uid
               FROM public.notification_recipients_for_job(p_job_id) AS rcp
              WHERE rcp <> v_uid
    LOOP
        PERFORM public.internal_notify_member_event(
            r.uid, 'Cancelamento de turno', v_msg,
            '/company/jobs/' || p_job_id::text || '/candidates');
    END LOOP;

    RETURN jsonb_build_object(
        'outcome',                 'cancelled',
        'cancelled_applications',  v_n_apps,
        'cancelled_calls',         v_n_calls,
        'closed_candidates',       v_n_pull
    );
END;
$fn$;

COMMENT ON FUNCTION public.cancel_job(uuid, text) IS
    'Cancela o turno INTEIRO (R27/A26/A27) — unica porta para turno populado (UPDATE cru so em turno '
    'vazio, trigger de E3). Autoriza por is_job_owner (Gestor: qualquer turno; encarregado: so os '
    'proprios/cobertos). RECUSA sem alterar nada: active_payment (shift_payments scheduled|recorded) e '
    'attendance_started (in_progress/completed ou check-in/out registrado) e active_escrow (escrow reserved|'
    'authorized|captured; so le, nunca estorna). Nao-Gestor nao cancela turno ja iniciado (job_in_the_past). '
    'Grava job_cancellations (ator, motivo). Uma transacao, com lock no '
    'turno: invited|hired -> cancelled (o trigger avisa cada freela), candidaturas pull pre-contratacao '
    '-> cancelled (+ aviso), chamados abertos -> cancelled (alvos pendentes fechados e avisados), '
    'rastro a responsavel+Gestores+dono (1 vez por turno, sem avisar quem cancelou) e, por fim, '
    'jobs.status=deleted. Devolve {outcome, cancelled_applications, cancelled_calls, closed_candidates}. '
    'Elenco intocado; escrow legado do fluxo pull NAO e estornado (manual, Article 8). Outcomes: '
    'cancelled|already_cancelled|active_payment|active_escrow|attendance_started|job_in_the_past|forbidden|not_found|invalid_input|'
    'unauthenticated.';

-- ============================================================================
-- 6. Tags (R20) — Gestor cria/arquiva; nunca DELETE. Atribuir ao turno: quem opera o turno.
-- ============================================================================
CREATE OR REPLACE FUNCTION public.create_company_tag(p_company_id uuid, p_name text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $fn$
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
$fn$;

COMMENT ON FUNCTION public.create_company_tag(uuid, text) IS
    'Cria tag da company (1..40 chars, unica por nome sem caixa). Gestor-only (is_company_owner). Nome '
    'ja existente e ativo = already_exists; arquivado = REATIVADO (reactivated). Nunca DELETE. Outcomes: '
    'created|reactivated|already_exists|invalid_input|forbidden|unauthenticated. R20.';

CREATE OR REPLACE FUNCTION public.archive_company_tag(p_tag_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $fn$
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
$fn$;

COMMENT ON FUNCTION public.archive_company_tag(uuid) IS
    'Arquiva a tag (archived_at = now()). Gestor-only. Some do seletor de novos turnos (o trigger de jobs '
    'recusa tag arquivada) e permanece em filtros/relatorios dos turnos antigos. NAO existe caminho de '
    'DELETE (sem policy/GRANT; FK RESTRICT em jobs.tag_id). Outcomes: archived|already_archived|not_found|'
    'forbidden|invalid_input|unauthenticated. R20/A17.';

CREATE OR REPLACE FUNCTION public.set_job_tag(p_job_id uuid, p_tag_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $fn$
DECLARE
    v_uid uuid := (SELECT auth.uid());
    v_job public.jobs%ROWTYPE;
BEGIN
    IF v_uid IS NULL THEN
        RETURN jsonb_build_object('outcome', 'unauthenticated');
    END IF;
    IF p_job_id IS NULL THEN
        RETURN jsonb_build_object('outcome', 'invalid_input');
    END IF;

    SELECT * INTO v_job FROM public.jobs WHERE id = p_job_id;
    IF NOT FOUND THEN
        RETURN jsonb_build_object('outcome', 'not_found');
    END IF;
    IF NOT public.is_job_owner(p_job_id) THEN
        RETURN jsonb_build_object('outcome', 'forbidden');
    END IF;
    IF COALESCE(v_job.status, '') = 'deleted' THEN
        RETURN jsonb_build_object('outcome', 'job_deleted');
    END IF;

    IF p_tag_id IS NOT NULL AND NOT EXISTS (
           SELECT 1 FROM public.company_tags t
            WHERE t.id = p_tag_id AND t.company_id = v_job.company_id AND t.archived_at IS NULL) THEN
        RETURN jsonb_build_object('outcome', 'invalid_tag');
    END IF;

    UPDATE public.jobs SET tag_id = p_tag_id WHERE id = p_job_id;
    RETURN jsonb_build_object('outcome', 'ok');
END;
$fn$;

COMMENT ON FUNCTION public.set_job_tag(uuid, uuid) IS
    'Atribui (ou limpa, com NULL) a tag de um turno. Quem OPERA o turno (is_job_owner): Gestor ou '
    'encarregado responsavel/cobrindo. A tag precisa ser da MESMA company e nao arquivada (o trigger '
    'jobs_responsible_guard revalida). Tag e so dimensao de filtro, nao concede nem nega acesso. '
    'Outcomes: ok|invalid_tag|job_deleted|not_found|forbidden|invalid_input|unauthenticated.';

-- ============================================================================
-- 7. my_link_risk_config(p_company_id uuid DEFAULT NULL) (R7b, A25)
--    DROP da assinatura antiga + CREATE da nova na MESMA transacao (overload deixaria o PostgREST
--    ambiguo). Sem LIMIT 1 por c.id: sem parametro so resolve se a sessao opera EXATAMENTE uma company.
--    O chamador atual (linkRiskService: supabase.rpc('my_link_risk_config') sem args) continua valendo
--    para quem opera 1 company; com varias recebe {outcome:'company_required'} e o cliente cai no
--    default LIGADO/2 (parse tolerante) ate passar a empresa corrente.
-- ============================================================================
DROP FUNCTION IF EXISTS public.my_link_risk_config();

CREATE OR REPLACE FUNCTION public.my_link_risk_config(p_company_id uuid DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $fn$
DECLARE
    v_uid     uuid := (SELECT auth.uid());
    v_company uuid := p_company_id;
    v_ids     uuid[];
    v_enabled boolean;
    v_thr     integer;
BEGIN
    IF v_uid IS NULL THEN
        RETURN jsonb_build_object('outcome', 'unauthenticated');
    END IF;

    IF v_company IS NULL THEN
        SELECT COALESCE(array_agg(DISTINCT gc.company_id), ARRAY[]::uuid[]) INTO v_ids
          FROM public.get_my_companies() AS gc;
        IF cardinality(v_ids) = 0 THEN
            -- sessao sem empresa (freela etc.): default fail-safe LIGADO, como antes
            RETURN jsonb_build_object('outcome', 'no_company', 'enabled', true, 'threshold', 2);
        ELSIF cardinality(v_ids) > 1 THEN
            RETURN jsonb_build_object('outcome', 'company_required');   -- nenhum dado
        END IF;
        v_company := v_ids[1];
    END IF;

    -- leitura: Gestor ou encarregado CONFIRMADO. Nao confirmado / empresa que nao opera: nega sem vazar.
    IF NOT public.is_company_member_confirmed(v_company) THEN
        RETURN jsonb_build_object('outcome', 'forbidden');
    END IF;

    SELECT c.link_risk_alert_enabled, c.link_risk_alert_threshold
      INTO v_enabled, v_thr
      FROM public.companies c
     WHERE c.id = v_company;
    IF NOT FOUND THEN
        RETURN jsonb_build_object('outcome', 'forbidden');
    END IF;

    RETURN jsonb_build_object(
        'outcome',   'ok',
        'enabled',   COALESCE(v_enabled, true),
        'threshold', COALESCE(v_thr, 2)
    );
END;
$fn$;

COMMENT ON FUNCTION public.my_link_risk_config(uuid) IS
    'Config do aviso de vinculo da company: {"outcome":"ok","enabled":bool,"threshold":int}. COM '
    'p_company_id: exige is_company_member_confirmed (Gestor ou encarregado confirmado); senao '
    '{outcome:forbidden} sem dado. SEM parametro: usa a company so se a sessao opera EXATAMENTE uma '
    '(get_my_companies); com varias devolve {outcome:company_required} e NENHUM dado (proibido LIMIT 1 / '
    'escolha implicita); sem nenhuma, default LIGADO/2 (no_company). A ESCRITA de link_risk_alert_* segue '
    'Gestor-only (companies_update_operator). R7b/A25 de equipe-encarregados. O frontend deve passar a '
    'empresa corrente.';

-- ============================================================================
-- 8. Aviso "a empresa" (R21) — claim_shift_slot, decline_shift_call, respond_attendance_confirmation
--    Edicao do corpo VIGENTE do catalogo (pg_get_functiondef), nunca recriado a mao (D4): o corpo
--    carrega acentos restaurados (20260823000800/900) e o ramo `closed` de 20260824000800.
--    Duas trocas por funcao, cada uma com assercao de contagem:
--      (a) o bloco `SELECT c.owner_id INTO v_company_user ... END IF;` sai (a variavel continua
--          declarada, sem uso);
--      (b) `INSERT INTO public.notifications (...) VALUES (v_company_user, <rest>);` vira
--          `... SELECT rcp, <rest> FROM public.notification_recipients_for_job(<job>) AS rcp;`
--          => responsavel efetivo + Gestores + dono (+ operadores de organizacao), sem duplicar.
--    Texto, titulo e link das mensagens NAO mudam. Quem nao tem manager nem operador de organizacao recebe o mesmo destinatario de antes; os demais passam a receber tambem (R21).
-- ============================================================================
DO $mig$
DECLARE
    v_alvo     text;
    v_job_expr text;
    v_def      text;
    v_novo     text;
    v_hit      text;
    v_rest     text;
    v_n        integer;
    v_pat_blk  text :=
        'SELECT c[.]owner_id INTO v_company_user[[:space:]]+FROM public[.]companies c WHERE c[.]id = [a-z_.]+;[[:space:]]+IF v_company_user IS NULL THEN[[:space:]]+v_company_user := [a-z_.]+;[[:space:]]+END IF;';
    -- primeiro quantificador NAO-guloso: em ARE ele define a preferencia da ER inteira (precedente E3).
    v_pat_ins  text := 'VALUES [(][[:space:]]+?v_company_user,.*?[)];';
BEGIN
    FOR v_alvo, v_job_expr IN
        SELECT * FROM (VALUES
            ('public.claim_shift_slot(uuid)',                      'v_call.job_id'),
            ('public.decline_shift_call(uuid)',                    'v_call.job_id'),
            ('public.respond_attendance_confirmation(uuid, text)', 'v_job_id')
        ) AS t(alvo, job_expr)
    LOOP
        v_def := pg_get_functiondef(v_alvo::regprocedure);
        IF position('notification_recipients_for_job' IN v_def) > 0 THEN
            RAISE NOTICE 'E5: % ja roteia o aviso; nada a fazer.', v_alvo;
            CONTINUE;
        END IF;

        -- (a) bloco de resolucao do destinatario
        SELECT count(*) INTO v_n FROM regexp_matches(v_def, v_pat_blk, 'g');
        IF v_n <> 1 THEN
            RAISE EXCEPTION 'ASSERCAO E5(aviso a) em %: % ocorrencia(s) do bloco owner_id -> v_company_user (esperado 1). HALT.', v_alvo, v_n;
        END IF;
        v_hit  := (regexp_match(v_def, v_pat_blk))[1];
        v_novo := replace(v_def, v_hit,
            '-- E5: destinatarios = responsavel efetivo + Gestores + dono (ver a chamada logo abaixo).');

        -- (b) INSERT ... VALUES (v_company_user, ...) -> INSERT ... SELECT rcp, ...
        SELECT count(*) INTO v_n FROM regexp_matches(v_novo, v_pat_ins, 'g');
        IF v_n <> 1 THEN
            RAISE EXCEPTION 'ASSERCAO E5(aviso b) em %: % INSERT(s) VALUES (v_company_user, ...) (esperado 1). HALT.', v_alvo, v_n;
        END IF;
        v_hit  := (regexp_match(v_novo, v_pat_ins))[1];
        v_rest := substr(v_hit, position('v_company_user,' IN v_hit) + length('v_company_user,'));
        v_rest := left(v_rest, length(v_rest) - 2);                     -- remove o ');' final
        v_novo := replace(v_novo, v_hit,
            'SELECT rcp,' || v_rest || ' FROM public.notification_recipients_for_job(' || v_job_expr || ') AS rcp;');

        -- asserção final: o INSERT antigo sumiu, o novo existe 1 vez, nada ficou apontando para owner_id
        IF position('VALUES (' || chr(10) || '            v_company_user' IN v_novo) > 0
           OR position('INTO v_company_user' IN v_novo) > 0
           OR (length(v_novo) - length(replace(v_novo, 'notification_recipients_for_job', '')))
              / length('notification_recipients_for_job') <> 1 THEN
            RAISE EXCEPTION 'ASSERCAO E5(aviso): a edicao de % nao produziu o esperado. HALT.', v_alvo;
        END IF;

        EXECUTE v_novo;
    END LOOP;
END
$mig$;

-- ============================================================================
-- 9. list_jobs_by_responsible (v1 minimo, GESTOR-ONLY) — responsavel visivel + filtro por pessoa e tag
--    Responsavel EFETIVO (R19): responsible_id se a pessoa ainda e operador ativo e confirmado; senao
--    "Gestor" (NULL = turno legado; pessoa removida = com "criado por {nome}" no rastro). Filtro por
--    pessoa: encarregado/Gestor por responsible_id; filtrar por um Gestor inclui tambem os turnos que
--    caem no Gestor por R19. Sem agregado de valor pago (v1.2). Janela de ate 92 dias, 500 itens.
-- ============================================================================
CREATE OR REPLACE FUNCTION public.list_jobs_by_responsible(
    p_company_id     uuid,
    p_from           date,
    p_to             date,
    p_responsible_id uuid DEFAULT NULL,
    p_tag_id         uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $fn$
DECLARE
    v_uid           uuid := (SELECT auth.uid());
    v_filter_gestor boolean := false;
    v_items         jsonb;
    v_count         integer;
BEGIN
    IF v_uid IS NULL THEN
        RETURN jsonb_build_object('outcome', 'unauthenticated');
    END IF;
    IF p_company_id IS NULL OR p_from IS NULL OR p_to IS NULL THEN
        RETURN jsonb_build_object('outcome', 'invalid_input');
    END IF;
    IF p_to < p_from OR (p_to - p_from) > 92 THEN
        RETURN jsonb_build_object('outcome', 'invalid_range');
    END IF;
    IF NOT public.is_company_owner(p_company_id) THEN
        RETURN jsonb_build_object('outcome', 'forbidden');
    END IF;

    IF p_responsible_id IS NOT NULL THEN
        v_filter_gestor := EXISTS (
            SELECT 1 FROM public.internal_company_gestor_ids(p_company_id) AS g WHERE g = p_responsible_id);
    END IF;

    WITH base AS (
        SELECT j.id,
               j.title,
               j.status,
               j.slots,
               j.tag_id,
               j.responsible_id,
               (j.start_date AT TIME ZONE 'America/Sao_Paulo')::date AS d,
               j.work_start_time AS t,
               (j.responsible_id IS NOT NULL
                AND public.internal_company_confirmed_operator(j.company_id, j.responsible_id)) AS resp_ok
          FROM public.jobs j
         WHERE j.company_id = p_company_id
           AND j.start_date IS NOT NULL
           AND COALESCE(j.status, '') <> 'deleted'
           AND (j.start_date AT TIME ZONE 'America/Sao_Paulo')::date BETWEEN p_from AND p_to
           AND (p_tag_id IS NULL OR j.tag_id = p_tag_id)
    ),
    pick AS (
        SELECT b.*,
               row_number() OVER (ORDER BY b.d, b.t NULLS LAST, b.id) AS rn
          FROM base b
         WHERE p_responsible_id IS NULL
            OR (b.resp_ok AND b.responsible_id = p_responsible_id)
            OR (v_filter_gestor AND NOT b.resp_ok)
         ORDER BY b.d, b.t NULLS LAST, b.id
         LIMIT 501
    )
    SELECT count(*)::integer,
           COALESCE(jsonb_agg(
               jsonb_build_object(
                   'job_id',            p.id,
                   'title',             p.title,
                   'status',            p.status,
                   'date',              p.d,
                   'start_time',        p.t,
                   'slots',             p.slots,
                   'filled',            (SELECT count(*) FROM public.applications a
                                          WHERE a.job_id = p.id
                                            AND a.status IN ('hired', 'in_progress', 'completed')),
                   'responsible_id',    p.responsible_id,
                   'responsible_kind',  CASE WHEN p.resp_ok THEN 'person' ELSE 'gestor' END,
                   'responsible_state', CASE WHEN p.responsible_id IS NULL THEN 'unassigned'
                                             WHEN p.resp_ok THEN 'active'
                                             ELSE 'removed' END,
                   'responsible_label', CASE WHEN p.resp_ok
                                             THEN COALESCE(public.internal_member_label(p_company_id, p.responsible_id), 'Gestor')
                                             ELSE 'Gestor' END,
                   'creator_label',     CASE WHEN p.responsible_id IS NOT NULL AND NOT p.resp_ok
                                             THEN public.internal_member_label(p_company_id, p.responsible_id) END,
                   'tag_id',            p.tag_id,
                   'tag_name',          ct.name,
                   'tag_archived',      (ct.archived_at IS NOT NULL)
               ) ORDER BY p.rn
           ) FILTER (WHERE p.rn <= 500), '[]'::jsonb)
      INTO v_count, v_items
      FROM pick p
      LEFT JOIN public.company_tags ct ON ct.id = p.tag_id;

    RETURN jsonb_build_object('outcome', 'ok', 'truncated', v_count > 500, 'items', v_items);
END;
$fn$;

COMMENT ON FUNCTION public.list_jobs_by_responsible(uuid, date, date, uuid, uuid) IS
    'Relatorio v1 MINIMO (Gestor-only, is_company_owner): turnos da company na janela (<= 92 dias, '
    '500 itens) com RESPONSAVEL EFETIVO visivel (R19: NULL ou pessoa removida = "Gestor", com '
    'creator_label quando ha rastro) e filtro por pessoa e por tag. Sem valores pagos (relatorio '
    'semanal por responsavel e v1.2). Devolve {outcome, truncated, items[]}; nao devolve PII de '
    'freela. Outcomes: ok|invalid_input|invalid_range|forbidden|unauthenticated.';

-- ============================================================================
-- 9b. list_company_operators — destinos de "Passar para..." e "Cobrir" para o ENCARREGADO
--     list_company_members e Gestor-only e devolve e-mail/estado de convite; o encarregado precisa so de
--     QUEM pode receber. Autorizacao: Gestor (is_company_owner) OU encarregado ativo e CONFIRMADO da
--     MESMA company (is_company_member_confirmed). Quem nao pode saber recebe ERRO 42501, nunca lista
--     vazia. Devolve SO user_id + rotulo + papel (gestor|encarregado) de exibicao de operadores ATIVOS e CONFIRMADOS (Gestores:
--     dono, managers, operadores de organizacao; e encarregados confirmados). Sem e-mail, telefone,
--     token, estado de convite nem outras companies. Nao aceita "por qual usuario perguntar".
-- ============================================================================
CREATE OR REPLACE FUNCTION public.list_company_operators(p_company_id uuid)
RETURNS TABLE (user_id uuid, label text, role text)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $fn$
#variable_conflict use_column
BEGIN
    IF (SELECT auth.uid()) IS NULL THEN
        RAISE EXCEPTION 'unauthenticated' USING ERRCODE = '42501', DETAIL = 'outcome=unauthenticated';
    END IF;
    IF p_company_id IS NULL OR NOT public.is_company_member_confirmed(p_company_id) THEN
        RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501', DETAIL = 'outcome=forbidden';
    END IF;

    RETURN QUERY
    SELECT g.uid,
           COALESCE(public.internal_member_label(p_company_id, g.uid), 'Gestor'),
           'gestor'::text
      FROM (SELECT gi AS uid FROM public.internal_company_gestor_ids(p_company_id) AS gi) g
    UNION
    SELECT cm.user_id,
           COALESCE(public.internal_member_label(p_company_id, cm.user_id), 'Encarregado'),
           'encarregado'::text
      FROM public.company_members cm
     WHERE cm.company_id   = p_company_id
       AND cm.role         = 'encarregado'
       AND cm.status       = 'active'
       AND cm.confirmed_at IS NOT NULL
       AND cm.user_id      IS NOT NULL;
END;
$fn$;

COMMENT ON FUNCTION public.list_company_operators(uuid) IS
    'Quem pode receber "Passar para..." / "Cobrir": operadores ATIVOS e CONFIRMADOS da company (Gestores: '
    'dono, managers, operadores de organizacao; encarregados confirmados) como TABLE(user_id, label, role) com role IN (gestor, encarregado; gestor = dono, manager e operador de organizacao). Gestor '
    'ou encarregado confirmado da mesma company; senao ERRO 42501 (nunca lista vazia). Sem e-mail, '
    'telefone, token, estado de convite nem dados de outras companies. DEFINER, sobre auth.uid().';

-- ============================================================================
-- 10. GRANTS (D2) — REVOKE FROM PUBLIC, anon em tudo; authenticated + service_role nas RPCs de cliente
-- ============================================================================
REVOKE ALL ON FUNCTION public.get_busy_workers(uuid, timestamptz, timestamptz, uuid[], uuid)      FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.reassign_job_responsible(uuid[], uuid)                              FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.create_responsibility_coverage(uuid, uuid, uuid, date, date)        FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.end_responsibility_coverage(uuid)                                   FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.cancel_job(uuid, text)                                              FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.create_company_tag(uuid, text)                                      FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.archive_company_tag(uuid)                                           FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.set_job_tag(uuid, uuid)                                             FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.my_link_risk_config(uuid)                                           FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.list_jobs_by_responsible(uuid, date, date, uuid, uuid)              FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.list_company_operators(uuid)                                         FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION public.get_busy_workers(uuid, timestamptz, timestamptz, uuid[], uuid)   TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.reassign_job_responsible(uuid[], uuid)                           TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.create_responsibility_coverage(uuid, uuid, uuid, date, date)     TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.end_responsibility_coverage(uuid)                                TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.cancel_job(uuid, text)                                           TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.create_company_tag(uuid, text)                                   TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.archive_company_tag(uuid)                                        TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.set_job_tag(uuid, uuid)                                          TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.my_link_risk_config(uuid)                                        TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.list_jobs_by_responsible(uuid, date, date, uuid, uuid)           TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.list_company_operators(uuid)                                      TO authenticated, service_role;

-- claim_shift_slot / decline_shift_call / respond_attendance_confirmation: CREATE OR REPLACE (via
-- EXECUTE) preserva ACL e COMMENT; reafirma-se o mesmo estado de antes, por seguranca.
REVOKE ALL ON FUNCTION public.claim_shift_slot(uuid)                      FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.decline_shift_call(uuid)                    FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.respond_attendance_confirmation(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.claim_shift_slot(uuid)                      TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.decline_shift_call(uuid)                    TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.respond_attendance_confirmation(uuid, text) TO authenticated, service_role;

-- ============================================================================
-- 11. VERIFICACAO FINAL (falha a migration se qualquer invariante nao fechar)
--     Limite de palavra POSIX ([[:<:]]/[[:>:]]) — nunca strpos de `company_members` solto: "company_membership"
--     contem "company_members" + "hip" e ja causou falso HALT.
-- ============================================================================
DO $mig$
DECLARE
    r        record;
    v_def    text;
    v_bad    text;
    v_cnt    integer := 0;
BEGIN
    -- (a) as RPCs novas: DEFINER, search_path vazio, anon SEM EXECUTE, authenticated COM; helper interno SEM
    FOR r IN
        SELECT p.oid, p.proname, p.prosecdef, p.proconfig
          FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
         WHERE n.nspname = 'public'
           AND p.proname IN ('get_busy_workers','reassign_job_responsible','create_responsibility_coverage',
                             'end_responsibility_coverage','cancel_job','create_company_tag',
                             'archive_company_tag','set_job_tag','my_link_risk_config',
                             'list_jobs_by_responsible','internal_member_label','list_company_operators')
    LOOP
        v_cnt := v_cnt + 1;
        IF NOT r.prosecdef THEN
            RAISE EXCEPTION 'VERIFICACAO E5: % nao e SECURITY DEFINER. HALT.', r.proname;
        END IF;
        IF r.proconfig IS NULL OR NOT ('search_path=""' = ANY (r.proconfig)) THEN
            RAISE EXCEPTION 'VERIFICACAO E5: % sem search_path vazio (config=%). HALT.', r.proname, r.proconfig;
        END IF;
        IF has_function_privilege('anon', r.oid, 'EXECUTE') THEN
            RAISE EXCEPTION 'VERIFICACAO E5: anon tem EXECUTE em %. HALT.', r.proname;
        END IF;
        IF r.proname = 'internal_member_label' THEN
            IF has_function_privilege('authenticated', r.oid, 'EXECUTE') THEN
                RAISE EXCEPTION 'VERIFICACAO E5: authenticated tem EXECUTE no helper interno internal_member_label. HALT.';
            END IF;
        ELSIF NOT has_function_privilege('authenticated', r.oid, 'EXECUTE') THEN
            RAISE EXCEPTION 'VERIFICACAO E5: authenticated sem EXECUTE em %. HALT.', r.proname;
        END IF;

        -- nenhum predicado novo ancorado em auth.uid() cru para decidir acesso de empresa (D1)
        v_def := pg_get_functiondef(r.oid);
        IF v_def ~* 'company_id[[:space:]]*=[[:space:]]*[(]?[[:space:]]*(select[[:space:]]+)?auth[.]uid[(][)]'
           OR v_def ~* 'owner_id[[:space:]]*=[[:space:]]*[(]?[[:space:]]*(select[[:space:]]+)?auth[.]uid[(][)]'
           OR v_def ~* '(company_id|owner_id)[[:space:]]*=[[:space:]]*v_[a-z_]*uid' THEN
            RAISE EXCEPTION 'VERIFICACAO E5: % ancora empresa em auth.uid() cru (D1). HALT.', r.proname;
        END IF;

        -- leitor de company_members sem tratar o PAPEL = escalada silenciosa (escrita por palavra)
        IF v_def ~ '[[:<:]]company_members[[:>:]]' AND v_def !~ '[[:<:]]role[[:>:]]' THEN
            RAISE EXCEPTION 'VERIFICACAO E5: % le company_members sem tratar papel. HALT.', r.proname;
        END IF;
    END LOOP;

    -- (a2) o laco so itera o que existe: as 12 funcoes criadas aqui TEM de estar todas no catalogo
    IF v_cnt <> 12 THEN
        RAISE EXCEPTION 'VERIFICACAO E5: % de 12 funcoes de E5 encontradas no catalogo. HALT.', v_cnt;
    END IF;

    -- (b) so existe UMA my_link_risk_config (sem overload ambiguo no PostgREST)
    IF (SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
         WHERE n.nspname = 'public' AND p.proname = 'my_link_risk_config') <> 1 THEN
        RAISE EXCEPTION 'VERIFICACAO E5: my_link_risk_config tem overload (esperado 1 assinatura). HALT.';
    END IF;

    -- (c) as tres funcoes de aviso: roteadas por notification_recipients_for_job, sem o destinatario antigo
    FOR r IN SELECT unnest(ARRAY[
        'public.claim_shift_slot(uuid)',
        'public.decline_shift_call(uuid)',
        'public.respond_attendance_confirmation(uuid, text)'
    ]) AS sig
    LOOP
        v_def := pg_get_functiondef(r.sig::regprocedure);
        IF position('notification_recipients_for_job' IN v_def) = 0
           OR position('INTO v_company_user' IN v_def) > 0 THEN
            RAISE EXCEPTION 'VERIFICACAO E5: % nao ficou roteada para notification_recipients_for_job. HALT.', r.sig;
        END IF;
    END LOOP;

    -- (d) o guard editado preserva a passagem de sessao nula
    v_def := pg_get_functiondef('public.jobs_responsible_guard()'::regprocedure);
    IF position('app.job_reassign' IN v_def) = 0
       OR position('IF v_uid IS NULL THEN' IN v_def) = 0 THEN
        RAISE EXCEPTION 'VERIFICACAO E5: jobs_responsible_guard perdeu a edicao ou a passagem de sessao nula. HALT.';
    END IF;

    -- (e) nada de DELETE para tags/coberturas/auditoria (R20/D6). has_table_privilege so para os papeis
    --     de API (inclui o que vem de PUBLIC); information_schema.role_table_grants lista tambem o DONO
    --     (postgres) e acusaria sempre.
    SELECT string_agg(t.tbl || ':' || ro.rol, ', ') INTO v_bad
      FROM (VALUES ('public.company_tags'), ('public.responsibility_coverages'), ('public.job_cancellations')) AS t(tbl)
      CROSS JOIN (VALUES ('anon'), ('authenticated'), ('service_role')) AS ro(rol)
     WHERE has_table_privilege(ro.rol, t.tbl, 'DELETE');
    IF v_bad IS NOT NULL THEN
        RAISE EXCEPTION 'VERIFICACAO E5: privilegio DELETE em tabela que nunca se apaga: %. HALT.', v_bad;
    END IF;

    -- (f) GUC app.job_reassign: so reassign_job_responsible a ESCREVE (set_config), so com r.id::text (liga)
    --     e '' (desliga); o guard so le (current_setting). Nenhuma outra funcao de public pode cita-la
    --     (ADR troca-de-responsavel-so-pela-rpc: sem set_config com texto vindo do chamador).
    -- Varredura FORTE: nenhuma funcao de public alem de reassign_job_responsible contem `set_config`
    -- (comentarios de linha `-- ...` descartados antes: o texto da funcao inclui os comentarios do corpo).
    -- Estado conhecido do repo: todo set_config antigo das migrations esta em comentario.
    SELECT string_agg(p.proname, ', ') INTO v_bad
      FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname = 'public' AND p.prokind = 'f'
       AND p.proname <> 'reassign_job_responsible'
       AND regexp_replace(pg_get_functiondef(p.oid), '--[^[:cntrl:]]*', '', 'g') ~* 'set_config';
    IF v_bad IS NOT NULL THEN
        RAISE EXCEPTION 'VERIFICACAO E5: funcao(oes) de public chamam set_config alem de reassign_job_responsible: %. HALT -> security-reviewer.', v_bad;
    END IF;
    SELECT string_agg(p.proname, ', ') INTO v_bad
      FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname = 'public' AND p.prokind = 'f'
       AND strpos(pg_get_functiondef(p.oid), 'app.job_reassign') > 0
       AND p.proname NOT IN ('reassign_job_responsible', 'jobs_responsible_guard');
    IF v_bad IS NOT NULL THEN
        RAISE EXCEPTION 'VERIFICACAO E5: funcao(oes) citam app.job_reassign alem de reassign_job_responsible/jobs_responsible_guard: %. HALT -> security-reviewer.', v_bad;
    END IF;
    IF strpos(pg_get_functiondef('public.jobs_responsible_guard()'::regprocedure), 'set_config') > 0 THEN
        RAISE EXCEPTION 'VERIFICACAO E5: jobs_responsible_guard nao pode escrever a GUC (set_config). HALT.';
    END IF;
    v_def := pg_get_functiondef('public.reassign_job_responsible(uuid[], uuid)'::regprocedure);
    IF (SELECT count(*) FROM regexp_matches(v_def, 'set_config[[:space:]]*[(]', 'g')) <> 2
       OR (SELECT count(*) FROM regexp_matches(v_def, 'set_config[(]''app[.]job_reassign'', r[.]id::text, true[)]', 'g')) <> 1
       OR (SELECT count(*) FROM regexp_matches(v_def, 'set_config[(]''app[.]job_reassign'', '''', true[)]', 'g')) <> 1 THEN
        RAISE EXCEPTION 'VERIFICACAO E5: reassign_job_responsible deve ter exatamente set_config(app.job_reassign, r.id::text, true) e set_config(app.job_reassign, '''', true). HALT.';
    END IF;
END
$mig$;

-- ============================================================================
-- VERIFICACAO pos-aplicacao e testes: supabase/tests/equipe_e5_auditoria.sql
--   (Parte 1 read-only; Parte 3 so em QA/staging, tudo em transacao com ROLLBACK).
-- ============================================================================
