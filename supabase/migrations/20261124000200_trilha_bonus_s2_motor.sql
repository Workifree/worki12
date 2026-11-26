-- Migration: Trilha de bonus do operador, S2 — captura de ator, livro de turnos e motor (INERTE)
-- File: supabase/migrations/20261124000200_trilha_bonus_s2_motor.sql
-- Spec:  .harness/spec/trilha-bonus-operador/spec.md (R9, R9b, R10, R11, AF1-AF4, AF8)
-- ADR:   .harness/memory-bank/decisions/ADR-20261124-trilha-bonus-operador.md (C2, C3, C4, C5, C6, C7)
--
-- O QUE ENTRA (UP)
-- ----------------------------------------------------------------------------
--   Helpers INTERNOS (sem EXECUTE para authenticated/anon): bonus_normalize_pix, bonus_local_date,
--     bonus_identity_ok, bonus_worker_exclusion, bonus_award_review_due.
--   Captura (C7) — so o que o dado NAO guarda:
--     trg_bonus_capture_job       AFTER INSERT em jobs        -> bonus_attributions (criador imutavel)
--     trg_bonus_capture_briefing  AFTER UPDATE OF default_briefing em companies -> bonus_events
--     (shift_payments: so carimbo de recibo e de estorno; o motor roda na leitura, rodada 3)
--     Todos: DEFINER, search_path vazio, primeira linha sai se programa desligado, e
--     EXCEPTION WHEN OTHERS + RAISE WARNING (R9b: a trilha NUNCA quebra criar turno, editar briefing
--     nem confirmar recibo).
--   Motor: bonus_record_application (grava o livro UMA vez, C3), bonus_compute_support (o que o
--     historico sustenta, derivado por consulta, C6) e bonus_evaluate_enrollment (idempotente).
--
-- REGRAS QUE ESTA FATIA FIXA
-- ----------------------------------------------------------------------------
--   C2  Identidade do operador (bonus_identity_ok): membro ATIVO em company_members (confirmado, via
--       internal_company_confirmed_operator) E nao e o dono (owner_id / id da empresa) E nao e membro
--       de organizacao dona da unidade E nao esta em bonus_vetos. A conta do dono (que o concierge usa)
--       nunca passa, entao acao do concierge nunca gera atribuicao nem evento.
--   C3  O livro nasce quando o recibo fecha dos dois lados: applications com os 4 carimbos
--       (check-in/out do freela + confirmacoes da empresa) + shift_payments recorded com
--       worker_confirmed_at. `counted` e `exclusion_reason` sao decididos NA INSERCAO, em ordem, com a
--       inscricao travada FOR UPDATE, e nunca recalculados. Instantes: so os do SERVIDOR (rodada 2).
--   C6  Derivado por consulta: marcos 4/6 (team_connections.invited_by), 11 (shift_calls.created_by),
--       7-9 e 12-20 (livro + atribuicao). Sem E3, invited_by e NULL: 4 e 6 ficam inertes (C9).
--   AF1 exclusoes silenciosas: freela vetado, mesma pessoa, mesma chave PIX do operador (ou de vetado).
--       CPF/telefone do OPERADOR nao existem no sistema (operador e membro de empresa, nao tem linha em
--       workers): so PIX e identidade sao comparados (ADR, "Negativas"). Comparacao de PIX/telefone
--       ENTRE freelas do mesmo operador--       ENTRE freelas do mesmo operador gera flag (shared_pix/shared_phone), nao exclusao.
--   AF2 duracao minima, horarios plausiveis (janela do turno +- tolerancias), antecedencia minima.
--   AF3 tetos por dia/semana (seg-dom, SP) e por freela/semana: o excedente so deixa de contar.
--   AF4 flags -> review='open' (fila do admin). stuck_times existe mas nasce desligada.
--   Limiares: TODOS vem de milestones_snapshot (R6/A40); nenhuma constante de limiar nas funcoes.
--       (Constantes legitimas: fuso 'America/Sao_Paulo' e o formato de semana ISO.)
--   Marco 20 (constancia): avaliado na primeira chamada depois de ends_at (C4).
--   Cap: toda insercao de award passa pelo trigger de teto (S1) e a avaliacao nunca tenta inserir par
--       (marco, tier) existente.
--
-- RODADA 2 — A1: A EVIDENCIA E ESCRITA PELO CLIENTE, O RELOGIO NAO
-- ----------------------------------------------------------------------------
--   Quatro ganchos de carimbo (trg_bonus_0_stamp_*) gravam em bonus_server_stamps o instante do
--   SERVIDOR e o ator de: os 4 carimbos de applications (inclusive vindos preenchidos no INSERT),
--   shift_payments.worker_confirmed_at, convite/aceite de Elenco e o primeiro aceite de chamado.
--   O livro EXIGE os 4 carimbos + recibo; carimbo do servidor ausente nao conta (fail closed).
--     - completed_at = carimbo do servidor do worker_confirmed_at (R10);
--     - duracao minima, recibo rapido, rajada, stuck_times e voided_after: so carimbo do servidor;
--     - check-in/out e recibo precisam ter sido escritos pelo PROPRIO freela (wrong_actor) e as
--       confirmacoes da empresa por outra pessoa;
--     - valor declarado que diverge do relogio alem de clock_tolerance_min (inclui futuro): nao conta;
--     - check-out antes do inicio do turno nunca conta;
--     - agenda alterada depois da criacao: flag schedule_changed (fila).
--   stuck_times DESLIGADA por padrao (stuck_times_enabled).
--   #13 identidade reconferida no livro: quem deixou de ser operador nao acumula.
--   M4  turno so vale enquanto jobs.company_id = empresa da inscricao.
--   B2  recibo estornado (sem substituto confirmado) nao sustenta conquista futura.
--   A2  bonus_recheck_payability: veto de mesmo PIX revalidado depois (troca de chave).
--
-- Article 8: nada aqui toca o razao financeiro nem chama RPC de saldo. shift_payments so e LIDA
-- (o trigger observa worker_confirmed_at/status; nenhuma coluna financeira e escrita).
--
-- NO-OP: programa desligado (enabled=false) e zero inscricoes => cada gancho sai na primeira linha.
--
-- DOWN (rollback):
--   DROP TRIGGER IF EXISTS trg_bonus_capture_job ON public.jobs;
--   DROP TRIGGER IF EXISTS trg_bonus_capture_briefing ON public.companies;
--   (rodada 3: nao ha gancho que avalie; so os de carimbo e captura)
--   DROP TRIGGER IF EXISTS trg_bonus_0_stamp_application ON public.applications;
--   DROP TRIGGER IF EXISTS trg_bonus_0_stamp_payment ON public.shift_payments;
--   DROP TRIGGER IF EXISTS trg_bonus_0_stamp_connection ON public.team_connections;
--   DROP TRIGGER IF EXISTS trg_bonus_0_stamp_call ON public.shift_calls;
--   DROP FUNCTION IF EXISTS public.bonus_stamp_application(), public.bonus_stamp_shift_payment(),
--       public.bonus_stamp_team_connection(), public.bonus_stamp_shift_call(),
--       public.bonus_put_stamp(uuid, text, uuid, timestamptz), public.bonus_ledger_is_live(uuid, uuid, uuid),
--       public.bonus_recheck_payability(uuid);
--   DROP FUNCTION IF EXISTS public.bonus_capture_job(), public.bonus_capture_briefing(),
--       public.bonus_apply_voids(uuid), public.bonus_pull_open_from_payout(uuid), public.bonus_evaluate_enrollment(uuid),
--       public.bonus_materialize_enrollment(uuid),
--       public.bonus_compute_support(uuid), public.bonus_record_application(uuid, uuid),
--       public.bonus_award_review_due(jsonb), public.bonus_worker_exclusion(uuid, uuid),
--       public.bonus_identity_ok(uuid, uuid), public.bonus_local_date(timestamptz),
--       public.bonus_normalize_pix(text);
--
-- SIMULACAO CONTRA PRODUCAO (E0/E1 aplicadas; S1 aplicada antes; E2-E5 ausentes):
--   gate 1 (S1) passa se S1 foi aplicada; senao acusa a ordem e NAO cria nada.
--   gate 2 (E1) passa: internal_company_confirmed_operator existe.
--   gate 3 (triggers de outros donos): nenhum trigger nosso existe antes; os tres sao criados aqui.
--   E3 ausente: NOTICE, sem bloqueio. As tres tabelas-alvo dos ganchos (jobs, companies, shift_payments)
--   existem. Em producao hoje o programa esta desligado: os ganchos so executam o SELECT de enabled.

-- ============================================================================
-- 0. PORTAO
-- ============================================================================
DO $mig$
DECLARE
    v_faltando text := '';
    t          text;
BEGIN
    FOREACH t IN ARRAY ARRAY['bonus_program_settings', 'bonus_tracks', 'bonus_milestones', 'bonus_enrollments',
                             'bonus_attributions', 'bonus_events', 'bonus_shift_ledger', 'bonus_awards',
                             'bonus_payouts', 'bonus_vetos', 'bonus_admin_log', 'bonus_server_stamps']
    LOOP
        IF to_regclass('public.' || t) IS NULL THEN
            v_faltando := v_faltando || ' [' || t || ']';
        END IF;
    END LOOP;
    IF v_faltando <> '' THEN
        RAISE EXCEPTION
          'ASSERCAO S2: S1 (20261124000100) nao aplicada; tabelas ausentes:%. Ordem: S1 -> S2 -> S3 -> S4. Nada foi criado. HALT.',
          v_faltando;
    END IF;
    IF to_regprocedure('public.internal_company_confirmed_operator(uuid, uuid)') IS NULL THEN
        RAISE EXCEPTION 'ASSERCAO S2: E1 (20261123000200) nao aplicada: internal_company_confirmed_operator ausente. HALT.';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_trigger tg
                    WHERE tg.tgrelid = 'public.team_connections'::regclass
                      AND tg.tgname = 'trg_team_connections_invited_by' AND NOT tg.tgisinternal) THEN
        RAISE NOTICE 'S2: E3 ausente — team_connections.invited_by fica NULL; marcos 4 e 6 inertes ate E3 (C9).';
    END IF;
    -- nenhum gancho nosso pode existir sob outro dono: evita sobrescrever trigger alheio por nome
    IF EXISTS (SELECT 1 FROM pg_trigger tg
                WHERE tg.tgname IN ('trg_bonus_capture_job', 'trg_bonus_capture_briefing', 'trg_bonus_0_stamp_payment')
                  AND tg.tgrelid NOT IN ('public.jobs'::regclass, 'public.companies'::regclass,
                                         'public.shift_payments'::regclass)) THEN
        RAISE EXCEPTION 'ASSERCAO S2: gancho trg_bonus_* existe em tabela inesperada. HALT.';
    END IF;
