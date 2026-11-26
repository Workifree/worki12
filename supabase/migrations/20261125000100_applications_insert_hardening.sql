-- Migration: fecha a forja de presenca por INSERT direto em public.applications
-- File: supabase/migrations/20261125000100_applications_insert_hardening.sql
--
-- FALHA (pre-existente, em producao): nenhuma policy de INSERT restringe os carimbos de presenca e
-- validate_application_update e so BEFORE UPDATE.
--   (1) "applications_insert_company_invite" (20260818100200): o operador insere 'invited' ja com os
--       carimbos e depois leva a 'hired' por PATCH.
--   (2) "Workers can insert applications" (20260622000400): o freela insere 'hired'/'completed' com os
--       quatro carimbos, inclusive os da empresa ('completed' ainda dispara os agregados de XP,
--       trg_worker_completion_aggregates e AFTER INSERT).
--
-- REGRA para INSERT feito direto por cliente (PostgREST):
--   * lista de PERMITIDOS: so id, job_id, worker_id, status, cover_letter, message, created_at,
--     invited_by_company_at e invitation_expires_at podem vir preenchidos (carimbos, resposta de
--     convite e colunas FUTURAS tem de ser NULL);
--   * created_at e invited_by_company_at sao IMPOSTOS pelo servidor (now());
--   * status 'pending' (pull): invited_by_company_at NULL e worker_id = auth.uid();
--     status 'invited' (push): invited_by_company_at preenchido, worker_id <> auth.uid() e
--     is_job_owner(job_id). Defesa em profundidade sobre as policies (que seguem valendo, inclusive
--     o vinculo de Elenco do convite).
--   RECUSA (42501) em vez de zerar em silencio: nenhum cliente legitimo manda esses campos
--   (em 25/11/2026 o frontend e as edge functions nao tem NENHUM insert em applications).
--
-- COMO SE DISTINGUE o cliente: `current_user` lido por trigger SECURITY INVOKER.
--   * INSERT via PostgREST roda como 'authenticated'/'anon' (inclusive atraves de view ou de RPC
--     SECURITY INVOKER: ambas continuam tratadas como cliente);
--   * dentro de RPC SECURITY DEFINER (claim_shift_slot) current_user e o dono (postgres);
--     edge function com service key roda como 'service_role'; cron/SQL manual como postgres.
--   Nao e forjavel: o papel vem do JWT assinado e o cliente nao executa SET ROLE / SQL livre.
--   Nao usa GUC (nada a editar em claim_shift_slot, nenhum sinal por string).
--   session_user nao serve ('authenticator' mesmo dentro de DEFINER) e auth.uid() tambem nao
--   (continua sendo o do freela dentro de claim_shift_slot).
--   Isto nao contradiz ADR-20261123-troca-de-responsavel-so-pela-rpc, que rejeitou current_user para
--   identificar UMA RPC entre varias DEFINER; aqui a pergunta e apenas "cliente direto ou servidor?".
--   Lista de PERMITIDOS (fail-closed): papel novo/desconhecido e tratado como cliente.
--   A funcao NUNCA pode virar SECURITY DEFINER (current_user seria sempre postgres = guard inerte);
--   a verificacao abaixo trava isso.
--
-- Nome com prefixo trg_zz_: BEFORE triggers disparam em ordem alfabetica; este ve a linha final.
-- Article 8: nao toca saldo. Nenhuma linha existente e alterada (forjas passadas nao sao corrigidas:
-- ver consulta de auditoria no teste supabase/tests/applications_insert_hardening.sql).
--
-- DOWN (rollback; reabre a falha):
--   DROP TRIGGER IF EXISTS trg_zz_applications_insert_guard ON public.applications;
--   DROP FUNCTION IF EXISTS public.applications_insert_guard();
--   (a policy legada "Workers can create applications" NAO e recriada: nao existia em producao em
--   25/11/2026.)

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
       AND attname IN ('worker_checkin_at', 'worker_checkout_at',
                       'company_checkin_confirmed_at', 'company_checkout_confirmed_at',
                       'status', 'invited_by_company_at',
                       'invitation_response', 'invitation_responded_at');
    IF v_n <> 8 THEN
        RAISE EXCEPTION 'ASSERCAO: esperava 8 colunas em public.applications, achei %. HALT.', v_n;
    END IF;

    -- Toda funcao que insere em applications tem de ser DEFINER com dono privilegiado; senao o
    -- guard a trataria como cliente e a quebraria. Comentarios de linha sao descartados.
    SELECT string_agg(p.oid::regprocedure::text, ', ') INTO v_bad
      FROM pg_catalog.pg_proc p
      JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname NOT IN ('pg_catalog', 'information_schema')
       AND n.nspname NOT LIKE 'pg\_temp%'
       AND regexp_replace(p.prosrc, '--[^\r\n]*', '', 'g')
           ~* '\minsert\s+into\s+("?public"?\.)?"?applications\M'
       AND (NOT p.prosecdef
            OR pg_catalog.pg_get_userbyid(p.proowner) NOT IN ('postgres', 'service_role', 'supabase_admin'));
    IF v_bad IS NOT NULL THEN
        RAISE EXCEPTION 'ASSERCAO: funcao(oes) inserem em applications sem ser DEFINER privilegiada: %. HALT.', v_bad;
    END IF;
