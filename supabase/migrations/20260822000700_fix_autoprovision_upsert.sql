-- Migration: conserta o autoprovisionamento de organizacao no UPSERT de companies
--
-- 🔴 REGRESSAO INTRODUZIDA HOJE (22/08/2026) pela Fase 1 da F13, pega navegando o produto no
-- browser: **nenhuma empresa nova conseguia concluir o cadastro em producao.**
--
-- SINTOMA: no ultimo passo do onboarding a tela ficava parada, sem mensagem de erro, e a rede
-- devolvia:
--   HTTP 400  {"code":"23502","message":"null value in column \"organization_id\" of relation
--              \"companies\" violates not-null constraint"}
--
-- CAUSA. A Fase 1 tornou `companies.organization_id` NOT NULL e delegou o preenchimento ao trigger
-- BEFORE INSERT `trg_company_autoprovision_organization`. O trigger tinha esta guarda:
--
--     IF EXISTS (SELECT 1 FROM public.companies c WHERE c.id = NEW.id) THEN
--         RETURN NEW;      -- <== volta com organization_id AINDA NULL
--     END IF;
--
-- Ela existia para nao criar organizacao orfa quando um `INSERT ... ON CONFLICT DO NOTHING` fosse
-- descartado. O raciocinio estava certo para DO NOTHING e ERRADO para DO UPDATE.
--
-- `CompanyOnboarding` grava com `.upsert(...)`, que o PostgREST traduz para
-- `INSERT ... ON CONFLICT DO UPDATE`. A linha JA existe (foi criada por `handle_new_user` no
-- signup, e ai sim o trigger preencheu). No upsert o BEFORE INSERT dispara de novo, a guarda
-- encontra a linha, devolve `NEW` com `organization_id` NULL — e o NOT NULL e avaliado sobre a
-- TUPLA PROPOSTA, antes de o ON CONFLICT resolver. Estoura 23502 e o upsert inteiro morre.
--
-- Ou seja: a guarda protegia contra um caso hipotetico (DO NOTHING) e quebrava o caminho real
-- (DO UPDATE), que e por onde TODA empresa passa no cadastro.
--
-- CONSERTO. Em vez de desistir quando a linha existe, o trigger **herda** o `organization_id`
-- dela. A tupla proposta passa a chegar completa no NOT NULL, o ON CONFLICT resolve normalmente, e
-- nenhuma organizacao nova e criada — que era o objetivo legitimo da guarda original.
--
-- Tres casos, agora todos corretos:
--   (a) linha nova, sem organization_id  -> cria organizacao + membership owner (comportamento
--       original, intacto: e o que faz `handle_new_user` funcionar);
--   (b) linha JA existe (upsert do onboarding) -> herda o organization_id existente, NAO cria nada;
--   (c) NEW.organization_id ja veio preenchido -> respeita e sai (inalterado).
--
-- Article 8: nao toca saldo.

CREATE OR REPLACE FUNCTION public.autoprovision_company_organization()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_org_id uuid;
    v_name   text;
BEGIN
    -- (c) quem ja trouxe organizacao decide sozinho
    IF NEW.organization_id IS NOT NULL THEN
        RETURN NEW;
    END IF;

    -- (b) a linha JA existe: este INSERT e a metade "proposta" de um upsert. HERDA em vez de
    --     desistir. Devolver NULL aqui era a regressao: o NOT NULL e checado sobre a tupla
    --     proposta, ANTES do ON CONFLICT, entao o upsert inteiro morria com 23502.
    SELECT c.organization_id INTO v_org_id
      FROM public.companies c
     WHERE c.id = NEW.id;

    IF v_org_id IS NOT NULL THEN
        NEW.organization_id := v_org_id;
        RETURN NEW;
    END IF;

    -- (a) linha realmente nova: provisiona organizacao propria e o dono como owner ativo.
    -- ATENCAO: `organizations.name` tem CHECK length(trim(name)) > 0 e `companies.name` NASCE
    -- COMO '' em handle_new_user. Um NULLIF direto devolveria NULL e violaria o NOT NULL no
    -- primeiro signup — dai o rotulo de fallback. A conta-mae renomeia depois na UI.
    v_name := NULLIF(trim(COALESCE(NEW.name, '')), '');
    IF v_name IS NULL THEN
        v_name := 'Organizacao ' || left(NEW.id::text, 8);
    END IF;

    INSERT INTO public.organizations (name, created_by)
    VALUES (v_name, COALESCE(NEW.owner_id, NEW.id))
    RETURNING id INTO v_org_id;

    INSERT INTO public.organization_members
        (organization_id, user_id, role, status, accepted_at, created_by)
    VALUES
        (v_org_id, COALESCE(NEW.owner_id, NEW.id), 'owner', 'active', now(),
         COALESCE(NEW.owner_id, NEW.id));

    NEW.organization_id := v_org_id;
    RETURN NEW;
END;
$$;

COMMENT ON FUNCTION public.autoprovision_company_organization() IS
    'BEFORE INSERT em companies: toda unidade nova nasce dentro de uma organizacao propria, com o '
    'dono como organization_members owner ativo. Quando a linha JA existe (metade proposta de um '
    'UPSERT), HERDA o organization_id existente em vez de devolver NULL — devolver NULL quebrava '
    'o onboarding da empresa com 23502, porque o NOT NULL e avaliado antes do ON CONFLICT '
    '(regressao de 22/08, corrigida em 20260822000700). NAO toca saldo (Article 8).';

-- ============================================================================
-- VERIFICACAO (bloco com ROLLBACK proposital) — reproduz o caminho que quebrava:
--   1. cria auth.users + companies (handle_new_user faz isso no signup real);
--   2. faz o MESMO upsert que o CompanyOnboarding faz, sem organization_id;
--   3. confere que passou e que NAO nasceu organizacao duplicada.
--
-- DO $$
-- DECLARE v_id uuid := gen_random_uuid(); v_orgs_antes int; v_orgs_depois int; v_org uuid;
-- BEGIN
--     SELECT count(*) INTO v_orgs_antes FROM public.organizations;
--     INSERT INTO auth.users (id, instance_id, aud, role, email, encrypted_password, created_at,
--                             updated_at, raw_app_meta_data, raw_user_meta_data)
--     VALUES (v_id,'00000000-0000-0000-0000-000000000000','authenticated','authenticated',
--             'upsert-'||left(v_id::text,8)||'@invalido.local','',now(),now(),'{}','{"user_type":"hire"}');
--     INSERT INTO public.companies (id, name, owner_id) VALUES (v_id, '', v_id);
--     -- o upsert do onboarding (sem organization_id):
--     INSERT INTO public.companies (id, name, city, onboarding_completed)
--     VALUES (v_id, 'Teste Upsert', 'Sao Paulo', true)
--     ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name, city = EXCLUDED.city,
--                                    onboarding_completed = EXCLUDED.onboarding_completed;
--     SELECT organization_id INTO v_org FROM public.companies WHERE id = v_id;
--     SELECT count(*) INTO v_orgs_depois FROM public.organizations;
--     RAISE EXCEPTION 'ROLLBACK: upsert OK, org=%, organizacoes criadas=% (esperado 1)',
--                     v_org, v_orgs_depois - v_orgs_antes;
-- END $$;
-- ============================================================================