END
$mig$;

-- ============================================================================
-- 1. HELPERS INTERNOS
-- ============================================================================

-- 1.1 Normaliza chave PIX / telefone para comparacao (espelha normalizePixKeyForStorage do frontend e
--     e mais estrito: e-mail e chave aleatoria em minusculas; cpf/cnpj/telefone so digitos; DDI 55
--     removido de telefone).
CREATE OR REPLACE FUNCTION public.bonus_normalize_pix(p_key text)
RETURNS text
LANGUAGE sql
IMMUTABLE
SET search_path = ''
AS $fn$
    SELECT CASE
        WHEN p_key IS NULL OR btrim(p_key) = '' THEN NULL
        WHEN p_key LIKE '%@%' THEN lower(btrim(p_key))
        WHEN btrim(p_key) ~ '^[0-9 ().+/-]+$' THEN
            CASE
                WHEN length(regexp_replace(p_key, '[^0-9]', '', 'g')) IN (12, 13)
                     AND regexp_replace(p_key, '[^0-9]', '', 'g') LIKE '55%'
                THEN substr(regexp_replace(p_key, '[^0-9]', '', 'g'), 3)
                ELSE regexp_replace(p_key, '[^0-9]', '', 'g')
            END
        ELSE lower(btrim(p_key))
    END;
$fn$;

CREATE OR REPLACE FUNCTION public.bonus_local_date(p_ts timestamptz)
RETURNS date
LANGUAGE sql
STABLE
SET search_path = ''
AS $fn$
    SELECT (p_ts AT TIME ZONE 'America/Sao_Paulo')::date;
$fn$;

-- 1.2 C2: a PESSOA p_user opera a empresa como membro confirmado, nao dono, nao do Worki, nao vetada.
--     Aceita "por qual usuario perguntar" => SEM EXECUTE para authenticated/anon.
CREATE OR REPLACE FUNCTION public.bonus_identity_ok(p_company_id uuid, p_user_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $fn$
    SELECT p_company_id IS NOT NULL
       AND p_user_id IS NOT NULL
       AND public.internal_company_confirmed_operator(p_company_id, p_user_id)
       -- precisa ser MEMBRO (linha propria em company_members); dono e operador de organizacao
       -- tambem passam no helper acima, por isso a exigencia explicita:
       AND EXISTS (SELECT 1 FROM public.company_members cm
                    WHERE cm.company_id = p_company_id
                      AND cm.user_id    = p_user_id
                      AND cm.status     = 'active')
       AND NOT EXISTS (SELECT 1 FROM public.companies c
                        WHERE c.id = p_company_id
                          AND (c.owner_id = p_user_id OR c.id = p_user_id))
       AND NOT EXISTS (SELECT 1
                         FROM public.organization_members om
                         JOIN public.companies c2 ON c2.organization_id = om.organization_id
                        WHERE c2.id = p_company_id
                          AND om.user_id = p_user_id
                          AND om.status = 'active')
       AND NOT EXISTS (SELECT 1 FROM public.bonus_vetos v WHERE v.person_id = p_user_id);
$fn$;

-- 1.3 AF1: este freela NAO conta para esta inscricao? Devolve o motivo interno ou NULL.
CREATE OR REPLACE FUNCTION public.bonus_worker_exclusion(p_enrollment_id uuid, p_worker_id uuid)
RETURNS text
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $fn$
DECLARE
    v_op   uuid;
    v_opix text;
    v_wpix text;
BEGIN
    SELECT e.operator_user_id, e.pix_key_normalized INTO v_op, v_opix
      FROM public.bonus_enrollments e WHERE e.id = p_enrollment_id;
    IF NOT FOUND OR p_worker_id IS NULL THEN
        RETURN 'same_identity';
    END IF;
    IF p_worker_id = v_op THEN
        RETURN 'same_identity';
    END IF;
    IF EXISTS (SELECT 1 FROM public.bonus_vetos v WHERE v.person_id = p_worker_id) THEN
        RETURN 'vetoed_worker';
    END IF;
    SELECT public.bonus_normalize_pix(w.pix_key) INTO v_wpix FROM public.workers w WHERE w.id = p_worker_id;
    -- a chave do operador tambem e comparada com o telefone e o CPF do freela
    IF v_opix IS NOT NULL AND EXISTS (
           SELECT 1 FROM public.workers w
            WHERE w.id = p_worker_id
              AND v_opix IN (public.bonus_normalize_pix(w.phone), public.bonus_normalize_pix(w.cpf))) THEN
        RETURN 'same_identity';
    END IF;
    IF v_wpix IS NOT NULL THEN
        IF v_opix IS NOT NULL AND v_opix = v_wpix THEN
            RETURN 'same_identity';
        END IF;
        IF EXISTS (SELECT 1
                     FROM public.bonus_vetos v
                     JOIN public.workers wv ON wv.id = v.person_id
                    WHERE public.bonus_normalize_pix(wv.pix_key) = v_wpix) THEN
            RETURN 'vetoed_worker';
        END IF;
    END IF;
    RETURN NULL;
END;
$fn$;

-- 1.4 Menor review_due_at entre os turnos ABERTOS da evidencia; NULL = nenhum aberto (C4).
CREATE OR REPLACE FUNCTION public.bonus_award_review_due(p_evidence jsonb)
RETURNS timestamptz
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $fn$
    SELECT min(l.review_due_at)
      FROM public.bonus_shift_ledger l
     WHERE l.review = 'open'
       AND l.id::text IN (SELECT jsonb_array_elements_text(p_evidence->'ledger_ids'));
$fn$;

-- 1.5 M4 + B2: o turno do livro ainda vale para esta empresa?
CREATE OR REPLACE FUNCTION public.bonus_ledger_is_live(p_company_id uuid, p_job_id uuid, p_worker_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $fn$
    SELECT NOT EXISTS (SELECT 1 FROM public.jobs j
                        WHERE j.id = p_job_id AND j.company_id IS DISTINCT FROM p_company_id)
       AND NOT (
            EXISTS (SELECT 1 FROM public.shift_payments v
                     WHERE v.job_id = p_job_id AND v.worker_id = p_worker_id AND v.status = 'voided')
            AND NOT EXISTS (SELECT 1 FROM public.shift_payments r
                             WHERE r.job_id = p_job_id AND r.worker_id = p_worker_id
                               AND r.status = 'recorded' AND r.worker_confirmed_at IS NOT NULL)
       );
$fn$;

-- ============================================================================
-- 1b. CARIMBOS DO SERVIDOR (A1). Independem do interruptor: valem para turnos ja atribuidos e
--     vinculos de quem tem inscricao ativa (nenhuma linha para as contas atuais). Nunca quebram o fluxo.
-- ============================================================================
CREATE OR REPLACE FUNCTION public.bonus_put_stamp(p_subject uuid, p_kind text, p_job uuid, p_declared timestamptz)
RETURNS void
LANGUAGE sql
VOLATILE
SECURITY DEFINER
SET search_path = ''
AS $fn$
    INSERT INTO public.bonus_server_stamps (subject_id, kind, job_id, actor_user_id, declared_at, stamped_at)
    VALUES (p_subject, p_kind, p_job, auth.uid(), p_declared, clock_timestamp())
    ON CONFLICT (subject_id, kind) DO NOTHING;
$fn$;

CREATE OR REPLACE FUNCTION public.bonus_stamp_application()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
SET lock_timeout = '2s'
AS $fn$
DECLARE
    v_new jsonb;
    v_old jsonb := '{}'::jsonb;
    r     record;
BEGIN
    IF NOT EXISTS (SELECT 1 FROM public.bonus_attributions ba WHERE ba.job_id = NEW.job_id) THEN
        RETURN NEW;
    END IF;
    IF TG_OP = 'UPDATE' THEN
        v_old := to_jsonb(OLD);
    END IF;
    v_new := to_jsonb(NEW);
    FOR r IN SELECT * FROM (VALUES ('worker_checkin_at', 'worker_checkin'),
                                   ('worker_checkout_at', 'worker_checkout'),
                                   ('company_checkin_confirmed_at', 'company_checkin'),
                                   ('company_checkout_confirmed_at', 'company_checkout')) AS v(col, kind)
    LOOP
        IF (v_new ->> r.col) IS NOT NULL AND (v_old ->> r.col) IS NULL THEN
            PERFORM public.bonus_put_stamp(NEW.id, r.kind, NEW.job_id, (v_new ->> r.col)::timestamptz);
        END IF;
    END LOOP;
    RETURN NEW;
EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'public.bonus_stamp_application engoliu um erro: % %', SQLSTATE, SQLERRM;
    RETURN NEW;
END;
$fn$;

CREATE OR REPLACE FUNCTION public.bonus_stamp_shift_payment()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
SET lock_timeout = '2s'
AS $fn$
BEGIN
    IF EXISTS (SELECT 1 FROM public.bonus_attributions ba WHERE ba.job_id = NEW.job_id) THEN
        IF NEW.worker_confirmed_at IS NOT NULL THEN
            PERFORM public.bonus_put_stamp(NEW.id, 'receipt_confirmed', NEW.job_id, NEW.worker_confirmed_at);
        END IF;
        IF NEW.status = 'voided' THEN
            PERFORM public.bonus_put_stamp(NEW.id, 'receipt_voided', NEW.job_id, NULL);
        END IF;
    END IF;
    RETURN NEW;
EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'public.bonus_stamp_shift_payment engoliu um erro: % %', SQLSTATE, SQLERRM;
    RETURN NEW;
END;
$fn$;

CREATE OR REPLACE FUNCTION public.bonus_stamp_team_connection()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
SET lock_timeout = '2s'
AS $fn$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM public.bonus_enrollments e
                    WHERE e.company_id = NEW.company_id AND e.status = 'active') THEN
        RETURN NEW;
    END IF;
    IF TG_OP = 'INSERT' THEN
        PERFORM public.bonus_put_stamp(NEW.id, 'elenco_invite', NULL, NEW.created_at);
    END IF;
    IF NEW.status = 'accepted' THEN
        PERFORM public.bonus_put_stamp(NEW.id, 'elenco_accept', NULL, NULL);
    END IF;
    RETURN NEW;
EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'public.bonus_stamp_team_connection engoliu um erro: % %', SQLSTATE, SQLERRM;
    RETURN NEW;
END;
$fn$;

CREATE OR REPLACE FUNCTION public.bonus_stamp_shift_call()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
SET lock_timeout = '2s'
AS $fn$
BEGIN
    IF NEW.first_claim_at IS NOT NULL
       AND EXISTS (SELECT 1 FROM public.bonus_enrollments e
                    WHERE e.company_id = NEW.company_id AND e.operator_user_id = NEW.created_by
                      AND e.status = 'active') THEN
        PERFORM public.bonus_put_stamp(NEW.id, 'call_claim', NULL, NEW.first_claim_at);
    END IF;
    RETURN NEW;
EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'public.bonus_stamp_shift_call engoliu um erro: % %', SQLSTATE, SQLERRM;
    RETURN NEW;
END;
$fn$;

-- ============================================================================
-- 2. CAPTURA DE ATOR (C7) — so o que o dado nao guarda. Nunca quebra o fluxo principal (R9b).
-- ============================================================================

-- 2.1 Quem CRIOU o turno. Sessao nula (service_role/cron/admin), dono e concierge nao geram.
CREATE OR REPLACE FUNCTION public.bonus_capture_job()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
SET lock_timeout = '2s'
AS $fn$
DECLARE
    v_uid uuid := auth.uid();
    v_enr uuid;
BEGIN
    IF v_uid IS NULL THEN
        RETURN NEW;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM public.bonus_program_settings s WHERE s.enabled) THEN
        RETURN NEW;
    END IF;
    SELECT e.id INTO v_enr
      FROM public.bonus_enrollments e
     WHERE e.operator_user_id = v_uid
       AND e.company_id       = NEW.company_id
       AND e.status           = 'active'
       AND now() >= e.starts_at AND now() < e.ends_at;
    IF NOT FOUND THEN
        RETURN NEW;
    END IF;
    IF NOT public.bonus_identity_ok(NEW.company_id, v_uid) THEN
        RETURN NEW;
    END IF;
    -- job_created_at = relogio do SERVIDOR (jobs.created_at e escrito pelo cliente) + agenda original
    INSERT INTO public.bonus_attributions (job_id, enrollment_id, operator_user_id, job_created_at,
                                           sched_start_date, sched_work_start, sched_work_end)
    VALUES (NEW.id, v_enr, v_uid, now(), NEW.start_date, NEW.work_start_time, NEW.work_end_time)
    ON CONFLICT (job_id) DO NOTHING;
    RETURN NEW;
EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'public.bonus_capture_job engoliu um erro: % %', SQLSTATE, SQLERRM;
    RETURN NEW;
END;
$fn$;

-- 2.2 Autoria do briefing padrao (passa de curto/vazio para >= minimo de caracteres). So na PRIMEIRA
--     vez que a empresa tem briefing: preenchido antes do aceite, ou por qualquer pessoa durante a
--     trilha, e depois apagado e regravado, nao vale de novo.
CREATE OR REPLACE FUNCTION public.bonus_capture_briefing()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
SET lock_timeout = '2s'
AS $fn$
DECLARE
    v_uid     uuid := auth.uid();
    e         record;
    v_min     integer;
    v_was     boolean;
    v_is      boolean;
    v_already boolean;
BEGIN
    IF NOT EXISTS (SELECT 1 FROM public.bonus_program_settings s WHERE s.enabled) THEN
        RETURN NEW;
    END IF;
    FOR e IN SELECT x.id, x.operator_user_id, x.milestones_snapshot, x.starts_at, x.ends_at
               FROM public.bonus_enrollments x
              WHERE x.company_id = NEW.id AND x.status = 'active'
    LOOP
        v_min := (e.milestones_snapshot->'track'->'params'->>'briefing_min_chars')::integer;
        v_was := length(btrim(COALESCE(OLD.default_briefing, ''))) >= v_min;
        v_is  := length(btrim(COALESCE(NEW.default_briefing, ''))) >= v_min;
        v_already := v_was
            OR COALESCE((e.milestones_snapshot->>'briefing_prefilled')::boolean, false)
            OR EXISTS (SELECT 1 FROM public.bonus_server_stamps s
                        WHERE s.subject_id = NEW.id AND s.kind = 'briefing_filled');
        IF v_is AND NOT v_already
           AND v_uid IS NOT DISTINCT FROM e.operator_user_id
           AND now() >= e.starts_at AND now() < e.ends_at
           AND public.bonus_identity_ok(NEW.id, v_uid) THEN
            INSERT INTO public.bonus_events (enrollment_id, kind, ref_id, actor_user_id)
            VALUES (e.id, 'briefing', NEW.id, v_uid)
            ON CONFLICT (enrollment_id, kind) DO NOTHING;
        END IF;
        IF v_was OR v_is THEN
            PERFORM public.bonus_put_stamp(NEW.id, 'briefing_filled', NULL, NULL);
        END IF;
    END LOOP;
    RETURN NEW;
EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'public.bonus_capture_briefing engoliu um erro: % %', SQLSTATE, SQLERRM;
    RETURN NEW;
END;
$fn$;

-- 2.3 (rodada 3) NAO HA gancho que rode o motor. A confirmacao do recibo e o estorno so deixam
--     carimbo (bonus_stamp_shift_payment): statement_timeout/query_canceled nao e capturado por
--     WHEN OTHERS, entao nada pesado pode rodar na transacao do freela. Livro, awards e sinalizacao
--     de estorno acontecem na LEITURA (C4): abrir a tela, pedir saque, fila/lista do admin.

-- ============================================================================
-- 3. MOTOR
-- ============================================================================

