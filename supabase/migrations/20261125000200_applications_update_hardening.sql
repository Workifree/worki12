-- Migration: maquina de estados de public.applications para UPDATE feito direto por cliente
-- File: supabase/migrations/20261125000200_applications_update_hardening.sql
--
-- FALHA (pre-existente, em producao): validate_application_update so proibe alguns campos por papel.
--   (1) o freela insere 'pending', faz PATCH para 'invited' + invited_by_company_at e depois 'hired'
--       (autocontratacao); tambem vai de 'pending' direto a 'in_progress';
--   (2) a empresa leva 'invited' a 'hired' sem o aceite do freela;
--   (3) a empresa carimba company_*_confirmed_at em qualquer status.
--
-- ABORDAGEM: SEGUNDO trigger BEFORE UPDATE (lista de PERMITIDOS, fail-closed). Nao edita
-- validate_application_update (continua valendo; roda antes por ordem alfabetica: trg_v < trg_zz).
-- Mesma distincao do hardening de INSERT (20261125000100): trigger SECURITY INVOKER + current_user.
-- RPC SECURITY DEFINER (claim_shift_slot, cancel_job, anonymize_account), service_role
-- (delete-account, expire-invites) e SQL manual passam direto. NUNCA tornar a funcao DEFINER.
-- Independe de 20261125000100 (pode ser aplicada antes ou depois), mas sozinha NAO fecha o INSERT.
--
-- REGRAS PARA CLIENTE
--   Colunas que podem mudar: status, os 4 carimbos, invitation_response, invitation_responded_at.
--   Todo o resto (inclusive invited_by_company_at, invitation_expires_at, created_at, cover_letter,
--   message e colunas FUTURAS) e imutavel.
--
--   Ator = freela (worker_id = auth.uid(); tem precedencia se tambem operar a empresa)
--     invited -> hired      (exige invited_by_company_at, resposta 'accepted' + data, prazo vigente)
--     invited -> declined   (exige resposta 'declined' + data)
--     hired -> in_progress  (so carimbando worker_checkin_at na mesma escrita)
--     pending|reviewing|interview|hired|in_progress -> cancelled
--   Ator = empresa (is_job_owner)
--     pull (invited_by_company_at NULL): pending|reviewing|interview|applied|accepted|approved
--                           -> reviewing|interview|approved|rejected|hired|cancelled
--     invited|hired|in_progress -> cancelled
--     hired -> in_progress  (carimbando company_checkin_confirmed_at na mesma escrita, ou com a
--                           chegada ja confirmada antes)
--     in_progress -> completed (as DUAS confirmacoes da empresa ja gravadas ANTES desta escrita)
--   Qualquer ator: status igual (no-op) e permitido. Terminais: completed, rejected, cancelled,
--   declined.
--
--   Carimbos: so NULL -> valor (cliente nao apaga nem reescreve).
--     worker_checkin_at              freela;  hired|in_progress -> in_progress
--     worker_checkout_at             freela;  in_progress -> in_progress, com alguma chegada previa
--     company_checkin_confirmed_at   empresa; hired|in_progress -> in_progress
--     company_checkout_confirmed_at  empresa; in_progress -> in_progress, com chegada ja confirmada
--   HORARIOS: carimbo do freela e SOBRESCRITO com now() (o valor enviado e ignorado). Carimbo da
--   empresa aceita horario retroativo, mas recusa futuro alem de 15 minutos (relogio do aparelho).
--   CHEGADA (qualquer ator): so a partir de 12 h antes do inicio (data local America/Sao_Paulo +
--   work_start_time; sem horario valido = 00:00). Sem limite superior (turno que vira a noite e
--   confirmacao tardia). Turno sem start_date: sem restricao de data.
--   TURNO 'deleted' (ou invisivel): aceite de convite e chegada sao recusados.
--   invitation_*: so mudam no aceite/recusa pelo freela.
--
-- ACEITO NO MODO A (decisao, nao falha): a empresa conclui sozinha hired -> in_progress ->
-- completed pelo registro manual de presenca, sem nenhum gesto do freela.
--
-- FORA DO ESCOPO (residual conhecido): horario retroativo da empresa nao tem limite inferior;
-- lotacao do turno no aceite direto; correcao de linhas ja forjadas.
-- Article 8: nao toca saldo. Nenhuma linha existente e alterada.
--
-- DOWN (rollback; reabre a falha):
--   DROP TRIGGER IF EXISTS trg_zz_applications_update_guard ON public.applications;
--   DROP FUNCTION IF EXISTS public.applications_update_guard();

