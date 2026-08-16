-- Migration: corrige acentuacao das mensagens de notificacao de pagamento
-- File: supabase/migrations/20260816201322_notify_worker_shift_payment_acentos.sql
--
-- Contexto: ao aplicar 20260816140000 via MCP, os acentos das mensagens foram removidos por
-- engano no transporte. Essas strings vao para o SINO DO FREELA — sao texto de produto, nao
-- comentario. Esta migration reaplica a funcao com o texto correto em pt-BR.
--
-- Nenhuma mudanca de logica: apenas o conteudo das mensagens. Triggers inalterados.
-- Article 8 intacto (nao move saldo).
--
-- DOWN (rollback): reaplicar 20260816140000_notify_worker_on_shift_payment.sql

CREATE OR REPLACE FUNCTION public.notify_worker_on_shift_payment()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_company_name text;
    v_job_title    text;
    v_amount       text;
    v_title        text;
    v_message      text;
    v_link         text;
BEGIN
    SELECT c.name INTO v_company_name FROM public.companies c WHERE c.id = NEW.company_id;
    SELECT j.title INTO v_job_title FROM public.jobs j WHERE j.id = NEW.job_id;

    v_company_name := COALESCE(v_company_name, 'A empresa');
    v_job_title    := COALESCE(v_job_title, 'sem título');
    v_amount       := replace(to_char(NEW.amount, 'FM9999999990.00'), '.', ',');

    IF TG_OP = 'INSERT' THEN
        IF NEW.status = 'scheduled' THEN
            v_title   := 'Pagamento agendado';
            v_message := v_company_name || ' agendou o pagamento de R$ ' || v_amount ||
                         ' do turno "' || v_job_title || '" para ' ||
                         to_char(NEW.scheduled_for, 'DD/MM/YYYY') ||
                         '. Você não precisa fazer nada agora.';
            v_link    := '/recibo/' || NEW.job_id::text;
        ELSIF NEW.status = 'recorded' THEN
            v_title   := 'Pagamento registrado — confirme';
            v_message := v_company_name || ' registrou o pagamento de R$ ' || v_amount ||
                         ' do turno "' || v_job_title ||
                         '". Abra o recibo e confirme se você recebeu.';
            v_link    := '/recibo/' || NEW.job_id::text;
        ELSE
            RETURN NEW;
        END IF;
    ELSE
        IF OLD.status = 'scheduled' AND NEW.status = 'recorded' THEN
            v_title   := 'Pagamento efetivado — confirme';
            v_message := v_company_name || ' marcou como pago o valor de R$ ' || v_amount ||
                         ' do turno "' || v_job_title ||
                         '". Abra o recibo e confirme se você recebeu.';
            v_link    := '/recibo/' || NEW.job_id::text;
        ELSIF NEW.status = 'voided' AND OLD.status = 'scheduled' THEN
            v_title   := 'Agendamento de pagamento cancelado';
            v_message := v_company_name || ' cancelou o agendamento do pagamento de R$ ' ||
                         v_amount || ' do turno "' || v_job_title ||
                         '". Procure a empresa para combinar o pagamento.';
            v_link    := '/recebimentos';
        ELSIF NEW.status = 'voided' AND OLD.status = 'recorded' THEN
            v_title   := 'Registro de pagamento estornado';
            v_message := v_company_name || ' estornou o registro de pagamento de R$ ' ||
                         v_amount || ' do turno "' || v_job_title ||
                         '". Se você já recebeu, procure a empresa.';
            v_link    := '/recebimentos';
        ELSE
            RETURN NEW;
        END IF;
    END IF;

    INSERT INTO public.notifications (user_id, type, title, message, link, read_at, created_at)
    VALUES (NEW.worker_id, 'payment', v_title, v_message, v_link, NULL, now());

    RETURN NEW;
EXCEPTION WHEN OTHERS THEN
    RETURN NEW;
END;
$$;
