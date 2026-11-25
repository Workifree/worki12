-- STUB do schema existente para executar as migrations da trilha no PGlite. NAO e o schema de
-- producao: so as colunas que a trilha e anonymize_account tocam; sem as RLS, FKs e gatilhos reais.
CREATE ROLE anon NOLOGIN;
CREATE ROLE authenticated NOLOGIN;
CREATE ROLE service_role NOLOGIN BYPASSRLS;
GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role;
-- mesmos default privileges do Supabase (a migration precisa revoga-los)
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO anon, authenticated, service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON FUNCTIONS TO anon, authenticated, service_role;
CREATE SCHEMA auth;
GRANT USAGE ON SCHEMA auth TO anon, authenticated, service_role;
CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS
$$ SELECT (NULLIF(current_setting('request.jwt.claims', true), '')::json->>'sub')::uuid $$;

CREATE TABLE public.companies (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), owner_id uuid, organization_id uuid,
    name text, default_briefing text, cnpj text, city text, email text, address text, website text, description text,
    industry text, logo_url text, cover_url text, company_type text, size text, anonymized_at timestamptz);
CREATE TABLE public.company_members (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), company_id uuid NOT NULL,
    user_id uuid, role text NOT NULL DEFAULT 'manager' CONSTRAINT company_members_role_check CHECK (role = 'manager'),
    status text NOT NULL DEFAULT 'invited', invited_email text, invite_token text, created_by uuid NOT NULL DEFAULT gen_random_uuid(),
    confirmed_at timestamptz, display_name text, accepted_email text, removed_at timestamptz);
CREATE TABLE public.organization_members (organization_id uuid, user_id uuid, role text, status text,
    invited_email text, invite_token text, created_by uuid);
CREATE TABLE public.workers (id uuid PRIMARY KEY, full_name text, pix_key text, phone text, cpf text,
    anonymized_at timestamptz);
CREATE TABLE public.jobs (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), company_id uuid, title text, status text,
    start_date timestamptz, work_start_time time, work_end_time time, created_at timestamptz DEFAULT now(),
    responsible_id uuid, briefing text, description text, requirements text, certification_requirement text);
CREATE TABLE public.applications (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), job_id uuid, worker_id uuid,
    status text, worker_checkin_at timestamptz, worker_checkout_at timestamptz,
    company_checkin_confirmed_at timestamptz, company_checkout_confirmed_at timestamptz,
    cover_letter text, message text, UNIQUE (job_id, worker_id));
CREATE TABLE public.shift_payments (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), job_id uuid, worker_id uuid,
    company_id uuid, application_id uuid, status text, recorded_by uuid, worker_confirmed_at timestamptz);
CREATE UNIQUE INDEX uq_sp_active ON public.shift_payments (job_id, worker_id) WHERE status IN ('scheduled', 'recorded');
CREATE TABLE public.shift_calls (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), job_id uuid, company_id uuid,
    created_by uuid, status text, first_claim_at timestamptz, message text);
CREATE TABLE public.shift_call_targets (call_id uuid, worker_id uuid, response text);
CREATE TABLE public.team_connections (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), company_id uuid, worker_id uuid,
    status text, source text, invited_by uuid, created_at timestamptz DEFAULT now());

-- tabelas que so a anonymize_account REAL (carregada pelo runner) toca
CREATE TABLE public.wallets (id uuid, user_id uuid, balance numeric);
CREATE TABLE public.escrow_transactions (company_wallet_id uuid, worker_wallet_id uuid, status text);
CREATE TABLE public.service_terms (term_text text, accepted_at timestamptz, accepted_ip text,
    accepted_user_agent text, anonymized_at timestamptz, worker_id uuid, company_id uuid);
CREATE TABLE public.worker_referrals (worker_id uuid, referring_company_id uuid, requesting_company_id uuid);
CREATE TABLE public.worker_company_badge_prefs (worker_id uuid, company_id uuid);
CREATE TABLE public.notifications (user_id uuid);
CREATE TABLE public.analytics_events (user_id uuid);
CREATE TABLE public.responsibility_coverages (company_id uuid, from_user_id uuid, to_user_id uuid, revoked_at timestamptz);

-- helpers de E0/E1 (versao enxuta com a mesma semantica usada pela trilha)
CREATE FUNCTION public.session_company_member_role(p uuid) RETURNS text LANGUAGE sql AS $$ SELECT NULL::text $$;
CREATE FUNCTION public.internal_company_active_operator(c uuid, u uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
    SELECT EXISTS (SELECT 1 FROM public.companies x WHERE x.id = c AND (x.owner_id = u OR x.id = u))
        OR EXISTS (SELECT 1 FROM public.company_members m WHERE m.company_id = c AND m.user_id = u AND m.status = 'active')
$$;
CREATE FUNCTION public.internal_company_confirmed_operator(c uuid, u uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$ SELECT public.internal_company_active_operator(c, u) $$;