END $$;

-- 0b. Policies e forma da tabela
DROP POLICY IF EXISTS "Workers can create applications" ON public.applications;

DO $$
DECLARE
    v_bad text;
BEGIN
    -- polcmd: a=INSERT, *=ALL, d=DELETE
    SELECT string_agg(p.polname::text, ', ') INTO v_bad
      FROM pg_catalog.pg_policy p
     WHERE p.polrelid = 'public.applications'::regclass
       AND (p.polcmd = 'd'
            OR (p.polcmd IN ('a', '*')
                AND p.polname NOT IN ('Workers can insert applications',
                                      'applications_insert_company_invite')));
    IF v_bad IS NOT NULL THEN
        RAISE EXCEPTION 'ASSERCAO: policy inesperada de INSERT/ALL/DELETE em applications: %. HALT.', v_bad;
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

END $$;

-- 1. Guard
CREATE OR REPLACE FUNCTION public.applications_insert_guard()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
DECLARE
    c_permitidas constant text[] := ARRAY[
        'id', 'job_id', 'worker_id', 'status', 'cover_letter', 'message', 'created_at',
        'invited_by_company_at', 'invitation_expires_at'];
    v_uid uuid;
BEGIN
    -- Servidor: RPC SECURITY DEFINER (dono), service_role, cron/manutencao.
    IF current_user IN ('postgres', 'service_role', 'supabase_admin') THEN
        RETURN NEW;
    END IF;

    IF NEW.worker_checkin_at IS NOT NULL
       OR NEW.worker_checkout_at IS NOT NULL
       OR NEW.company_checkin_confirmed_at IS NOT NULL
       OR NEW.company_checkout_confirmed_at IS NOT NULL
    THEN
        RAISE EXCEPTION 'applications_insert_guard: candidatura nao pode nascer com registro de presenca.'
            USING ERRCODE = '42501';
    END IF;

    IF NEW.invitation_response IS NOT NULL OR NEW.invitation_responded_at IS NOT NULL THEN
        RAISE EXCEPTION 'applications_insert_guard: candidatura nao pode nascer com convite respondido.'
            USING ERRCODE = '42501';
    END IF;

    -- COALESCE: status NULL tem de cair na recusa.
    IF NOT COALESCE(
           (NEW.status = 'pending' AND NEW.invited_by_company_at IS NULL)
        OR (NEW.status = 'invited' AND NEW.invited_by_company_at IS NOT NULL),
           false)
    THEN
        RAISE EXCEPTION 'applications_insert_guard: status inicial nao permitido.'
            USING ERRCODE = '42501';
    END IF;

    -- Lista de permitidos: qualquer outra coluna (inclusive futura) tem de vir NULL.
    IF pg_catalog.jsonb_strip_nulls(pg_catalog.to_jsonb(NEW) - c_permitidas) <> '{}'::jsonb THEN
        RAISE EXCEPTION 'applications_insert_guard: coluna nao permitida na criacao.'
            USING ERRCODE = '42501';
    END IF;

    v_uid := (SELECT auth.uid());
    IF v_uid IS NULL THEN
        RAISE EXCEPTION 'applications_insert_guard: sessao sem usuario.' USING ERRCODE = '42501';
    END IF;

    IF NEW.status = 'pending' THEN
        IF NEW.worker_id IS DISTINCT FROM v_uid THEN
            RAISE EXCEPTION 'applications_insert_guard: candidatura so em nome proprio.'
                USING ERRCODE = '42501';
        END IF;
    ELSE
        IF NEW.worker_id = v_uid OR NOT COALESCE(public.is_job_owner(NEW.job_id), false) THEN
            RAISE EXCEPTION 'applications_insert_guard: convite so pela empresa do turno, para outra pessoa.'
                USING ERRCODE = '42501';
        END IF;
        NEW.invited_by_company_at := pg_catalog.now();
    END IF;

    NEW.created_at := pg_catalog.now();

    RETURN NEW;
