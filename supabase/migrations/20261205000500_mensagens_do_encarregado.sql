-- Migration: Mensagens do Encarregado — o lado empresa do chat e quem opera o turno
-- File: supabase/migrations/20261205000500_mensagens_do_encarregado.sql
-- ADR: .harness/memory-bank/decisions/ADR-20261127-mensagens-do-encarregado.md
--
-- (1) can_access_application: `is_company_owner(j.company_id)` -> `is_job_owner(a.job_id)`. Gestor segue
--     passando (primeiro ramo do seam); Encarregado confirmado so no turno que e responsavel ou cobre na
--     data local. As 5 policies de chat herdam sem reescrita. Sem job_id => lado empresa falha fechado.
--     A guarda de pre-condicao de 20261126000800 so rodou naquela migration (ja aplicada); nao bloqueia esta.
-- (2) Recibo de leitura: message_update_read_receipt so permite marcar mensagem do LADO OPOSTO ao
--     chamador. Helper conversation_worker_id(text) (DEFINER) devolve o freela da conversa so se o
--     chamador ja acessa a conversa.
-- (3) notify_new_message: mensagem do freela avisa notification_recipients_for_job(job) + quem cobre o
--     turno na data, menos o remetente, um aviso por pessoa. Ramo da empresa inalterado.
--
-- Article 8: nao toca saldo. Sem tabela/coluna/indice novos.
--
-- DOWN:
--   CREATE OR REPLACE public.can_access_application(text): mesmo corpo trocando
--       `public.is_job_owner(a.job_id)` por `public.is_company_owner(j.company_id)` (com LEFT JOIN jobs j
--       ON j.id = a.job_id, como em 20261126000800/vigente).
--   DROP POLICY message_update_read_receipt ON public."Message";
--   CREATE POLICY message_update_read_receipt ON public."Message" FOR UPDATE TO authenticated
--     USING (senderid IS DISTINCT FROM (auth.uid())::text AND public.can_access_conversation(conversationid))
--     WITH CHECK (senderid IS DISTINCT FROM (auth.uid())::text AND public.can_access_conversation(conversationid));
--   DROP FUNCTION IF EXISTS public.conversation_worker_id(text);
--   notify_new_message: reexecutar o CREATE OR REPLACE do bloco "2. Chat" de 20261126000800.

BEGIN;

-- 0. Pre-condicoes: corpo vigente ainda e o de Gestor-only e o seam existe.
DO $$
BEGIN
    IF to_regprocedure('public.is_job_owner(uuid)') IS NULL
       OR to_regprocedure('public.notification_recipients_for_job(uuid)') IS NULL
       OR to_regprocedure('public.internal_company_confirmed_operator(uuid, uuid)') IS NULL
       OR to_regprocedure('public.can_access_application(text)') IS NULL
       OR to_regprocedure('public.can_access_conversation(text)') IS NULL
       OR to_regprocedure('public.notify_new_message()') IS NULL
    THEN
        RAISE EXCEPTION 'PRE-CONDICAO: funcao base ausente. HALT.';
    END IF;

    IF position('is_company_owner(j.company_id)' IN
                pg_get_functiondef(to_regprocedure('public.can_access_application(text)'))) = 0
    THEN
        RAISE EXCEPTION 'PRE-CONDICAO: can_access_application difere do esperado (is_company_owner). HALT.';
    END IF;
END $$;

-- 1. Lado empresa = quem opera o turno
CREATE OR REPLACE FUNCTION public.can_access_application(p_application_id text)
RETURNS boolean
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = ''
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
         WHERE a.id::text = p_application_id
           AND (
                 a.worker_id = v_uid
                 -- Seam do turno (ADR-20261127): Gestor, Encarregado confirmado responsavel ou cobrindo.
                 OR (a.job_id IS NOT NULL AND public.is_job_owner(a.job_id))
               )
    );
END;
$$;

