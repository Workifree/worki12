-- Migration: MODELOS DE TURNO (shift_templates)
--
-- A empresa guarda um turno como modelo (função, local, horário, vagas, valor) e cria o próximo em um
-- toque. O modelo pertence à EMPRESA, não à pessoa (mesmo princípio do Elenco): quem sai não leva nem
-- apaga. Lido e criado por Gestor e por encarregado CONFIRMADO (is_company_member_confirmed); o
-- encarregado só enxerga os modelos, nunca dados de freela (a tabela não tem nenhum).
--
-- Padrão company_tags: nunca apagada (sem policy nem GRANT de DELETE); "excluir" = archived_at.
-- UPDATE só de name e archived_at (o conteúdo do modelo é imutável: para mudar, salve outro e arquive).
-- LGPD: sem dado de pessoa. created_by é uuid pseudônimo retido (mesma régua de company_tags).
-- O conteúdo é texto operacional da empresa (título, descrição, local) com teto de 6 KB.
--
-- Sem DROP/DELETE: as policies nascem uma vez (checagem em pg_policies), então reaplicar é seguro.
--
-- DOWN:
--   DROP TABLE IF EXISTS public.shift_templates;
--   DROP FUNCTION IF EXISTS public.shift_templates_limit();

CREATE TABLE IF NOT EXISTS public.shift_templates (
    id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
    company_id  uuid        NOT NULL REFERENCES public.companies(id) ON DELETE RESTRICT,
    name        text        NOT NULL CHECK (length(btrim(name)) BETWEEN 1 AND 60),
    template    jsonb       NOT NULL CHECK (jsonb_typeof(template) = 'object' AND octet_length(template::text) <= 6000),
    defaults    jsonb       NOT NULL CHECK (jsonb_typeof(defaults) = 'object' AND octet_length(defaults::text) <= 600),
    created_by  uuid        NOT NULL,
    created_at  timestamptz NOT NULL DEFAULT now(),
    archived_at timestamptz
);

-- Um nome por empresa entre os ativos ("Garçom sábado" e "garçom sábado" são o mesmo).
CREATE UNIQUE INDEX IF NOT EXISTS uq_shift_templates_company_name
    ON public.shift_templates (company_id, lower(btrim(name))) WHERE archived_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_shift_templates_company
    ON public.shift_templates (company_id, created_at DESC) WHERE archived_at IS NULL;

COMMENT ON TABLE public.shift_templates IS
    'Modelo de turno da empresa (criação rápida). Pertence à empresa. Nunca apagada: arquivar = archived_at. '
    'Escrita por Gestor e encarregado confirmado; conteúdo imutável (UPDATE só de name e archived_at). '
    'LGPD: sem dado de pessoa; created_by é uuid pseudônimo retido (régua de company_tags).';

-- Teto de modelos ativos por empresa: lista de 100 já não é "à mão".
CREATE OR REPLACE FUNCTION public.shift_templates_limit()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
BEGIN
    IF (SELECT count(*) FROM public.shift_templates t
         WHERE t.company_id = NEW.company_id AND t.archived_at IS NULL) >= 100 THEN
        RAISE EXCEPTION 'shift_templates: limite de 100 modelos ativos por empresa'
            USING ERRCODE = 'check_violation';
    END IF;
    RETURN NEW;
END;
$$;

DO $mig$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_shift_templates_limit'
                    AND tgrelid = 'public.shift_templates'::regclass) THEN
        CREATE TRIGGER trg_shift_templates_limit
            BEFORE INSERT ON public.shift_templates
            FOR EACH ROW EXECUTE FUNCTION public.shift_templates_limit();
    END IF;
END
$mig$;

-- Nunca FROM PUBLIC em tabela (lição de 20260318000000): os GRANTs abaixo repõem o que cada papel pode.
REVOKE ALL ON public.shift_templates FROM anon, authenticated, service_role;
GRANT SELECT ON public.shift_templates TO authenticated;
GRANT INSERT (company_id, name, template, defaults, created_by) ON public.shift_templates TO authenticated;
GRANT UPDATE (name, archived_at) ON public.shift_templates TO authenticated;
GRANT SELECT, INSERT, UPDATE ON public.shift_templates TO service_role;

-- Policies ANTES do ENABLE RLS (landmine do projeto); criadas só se ainda não existem.
DO $mig$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'shift_templates'
                    AND policyname = 'shift_templates_select') THEN
        CREATE POLICY "shift_templates_select" ON public.shift_templates
            FOR SELECT TO authenticated
            USING (public.is_company_member_confirmed(company_id));
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'shift_templates'
                    AND policyname = 'shift_templates_insert') THEN
        CREATE POLICY "shift_templates_insert" ON public.shift_templates
            FOR INSERT TO authenticated
            WITH CHECK (
                public.is_company_member_confirmed(company_id)
                AND created_by = (SELECT auth.uid())
                AND archived_at IS NULL
            );
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'shift_templates'
                    AND policyname = 'shift_templates_update') THEN
        CREATE POLICY "shift_templates_update" ON public.shift_templates
            FOR UPDATE TO authenticated
            USING (public.is_company_member_confirmed(company_id))
            WITH CHECK (public.is_company_member_confirmed(company_id));
    END IF;
    -- SEM policy de DELETE.
END
$mig$;

ALTER TABLE public.shift_templates ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.shift_templates NO FORCE ROW LEVEL SECURITY;