BEGIN;

-- 0. Pre-condicoes
DO $$
DECLARE
    v_n   integer;
    v_bad text;
BEGIN
    SELECT count(*) INTO v_n
      FROM pg_catalog.pg_attribute
     WHERE attrelid = 'public.applications'::regclass
       AND NOT attisdropped
       AND attname IN ('id', 'job_id', 'worker_id', 'status',
                       'worker_checkin_at', 'worker_checkout_at',
                       'company_checkin_confirmed_at', 'company_checkout_confirmed_at',
                       'invited_by_company_at', 'invitation_expires_at',
                       'invitation_response', 'invitation_responded_at');
    IF v_n <> 12 THEN
        RAISE EXCEPTION 'ASSERCAO: esperava 12 colunas em public.applications, achei %. HALT.', v_n;
    END IF;

    -- O validador vigente precisa existir, ligado, e rodar ANTES deste guard (ordem alfabetica).
    IF NOT EXISTS (
        SELECT 1 FROM pg_catalog.pg_trigger t
         WHERE t.tgrelid = 'public.applications'::regclass
           AND t.tgname = 'trg_validate_application_update'
           AND t.tgfoid = 'public.validate_application_update()'::regprocedure
           AND t.tgenabled = 'O'
    ) THEN
        RAISE EXCEPTION 'ASSERCAO: trg_validate_application_update ausente ou desligado. HALT.';
    END IF;

    IF NOT pg_catalog.has_function_privilege('authenticated', 'public.is_job_owner(uuid)', 'EXECUTE') THEN
        RAISE EXCEPTION 'ASSERCAO: authenticated sem EXECUTE em is_job_owner. HALT.';
    END IF;

    -- Coluna gerada ou trigger BEFORE desconhecido (inclusive um que rode DEPOIS do guard, por ordem
    -- alfabetica) poderia reescrever a linha ja validada. Revisar o guard antes de seguir.
    SELECT string_agg(a.attname::text, ', ') INTO v_bad
      FROM pg_catalog.pg_attribute a
     WHERE a.attrelid = 'public.applications'::regclass AND NOT a.attisdropped AND a.attgenerated <> '';
    IF v_bad IS NOT NULL THEN
        RAISE EXCEPTION 'ASSERCAO: coluna gerada em applications: %. HALT.', v_bad;
    END IF;

    -- tgtype & 2 = BEFORE
    SELECT string_agg(t.tgname::text, ', ') INTO v_bad
      FROM pg_catalog.pg_trigger t
     WHERE t.tgrelid = 'public.applications'::regclass
       AND NOT t.tgisinternal
       AND (t.tgtype & 2) = 2
       AND t.tgname NOT IN ('trg_validate_application_update',
                            'trg_zz_applications_insert_guard',
                            'trg_zz_applications_update_guard');
    IF v_bad IS NOT NULL THEN
        RAISE EXCEPTION 'ASSERCAO: trigger BEFORE desconhecido em applications: %. HALT.', v_bad;
    END IF;

    -- Toda funcao que atualiza applications tem de ser DEFINER com dono privilegiado; senao o
    -- guard a trataria como cliente. Comentarios de linha sao descartados.
    SELECT string_agg(p.oid::regprocedure::text, ', ') INTO v_bad
      FROM pg_catalog.pg_proc p
      JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname NOT IN ('pg_catalog', 'information_schema')
       AND n.nspname NOT LIKE 'pg\_temp%'
       AND regexp_replace(p.prosrc, '--[^\r\n]*', '', 'g')
           ~* '\mupdate\s+(only\s+)?("?public"?\.)?"?applications\M'
       AND (NOT p.prosecdef
            OR pg_catalog.pg_get_userbyid(p.proowner) NOT IN ('postgres', 'service_role', 'supabase_admin'));
    IF v_bad IS NOT NULL THEN
        RAISE EXCEPTION 'ASSERCAO: funcao(oes) atualizam applications sem ser DEFINER privilegiada: %. HALT.', v_bad;
    END IF;
