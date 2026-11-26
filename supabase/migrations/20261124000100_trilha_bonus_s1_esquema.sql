-- Migration: Trilha de bonus do operador, S1 — esquema, defesas de banco e seeds (INERTE)
-- File: supabase/migrations/20261124000100_trilha_bonus_s1_esquema.sql
-- Spec:  .harness/spec/trilha-bonus-operador/spec.md (Modelo de dados, R6, R7, AF1-AF10)
-- ADR:   .harness/memory-bank/decisions/ADR-20261124-trilha-bonus-operador.md (VINCULANTE; condicoes C1-C10)
--
-- O QUE E ISTO
-- ----------------------------------------------------------------------------
-- Obrigacao do caixa do Worki com o operador da empresa cliente (teto de R$300 por operador em N
-- semanas) + livro dos PIX pagos por fora, a mao, pelo dono. NAO e carteira, NAO e saldo, NAO passa
-- pelo razao financeiro do Worki: nenhuma tabela desta trilha le ou escreve o razao financeiro, e nenhuma
-- funcao de saldo e chamada (Article 8 intacto; ADR-20260822: processamento de pagamento pausado).
-- Dinheiro em CENTAVOS inteiros (`*_cents`). Nenhum identificador carrega nome de saldo/carteira.
--
-- DECISOES DESTA FATIA (todas rastreaveis ao ADR)
-- ----------------------------------------------------------------------------
--   C1  bonus_awards.tier NOT NULL DEFAULT 1 + UNIQUE (enrollment_id, milestone_id, tier): com NULL o
--       UNIQUE nao colide e ON CONFLICT DO NOTHING duplicaria o marco.
--   C3  bonus_shift_ledger e gravado UMA vez (recibo validado dos dois lados) e nunca refeito. A unica
--       mutacao permitida e a decisao do dono; `flag_state` e `decision` do spec viram UMA coluna so:
--       `review` ('none'|'open'|'approved'|'excluded').
--   C4  liberacao em 48h CALCULADA NA LEITURA: o award guarda so `state` em ('earned','not_counted',
--       'in_payout','paid'). Nao ha pg_cron nesta trilha.
--   C8  bonus_habit_snapshots NAO existe (habito/baseline sao derivados do historico).
--   C7  a AVALIACAO saiu da trilha: `reviews.reviewer_id` e o uuid da empresa, nao distingue a pessoa.
--       O marco 10 do spec foi REMOVIDO e seu valor (R$10) REDISTRIBUIDO no marco "Primeiro turno
--       completo" (R$20 -> R$30). Contador "N de 19" (A=4, B=7, C=6, D=2); E e premio fora do contador.
--       Soma por trilha = R$300 (A 30 + B 100 + C 100 + D 40 + E 30). O total vem do dado
--       (`counts_in_total`), nunca de constante de UI.
--   C9  tudo nasce com enabled=false e nenhuma inscricao e ativada.
--   Acesso: o operador NAO le tabela nenhuma da trilha (nem a propria): `milestones_snapshot` carrega
--       limiares de antifraude (AF7/AF9). Tudo que o operador ve sai de RPC de projecao fechada (S3).
--       RLS ligada, ZERO policy para anon/authenticated, GRANT so de SELECT a service_role.
--   Sem FK para applications/jobs/workers/companies de proposito: uuid pseudonimo retido (LGPD) e a
--       exclusao/anonimizacao dessas tabelas nao pode ser bloqueada por um livro de bonus.
--   Sem DELETE/TRUNCATE em tabela da trilha (trigger BEFORE DELETE/TRUNCATE + sem GRANT). Unica excecao
--       ao DELETE: bonus_vetos, apagado so pela RPC admin_bonus_veto_remove, com registro no log.
--
-- PENDENCIAS DECLARADAS (condicoes de ATIVACAO, nao de construcao; S4 as confere em set_enabled)
--   * E2-E5 de equipe-encarregados em producao (sem E3, team_connections.invited_by fica NULL e os
--     marcos 4 e 6 ficam inertes; sem E4/E5 nao existe papel de encarregado nem "Passar para").
--   * LGPD: S4 faz anonymize_account chamar a anonimizacao da trilha; ligar exige a sonda que a executa.
--
-- RODADA 2 (revisao de seguranca + avaliacao)
-- ----------------------------------------------------------------------------
--   A1  bonus_server_stamps: carimbo do SERVIDOR (clock_timestamp) e o ator de cada evidencia que o
--       cliente escreve (4 carimbos de applications, worker_confirmed_at, convite/aceite de Elenco,
--       primeiro aceite de chamado). O motor mede tempo SO por eles; o valor declarado so serve para
--       conferir divergencia (clock_tolerance_min). A atribuicao guarda job_created_at do servidor e a
--       agenda original do turno.
--   (b) stuck_times nasce DESLIGADA (stuck_times_enabled = 0).
--   (c) marcos de Elenco contam so convite direto (telefone/Worki ID); link grava invited_by NULL.
--   B1  UNIQUE (enrollment_id, job_id, worker_id) no livro.
--   B4  payout pago/cancelado e bonus_admin_log imutaveis (excecao estreita: anonimizacao, sessao nula).
--
-- NO-OP PARA AS 13 CONTAS ATUAIS: tabelas novas e vazias (so seed de trilha/marcos), nenhum trigger em
-- tabela existente nesta fatia (os ganchos vem em S2 e saem inertes: enabled=false), nenhuma policy
-- existente tocada.
--
-- DOWN (rollback) — seguro enquanto nada referencia (ordem: S4 -> S3 -> S2 -> S1):
--   DROP TABLE IF EXISTS public.bonus_admin_log, public.bonus_awards, public.bonus_payouts,
--       public.bonus_shift_ledger, public.bonus_events, public.bonus_attributions,
--       public.bonus_enrollments, public.bonus_milestones, public.bonus_tracks,
--       public.bonus_program_settings, public.bonus_vetos, public.bonus_server_stamps CASCADE;
--   DROP FUNCTION IF EXISTS public.bonus_payouts_guard(), public.bonus_admin_log_guard();
--   DROP FUNCTION IF EXISTS public.bonus_enrollments_guard(), public.bonus_awards_guard(),
--       public.bonus_ledger_guard(), public.bonus_events_append_only(), public.bonus_block_delete();
--
-- SIMULACAO CONTRA PRODUCAO (24/11/2026: E0 e E1 aplicadas; E2-E5 NAO; nenhuma tabela bonus_*):
--   gate 1 (E0/E1 no catalogo) ........ passa: session_company_member_role e internal_company_* existem.
--   gate 2 (colunas) .................. passa: applications 4 carimbos, shift_payments, shift_calls.created_by,
--                                        team_connections.invited_by, jobs.responsible_id (E1), companies.default_briefing.
--   gate 3 (estado parcial) ........... passa: nenhuma tabela bonus_* existe (e a unica que bloquearia seria
--                                        existir ALGUMA mas nao TODAS).
--   gate 4 (E2/E3) .................... NAO bloqueia: emite NOTICE (E2/E3 ausentes em producao hoje).
--   Se E0/E1 faltarem, o gate para ANTES de qualquer CREATE, acusando a ordem (sem efeito parcial: o bloco
--   DO inicial roda primeiro e a migration inteira e uma transacao).

-- ============================================================================
-- 0. PORTAO (assercoes; nada e criado se alguma falhar)
-- ============================================================================
DO $mig$
DECLARE
    v_faltando text := '';
    r          record;
    v_tabelas  integer;
