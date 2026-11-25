BEGIN;
-- Migration: Equipe e encarregados, E3 — policies e triggers passam a perguntar ao seam certo
-- File: supabase/migrations/20261123000400_equipe_e3_policies_e_triggers.sql
-- Spec:  .harness/spec/equipe-encarregados/spec.md (R5, R6, R7, R10, R10b, R21; A3, A4, A12, A13c, A21, A22)
-- Gate:  .harness/spec/equipe-encarregados/gate-architect.md (G2, G3, secao B, D1-D4)
-- ADRs:  ADR-20261123-responsavel-efetivo-derivado-no-seam, ADR-20261123-elenco-unico-da-company
--
-- Depende de E0, E1 e E2 (assercoes no bloco 0). Enquanto nao existir encarregado (o CHECK de
-- company_members.role so alarga em E4), TODA mudanca abaixo e no-op comportamental: cada predicado
-- novo devolve, para dono/gerente/operador de organizacao/freela, exatamente o que o antigo devolvia.
--
-- PEDIDO DO CONTRATO x GATE: a lista de E3 do contrato de tarefa nao nomeava team_connections,
-- team_lists, company_invite_links, can_view_worker_profile e list_team_connection_cards; a spec
-- (tabela E3) e o gate (secao B) as incluem — seguiu-se spec+gate. count_worker_shifts_by_week foi
-- para E2 (G4: "mesma migration do seam"). Nao entram aqui (ficam para E5, so afetam ROTEAMENTO de
-- aviso, nao autorizacao): claim_shift_slot, decline_shift_call, respond_attendance_confirmation —
-- ver "PENDENTE" no fim.
--
-- O QUE MUDA (UP)
-- ----------------------------------------------------------------------------
--   Policies  jobs (insert/update: ramo encarregado via session_can_operate_job; DELETE segue Gestor)
--             shift_payments (select/insert/update -> is_job_owner; insert ancora company_id no turno)
--             service_terms (select -> is_job_owner)
--             team_connections (select leitura confirmada; insert 'pending' por membro confirmado)
--             team_lists / team_list_members (select: membro confirmado)
--             company_invite_links (select: membro confirmado; rotacao continua Gestor-only)
--             notifications_insert_self_or_connected (ramo empresa->freela: membro confirmado)
--   Triggers  enforce_shift_payment_immutability: "empresa" = is_job_owner(job); ->voided exige Gestor
--             team_connections BEFORE INSERT/UPDATE: invited_by forcado a auth.uid() e imutavel (R10c)
--             jobs BEFORE UPDATE OF status: UPDATE cru -> 'deleted' por nao-Gestor so em turno VAZIO (R27)
--             notify_counterpart_on_application_cancel: ator e destinatarios pelo seam (R21)
--   Funcoes   list_team_connection_cards (membro confirmado); NOVA get_shift_worker_payment_card
--             (projecao fechada de PII para o encarregado); create_sos_call / sos_call_eligibility
--             (reancoragem em v_job.company_id + Gestor-only — achado A2 de seguranca)
--   FORA DE E3 DE PROPOSITO: can_view_worker_profile NAO e alterada (ramo 2 segue Gestor-only; o
--             encarregado le PII so pela RPC de cartao — ADR encarregado-confirmado, decisao 2);
--             my_link_risk_config NAO e tocada (assinatura nova (p_company_id) = E5).
--   INALTERADAS DE PROPOSITO (herdam is_job_owner ou ficam Gestor-only — declarado, nao omitido):
--             applications (3 policies) e validate_application_update, shift_calls,
--             shift_call_targets, shift_attendance_confirmations: HERDAM is_job_owner (E2).
--             tc_update_company, tc_delete_company, tc_delete_worker_pending (veto indelevel do
--             freela intacto), job_series, worker_trainings/certifications, worker_referrals,
--             companies_update_operator, Conversation/Message + can_access_application (chat fora do
--             v1), get_company_invite_token (rotacao Gestor-only; encarregado le o link por policy).
--             jobs SELECT USING (true) NAO muda (A20: escopo por pessoa vale para applications/
--             shift_payments/shift_calls/targets/sac/service_terms, NAO para a linha de jobs).
--
-- Article 8: nenhuma tabela de saldo, nenhuma RPC de escrow tocada. Em shift_payments mudam so
-- predicados de policy e a ciencia do trigger de imutabilidade sobre o novo ator; colunas
-- financeiras intocadas (A22).
--
-- METODO: corpo de funcao editado por pg_get_functiondef + replace literal com ASSERCAO de contagem
-- (condicao D4). Sem barra invertida nem retrovisao em regex (ver E0). Policy: assercao de que a
-- vigente contem o marcador antigo (ou o novo, em reaplicacao) antes de DROP/CREATE.
--
-- DOWN (rollback) — seguro enquanto C6 do gate mostrar ZERO encarregados; reverter ANTES de E2:
--   -- Policies: recriar com is_company_owner(company_id) como em 20260818100200 (jobs, team_connections,
--   --   shift_payments), 20260817001100 (service_terms), 20260817000300 (team_lists/members),
--   --   20260824000500 (cil_select_operator_ou_elenco), 20260825000100 (notifications_insert...).
--   --   jobs: WITH CHECK/USING (public.is_company_owner(company_id)).
--   -- Triggers/funcoes por replace literal INVERSO (mesma tecnica, trechos abaixo):
--   --   enforce_shift_payment_immutability: 'v_is_company := public.is_job_owner(NEW.job_id);'
--   --        -> 'v_is_company := public.is_company_owner(NEW.company_id);' e remover o bloco
--   --        'E3: ->voided exige Gestor' (marcado por comentario).
--   --   DROP FUNCTION public.get_shift_worker_payment_card(uuid);
--   --   DROP TRIGGER trg_jobs_soft_delete_guard ON public.jobs; DROP FUNCTION public.jobs_soft_delete_guard();
--   --   create_sos_call / sos_call_eligibility: replace literal inverso (v_job.company_id -> o par
--   --        `v_uid OR owner_id = v_uid` original; is_company_owner(...) -> is_job_owner(p_job_id)).
--   --   list_team_connection_cards: is_company_member_confirmed(c.id) -> is_company_owner(c.id).
--   --   DROP TRIGGER trg_team_connections_invited_by ON public.team_connections;
--   --   DROP TRIGGER trg_team_connections_invited_by_immutable ON public.team_connections;
--   --   DROP FUNCTION public.team_connections_invited_by_guard();
--   --   notify_counterpart_on_application_cancel: replace literal inverso (`is_job_owner(NEW.job_id)`
--   --        -> `auth.uid() = v_company_id`; `SELECT rcp, ... FROM notification_recipients_for_job(...)`
--   --        -> `VALUES (v_company_id, ...)`).

