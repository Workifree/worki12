-- Migration: notificar o convite de elenco — nos DOIS sentidos
--
-- ACHADO (23/08/2026, usando o produto no browser): a empresa convida um freela para o Elenco, o
-- convite aparece corretamente em "Carteira de Clientes" com ACEITAR/RECUSAR — e o freela **nao
-- recebe aviso nenhum**. `/notifications` fica vazio e o dashboard dele diz "Voce ainda nao tem
-- empresas na sua carteira", sem mencionar que ha convite esperando. Conferido no banco: ZERO
-- linhas em `notifications` para o freela convidado.
--
-- POR QUE ISSO IMPORTA MAIS QUE PARECE: montar o Elenco e o PRIMEIRO passo do produto — sem
-- elenco nao ha convite de turno, nao ha chamado 1->N, nao ha nada. O fluxo inteiro comeca com um
-- convite que hoje e silencioso. A empresa convida e espera; o freela nunca soube.
--
-- O projeto ja tinha SEIS funcoes de notificacao (`notify_worker_on_shift_payment`,
-- `notify_counterpart_on_application_cancel`, `notify_new_message`, `notify_on_worker_referral`,
-- `notify_worker_on_attendance_request`, `notify_certification_expiries`) e nenhuma para o passo
-- que abre o funil. `team_connections` nao tinha gatilho de notificacao algum.
--
-- DOIS SENTIDOS, de proposito:
--   (a) empresa convida  -> avisa o FRELA   (ele precisa saber que ha algo a responder)
--   (b) freela aceita    -> avisa a EMPRESA (ela convidou e ficou esperando; hoje so descobre
--                           reabrindo a tela do Elenco)
-- A recusa NAO gera aviso a empresa: recusa e neutra por decisao de produto (mesma regra de
-- `decline_shift_call`), e transformar "nao" em notificacao cria pressao sobre quem recusou.
--
-- SECURITY DEFINER e obrigatorio aqui, e nao e detalhe: a policy de INSERT em `notifications`
-- exige vinculo ACEITO entre as partes. No momento (a) o vinculo e 'pending' — exatamente o
-- estado em que a empresa NAO tem permissao de escrever para o freela. Um INSERT feito pelo
-- client seria negado em silencio, e a notificacao mais importante do funil e justamente a que
-- nao poderia ser criada. Mesmo argumento ja registrado para
-- `notify_worker_on_shift_payment` (20260816140000): notificacao a contraparte e garantia do
-- produto, nao cortesia da UI.
--
-- `type` = 'status_change' (unico valor do CHECK que cabe: nao e mensagem nem pagamento, e
-- 'system' e para avisos da plataforma, nao de contraparte).
--
-- Article 8: nao toca saldo.

CREATE OR REPLACE FUNCTION public.notify_on_team_connection()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_empresa text;
    v_freela  text;
BEGIN
    -- (a) CONVITE: empresa -> freela
    IF TG_OP = 'INSERT' AND NEW.status = 'pending' THEN
        SELECT coalesce(nullif(btrim(c.name), ''), 'Uma empresa') INTO v_empresa
          FROM public.companies c WHERE c.id = NEW.company_id;

        INSERT INTO public.notifications (user_id, type, title, message, link)
        VALUES (
            NEW.worker_id,
            'status_change',
            'Convite para o elenco',
            v_empresa || ' quer te adicionar ao elenco. Aceitando, voce passa a receber os '
                      || 'convites de turno dessa empresa direto, sem precisar se candidatar.',
            '/carteira'
        );
        RETURN NEW;
    END IF;

    -- (b) ACEITE: freela -> empresa. So na transicao para 'accepted' (nao em toda edicao da linha).
    IF TG_OP = 'UPDATE' AND NEW.status = 'accepted' AND OLD.status IS DISTINCT FROM 'accepted' THEN
        SELECT coalesce(nullif(btrim(w.full_name), ''), 'Um freela') INTO v_freela
          FROM public.workers w WHERE w.id = NEW.worker_id;

        INSERT INTO public.notifications (user_id, type, title, message, link)
        VALUES (
            NEW.company_id,
            'status_change',
            'Freela entrou no seu elenco',
            v_freela || ' aceitou seu convite e ja pode ser chamado para turnos.',
            '/company/team'
        );
        RETURN NEW;
    END IF;

    -- Recusa e bloqueio nao notificam: recusa e neutra (mesma regra de decline_shift_call) e
    -- bloqueio e veto do freela — avisar a empresa transformaria os dois em cobranca.
    RETURN NEW;
END;
$$;

COMMENT ON FUNCTION public.notify_on_team_connection() IS
    'Notifica o convite de elenco nos dois sentidos: freela ao ser convidado, empresa ao ser '
    'aceita. DEFINER porque no convite o vinculo ainda e `pending` — estado em que a policy de '
    'notifications NAO deixa a empresa escrever para o freela, e o INSERT do client seria negado '
    'em silencio. Recusa/bloqueio nao notificam de proposito. Ver 20260823000200.';

DROP TRIGGER IF EXISTS trg_notify_on_team_connection_insert ON public.team_connections;
CREATE TRIGGER trg_notify_on_team_connection_insert
    AFTER INSERT ON public.team_connections
    FOR EACH ROW
    WHEN (NEW.status = 'pending')
    EXECUTE FUNCTION public.notify_on_team_connection();

DROP TRIGGER IF EXISTS trg_notify_on_team_connection_accept ON public.team_connections;
CREATE TRIGGER trg_notify_on_team_connection_accept
    AFTER UPDATE OF status ON public.team_connections
    FOR EACH ROW
    WHEN (NEW.status = 'accepted' AND OLD.status IS DISTINCT FROM 'accepted')
    EXECUTE FUNCTION public.notify_on_team_connection();

-- ============================================================================
-- VERIFICACAO (bloco com ROLLBACK proposital):
-- DO $$
-- DECLARE v_c uuid; v_w uuid; v_n1 int; v_n2 int;
-- BEGIN
--     SELECT id INTO v_c FROM public.companies LIMIT 1;
--     SELECT id INTO v_w FROM public.workers   LIMIT 1;
--     INSERT INTO public.team_connections (company_id, worker_id, status, source)
--     VALUES (v_c, v_w, 'pending', 'phone');
--     SELECT count(*) INTO v_n1 FROM public.notifications WHERE user_id = v_w;
--     UPDATE public.team_connections SET status='accepted'
--      WHERE company_id=v_c AND worker_id=v_w;
--     SELECT count(*) INTO v_n2 FROM public.notifications WHERE user_id = v_c;
--     RAISE EXCEPTION 'ROLLBACK: notificacoes freela=% empresa=% (esperado >=1 cada)', v_n1, v_n2;
-- END $$;
-- DOWN:
--   DROP TRIGGER IF EXISTS trg_notify_on_team_connection_insert ON public.team_connections;
--   DROP TRIGGER IF EXISTS trg_notify_on_team_connection_accept ON public.team_connections;
--   DROP FUNCTION IF EXISTS public.notify_on_team_connection();
-- ============================================================================