BEGIN
    -- 1. seam de equipe: E0 e E1 (a trilha depende da identidade confirmada de E1)
    IF to_regprocedure('public.session_company_member_role(uuid)') IS NULL THEN
        v_faltando := v_faltando || ' [E0 20261123000100: session_company_member_role]';
    END IF;
    IF to_regprocedure('public.internal_company_active_operator(uuid, uuid)') IS NULL THEN
        v_faltando := v_faltando || ' [E1 20261123000200: internal_company_active_operator]';
    END IF;
    IF to_regprocedure('public.internal_company_confirmed_operator(uuid, uuid)') IS NULL THEN
        v_faltando := v_faltando || ' [E1 20261123000200: internal_company_confirmed_operator]';
    END IF;
    IF v_faltando <> '' THEN
        RAISE EXCEPTION
          'ASSERCAO S1: dependencia de equipe-encarregados ausente:%. Ordem obrigatoria: E0 (20261123000100) -> E1 (20261123000200) -> trilha S1..S4 (20261124000100..000400). Nada foi criado. HALT.',
          v_faltando;
    END IF;

    -- 2. colunas das tabelas existentes que a trilha le (nomes verificados no catalogo em 24/11/2026)
    FOR r IN
        SELECT * FROM (VALUES
            ('applications',     'worker_checkin_at'),
            ('applications',     'worker_checkout_at'),
            ('applications',     'company_checkin_confirmed_at'),
            ('applications',     'company_checkout_confirmed_at'),
            ('applications',     'job_id'),
            ('applications',     'worker_id'),
            ('applications',     'status'),
            ('shift_payments',   'worker_confirmed_at'),
            ('shift_payments',   'recorded_by'),
            ('shift_payments',   'status'),
            ('shift_payments',   'application_id'),
            ('shift_payments',   'job_id'),
            ('shift_payments',   'worker_id'),
            ('shift_calls',      'created_by'),
            ('shift_calls',      'first_claim_at'),
            ('shift_calls',      'status'),
            ('shift_call_targets','response'),
            ('team_connections', 'invited_by'),
            ('team_connections', 'status'),
            ('team_connections', 'created_at'),
            ('jobs',             'responsible_id'),
            ('jobs',             'start_date'),
            ('jobs',             'work_start_time'),
            ('jobs',             'work_end_time'),
            ('jobs',             'created_at'),
            ('jobs',             'status'),
            ('jobs',             'company_id'),
            ('jobs',             'title'),
            ('companies',        'default_briefing'),
            ('companies',        'owner_id'),
            ('companies',        'organization_id'),
            ('companies',        'name'),
            ('company_members',  'confirmed_at'),
            ('company_members',  'status'),
            ('workers',          'pix_key'),
            ('workers',          'phone'),
            ('workers',          'full_name'),
            ('workers',          'cpf'),
            ('applications',     'id'),
            ('team_connections', 'id'),
            ('shift_calls',      'id')
        ) AS v(tbl, col)
    LOOP
        IF NOT EXISTS (SELECT 1 FROM information_schema.columns c
                        WHERE c.table_schema = 'public' AND c.table_name = r.tbl AND c.column_name = r.col) THEN
            RAISE EXCEPTION 'ASSERCAO S1: coluna public.%.% ausente no catalogo. O schema mudou -- reconferir. HALT.', r.tbl, r.col;
        END IF;
    END LOOP;

    -- start_date precisa ser timestamptz (a trilha converte para data local de Sao Paulo)
    IF (SELECT c.data_type FROM information_schema.columns c
         WHERE c.table_schema = 'public' AND c.table_name = 'jobs' AND c.column_name = 'start_date')
       IS DISTINCT FROM 'timestamp with time zone' THEN
        RAISE EXCEPTION 'ASSERCAO S1: jobs.start_date nao e timestamptz. HALT -> architect.';
    END IF;

    -- 3. estado parcial: ou nenhuma tabela da trilha existe, ou todas as nove nucleares (reaplicacao)
    SELECT count(*) INTO v_tabelas
      FROM unnest(ARRAY['bonus_program_settings','bonus_tracks','bonus_milestones','bonus_enrollments',
                        'bonus_attributions','bonus_events','bonus_shift_ledger','bonus_awards',
                        'bonus_payouts','bonus_vetos','bonus_admin_log','bonus_server_stamps']) AS t(n)
     WHERE to_regclass('public.' || t.n) IS NOT NULL;
    IF v_tabelas NOT IN (0, 12) THEN
        RAISE EXCEPTION
          'ASSERCAO S1: estado parcial (% de 12 tabelas bonus_* existem). Alguem aplicou parte por fora: reconferir o catalogo antes de seguir. HALT.',
          v_tabelas;
    END IF;

    -- 4. informativos (NAO bloqueiam: sao condicao de ATIVACAO, C9)
    IF to_regprocedure('public.session_can_operate_job(uuid, uuid, date)') IS NULL THEN
        RAISE NOTICE 'S1: E2 (20261123000300) ausente: sem encarregado por turno. Trilha segue inerte (enabled=false).';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_trigger tg
                    WHERE tg.tgrelid = 'public.team_connections'::regclass
                      AND tg.tgname = 'trg_team_connections_invited_by' AND NOT tg.tgisinternal) THEN
        RAISE NOTICE 'S1: E3 (20261123000400) ausente: team_connections.invited_by fica NULL; marcos de Elenco (4 e 6) inertes ate E3 (C9).';
    END IF;
END
$mig$;

-- ============================================================================
-- 1. TABELAS
-- ============================================================================

-- 1.1 Interruptor global (singleton). Nasce DESLIGADO (C9).
CREATE TABLE IF NOT EXISTS public.bonus_program_settings (
    id               boolean     PRIMARY KEY DEFAULT true CHECK (id),
    enabled          boolean     NOT NULL DEFAULT false,
    min_payout_cents integer     NOT NULL DEFAULT 2500 CHECK (min_payout_cents >= 0),
    rules_version    text        NOT NULL DEFAULT 'v1',
    updated_at       timestamptz NOT NULL DEFAULT now()
);

-- 1.2 Trilhas. `lojas` nasce 'calibrating' (nao aceita inscricao ate o admin abrir).
--     Todos os limiares de antifraude e de prazo vivem em `params` (R6). O CHECK exige as chaves
--     para que o motor nunca precise de constante de reserva, e trava max_per_worker_week em 1..2
--     ("regra real da rede": nao pode ser configurado acima de 2).
CREATE TABLE IF NOT EXISTS public.bonus_tracks (
    id           uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
    key          text        NOT NULL UNIQUE CHECK (key IN ('eventos', 'lojas')),
    name         text        NOT NULL,
    status       text        NOT NULL DEFAULT 'calibrating' CHECK (status IN ('calibrating', 'open', 'closed')),
    cap_cents    integer     NOT NULL DEFAULT 30000 CHECK (cap_cents > 0),
    window_weeks integer     NOT NULL DEFAULT 12 CHECK (window_weeks BETWEEN 1 AND 52),
    params       jsonb       NOT NULL,
    created_at   timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT bonus_tracks_params_keys CHECK (params ?& ARRAY[
        'validation_hours', 'review_hours', 'receipt_hours', 'receipt_grace_days',
        'min_shift_minutes', 'checkin_tolerance_min', 'checkout_tolerance_min', 'min_lead_minutes',
        'max_counted_per_day', 'max_counted_per_week', 'max_per_worker_week',
        'burst_count', 'burst_window_hours', 'single_worker_pct', 'single_worker_min_shifts',
        'stuck_minutes', 'pattern_count', 'max_gap_days', 'min_shifts_for_gap', 'briefing_min_chars',
        'clock_tolerance_min', 'stuck_times_enabled'
    ]),
    CONSTRAINT bonus_tracks_clock_tolerance CHECK ((params->>'clock_tolerance_min')::integer >= 1),
    CONSTRAINT bonus_tracks_worker_week_cap CHECK (
        (params->>'max_per_worker_week')::integer BETWEEN 1 AND 2
    )
);