END;
$$;

COMMENT ON FUNCTION public.applications_insert_guard() IS
    'BEFORE INSERT em applications: cliente direto (current_user fora de postgres/service_role/'
    'supabase_admin) nao cria linha com presenca, convite respondido ou status diferente de pending/'
    'invited. TEM de ser SECURITY INVOKER: como DEFINER o guard fica inerte.';

DROP TRIGGER IF EXISTS trg_zz_applications_insert_guard ON public.applications;
CREATE TRIGGER trg_zz_applications_insert_guard
    BEFORE INSERT ON public.applications
    FOR EACH ROW EXECUTE FUNCTION public.applications_insert_guard();

-- 2. Verificacao
DO $$
DECLARE
    v_def text;
    v_col text;
BEGIN
    -- tgtype: 1=ROW, 2=BEFORE, 4=INSERT
    IF NOT EXISTS (
        SELECT 1 FROM pg_catalog.pg_trigger t
         WHERE t.tgrelid = 'public.applications'::regclass
           AND t.tgname = 'trg_zz_applications_insert_guard'
           AND t.tgfoid = 'public.applications_insert_guard()'::regprocedure
           AND t.tgtype = 7
           AND t.tgenabled = 'O'
           AND t.tgqual IS NULL
    ) THEN
        RAISE EXCEPTION 'VERIFICACAO: trigger BEFORE INSERT ausente ou divergente. HALT.';
    END IF;

    IF (SELECT p.prosecdef FROM pg_catalog.pg_proc p
         WHERE p.oid = 'public.applications_insert_guard()'::regprocedure) THEN
        RAISE EXCEPTION 'VERIFICACAO: applications_insert_guard nao pode ser SECURITY DEFINER. HALT.';
    END IF;

    SELECT regexp_replace(p.prosrc, '--[^\r\n]*', '', 'g') INTO v_def
      FROM pg_catalog.pg_proc p
     WHERE p.oid = 'public.applications_insert_guard()'::regprocedure;

    FOREACH v_col IN ARRAY ARRAY['worker_checkin_at', 'worker_checkout_at',
                                 'company_checkin_confirmed_at', 'company_checkout_confirmed_at',
                                 'invitation_response', 'invitation_responded_at']
    LOOP
        IF v_def !~ ('\mNEW\.' || v_col || '\M\s+IS\s+NOT\s+NULL\M') THEN
            RAISE EXCEPTION 'VERIFICACAO: guard nao checa a coluna %. HALT.', v_col;
        END IF;
    END LOOP;

    IF v_def !~ '\mcurrent_user\M' OR v_def ~ '\m(session_user|set_config|current_setting)\M' THEN
        RAISE EXCEPTION 'VERIFICACAO: sinal de distincao do guard divergente. HALT.';
    END IF;
END $$;

COMMIT;
