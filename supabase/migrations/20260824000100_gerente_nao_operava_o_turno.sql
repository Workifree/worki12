-- Migration: o gerente de unidade enxergava tudo e nao conseguia operar nada
--
-- ACHADO (24/08/2026, usando o produto como GERENTE): entrei na tela "Presenca e Pagamento" do
-- turno da unidade que ele opera, clique em CONFIRMAR CHEGADA, e nada aconteceu. Nenhum erro no
-- console, nenhum toast: o botao simplesmente continuou la. No banco,
-- `company_checkin_confirmed_at` seguia nulo.
--
-- CAUSA: a policy de UPDATE de `applications` nao passa pelo seam de autorizacao --
--     job_id IN (SELECT jobs.id FROM jobs WHERE jobs.company_id = auth.uid())
-- Essa e a ancora ANTIGA, de quando "empresa" era sempre o proprio usuario logado. Ela nao
-- conhece nem a ancoragem dupla (`companies.owner_id`) nem o vinculo de gerente
-- (`company_members`). O UPDATE nao da erro: a RLS filtra e devolve ZERO linhas, em silencio.
--
-- QUAO GRAVE: confirmar presenca e O gesto diario do produto -- a tela se chama "PRESENCA E
-- PAGAMENTO". Sem esse UPDATE o gerente tambem nao confirma saida, nao conclui o turno e nao
-- dispensa ninguem. Ele via os 12 turnos, o elenco e os chamados, e nao podia tocar em nada.
-- Pior que um erro: um botao que aceita o clique e nao faz nada.
--
-- `is_job_owner(job_id)` ja delega para `is_company_owner(j.company_id)`, que conhece as tres
-- formas de operar a empresa. Conferido em producao ANTES desta migration: para este gerente,
-- `is_job_owner('<turno da unidade>')` ja devolvia true -- o seam estava certo, quem nao o usava
-- era a policy.
--
-- SEGUNDO ALVO, mesma causa: `can_access_application` (chat) repete a ancoragem dupla na mao, sem
-- passar pelo seam. Resultado: o gerente que opera o turno nao consegue abrir a conversa com o
-- freela daquele turno. Passa a delegar tambem -- os dois helpers do chat
-- (`can_access_conversation` chama este) ficam corretos de uma vez.
--
-- ESCOPO DELIBERADO: as policies LEGADAS duplicadas de `Conversation`/`Message` (que repetem a
-- ancora antiga inline) NAO sao tocadas aqui. Policies permissivas se combinam por OR, entao elas
-- so ADICIONAM acesso a quem ja tinha -- nao bloqueiam ninguem e nao mascaram esta correcao.
-- Remove-las e limpeza, com risco proprio, e merece migration separada.
--
-- `notifications_insert_self_or_connected` tambem usa a ancora antiga. Fica de fora por decisao:
-- desde 20260816140000 as notificacoes de contraparte nascem de triggers SECURITY DEFINER, que
-- nao passam por essa policy. Anotado como divida, nao corrigido as cegas.
--
-- Article 8: nao toca saldo.

-- ---------------------------------------------------------------------------
-- 1. applications: UPDATE da empresa passa a usar o seam
-- ---------------------------------------------------------------------------
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_policies
         WHERE schemaname='public' AND tablename='applications'
           AND policyname='Companies can update their job application fields'
    ) THEN
        RAISE EXCEPTION
          'ASSERCAO: a policy alvo nao existe mais em applications. Alguem ja mexeu nisso -- '
          'reconferir antes de recriar, para nao ressuscitar regra vencida.';
    END IF;
END $$;

DROP POLICY "Companies can update their job application fields" ON public.applications;

CREATE POLICY "Companies can update their job application fields"
    ON public.applications
    FOR UPDATE
    USING (public.is_job_owner(job_id))
    WITH CHECK (public.is_job_owner(job_id));

-- ---------------------------------------------------------------------------
-- 2. chat: o helper delega ao seam em vez de repetir a ancoragem na mao
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.can_access_application(p_application_id text)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_uid uuid := auth.uid();
BEGIN
    IF v_uid IS NULL OR p_application_id IS NULL THEN
        RETURN false;
    END IF;

    RETURN EXISTS (
        SELECT 1
          FROM public.applications a
          LEFT JOIN public.jobs j ON j.id = a.job_id
         WHERE a.id::text = p_application_id
           AND (
                 a.worker_id = v_uid
                 -- Antes: `j.company_id = v_uid OR j.company_id IN (companies WHERE owner_id = v_uid)`.
                 -- A ancoragem dupla escrita a mao nao conhecia gerente de unidade; o seam conhece.
                 OR public.is_company_owner(j.company_id)
               )
    );
END;
$$;

COMMENT ON FUNCTION public.can_access_application(text) IS
    'Quem pode ver/participar da conversa de uma application: o proprio freela, ou quem OPERA a '
    'empresa do turno (dono direto, dono via companies.owner_id, ou gerente ativo em '
    'company_members) -- tudo via is_company_owner. Ate 20260824000100 repetia a ancoragem dupla '
    'na mao e deixava o gerente de fora do chat da unidade que ele opera.';

-- ============================================================================
-- VERIFICACAO (com um gerente real na sessao):
--   SET LOCAL role authenticated;
--   SET LOCAL request.jwt.claims TO '{"sub":"<uid do gerente>","role":"authenticated"}';
--   UPDATE public.applications SET company_checkin_confirmed_at = now()
--    WHERE job_id = '<turno da unidade>' RETURNING id;   -- ESPERADO: 1 linha (antes: 0)
--   SELECT public.can_access_application('<application_uuid>');  -- ESPERADO: true
-- DOWN: recriar a policy com o predicado antigo e restaurar o corpo anterior do helper -- mas
--       isso volta a trancar o gerente para fora da propria unidade.
-- ============================================================================