-- ============================================================================
-- 0. ASSERCOES
-- ============================================================================
DO $mig$
DECLARE
    r       record;
    v_n     bigint;
BEGIN
    IF to_regprocedure('public.session_can_operate_job(uuid, uuid, date)') IS NULL
       OR to_regprocedure('public.notification_recipients_for_job(uuid)') IS NULL
       OR to_regprocedure('public.is_company_member_confirmed(uuid)') IS NULL
       OR to_regprocedure('public.internal_company_active_operator(uuid, uuid)') IS NULL THEN
        RAISE EXCEPTION 'ASSERCAO E3: E0/E1/E2 nao aplicadas (helpers do seam ausentes). HALT.';
    END IF;

    IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                    WHERE table_schema='public' AND table_name='team_connections' AND column_name='invited_by') THEN
        RAISE EXCEPTION 'ASSERCAO E3: team_connections.invited_by ausente (E1). HALT.';
    END IF;

    IF EXISTS (SELECT 1 FROM public.company_members WHERE role <> 'manager') THEN
        RAISE EXCEPTION 'ASSERCAO E3: existe company_members com role <> manager. E3 precisa vir antes de E4. HALT.';
    END IF;

    -- G3 / C7: as tabelas que passam a ancorar em job_id precisam ter company_id denormalizado
    -- IDENTICO ao do turno, senao a troca de predicado MUDA quem enxerga a linha.
    SELECT (SELECT count(*) FROM public.shift_payments sp JOIN public.jobs j ON j.id = sp.job_id
             WHERE sp.company_id IS DISTINCT FROM j.company_id)
         + (SELECT count(*) FROM public.service_terms st JOIN public.jobs j ON j.id = st.job_id
             WHERE st.company_id IS DISTINCT FROM j.company_id)
         + (SELECT count(*) FROM public.shift_calls sc JOIN public.jobs j ON j.id = sc.job_id
             WHERE sc.company_id IS DISTINCT FROM j.company_id)
      INTO v_n;
    IF v_n <> 0 THEN
        RAISE EXCEPTION
          'ASSERCAO E3 (C7): % linha(s) com company_id denormalizado divergente do turno em '
          'shift_payments/service_terms/shift_calls. A troca company_id -> job_id mudaria acesso. HALT -> architect.', v_n;
    END IF;

    -- A2/SOS reancorado em v_job.company_id: se existir company com id <> owner_id E conexoes de
    -- Elenco gravadas com company_id = uid do DONO (legado), a exclusao de bloqueados do pool de SOS
    -- deixaria de enxergar esse veto. Hoje: 13 contas com id = owner_id => 0 linhas. HALT se mudar.
    SELECT count(*) INTO v_n
      FROM public.companies c
      JOIN public.team_connections tc ON tc.company_id = c.owner_id
     WHERE c.owner_id IS NOT NULL AND c.id <> c.owner_id;
    IF v_n <> 0 THEN
        RAISE EXCEPTION
          'ASSERCAO E3 (SOS): % conexao(oes) de Elenco gravada(s) com company_id = uid do dono de uma '
          'company com id <> owner_id (legado). A reancoragem em v_job.company_id furaria o veto do '
          'freela no SOS. Migrar esses vinculos antes. HALT -> architect.', v_n;
    END IF;

    -- Cada policy alvo precisa existir com o predicado antigo (ou ja com o novo, em reaplicacao).
    FOR r IN
        SELECT * FROM (VALUES
            ('jobs',                  'jobs_insert_company_owner',             'is_company_owner', 'session_can_operate_job'),
            ('jobs',                  'jobs_update_company_owner',             'is_company_owner', 'session_can_operate_job'),
            ('shift_payments',        'sp_select_participants',                'is_company_owner', 'is_job_owner'),
            ('shift_payments',        'sp_insert_company',                     'is_company_owner', 'is_job_owner'),
            ('shift_payments',        'sp_update_company',                     'is_company_owner', 'is_job_owner'),
            ('service_terms',         'st_select_participants',                'is_company_owner', 'is_job_owner'),
            ('team_connections',      'tc_select_participants',                'is_company_owner', 'is_company_member_confirmed'),
            ('team_connections',      'tc_insert_company',                     'is_company_owner', 'is_company_member_confirmed'),
            ('team_lists',            'team_lists_select',                     'is_company_owner', 'is_company_member_confirmed'),
            ('team_list_members',     'team_list_members_select',              'is_company_owner', 'is_company_member_confirmed'),
            ('company_invite_links',  'cil_select_operator_ou_elenco',         'is_company_owner', 'is_company_member_confirmed'),
            ('notifications',         'notifications_insert_self_or_connected','is_company_owner', 'is_company_member_confirmed')
        ) AS v(tbl, pol, marker_old, marker_new)
    LOOP
        IF NOT EXISTS (
            SELECT 1 FROM pg_policies p
             WHERE p.schemaname = 'public' AND p.tablename = r.tbl AND p.policyname = r.pol
               AND (strpos(coalesce(p.qual, '') || coalesce(p.with_check, ''), r.marker_old) > 0
                 OR strpos(coalesce(p.qual, '') || coalesce(p.with_check, ''), r.marker_new) > 0)
        ) THEN
            RAISE EXCEPTION
              'ASSERCAO E3: policy %.% nao existe com o predicado esperado (%). O catalogo mudou -- '
              'reconferir antes de recriar, para nao ressuscitar regra vencida. HALT.',
              r.tbl, r.pol, r.marker_old;
        END IF;
    END LOOP;
END
$mig$;

