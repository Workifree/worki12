-- Migration: aviso de chat para a EMPRESA apontava para a rota do freela
--
-- `notify_new_message` (vigente: 20260823000600) grava `/messages?conversation=<id>` para os dois
-- lados. /messages e exclusiva de freela: a empresa que tocava no aviso caia em "sem permissao".
--
-- MUDA: o link vira `/company/messages?conversation=<id>` quando o destinatario e o lado empresa
-- (quem enviou foi o freela da candidatura). Assinatura, DEFINER, search_path, tratamento de erro,
-- destinatarios, titulo e mensagem ficam iguais. CREATE OR REPLACE preserva trigger e ACL.
-- Depois corrige os avisos antigos, somente os do lado empresa.
--
-- FORA DO ESCOPO (decisao de produto, so registrado): o destinatario do lado empresa continua sendo
-- `jobs.company_id`. O chat NAO passa por notification_recipients_for_job (E2/E5), logo responsavel
-- do turno/Encarregado e Gestores nao sao avisados. Incluir exige antes conferir se o RLS de
-- Conversation/Message da a essas pessoas acesso a conversa.
--
-- Article 8: nao toca saldo. Idempotente.

-- 0. Confere que o corpo no banco e o esperado antes de sobrescrever.
DO $$
DECLARE
    v_def text := pg_get_functiondef('public.notify_new_message()'::regprocedure);
BEGIN
    IF position('c.id = v_conv_id_text;' IN v_def) = 0
       OR position('RAISE WARNING ''notify_new_message falhou' IN v_def) = 0
       OR position('v_recipient_id := v_job_company_id;' IN v_def) = 0
       OR position('notification_recipients_for_job' IN v_def) > 0 THEN
        RAISE EXCEPTION 'PRECONDICAO: notify_new_message difere da versao de 20260823000600. HALT.';
    END IF;
END $$;

-- 1. Funcao.
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
    v_link_base      text;
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
        v_link_base    := '/company/messages?conversation=';
    ELSE
        v_recipient_id := v_worker_id;
        v_link_base    := '/messages?conversation=';
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
        v_link_base || v_conv_id_text,
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
    'Notifica a contraparte a cada mensagem de chat. Link por lado: empresa usa '
    '/company/messages, freela usa /messages. `Conversation.id` e TEXT -- comparar sem cast para '
    'uuid. O handler emite RAISE WARNING antes de deixar passar.';

-- 2. Avisos antigos do lado empresa. (a) conversa resolvivel: destinatario e o dono do turno e nao
-- o freela. (b) destinatario que so existe como empresa (cobre conversa que ja nao se resolve).
UPDATE public.notifications n
   SET link = '/company' || n.link
 WHERE n.type = 'message'
   AND n.link LIKE '/messages?conversation=%'
   AND (
        EXISTS (
            SELECT 1
              FROM public."Conversation" c
              JOIN public.applications a ON a.id = c.application_uuid
              JOIN public.jobs j ON j.id = a.job_id
             WHERE c.id = split_part(n.link, '=', 2)
               AND j.company_id = n.user_id
               AND a.worker_id IS DISTINCT FROM n.user_id
        )
        OR (
            EXISTS (SELECT 1 FROM public.companies co WHERE co.id = n.user_id)
            AND NOT EXISTS (SELECT 1 FROM public.workers w WHERE w.id = n.user_id)
        )
   );

-- 3. Assercoes.
DO $$
DECLARE
    v_def  text := pg_get_functiondef('public.notify_new_message()'::regprocedure);
    v_erro int;
BEGIN
    IF position('/company/messages?conversation=' IN v_def) = 0
       OR position('SECURITY DEFINER' IN v_def) = 0
       OR position('search_path' IN v_def) = 0
       OR position('RAISE WARNING' IN v_def) = 0 THEN
        RAISE EXCEPTION 'VERIFICACAO: notify_new_message nao ficou como esperado. HALT.';
    END IF;

    -- nenhum aviso do lado empresa segue com a rota do freela
    SELECT count(*) INTO v_erro
      FROM public.notifications n
      JOIN public."Conversation" c ON c.id = split_part(n.link, '=', 2)
      JOIN public.applications a ON a.id = c.application_uuid
      JOIN public.jobs j ON j.id = a.job_id
     WHERE n.type = 'message' AND n.link LIKE '/messages?conversation=%'
       AND j.company_id = n.user_id AND a.worker_id IS DISTINCT FROM n.user_id;
    IF v_erro > 0 THEN
        RAISE EXCEPTION 'VERIFICACAO: % aviso(s) de empresa ainda em /messages. HALT.', v_erro;
    END IF;

    -- nenhum aviso de freela foi levado para a rota da empresa
    SELECT count(*) INTO v_erro
      FROM public.notifications n
      JOIN public."Conversation" c ON c.id = split_part(n.link, '=', 2)
      JOIN public.applications a ON a.id = c.application_uuid
     WHERE n.type = 'message' AND n.link LIKE '/company/messages?conversation=%'
       AND a.worker_id = n.user_id;
    IF v_erro > 0 THEN
        RAISE EXCEPTION 'VERIFICACAO: % aviso(s) de freela em /company/messages. HALT.', v_erro;
    END IF;
END $$;

-- DOWN: reaplicar o CREATE OR REPLACE de 20260823000600. Os links corrigidos nao precisam voltar
-- (a rota antiga nunca funcionou para a empresa).
