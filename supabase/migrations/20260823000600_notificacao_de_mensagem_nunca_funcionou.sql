-- Migration: nenhuma mensagem de chat jamais gerou notificacao
--
-- ACHADO (23/08/2026, usando o produto): a empresa mandou mensagem para o freela pelo chat. A
-- mensagem foi gravada e aparece nas duas telas. O freela NAO recebeu notificacao nenhuma --
-- conferido no banco: zero linhas em `notifications` com type='message', para qualquer usuario.
--
-- CAUSA: `notify_new_message` (trigger AFTER INSERT em "Message") faz
--     SELECT c.application_uuid ... FROM "Conversation" c WHERE c.id = v_conv_id_text::uuid
-- e o comentario ao lado afirma "Conversation.id is UUID, so cast text to uuid for comparison".
-- `Conversation.id` e TEXT. O comentario esta errado sobre a propria tabela que a linha lê.
-- A comparacao vira `text = uuid` -> 42883 "operator does not exist" -> e cai no
--     EXCEPTION WHEN OTHERS THEN RETURN NEW
-- do fim da funcao, que existe (com razao) para nunca impedir o INSERT da mensagem. Resultado:
-- falha 100% silenciosa, em toda mensagem, desde que a funcao existe.
--
-- POR QUE IMPORTA: o chat e o unico canal entre empresa e freela fora do fluxo de convite. Sem
-- notificacao, a mensagem so chega se a pessoa abrir /messages por conta propria -- e o combinado
-- de um turno ("uniforme preto", "chega 30 min antes", "mudou o horario") depende disso.
--
-- DUAS MUDANCAS:
--   1. Compara text com text. Sem cast, sem suposicao sobre o tipo.
--   2. O handler de OTHERS deixa de ser mudo: passa a `RAISE WARNING` antes do RETURN NEW. A
--      politica de nunca derrubar o INSERT da mensagem esta certa e continua; o que estava errado
--      era engolir o motivo. Um WARNING no log do Postgres teria denunciado isso no primeiro dia.
--
-- Article 8: nao toca saldo.

CREATE OR REPLACE FUNCTION public.notify_new_message()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_conv_id_text   text;
    v_sender_id_text text;
    v_recipient_id   uuid;
    v_sender_name    text;
    v_app_id         uuid;
    v_worker_id      uuid;
    v_job_company_id uuid;
BEGIN
    v_conv_id_text   := NEW.conversationid;
    v_sender_id_text := NEW.senderid;

    -- `Conversation.id` e TEXT (conferido no catalogo). Comparar text com text: era aqui que a
    -- funcao morria, com `c.id = v_conv_id_text::uuid` -> 42883 text = uuid.
    SELECT c.application_uuid INTO v_app_id
      FROM public."Conversation" c
     WHERE c.id = v_conv_id_text;

    IF v_app_id IS NULL THEN
        RETURN NEW;
    END IF;

    SELECT a.worker_id, j.company_id INTO v_worker_id, v_job_company_id
      FROM public.applications a
      JOIN public.jobs j ON j.id = a.job_id
     WHERE a.id = v_app_id;

    IF v_worker_id IS NULL THEN
        RETURN NEW;
    END IF;

    IF v_sender_id_text = v_worker_id::text THEN
        v_recipient_id := v_job_company_id;
    ELSE
        v_recipient_id := v_worker_id;
    END IF;

    IF v_recipient_id IS NULL THEN
        RETURN NEW;
    END IF;

    SELECT COALESCE(w.full_name, comp.name, 'Alguém')
      INTO v_sender_name
      FROM auth.users u
      LEFT JOIN public.workers w    ON w.id = u.id
      LEFT JOIN public.companies comp ON comp.id = u.id
     WHERE u.id = v_sender_id_text::uuid;

    INSERT INTO public.notifications (user_id, type, title, message, link, read_at, created_at)
    VALUES (
        v_recipient_id,
        'message',
        'Nova mensagem de ' || COALESCE(v_sender_name, 'Alguém'),
        left(NEW.content, 100),
        '/messages?conversation=' || v_conv_id_text,
        NULL,
        now()
    )
    ON CONFLICT DO NOTHING;

    RETURN NEW;
EXCEPTION WHEN OTHERS THEN
    -- Nunca impedir o INSERT da mensagem por causa da notificacao -- mas tambem nunca esconder o
    -- motivo. O silencio deste bloco foi o que deixou um `text = uuid` sobreviver em producao.
    RAISE WARNING 'notify_new_message falhou (mensagem % da conversa %): % %',
                  NEW.id, NEW.conversationid, SQLSTATE, SQLERRM;
    RETURN NEW;
END;
$$;

COMMENT ON FUNCTION public.notify_new_message() IS
    'Notifica a contraparte a cada mensagem de chat. `Conversation.id` e TEXT -- comparar sem '
    'cast para uuid. Ate 20260823000600 a funcao fazia `c.id = conversationid::uuid`, morria em '
    '42883 e o EXCEPTION WHEN OTHERS mudo escondia: nenhuma mensagem jamais notificou ninguem. '
    'O handler agora emite RAISE WARNING antes de deixar passar.';

-- ============================================================================
-- VERIFICACAO (bloco com ROLLBACK proposital -- trocar os ids pelos reais):
-- DO $$
-- DECLARE v_antes int; v_depois int; v_conv text; v_dono uuid; v_freela uuid;
-- BEGIN
--     SELECT c.id, j.company_id, a.worker_id INTO v_conv, v_dono, v_freela
--       FROM public."Conversation" c
--       JOIN public.applications a ON a.id = c.application_uuid
--       JOIN public.jobs j ON j.id = a.job_id
--      LIMIT 1;
--     SELECT count(*) INTO v_antes FROM public.notifications
--      WHERE user_id = v_freela AND type = 'message';
--     INSERT INTO public."Message" (id, content, createdat, conversationid, senderid)
--     VALUES (gen_random_uuid()::text, 'sonda', now(), v_conv, v_dono::text);
--     SELECT count(*) INTO v_depois FROM public.notifications
--      WHERE user_id = v_freela AND type = 'message';
--     RAISE EXCEPTION 'ROLLBACK: antes=% depois=% (esperado depois = antes + 1)', v_antes, v_depois;
-- END $$;
-- DOWN: nao ha -- a versao anterior nunca notificou ninguem.
-- ============================================================================
