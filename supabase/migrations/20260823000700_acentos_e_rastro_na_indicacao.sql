-- Migration: as notificacoes do F10 (indicacao entre empresas) saem sem acento
--
-- ACHADO (23/08/2026, exercitando o F10 no browser): a indicacao chega ao freela como
--     "Voce foi indicado — Bar do QA indicou voce para QA Restaurante Claude."
-- Todas as outras notificacoes do produto sao acentuadas ("Confirma seu turno de 28/08?",
-- "Pagamento registrado — confirme", "Freela entrou no seu elenco"). So esta familia destoa, e
-- ela e a primeira coisa que o freela le sobre uma feature que depende de confianca.
--
-- Aproveita para dar rastro ao `EXCEPTION WHEN OTHERS THEN RETURN NEW` do fim: mesma politica de
-- notify_new_message (20260823000600) -- notificacao nunca derruba a transacao, mas tambem nao
-- desaparece sem dizer por que. Um handler mudo identico escondeu, nesta mesma sessao, um
-- `text = uuid` que impedia TODA notificacao de mensagem desde sempre.
--
-- Nenhuma mudanca de logica: mesmos ramos, mesmos destinatarios, mesmos links.
--
-- Article 8: nao toca saldo.

CREATE OR REPLACE FUNCTION public.notify_on_worker_referral()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_referring_name  text;
    v_requesting_name text;
    v_worker_name     text;
    v_referring_user  uuid;
    v_requesting_user uuid;
BEGIN
    SELECT c.name, coalesce(c.owner_id, c.id) INTO v_referring_name, v_referring_user
      FROM public.companies c WHERE c.id = NEW.referring_company_id;
    SELECT c.name, coalesce(c.owner_id, c.id) INTO v_requesting_name, v_requesting_user
      FROM public.companies c WHERE c.id = NEW.requesting_company_id;

    IF TG_OP = 'INSERT' THEN
        INSERT INTO public.notifications (user_id, type, title, message, link)
        VALUES (
            NEW.worker_id,
            'status_change',
            'Você foi indicado',
            coalesce(v_referring_name, 'Uma empresa do seu elenco')
                || ' indicou você para ' || coalesce(v_requesting_name, 'outra empresa')
                || '. Quer se conectar?',
            '/indicacoes'
        );
        RETURN NEW;
    END IF;

    IF OLD.status <> 'awaiting_worker' OR NEW.status = 'awaiting_worker' THEN
        RETURN NEW;
    END IF;

    IF NEW.status = 'accepted' THEN
        SELECT w.full_name INTO v_worker_name FROM public.workers w WHERE w.id = NEW.worker_id;
        INSERT INTO public.notifications (user_id, type, title, message, link)
        VALUES (
            v_requesting_user,
            'status_change',
            'Indicação aceita',
            coalesce(v_worker_name, 'Um freela')
                || ' aceitou a indicação de ' || coalesce(v_referring_name, 'outra empresa')
                || ' e agora faz parte do seu elenco.',
            '/company/team'
        );
    END IF;

    IF NEW.status = 'cancelled' THEN
        INSERT INTO public.notifications (user_id, type, title, message, link)
        VALUES (
            NEW.worker_id,
            'status_change',
            'Indicação retirada',
            coalesce(v_referring_name, 'A empresa') || ' retirou a indicação. Nada muda para '
                || 'você — você continua no elenco de sempre.',
            '/indicacoes'
        );
    ELSE
        INSERT INTO public.notifications (user_id, type, title, message, link)
        VALUES (
            v_referring_user,
            'status_change',
            'Indicação finalizada',
            'A indicação que você enviou não está mais pendente.',
            '/company/indicacoes'
        );
    END IF;

    RETURN NEW;
EXCEPTION WHEN OTHERS THEN
    -- Nunca derrubar a transacao da indicacao por causa da notificacao -- mas deixar rastro.
    RAISE WARNING 'notify_on_worker_referral falhou (indicacao %, op %): % %',
                  NEW.id, TG_OP, SQLSTATE, SQLERRM;
    RETURN NEW;
END;
$$;

COMMENT ON FUNCTION public.notify_on_worker_referral() IS
    'Notificacoes do F10 (indicacao entre empresas), nos quatro eventos: criada, aceita, retirada '
    'e finalizada. Texto acentuado desde 20260823000700 -- ate entao era a unica familia de '
    'notificacao do produto sem acento. O EXCEPTION WHEN OTHERS emite RAISE WARNING antes de '
    'deixar passar (mesmo padrao de notify_new_message).';
