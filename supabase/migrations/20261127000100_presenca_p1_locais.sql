-- Migration: presenca verificada P1 - locais da empresa e segredo do QR
-- ADR-20261125 (.harness/spec/presenca-verificada). Aditiva: nada existente muda.
--
-- company_sites: Gestor escreve; membro confirmado le; freela nao le. Nunca apaga (arquiva).
-- company_site_secrets: RLS ligado, SEM policy e SEM grant para cliente. So funcao DEFINER le.
--
-- DOWN (so antes de 000200, ou depois do DOWN dela):
--   internal_drop_empty_company_shell: remover o NOT EXISTS de company_sites (antes do DROP TABLE).
--   DROP TRIGGER trg_zz_companies_sites_anonymize ON public.companies;
--   DROP TABLE public.company_site_secrets;
--   DROP TABLE public.company_sites;
--   DROP FUNCTION public.company_sites_on_anonymize(), public.company_sites_guard(),
--     public.company_sites_create_secret();

BEGIN;

DO $$
BEGIN
    IF to_regclass('public.companies') IS NULL
       OR to_regprocedure('public.is_company_owner(uuid)') IS NULL
       OR to_regprocedure('public.session_company_member_confirmed(uuid)') IS NULL
       OR NOT EXISTS (SELECT 1 FROM pg_catalog.pg_attribute
                       WHERE attrelid = to_regclass('public.companies') AND attname = 'anonymized_at' AND NOT attisdropped)
    THEN
        RAISE EXCEPTION 'PRE-CONDICAO P1: companies.anonymized_at, is_company_owner ou session_company_member_confirmed ausente. HALT.';
    END IF;
END $$;

CREATE SCHEMA IF NOT EXISTS extensions;
CREATE EXTENSION IF NOT EXISTS pgcrypto WITH SCHEMA extensions;

DO $$
BEGIN
    IF to_regprocedure('extensions.hmac(bytea,bytea,text)') IS NULL
       OR to_regprocedure('extensions.gen_random_bytes(integer)') IS NULL THEN
        RAISE EXCEPTION 'PRE-CONDICAO P1: pgcrypto nao esta no schema extensions. HALT.';
    END IF;
END $$;

CREATE TABLE IF NOT EXISTS public.company_sites (
    id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    company_id   uuid NOT NULL REFERENCES public.companies(id) ON DELETE RESTRICT,
    name         text NOT NULL CHECK (length(btrim(name)) BETWEEN 1 AND 80),
    address_text text CHECK (address_text IS NULL OR length(address_text) <= 200),
    lat          numeric(9,6) NOT NULL CHECK (lat BETWEEN -90 AND 90),
    lng          numeric(9,6) NOT NULL CHECK (lng BETWEEN -180 AND 180),
    radius_m     integer NOT NULL DEFAULT 150 CHECK (radius_m BETWEEN 50 AND 500),
    created_by   uuid DEFAULT auth.uid(),
    created_at   timestamptz NOT NULL DEFAULT now(),
    updated_at   timestamptz NOT NULL DEFAULT now(),
    archived_at  timestamptz
);
COMMENT ON TABLE public.company_sites IS
    'Locais da empresa para presenca verificada. A coordenada e DO LOCAL (nunca do freela). Nunca apaga: arquiva.';

CREATE TABLE IF NOT EXISTS public.company_site_secrets (
    site_id    uuid PRIMARY KEY REFERENCES public.company_sites(id) ON DELETE RESTRICT,
    secret     bytea NOT NULL DEFAULT extensions.gen_random_bytes(32),
    version    integer NOT NULL DEFAULT 1 CHECK (version >= 1),
    rotated_at timestamptz
);
COMMENT ON TABLE public.company_site_secrets IS
    'Segredo do QR. RLS sem policy e sem GRANT a cliente: so funcao SECURITY DEFINER le.';

CREATE OR REPLACE FUNCTION public.company_sites_guard()
RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
BEGIN
    IF TG_OP = 'INSERT' THEN
        IF current_user NOT IN ('postgres', 'service_role', 'supabase_admin') THEN
            NEW.created_by := (SELECT auth.uid());
            NEW.created_at := pg_catalog.now();
        END IF;
    ELSIF NEW.id IS DISTINCT FROM OLD.id
       OR NEW.company_id IS DISTINCT FROM OLD.company_id
       OR NEW.created_by IS DISTINCT FROM OLD.created_by
       OR NEW.created_at IS DISTINCT FROM OLD.created_at THEN
        RAISE EXCEPTION 'company_sites: empresa e autoria do local nao mudam.' USING ERRCODE = '42501';
    END IF;
    NEW.updated_at := pg_catalog.now();
    RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS trg_company_sites_guard ON public.company_sites;
CREATE TRIGGER trg_company_sites_guard BEFORE INSERT OR UPDATE ON public.company_sites
    FOR EACH ROW EXECUTE FUNCTION public.company_sites_guard();

