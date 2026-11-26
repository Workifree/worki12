-- Migration: presenca verificada P2 - politica por turno e padrao da empresa
-- Todo turno existente e todo cliente que nao conhece as colunas continuam em 'dual'.
-- ATENCAO (20261126000700): trg_zz_companies_trust_guard tem lista FECHADA de colunas. Sem
-- acrescentar as tres default_* o onboarding de empresa do site publicado quebraria (o INSERT nasce
-- com os DEFAULTs). A lista e atualizada na MESMA transacao, a partir do catalogo.
--
-- DOWN (antes, DOWN da 000300):
--   DROP TRIGGER trg_jobs_presence_policy ON public.jobs;
--   DROP TRIGGER trg_companies_presence_default ON public.companies;
--   DROP FUNCTION public.jobs_presence_policy_guard(), public.companies_presence_default_guard();
--   create_job_series: reexecutar o bloco 6 de 20260817000400.
--   recriar trg_zz_companies_trust_guard com a lista de 20261126000700.
--   ALTER TABLE public.jobs DROP CONSTRAINT jobs_presence_site_required,
--       DROP COLUMN presence_mode, DROP COLUMN site_id, DROP COLUMN qr_mode;
--   ALTER TABLE public.companies DROP COLUMN default_presence_mode, DROP COLUMN default_site_id,
--       DROP COLUMN default_qr_mode;

BEGIN;

DO $$
BEGIN
    IF to_regclass('public.company_sites') IS NULL
       OR to_regclass('public.jobs') IS NULL
       OR to_regclass('public.applications') IS NULL
       OR to_regprocedure('public.create_job_series(uuid,text,integer[],date,date,date[],jsonb)') IS NULL
    THEN
        RAISE EXCEPTION 'PRE-CONDICAO P2: company_sites, jobs, applications ou create_job_series ausente. HALT.';
    END IF;
END $$;

ALTER TABLE public.jobs
    ADD COLUMN IF NOT EXISTS presence_mode text NOT NULL DEFAULT 'dual'
        CONSTRAINT jobs_presence_mode_check CHECK (presence_mode IN ('dual', 'qr_gps')),
    ADD COLUMN IF NOT EXISTS site_id uuid
        CONSTRAINT jobs_site_id_fkey REFERENCES public.company_sites(id) ON DELETE RESTRICT,
    ADD COLUMN IF NOT EXISTS qr_mode text NOT NULL DEFAULT 'rotating'
        CONSTRAINT jobs_qr_mode_check CHECK (qr_mode IN ('rotating', 'static'));

ALTER TABLE public.jobs DROP CONSTRAINT IF EXISTS jobs_presence_site_required;
ALTER TABLE public.jobs ADD CONSTRAINT jobs_presence_site_required
    CHECK (presence_mode <> 'qr_gps' OR site_id IS NOT NULL);

ALTER TABLE public.companies
    ADD COLUMN IF NOT EXISTS default_presence_mode text NOT NULL DEFAULT 'dual'
        CONSTRAINT companies_default_presence_mode_check CHECK (default_presence_mode IN ('dual', 'qr_gps')),
    ADD COLUMN IF NOT EXISTS default_site_id uuid
        CONSTRAINT companies_default_site_id_fkey REFERENCES public.company_sites(id) ON DELETE RESTRICT,
    ADD COLUMN IF NOT EXISTS default_qr_mode text NOT NULL DEFAULT 'rotating'
        CONSTRAINT companies_default_qr_mode_check CHECK (default_qr_mode IN ('rotating', 'static'));

-- 1. Lista de permitidos de companies (le a vigente do catalogo e acrescenta)
DO $$
DECLARE
    v_args  text[];
    v_cols  text[];
    v_col   text;
BEGIN
    SELECT pg_catalog.string_to_array(pg_catalog.encode(t.tgargs, 'escape'), '\000') INTO v_args
      FROM pg_catalog.pg_trigger t
     WHERE t.tgrelid = 'public.companies'::regclass AND t.tgname = 'trg_zz_companies_trust_guard';
    IF v_args IS NULL THEN
        RAISE NOTICE 'P2: trg_zz_companies_trust_guard ausente; nada a liberar.';
        RETURN;
    END IF;
    v_cols := v_args[1]::text[];
    FOREACH v_col IN ARRAY ARRAY['default_presence_mode', 'default_site_id', 'default_qr_mode'] LOOP
        IF NOT v_col = ANY (v_cols) THEN
            v_cols := v_cols || v_col;
        END IF;
    END LOOP;
    DROP TRIGGER trg_zz_companies_trust_guard ON public.companies;
    EXECUTE pg_catalog.format(
        'CREATE TRIGGER trg_zz_companies_trust_guard BEFORE INSERT OR UPDATE ON public.companies '
        'FOR EACH ROW EXECUTE FUNCTION public.profile_trust_guard(%L, %L)', v_cols::text, v_args[2]);
END $$;