-- 3.1 Grava o livro UMA vez para (inscricao, application). A inscricao ja vem TRAVADA pelo chamador.
CREATE OR REPLACE FUNCTION public.bonus_record_application(p_enrollment_id uuid, p_application_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $fn$
DECLARE
    v_tz        constant text := 'America/Sao_Paulo';
    e           record;
    a           record;
    j           record;
    sp          record;
    ba          record;
    st          record;
    t           jsonb;
    v_day       date;
    v_week      date;
    v_ini       timestamptz;
    v_fim       timestamptz;
    v_done      timestamptz;
    v_checkout  timestamptz;
    v_dur       integer;
    v_tol       interval;
    v_reason    text;
    v_counted   boolean;
    v_flags     text[] := '{}'::text[];
    v_n         integer;
    v_tot       integer;
    v_wpix      text;
    v_wphone    text;
    v_start_t   time;
BEGIN
    SELECT * INTO e FROM public.bonus_enrollments WHERE id = p_enrollment_id;
    IF NOT FOUND OR e.status NOT IN ('active', 'ended') THEN
        RETURN;
    END IF;
    IF EXISTS (SELECT 1 FROM public.bonus_shift_ledger l WHERE l.application_id = p_application_id) THEN
        RETURN;
    END IF;
    t := e.milestones_snapshot->'track'->'params';

    -- os QUATRO carimbos sao exigidos (check-in/out do freela E confirmacoes da empresa)
    SELECT ap.id, ap.job_id, ap.worker_id, ap.status,
           ap.worker_checkin_at AS ci, ap.worker_checkout_at AS co,
           ap.company_checkin_confirmed_at AS cci, ap.company_checkout_confirmed_at AS cco
      INTO a
      FROM public.applications ap
     WHERE ap.id = p_application_id;
    IF NOT FOUND
       OR a.status NOT IN ('hired', 'in_progress', 'completed')
       OR a.ci IS NULL OR a.co IS NULL OR a.cci IS NULL OR a.cco IS NULL THEN
        RETURN;
    END IF;
    SELECT x.job_created_at, x.sched_start_date, x.sched_work_start, x.sched_work_end INTO ba
      FROM public.bonus_attributions x
     WHERE x.job_id = a.job_id AND x.enrollment_id = p_enrollment_id;
    IF NOT FOUND THEN
        RETURN;
    END IF;

    -- M4: o turno precisa continuar sendo da empresa da inscricao
    SELECT jb.start_date, jb.work_start_time, jb.work_end_time, jb.status
      INTO j FROM public.jobs jb WHERE jb.id = a.job_id AND jb.company_id = e.company_id;
    IF NOT FOUND OR j.start_date IS NULL OR COALESCE(j.status, '') = 'deleted' THEN
        RETURN;
    END IF;

    SELECT s2.id, s2.worker_confirmed_at INTO sp
      FROM public.shift_payments s2
     WHERE s2.job_id = a.job_id AND s2.worker_id = a.worker_id
       AND s2.status = 'recorded' AND s2.worker_confirmed_at IS NOT NULL;
    IF NOT FOUND THEN
        RETURN;
    END IF;
    IF EXISTS (SELECT 1 FROM public.bonus_shift_ledger l
                WHERE l.enrollment_id = p_enrollment_id AND l.job_id = a.job_id AND l.worker_id = a.worker_id) THEN
        RETURN;                                                                     -- B1
    END IF;

    -- relogio e ator do SERVIDOR
    SELECT max(s.stamped_at) FILTER (WHERE s.kind = 'worker_checkin')   AS wci,
           max(s.stamped_at) FILTER (WHERE s.kind = 'worker_checkout')  AS wco,
           max(s.stamped_at) FILTER (WHERE s.kind = 'company_checkin')  AS cci,
           max(s.stamped_at) FILTER (WHERE s.kind = 'company_checkout') AS cco,
           bool_and(s.actor_user_id IS NOT DISTINCT FROM a.worker_id)
               FILTER (WHERE s.kind IN ('worker_checkin', 'worker_checkout'))   AS worker_own,
           bool_and(s.actor_user_id IS DISTINCT FROM a.worker_id)
               FILTER (WHERE s.kind IN ('company_checkin', 'company_checkout')) AS company_not_worker,
           (SELECT r.stamped_at FROM public.bonus_server_stamps r
             WHERE r.subject_id = sp.id AND r.kind = 'receipt_confirmed')       AS rcp,
           (SELECT r.actor_user_id FROM public.bonus_server_stamps r
             WHERE r.subject_id = sp.id AND r.kind = 'receipt_confirmed')       AS rcp_actor
      INTO st
      FROM public.bonus_server_stamps s
     WHERE s.subject_id = a.id;

    v_done     := COALESCE(st.rcp, clock_timestamp());          -- instante do turno completo (R10)
    v_checkout := COALESCE(st.wco, a.co);
    v_day  := public.bonus_local_date(j.start_date);
    v_week := date_trunc('week', v_day::timestamp)::date;          -- segunda-feira (ISO), data local
    v_ini  := CASE WHEN j.work_start_time IS NULL
                   THEN (v_day::timestamp AT TIME ZONE v_tz)
                   ELSE ((v_day + j.work_start_time) AT TIME ZONE v_tz) END;
    v_fim  := CASE WHEN j.work_start_time IS NULL OR j.work_end_time IS NULL
                   THEN (((v_day + 1)::timestamp) AT TIME ZONE v_tz)
                   WHEN j.work_end_time > j.work_start_time
                   THEN ((v_day + j.work_end_time) AT TIME ZONE v_tz)
                   ELSE (((v_day + 1) + j.work_end_time) AT TIME ZONE v_tz) END;   -- cruza meia-noite
    v_dur  := COALESCE(floor(extract(epoch FROM (st.wco - st.wci)) / 60)::integer, 0);   -- servidor
    v_start_t := (v_ini AT TIME ZONE v_tz)::time;
    v_tol  := make_interval(mins => (t->>'clock_tolerance_min')::integer);

    -- ---- identidade -> AF1 -> A1 -> AF2 -> AF3: o primeiro que reprova decide; tudo silencioso ----
    IF NOT public.bonus_identity_ok(e.company_id, e.operator_user_id) THEN
        v_reason := 'operator_not_member';                          -- removido nao acumula
    ELSE
        v_reason := public.bonus_worker_exclusion(p_enrollment_id, a.worker_id);
    END IF;
    IF v_reason IS NULL
       AND (st.wci IS NULL OR st.wco IS NULL OR st.cci IS NULL OR st.cco IS NULL OR st.rcp IS NULL) THEN
        v_reason := 'missing_stamp';                                -- fail closed
    END IF;
    IF v_reason IS NULL
       AND NOT (st.worker_own AND st.company_not_worker AND st.rcp_actor IS NOT DISTINCT FROM a.worker_id) THEN
        v_reason := 'wrong_actor';
    END IF;
    IF v_reason IS NULL
       AND (   a.ci  NOT BETWEEN st.wci - v_tol AND st.wci + v_tol
            OR a.co  NOT BETWEEN st.wco - v_tol AND st.wco + v_tol
            OR a.cci NOT BETWEEN st.cci - v_tol AND st.cci + v_tol
            OR a.cco NOT BETWEEN st.cco - v_tol AND st.cco + v_tol
            OR sp.worker_confirmed_at NOT BETWEEN st.rcp - v_tol AND st.rcp + v_tol) THEN
        v_reason := 'clock_mismatch';                               -- inclui declarado no futuro
    END IF;
    IF v_reason IS NULL
       AND (st.wco < e.starts_at OR st.wco > e.ends_at
            OR v_done > e.ends_at + make_interval(days => (t->>'receipt_grace_days')::integer)) THEN
        v_reason := 'out_of_window';
    END IF;
    IF v_reason IS NULL
       AND (a.co <= a.ci
            OR st.wco <= st.wci
            OR a.co <= v_ini OR st.wco <= v_ini                     -- check-out antes do inicio: nunca
            OR st.wci < v_ini - make_interval(mins => (t->>'checkin_tolerance_min')::integer)
            OR st.wco > v_fim + make_interval(mins => (t->>'checkout_tolerance_min')::integer)) THEN
        v_reason := 'implausible_times';
    END IF;
    IF v_reason IS NULL AND v_dur < (t->>'min_shift_minutes')::integer THEN
        v_reason := 'short_duration';
    END IF;
    IF v_reason IS NULL
       AND (v_ini - ba.job_created_at) < make_interval(mins => (t->>'min_lead_minutes')::integer) THEN
        v_reason := 'no_lead_time';
    END IF;
    IF v_reason IS NULL THEN
        SELECT count(*) INTO v_n FROM public.bonus_shift_ledger l
         WHERE l.enrollment_id = p_enrollment_id AND l.counted AND l.shift_date = v_day;
        IF v_n >= (t->>'max_counted_per_day')::integer THEN v_reason := 'day_cap'; END IF;
    END IF;
    IF v_reason IS NULL THEN
        SELECT count(*) INTO v_n FROM public.bonus_shift_ledger l
         WHERE l.enrollment_id = p_enrollment_id AND l.counted
           AND l.shift_date >= v_week AND l.shift_date < v_week + 7;
        IF v_n >= (t->>'max_counted_per_week')::integer THEN v_reason := 'week_cap'; END IF;
    END IF;
    IF v_reason IS NULL THEN
        SELECT count(*) INTO v_n FROM public.bonus_shift_ledger l
         WHERE l.enrollment_id = p_enrollment_id AND l.counted AND l.worker_id = a.worker_id
           AND l.shift_date >= v_week AND l.shift_date < v_week + 7;
        IF v_n >= (t->>'max_per_worker_week')::integer THEN v_reason := 'worker_week_cap'; END IF;
    END IF;
    v_counted := v_reason IS NULL;

    -- ---- AF4: anomalias (so em turno contavel; nenhuma bloqueia nada) ----
    IF v_counted THEN
        IF j.start_date IS DISTINCT FROM ba.sched_start_date
           OR j.work_start_time IS DISTINCT FROM ba.sched_work_start
           OR j.work_end_time IS DISTINCT FROM ba.sched_work_end THEN
            v_flags := array_append(v_flags, 'schedule_changed');
        END IF;

        SELECT count(*) INTO v_n FROM public.bonus_shift_ledger l
         WHERE l.enrollment_id = p_enrollment_id AND l.counted
           AND l.completed_at   >= v_done - make_interval(hours => (t->>'burst_window_hours')::integer)
           AND l.job_created_at >= v_done - make_interval(hours => (t->>'burst_window_hours')::integer);
        IF v_n + 1 >= (t->>'burst_count')::integer
           AND ba.job_created_at >= v_done - make_interval(hours => (t->>'burst_window_hours')::integer) THEN
            v_flags := array_append(v_flags, 'burst');
        END IF;

        SELECT count(*) INTO v_tot FROM public.bonus_shift_ledger l
         WHERE l.enrollment_id = p_enrollment_id AND l.counted;
        SELECT count(*) INTO v_n FROM public.bonus_shift_ledger l
         WHERE l.enrollment_id = p_enrollment_id AND l.counted AND l.worker_id = a.worker_id;
        IF v_tot + 1 >= (t->>'single_worker_min_shifts')::integer
           AND (v_n + 1) * 100 >= (t->>'single_worker_pct')::integer * (v_tot + 1) THEN
            v_flags := array_append(v_flags, 'single_worker');
        END IF;

        IF (t->>'stuck_times_enabled')::integer = 1
           AND (   abs(extract(epoch FROM (st.cco - st.cci))) / 60 < (t->>'stuck_minutes')::integer
                OR abs(extract(epoch FROM (st.wco - st.wci))) / 60 < (t->>'stuck_minutes')::integer) THEN
            v_flags := array_append(v_flags, 'stuck_times');
        END IF;

        SELECT count(*) INTO v_n FROM public.bonus_shift_ledger l
         WHERE l.enrollment_id = p_enrollment_id AND l.counted AND l.worker_id = a.worker_id
           AND l.start_local_time = v_start_t
           AND l.duration_minutes = floor(extract(epoch FROM (a.co - a.ci)) / 60)::integer;
        IF v_n + 1 >= (t->>'pattern_count')::integer THEN
            v_flags := array_append(v_flags, 'repeat_pattern');
        END IF;

        SELECT public.bonus_normalize_pix(w.pix_key), public.bonus_normalize_pix(w.phone)
          INTO v_wpix, v_wphone
          FROM public.workers w WHERE w.id = a.worker_id;
        IF v_wpix IS NOT NULL AND EXISTS (
               SELECT 1 FROM public.bonus_shift_ledger l
                 JOIN public.workers w2 ON w2.id = l.worker_id
                WHERE l.enrollment_id = p_enrollment_id AND l.counted AND l.worker_id <> a.worker_id
                  AND public.bonus_normalize_pix(w2.pix_key) = v_wpix) THEN
            v_flags := array_append(v_flags, 'shared_pix');
        END IF;
        IF v_wphone IS NOT NULL AND EXISTS (
               SELECT 1 FROM public.bonus_shift_ledger l
                 JOIN public.workers w2 ON w2.id = l.worker_id
                WHERE l.enrollment_id = p_enrollment_id AND l.counted AND l.worker_id <> a.worker_id
                  AND public.bonus_normalize_pix(w2.phone) = v_wphone) THEN
            v_flags := array_append(v_flags, 'shared_phone');
        END IF;
    END IF;

    -- duration_minutes guarda a duracao DECLARADA (padrao repetido); o minimo usa a do servidor
    INSERT INTO public.bonus_shift_ledger
           (enrollment_id, application_id, job_id, worker_id, job_created_at, shift_date, start_local_time,
            duration_minutes, checkout_at, completed_at, receipt_fast, counted, exclusion_reason, flags,
            review, flagged_at, review_due_at)
    VALUES (p_enrollment_id, p_application_id, a.job_id, a.worker_id, ba.job_created_at, v_day,
            v_start_t, floor(extract(epoch FROM (a.co - a.ci)) / 60)::integer, v_checkout, v_done,
            COALESCE(st.rcp <= st.wco + make_interval(hours => (t->>'receipt_hours')::integer), false),
            v_counted, v_reason, v_flags,
            CASE WHEN cardinality(v_flags) > 0 THEN 'open' ELSE 'none' END,
            CASE WHEN cardinality(v_flags) > 0 THEN now() END,
            CASE WHEN cardinality(v_flags) > 0
                 THEN now() + make_interval(hours => (t->>'review_hours')::integer) END)
    ON CONFLICT DO NOTHING;
END;
$fn$;

-- 3.2 O que o historico SUSTENTA hoje (C6): uma linha por (marco, tier) com evidencia. Nao escreve.
--     Colunas de saida com prefixo o_ para nao colidir com colunas das tabelas.
CREATE OR REPLACE FUNCTION public.bonus_compute_support(p_enrollment_id uuid)
RETURNS TABLE (o_milestone_id uuid, o_tier smallint, o_amount_cents integer, o_evidence jsonb)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $fn$
DECLARE
    e         record;
    t         jsonb;
    m         jsonb;
    tr        jsonb;
    v_mid     uuid;
    v_amt     integer;
    v_mp      jsonb;
    v_kind    text;
    v_thr     integer;
    v_ids     uuid[];
    v_dates   date[];
    v_cnt     integer;
    v_ids2    uuid[];
    v_wids    uuid[];
    v_n       integer;
    v_sup     jsonb := '{}'::jsonb;     -- marco(tier 1) -> ledger_ids que o sustentam (alimenta a colecao)
    v_ev      jsonb;
    v_carry   jsonb;
    v_call    uuid;
    v_claimant uuid;
    v_ev_id   uuid;
    v_i       integer;
    v_j       integer;
    v_shifts  integer;
    v_days    integer;
    v_ok      boolean;
    v_req     boolean;
    v_end_d   date;
BEGIN
    SELECT * INTO e FROM public.bonus_enrollments WHERE id = p_enrollment_id;
    -- tambem responde para inscricao cancelada que ja foi aceita: a decisao do dono (S4, C5) precisa
    -- saber o que ainda se sustenta. Quem CRIA award (evaluate) segue restrito a active/ended.
    IF NOT FOUND OR e.accepted_at IS NULL THEN
        RETURN;
    END IF;
    t := e.milestones_snapshot->'track'->'params';

    SELECT COALESCE(array_agg(l.id ORDER BY l.shift_date, l.completed_at, l.id), '{}'::uuid[]),
           COALESCE(array_agg(l.shift_date ORDER BY l.shift_date, l.completed_at, l.id), '{}'::date[])
      INTO v_ids, v_dates
      FROM public.bonus_shift_ledger l
     WHERE l.enrollment_id = e.id AND l.counted
       AND public.bonus_ledger_is_live(e.company_id, l.job_id, l.worker_id);
    v_cnt := cardinality(v_ids);

    FOR m IN SELECT x FROM jsonb_array_elements(e.milestones_snapshot->'milestones') AS x
              ORDER BY (x->>'sort_order')::integer
    LOOP
        v_mid  := (m->>'id')::uuid;
        v_amt  := (m->>'amount_cents')::integer;
        v_mp   := COALESCE(m->'params', '{}'::jsonb);
        v_kind := m->>'event_kind';
        v_thr  := (v_mp->>'threshold')::integer;
        v_ev   := NULL;

        IF v_kind = 'accept' THEN
            IF e.accepted_at IS NOT NULL THEN
                v_ev := jsonb_build_object('ledger_ids', '[]'::jsonb);
            END IF;

        ELSIF v_kind = 'briefing' THEN
            SELECT ev.id INTO v_ev_id FROM public.bonus_events ev
             WHERE ev.enrollment_id = e.id AND ev.kind = 'briefing'
               AND ev.occurred_at >= e.starts_at AND ev.occurred_at < e.ends_at;
            IF FOUND THEN
                v_ev := jsonb_build_object('ledger_ids', '[]'::jsonb, 'event_id', v_ev_id);
            END IF;

        ELSIF v_kind IN ('elenco_invited', 'elenco_accepted') THEN
            -- convite DIRETO (telefone/Worki ID): link grava invited_by NULL. Janela pelo relogio do
            -- servidor; o aceite precisa ter sido escrito pelo proprio freela.
            SELECT count(*), array_agg(x.worker_id) INTO v_n, v_wids
              FROM (SELECT tc.worker_id
                      FROM public.team_connections tc
                      JOIN public.bonus_server_stamps si
                        ON si.subject_id = tc.id AND si.kind = 'elenco_invite'
                       AND si.actor_user_id = e.operator_user_id
                     WHERE tc.company_id = e.company_id
                       AND tc.invited_by = e.operator_user_id
                       AND si.stamped_at >= e.starts_at AND si.stamped_at < e.ends_at
                       AND (v_kind = 'elenco_invited'
                            OR (tc.status = 'accepted' AND EXISTS (
                                    SELECT 1 FROM public.bonus_server_stamps sa
                                     WHERE sa.subject_id = tc.id AND sa.kind = 'elenco_accept'
                                       AND sa.actor_user_id = tc.worker_id)))
                       AND public.bonus_worker_exclusion(e.id, tc.worker_id) IS NULL
                     ORDER BY si.stamped_at, tc.worker_id) x;
            IF v_n >= v_thr THEN
                v_ev := jsonb_build_object('ledger_ids', '[]'::jsonb, 'worker_ids', to_jsonb(v_wids[1:v_thr]));
            END IF;

        ELSIF v_kind = 'job_published' THEN
            SELECT count(*), array_agg(q.job_id) INTO v_n, v_wids
              FROM (SELECT ba.job_id
                      FROM public.bonus_attributions ba
                      JOIN public.jobs jb ON jb.id = ba.job_id
                     WHERE ba.enrollment_id = e.id AND COALESCE(jb.status, '') <> 'deleted'
                       AND jb.company_id = e.company_id
                     ORDER BY ba.job_created_at LIMIT v_thr) q;
            IF v_n >= v_thr THEN
                v_ev := jsonb_build_object('ledger_ids', '[]'::jsonb, 'job_ids', to_jsonb(v_wids));
            END IF;

        ELSIF v_kind = 'shift_counted' THEN
            IF v_cnt >= v_thr THEN
                v_ev := jsonb_build_object('ledger_ids', to_jsonb(v_ids[1:v_thr]));
            END IF;

        ELSIF v_kind = 'receipt_fast' THEN
            SELECT COALESCE(array_agg(q.id), '{}'::uuid[]) INTO v_ids2
              FROM (SELECT l.id FROM public.bonus_shift_ledger l
                     WHERE l.enrollment_id = e.id AND l.counted AND l.receipt_fast AND l.id = ANY (v_ids)
                     ORDER BY l.completed_at, l.id LIMIT v_thr) q;
            IF cardinality(v_ids2) >= v_thr THEN
                v_ev := jsonb_build_object('ledger_ids', to_jsonb(v_ids2));
            END IF;

        ELSIF v_kind = 'call_filled' THEN
            -- instante e ator do primeiro aceite pelo relogio do servidor: quem aceitou foi o proprio freela
            SELECT sc.id, sk.actor_user_id INTO v_call, v_claimant
              FROM public.shift_calls sc
              JOIN public.bonus_server_stamps sk ON sk.subject_id = sc.id AND sk.kind = 'call_claim'
             WHERE sc.created_by = e.operator_user_id
               AND sc.company_id = e.company_id
               AND sc.status = 'filled'
               AND sk.stamped_at >= e.starts_at AND sk.stamped_at < e.ends_at
               AND EXISTS (SELECT 1 FROM public.shift_call_targets tg
                            WHERE tg.call_id = sc.id AND tg.response = 'accepted'
                              AND tg.worker_id = sk.actor_user_id
                              AND public.bonus_worker_exclusion(e.id, tg.worker_id) IS NULL)
             ORDER BY sk.stamped_at LIMIT 1;
            IF FOUND THEN
                v_ev := jsonb_build_object('ledger_ids', '[]'::jsonb, 'call_id', v_call,
                                           'worker_ids', jsonb_build_array(v_claimant));
            END IF;

        ELSIF v_kind = 'repeat_worker' THEN
            SELECT COALESCE(array_agg(q.id), '{}'::uuid[]) INTO v_ids2
              FROM (SELECT l.id FROM public.bonus_shift_ledger l
                     WHERE l.id = ANY (v_ids)
                       AND l.worker_id = (SELECT l2.worker_id FROM public.bonus_shift_ledger l2
                                           WHERE l2.id = ANY (v_ids)
                                           GROUP BY l2.worker_id
                                          HAVING count(DISTINCT l2.job_id) >= v_thr
                                           ORDER BY min(l2.completed_at) LIMIT 1)
                     ORDER BY l.completed_at, l.id LIMIT v_thr) q;
            IF cardinality(v_ids2) >= v_thr THEN
                v_ev := jsonb_build_object('ledger_ids', to_jsonb(v_ids2));
            END IF;

        ELSIF v_kind = 'active_weeks' THEN
            SELECT count(*) INTO v_n FROM (
                SELECT date_trunc('week', l.shift_date::timestamp)::date AS wk
                  FROM public.bonus_shift_ledger l
                 WHERE l.id = ANY (v_ids) GROUP BY 1) w;
            IF v_n >= v_thr THEN
                SELECT COALESCE(array_agg(q.fid), '{}'::uuid[]) INTO v_ids2 FROM (
                    SELECT (array_agg(l.id ORDER BY l.completed_at, l.id))[1] AS fid
                      FROM public.bonus_shift_ledger l
                     WHERE l.id = ANY (v_ids)
                     GROUP BY date_trunc('week', l.shift_date::timestamp)
                     ORDER BY date_trunc('week', l.shift_date::timestamp) LIMIT v_thr) q;
                v_ev := jsonb_build_object('ledger_ids', to_jsonb(v_ids2));
            END IF;

        ELSIF v_kind = 'velocity' THEN
            -- tiers do maior para o menor: o tier alto implica o baixo (casa de pombos), entao o
            -- evidence do alto e herdado quando o baixo nao tem janela propria (o maior substitui).
            v_carry := NULL;
            FOR tr IN SELECT x FROM jsonb_array_elements(v_mp->'tiers') AS x ORDER BY (x->>'tier')::integer DESC
            LOOP
                v_shifts := (tr->>'shifts')::integer;
                v_days   := (tr->>'days')::integer;
                v_ev     := NULL;
                v_i := 1;
                WHILE v_i <= v_cnt LOOP
                    v_j := v_i;
                    WHILE v_j <= v_cnt AND v_dates[v_j] <= v_dates[v_i] + (v_days - 1) LOOP
                        v_j := v_j + 1;
                    END LOOP;
                    IF v_j - v_i >= v_shifts THEN
                        v_ev := jsonb_build_object('ledger_ids', to_jsonb(v_ids[v_i : v_i + v_shifts - 1]));
                        EXIT;
                    END IF;
                    v_i := v_i + 1;
                END LOOP;
                IF v_ev IS NULL THEN
                    v_ev := v_carry;
                END IF;
                IF v_ev IS NOT NULL THEN
                    o_milestone_id := v_mid;
                    o_tier         := (tr->>'tier')::smallint;
                    o_amount_cents := (tr->>'amount_cents')::integer;
                    o_evidence     := v_ev;
                    RETURN NEXT;
                    v_carry := v_ev;
                    IF (tr->>'tier')::integer = 1 THEN
                        v_sup := v_sup || jsonb_build_object(v_mid::text, v_ev->'ledger_ids');
                    END IF;
                END IF;
            END LOOP;
            v_ev := NULL;   -- ja emitido por tier

        ELSIF v_kind = 'constancy' THEN
            -- avaliado so depois de ends_at (C4); janela fecha uma vez
            IF now() >= e.ends_at AND v_cnt >= (t->>'min_shifts_for_gap')::integer THEN
                v_ok := true;
                FOR v_i IN 2..v_cnt LOOP
                    IF v_dates[v_i] - v_dates[v_i - 1] > (t->>'max_gap_days')::integer THEN
                        v_ok := false;
                    END IF;
                END LOOP;
                v_end_d := public.bonus_local_date(e.ends_at);
                IF v_end_d - v_dates[v_cnt] > (t->>'max_gap_days')::integer THEN
                    v_ok := false;
                END IF;
                IF v_ok THEN
                    v_ev := jsonb_build_object('ledger_ids', to_jsonb(v_ids));
                END IF;
            END IF;

        ELSIF v_kind = 'collection' THEN
            -- todos os marcos dos grupos pedidos sustentados (tier 1). Evidencia = uniao dos turnos.
            v_req := true;
            FOR tr IN SELECT x FROM jsonb_array_elements(e.milestones_snapshot->'milestones') AS x
                       WHERE x->>'grp' IN (SELECT jsonb_array_elements_text(v_mp->'groups'))
                         AND (x->>'event_kind') <> 'collection'
            LOOP
                IF NOT (v_sup ? (tr->>'id')) THEN
                    v_req := false;
                END IF;
            END LOOP;
            IF v_req THEN
                v_ev := jsonb_build_object('ledger_ids', COALESCE((
                    SELECT jsonb_agg(DISTINCT z.id)
                      FROM jsonb_each(v_sup) AS s, jsonb_array_elements_text(s.value) AS z(id)), '[]'::jsonb));
            END IF;
        END IF;

        IF v_ev IS NOT NULL AND v_kind <> 'velocity' THEN
            o_milestone_id := v_mid;
            o_tier         := 1;
            o_amount_cents := v_amt;
            o_evidence     := v_ev;
            RETURN NEXT;
            v_sup := v_sup || jsonb_build_object(v_mid::text, v_ev->'ledger_ids');
        END IF;
    END LOOP;
END;
$fn$;

-- 3.3 Avaliacao idempotente: varre candidatos -> grava livro -> cria o que falta. Nunca apaga nem
--     reduz award (a unica forma de um award virar not_counted e a decisao do dono, S4).
CREATE OR REPLACE FUNCTION public.bonus_materialize_enrollment(p_enrollment_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = ''
AS $fn$
DECLARE
    e        record;
    r        record;
    s        record;
    v_hours  integer;
    v_new    integer := 0;
    v_failed integer := 0;
BEGIN
    SELECT * INTO e FROM public.bonus_enrollments WHERE id = p_enrollment_id FOR NO KEY UPDATE;
    IF NOT FOUND THEN
        RETURN jsonb_build_object('outcome', 'not_found');
    END IF;
    IF e.status NOT IN ('active', 'ended') THEN
        RETURN jsonb_build_object('outcome', 'not_active');
    END IF;

    -- 1) turnos cujo recibo fechou dos dois lados e ainda nao estao no livro, em ordem
    FOR r IN
        SELECT ap.id AS app_id
          FROM public.bonus_attributions ba
          JOIN public.jobs jb ON jb.id = ba.job_id AND jb.company_id = e.company_id          -- M4
          JOIN public.applications ap ON ap.job_id = ba.job_id
          JOIN public.shift_payments sp
            ON sp.job_id = ap.job_id AND sp.worker_id = ap.worker_id
           AND sp.status = 'recorded' AND sp.worker_confirmed_at IS NOT NULL
         WHERE ba.enrollment_id = e.id
           AND ap.status IN ('hired', 'in_progress', 'completed')
           AND ap.worker_checkin_at IS NOT NULL AND ap.worker_checkout_at IS NOT NULL
           AND ap.company_checkin_confirmed_at IS NOT NULL AND ap.company_checkout_confirmed_at IS NOT NULL
           AND NOT EXISTS (SELECT 1 FROM public.bonus_shift_ledger l WHERE l.application_id = ap.id)
         ORDER BY GREATEST(sp.worker_confirmed_at, ap.company_checkin_confirmed_at,
                           ap.company_checkout_confirmed_at, ap.worker_checkout_at), ap.id
    LOOP
        BEGIN
            PERFORM public.bonus_record_application(e.id, r.app_id);
        EXCEPTION WHEN OTHERS THEN
            v_failed := v_failed + 1;
            RAISE WARNING 'public.bonus_evaluate_enrollment: livro de % falhou: % %', r.app_id, SQLSTATE, SQLERRM;
        END;
    END LOOP;

    -- 1b) estornos carimbados desde a ultima leitura
    PERFORM public.bonus_apply_voids(e.id);

    -- 2) awards que o historico sustenta e ainda nao existem. #13: quem deixou de ser operador
    --    (removido, vetado) nao acumula marco novo; o que ja conquistou segue registrado.
    v_hours := (e.milestones_snapshot->'track'->'params'->>'validation_hours')::integer;
    FOR s IN SELECT * FROM public.bonus_compute_support(e.id)
              WHERE public.bonus_identity_ok(e.company_id, e.operator_user_id)
    LOOP
        IF EXISTS (SELECT 1 FROM public.bonus_awards a
                    WHERE a.enrollment_id = e.id AND a.milestone_id = s.o_milestone_id AND a.tier = s.o_tier
                      AND a.state <> 'not_counted') THEN
            CONTINUE;
        END IF;
        BEGIN
            -- reconquista de marco cancelado por "Nao contar": mesma linha (UNIQUE), nova janela
            UPDATE public.bonus_awards a
               SET state = 'earned', earned_at = now(), available_at = now() + make_interval(hours => v_hours),
                   evidence = s.o_evidence, celebrated_at = NULL
             WHERE a.enrollment_id = e.id AND a.milestone_id = s.o_milestone_id AND a.tier = s.o_tier
               AND a.state = 'not_counted';
            IF FOUND THEN
                v_new := v_new + 1;
                CONTINUE;
            END IF;
            INSERT INTO public.bonus_awards (enrollment_id, milestone_id, tier, amount_cents, earned_at, available_at, evidence)
            VALUES (e.id, s.o_milestone_id, s.o_tier, s.o_amount_cents, now(),
                    now() + make_interval(hours => v_hours), s.o_evidence)
            ON CONFLICT (enrollment_id, milestone_id, tier) DO NOTHING;
            v_new := v_new + 1;
        EXCEPTION WHEN check_violation THEN
            RAISE WARNING 'public.bonus_evaluate_enrollment: award recusado pelo teto (inscricao %): %', e.id, SQLERRM;
        END;
    END LOOP;

    -- 3) fim da janela: depois da tolerancia de recibo a inscricao passa a ended (ainda pede saque final)
    IF e.status = 'active'
       AND now() >= e.ends_at + make_interval(days => (e.milestones_snapshot->'track'->'params'->>'receipt_grace_days')::integer) THEN
        UPDATE public.bonus_enrollments SET status = 'ended' WHERE id = e.id;
    END IF;

    RETURN jsonb_build_object('outcome', 'ok', 'new_awards', v_new, 'failed_rows', v_failed);
