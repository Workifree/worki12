-- 20261129000100_cpf_leitura_propria.sql
-- Etapa 1 de .harness/spec/cpf-restrito (ADR-20261125-cpf-restrito).
-- Puramente aditiva: cria as duas portas pelas quais o PROPRIO freela le e grava cpf/birth_date,
-- para que a etapa 2 possa revogar SELECT dessas colunas sem quebrar Profile/Dashboard/Onboarding.
-- Nao muda nenhuma policy, grant de tabela nem trigger. O site publicado (main) segue intacto.
-- Nao toca saldo (Article 8). Idempotente (CREATE OR REPLACE; pode reaplicar).
--
-- DOWN (rollback manual; reverter antes o frontend da etapa 1 e a etapa 2, se aplicada):
--   DROP FUNCTION IF EXISTS public.set_my_worker_identity(text, date);
--   DROP FUNCTION IF EXISTS public.get_my_worker_profile();
--   NOTIFY pgrst, 'reload schema';

-- 0. Pre-condicoes por catalogo
DO $pre$
DECLARE
    v_missing text;
BEGIN
    SELECT pg_catalog.string_agg(r.c, ', ') INTO v_missing
      FROM (VALUES
        ('id', '^uuid$'),
        ('cpf', '^(text|character varying|character)$'),
        ('birth_date', '^date$'),
        ('anonymized_at', '^timestamp with time zone$')
      ) AS r(c, t)
     WHERE NOT EXISTS (
        SELECT 1 FROM information_schema.columns k
         WHERE k.table_schema = 'public' AND k.table_name = 'workers'
           AND k.column_name = r.c AND k.data_type ~ r.t);
    IF v_missing IS NOT NULL THEN
        RAISE EXCEPTION 'PRECONDICAO cpf-restrito etapa 1: workers sem coluna/tipo esperado: %. HALT.', v_missing;
    END IF;
    IF pg_catalog.to_regprocedure('auth.uid()') IS NULL THEN
        RAISE EXCEPTION 'PRECONDICAO cpf-restrito etapa 1: auth.uid() ausente. HALT.';
    END IF;
    IF EXISTS (
        SELECT 1 FROM pg_catalog.pg_proc p
         WHERE p.pronamespace = 'public'::pg_catalog.regnamespace
           AND ((p.proname = 'get_my_worker_profile'
                 AND pg_catalog.oidvectortypes(p.proargtypes) <> '')
             OR (p.proname = 'set_my_worker_identity'
                 AND pg_catalog.oidvectortypes(p.proargtypes) <> 'text, date'))) THEN
        RAISE EXCEPTION 'PRECONDICAO cpf-restrito etapa 1: overload inesperado das RPCs. HALT.';
    END IF;
END;
$pre$;

-- 1. Leitura do proprio cadastro completo. Sempre sobre auth.uid(): nao aceita "de quem".
CREATE OR REPLACE FUNCTION public.get_my_worker_profile()
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
    SELECT pg_catalog.to_jsonb(w.*)
      FROM public.workers w
     WHERE w.id = auth.uid()
       AND w.anonymized_at IS NULL;
$$;

COMMENT ON FUNCTION public.get_my_worker_profile() IS
    'Cadastro completo do proprio freela (inclui cpf/birth_date). Unica leitura de cpf pelo client '
    'apos a etapa 2 de cpf-restrito. Sem parametro de proposito. ADR-20261125-cpf-restrito.';