-- 2. Turno: local da mesma empresa; AFROUXAR a politica so o Gestor; modo, local e tipo de QR
--    congelam depois do primeiro carimbo. Trigger de linha: vale para UPDATE direto, em lote e por
--    RPC (a sessao e lida por auth.uid(); sessao nula = servidor).
CREATE OR REPLACE FUNCTION public.jobs_presence_policy_guard()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
    IF TG_OP = 'UPDATE' THEN
        IF (SELECT auth.uid()) IS NOT NULL
           AND ((OLD.presence_mode = 'qr_gps' AND NEW.presence_mode IS DISTINCT FROM 'qr_gps')
                OR (OLD.qr_mode = 'rotating' AND NEW.qr_mode IS DISTINCT FROM 'rotating')
                OR ((OLD.presence_mode = 'qr_gps' OR OLD.site_id IS NOT NULL)
                    AND NEW.site_id IS DISTINCT FROM OLD.site_id)
                OR NEW.company_id IS DISTINCT FROM OLD.company_id)
           AND NOT COALESCE(public.is_company_owner(OLD.company_id), false)
        THEN
            RAISE EXCEPTION 'jobs_presence_policy: so o Gestor pode afrouxar a confirmacao de presenca ou trocar o local.'
                USING ERRCODE = '42501';
        END IF;

        IF (NEW.presence_mode IS DISTINCT FROM OLD.presence_mode OR NEW.site_id IS DISTINCT FROM OLD.site_id
            OR NEW.qr_mode IS DISTINCT FROM OLD.qr_mode)
           AND EXISTS (SELECT 1 FROM public.applications a
                        WHERE a.job_id = OLD.id
                          AND (a.worker_checkin_at IS NOT NULL OR a.worker_checkout_at IS NOT NULL
                               OR a.company_checkin_confirmed_at IS NOT NULL
                               OR a.company_checkout_confirmed_at IS NOT NULL))
        THEN
            RAISE EXCEPTION 'jobs_presence_policy: a forma de confirmar presenca nao muda depois do primeiro registro.'
                USING ERRCODE = '42501';
        END IF;
        -- Local nao mudou: nao revalidar (editar turno cujo local foi arquivado depois segue valendo).
        IF NEW.site_id IS NOT DISTINCT FROM OLD.site_id AND NEW.company_id IS NOT DISTINCT FROM OLD.company_id THEN
            RETURN NEW;
        END IF;
    END IF;

    IF NEW.site_id IS NOT NULL AND NOT EXISTS (
        SELECT 1 FROM public.company_sites s
         WHERE s.id = NEW.site_id AND s.company_id = NEW.company_id AND s.archived_at IS NULL
    ) THEN
        RAISE EXCEPTION 'jobs_presence_policy: local inexistente, arquivado ou de outra empresa.'
            USING ERRCODE = '42501';
    END IF;
    RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.jobs_presence_policy_guard() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS trg_jobs_presence_policy ON public.jobs;
CREATE TRIGGER trg_jobs_presence_policy
    BEFORE INSERT OR UPDATE OF presence_mode, site_id, qr_mode, company_id ON public.jobs
    FOR EACH ROW EXECUTE FUNCTION public.jobs_presence_policy_guard();

CREATE OR REPLACE FUNCTION public.companies_presence_default_guard()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
    IF NEW.default_site_id IS NOT NULL AND NOT EXISTS (
        SELECT 1 FROM public.company_sites s WHERE s.id = NEW.default_site_id AND s.company_id = NEW.id
    ) THEN
        RAISE EXCEPTION 'companies_presence_default: local padrao de outra empresa.' USING ERRCODE = '42501';
    END IF;
    RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.companies_presence_default_guard() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS trg_companies_presence_default ON public.companies;
CREATE TRIGGER trg_companies_presence_default BEFORE INSERT OR UPDATE OF default_site_id ON public.companies
    FOR EACH ROW EXECUTE FUNCTION public.companies_presence_default_guard();

-- 3. Serie: cada ocorrencia herda os tres campos do molde (edicao do corpo do catalogo).
DO $$
DECLARE
    v_def  text;
    v_cols text := 'series_id, series_occurrence_date[[:space:]]*[)]';
    v_vals text := 'v_series_id, occ[.]d([[:space:]]+FROM)';
BEGIN
    v_def := pg_catalog.pg_get_functiondef(
        'public.create_job_series(uuid,text,integer[],date,date,date[],jsonb)'::regprocedure);
    IF pg_catalog.strpos(v_def, 'presence_mode') > 0 THEN
        RETURN;
    END IF;
    IF (SELECT count(*) FROM pg_catalog.regexp_matches(v_def, v_cols, 'g')) <> 1
       OR (SELECT count(*) FROM pg_catalog.regexp_matches(v_def, v_vals, 'g')) <> 1 THEN
        RAISE EXCEPTION 'ASSERCAO P2: create_job_series mudou no catalogo. HALT.';
    END IF;
    v_def := pg_catalog.regexp_replace(v_def, v_cols,
        'series_id, series_occurrence_date, presence_mode, site_id, qr_mode)');
    v_def := pg_catalog.regexp_replace(v_def, v_vals,
        E'v_series_id, occ.d, COALESCE(v_rec.presence_mode, ''dual''), v_rec.site_id, COALESCE(v_rec.qr_mode, ''rotating'')\\1');
    EXECUTE v_def;
END $$;

DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM pg_catalog.pg_trigger t
                WHERE t.tgrelid = 'public.companies'::regclass AND t.tgname = 'trg_zz_companies_trust_guard'
                  AND pg_catalog.encode(t.tgargs, 'escape') !~ 'default_presence_mode.*default_site_id.*default_qr_mode')
    THEN
        RAISE EXCEPTION 'VERIFICACAO P2: lista de companies nao liberou as colunas novas. HALT.';
    END IF;
    IF pg_catalog.pg_get_functiondef('public.create_job_series(uuid,text,integer[],date,date,date[],jsonb)'::regprocedure)
       !~ 'v_rec[.]presence_mode' THEN
        RAISE EXCEPTION 'VERIFICACAO P2: create_job_series nao copia a politica. HALT.';
    END IF;
END $$;

COMMIT;