END;
$fn$;

-- A avaliacao normal respeita o interruptor. Quem ENCERRA uma inscricao (S4) chama o materializador
-- direto: o que ja foi conquistado nao se perde, mesmo com o programa desligado.
CREATE OR REPLACE FUNCTION public.bonus_evaluate_enrollment(p_enrollment_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = ''
AS $fn$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM public.bonus_program_settings st WHERE st.enabled) THEN
        RETURN jsonb_build_object('outcome', 'program_disabled');
    END IF;
    RETURN public.bonus_materialize_enrollment(p_enrollment_id);
END;
$fn$;

-- 3.3b Award com turno em conferencia sai do pedido aberto (pedido zerado e cancelado).
CREATE OR REPLACE FUNCTION public.bonus_pull_open_from_payout(p_enrollment_id uuid)
RETURNS void
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = ''
AS $fn$
DECLARE
    a record;
BEGIN
    FOR a IN SELECT * FROM public.bonus_awards w
              WHERE w.enrollment_id = p_enrollment_id AND w.state = 'in_payout'
                AND public.bonus_award_review_due(w.evidence) IS NOT NULL
              ORDER BY w.id FOR UPDATE
    LOOP
        UPDATE public.bonus_payouts p
           SET amount_cents = p.amount_cents - a.amount_cents,
               status = CASE WHEN p.amount_cents - a.amount_cents <= 0 THEN 'cancelled' ELSE p.status END
         WHERE p.id = a.payout_id AND p.status = 'requested';
        UPDATE public.bonus_awards SET state = 'earned', payout_id = NULL WHERE id = a.id;
    END LOOP;