-- ============================================================================
-- 1. jobs (G2) — ramo encarregado. SELECT (USING true) e DELETE (Gestor) NAO mudam.
--    Policy de jobs avalia o NEW/OLD da PROPRIA linha: por isso session_can_operate_job com os
--    valores da linha, e nao is_job_owner(id) (que releria a tabela pelo snapshot do statement).
--    INSERT do encarregado exige responsible_id = auth.uid() (ele so cria turno PROPRIO); o trigger
--    jobs_responsible_guard (E2) ja rodou antes do WITH CHECK e preencheu o valor.
-- ============================================================================
DROP POLICY IF EXISTS "jobs_insert_company_owner" ON public.jobs;
CREATE POLICY "jobs_insert_company_owner" ON public.jobs
    FOR INSERT TO authenticated
    WITH CHECK (
        public.is_company_owner(company_id)
        OR (
            responsible_id = (SELECT auth.uid())
            AND public.session_can_operate_job(
                    company_id,
                    responsible_id,
                    (start_date AT TIME ZONE 'America/Sao_Paulo')::date)
        )
    );

DROP POLICY IF EXISTS "jobs_update_company_owner" ON public.jobs;
CREATE POLICY "jobs_update_company_owner" ON public.jobs
    FOR UPDATE TO authenticated
    USING (
        public.session_can_operate_job(
            company_id,
            responsible_id,
            (start_date AT TIME ZONE 'America/Sao_Paulo')::date)
    )
    WITH CHECK (
        public.session_can_operate_job(
            company_id,
            responsible_id,
            (start_date AT TIME ZONE 'America/Sao_Paulo')::date)
    );

-- jobs_delete_company_owner: INALTERADA (is_company_owner) — apagar turno e do Gestor (G).

-- ============================================================================
-- 2. shift_payments (G3) — policies ancoram em is_job_owner(job_id)
--    sp_insert_company GANHA a amarra company_id = empresa do turno: antes o predicado ancorava em
--    company_id direto (um operador so inseria para a PROPRIA empresa); ancorando em job_id, sem
--    esta amarra um operador do turno X poderia gravar company_id de OUTRA empresa na linha.
-- ============================================================================
DROP POLICY IF EXISTS "sp_select_participants" ON public.shift_payments;
CREATE POLICY "sp_select_participants" ON public.shift_payments
    FOR SELECT TO authenticated
    USING (
        worker_id = (SELECT auth.uid())
        OR public.is_job_owner(job_id)
    );

DROP POLICY IF EXISTS "sp_insert_company" ON public.shift_payments;
CREATE POLICY "sp_insert_company" ON public.shift_payments
    FOR INSERT TO authenticated
    WITH CHECK (
        public.is_job_owner(job_id)
        AND company_id = (SELECT j.company_id FROM public.jobs j WHERE j.id = shift_payments.job_id)
        AND recorded_by = (SELECT auth.uid())
        AND status IN ('scheduled', 'recorded')
        AND worker_confirmed_at IS NULL
        AND voided_at IS NULL
        AND void_reason IS NULL
    );

DROP POLICY IF EXISTS "sp_update_company" ON public.shift_payments;
CREATE POLICY "sp_update_company" ON public.shift_payments
    FOR UPDATE TO authenticated
    USING (
        public.is_job_owner(job_id)
        AND status IN ('scheduled', 'recorded')
    )
    WITH CHECK (
        public.is_job_owner(job_id)
        AND status IN ('scheduled', 'recorded', 'voided')
    );
-- sp_update_worker: INALTERADA. Continua SEM policy de DELETE (auditoria nao se apaga).

-- ============================================================================
-- 3. service_terms — SELECT por is_job_owner (encarregado ve o termo do PROPRIO turno)
-- ============================================================================
DROP POLICY IF EXISTS "st_select_participants" ON public.service_terms;
CREATE POLICY "st_select_participants" ON public.service_terms
    FOR SELECT TO authenticated
    USING (
        worker_id = (SELECT auth.uid())
        OR public.is_job_owner(job_id)
    );

-- ============================================================================
-- 4. team_connections (R7, R10b, R10c, ADR elenco-unico)
--    SELECT: membro CONFIRMADO le o Elenco da company. INSERT: so 'pending', por Gestor ou membro
--    confirmado — a policy ancora SO em company_id pelo seam. invited_by NAO aparece em NENHUM
--    predicado de autorizacao (R10c / D8): o valor vem de trigger. UPDATE/DELETE continuam Gestor-only.
-- ============================================================================
DROP POLICY IF EXISTS "tc_select_participants" ON public.team_connections;
CREATE POLICY "tc_select_participants" ON public.team_connections
    FOR SELECT TO authenticated
    USING (
        worker_id = (SELECT auth.uid())
        OR public.is_company_member_confirmed(company_id)
    );

DROP POLICY IF EXISTS "tc_insert_company" ON public.team_connections;
CREATE POLICY "tc_insert_company" ON public.team_connections
    FOR INSERT TO authenticated
    WITH CHECK (
        status = 'pending'
        AND public.is_company_member_confirmed(company_id)
    );

-- Rastro de quem da empresa trouxe o freela, protegido por trigger (nao por policy):
--   INSERT: sessao que OPERA a empresa -> invited_by := auth.uid() (o cliente nao escolhe; payload
--           forjado e sobrescrito). Sessao NULA (service_role/cron) passa intacta. Sessao que NAO
--           opera a empresa (freela aceitando por link via RPC DEFINER) -> NULL: o rastro e "quem da
--           empresa trouxe", nunca o proprio freela.
--   UPDATE: imutavel para qualquer sessao. Sessao nula passa (anonymize_account anula o titular).
CREATE OR REPLACE FUNCTION public.team_connections_invited_by_guard()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
    IF auth.uid() IS NULL THEN
        RETURN NEW;
    END IF;

    IF TG_OP = 'INSERT' THEN
        IF public.internal_company_active_operator(NEW.company_id, auth.uid()) THEN
            NEW.invited_by := auth.uid();
        ELSE
            NEW.invited_by := NULL;
        END IF;
    ELSIF NEW.invited_by IS DISTINCT FROM OLD.invited_by THEN
        RAISE EXCEPTION 'team_connections.invited_by e imutavel (rastro de auditoria).'
            USING ERRCODE = '42501';
    END IF;

    RETURN NEW;
END;
$$;

