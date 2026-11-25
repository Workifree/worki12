BEGIN;
-- Migration: SOS mede a urgencia pelo horario de ENTRADA do turno (D-7)
-- File: supabase/migrations/20261125000300_sos_usa_horario_de_entrada.sql
--
-- DEFEITO: jobs.start_date carrega o DIA do turno (gravado ao meio-dia local); a hora real esta em
-- jobs.work_start_time (TEXT, pode ser '' ou NULL). sos_call_eligibility e create_sos_call comparavam
-- start_date: turno que comecava em 17 min era recusado.
--
-- CORRECAO: instante de entrada = data local America/Sao_Paulo de start_date + work_start_time.
--   SEM horario valido ('' / NULL / fora de H:MM[:SS]): usa start_date como esta (comportamento
--   anterior, inalterado). start_date NULL: continua NULL (idem). Janela de 4h do produto inalterada.
--   Vale para job_started, not_urgent e para o teto de expires_at do chamado (LEAST(+45 min, inicio)).
--   LEGADO: start_date exatamente a 00:00:00 UTC e data pura; o dia e o da data UTC (em Sao Paulo
--   cairia no DIA ANTERIOR). Diverge de 20261125000200, que usa sempre a data de Sao Paulo.
--
-- METODO: edicao do corpo do CATALOGO (pg_get_functiondef + replace com assercao de contagem), so na
-- linha do SELECT que carrega v_job: v_job.start_date passa a SER o instante de entrada. Nao toca as
-- ancoras de 20261123000400 (secao 11b: gate, cota, Elenco, lock, 'j0.company_id',
-- 'owner_id = v_uid'): funciona antes e depois dela, e preserva o que ela editar. ACL, COMMENT,
-- SECURITY DEFINER e search_path sao preservados por CREATE OR REPLACE. Idempotente.
-- ATENCAO: reaplicar 20260817001600 (CREATE OR REPLACE do corpo antigo) desfaz esta correcao.
-- Article 8: nao toca saldo nem dados.
--
-- UP: este arquivo.
-- DOWN (rollback; reabre o D-7; preserva a E3 se aplicada). Entre os marcadores:
-- >>> DOWN
-- DO $down$
-- DECLARE v_alvo text; v_def text;
-- BEGIN
--     FOREACH v_alvo IN ARRAY ARRAY['public.sos_call_eligibility(uuid)', 'public.create_sos_call(uuid, text, text)']
--     LOOP
--         v_def := pg_get_functiondef(v_alvo::regprocedure);
--         EXECUTE replace(v_def, 'public.sos_shift_starts_at(j.start_date, j.work_start_time::text) AS start_date', 'j.start_date');
--     END LOOP;
-- END
-- $down$;
-- DROP FUNCTION IF EXISTS public.sos_shift_starts_at(timestamptz, text);
-- <<< DOWN

CREATE OR REPLACE FUNCTION public.sos_shift_starts_at(p_start_date timestamptz, p_work_start_time text)
RETURNS timestamptz
LANGUAGE sql
STABLE
SET search_path = ''
AS $$
    SELECT COALESCE(
        (CASE WHEN (p_start_date AT TIME ZONE 'UTC')::time = '00:00:00'
              THEN (p_start_date AT TIME ZONE 'UTC')::date
              ELSE (p_start_date AT TIME ZONE 'America/Sao_Paulo')::date
         END
          + CASE WHEN p_work_start_time ~ '^([01]?[0-9]|2[0-3]):[0-5][0-9](:[0-5][0-9])?$'
                 THEN p_work_start_time::time END
        ) AT TIME ZONE 'America/Sao_Paulo',
        p_start_date
    );
$$;

COMMENT ON FUNCTION public.sos_shift_starts_at(timestamptz, text) IS
    'Instante de entrada do turno para o SOS: dia de start_date (America/Sao_Paulo; a data UTC se for '
    '00:00:00 UTC, legado de data pura) + work_start_time em Sao Paulo. Sem horario valido, devolve '
    'start_date. Uso interno das RPCs do SOS (DEFINER).';