END;
$fn$;

-- 3.3c Estorno (carimbado pelo gancho): dentro da janela sinaliza a linha, qualquer que seja a
--      revisao (none -> open; open ganha o motivo; approved reabre, porque o dono nao tinha visto).
--      Depois da janela nao regride award (C4): so alerta o admin, uma vez por turno.
CREATE OR REPLACE FUNCTION public.bonus_apply_voids(p_enrollment_id uuid)
RETURNS void
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = ''
AS $fn$
DECLARE
    e       record;
    r       record;
    v_val_h integer;
    v_rev_h integer;
BEGIN
    SELECT * INTO e FROM public.bonus_enrollments WHERE id = p_enrollment_id;
    IF NOT FOUND OR e.accepted_at IS NULL THEN
        RETURN;
    END IF;
    v_val_h := (e.milestones_snapshot->'track'->'params'->>'validation_hours')::integer;
    v_rev_h := (e.milestones_snapshot->'track'->'params'->>'review_hours')::integer;

    FOR r IN
        SELECT DISTINCT ON (l.id) l.id, l.review, l.flags, l.counted, l.completed_at, sv.stamped_at AS voided_at
          FROM public.bonus_shift_ledger l
          JOIN public.shift_payments sp ON sp.job_id = l.job_id AND sp.worker_id = l.worker_id AND sp.status = 'voided'
          JOIN public.bonus_server_stamps sv ON sv.subject_id = sp.id AND sv.kind = 'receipt_voided'
         WHERE l.enrollment_id = e.id AND l.counted AND sv.stamped_at >= l.completed_at
         ORDER BY l.id, sv.stamped_at
    LOOP
        IF r.voided_at < r.completed_at + make_interval(hours => v_val_h) THEN
            IF NOT ('voided_after' = ANY (r.flags)) THEN
                UPDATE public.bonus_shift_ledger x
                   SET flags         = array_append(x.flags, 'voided_after'),
                       review        = 'open',
                       flagged_at    = COALESCE(CASE WHEN x.review = 'open' THEN x.flagged_at END, now()),
                       review_due_at = COALESCE(CASE WHEN x.review = 'open' THEN x.review_due_at END,
                                                now() + make_interval(hours => v_rev_h))
                 WHERE x.id = r.id;
            END IF;
        ELSIF NOT EXISTS (SELECT 1 FROM public.bonus_admin_log g
                           WHERE g.action = 'alert_voided_late' AND g.target_id = r.id) THEN
            INSERT INTO public.bonus_admin_log (actor, action, target_id, detail)
            VALUES ('00000000-0000-0000-0000-000000000000', 'alert_voided_late', r.id,
                    jsonb_build_object('enrollment_id', e.id, 'voided_at', r.voided_at));
        END IF;
    END LOOP;
    PERFORM public.bonus_pull_open_from_payout(e.id);