COMMENT ON FUNCTION public.team_connections_invited_by_guard() IS
    'BEFORE INSERT OR UPDATE OF invited_by em team_connections: INSERT forca invited_by = quem da '
    'empresa convidou (sessao nula passa; sessao que nao opera a empresa grava NULL); UPDATE torna a '
    'coluna imutavel (sessao nula passa, para anonymize_account). SO auditoria — nenhuma policy/funcao '
    'concede acesso por invited_by (spec R10c, ADR-20261123-elenco-unico-da-company decisao 2). Nao '
    'toca saldo (Article 8).';

REVOKE ALL ON FUNCTION public.team_connections_invited_by_guard() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.team_connections_invited_by_guard() TO authenticated, service_role;

DROP TRIGGER IF EXISTS trg_team_connections_invited_by ON public.team_connections;
CREATE TRIGGER trg_team_connections_invited_by
    BEFORE INSERT ON public.team_connections
    FOR EACH ROW
    EXECUTE FUNCTION public.team_connections_invited_by_guard();

DROP TRIGGER IF EXISTS trg_team_connections_invited_by_immutable ON public.team_connections;
CREATE TRIGGER trg_team_connections_invited_by_immutable
    BEFORE UPDATE OF invited_by ON public.team_connections
    FOR EACH ROW
    EXECUTE FUNCTION public.team_connections_invited_by_guard();

-- ============================================================================
-- 5. team_lists / team_list_members — leitura para membro confirmado (chips do ShiftCallModal).
--    INSERT/UPDATE/DELETE continuam Gestor-only (is_company_owner), inalterados.
-- ============================================================================
DROP POLICY IF EXISTS "team_lists_select" ON public.team_lists;
CREATE POLICY "team_lists_select" ON public.team_lists
    FOR SELECT TO authenticated
    USING (public.is_company_member_confirmed(company_id));

DROP POLICY IF EXISTS "team_list_members_select" ON public.team_list_members;
CREATE POLICY "team_list_members_select" ON public.team_list_members
    FOR SELECT TO authenticated
    USING (EXISTS (SELECT 1 FROM public.team_lists tl
                    WHERE tl.id = team_list_members.list_id
                      AND public.is_company_member_confirmed(tl.company_id)));

-- ============================================================================
-- 6. company_invite_links — o link e da COMPANY: membro confirmado le; rotacionar e Gestor-only
--    (get_company_invite_token exige is_company_owner). Risco aceito e registrado no ADR
--    elenco-unico (decisao 5): ex-encarregado conhece um token que segue valido; a mitigacao e o
--    Gestor rotacionar na remocao, nunca automatico.
--    B4/B5 (seguranca) -> ANOTACAO PARA E4: remove_company_member DEVE avisar o Gestor (copy +
--    retorno da RPC) para rotacionar o link de convite do Elenco depois de remover um encarregado.
--    Sem mudanca de codigo aqui.
-- ============================================================================
DROP POLICY IF EXISTS cil_select_operator_ou_elenco ON public.company_invite_links;
CREATE POLICY cil_select_operator_ou_elenco ON public.company_invite_links
    FOR SELECT
    USING (
        public.is_company_member_confirmed(company_id)
        OR EXISTS (
            SELECT 1 FROM public.team_connections tc
             WHERE tc.company_id = company_invite_links.company_id
               AND tc.worker_id  = auth.uid()
               AND tc.status     = 'accepted'
        )
    );

COMMENT ON POLICY cil_select_operator_ou_elenco ON public.company_invite_links IS
    'Le o token: Gestor, encarregado ATIVO CONFIRMADO (is_company_member_confirmed — o link e da '
    'company, E3 de equipe-encarregados) e quem tem vinculo ACEITO com ela (link transitivo da '
    'Carteira de Clientes). pending e blocked nao leem (DS-PII-1). Rotacao: so Gestor.';

-- ============================================================================
-- 7. notifications_insert_self_or_connected — o INSERT best-effort do client (shiftCallService /
--    shiftInviteService) falharia CALADO para o encarregado: ramo empresa->freela passa a aceitar
--    membro confirmado. Ramo freela->empresa e o proprio auth.uid() ficam IDENTICOS.
-- ============================================================================
DROP POLICY IF EXISTS "notifications_insert_self_or_connected" ON public.notifications;
CREATE POLICY "notifications_insert_self_or_connected"
    ON public.notifications
    FOR INSERT
    WITH CHECK (
        auth.uid() = user_id
        OR EXISTS (
            SELECT 1
              FROM public.team_connections tc
             WHERE tc.status = 'accepted'
               AND (
                     -- Empresa avisando o freela: quem OPERA a empresa (Gestor) ou encarregado
                     -- confirmado.
                     (public.is_company_member_confirmed(tc.company_id) AND tc.worker_id = notifications.user_id)
                     -- Freela avisando a empresa: inalterado.
                  OR (tc.worker_id = auth.uid() AND tc.company_id = notifications.user_id)
                 )
        )
    );

COMMENT ON POLICY "notifications_insert_self_or_connected" ON public.notifications IS
    'Quem pode criar aviso para outra pessoa: para si mesmo; da empresa para o freela com vinculo '
    'ACEITO quando a sessao e Gestor ou encarregado confirmado (is_company_member_confirmed, E3 de '
    'equipe-encarregados); e do freela para a empresa do vinculo. Aviso "a empresa" por trigger usa '
    'notification_recipients_for_job.';

-- ============================================================================
-- 8. enforce_shift_payment_immutability (G3) — "empresa" = quem opera o TURNO; ->voided so Gestor
--    Baseline: corpo VIGENTE do catalogo (20260821000400 + patch 20260824000300). Dois replaces,
--    cada um com assercao de contagem exata:
--      (a) v_is_company := is_company_owner(NEW.company_id)  ->  is_job_owner(NEW.job_id)
--      (b) no ramo `ELSIF v_is_company THEN`, ->voided exige is_company_owner (RLS nao distingue
--          coluna; o trigger distingue).
--    A particao por papel, as colunas imutaveis, o expurgo LGPD e a regra "empresa nao toca
--    worker_confirmed_at" ficam INTACTOS. Sessao nula (cron/service_role) continua atravessando
--    (o bloco inteiro so roda com auth.uid() NOT NULL).
-- ============================================================================
DO $mig$
DECLARE
    v_def   text;
    v_novo  text;
    v_hit   text;
    v_n     integer;
    v_pat_a text :=
        'v_is_company[[:space:]]*:=[[:space:]]*public[.]is_company_owner[(]NEW[.]company_id[)];';
    v_pat_b text :=
        'ELSIF v_is_company THEN';
