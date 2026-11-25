-- Complemento do stub para aplicar os DOIS hardenings de applications (20261125000100 e 000200):
-- colunas de convite, o trigger antigo que eles exigem e o seam is_job_owner.
ALTER TABLE public.applications
    ADD COLUMN invited_by_company_at timestamptz,
    ADD COLUMN invitation_expires_at timestamptz,
    ADD COLUMN invitation_response text,
    ADD COLUMN invitation_responded_at timestamptz,
    ADD COLUMN created_at timestamptz DEFAULT now();

CREATE FUNCTION public.validate_application_update() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER
SET search_path = '' AS $$ BEGIN RETURN NEW; END $$;
CREATE TRIGGER trg_validate_application_update BEFORE UPDATE ON public.applications
    FOR EACH ROW EXECUTE FUNCTION public.validate_application_update();

CREATE FUNCTION public.is_job_owner(p_job_id uuid) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = '' AS $$
    SELECT EXISTS (SELECT 1 FROM public.jobs j
                    WHERE j.id = p_job_id AND public.internal_company_active_operator(j.company_id, auth.uid()))
$$;
