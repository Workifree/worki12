-- Migration: MODELOS DE TURNO (2/2) - endurecimento apontado na revisão de segurança
--
--  1. Teto de 100 modelos ativos também ao DESARQUIVAR (antes só no INSERT: arquivar 100, criar 100 novos
--     e desarquivar os antigos passava de 100).
--  2. Trava por empresa na contagem (duas inserções concorrentes com 99 modelos não passam de 100).
--  3. jsonb com lista fechada de chaves: a tabela não aceita dado de freela nem campo inventado,
--     por construção e não só por convenção.
--
-- DECISÃO REGISTRADA (revisão de segurança, achados 3 e 9):
--   * template/name guardam texto operacional da empresa (título, descrição, briefing, local). Não são
--     dado de pessoa por desenho, mas o texto livre pode, por descuido, citar alguém. Ficam retidos como
--     company_tags; a limpeza na anonimização da empresa fica para o ADR de LGPD das empresas.
--   * Qualquer Gestor ou encarregado confirmado pode renomear/arquivar modelo da empresa: o modelo
--     pertence à empresa (mesmo princípio do Elenco), não a quem o criou.
--   * Casca de empresa (onboarding incompleto) não cria turno, logo não tem modelo; por isso
--     internal_drop_empty_company_shell não precisa conhecer shift_templates hoje. Se isso mudar, incluir.
--
-- Sem DROP/DELETE: reaplicar é seguro.

CREATE OR REPLACE FUNCTION public.shift_templates_limit()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
BEGIN
    -- Serializa as inserções/desarquivamentos da mesma empresa (a contagem abaixo roda sem lock de linha).
    PERFORM pg_advisory_xact_lock(hashtextextended('shift_templates:' || NEW.company_id::text, 0));
    IF (SELECT count(*) FROM public.shift_templates t
         WHERE t.company_id = NEW.company_id AND t.archived_at IS NULL AND t.id <> NEW.id) >= 100 THEN
        RAISE EXCEPTION 'shift_templates: limite de 100 modelos ativos por empresa'
            USING ERRCODE = 'check_violation';
    END IF;
    RETURN NEW;
END;
$$;

DO $mig$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_shift_templates_limit_unarchive'
                    AND tgrelid = 'public.shift_templates'::regclass) THEN
        CREATE TRIGGER trg_shift_templates_limit_unarchive
            BEFORE UPDATE OF archived_at ON public.shift_templates
            FOR EACH ROW
            WHEN (OLD.archived_at IS NOT NULL AND NEW.archived_at IS NULL)
            EXECUTE FUNCTION public.shift_templates_limit();
    END IF;

    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'shift_templates_template_keys'
                    AND conrelid = 'public.shift_templates'::regclass) THEN
        ALTER TABLE public.shift_templates ADD CONSTRAINT shift_templates_template_keys CHECK (
            (template - ARRAY['title','category','description','requirements','briefing',
                              'certification_requirement','location','budget_type','has_lunch','tag_id']) = '{}'::jsonb
        );
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'shift_templates_defaults_keys'
                    AND conrelid = 'public.shift_templates'::regclass) THEN
        ALTER TABLE public.shift_templates ADD CONSTRAINT shift_templates_defaults_keys CHECK (
            (defaults - ARRAY['start_time','end_time','slots','budget']) = '{}'::jsonb
        );
    END IF;
END
$mig$;