BEGIN
    v_def := pg_get_functiondef('public.enforce_shift_payment_immutability()'::regprocedure);

    IF position('E3: ->voided exige Gestor' IN v_def) > 0 THEN
        RAISE NOTICE 'E3: enforce_shift_payment_immutability ja atualizada; nada a fazer.';
        RETURN;
    END IF;

    SELECT count(*) INTO v_n FROM regexp_matches(v_def, v_pat_a, 'g');
    IF v_n <> 1 THEN
        RAISE EXCEPTION 'ASSERCAO E3(a): % ocorrencia(s) de v_is_company := is_company_owner(NEW.company_id) (esperado 1). Funcao mudou -- HALT.', v_n;
    END IF;
    v_hit  := (regexp_match(v_def, v_pat_a))[1];
    v_novo := replace(v_def, v_hit, 'v_is_company := public.is_job_owner(NEW.job_id);');

    SELECT count(*) INTO v_n FROM regexp_matches(v_novo, v_pat_b, 'g');
    IF v_n <> 1 THEN
        RAISE EXCEPTION 'ASSERCAO E3(b): % ocorrencia(s) de "ELSIF v_is_company THEN" (esperado 1). Funcao mudou -- HALT.', v_n;
    END IF;
    v_novo := replace(v_novo, v_pat_b,
        v_pat_b || chr(10) ||
        '            -- E3: ->voided exige Gestor. Quem opera so o PROPRIO turno (encarregado/cobertura) registra e' || chr(10) ||
        '            -- efetiva pagamento, mas NAO estorna nem cancela (Assumido na spec, Open item 1).' || chr(10) ||
        '            IF NEW.status = ''voided'' AND OLD.status IS DISTINCT FROM ''voided''' || chr(10) ||
        '               AND NOT public.is_company_owner(NEW.company_id) THEN' || chr(10) ||
        '                RAISE EXCEPTION ''shift_payments: apenas o Gestor da empresa pode estornar ou cancelar um pagamento.'';' || chr(10) ||
        '            END IF;');

    IF position('is_job_owner(NEW.job_id)' IN v_novo) = 0
       OR position('E3: ->voided exige Gestor' IN v_novo) = 0 THEN
        RAISE EXCEPTION 'ASSERCAO E3: a reescrita de enforce_shift_payment_immutability nao produziu o esperado. HALT.';
    END IF;

    EXECUTE v_novo;
END
$mig$;

COMMENT ON FUNCTION public.enforce_shift_payment_immutability() IS
    'Imutabilidade e particao por papel de shift_payments (modo A). "A empresa" = is_job_owner(job) '
    '(Gestor, ou encarregado responsavel/cobertura — E3 de equipe-encarregados); ->voided exige '
    'is_company_owner (so Gestor estorna/cancela). Colunas materiais imutaveis para todos os papeis; '
    'a empresa continua impedida de tocar em worker_confirmed_at (e do freela). Expurgo LGPD '
    '(20260821000400) intacto. Sessao nula atravessa. Nao toca saldo (Article 8).';

