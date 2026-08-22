-- Migration: F13 Fase 1 — backfill de organizacoes + organization_id NOT NULL
-- File: supabase/migrations/20260818100100_organizations_backfill.sql
-- Contrato: .harness/spec/multi-unidade/ddl-aprovado.md §5.2
--
-- Efeito: toda empresa existente vira uma organizacao de UMA unidade so. O modelo multi-unidade
-- nasce sem mudar nada do que ja funciona. Virar "multi" de verdade e acao futura da conta-mae.
--
-- Marcador de reversibilidade: toda organizacao criada aqui tem EXATAMENTE 1 companies apontando
-- para ela e organization_members apenas com role='owner'. Enquanto isso for verdade, o DOWN e
-- seguro. Deixa de ser no instante em que a primeira SEGUNDA unidade entrar numa organizacao.
--
-- Idempotente: rodar duas vezes nao cria organizacao duplicada (WHERE organization_id IS NULL).
-- Article 8: nao toca saldo.

DO $$
DECLARE
    v_company RECORD;
    v_org_id  uuid;
    v_name    text;
BEGIN
    FOR v_company IN
        SELECT id, name, owner_id FROM public.companies WHERE organization_id IS NULL
    LOOP
        v_name := NULLIF(trim(COALESCE(v_company.name, '')), '');
        IF v_name IS NULL THEN
            v_name := 'Organizacao ' || left(v_company.id::text, 8);
        END IF;

        INSERT INTO public.organizations (name, created_by)
        VALUES (v_name, COALESCE(v_company.owner_id, v_company.id))
        RETURNING id INTO v_org_id;

        UPDATE public.companies
           SET organization_id = v_org_id
         WHERE id = v_company.id;

        INSERT INTO public.organization_members
            (organization_id, user_id, role, status, accepted_at, created_by)
        VALUES
            (v_org_id, COALESCE(v_company.owner_id, v_company.id), 'owner', 'active', now(),
             COALESCE(v_company.owner_id, v_company.id))
        ON CONFLICT DO NOTHING;
    END LOOP;
END $$;

-- Trava: nenhuma linha pode ter sobrado sem organizacao. Falha alto se sobrou.
DO $$
DECLARE
    v_orphans bigint;
BEGIN
    SELECT count(*) INTO v_orphans FROM public.companies WHERE organization_id IS NULL;
    IF v_orphans > 0 THEN
        RAISE EXCEPTION 'F13 Fase 1: % companies sem organization_id apos o backfill', v_orphans;
    END IF;
END $$;

-- So AGORA o NOT NULL. O trigger trg_company_autoprovision_organization (Fase 0) garante que
-- handle_new_user e o onboarding continuem funcionando dai em diante.
ALTER TABLE public.companies ALTER COLUMN organization_id SET NOT NULL;

-- ============================================================================
-- DOWN (rollback) — SO e seguro enquanto nenhuma organizacao tiver 2+ unidades:
--   ALTER TABLE public.companies ALTER COLUMN organization_id DROP NOT NULL;
--   -- conferir o marcador antes de apagar:
--   --   SELECT organization_id, count(*) FROM public.companies
--   --    GROUP BY 1 HAVING count(*) > 1;   -- precisa devolver ZERO linhas
--   UPDATE public.companies SET organization_id = NULL;
--   DELETE FROM public.organization_members;   -- so linhas do backfill existem nesta janela
--   DELETE FROM public.organizations;
-- ============================================================================
