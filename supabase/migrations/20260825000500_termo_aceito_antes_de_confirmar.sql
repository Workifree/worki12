-- Migration: débito #6 — o aceite do termo era garantia de UI, não do banco
--
-- Nada em `shift_payments` exigia `service_terms.accepted_at` preenchido antes de
-- `worker_confirmed_at`: `confirmReceiptByWorker` é um `.update()` direto. O acoplamento entre
-- "aceitar o termo" e "confirmar o recebimento" vivia inteiro no componente React
-- (`ServiceTermSection`).
--
-- Consequência: qualquer caminho que não passe por aquele componente -- client alternativo, chamada
-- direta ao PostgREST, script de suporte, ou uma regressão futura na UI -- gravava a confirmação com
-- o termo pendente.
--
-- POR QUE IMPORTA: a feature existe para ser PROVA. Prova que depende de o front estar correto é
-- mais fraca do que o produto promete ao usar a palavra "termo". O recibo diz "aceite eletrônico
-- registrado pela plataforma" -- essa frase precisa ser verdade mesmo quando o front não está no
-- caminho.
--
-- A CONDIÇÃO É "EXISTE TERMO E NÃO FOI ACEITO", NUNCA "NÃO EXISTE TERMO ACEITO":
-- A segunda formulação travaria todo turno legado cujo pagamento nasceu antes de o termo existir --
-- e há 4 desses em produção hoje, nenhum com linha em `service_terms`. Eles continuam podendo ser
-- confirmados normalmente; a guarda só fala quando há um termo esperando assinatura.
--
-- Article 8: não toca saldo.

CREATE OR REPLACE FUNCTION public.enforce_term_accepted_before_confirm()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
    -- Só interessa a transição "freela ainda não confirmou" -> "confirmou".
    IF NEW.worker_confirmed_at IS NULL OR OLD.worker_confirmed_at IS NOT NULL THEN
        RETURN NEW;
    END IF;

    IF EXISTS (
        SELECT 1 FROM public.service_terms st
         WHERE st.shift_payment_id = NEW.id
           AND st.accepted_at IS NULL
    ) THEN
        RAISE EXCEPTION
            'Confirmação de recebimento bloqueada: existe termo de prestação pendente de aceite '
            'para este pagamento. Aceite o termo primeiro (RPC accept_service_term).'
            USING ERRCODE = 'check_violation';
    END IF;

    RETURN NEW;
END;
$$;

COMMENT ON FUNCTION public.enforce_term_accepted_before_confirm() IS
    'Recusa worker_confirmed_at enquanto houver service_terms pendente para o pagamento. A condição '
    'é "existe termo E não aceito" -- nunca "não existe termo aceito", que travaria os pagamentos '
    'legados sem termo. Fecha o débito pré-piloto #6: o acoplamento vivia só no React.';

DROP TRIGGER IF EXISTS trg_enforce_term_accepted_before_confirm ON public.shift_payments;
CREATE TRIGGER trg_enforce_term_accepted_before_confirm
    BEFORE UPDATE OF worker_confirmed_at ON public.shift_payments
    FOR EACH ROW
    EXECUTE FUNCTION public.enforce_term_accepted_before_confirm();