-- ============================================================================
-- 9. get_shift_worker_payment_card — PII do freela para o ENCARREGADO, por projecao fechada
--    (ADR-20261123-encarregado-confirmado-e-pii, decisao 2). can_view_worker_profile NAO e tocada:
--    e predicado de LINHA e nao corta colunas (CPF/nascimento iriam junto). O ramo 2 dela segue
--    Gestor-only (is_company_owner), como antes de E3. O encarregado le por aqui: nome, avatar,
--    telefone e PIX — SO de freelas hired/in_progress/completed de turno que ele OPERA
--    (is_job_owner; invited/declined/cancelled nunca liberam). CPF e birth_date NUNCA saem.
--    O Gestor tambem pode usar (is_job_owner o inclui).
-- ============================================================================
CREATE OR REPLACE FUNCTION public.get_shift_worker_payment_card(p_job_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_out jsonb;
BEGIN
    IF auth.uid() IS NULL THEN
        RETURN jsonb_build_object('outcome', 'unauthenticated');
    END IF;
    IF p_job_id IS NULL OR NOT public.is_job_owner(p_job_id) THEN
        RETURN jsonb_build_object('outcome', 'forbidden');
    END IF;

    SELECT COALESCE(jsonb_agg(
               jsonb_build_object(
                   'application_id', a.id,
                   'worker_id',      w.id,
                   'status',         a.status,
                   'full_name',      w.full_name,
                   'avatar_url',     w.avatar_url,
                   'phone',          w.phone,
                   'pix_key',        w.pix_key
               ) ORDER BY w.full_name, w.id), '[]'::jsonb)
      INTO v_out
      FROM public.applications a
      JOIN public.workers w ON w.id = a.worker_id
     WHERE a.job_id = p_job_id
       AND a.status IN ('hired', 'in_progress', 'completed');

    RETURN jsonb_build_object('outcome', 'ok', 'items', v_out);
END;
$$;

COMMENT ON FUNCTION public.get_shift_worker_payment_card(uuid) IS
    'Cartao de pagamento por freela de UM turno que a sessao opera (is_job_owner): application_id, '
    'worker_id, status, full_name, avatar_url, phone, pix_key — projecao EXAUSTIVA e fechada, NUNCA '
    'to_jsonb(w.*). So applications hired/in_progress/completed. CPF e birth_date nunca saem. '
    'Frontend do encarregado usa esta RPC em vez do embed worker:workers(...) (que volta null pela '
    'RLS). ADR-20261123-encarregado-confirmado-e-pii. Nao toca saldo (Article 8).';

REVOKE ALL ON FUNCTION public.get_shift_worker_payment_card(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_shift_worker_payment_card(uuid) TO authenticated, service_role;

-- ============================================================================
-- 10. list_team_connection_cards — membro confirmado ve os cartoes (projecao fechada, sem PII).
--     Predicado avaliado por EMPRESA (forma de 20260822000200): 1 ocorrencia de is_company_owner(c.id).
-- ============================================================================
DO $mig$
DECLARE
    v_def  text;
    v_novo text;
    v_n    integer;
    v_pat  text := 'public[.]is_company_owner[(]c[.]id[)]';
BEGIN
    v_def := pg_get_functiondef('public.list_team_connection_cards()'::regprocedure);

    IF position('is_company_member_confirmed' IN v_def) > 0 THEN
        RAISE NOTICE 'E3: list_team_connection_cards ja atualizada; nada a fazer.';
        RETURN;
    END IF;

    SELECT count(*) INTO v_n FROM regexp_matches(v_def, v_pat, 'g');
    IF v_n <> 1 THEN
        RAISE EXCEPTION 'ASSERCAO E3: % ocorrencia(s) de is_company_owner(c.id) em list_team_connection_cards (esperado 1). Funcao mudou -- HALT.', v_n;
    END IF;

    v_novo := replace(v_def, 'public.is_company_owner(c.id)', 'public.is_company_member_confirmed(c.id)');

    IF position('is_company_member_confirmed(c.id)' IN v_novo) = 0 THEN
        RAISE EXCEPTION 'ASSERCAO E3: a substituicao nao produziu o predicado novo. HALT.';
    END IF;

    EXECUTE v_novo;
END
$mig$;

COMMENT ON FUNCTION public.list_team_connection_cards() IS
    'Cartoes do Elenco com projecao FECHADA de 6 campos nao-PII (DS-PII-2). DEFINER porque '
    'can_view_worker_profile nega leitura de workers para conexao pending. Autorizacao: Gestor OU '
    'encarregado ativo CONFIRMADO (is_company_member_confirmed, E3 de equipe-encarregados), avaliada '
    'por EMPRESA. Elenco compartilhado nao concede PII.';

-- ============================================================================
-- 10b. (renumerado) notify_counterpart_on_application_cancel (R21, A18) — EDICAO DO CORPO DO
--     CATALOGO (D4). Nao e recriada a mao: o corpo vigente carrega acentos restaurados
--     (20260823000800) e o RAISE WARNING de 20260824000900. ATENCAO: 20260824000900 usou
--     regexp_replace SEM 'g', entao no catalogo o RAISE WARNING esta no bloco EXCEPTION INTERNO (o
--     do sufixo de data); o EXCEPTION externo continua mudo. Esta migration NAO mexe nesses blocos:
--     so edita dois pontos.
--       (i)  ator "empresa" = quem OPERA o turno (is_job_owner) — antes `auth.uid() = v_company_id`;
--       (ii) os DOIS INSERTs "a empresa" (freela cancelou; ator desconhecido) trocam
--            `VALUES (v_company_id, ...)` por `SELECT rcp, ... FROM notification_recipients_for_job`.
--     O aviso ao FREELA (empresa cancelou) e o texto de cada mensagem ficam intactos.
-- ============================================================================
DO $mig$
DECLARE
    v_def      text;
    v_novo     text;
    v_hit      text;
    v_rest     text;
    v_tail     text;
    v_n        integer;
    v_pat_act  text := 'WHEN auth[.]uid[(][)] = v_company_id[[:space:]]+THEN ''company''';
    -- primeiro quantificador NAO-guloso: em ARE ele define a preferencia da ER inteira.
    v_pat_ins  text := 'VALUES [(][[:space:]]+?v_company_id,.*?[)];';
BEGIN
    v_def := pg_get_functiondef('public.notify_counterpart_on_application_cancel()'::regprocedure);

    IF position('notification_recipients_for_job' IN v_def) > 0 THEN
        RAISE NOTICE 'E3: notify_counterpart_on_application_cancel ja editada; nada a fazer.';
        RETURN;
    END IF;

    IF position('v_actor' IN v_def) = 0 OR position('v_company_id' IN v_def) = 0
       OR position('engoliu um erro' IN v_def) = 0 THEN
        RAISE EXCEPTION 'ASSERCAO E3: notify_counterpart_on_application_cancel nao tem o corpo esperado. HALT.';
    END IF;

    -- (i)
    SELECT count(*) INTO v_n FROM regexp_matches(v_def, v_pat_act, 'g');
    IF v_n <> 1 THEN
        RAISE EXCEPTION 'ASSERCAO E3(ator): % ocorrencia(s) de "auth.uid() = v_company_id THEN company" (esperado 1). HALT.', v_n;
    END IF;
    v_hit  := (regexp_match(v_def, v_pat_act))[1];
    v_novo := replace(v_def, v_hit, 'WHEN auth.uid() IS NOT NULL AND public.is_job_owner(NEW.job_id) THEN ''company''');

    -- (ii)
    SELECT count(*) INTO v_n FROM regexp_matches(v_novo, v_pat_ins, 'g');
    IF v_n <> 2 THEN
        RAISE EXCEPTION 'ASSERCAO E3(destinatarios): % INSERT(s) VALUES (v_company_id, ...) (esperado 2: freela cancelou + ator desconhecido). HALT.', v_n;
    END IF;
    FOR v_hit IN SELECT DISTINCT m[1] FROM regexp_matches(v_novo, v_pat_ins, 'g') AS m
    LOOP
        v_rest := substr(v_hit, position('v_company_id,' IN v_hit) + length('v_company_id,'));
        v_rest := left(v_rest, length(v_rest) - 2);              -- remove o ');' final
        v_novo := replace(v_novo, v_hit,
            'SELECT rcp,' || v_rest || ' FROM public.notification_recipients_for_job(NEW.job_id) AS rcp;');
    END LOOP;

    -- (iii) o EXCEPTION WHEN OTHERS EXTERNO engolia mudo: se notification_recipients_for_job falhar,
    --       o aviso a empresa sumiria sem rastro. Acrescenta RAISE WARNING com SQLSTATE/SQLERRM
    --       SO no ultimo bloco (o externo); o WARNING interno (data) fica intacto.
    SELECT count(*) INTO v_n FROM regexp_matches(v_novo, 'EXCEPTION[[:space:]]+WHEN[[:space:]]+OTHERS[[:space:]]+THEN', 'g');
    IF v_n <> 2 THEN
        RAISE EXCEPTION 'ASSERCAO E3(excecao externa): % bloco(s) EXCEPTION WHEN OTHERS (esperado 2: interno da data + externo). HALT.', v_n;
    END IF;
    v_tail := substring(v_novo from '(EXCEPTION[[:space:]]+WHEN[[:space:]]+OTHERS[[:space:]]+THEN(?:(?!EXCEPTION).)*$)');
    IF v_tail IS NULL OR position('RAISE WARNING' IN v_tail) > 0 THEN
        RAISE EXCEPTION 'ASSERCAO E3(excecao externa): o bloco externo ja tem RAISE WARNING ou nao foi localizado. HALT.';
    END IF;
    v_hit  := (regexp_match(v_tail, 'EXCEPTION[[:space:]]+WHEN[[:space:]]+OTHERS[[:space:]]+THEN'))[1];
    v_novo := left(v_novo, length(v_novo) - length(v_tail))
              || v_hit || chr(10)
              || '    RAISE WARNING ''public.notify_counterpart_on_application_cancel (externo) engoliu um erro: % %'', SQLSTATE, SQLERRM;'
              || substr(v_tail, length(v_hit) + 1);

    v_n := (length(v_novo) - length(replace(v_novo, 'notification_recipients_for_job', '')))
           / length('notification_recipients_for_job');
    IF v_n <> 2
       OR position('is_job_owner(NEW.job_id)' IN v_novo) = 0
       OR position('engoliu um erro' IN v_novo) = 0 THEN
        RAISE EXCEPTION 'ASSERCAO E3: a edicao de notify_counterpart_on_application_cancel nao produziu o esperado. HALT.';
    END IF;

    EXECUTE v_novo;
END
$mig$;

COMMENT ON FUNCTION public.notify_counterpart_on_application_cancel() IS
    'AFTER UPDATE em applications: invited|hired|in_progress -> cancelled notifica a CONTRAPARTE de '
    'quem cancelou. Ator por auth.uid(): freela; "empresa" = quem opera o turno (is_job_owner); '
    'ator desconhecido notifica os dois com texto neutro. O aviso "a empresa" vai a '
    'notification_recipients_for_job (responsavel efetivo confirmado + Gestores + operadores da '
    'organizacao + dono, sem duplicar; removido: so Gestores) — R21/A18 de equipe-encarregados. '
    'DEFINER + search_path vazio; nao move saldo (Article 8). Corpo editado sobre o do catalogo: o '
    'RAISE WARNING de 20260824000900 vive no bloco EXCEPTION interno (data), nao no externo.';

REVOKE EXECUTE ON FUNCTION public.notify_counterpart_on_application_cancel() FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.notify_counterpart_on_application_cancel() TO authenticated, service_role;

-- ============================================================================
-- 11b. create_sos_call / sos_call_eligibility — achado A2 de seguranca (ALTO)
--     Ambas herdam is_job_owner, mas cota, varredura de expirados e exclusao de Elenco/bloqueados
--     estao ancoradas em v_uid / owner_id (20260817001600). Para qualquer operador NAO-dono
--     (gerente, ja em producao, e encarregado) a contagem da 0: a cota nunca vale e o freela que
--     BLOQUEOU a empresa nao e excluido do pool — fura o veto indelevel. Correcao, por edicao do
--     catalogo (D4): reancora cota, varredura e exclusao em v_job.company_id (e o lock advisory na
--     company do turno) e torna as duas RPCs GESTOR-ONLY (is_company_owner da empresa do turno);
--     a spec R6 nao da SOS ao encarregado. No-op para as 13 contas (id = owner_id).
-- ============================================================================
DO $mig$
DECLARE
    v_alvo      text;
    v_def       text;
    v_novo      text;
    v_hit       text;
    v_n         integer;
    v_expected_quota integer;
    v_pat_quota text :=
        '[(][[:space:]]*sc[.]company_id = v_uid[[:space:]]+OR sc[.]company_id IN [(]SELECT c[.]id FROM public[.]companies c WHERE c[.]owner_id = v_uid[)][[:space:]]*[)]';
    v_pat_tc    text :=
        'tc[.]company_id = v_uid[[:space:]]+OR tc[.]company_id IN [(]SELECT c[.]id FROM public[.]companies c WHERE c[.]owner_id = v_uid[)]';
    v_pat_lock  text :=
        'PERFORM pg_advisory_xact_lock[(]hashtext[(]''worki:sos:'' [|][|] v_uid::text[)]::bigint[)];';
    c_gate_old  constant text := 'IF NOT public.is_job_owner(p_job_id) THEN';
    c_gate_new  constant text :=
        'IF NOT public.is_company_owner((SELECT j0.company_id FROM public.jobs j0 WHERE j0.id = p_job_id)) THEN';
BEGIN
    FOREACH v_alvo IN ARRAY ARRAY[
        'public.sos_call_eligibility(uuid)',
        'public.create_sos_call(uuid, text, text)'
    ]
    LOOP
        v_def := pg_get_functiondef(v_alvo::regprocedure);
        IF position('j0.company_id' IN v_def) > 0 THEN
            RAISE NOTICE 'E3: % ja reancorada; nada a fazer.', v_alvo;
            CONTINUE;
        END IF;
        v_novo := v_def;

        -- Gestor-only
        v_n := (length(v_novo) - length(replace(v_novo, c_gate_old, ''))) / length(c_gate_old);
        IF v_n <> 1 THEN
            RAISE EXCEPTION 'ASSERCAO E3(SOS gate) em %: % ocorrencia(s) de is_job_owner(p_job_id) (esperado 1). HALT.', v_alvo, v_n;
        END IF;
        v_novo := replace(v_novo, c_gate_old, c_gate_new);

        -- cota / varredura: 1 em eligibility, 2 em create (varredura + cota)
        v_expected_quota := CASE WHEN v_alvo LIKE '%eligibility%' THEN 1 ELSE 2 END;
        SELECT count(*) INTO v_n FROM regexp_matches(v_novo, v_pat_quota, 'g');
        IF v_n <> v_expected_quota THEN
            RAISE EXCEPTION 'ASSERCAO E3(SOS cota) em %: % ocorrencia(s) (esperado %). HALT.', v_alvo, v_n, v_expected_quota;
        END IF;
        FOR v_hit IN SELECT DISTINCT m[1] FROM regexp_matches(v_novo, v_pat_quota, 'g') AS m
        LOOP
            v_novo := replace(v_novo, v_hit, 'sc.company_id = v_job.company_id');
        END LOOP;

        IF v_alvo LIKE '%create_sos_call%' THEN
            -- exclusao de Elenco/bloqueados do pool: ancora na company do turno (veto indelevel)
            SELECT count(*) INTO v_n FROM regexp_matches(v_novo, v_pat_tc, 'g');
            IF v_n <> 1 THEN
                RAISE EXCEPTION 'ASSERCAO E3(SOS elenco): % ocorrencia(s) (esperado 1). HALT.', v_n;
            END IF;
            v_hit  := (regexp_match(v_novo, v_pat_tc))[1];
            v_novo := replace(v_novo, v_hit, 'tc.company_id = v_job.company_id');

            -- lock advisory por COMPANY do turno (a cota e da company)
            SELECT count(*) INTO v_n FROM regexp_matches(v_novo, v_pat_lock, 'g');
            IF v_n <> 1 THEN
                RAISE EXCEPTION 'ASSERCAO E3(SOS lock): % ocorrencia(s) (esperado 1). HALT.', v_n;
            END IF;
            v_hit  := (regexp_match(v_novo, v_pat_lock))[1];
            v_novo := replace(v_novo, v_hit,
                'PERFORM pg_advisory_xact_lock(hashtext(''worki:sos:'' || COALESCE((SELECT j1.company_id::text FROM public.jobs j1 WHERE j1.id = p_job_id), v_uid::text))::bigint);');
        END IF;

        -- nada ancorado em owner_id = v_uid pode sobrar
        IF position('owner_id = v_uid' IN v_novo) > 0 THEN
            RAISE EXCEPTION 'ASSERCAO E3(SOS): % ainda ancora em owner_id = v_uid apos a edicao. HALT.', v_alvo;
        END IF;

        EXECUTE v_novo;
    END LOOP;
END
$mig$;

COMMENT ON FUNCTION public.sos_call_eligibility(uuid) IS
    'O botão "Chamar fora do Elenco" deve aparecer? GESTOR-ONLY (is_company_owner da empresa do turno; '
    'A2 de segurança de equipe-encarregados). Cota por COMPANY do turno (v_job.company_id). NÃO '
    'devolve nada sobre o pool (nem tamanho): saber "há N elegíveis" seria prévia de alcance.';
COMMENT ON FUNCTION public.create_sos_call(uuid, text, text) IS
    'A ÚNICA porta pela qual um alvo fora do Elenco nasce. GESTOR-ONLY (is_company_owner da empresa '
    'do turno). Cota, varredura de expirados e exclusão de Elenco/bloqueados ancoradas em '
    'v_job.company_id (antes v_uid/owner_id: para operador não-dono a cota dava 0 e o freela que '
    'bloqueou a empresa não era excluído do pool — fura o veto indelével). Lock advisory por company. '
    'Devolve {outcome, call_id, targets_count, expires_at}, NUNCA a lista.';

-- ============================================================================
-- 12. jobs_soft_delete_guard (R27 / A26) — UPDATE cru -> status='deleted' por NAO-Gestor so em
--     turno VAZIO. Regra por dados, sem flag/GUC: zero applications vivas (qualquer status fora de
--     cancelled/declined/rejected) e zero shift_calls abertos. Gestor passa sempre; sessao nula
--     passa. Turno populado so e cancelado por cancel_job (RPC, E5), que antes cancela as
--     candidaturas (notificando os freelas) e os chamados — entao o UPDATE final cai em turno vazio.
--     No-op hoje: nenhum nao-Gestor existe.
-- ============================================================================
CREATE OR REPLACE FUNCTION public.jobs_soft_delete_guard()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
    IF auth.uid() IS NULL THEN
        RETURN NEW;
    END IF;
    IF public.is_company_owner(OLD.company_id) THEN
        RETURN NEW;
    END IF;

    IF EXISTS (SELECT 1 FROM public.applications a
                WHERE a.job_id = OLD.id
                  AND a.status NOT IN ('cancelled', 'declined', 'rejected'))
       OR EXISTS (SELECT 1 FROM public.shift_calls sc
                   WHERE sc.job_id = OLD.id AND sc.status = 'open') THEN
        RAISE EXCEPTION 'jobs: turno com candidaturas ou chamados vivos só pode ser cancelado por cancel_job (notifica os freelas).'
            USING ERRCODE = '42501';
    END IF;

    RETURN NEW;
END;
$$;

COMMENT ON FUNCTION public.jobs_soft_delete_guard() IS
    'BEFORE UPDATE OF status em jobs, so na transicao para deleted: nao-Gestor so cancela turno '
    'VAZIO (sem applications vivas nem shift_calls abertos). Gestor e sessao nula passam. cancel_job '
    '(E5) e o caminho do turno populado. Spec R27/A26. Nao toca saldo (Article 8).';

REVOKE ALL ON FUNCTION public.jobs_soft_delete_guard() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.jobs_soft_delete_guard() TO authenticated, service_role;

DROP TRIGGER IF EXISTS trg_jobs_soft_delete_guard ON public.jobs;
CREATE TRIGGER trg_jobs_soft_delete_guard
    BEFORE UPDATE OF status ON public.jobs
    FOR EACH ROW
    WHEN (NEW.status = 'deleted' AND OLD.status IS DISTINCT FROM 'deleted')
    EXECUTE FUNCTION public.jobs_soft_delete_guard();

-- ============================================================================
-- PENDENTE (fora desta migration, declarado)
-- ----------------------------------------------------------------------------
--   * claim_shift_slot / decline_shift_call / respond_attendance_confirmation avisam "a empresa"
--     resolvendo o destinatario como companies.owner_id/company_id (corpo vigente = 20260817001600 +
--     edicoes 20260824000800/000900; EXIGE leitura do catalogo). Trocar por
--     notification_recipients_for_job no E5. So afeta ROTEAMENTO de aviso, nao autorizacao.
--   * my_link_risk_config(p_company_id uuid DEFAULT NULL) com DROP da assinatura antiga (R7b/A25),
--     cancel_job (R27) e count_worker_shifts_by_week devolvendo jsonb {outcome:'not_confirmed'}
--     (muda o tipo de retorno; hoje e erro 42501 'not_confirmed'): E5 + frontend.
--   * get_my_companies ainda nao devolve role real / confirmed / team_enabled (E4).
--   * CHECK de company_members.role e RPCs de convite/remocao (E4). Sem encarregado, E0-E3 sao no-op.
--
-- VERIFICACAO: supabase/tests/equipe_e0_e3_auditoria.sql (A1 ANTES/DEPOIS, A2, A3, A21, A22).
-- ============================================================================

COMMIT;