END $$;

-- 1. Guard
CREATE OR REPLACE FUNCTION public.applications_update_guard()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
DECLARE
    c_mutaveis constant text[] := ARRAY[
        'status', 'worker_checkin_at', 'worker_checkout_at',
        'company_checkin_confirmed_at', 'company_checkout_confirmed_at',
        'invitation_response', 'invitation_responded_at'];
    v_uid       uuid;
    v_actor     text;
    v_old       text;
    v_new       text;
    v_wi        boolean;  -- worker_checkin_at mudou
    v_wo        boolean;
    v_ci        boolean;
    v_co        boolean;
    v_resp      boolean;  -- invitation_* mudou
    v_answering boolean;  -- aceite/recusa de convite
    v_job_status text;
    v_job_start  timestamptz;
    v_job_time   text;
BEGIN
    -- Servidor: RPC SECURITY DEFINER (dono), service_role, cron/manutencao.
    IF current_user IN ('postgres', 'service_role', 'supabase_admin') THEN
        RETURN NEW;
    END IF;

    v_uid := (SELECT auth.uid());
    IF v_uid IS NULL THEN
        RAISE EXCEPTION 'applications_update_guard: sessao sem usuario.' USING ERRCODE = '42501';
    END IF;

    IF (to_jsonb(NEW) - c_mutaveis) IS DISTINCT FROM (to_jsonb(OLD) - c_mutaveis) THEN
        RAISE EXCEPTION 'applications_update_guard: coluna nao editavel foi alterada.'
            USING ERRCODE = '42501';
    END IF;

    IF OLD.worker_id = v_uid THEN
        v_actor := 'worker';
    ELSIF public.is_job_owner(OLD.job_id) THEN
        v_actor := 'company';
    ELSE
        RAISE EXCEPTION 'applications_update_guard: usuario nao autorizado.' USING ERRCODE = '42501';
    END IF;

    v_old  := COALESCE(OLD.status, '');
    v_new  := COALESCE(NEW.status, '');
    v_wi   := NEW.worker_checkin_at             IS DISTINCT FROM OLD.worker_checkin_at;
    v_wo   := NEW.worker_checkout_at            IS DISTINCT FROM OLD.worker_checkout_at;
    v_ci   := NEW.company_checkin_confirmed_at  IS DISTINCT FROM OLD.company_checkin_confirmed_at;
    v_co   := NEW.company_checkout_confirmed_at IS DISTINCT FROM OLD.company_checkout_confirmed_at;
    v_resp := NEW.invitation_response           IS DISTINCT FROM OLD.invitation_response
           OR NEW.invitation_responded_at       IS DISTINCT FROM OLD.invitation_responded_at;
    v_answering := v_actor = 'worker' AND v_old = 'invited' AND v_new IN ('hired', 'declined');

    -- Transicao de status
    IF NEW.status IS DISTINCT FROM OLD.status THEN
        IF v_actor = 'worker' THEN
            IF NOT COALESCE(
                   (v_old = 'invited' AND v_new = 'hired' AND OLD.invited_by_company_at IS NOT NULL)
                OR (v_old = 'invited' AND v_new = 'declined')
                OR (v_old = 'hired' AND v_new = 'in_progress' AND v_wi)
                OR (v_old IN ('pending', 'reviewing', 'interview', 'hired', 'in_progress')
                    AND v_new = 'cancelled'),
                   false)
            THEN
                RAISE EXCEPTION 'applications_update_guard: o freela nao pode mudar o status de "%" para "%".', v_old, v_new
                    USING ERRCODE = '42501';
            END IF;
        ELSE
            IF NOT COALESCE(
                   (v_old IN ('pending', 'reviewing', 'interview', 'applied', 'accepted', 'approved')
                    AND OLD.invited_by_company_at IS NULL
                    AND v_new IN ('reviewing', 'interview', 'approved', 'rejected', 'hired', 'cancelled'))
                OR (v_old IN ('invited', 'hired', 'in_progress') AND v_new = 'cancelled')
                OR (v_old = 'hired' AND v_new = 'in_progress'
                    AND (v_ci OR OLD.company_checkin_confirmed_at IS NOT NULL))
                OR (v_old = 'in_progress' AND v_new = 'completed'
                    AND OLD.company_checkin_confirmed_at IS NOT NULL
                    AND OLD.company_checkout_confirmed_at IS NOT NULL),
                   false)
            THEN
                RAISE EXCEPTION 'applications_update_guard: a empresa nao pode mudar o status de "%" para "%".', v_old, v_new
                    USING ERRCODE = '42501';
            END IF;
        END IF;
    END IF;

    -- Resposta do convite
    IF v_answering THEN
        IF NEW.invitation_response IS DISTINCT FROM
               (CASE WHEN v_new = 'hired' THEN 'accepted' ELSE 'declined' END)
           OR NEW.invitation_responded_at IS NULL
        THEN
            RAISE EXCEPTION 'applications_update_guard: resposta do convite incompleta ou incoerente.'
                USING ERRCODE = '42501';
        END IF;
        IF v_new = 'hired' AND OLD.invitation_expires_at < now() THEN
            RAISE EXCEPTION 'applications_update_guard: convite expirado.' USING ERRCODE = '42501';
        END IF;
    ELSIF v_resp THEN
        RAISE EXCEPTION 'applications_update_guard: resposta do convite so muda no aceite ou recusa pelo freela.'
            USING ERRCODE = '42501';
    END IF;

    -- Carimbos: write-once
    IF (v_wi AND (OLD.worker_checkin_at IS NOT NULL OR NEW.worker_checkin_at IS NULL))
       OR (v_wo AND (OLD.worker_checkout_at IS NOT NULL OR NEW.worker_checkout_at IS NULL))
       OR (v_ci AND (OLD.company_checkin_confirmed_at IS NOT NULL OR NEW.company_checkin_confirmed_at IS NULL))
       OR (v_co AND (OLD.company_checkout_confirmed_at IS NOT NULL OR NEW.company_checkout_confirmed_at IS NULL))
    THEN
        RAISE EXCEPTION 'applications_update_guard: registro de presenca ja gravado nao pode ser alterado.'
            USING ERRCODE = '42501';
    END IF;

    -- Carimbos: quem
    IF ((v_wi OR v_wo) AND v_actor <> 'worker') OR ((v_ci OR v_co) AND v_actor <> 'company') THEN
        RAISE EXCEPTION 'applications_update_guard: registro de presenca de outro papel.'
            USING ERRCODE = '42501';
    END IF;

    -- Carimbos: em que status
    IF (v_wi OR v_ci)
       AND NOT COALESCE(v_old IN ('hired', 'in_progress') AND v_new = 'in_progress', false)
    THEN
        RAISE EXCEPTION 'applications_update_guard: chegada nao permitida neste status.'
            USING ERRCODE = '42501';
    END IF;

    IF v_wo AND NOT COALESCE(
           v_old = 'in_progress' AND v_new = 'in_progress'
           AND (OLD.worker_checkin_at IS NOT NULL OR OLD.company_checkin_confirmed_at IS NOT NULL),
           false)
    THEN
        RAISE EXCEPTION 'applications_update_guard: saida do freela nao permitida neste status.'
            USING ERRCODE = '42501';
    END IF;

    IF v_co AND NOT COALESCE(
           v_old = 'in_progress' AND v_new = 'in_progress'
           AND OLD.company_checkin_confirmed_at IS NOT NULL,
           false)
    THEN
        RAISE EXCEPTION 'applications_update_guard: confirmacao de saida nao permitida neste status.'
            USING ERRCODE = '42501';
    END IF;

    -- Turno: aceite e chegada exigem turno vivo; chegada exige que a data tenha chegado.
    IF v_wi OR v_ci OR (v_answering AND v_new = 'hired') THEN
        SELECT j.status, j.start_date, j.work_start_time
          INTO v_job_status, v_job_start, v_job_time
          FROM public.jobs j WHERE j.id = OLD.job_id;
        IF NOT FOUND OR v_job_status = 'deleted' THEN
            RAISE EXCEPTION 'applications_update_guard: este turno foi cancelado.' USING ERRCODE = '42501';
        END IF;

        IF (v_wi OR v_ci) AND v_job_start IS NOT NULL
           AND now() < (((v_job_start AT TIME ZONE 'America/Sao_Paulo')::date
                         + CASE WHEN v_job_time ~ '^([01][0-9]|2[0-3]):[0-5][0-9]'
                                THEN left(v_job_time, 5)::time
                                ELSE time '00:00' END)
                        AT TIME ZONE 'America/Sao_Paulo') - interval '12 hours'
        THEN
            RAISE EXCEPTION 'applications_update_guard: ainda nao e possivel registrar a chegada neste turno.'
                USING ERRCODE = '42501';
        END IF;
    END IF;

    -- Empresa: retroativo permitido, futuro nao.
    IF (v_ci AND NEW.company_checkin_confirmed_at > now() + interval '15 minutes')
       OR (v_co AND NEW.company_checkout_confirmed_at > now() + interval '15 minutes')
    THEN
        RAISE EXCEPTION 'applications_update_guard: horario de presenca no futuro.' USING ERRCODE = '42501';
    END IF;

    -- Freela: a hora e a do servidor.
    IF v_wi THEN
        NEW.worker_checkin_at := now();
    END IF;
    IF v_wo THEN
        NEW.worker_checkout_at := now();
    END IF;

    RETURN NEW;