-- 2. Freela da conversa (so para quem ja acessa a conversa)
CREATE OR REPLACE FUNCTION public.conversation_worker_id(p_conversation_id text)
RETURNS uuid
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = ''
AS $$
    SELECT a.worker_id
      FROM public."Conversation" c
      JOIN public.applications a ON a.id = c.application_uuid
     WHERE c.id::text = p_conversation_id
       AND public.can_access_conversation(p_conversation_id);
$$;

REVOKE ALL ON FUNCTION public.conversation_worker_id(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.conversation_worker_id(text) TO authenticated, service_role;

-- 3. Recibo de leitura: so o lado oposto ao remetente marca.
--    freela da conversa: marca o que nao e dele; lado empresa: marca so o que o freela mandou.
DROP POLICY IF EXISTS message_update_read_receipt ON public."Message";
CREATE POLICY message_update_read_receipt ON public."Message"
    FOR UPDATE TO authenticated
    USING (
        senderid IS DISTINCT FROM (SELECT auth.uid())::text
        AND public.can_access_conversation(conversationid)
        AND CASE
              WHEN public.conversation_worker_id(conversationid) = (SELECT auth.uid()) THEN true
              ELSE senderid = public.conversation_worker_id(conversationid)::text
            END
    )
    WITH CHECK (
        senderid IS DISTINCT FROM (SELECT auth.uid())::text
        AND public.can_access_conversation(conversationid)
    );
-- trg_message_update_read_only continua garantindo que so read_at muda.

-- 4. Aviso
CREATE OR REPLACE FUNCTION public.notify_new_message()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
    v_sender_name    text;
    v_app_id         uuid;
    v_job_id         uuid;
    v_worker_id      uuid;
    v_job_company_id uuid;
BEGIN
    SELECT c.application_uuid INTO v_app_id
      FROM public."Conversation" c
     WHERE c.id = NEW.conversationid;

    IF v_app_id IS NULL THEN
        RETURN NEW;
    END IF;

    SELECT a.worker_id, a.job_id, j.company_id INTO v_worker_id, v_job_id, v_job_company_id
      FROM public.applications a
      JOIN public.jobs j ON j.id = a.job_id
     WHERE a.id = v_app_id;

    IF v_worker_id IS NULL THEN
        RETURN NEW;
    END IF;

    IF NEW.senderid = v_worker_id::text THEN
        -- Freela escreve: quem opera o turno (Gestores, responsavel confirmado) + quem cobre na data.
        SELECT w.full_name INTO v_sender_name FROM public.workers w WHERE w.id = v_worker_id;

        INSERT INTO public.notifications (user_id, type, title, message, link, read_at, created_at)
        SELECT d.r, 'message',
               'Nova mensagem de ' || COALESCE(v_sender_name, 'Alguém'),
               left(NEW.content, 100),
               '/company/messages?conversation=' || NEW.conversationid,
               NULL, now()
          FROM (
                SELECT public.notification_recipients_for_job(v_job_id) AS r
                UNION
                SELECT rc.to_user_id
                  FROM public.responsibility_coverages rc
                  JOIN public.jobs j ON j.id = v_job_id
                 WHERE rc.company_id   = j.company_id
                   AND rc.from_user_id = j.responsible_id
                   AND rc.revoked_at IS NULL
                   AND (j.start_date AT TIME ZONE 'America/Sao_Paulo')::date BETWEEN rc.starts_on AND rc.ends_on
                   -- Espelha session_can_operate_job (b): so cobertura que o seam reconhece.
                   -- from e to PRECISAM ser encarregado ativo e confirmado; cobertura inerte nao avisa
                   -- (o aviso carrega left(content,100) e nao pode vazar a quem nao le a conversa).
                   AND public.internal_company_confirmed_operator(j.company_id, rc.to_user_id)
                   AND EXISTS (SELECT 1 FROM public.company_members ct
                                WHERE ct.company_id = j.company_id AND ct.user_id = rc.to_user_id
                                  AND ct.role = 'encarregado' AND ct.status = 'active'
                                  AND ct.confirmed_at IS NOT NULL)
                   AND EXISTS (SELECT 1 FROM public.company_members cf
                                WHERE cf.company_id = j.company_id AND cf.user_id = rc.from_user_id
                                  AND cf.role = 'encarregado' AND cf.status = 'active'
                                  AND cf.confirmed_at IS NOT NULL)
               ) d
         WHERE d.r IS NOT NULL
           AND d.r::text <> NEW.senderid
        ON CONFLICT DO NOTHING;
    ELSE
        -- Lado empresa escreve: so o freela, assinado com o nome da EMPRESA.
        SELECT comp.name INTO v_sender_name FROM public.companies comp WHERE comp.id = v_job_company_id;

        INSERT INTO public.notifications (user_id, type, title, message, link, read_at, created_at)
        VALUES (
            v_worker_id,
            'message',
            'Nova mensagem de ' || COALESCE(v_sender_name, 'Alguém'),
            left(NEW.content, 100),
            '/messages?conversation=' || NEW.conversationid,
            NULL,
            now()
        )
        ON CONFLICT DO NOTHING;
    END IF;

    RETURN NEW;
EXCEPTION WHEN OTHERS THEN
    -- Aviso nunca derruba a mensagem.
    RAISE WARNING 'notify_new_message falhou (mensagem % da conversa %): % %',
                  NEW.id, NEW.conversationid, SQLSTATE, SQLERRM;
    RETURN NEW;
END;
$$;

-- 4b. Funcoes de acesso do chat: anon nunca executa (authenticated e service_role mantem).
GRANT EXECUTE ON FUNCTION public.can_access_application(text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.can_access_conversation(text) TO authenticated, service_role;
REVOKE EXECUTE ON FUNCTION public.can_access_application(text) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.can_access_conversation(text) FROM PUBLIC, anon;

-- 5. Verificacao
DO $$
DECLARE
    v_n integer;
BEGIN
    IF has_function_privilege('anon', 'public.can_access_application(text)', 'EXECUTE')
       OR has_function_privilege('anon', 'public.can_access_conversation(text)', 'EXECUTE')
       OR NOT has_function_privilege('authenticated', 'public.can_access_application(text)', 'EXECUTE')
       OR NOT has_function_privilege('authenticated', 'public.can_access_conversation(text)', 'EXECUTE')
    THEN
        RAISE EXCEPTION 'VERIFICACAO: grants de can_access_application/conversation incorretos. HALT.';
    END IF;

    IF position('is_job_owner(a.job_id)' IN
                pg_get_functiondef(to_regprocedure('public.can_access_application(text)'))) = 0
       OR position('is_company_owner' IN
                pg_get_functiondef(to_regprocedure('public.can_access_application(text)'))) > 0
    THEN
        RAISE EXCEPTION 'VERIFICACAO: can_access_application nao usa so o seam do turno. HALT.';
    END IF;

    IF position('notification_recipients_for_job' IN
                pg_get_functiondef(to_regprocedure('public.notify_new_message()'))) = 0
       OR position('responsibility_coverages' IN
                pg_get_functiondef(to_regprocedure('public.notify_new_message()'))) = 0
    THEN
        RAISE EXCEPTION 'VERIFICACAO: notify_new_message nao avisa quem opera/cobre. HALT.';
    END IF;

    IF has_function_privilege('anon', 'public.conversation_worker_id(text)', 'EXECUTE') THEN
        RAISE EXCEPTION 'VERIFICACAO: anon executa conversation_worker_id. HALT.';
    END IF;

    SELECT count(*) INTO v_n FROM pg_catalog.pg_policy
     WHERE polrelid = 'public."Message"'::regclass
       AND polname NOT IN ('message_select_participants', 'message_insert_participants',
                           'message_update_read_receipt');
    IF v_n <> 0 THEN
        RAISE EXCEPTION 'VERIFICACAO: Message tem % policy inesperada. HALT.', v_n;
    END IF;
END $$;

COMMIT;