END;
$fn$;

-- 3.4 A2/B3: revalida identidade e veto por PIX com os dados ATUAIS. Chamador trava a inscricao.
--     PIX coincidente em turno que sustenta marco: review -> open (shared_pix) e o award sai do
--     pedido. Coincidencia em marco sem turno (Elenco, chamado), operador sem identidade ou com PIX
--     de vetado: devolve o motivo (bloqueia o pedido e o pagamento). Alerta so para o admin.
CREATE OR REPLACE FUNCTION public.bonus_recheck_payability(p_enrollment_id uuid)
RETURNS text
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = ''
AS $fn$
DECLARE
    e       record;
    v_rev_h integer;
    v_block text;
BEGIN
    SELECT * INTO e FROM public.bonus_enrollments WHERE id = p_enrollment_id;
    IF NOT FOUND OR e.accepted_at IS NULL THEN
        RETURN NULL;
    END IF;
    v_rev_h := (e.milestones_snapshot->'track'->'params'->>'review_hours')::integer;
    PERFORM public.bonus_apply_voids(e.id);

    UPDATE public.bonus_shift_ledger l
       SET review = 'open', flags = array_append(array_remove(l.flags, 'shared_pix'), 'shared_pix'),
           flagged_at = now(), review_due_at = now() + make_interval(hours => v_rev_h)
     WHERE l.enrollment_id = e.id AND l.counted
       AND (l.review = 'none' OR (l.review = 'approved' AND NOT ('shared_pix' = ANY (l.flags))
                                  AND public.bonus_worker_exclusion(e.id, l.worker_id) IS DISTINCT FROM l.approved_exclusion))
       AND l.id::text IN (SELECT jsonb_array_elements_text(w.evidence->'ledger_ids')
                            FROM public.bonus_awards w
                           WHERE w.enrollment_id = e.id AND w.state IN ('earned', 'in_payout'))
       AND public.bonus_worker_exclusion(e.id, l.worker_id) IS NOT NULL;

    PERFORM public.bonus_pull_open_from_payout(e.id);

    IF NOT public.bonus_identity_ok(e.company_id, e.operator_user_id) THEN
        v_block := 'identity';
    ELSIF e.pix_key_normalized IS NOT NULL AND EXISTS (
              SELECT 1 FROM public.bonus_vetos v JOIN public.workers w ON w.id = v.person_id
               WHERE public.bonus_normalize_pix(w.pix_key) = e.pix_key_normalized) THEN
        v_block := 'pix_match';
    ELSIF EXISTS (
              -- turno aprovado que sustenta marco a pagar, hoje coincidente e que nao pode reabrir:
              -- bloqueia, salvo se o dono aprovou JA vendo esse mesmo motivo
              SELECT 1 FROM public.bonus_shift_ledger l
               WHERE l.enrollment_id = e.id AND l.counted AND l.review = 'approved'
                 AND public.bonus_worker_exclusion(e.id, l.worker_id) IS NOT NULL
                 AND public.bonus_worker_exclusion(e.id, l.worker_id) IS DISTINCT FROM l.approved_exclusion
                 AND l.id::text IN (SELECT jsonb_array_elements_text(w.evidence->'ledger_ids')
                                      FROM public.bonus_awards w
                                     WHERE w.enrollment_id = e.id AND w.state IN ('earned', 'in_payout'))) THEN
        v_block := 'pix_match';
    ELSIF EXISTS (
              SELECT 1 FROM public.bonus_awards w,
                            jsonb_array_elements_text(w.evidence->'worker_ids') AS x(worker_id)
               WHERE w.enrollment_id = e.id AND w.state IN ('earned', 'in_payout')
                 AND public.bonus_worker_exclusion(e.id, x.worker_id::uuid) IS NOT NULL) THEN
        v_block := 'pix_match';
    END IF;

    IF v_block IS DISTINCT FROM e.payout_block_reason THEN
        UPDATE public.bonus_enrollments SET payout_block_reason = v_block WHERE id = e.id;
        -- ator zero = sistema
        INSERT INTO public.bonus_admin_log (actor, action, target_id, detail)
        VALUES ('00000000-0000-0000-0000-000000000000', 'alert_payability', e.id,
                jsonb_build_object('before', e.payout_block_reason, 'after', v_block));
    END IF;
    RETURN v_block;
END;
$fn$;