-- so as RPCs DEFINER (executam como o dono) chamam o helper
REVOKE ALL ON FUNCTION public.sos_shift_starts_at(timestamptz, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.sos_shift_starts_at(timestamptz, text) TO service_role;

DO $mig$
DECLARE
    v_alvo text;
    v_def  text;
    v_n    integer;
    c_pat  constant text :=
        'SELECT j[.]id, j[.]status, j[.]start_date, j[.]slots, j[.]company_id\M';
    c_new  constant text :=
        'SELECT j.id, j.status, public.sos_shift_starts_at(j.start_date, j.work_start_time::text) AS start_date, j.slots, j.company_id';
BEGIN
    FOREACH v_alvo IN ARRAY ARRAY[
        'public.sos_call_eligibility(uuid)',
        'public.create_sos_call(uuid, text, text)'
    ]
    LOOP
        v_def := pg_get_functiondef(v_alvo::regprocedure);
        IF v_def ~ '\msos_shift_starts_at\M' THEN
            RAISE NOTICE 'SOS horario: % ja usa o horario de entrada; nada a fazer.', v_alvo;
            CONTINUE;
        END IF;
        SELECT count(*) INTO v_n FROM regexp_matches(v_def, c_pat, 'g');
        IF v_n <> 1 THEN
            RAISE EXCEPTION 'ASSERCAO SOS horario em %: % ocorrencia(s) do SELECT de v_job (esperado 1). HALT.', v_alvo, v_n;
        END IF;
        EXECUTE regexp_replace(v_def, c_pat, c_new);
    END LOOP;
END
$mig$;

-- Assercoes finais
DO $assert$
DECLARE
    v_oid  oid;
    v_src  text;
    v_n    integer;
BEGIN
    FOREACH v_oid IN ARRAY ARRAY[
        'public.sos_call_eligibility(uuid)'::regprocedure::oid,
        'public.create_sos_call(uuid, text, text)'::regprocedure::oid
    ]
    LOOP
        SELECT p.prosrc INTO v_src FROM pg_proc p WHERE p.oid = v_oid;
        SELECT count(*) INTO v_n FROM regexp_matches(v_src, '\msos_shift_starts_at\M', 'g');
        IF v_n <> 1 THEN
            RAISE EXCEPTION 'ASSERCAO SOS horario: % chamada(s) do helper em % (esperado 1).', v_n, v_oid::regprocedure;
        END IF;
        -- as duas unicas leituras de j.* de horario sao os argumentos do helper
        SELECT count(*) INTO v_n FROM regexp_matches(v_src, '\mj[.]start_date\M', 'g');
        IF v_n <> 1 OR v_src !~ '\msos_shift_starts_at[(]j[.]start_date, j[.]work_start_time::text[)] AS start_date\M' THEN
            RAISE EXCEPTION 'ASSERCAO SOS horario: % ainda le start_date cru.', v_oid::regprocedure;
        END IF;
        IF v_src !~ '\minterval ''4 hours''' THEN
            RAISE EXCEPTION 'ASSERCAO SOS horario: janela de 4h ausente em %.', v_oid::regprocedure;
        END IF;
        IF NOT EXISTS (SELECT 1 FROM pg_proc p WHERE p.oid = v_oid AND p.prosecdef
                        AND array_to_string(p.proconfig, ',') ~ '\msearch_path=')
           OR NOT has_function_privilege('authenticated', v_oid, 'EXECUTE')
           OR has_function_privilege('anon', v_oid, 'EXECUTE') THEN
            RAISE EXCEPTION 'ASSERCAO SOS horario: DEFINER/search_path/ACL alterados em %.', v_oid::regprocedure;
        END IF;
    END LOOP;
    IF has_function_privilege('anon', 'public.sos_shift_starts_at(timestamptz, text)', 'EXECUTE')
       OR has_function_privilege('authenticated', 'public.sos_shift_starts_at(timestamptz, text)', 'EXECUTE') THEN
        RAISE EXCEPTION 'ASSERCAO SOS horario: helper exposto a anon/authenticated.';
    END IF;
END
$assert$;

COMMIT;
