-- Migration: o gerente agendava o pagamento e nao conseguia efetivar
--
-- ACHADO (24/08/2026, seguindo o fluxo como GERENTE): agendou o pagamento (status 'scheduled',
-- paid_at nulo -- correto), e o clique em MARCAR COMO PAGO nao fez nada. Sem modal, sem erro no
-- console. Interceptando a rede: PATCH /rest/v1/shift_payments -> HTTP 400
--     P0001: shift_payments: usuario nao autorizado a atualizar este registro.
--
-- CAUSA, em `enforce_shift_payment_immutability`:
--     v_is_company := EXISTS (SELECT 1 FROM public.companies
--                              WHERE id = NEW.company_id AND owner_id = auth.uid());
-- Esta e a mais estreita das ancoras antigas: exige `owner_id`, entao nao cobre nem a empresa
-- cujo id E o proprio uid (caso comum na base), muito menos o gerente de unidade. Quem nao e nem
-- worker nem "company" cai no ELSE e recebe a excecao acima.
--
-- Terceira camada da mesma doenca nesta sessao, depois da policy de `applications` e do trigger
-- `validate_application_update` (20260824000100/000200). O padrao: cada guarda reescreveu a
-- pergunta "quem e a empresa?" na mao, em vez de perguntar ao seam.
--
-- A particao por papel continua identica -- inclusive a regra que impede a empresa de mexer em
-- `worker_confirmed_at` (a confirmacao e do freela). O gerente entra pela porta da empresa, com
-- as restricoes da empresa.
--
-- VARREDURA (feita ANTES de escrever, para nao achar isto de novo uma camada por vez): busquei em
-- TODAS as funcoes e policies do schema `public` as duas formas da ancora antiga
-- (`owner_id = auth.uid()` e `company_id = auth.uid()`) sem passar pelo seam. Sobram 19 policies
-- e 1 funcao, e nenhuma bloqueia o gerente hoje:
--   - Conversation/Message (5): duplicatas legadas. Policies permissivas se combinam por OR, e o
--     caminho moderno (can_access_application) ja foi corrigido em 20260824000100 -- elas so
--     somam acesso a quem ja tem.
--   - companies "Users can create their company" (1): `owner_id = auth.uid()` e o predicado
--     CORRETO ali -- voce cria a SUA empresa. Nao e ancora vencida.
--   - company_monthly_revenue (4) e company_spend_limits (4): tabelas sem nenhum consumidor no
--     frontend (so aparecem em types/index.ts). Nao ha tela para quebrar.
--   - payment_methods (4) e reserve_escrow (1): cartao on-file e escrow do Asaas, cujas edge
--     functions foram removidas na pausa de pagamento. Codigo morto.
--   - notifications_insert_self_or_connected (1): desde 20260816140000 as notificacoes de
--     contraparte nascem de triggers SECURITY DEFINER, que nao passam por policy.
-- Todas anotadas como divida consciente, nenhuma corrigida as cegas.
--
-- Article 8: nao toca saldo. `shift_payments` e registro declaratorio do modo A.

DO $$
DECLARE
    v_def   text;
    v_novo  text;
    -- Regex, nao literal: a fonte da funcao usa CRLF e a indentacao do arquivo original nao e
    -- reproduzivel de cabeca. A primeira tentativa desta migration falhou na assercao por isso --
    -- que e exatamente o servico que a assercao existe para prestar.
    v_padrao text := 'v_is_company\s*:=\s*EXISTS\s*\(\s*SELECT 1 FROM public\.companies\s+WHERE id = NEW\.company_id AND owner_id = auth\.uid\(\)\s*\);';
BEGIN
    v_def := pg_get_functiondef('public.enforce_shift_payment_immutability()'::regprocedure);

    IF v_def !~ v_padrao THEN
        RAISE EXCEPTION
          'ASSERCAO: a atribuicao de v_is_company nao esta como esperado em '
          'enforce_shift_payment_immutability. A funcao mudou -- reconferir antes de reescrever.';
    END IF;

    v_novo := regexp_replace(v_def, v_padrao,
                             'v_is_company := public.is_company_owner(NEW.company_id);');

    IF v_novo !~ 'is_company_owner\(NEW\.company_id\)' THEN
        RAISE EXCEPTION 'ASSERCAO: a substituicao nao produziu a chamada ao seam. HALT.';
    END IF;

    EXECUTE v_novo;
END $$;

COMMENT ON FUNCTION public.enforce_shift_payment_immutability() IS
    'Imutabilidade e particao por papel de `shift_payments` (modo A). Quem e "a empresa" vem de '
    'is_company_owner(NEW.company_id) -- dono direto, dono via owner_id, ou gerente ativo em '
    'company_members. Ate 20260824000300 exigia `owner_id = auth.uid()`, a mais estreita das '
    'ancoras antigas: o gerente agendava o pagamento e nao conseguia efetivar. A empresa continua '
    'impedida de tocar em worker_confirmed_at -- essa confirmacao e do freela.';

-- ============================================================================
-- VERIFICACAO (com um gerente real na sessao):
--   UPDATE public.shift_payments SET status='recorded', paid_at=now()
--    WHERE id='<pagamento scheduled da unidade>';   -- ESPERADO: 1 linha
--   UPDATE public.shift_payments SET worker_confirmed_at=now()
--    WHERE id='<mesmo pagamento>';                  -- ESPERADO: excecao (confirmacao e do freela)
-- ============================================================================