-- ============================================================================
-- 4. GRANTS e GANCHOS
-- ============================================================================
REVOKE ALL ON FUNCTION public.bonus_materialize_enrollment(uuid)              FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.bonus_materialize_enrollment(uuid)           TO service_role;
REVOKE ALL ON FUNCTION public.bonus_pull_open_from_payout(uuid)               FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.bonus_apply_voids(uuid)                         FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.bonus_apply_voids(uuid)                      TO service_role;
REVOKE ALL ON FUNCTION public.bonus_ledger_is_live(uuid, uuid, uuid)          FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.bonus_put_stamp(uuid, text, uuid, timestamptz)  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.bonus_recheck_payability(uuid)                  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.bonus_ledger_is_live(uuid, uuid, uuid)       TO service_role;
GRANT EXECUTE ON FUNCTION public.bonus_recheck_payability(uuid)               TO service_role;
REVOKE ALL ON FUNCTION public.bonus_stamp_application()     FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.bonus_stamp_shift_payment()   FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.bonus_stamp_team_connection() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.bonus_stamp_shift_call()      FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.bonus_stamp_application()     TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.bonus_stamp_shift_payment()   TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.bonus_stamp_team_connection() TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.bonus_stamp_shift_call()      TO authenticated, service_role;

-- Nenhum destes ganchos roda o motor: so registram, com lock_timeout curto (rodada 3).
DROP TRIGGER IF EXISTS trg_bonus_0_stamp_application ON public.applications;
CREATE TRIGGER trg_bonus_0_stamp_application
    AFTER INSERT OR UPDATE ON public.applications
    FOR EACH ROW EXECUTE FUNCTION public.bonus_stamp_application();
DROP TRIGGER IF EXISTS trg_bonus_0_stamp_payment ON public.shift_payments;
CREATE TRIGGER trg_bonus_0_stamp_payment
    AFTER INSERT OR UPDATE ON public.shift_payments
    FOR EACH ROW EXECUTE FUNCTION public.bonus_stamp_shift_payment();
DROP TRIGGER IF EXISTS trg_bonus_0_stamp_connection ON public.team_connections;
CREATE TRIGGER trg_bonus_0_stamp_connection
    AFTER INSERT OR UPDATE OF status ON public.team_connections
    FOR EACH ROW EXECUTE FUNCTION public.bonus_stamp_team_connection();
DROP TRIGGER IF EXISTS trg_bonus_0_stamp_call ON public.shift_calls;
CREATE TRIGGER trg_bonus_0_stamp_call
    AFTER INSERT OR UPDATE ON public.shift_calls
    FOR EACH ROW EXECUTE FUNCTION public.bonus_stamp_shift_call();

-- Helpers que aceitam uid/id de terceiro: so service_role (e outras funcoes DEFINER do schema).
REVOKE ALL ON FUNCTION public.bonus_normalize_pix(text)                  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.bonus_local_date(timestamptz)              FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.bonus_identity_ok(uuid, uuid)              FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.bonus_worker_exclusion(uuid, uuid)         FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.bonus_award_review_due(jsonb)              FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.bonus_record_application(uuid, uuid)       FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.bonus_compute_support(uuid)                FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.bonus_evaluate_enrollment(uuid)            FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.bonus_normalize_pix(text)                TO service_role;
GRANT EXECUTE ON FUNCTION public.bonus_local_date(timestamptz)            TO service_role;
GRANT EXECUTE ON FUNCTION public.bonus_identity_ok(uuid, uuid)            TO service_role;
GRANT EXECUTE ON FUNCTION public.bonus_worker_exclusion(uuid, uuid)       TO service_role;
GRANT EXECUTE ON FUNCTION public.bonus_award_review_due(jsonb)            TO service_role;
GRANT EXECUTE ON FUNCTION public.bonus_record_application(uuid, uuid)     TO service_role;
GRANT EXECUTE ON FUNCTION public.bonus_compute_support(uuid)              TO service_role;
GRANT EXECUTE ON FUNCTION public.bonus_evaluate_enrollment(uuid)          TO service_role;

-- Funcoes de trigger disparam na sessao do usuario (licao 20260816201420/201457: manter EXECUTE).
REVOKE ALL ON FUNCTION public.bonus_capture_job()         FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.bonus_capture_briefing()    FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION public.bonus_capture_job()      TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.bonus_capture_briefing() TO authenticated, service_role;


DROP TRIGGER IF EXISTS trg_bonus_capture_job ON public.jobs;
CREATE TRIGGER trg_bonus_capture_job
    AFTER INSERT ON public.jobs
    FOR EACH ROW EXECUTE FUNCTION public.bonus_capture_job();

DROP TRIGGER IF EXISTS trg_bonus_capture_briefing ON public.companies;
CREATE TRIGGER trg_bonus_capture_briefing
    AFTER UPDATE OF default_briefing ON public.companies
    FOR EACH ROW
    WHEN (NEW.default_briefing IS DISTINCT FROM OLD.default_briefing)
    EXECUTE FUNCTION public.bonus_capture_briefing();


COMMENT ON FUNCTION public.bonus_identity_ok(uuid, uuid) IS
    'INTERNA. C2: a pessoa e membro ativo e confirmado da empresa, nao e o dono, nao e de organizacao e nao esta vetada. Aceita uid de terceiro: so service_role/funcoes DEFINER.';
COMMENT ON FUNCTION public.bonus_record_application(uuid, uuid) IS
    'INTERNA. Grava o livro de turnos UMA vez (C3). Chamador trava a inscricao. Silenciosa nas exclusoes (AF1-AF3).';
COMMENT ON FUNCTION public.bonus_evaluate_enrollment(uuid) IS
    'INTERNA. Idempotente. Livro + awards. Rodada ao abrir a tela, pedir saque, gerar a fila do admin e no recibo validado (sem cron, C4).';

-- ============================================================================
-- 5. VERIFICACAO FINAL
-- ============================================================================
DO $mig$
DECLARE
    r   record;
    v_n integer;
BEGIN
    -- 5.1 helpers internos sem EXECUTE para anon/authenticated
    FOR r IN SELECT p.oid, p.proname FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
              WHERE n.nspname = 'public'
                AND p.proname IN ('bonus_normalize_pix', 'bonus_local_date', 'bonus_identity_ok',
                                  'bonus_worker_exclusion', 'bonus_award_review_due', 'bonus_record_application',
                                  'bonus_compute_support', 'bonus_evaluate_enrollment')
    LOOP
        IF has_function_privilege('anon', r.oid, 'EXECUTE') OR has_function_privilege('authenticated', r.oid, 'EXECUTE') THEN
            RAISE EXCEPTION 'VERIFICACAO S2: % acessivel a anon/authenticated. HALT.', r.proname;
        END IF;
    END LOOP;

    -- 5.2 todas as funcoes da trilha: DEFINER onde pede, search_path vazio
    SELECT count(*) INTO v_n FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname = 'public' AND p.proname ~ '^(admin_)?bonus_'
       AND p.prosecdef AND NOT (COALESCE(p.proconfig, '{}'::text[]) @> ARRAY['search_path=""']);
    IF v_n <> 0 THEN
        RAISE EXCEPTION 'VERIFICACAO S2: % funcao(oes) DEFINER da trilha sem search_path vazio. HALT.', v_n;
    END IF;

    -- 5.3 Article 8: nenhuma funcao da trilha cita objeto de saldo (limite de palavra: nome de objeto
    --     inteiro, nunca fragmento) nem ancora empresa em auth.uid() na mao
    FOR r IN SELECT p.proname, pg_get_functiondef(p.oid) AS def
               FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
              WHERE n.nspname = 'public' AND p.proname ~ '^(admin_)?bonus_'
    LOOP
        IF r.def ~ '[[:<:]](wallets|escrow_transactions|wallet_transactions|update_wallet_balance|reserve_escrow|release_escrow|refund_escrow|credit_deposit)[[:>:]]' THEN
            RAISE EXCEPTION 'VERIFICACAO S2: % referencia objeto de saldo (Article 8). HALT.', r.proname;
        END IF;
        IF r.def ~* '(company_id|owner_id)[[:space:]]*=[[:space:]]*[(]?[[:space:]]*(select[[:space:]]+)?auth[.]uid[(][)]' THEN
            RAISE EXCEPTION 'VERIFICACAO S2: % ancora empresa em auth.uid() na mao. HALT.', r.proname;
        END IF;
    END LOOP;

    -- 5.4 os tres ganchos existem e o programa segue desligado
    SELECT count(*) INTO v_n FROM pg_trigger tg
     WHERE tg.tgname IN ('trg_bonus_capture_job', 'trg_bonus_capture_briefing',
                         'trg_bonus_0_stamp_application', 'trg_bonus_0_stamp_payment',
                         'trg_bonus_0_stamp_connection', 'trg_bonus_0_stamp_call')
       AND NOT tg.tgisinternal;
    IF v_n <> 6 THEN
        RAISE EXCEPTION 'VERIFICACAO S2: esperados 6 ganchos, ha %. HALT.', v_n;
    END IF;
    -- nenhum gancho roda o motor e todos limitam a espera por trava
    FOR r IN SELECT p.proname, pg_get_functiondef(p.oid) AS def, p.proconfig
               FROM pg_trigger tg JOIN pg_proc p ON p.oid = tg.tgfoid
              WHERE tg.tgname ~ '^trg_bonus_(0_|capture_)' AND NOT tg.tgisinternal
    LOOP
        IF r.def ~ '[[:<:]](bonus_evaluate_enrollment|bonus_record_application|bonus_compute_support|bonus_recheck_payability)[[:>:]]'
           OR NOT (COALESCE(r.proconfig, '{}'::text[]) @> ARRAY['lock_timeout=2s']) THEN
            RAISE EXCEPTION 'VERIFICACAO S2: gancho % roda o motor ou esta sem lock_timeout. HALT.', r.proname;
        END IF;
    END LOOP;
    IF EXISTS (SELECT 1 FROM public.bonus_program_settings WHERE enabled) THEN
        RAISE EXCEPTION 'VERIFICACAO S2: programa ligado (C9). HALT.';
    END IF;
END
$mig$;
