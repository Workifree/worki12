-- Migration: `job_categories` passa a listar SETORES do pivo, nao do marketplace de tecnologia
--
-- ACHADO (22/08/2026, cadastrando uma empresa no browser): o campo obrigatorio "SETOR *" do
-- primeiro acesso oferecia apenas **Desenvolvimento, Design, Marketing, Vendas, Suporte** — o seed
-- de 27/01/2026, de quando o Worki ainda era marketplace de freela de tecnologia.
--
-- Efeito: o cliente do piloto — restaurante, bar, buffet, academia — **nao tem onde se encaixar**
-- num campo que o formulario exige. Ao testar, tive de cadastrar um restaurante como "Suporte".
-- E o dado ruim nao fica so no cadastro: `companies.industry` aparece no perfil publico que o
-- freela le ANTES de aceitar um convite (`/empresa/:id`), que e justamente a prova social que o
-- fluxo push depende para funcionar.
--
-- ESCOPO, conferido antes de mexer: `job_categories` e lida por UM unico lugar —
-- `CompanyOnboarding.tsx:47`. A criacao de turno usa outra lista, `SHIFT_CATEGORIES`
-- (`components/company/shiftCategories.ts`), que ja esta no vocabulario certo. Sao dois EIXOS
-- diferentes e continuam separados: aqui e "que negocio a empresa e", la e "que funcao o turno
-- pede". Nao unifiquei os dois de proposito.
--
-- QUEM JA SE CADASTROU NAO E AFETADO: `companies.industry` guarda o NOME em texto, e o
-- `CompanyOnboarding` so roda no primeiro acesso (`onboarding_completed = false`). Os valores
-- existentes ('Desenvolvimento', 'Vendas', 'Varejo', 'Suporte', 'Desenvolvimento de sistemas ')
-- continuam intactos e visiveis no perfil. Nenhum deles e reescrito por esta migration —
-- reescrever seria decidir pelo dono da empresa qual e o negocio dele.
--
-- Article 8: nao toca saldo.

-- Guarda: se alguem tiver criado FK para esta tabela desde o seed, o DELETE abaixo derrubaria
-- dado alheio. Falha fechado.
DO $$
DECLARE v_deps text;
BEGIN
    SELECT string_agg(format('%I.%I', ns.nspname, cl.relname), ', ') INTO v_deps
    FROM pg_constraint con
    JOIN pg_class cl ON cl.oid = con.conrelid
    JOIN pg_namespace ns ON ns.oid = cl.relnamespace
    WHERE con.contype = 'f' AND con.confrelid = 'public.job_categories'::regclass;

    IF v_deps IS NOT NULL THEN
        RAISE EXCEPTION
          'ASSERCAO: job_categories ganhou dependente(s) por FK desde o seed: %. Trocar as linhas '
          'apagaria referencia viva. HALT -> architect.', v_deps;
    END IF;
END $$;

DELETE FROM public.job_categories;

INSERT INTO public.job_categories (name, slug) VALUES
    ('Restaurante',                'restaurante'),
    ('Bar / Pub / Choperia',       'bar'),
    ('Cafeteria / Padaria',        'cafeteria'),
    ('Fast-food / Delivery',       'fastfood'),
    ('Eventos / Buffet',           'eventos'),
    ('Hotelaria / Pousada',        'hotelaria'),
    ('Academia / Estudio',         'academia'),
    ('Supermercado / Varejo',      'varejo'),
    ('Outro',                      'outro');

COMMENT ON TABLE public.job_categories IS
    'SETOR do negocio da empresa (restaurante, bar, buffet...), usado no primeiro acesso e exibido '
    'no perfil publico que o freela le antes de aceitar convite. NAO confundir com a funcao do '
    'turno: essa vive em SHIFT_CATEGORIES (frontend), e sao eixos diferentes de proposito. '
    'Corrigida em 20260823000100 — ate entao listava Desenvolvimento/Design/Marketing/Vendas/'
    'Suporte, seed do marketplace de tecnologia anterior ao pivo.';

-- ============================================================================
-- VERIFICACAO:
--   SELECT name, slug FROM public.job_categories ORDER BY name;   -- 9 setores do pivo
--   SELECT DISTINCT industry FROM public.companies;               -- valores antigos PRESERVADOS
-- DOWN: reinserir o seed antigo (Design/design, Desenvolvimento/dev, Vendas/sales,
--       Marketing/marketing, Suporte/support) — mas nao ha motivo: nenhuma empresa do pivo os usa.
-- ============================================================================