-- 1.3 Definicao dos marcos (limiares em params; R6).
CREATE TABLE IF NOT EXISTS public.bonus_milestones (
    id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
    track_id        uuid        NOT NULL REFERENCES public.bonus_tracks(id) ON DELETE RESTRICT,
    key             text        NOT NULL,
    grp             text        NOT NULL CHECK (grp IN ('A', 'B', 'C', 'D', 'E')),
    sort_order      integer     NOT NULL,
    title           text        NOT NULL,
    amount_cents    integer     NOT NULL CHECK (amount_cents >= 0),
    event_kind      text        NOT NULL CHECK (event_kind IN (
                        'accept', 'briefing', 'elenco_invited', 'elenco_accepted', 'job_published',
                        'shift_counted', 'receipt_fast', 'call_filled', 'repeat_worker',
                        'active_weeks', 'velocity', 'constancy', 'collection')),
    params          jsonb       NOT NULL DEFAULT '{}'::jsonb,
    requires_actor  boolean     NOT NULL,
    counts_in_total boolean     NOT NULL,
    active          boolean     NOT NULL DEFAULT true,
    CONSTRAINT bonus_milestones_track_key UNIQUE (track_id, key)
);

-- 1.4 Inscricao. UNIQUE (operator_user_id): uma por pessoa, para sempre (teto por OPERADOR).
CREATE TABLE IF NOT EXISTS public.bonus_enrollments (
    id                  uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
    track_id            uuid        NOT NULL REFERENCES public.bonus_tracks(id) ON DELETE RESTRICT,
    operator_user_id    uuid        NOT NULL,
    company_id          uuid        NOT NULL,
    display_name        text        NOT NULL CHECK (length(btrim(display_name)) BETWEEN 1 AND 80),
    pix_key             text        CHECK (pix_key IS NULL OR length(btrim(pix_key)) BETWEEN 3 AND 140),
    pix_key_normalized  text,
    status              text        NOT NULL DEFAULT 'invited' CHECK (status IN ('invited', 'active', 'ended', 'cancelled')),
    starts_at           timestamptz,
    ends_at             timestamptz,
    accepted_at         timestamptz,
    rules_version       text,
    company_ack_at      timestamptz,
    company_ack_by_label text,
    company_ack_note    text,
    milestones_snapshot jsonb,
    cap_cents           integer     NOT NULL CHECK (cap_cents > 0),
    -- alerta SO do admin: o saque/pagamento esta bloqueado pela revalidacao (nunca vai ao operador)
    payout_block_reason text        CHECK (payout_block_reason IS NULL
                                           OR payout_block_reason IN ('identity', 'pix_match', 'evaluation_failed')),
    created_by          uuid        NOT NULL,
    created_at          timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT bonus_enrollments_operator_unique UNIQUE (operator_user_id),
    CONSTRAINT bonus_enrollments_invited_clean CHECK (
        status <> 'invited' OR (accepted_at IS NULL AND starts_at IS NULL AND ends_at IS NULL)),
    CONSTRAINT bonus_enrollments_running_complete CHECK (
        status NOT IN ('active', 'ended')
        OR (accepted_at IS NOT NULL AND starts_at IS NOT NULL AND ends_at IS NOT NULL
            AND milestones_snapshot IS NOT NULL AND rules_version IS NOT NULL)),
    CONSTRAINT bonus_enrollments_window_order CHECK (ends_at IS NULL OR ends_at > starts_at)
);
CREATE INDEX IF NOT EXISTS idx_bonus_enrollments_company ON public.bonus_enrollments (company_id);