END;
$$;

COMMENT ON FUNCTION public.applications_update_guard() IS
    'BEFORE UPDATE em applications: maquina de estados por ator para cliente direto (current_user fora '
    'de postgres/service_role/supabase_admin). RPC DEFINER e service_role passam. TEM de ser SECURITY '
    'INVOKER: como DEFINER o guard fica inerte. Fluxo novo no frontend exige atualizar esta lista.';

DROP TRIGGER IF EXISTS trg_zz_applications_update_guard ON public.applications;
CREATE TRIGGER trg_zz_applications_update_guard
    BEFORE UPDATE ON public.applications
    FOR EACH ROW EXECUTE FUNCTION public.applications_update_guard();

-- 2. Verificacao
DO $$
DECLARE
    v_def text;
    v_col text;
BEGIN
    -- tgtype: 1=ROW, 2=BEFORE, 16=UPDATE
    IF NOT EXISTS (
        SELECT 1 FROM pg_catalog.pg_trigger t
         WHERE t.tgrelid = 'public.applications'::regclass
           AND t.tgname = 'trg_zz_applications_update_guard'
           AND t.tgfoid = 'public.applications_update_guard()'::regprocedure
           AND t.tgtype = 19
           AND t.tgenabled = 'O'
           AND t.tgqual IS NULL
           AND cardinality(t.tgattr::int2[]) = 0
    ) THEN
        RAISE EXCEPTION 'VERIFICACAO: trigger BEFORE UPDATE ausente ou divergente. HALT.';
    END IF;

    IF (SELECT p.prosecdef FROM pg_catalog.pg_proc p
         WHERE p.oid = 'public.applications_update_guard()'::regprocedure) THEN
        RAISE EXCEPTION 'VERIFICACAO: applications_update_guard nao pode ser SECURITY DEFINER. HALT.';
    END IF;

    SELECT regexp_replace(p.prosrc, '--[^\r\n]*', '', 'g') INTO v_def
      FROM pg_catalog.pg_proc p
     WHERE p.oid = 'public.applications_update_guard()'::regprocedure;

    FOREACH v_col IN ARRAY ARRAY['worker_checkin_at', 'worker_checkout_at',
                                 'company_checkin_confirmed_at', 'company_checkout_confirmed_at',
                                 'invitation_response', 'invitation_responded_at']
    LOOP
        IF v_def !~ ('\mNEW\.' || v_col || '\M\s+IS\s+DISTINCT\s+FROM\s+OLD\.' || v_col || '\M') THEN
            RAISE EXCEPTION 'VERIFICACAO: guard nao compara a coluna %. HALT.', v_col;
        END IF;
    END LOOP;

    IF v_def !~ '\mcurrent_user\M' OR v_def ~ '\m(session_user|set_config|current_setting)\M' THEN
        RAISE EXCEPTION 'VERIFICACAO: sinal de distincao do guard divergente. HALT.';
    END IF;
    IF v_def !~ '\mis_job_owner\M\s*\(\s*OLD\.job_id\M' THEN
        RAISE EXCEPTION 'VERIFICACAO: autorizacao da empresa fora do seam is_job_owner. HALT.';
    END IF;
END $$;

COMMIT;