CREATE OR REPLACE FUNCTION public.company_sites_create_secret()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
    INSERT INTO public.company_site_secrets (site_id) VALUES (NEW.id) ON CONFLICT (site_id) DO NOTHING;
    RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.company_sites_create_secret() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS trg_company_sites_secret ON public.company_sites;
CREATE TRIGGER trg_company_sites_secret AFTER INSERT ON public.company_sites
    FOR EACH ROW EXECUTE FUNCTION public.company_sites_create_secret();

ALTER TABLE public.company_sites ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.company_site_secrets ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON public.company_sites FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE ON public.company_sites TO authenticated;
GRANT ALL ON public.company_sites TO service_role;
REVOKE ALL ON public.company_site_secrets FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.company_site_secrets TO service_role;

DROP POLICY IF EXISTS "company_sites_select" ON public.company_sites;
CREATE POLICY "company_sites_select" ON public.company_sites FOR SELECT TO authenticated
    USING (public.is_company_owner(company_id) OR public.session_company_member_confirmed(company_id));
DROP POLICY IF EXISTS "company_sites_insert" ON public.company_sites;
CREATE POLICY "company_sites_insert" ON public.company_sites FOR INSERT TO authenticated
    WITH CHECK (public.is_company_owner(company_id));
DROP POLICY IF EXISTS "company_sites_update" ON public.company_sites;
CREATE POLICY "company_sites_update" ON public.company_sites FOR UPDATE TO authenticated
    USING (public.is_company_owner(company_id)) WITH CHECK (public.is_company_owner(company_id));

-- LGPD: empresa anonimizada (o local pode ser a casa de uma pessoa).
CREATE OR REPLACE FUNCTION public.company_sites_on_anonymize()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
    UPDATE public.company_sites
       SET name = 'Local removido', address_text = NULL, lat = 0, lng = 0,
           archived_at = COALESCE(archived_at, now())
     WHERE company_id = NEW.id;
    RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.company_sites_on_anonymize() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS trg_zz_companies_sites_anonymize ON public.companies;
CREATE TRIGGER trg_zz_companies_sites_anonymize AFTER UPDATE OF anonymized_at ON public.companies
    FOR EACH ROW WHEN (OLD.anonymized_at IS NULL AND NEW.anonymized_at IS NOT NULL)
    EXECUTE FUNCTION public.company_sites_on_anonymize();

-- Casca vazia (E4): a que ja tem local NAO e vazia; sem isto a FK RESTRICT abortaria o aceite de
-- convite de equipe. Edicao do corpo do catalogo.
DO $$
DECLARE
    v_oid regprocedure := to_regprocedure('public.internal_drop_empty_company_shell(uuid)');
    v_def text;
    v_pat text := 'NOT EXISTS [(]SELECT 1 FROM public[.]jobs[[:space:]]';
BEGIN
    IF v_oid IS NULL THEN
        RAISE NOTICE 'P1: internal_drop_empty_company_shell ausente; nada a ajustar.';
        RETURN;
    END IF;
    v_def := pg_catalog.pg_get_functiondef(v_oid);
    IF pg_catalog.strpos(v_def, 'company_sites') > 0 THEN
        RETURN;
    END IF;
    IF (SELECT count(*) FROM pg_catalog.regexp_matches(v_def, v_pat, 'g')) <> 1 THEN
        RAISE EXCEPTION 'ASSERCAO P1: internal_drop_empty_company_shell mudou no catalogo. HALT.';
    END IF;
    v_def := pg_catalog.regexp_replace(v_def, v_pat,
        'NOT EXISTS (SELECT 1 FROM public.company_sites cs WHERE cs.company_id = c.id) AND NOT EXISTS (SELECT 1 FROM public.jobs ');
    EXECUTE v_def;
END $$;

DO $$
BEGIN
    IF NOT (SELECT relrowsecurity FROM pg_catalog.pg_class WHERE oid = 'public.company_site_secrets'::regclass)
       OR EXISTS (SELECT 1 FROM pg_catalog.pg_policy WHERE polrelid = 'public.company_site_secrets'::regclass)
       OR pg_catalog.has_table_privilege('authenticated', 'public.company_site_secrets', 'SELECT,INSERT,UPDATE,DELETE')
       OR pg_catalog.has_table_privilege('anon', 'public.company_site_secrets', 'SELECT,INSERT,UPDATE,DELETE')
    THEN
        RAISE EXCEPTION 'VERIFICACAO P1: company_site_secrets exposta. HALT.';
    END IF;
    IF pg_catalog.has_table_privilege('authenticated', 'public.company_sites', 'DELETE')
       OR pg_catalog.has_table_privilege('anon', 'public.company_sites', 'SELECT')
       OR (SELECT count(*) FROM pg_catalog.pg_policy WHERE polrelid = 'public.company_sites'::regclass) <> 3
    THEN
        RAISE EXCEPTION 'VERIFICACAO P1: acesso de company_sites divergente. HALT.';
    END IF;
END $$;

COMMIT;