-- 2. Gravacao de cpf/birth_date pelo proprio freela.
-- Os dois campos tem a MESMA regra: so preenche se vazio (no CPF ela hoje vive so no client,
-- Profile.tsx cpfJaCadastrado). Valor diferente do ja gravado nao e escrito e e devolvido no retorno:
--   {outcome, cpf_locked: bool, birth_date_locked: bool}
--   outcome: saved | cpf_locked | birth_date_locked (com os dois travados, vale cpf_locked)
-- Recusas (nada e gravado), so {outcome}: unauthenticated | invalid_cpf | invalid_birth_date |
--   not_found | anonymized.
-- CPF: aceita digitos com pontos, traco e espacos; grava so os 11 digitos (como o frontend grava
-- hoje) e confere os digitos verificadores (mesmo algoritmo de lib/validation.ts validateCPF).
-- Nascimento: o app nao aplica idade minima; exige so data passada (fuso de Sao Paulo) e >= 1900.
CREATE OR REPLACE FUNCTION public.set_my_worker_identity(p_cpf text DEFAULT NULL, p_birth_date date DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_uid uuid := auth.uid();
    v_raw text := NULLIF(pg_catalog.btrim(COALESCE(p_cpf, '')), '');
    v_cpf text;
    v_soma integer;
    v_n integer;
    v_i integer;
    v_cpf_atual text;
    v_nasc_atual date;
    v_anon timestamptz;
    v_cpf_locked boolean;
    v_nasc_locked boolean;
BEGIN
    IF v_uid IS NULL THEN
        RETURN pg_catalog.jsonb_build_object('outcome', 'unauthenticated');
    END IF;

    IF v_raw IS NOT NULL THEN
        IF v_raw !~ '^[0-9. -]+$' THEN
            RETURN pg_catalog.jsonb_build_object('outcome', 'invalid_cpf');
        END IF;
        v_cpf := pg_catalog.regexp_replace(v_raw, '[^0-9]', '', 'g');
        IF pg_catalog.length(v_cpf) <> 11 OR v_cpf ~ '^([0-9])\1{10}$' THEN
            RETURN pg_catalog.jsonb_build_object('outcome', 'invalid_cpf');
        END IF;
        -- v_n = 9 confere o 1o digito verificador; v_n = 10 confere o 2o.
        FOR v_n IN 9..10 LOOP
            v_soma := 0;
            FOR v_i IN 1..v_n LOOP
                v_soma := v_soma + pg_catalog.substr(v_cpf, v_i, 1)::integer * (v_n + 2 - v_i);
            END LOOP;
            IF ((v_soma * 10) % 11) % 10 <> pg_catalog.substr(v_cpf, v_n + 1, 1)::integer THEN
                RETURN pg_catalog.jsonb_build_object('outcome', 'invalid_cpf');
            END IF;
        END LOOP;
    END IF;

    IF p_birth_date IS NOT NULL
       AND (p_birth_date < DATE '1900-01-01'
            OR p_birth_date >= (pg_catalog.now() AT TIME ZONE 'America/Sao_Paulo')::date) THEN
        RETURN pg_catalog.jsonb_build_object('outcome', 'invalid_birth_date');
    END IF;

    SELECT NULLIF(pg_catalog.btrim(w.cpf), ''), w.birth_date, w.anonymized_at
      INTO v_cpf_atual, v_nasc_atual, v_anon
      FROM public.workers w WHERE w.id = v_uid FOR UPDATE;
    IF NOT FOUND THEN
        RETURN pg_catalog.jsonb_build_object('outcome', 'not_found');
    END IF;
    IF v_anon IS NOT NULL THEN
        RETURN pg_catalog.jsonb_build_object('outcome', 'anonymized');
    END IF;

    -- CPF antigo pode ter sido gravado com mascara: compara so os digitos.
    v_cpf_locked := v_cpf IS NOT NULL AND v_cpf_atual IS NOT NULL
                    AND pg_catalog.regexp_replace(v_cpf_atual, '[^0-9]', '', 'g') <> v_cpf;
    v_nasc_locked := p_birth_date IS NOT NULL AND v_nasc_atual IS NOT NULL
                     AND v_nasc_atual <> p_birth_date;

    -- Sem nada a preencher, nao escreve.
    IF (v_cpf_atual IS NULL AND v_cpf IS NOT NULL) OR (v_nasc_atual IS NULL AND p_birth_date IS NOT NULL) THEN
        UPDATE public.workers w
           SET cpf        = CASE WHEN v_cpf_atual IS NULL AND v_cpf IS NOT NULL THEN v_cpf ELSE w.cpf END,
               birth_date = COALESCE(w.birth_date, p_birth_date)
         WHERE w.id = v_uid;
    END IF;

    RETURN pg_catalog.jsonb_build_object(
        'outcome', CASE WHEN v_cpf_locked THEN 'cpf_locked'
                        WHEN v_nasc_locked THEN 'birth_date_locked'
                        ELSE 'saved' END,
        'cpf_locked', v_cpf_locked,
        'birth_date_locked', v_nasc_locked);
END;
$$;

COMMENT ON FUNCTION public.set_my_worker_identity(text, date) IS
    'Grava cpf e birth_date do proprio freela, cada um so se vazio; devolve cpf_locked/'
    'birth_date_locked. Valida digitos do CPF e data passada >= 1900; recusa conta anonimizada. '
    'Onboarding deixa de mandar cpf no upsert (ON CONFLICT DO UPDATE le EXCLUDED.cpf e exige SELECT '
    'na coluna). ADR-20261125-cpf-restrito.';

REVOKE ALL ON FUNCTION public.get_my_worker_profile() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.set_my_worker_identity(text, date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_my_worker_profile() TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.set_my_worker_identity(text, date) TO authenticated, service_role;

-- 3. Assercoes finais por catalogo
DO $post$
DECLARE
    v_sig text;
    v_proc pg_catalog.pg_proc;
BEGIN
    FOREACH v_sig IN ARRAY ARRAY['public.get_my_worker_profile()', 'public.set_my_worker_identity(text,date)'] LOOP
        SELECT * INTO v_proc FROM pg_catalog.pg_proc p WHERE p.oid = v_sig::pg_catalog.regprocedure;
        IF NOT v_proc.prosecdef
           OR v_proc.prorettype <> 'jsonb'::pg_catalog.regtype
           OR v_proc.provolatile <> (CASE WHEN v_proc.proname = 'get_my_worker_profile' THEN 's' ELSE 'v' END)::"char"
           OR NOT COALESCE(v_proc.proconfig && ARRAY['search_path=""', 'search_path=']::text[], false) THEN
            RAISE EXCEPTION 'VERIFICACAO cpf-restrito: % sem DEFINER/jsonb/volatilidade/search_path esperados. HALT.', v_sig;
        END IF;
        IF pg_catalog.has_function_privilege('anon', v_proc.oid, 'EXECUTE')
           OR EXISTS (SELECT 1 FROM pg_catalog.aclexplode(v_proc.proacl) a WHERE a.grantee = 0) THEN
            RAISE EXCEPTION 'VERIFICACAO cpf-restrito: % executavel por anon/PUBLIC. HALT.', v_sig;
        END IF;
        IF NOT pg_catalog.has_function_privilege('authenticated', v_proc.oid, 'EXECUTE')
           OR NOT pg_catalog.has_function_privilege('service_role', v_proc.oid, 'EXECUTE') THEN
            RAISE EXCEPTION 'VERIFICACAO cpf-restrito: % sem EXECUTE para authenticated/service_role. HALT.', v_sig;
        END IF;
        -- O dono precisa continuar lendo as colunas depois da etapa 2.
        IF NOT pg_catalog.has_column_privilege(v_proc.proowner, 'public.workers', 'cpf', 'SELECT')
           OR NOT pg_catalog.has_column_privilege(v_proc.proowner, 'public.workers', 'birth_date', 'SELECT') THEN
            RAISE EXCEPTION 'VERIFICACAO cpf-restrito: dono de % nao le cpf/birth_date. HALT.', v_sig;
        END IF;
    END LOOP;
    IF (SELECT pg_catalog.count(*) FROM pg_catalog.pg_proc p
         WHERE p.pronamespace = 'public'::pg_catalog.regnamespace
           AND p.proname IN ('get_my_worker_profile', 'set_my_worker_identity')) <> 2 THEN
        RAISE EXCEPTION 'VERIFICACAO cpf-restrito: overload inesperado. HALT.';
    END IF;
END;
$post$;

NOTIFY pgrst, 'reload schema';