-- 1.5 Atribuicao do turno ao criador (C7). `responsible_id` muda com "Passar para"; esta NAO.
CREATE TABLE IF NOT EXISTS public.bonus_attributions (
    job_id           uuid        PRIMARY KEY,
    enrollment_id    uuid        NOT NULL REFERENCES public.bonus_enrollments(id) ON DELETE RESTRICT,
    operator_user_id uuid        NOT NULL,
    job_created_at   timestamptz NOT NULL,          -- relogio do SERVIDOR (jobs.created_at e do cliente)
    sched_start_date timestamptz,                   -- agenda como estava na criacao (A1-d)
    sched_work_start time,
    sched_work_end   time,
    created_at       timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_bonus_attributions_enrollment ON public.bonus_attributions (enrollment_id);

-- 1.6 Eventos de ator que o dado nao guarda (C7: so o briefing). Append-only.
CREATE TABLE IF NOT EXISTS public.bonus_events (
    id            uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
    enrollment_id uuid        NOT NULL REFERENCES public.bonus_enrollments(id) ON DELETE RESTRICT,
    kind          text        NOT NULL CHECK (kind IN ('briefing')),
    ref_id        uuid,
    occurred_at   timestamptz NOT NULL DEFAULT now(),
    actor_user_id uuid        NOT NULL,
    meta          jsonb       NOT NULL DEFAULT '{}'::jsonb,
    CONSTRAINT bonus_events_once_per_kind UNIQUE (enrollment_id, kind)
);

-- 1.6b Carimbos do SERVIDOR (A1): quando cada evidencia escrita pelo cliente APARECEU, e quem a
--      escreveu. Uma vez por (sujeito, tipo); append-only; ninguem alem do gatilho escreve.
CREATE TABLE IF NOT EXISTS public.bonus_server_stamps (
    subject_id    uuid        NOT NULL,
    kind          text        NOT NULL CHECK (kind IN (
                      'worker_checkin', 'worker_checkout', 'company_checkin', 'company_checkout',
                      'receipt_confirmed', 'receipt_voided', 'elenco_invite', 'elenco_accept', 'call_claim',
                      'briefing_filled')),
    job_id        uuid,
    actor_user_id uuid,
    declared_at   timestamptz,
    stamped_at    timestamptz NOT NULL DEFAULT clock_timestamp(),
    PRIMARY KEY (subject_id, kind)
);
COMMENT ON TABLE public.bonus_server_stamps IS
    'Relogio e ator do SERVIDOR para evidencia que o cliente escreve (A1). So para turnos/vinculos de quem esta na trilha. LGPD: uuid pseudonimo, sem texto.';

-- 1.7 Livro de turnos (C3): UMA linha por (turno, freela) cujo recibo fechou dos dois lados.
--     Colunas internas (exclusion_reason, flags, review) NUNCA saem para o operador.
CREATE TABLE IF NOT EXISTS public.bonus_shift_ledger (
    id               uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
    enrollment_id    uuid        NOT NULL REFERENCES public.bonus_enrollments(id) ON DELETE RESTRICT,
    application_id   uuid        NOT NULL,
    job_id           uuid        NOT NULL,
    worker_id        uuid        NOT NULL,
    job_created_at   timestamptz NOT NULL,
    shift_date       date        NOT NULL,
    start_local_time time,
    duration_minutes integer,
    checkout_at      timestamptz NOT NULL,
    completed_at     timestamptz NOT NULL,
    receipt_fast     boolean     NOT NULL,
    counted          boolean     NOT NULL,
    exclusion_reason text        CHECK (exclusion_reason IS NULL OR exclusion_reason IN (
                         'vetoed_worker', 'same_identity', 'out_of_window', 'implausible_times',
                         'short_duration', 'no_lead_time', 'day_cap', 'week_cap', 'worker_week_cap',
                         'owner_excluded', 'operator_not_member', 'missing_stamp', 'wrong_actor',
                         'clock_mismatch')),
    flags            text[]      NOT NULL DEFAULT '{}'::text[],
    review           text        NOT NULL DEFAULT 'none' CHECK (review IN ('none', 'open', 'approved', 'excluded')),
    flagged_at       timestamptz,
    review_due_at    timestamptz,
    -- o motivo de exclusao que existia QUANDO o dono aprovou (so essa coincidencia ele "ja viu")
    approved_exclusion text,
    decided_by       uuid,
    decided_at       timestamptz,
    decision_note    text,
    created_at       timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT bonus_ledger_application_unique UNIQUE (application_id),
    CONSTRAINT bonus_ledger_job_worker_unique UNIQUE (enrollment_id, job_id, worker_id),
    CONSTRAINT bonus_ledger_reason_coherent CHECK (counted OR exclusion_reason IS NOT NULL),
    CONSTRAINT bonus_ledger_counted_clean CHECK (NOT counted OR exclusion_reason IS NULL),
    CONSTRAINT bonus_ledger_open_needs_counted CHECK (review <> 'open' OR counted),
    CONSTRAINT bonus_ledger_open_has_due CHECK (review <> 'open' OR (flagged_at IS NOT NULL AND review_due_at IS NOT NULL)),
    CONSTRAINT bonus_ledger_decided_coherent CHECK (
        review NOT IN ('approved', 'excluded') OR (decided_by IS NOT NULL AND decided_at IS NOT NULL))
);
CREATE INDEX IF NOT EXISTS idx_bonus_ledger_enrollment ON public.bonus_shift_ledger (enrollment_id, counted);
CREATE INDEX IF NOT EXISTS idx_bonus_ledger_open ON public.bonus_shift_ledger (review_due_at) WHERE review = 'open';

-- 1.8 Pedido de saque (um aberto por inscricao).
CREATE TABLE IF NOT EXISTS public.bonus_payouts (
    id                uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
    enrollment_id     uuid        NOT NULL REFERENCES public.bonus_enrollments(id) ON DELETE RESTRICT,
    amount_cents      integer     NOT NULL CHECK (amount_cents >= 0),
    status            text        NOT NULL DEFAULT 'requested' CHECK (status IN ('requested', 'paid', 'cancelled')),
    requested_at      timestamptz NOT NULL DEFAULT now(),
    scheduled_for     date        NOT NULL,
    pix_key_snapshot  text        NOT NULL,
    paid_at           timestamptz,
    paid_by           uuid,
    paid_note         text,
    CONSTRAINT bonus_payouts_paid_coherent CHECK (
        (status = 'paid') = (paid_at IS NOT NULL AND paid_by IS NOT NULL))
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_bonus_payouts_one_open
    ON public.bonus_payouts (enrollment_id) WHERE status = 'requested';
CREATE INDEX IF NOT EXISTS idx_bonus_payouts_scheduled ON public.bonus_payouts (scheduled_for, status);

-- 1.9 Awards (C1, C4). Estado persistido: so o que NAO se deriva do relogio.
CREATE TABLE IF NOT EXISTS public.bonus_awards (
    id            uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
    enrollment_id uuid        NOT NULL REFERENCES public.bonus_enrollments(id) ON DELETE RESTRICT,
    milestone_id  uuid        NOT NULL REFERENCES public.bonus_milestones(id) ON DELETE RESTRICT,
    tier          smallint    NOT NULL DEFAULT 1 CHECK (tier >= 1),
    amount_cents  integer     NOT NULL CHECK (amount_cents >= 0),
    state         text        NOT NULL DEFAULT 'earned' CHECK (state IN ('earned', 'not_counted', 'in_payout', 'paid')),
    earned_at     timestamptz NOT NULL DEFAULT now(),
    available_at  timestamptz NOT NULL,
    evidence      jsonb       NOT NULL DEFAULT '{"ledger_ids": []}'::jsonb,
    payout_id     uuid        REFERENCES public.bonus_payouts(id) ON DELETE RESTRICT,
    celebrated_at timestamptz,
    CONSTRAINT bonus_awards_unique_milestone UNIQUE (enrollment_id, milestone_id, tier),
    CONSTRAINT bonus_awards_payout_coherent CHECK ((state IN ('in_payout', 'paid')) = (payout_id IS NOT NULL)),
    CONSTRAINT bonus_awards_available_after_earned CHECK (available_at >= earned_at),
    CONSTRAINT bonus_awards_ledger_ids_array CHECK (jsonb_typeof(evidence->'ledger_ids') = 'array')
);
CREATE INDEX IF NOT EXISTS idx_bonus_awards_enrollment ON public.bonus_awards (enrollment_id, state);
CREATE INDEX IF NOT EXISTS idx_bonus_awards_payout ON public.bonus_awards (payout_id) WHERE payout_id IS NOT NULL;

-- 1.10 Vetos (AF1 + C2): pessoas do Worki (socios/donos). Valem como freela E como operador.
CREATE TABLE IF NOT EXISTS public.bonus_vetos (
    person_id  uuid        PRIMARY KEY,
    reason     text        NOT NULL CHECK (length(btrim(reason)) >= 1),
    created_by uuid        NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now()
);

-- 1.11 Rastro das acoes de admin (R29): quem, quando, o que, antes/depois.
CREATE TABLE IF NOT EXISTS public.bonus_admin_log (
    id        bigserial   PRIMARY KEY,
    at        timestamptz NOT NULL DEFAULT now(),
    actor     uuid        NOT NULL,
    action    text        NOT NULL,
    target_id uuid,
    detail    jsonb       NOT NULL DEFAULT '{}'::jsonb
);

COMMENT ON TABLE public.bonus_program_settings IS
    'Interruptor global da trilha de bonus do operador (singleton). Nasce enabled=false (C9). Registro de obrigacao do Worki, fora do razao financeiro (Article 8).';
COMMENT ON TABLE public.bonus_tracks IS
    'Trilhas (eventos, lojas). Todos os limiares de prazo/antifraude vivem em params e sao CONGELADOS no snapshot da inscricao (R6).';
COMMENT ON TABLE public.bonus_enrollments IS
    'Inscricao do operador. UNIQUE por pessoa (teto por operador). LGPD: pix_key e display_name sao dado pessoal e DEVEM ser cobertos por anonymize_account antes de enabled=true (condicao de ativacao verificada em bonus_admin_set_enabled). milestones_snapshot guarda limiares de antifraude: o operador nunca le esta tabela.';
COMMENT ON TABLE public.bonus_attributions IS
    'Quem CRIOU o turno (capturado por auth.uid() no INSERT de jobs). Imutavel por Passar-para/Cobrir (C7). uuid pseudonimo retido, sem FK de proposito.';
COMMENT ON TABLE public.bonus_events IS
    'Eventos de ator que o dado nao guarda (so o briefing da empresa). Append-only.';
COMMENT ON TABLE public.bonus_shift_ledger IS
    'Livro de turnos com recibo validado dos dois lados. Gravado UMA vez (C3); so a decisao do dono (review) muda. exclusion_reason/flags/review sao INTERNOS: nunca vao ao operador (AF7).';
COMMENT ON TABLE public.bonus_awards IS
    'Marcos conquistados. state persistido: earned|not_counted|in_payout|paid. Disponivel/liberando/em conferencia sao DERIVADOS na leitura (C4). paid e imutavel.';
COMMENT ON TABLE public.bonus_payouts IS
    'Pedido de saque; o dono paga por PIX manual fora do sistema e marca como pago. Nao e movimento de saldo.';
COMMENT ON TABLE public.bonus_vetos IS
    'Pessoas do Worki (socios/donos) vetadas como freela e como operador da trilha. Geridas no admin.';
COMMENT ON TABLE public.bonus_admin_log IS
    'Trilha de auditoria das acoes de admin da trilha (R29).';
COMMENT ON COLUMN public.bonus_awards.tier IS
    'NOT NULL DEFAULT 1 (C1): com NULL, UNIQUE nao colide e ON CONFLICT DO NOTHING duplicaria marco sem tier.';
COMMENT ON COLUMN public.bonus_shift_ledger.review IS
    'none | open (sinalizado, fila do admin) | approved | excluded. Substitui flag_state + decision do spec (C3).';

-- ============================================================================
-- 2. DEFESAS DE BANCO (triggers)
-- ============================================================================

-- 2.1 Bloqueio generico de DELETE/TRUNCATE (nenhuma tabela da trilha se apaga).
CREATE OR REPLACE FUNCTION public.bonus_block_delete()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $fn$
BEGIN
    RAISE EXCEPTION 'tabela da trilha de bonus nao admite % (livro de obrigacao: nada se apaga)', TG_OP
        USING ERRCODE = '42501';
END;
$fn$;

-- 2.2 bonus_events: append-only (sem UPDATE).
CREATE OR REPLACE FUNCTION public.bonus_events_append_only()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $fn$
BEGIN
    RAISE EXCEPTION '% e append-only', TG_TABLE_NAME USING ERRCODE = '42501';
END;
$fn$;

-- 2.3 Inscricao: identidade imutavel, maquina de estados, snapshot congelado apos o aceite.
CREATE OR REPLACE FUNCTION public.bonus_enrollments_guard()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $fn$
BEGIN
    -- excecao ESTREITA da anonimizacao (M3): sessao nula, so campos de pessoa, so para o valor anonimo
    IF auth.uid() IS NULL
       AND (to_jsonb(NEW) - ARRAY['display_name', 'pix_key', 'pix_key_normalized', 'company_ack_by_label', 'company_ack_note'])
           = (to_jsonb(OLD) - ARRAY['display_name', 'pix_key', 'pix_key_normalized', 'company_ack_by_label', 'company_ack_note'])
       AND (NEW.display_name = 'anonimizado' OR NEW.display_name = OLD.display_name)
       AND (NEW.pix_key IS NULL OR NEW.pix_key IS NOT DISTINCT FROM OLD.pix_key)
       AND (NEW.pix_key_normalized IS NULL OR NEW.pix_key_normalized IS NOT DISTINCT FROM OLD.pix_key_normalized)
       AND (NEW.company_ack_by_label IS NULL OR NEW.company_ack_by_label = 'anonimizado'
            OR NEW.company_ack_by_label IS NOT DISTINCT FROM OLD.company_ack_by_label)
       AND (NEW.company_ack_note IS NULL OR NEW.company_ack_note IS NOT DISTINCT FROM OLD.company_ack_note) THEN
        RETURN NEW;
    END IF;

    IF NEW.id IS DISTINCT FROM OLD.id
       OR NEW.track_id IS DISTINCT FROM OLD.track_id
       OR NEW.operator_user_id IS DISTINCT FROM OLD.operator_user_id
       OR NEW.company_id IS DISTINCT FROM OLD.company_id
       OR NEW.display_name IS DISTINCT FROM OLD.display_name
       OR NEW.created_by IS DISTINCT FROM OLD.created_by
       OR NEW.created_at IS DISTINCT FROM OLD.created_at THEN
        RAISE EXCEPTION 'bonus_enrollments: identidade da inscricao e imutavel' USING ERRCODE = '42501';
    END IF;

    IF NEW.status IS DISTINCT FROM OLD.status
       AND (OLD.status, NEW.status) NOT IN (('invited', 'active'), ('invited', 'cancelled'),
                                            ('active', 'ended'), ('active', 'cancelled')) THEN
        RAISE EXCEPTION 'bonus_enrollments: transicao % -> % invalida', OLD.status, NEW.status
            USING ERRCODE = '23514';
    END IF;

    IF OLD.accepted_at IS NOT NULL
       AND (NEW.starts_at IS DISTINCT FROM OLD.starts_at
            OR NEW.ends_at IS DISTINCT FROM OLD.ends_at
            OR NEW.accepted_at IS DISTINCT FROM OLD.accepted_at
            OR NEW.rules_version IS DISTINCT FROM OLD.rules_version
            OR NEW.milestones_snapshot IS DISTINCT FROM OLD.milestones_snapshot
            OR NEW.cap_cents IS DISTINCT FROM OLD.cap_cents
            OR NEW.company_ack_at IS DISTINCT FROM OLD.company_ack_at
            OR NEW.company_ack_by_label IS DISTINCT FROM OLD.company_ack_by_label
            OR NEW.company_ack_note IS DISTINCT FROM OLD.company_ack_note) THEN
        RAISE EXCEPTION 'bonus_enrollments: janela, snapshot, teto e ciencia do patrao sao imutaveis apos o aceite'
            USING ERRCODE = '42501';
    END IF;
    RETURN NEW;
END;
$fn$;

-- 2.4 Awards: teto por trigger (defesa em profundidade) + maquina de estados + paid imutavel.
CREATE OR REPLACE FUNCTION public.bonus_awards_guard()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $fn$
DECLARE
    v_cap  integer;
    v_soma bigint;
BEGIN
    IF TG_OP = 'INSERT' THEN
        -- serializa por inscricao: o teto vale mesmo com avaliacoes concorrentes
        SELECT e.cap_cents INTO v_cap
          FROM public.bonus_enrollments e
         WHERE e.id = NEW.enrollment_id
         FOR NO KEY UPDATE;
        IF v_cap IS NULL THEN
            RAISE EXCEPTION 'bonus_awards: inscricao inexistente' USING ERRCODE = '23503';
        END IF;
        -- BEFORE INSERT roda ANTES do ON CONFLICT: um par (marco, tier) que ja existe nao pode
        -- estourar o teto aqui, senao a avaliacao deixaria de ser idempotente. O UNIQUE o descarta.
        IF EXISTS (SELECT 1 FROM public.bonus_awards a
                    WHERE a.enrollment_id = NEW.enrollment_id
                      AND a.milestone_id  = NEW.milestone_id
                      AND a.tier          = NEW.tier) THEN
            RETURN NEW;
        END IF;
        SELECT COALESCE(sum(a.amount_cents), 0) INTO v_soma
          FROM public.bonus_awards a
         WHERE a.enrollment_id = NEW.enrollment_id AND a.state <> 'not_counted';
        IF NEW.state <> 'not_counted' AND v_soma + NEW.amount_cents > v_cap THEN
            RAISE EXCEPTION 'bonus_awards: teto da inscricao (% centavos) seria excedido', v_cap
                USING ERRCODE = '23514';
        END IF;
        IF NEW.state <> 'earned' THEN
            RAISE EXCEPTION 'bonus_awards: award nasce em earned' USING ERRCODE = '23514';
        END IF;
        RETURN NEW;
    END IF;

    -- UPDATE
    -- celebrated_at pode ser carimbado mesmo em estado terminal (so ele muda)
    IF (to_jsonb(NEW) - 'celebrated_at') IS NOT DISTINCT FROM (to_jsonb(OLD) - 'celebrated_at') THEN
        RETURN NEW;
    END IF;
    -- RECONQUISTA: o marco cancelado por "Nao contar" volta a earned quando OUTROS turnos passam a
    -- sustenta-lo (nada que o operador possa perder). Nova janela de validacao; teto reconferido.
    IF OLD.state = 'not_counted' AND NEW.state = 'earned' THEN
        IF NEW.id IS DISTINCT FROM OLD.id
           OR NEW.enrollment_id IS DISTINCT FROM OLD.enrollment_id
           OR NEW.milestone_id IS DISTINCT FROM OLD.milestone_id
           OR NEW.tier IS DISTINCT FROM OLD.tier
           OR NEW.amount_cents IS DISTINCT FROM OLD.amount_cents THEN
            RAISE EXCEPTION 'bonus_awards: reconquista nao muda marco nem valor' USING ERRCODE = '42501';
        END IF;
        SELECT e.cap_cents INTO v_cap FROM public.bonus_enrollments e
         WHERE e.id = NEW.enrollment_id FOR NO KEY UPDATE;
        SELECT COALESCE(sum(a.amount_cents), 0) INTO v_soma FROM public.bonus_awards a
         WHERE a.enrollment_id = NEW.enrollment_id AND a.state <> 'not_counted';
        IF v_soma + NEW.amount_cents > v_cap THEN
            RAISE EXCEPTION 'bonus_awards: teto da inscricao (% centavos) seria excedido', v_cap
                USING ERRCODE = '23514';
        END IF;
        RETURN NEW;
    END IF;
    IF OLD.state IN ('paid', 'not_counted') THEN
        RAISE EXCEPTION 'bonus_awards: estado terminal (%) e imutavel (sem clawback, AF10)', OLD.state
            USING ERRCODE = '42501';
    END IF;
    IF NEW.id IS DISTINCT FROM OLD.id
       OR NEW.enrollment_id IS DISTINCT FROM OLD.enrollment_id
       OR NEW.milestone_id IS DISTINCT FROM OLD.milestone_id
       OR NEW.tier IS DISTINCT FROM OLD.tier
       OR NEW.amount_cents IS DISTINCT FROM OLD.amount_cents
       OR NEW.earned_at IS DISTINCT FROM OLD.earned_at
       OR NEW.available_at IS DISTINCT FROM OLD.available_at THEN
        RAISE EXCEPTION 'bonus_awards: marco, valor e datas sao imutaveis' USING ERRCODE = '42501';
    END IF;
    IF NEW.state IS DISTINCT FROM OLD.state
       AND (OLD.state, NEW.state) NOT IN (('earned', 'not_counted'), ('earned', 'in_payout'),
                                          ('in_payout', 'earned'), ('in_payout', 'paid'),
                                          ('in_payout', 'not_counted')) THEN
        RAISE EXCEPTION 'bonus_awards: transicao % -> % invalida', OLD.state, NEW.state
            USING ERRCODE = '23514';
    END IF;
    RETURN NEW;
END;
$fn$;

-- 2.5 Livro: so a decisao do dono (e a sinalizacao tardia voided_after) muda uma linha.
CREATE OR REPLACE FUNCTION public.bonus_ledger_guard()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $fn$
DECLARE
    v_mutaveis text[] := ARRAY['counted', 'exclusion_reason', 'flags', 'review', 'flagged_at',
                               'review_due_at', 'decided_by', 'decided_at', 'decision_note', 'approved_exclusion'];
BEGIN
    IF (to_jsonb(NEW) - v_mutaveis) IS DISTINCT FROM (to_jsonb(OLD) - v_mutaveis) THEN
        RAISE EXCEPTION 'bonus_shift_ledger: linha gravada uma vez, so a decisao muda (C3)' USING ERRCODE = '42501';
    END IF;
    IF NEW.review IS DISTINCT FROM OLD.review
       AND (OLD.review, NEW.review) NOT IN (('none', 'open'), ('open', 'approved'), ('open', 'excluded'))
       -- reabertura so com motivo NOVO depois da aprovacao (PIX coincidente ou recibo estornado)
       AND NOT (OLD.review = 'approved' AND NEW.review = 'open'
                AND (('shared_pix' = ANY (NEW.flags) AND NOT ('shared_pix' = ANY (OLD.flags)))
                     OR ('voided_after' = ANY (NEW.flags) AND NOT ('voided_after' = ANY (OLD.flags))))) THEN
        RAISE EXCEPTION 'bonus_shift_ledger: transicao de revisao % -> % invalida (flag nao reabre)',
            OLD.review, NEW.review USING ERRCODE = '23514';
    END IF;
    IF NEW.counted IS DISTINCT FROM OLD.counted AND NOT (OLD.counted AND NOT NEW.counted AND NEW.review = 'excluded') THEN
        RAISE EXCEPTION 'bonus_shift_ledger: counted so vira false pela decisao Nao contar' USING ERRCODE = '23514';
    END IF;
    RETURN NEW;
END;
$fn$;

-- 2.6 Pedido de saque: pago/cancelado e imutavel; no aberto so mudam valor e status (B4).
CREATE OR REPLACE FUNCTION public.bonus_payouts_guard()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $fn$
BEGIN
    IF auth.uid() IS NULL
       AND (to_jsonb(NEW) - ARRAY['pix_key_snapshot', 'paid_note']) = (to_jsonb(OLD) - ARRAY['pix_key_snapshot', 'paid_note'])
       AND (NEW.pix_key_snapshot = 'anonimizado' OR NEW.pix_key_snapshot = OLD.pix_key_snapshot)
       AND (NEW.paid_note IS NULL OR NEW.paid_note IS NOT DISTINCT FROM OLD.paid_note) THEN
        RETURN NEW;
    END IF;
    IF OLD.status <> 'requested' THEN
        RAISE EXCEPTION 'bonus_payouts: pedido % e imutavel', OLD.status USING ERRCODE = '42501';
    END IF;
    IF NEW.id IS DISTINCT FROM OLD.id
       OR NEW.enrollment_id IS DISTINCT FROM OLD.enrollment_id
       OR NEW.requested_at IS DISTINCT FROM OLD.requested_at
       OR NEW.scheduled_for IS DISTINCT FROM OLD.scheduled_for
       OR NEW.pix_key_snapshot IS DISTINCT FROM OLD.pix_key_snapshot THEN
        RAISE EXCEPTION 'bonus_payouts: so valor e status mudam num pedido aberto' USING ERRCODE = '42501';
    END IF;
    RETURN NEW;
END;
$fn$;

-- 2.7 Rastro do admin: sem UPDATE (excecao: anonimizacao apaga o detalhe).
CREATE OR REPLACE FUNCTION public.bonus_admin_log_guard()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $fn$
BEGIN
    IF auth.uid() IS NULL
       AND (to_jsonb(NEW) - 'detail') = (to_jsonb(OLD) - 'detail')
       AND NEW.detail = '{"anonimizado": true}'::jsonb THEN
        RETURN NEW;
    END IF;
    RAISE EXCEPTION 'bonus_admin_log nao admite UPDATE' USING ERRCODE = '42501';
END;
$fn$;
REVOKE ALL ON FUNCTION public.bonus_payouts_guard()   FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.bonus_admin_log_guard() FROM PUBLIC, anon, authenticated;

REVOKE ALL ON FUNCTION public.bonus_block_delete()        FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.bonus_events_append_only()  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.bonus_enrollments_guard()   FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.bonus_awards_guard()        FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.bonus_ledger_guard()        FROM PUBLIC, anon, authenticated;

DO $mig$
DECLARE
    t text;
BEGIN
    FOREACH t IN ARRAY ARRAY['bonus_program_settings', 'bonus_tracks', 'bonus_milestones', 'bonus_enrollments',
                             'bonus_attributions', 'bonus_events', 'bonus_shift_ledger', 'bonus_awards',
                             'bonus_payouts', 'bonus_vetos', 'bonus_admin_log', 'bonus_server_stamps']
    LOOP
        -- bonus_vetos e a unica excecao ao DELETE: nao e livro financeiro; so a RPC admin_bonus_veto_remove
        -- (S4) apaga, e ela grava a linha anterior em bonus_admin_log (remocao COM REGISTRO).
        IF t <> 'bonus_vetos' THEN
            EXECUTE format('DROP TRIGGER IF EXISTS trg_%s_no_delete ON public.%I', t, t);
            EXECUTE format('CREATE TRIGGER trg_%s_no_delete BEFORE DELETE ON public.%I FOR EACH ROW EXECUTE FUNCTION public.bonus_block_delete()', t, t);
        END IF;
        EXECUTE format('DROP TRIGGER IF EXISTS trg_%s_no_truncate ON public.%I', t, t);
        EXECUTE format('CREATE TRIGGER trg_%s_no_truncate BEFORE TRUNCATE ON public.%I FOR EACH STATEMENT EXECUTE FUNCTION public.bonus_block_delete()', t, t);
    END LOOP;
END
$mig$;

DROP TRIGGER IF EXISTS trg_bonus_events_append_only ON public.bonus_events;
CREATE TRIGGER trg_bonus_events_append_only BEFORE UPDATE ON public.bonus_events
    FOR EACH ROW EXECUTE FUNCTION public.bonus_events_append_only();

DROP TRIGGER IF EXISTS trg_bonus_stamps_append_only ON public.bonus_server_stamps;
CREATE TRIGGER trg_bonus_stamps_append_only BEFORE UPDATE ON public.bonus_server_stamps
    FOR EACH ROW EXECUTE FUNCTION public.bonus_events_append_only();

DROP TRIGGER IF EXISTS trg_bonus_payouts_guard ON public.bonus_payouts;
CREATE TRIGGER trg_bonus_payouts_guard BEFORE UPDATE ON public.bonus_payouts
    FOR EACH ROW EXECUTE FUNCTION public.bonus_payouts_guard();

DROP TRIGGER IF EXISTS trg_bonus_admin_log_guard ON public.bonus_admin_log;
CREATE TRIGGER trg_bonus_admin_log_guard BEFORE UPDATE ON public.bonus_admin_log
    FOR EACH ROW EXECUTE FUNCTION public.bonus_admin_log_guard();

DROP TRIGGER IF EXISTS trg_bonus_enrollments_guard ON public.bonus_enrollments;
CREATE TRIGGER trg_bonus_enrollments_guard BEFORE UPDATE ON public.bonus_enrollments
    FOR EACH ROW EXECUTE FUNCTION public.bonus_enrollments_guard();

DROP TRIGGER IF EXISTS trg_bonus_awards_guard ON public.bonus_awards;
CREATE TRIGGER trg_bonus_awards_guard BEFORE INSERT OR UPDATE ON public.bonus_awards
    FOR EACH ROW EXECUTE FUNCTION public.bonus_awards_guard();

DROP TRIGGER IF EXISTS trg_bonus_ledger_guard ON public.bonus_shift_ledger;
CREATE TRIGGER trg_bonus_ledger_guard BEFORE UPDATE ON public.bonus_shift_ledger
    FOR EACH ROW EXECUTE FUNCTION public.bonus_ledger_guard();

-- ============================================================================
-- 3. GRANTS e RLS. Nenhum acesso direto para anon/authenticated; service_role so le.
--    (nunca REVOKE ... FROM PUBLIC em tabela: licao de 20260318000000)
--    Policies: nao ha NENHUMA de proposito — RLS ligada sem policy = negar tudo para quem nao
--    tem BYPASSRLS. O operador le so por RPC de projecao fechada (S3); o admin por RPC (S4).
-- ============================================================================
REVOKE ALL ON public.bonus_program_settings, public.bonus_tracks, public.bonus_milestones,
              public.bonus_enrollments, public.bonus_attributions, public.bonus_events,
              public.bonus_shift_ledger, public.bonus_awards, public.bonus_payouts,
              public.bonus_vetos, public.bonus_admin_log, public.bonus_server_stamps
    FROM anon, authenticated, service_role;
GRANT SELECT ON public.bonus_program_settings, public.bonus_tracks, public.bonus_milestones,
                public.bonus_enrollments, public.bonus_attributions, public.bonus_events,
                public.bonus_shift_ledger, public.bonus_awards, public.bonus_payouts,
                public.bonus_vetos, public.bonus_admin_log, public.bonus_server_stamps
    TO service_role;

ALTER TABLE public.bonus_server_stamps    ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.bonus_server_stamps    NO FORCE ROW LEVEL SECURITY;
ALTER TABLE public.bonus_program_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.bonus_tracks           ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.bonus_milestones       ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.bonus_enrollments      ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.bonus_attributions     ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.bonus_events           ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.bonus_shift_ledger     ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.bonus_awards           ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.bonus_payouts          ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.bonus_vetos            ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.bonus_admin_log        ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.bonus_program_settings NO FORCE ROW LEVEL SECURITY;
ALTER TABLE public.bonus_tracks           NO FORCE ROW LEVEL SECURITY;
ALTER TABLE public.bonus_milestones       NO FORCE ROW LEVEL SECURITY;
ALTER TABLE public.bonus_enrollments      NO FORCE ROW LEVEL SECURITY;
ALTER TABLE public.bonus_attributions     NO FORCE ROW LEVEL SECURITY;
ALTER TABLE public.bonus_events           NO FORCE ROW LEVEL SECURITY;
ALTER TABLE public.bonus_shift_ledger     NO FORCE ROW LEVEL SECURITY;
ALTER TABLE public.bonus_awards           NO FORCE ROW LEVEL SECURITY;
ALTER TABLE public.bonus_payouts          NO FORCE ROW LEVEL SECURITY;
ALTER TABLE public.bonus_vetos            NO FORCE ROW LEVEL SECURITY;
ALTER TABLE public.bonus_admin_log        NO FORCE ROW LEVEL SECURITY;

-- ============================================================================
-- 4. SEEDS (idempotentes): interruptor, duas trilhas, marcos
-- ============================================================================
INSERT INTO public.bonus_program_settings (id, enabled, min_payout_cents, rules_version)
VALUES (true, false, 2500, 'v1')
ON CONFLICT (id) DO NOTHING;

-- Limiares de antifraude: valores ASSUMIDOS pela spec (Open item 4) e a calibrar; vivem so aqui
-- (R6). checkin/checkout_tolerance_min sao Assumidos do builder (spec: "tolerancias param").
INSERT INTO public.bonus_tracks (key, name, status, cap_cents, window_weeks, params)
VALUES
    ('eventos', 'Trilha de eventos', 'open', 30000, 12, jsonb_build_object(
        'validation_hours', 48, 'review_hours', 48, 'receipt_hours', 24, 'receipt_grace_days', 3,
        'min_shift_minutes', 120, 'checkin_tolerance_min', 180, 'checkout_tolerance_min', 240,
        'min_lead_minutes', 60, 'max_counted_per_day', 4, 'max_counted_per_week', 8,
        'max_per_worker_week', 2, 'burst_count', 3, 'burst_window_hours', 3,
        'single_worker_pct', 80, 'single_worker_min_shifts', 4, 'stuck_minutes', 10,
        'pattern_count', 3, 'max_gap_days', 10, 'min_shifts_for_gap', 6, 'briefing_min_chars', 20,
        'clock_tolerance_min', 15, 'stuck_times_enabled', 0)),
    ('lojas', 'Trilha das lojas', 'calibrating', 30000, 12, jsonb_build_object(
        'validation_hours', 48, 'review_hours', 48, 'receipt_hours', 24, 'receipt_grace_days', 3,
        'min_shift_minutes', 120, 'checkin_tolerance_min', 180, 'checkout_tolerance_min', 240,
        'min_lead_minutes', 60, 'max_counted_per_day', 4, 'max_counted_per_week', 8,
        'max_per_worker_week', 2, 'burst_count', 3, 'burst_window_hours', 3,
        'single_worker_pct', 80, 'single_worker_min_shifts', 4, 'stuck_minutes', 10,
        'pattern_count', 3, 'max_gap_days', 10, 'min_shifts_for_gap', 6, 'briefing_min_chars', 20,
        'clock_tolerance_min', 15, 'stuck_times_enabled', 0))
ON CONFLICT (key) DO NOTHING;

-- Marcos (R7 revisado por C7). sort_order contiguo; E (colecao) fica por ultimo e FORA do contador.
INSERT INTO public.bonus_milestones
       (track_id, key, grp, sort_order, title, amount_cents, event_kind, params, requires_actor, counts_in_total)
SELECT t.id, m.key, m.grp, m.sort_order, m.title, m.amount_cents, m.event_kind, m.params::jsonb, m.requires_actor, m.counts
  FROM public.bonus_tracks t
 CROSS JOIN (VALUES
    ('first_access',        'A',  1, 'Primeiro acesso',                          0,    'accept',          '{}',                                   false, true),
    ('accepted_challenge',  'A',  2, 'Topei o desafio',                          1000, 'accept',          '{}',                                   false, true),
    ('briefing',            'A',  3, 'Briefing da empresa preenchido',           1000, 'briefing',        '{}',                                   true,  true),
    ('invite_5',            'A',  4, 'Convidou 5 freelas por telefone ou Worki ID',         1000, 'elenco_invited',  '{"threshold": 5}',                     true,  true),
    ('first_job',           'B',  5, 'Primeiro turno publicado',                 1000, 'job_published',   '{"threshold": 1}',                     true,  true),
    ('elenco_accepted_3',   'B',  6, '3 convidados por telefone ou Worki ID aceitaram',            1000, 'elenco_accepted', '{"threshold": 3}',                     true,  true),
    ('first_checkin_out',   'B',  7, 'Primeiro check-in e checkout confirmados', 1000, 'shift_counted',   '{"threshold": 1}',                     true,  true),
    ('first_complete',      'B',  8, 'Primeiro turno completo',                  3000, 'shift_counted',   '{"threshold": 1}',                     true,  true),
    ('first_fast_receipt',  'B',  9, 'Primeiro recibo validado em até 24h',      1000, 'receipt_fast',    '{"threshold": 1}',                     true,  true),
    ('first_call_filled',   'B', 10, 'Primeiro chamado de turno preenchido',     1500, 'call_filled',     '{"threshold": 1}',                     true,  true),
    ('repeat_worker',       'B', 11, 'Primeiro freela repetido',                 1500, 'repeat_worker',   '{"threshold": 2}',                     true,  true),
    ('shifts_3',            'C', 12, '3 turnos completos',                       1500, 'shift_counted',   '{"threshold": 3}',                     true,  true),
    ('shifts_6',            'C', 13, '6 turnos completos',                       1500, 'shift_counted',   '{"threshold": 6}',                     true,  true),
    ('shifts_9',            'C', 14, '9 turnos completos',                       2000, 'shift_counted',   '{"threshold": 9}',                     true,  true),
    ('shifts_12',           'C', 15, '12 turnos completos',                      2000, 'shift_counted',   '{"threshold": 12}',                    true,  true),
    ('weeks_6',             'C', 16, '6 semanas ativas',                         1500, 'active_weeks',    '{"threshold": 6}',                     true,  true),
    ('weeks_10',            'C', 17, '10 semanas ativas',                        1500, 'active_weeks',    '{"threshold": 10}',                    true,  true),
    ('velocity',            'D', 18, 'Velocidade',                               1500, 'velocity',
        '{"tiers": [{"tier": 1, "shifts": 3, "days": 7, "amount_cents": 1500}, {"tier": 2, "shifts": 5, "days": 14, "amount_cents": 1000}]}',
                                                                                              true,  true),
    ('constancy',           'D', 19, 'Constância',                               1500, 'constancy',       '{}',                                   true,  true),
    ('collection',          'E', 20, 'Coleção completa',                         3000, 'collection',      '{"groups": ["A", "B"]}',               true,  false)
 ) AS m(key, grp, sort_order, title, amount_cents, event_kind, params, requires_actor, counts)
ON CONFLICT (track_id, key) DO NOTHING;

-- ============================================================================
-- 5. VERIFICACAO FINAL (assercoes; falhar = a migration inteira desfaz)
-- ============================================================================
DO $mig$
DECLARE
    r        record;
    v_n      integer;
    v_soma   integer;
    v_extra  integer;
BEGIN
    -- 5.1 as onze tabelas existem, com RLS ligada e SEM policy para anon/authenticated
    FOR r IN SELECT c.relname, c.relrowsecurity
               FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
              WHERE n.nspname = 'public' AND c.relkind = 'r' AND left(c.relname, 6) = 'bonus_'
    LOOP
        IF NOT r.relrowsecurity THEN
            RAISE EXCEPTION 'VERIFICACAO S1: RLS desligada em %. HALT.', r.relname;
        END IF;
    END LOOP;
    SELECT count(*) INTO v_n FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
     WHERE n.nspname = 'public' AND c.relkind = 'r' AND left(c.relname, 6) = 'bonus_';
    IF v_n <> 12 THEN
        RAISE EXCEPTION 'VERIFICACAO S1: esperadas 12 tabelas bonus_*, ha %. HALT.', v_n;
    END IF;
    SELECT count(*) INTO v_n FROM pg_policies p WHERE p.schemaname = 'public' AND left(p.tablename, 6) = 'bonus_';
    IF v_n <> 0 THEN
        RAISE EXCEPTION 'VERIFICACAO S1: % policy(ies) em tabela bonus_*; nao deve haver acesso direto. HALT.', v_n;
    END IF;

    -- 5.2 ninguem alem de service_role (SELECT) tem privilegio de tabela; ninguem tem DELETE
    SELECT count(*) INTO v_n
      FROM information_schema.role_table_grants g
     WHERE g.table_schema = 'public' AND left(g.table_name, 6) = 'bonus_'
       AND ( g.grantee IN ('anon', 'authenticated', 'PUBLIC')
          OR (g.grantee = 'service_role' AND g.privilege_type <> 'SELECT') );
    IF v_n <> 0 THEN
        RAISE EXCEPTION 'VERIFICACAO S1: % grant(s) indevido(s) em tabela bonus_*. HALT.', v_n;
    END IF;

    -- 5.3 nenhum nome de coluna fala em saldo/carteira (Article 8, regra do dono)
    SELECT count(*) INTO v_n
      FROM information_schema.columns c
     WHERE c.table_schema = 'public' AND left(c.table_name, 6) = 'bonus_'
       AND c.column_name ~* '(balance|wallet|saldo|carteira)';
    IF v_n <> 0 THEN
        RAISE EXCEPTION 'VERIFICACAO S1: coluna bonus_* com nome de saldo/carteira. HALT.';
    END IF;

    -- 5.4 tudo nasce desligado e sem inscricao (C9, no-op para as contas atuais)
    IF EXISTS (SELECT 1 FROM public.bonus_program_settings WHERE enabled) THEN
        RAISE EXCEPTION 'VERIFICACAO S1: programa nasceu ligado (C9). HALT.';
    END IF;
    IF EXISTS (SELECT 1 FROM public.bonus_enrollments) THEN
        RAISE EXCEPTION 'VERIFICACAO S1: existe inscricao; nenhuma pode ser ativada nesta fatia (C9). HALT.';
    END IF;

    -- 5.5 a soma dos marcos de cada trilha fecha o teto (tier 2 da velocidade soma o complemento)
    FOR r IN SELECT t.id, t.key, t.cap_cents FROM public.bonus_tracks t
    LOOP
        SELECT COALESCE(sum(m.amount_cents), 0) INTO v_soma FROM public.bonus_milestones m WHERE m.track_id = r.id;
        SELECT COALESCE(sum((tr->>'amount_cents')::integer), 0) INTO v_extra
          FROM public.bonus_milestones m, jsonb_array_elements(m.params->'tiers') AS tr
         WHERE m.track_id = r.id AND m.event_kind = 'velocity' AND (tr->>'tier')::integer > 1;
        IF v_soma + v_extra <> r.cap_cents THEN
            RAISE EXCEPTION 'VERIFICACAO S1: trilha % soma % centavos, teto e %. HALT.', r.key, v_soma + v_extra, r.cap_cents;
        END IF;
        SELECT count(*) INTO v_n FROM public.bonus_milestones m WHERE m.track_id = r.id AND m.counts_in_total;
        IF v_n <> 19 THEN
            RAISE EXCEPTION 'VERIFICACAO S1: trilha % tem % marcos no contador (esperado 19: A4+B7+C6+D2). HALT.', r.key, v_n;
        END IF;
    END LOOP;

    -- 5.6 a trilha das lojas nao aceita inscricao ate calibrar
    IF (SELECT t.status FROM public.bonus_tracks t WHERE t.key = 'lojas') <> 'calibrating' THEN
        RAISE EXCEPTION 'VERIFICACAO S1: trilha lojas deve nascer em calibrating. HALT.';
    END IF;
END
$mig$;
