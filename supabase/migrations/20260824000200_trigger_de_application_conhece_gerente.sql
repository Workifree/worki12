-- Migration: o trigger de validacao de `applications` tambem nao conhecia o gerente
--
-- Complemento imediato de 20260824000100. Depois de rotear a POLICY pelo seam, o UPDATE do
-- gerente parou de ser filtrado em silencio -- e passou a ser barrado com mensagem:
--     P0001: Usuario nao autorizado a atualizar esta candidatura
--            CONTEXT: PL/pgSQL function public.validate_application_update() line 68
--
-- Ou seja: havia DUAS camadas com a mesma ancora antiga. Corrigir so a policy trocaria falha
-- muda por falha ruidosa, sem destravar o gerente. (Que a segunda camada exista e bom: e defesa
-- em profundidade de verdade, nao redundancia decorativa.)
--
-- CAUSA, uma linha:
--     v_is_company := EXISTS(SELECT 1 FROM public.jobs WHERE id = NEW.job_id AND company_id = auth.uid());
-- Ancora unica em `auth.uid()`: ignora `companies.owner_id` e ignora `company_members`. Passa a
-- delegar a `is_job_owner(NEW.job_id)`, que ja resolve as tres formas de operar a empresa.
--
-- Nada mais do corpo muda: as restricoes do worker (nao mexe em confirmacao da empresa, nao
-- finaliza, nao se auto-contrata fora do aceite de convite), as da empresa (nao mexe em checkin
-- nem checkout do worker), os campos imutaveis e o bloqueio final de terceiros seguem identicos.
-- O gerente entra exatamente pela porta da EMPRESA, com as mesmas restricoes dela -- inclusive a
-- de nao poder falsificar o ponto do freela.
--
-- METODO: le a definicao do catalogo e troca a linha, com assercao. O corpo tem ~70 linhas de
-- regra de negocio; retranscrever para mudar uma atribuicao seria trocar um bug por uma chance
-- de erro de copia.
--
-- Article 8: nao toca saldo.

DO $$
DECLARE
    v_def text;
    v_de  text := 'v_is_company := EXISTS(SELECT 1 FROM public.jobs WHERE id = NEW.job_id AND company_id = auth.uid());';
    v_para text := 'v_is_company := public.is_job_owner(NEW.job_id);';
BEGIN
    v_def := pg_get_functiondef('public.validate_application_update()'::regprocedure);

    IF position(v_de IN v_def) = 0 THEN
        RAISE EXCEPTION
          'ASSERCAO: a linha de autorizacao da empresa nao esta como esperado em '
          'validate_application_update. A funcao mudou -- reconferir antes de reescrever.';
    END IF;

    EXECUTE replace(v_def, v_de, v_para);
END $$;

COMMENT ON FUNCTION public.validate_application_update() IS
    'Valida transicoes de `applications` por papel. Quem e "a empresa" vem de is_job_owner() '
    '(dono direto, dono via companies.owner_id, ou gerente ativo em company_members) -- ate '
    '20260824000200 era `jobs.company_id = auth.uid()` cru, e o gerente de unidade era barrado '
    'aqui mesmo depois de a policy liberar. Gerente opera com as MESMAS restricoes da empresa, '
    'inclusive a de nao poder alterar checkin/checkout do freela.';

-- ============================================================================
-- VERIFICACAO (com um gerente real na sessao):
--   UPDATE public.applications SET company_checkin_confirmed_at = now()
--    WHERE job_id = '<turno da unidade>';        -- ESPERADO: 1 linha, sem excecao
--   UPDATE public.applications SET worker_checkin_at = now()
--    WHERE job_id = '<turno da unidade>';        -- ESPERADO: excecao (empresa nao falsifica ponto)
-- ============================================================================
