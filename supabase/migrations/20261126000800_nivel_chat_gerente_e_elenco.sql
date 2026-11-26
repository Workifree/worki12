-- Migration: nivel por uma formula so, chat do gerente, autoria no Elenco e pagamento sem contratacao
-- File: supabase/migrations/20261126000800_nivel_chat_gerente_e_elenco.sql
--
-- (1) NIVEL: havia DUAS formulas. calculate_level_from_xp (trigger_update_level) = floor(xp/100)+1;
--     a canonica worker_level_for_xp e a de recompute_worker_aggregates. Quando o recompute MUDAVA o
--     xp, o gatilho legado sobrescrevia o level (475 -> 5); no recompute seguinte, com o mesmo xp, o
--     WHEN nao disparava e o level voltava ao canonico (3). O 3 e o certo.
--     trigger_award_xp_on_photo somava +50 por fora da formula (e de novo a cada foto
--     removida/reenviada), depois do profile_trust_guard. Saem os dois: o bonus de foto ja esta no
--     recompute, que o Perfil chama apos o upload. Reconcilia SO o level incoerente com o xp
--     gravado; xp, contagem e ganhos nao sao tocados.
-- (2) CHAT: as 4 policies de SELECT/INSERT de "Message" usavam jobs.company_id = auth.uid(). Passam
--     ao mesmo predicado da Conversation (can_access_conversation -> is_company_owner): freela, dono,
--     gerente e operador da organizacao. Encarregado e terceiro continuam fora.
--     notify_new_message: quem fala pela empresa assina com o nome da EMPRESA (o gerente nao tem
--     perfil proprio e o aviso sairia "Alguem"). Destinatarios e links nao mudam.
-- (3) ELENCO: no INSERT do cliente, blocked_by/accepted_at nascem NULL e created_at/updated_at sao do
--     servidor. No UPDATE do cliente, status 'blocked' exige blocked_by = auth.uid().
-- (4) PAGAMENTO: o cliente nao cria shift_payments para candidatura que comprovadamente nunca virou
--     contratacao (pending, reviewing, interview, applied, invited, declined, rejected, sem presenca
--     e sem convite aceito). 'cancelled' NAO e travado: contratacao pelo fluxo pull cancelada nao
--     deixa rastro, e pagar quem saiu e legitimo. 'accepted'/'approved' (legados) tambem passam.
--
-- Os guards seguem SECURITY INVOKER (current_user distingue cliente de servidor). NAO podem virar DEFINER.
-- Article 8: nao toca saldo.
--
-- DOWN (reabre as falhas; o level reconciliado nao precisa voltar, recompute produz o mesmo valor):
--   CREATE TRIGGER trigger_update_level BEFORE UPDATE OF xp ON public.workers FOR EACH ROW
--       WHEN (OLD.xp IS DISTINCT FROM NEW.xp) EXECUTE FUNCTION public.calculate_level_from_xp();
--   CREATE TRIGGER trigger_award_xp_on_photo BEFORE UPDATE OF avatar_url ON public.workers FOR EACH ROW
--       EXECUTE FUNCTION public.award_xp_on_photo_upload();
--       (antes, recriar as duas funcoes: NEW.level := FLOOR(NEW.xp/100)+1; e NEW.xp := COALESCE(NEW.xp,0)+50
--        quando OLD.avatar_url IS NULL AND NEW.avatar_url IS NOT NULL.)
--   Message: DROP das policies message_select_participants/message_insert_participants e recriar
--       "Participants can view messages"/"Participants can insert messages" com o predicado antigo
--       (a.worker_id = auth.uid() OR j.company_id = auth.uid()).
--   DROP TRIGGER trg_zz_team_connections_insert_guard ON public.team_connections;
--   DROP FUNCTION public.team_connections_insert_guard();
--   team_connections_update_guard, shift_payments_insert_guard: reexecutar os blocos de 20261126000700.
--   notify_new_message: voltar o nome para o COALESCE(worker, company do remetente, 'Alguem').

BEGIN;

-- 0. Pre-condicoes
DO $$
BEGIN
    IF to_regprocedure('public.worker_level_for_xp(integer)') IS NULL
       OR to_regprocedure('public.recompute_worker_aggregates(uuid)') IS NULL
       OR to_regprocedure('public.can_access_conversation(text)') IS NULL
       OR to_regprocedure('public.team_connections_update_guard()') IS NULL
       OR to_regprocedure('public.shift_payments_insert_guard()') IS NULL
       OR to_regprocedure('public.notify_new_message()') IS NULL
    THEN
        RAISE EXCEPTION 'PRE-CONDICAO: funcao base ausente. HALT.';
    END IF;

    -- O chat so pode ser delegado se o predicado continuar sendo de Gestor (Encarregado fora).
    IF EXISTS (SELECT 1 FROM pg_catalog.pg_proc
                WHERE oid = to_regprocedure('public.can_access_application(text)')
                  AND (prosrc !~ 'is_company_owner'
                       OR regexp_replace(prosrc, '--[^\r\n]*', '', 'g') ~* '(is_job_owner|session_can_operate_job|is_company_member_confirmed)'))
       OR to_regprocedure('public.can_access_application(text)') IS NULL
    THEN
        RAISE EXCEPTION 'PRE-CONDICAO: can_access_application mudou; revisar o acesso do Encarregado ao chat. HALT.';
    END IF;
END $$;

-- 1. Nivel: uma formula so
DROP TRIGGER IF EXISTS trigger_update_level ON public.workers;
DROP TRIGGER IF EXISTS trigger_award_xp_on_photo ON public.workers;
DROP FUNCTION IF EXISTS public.calculate_level_from_xp();
DROP FUNCTION IF EXISTS public.award_xp_on_photo_upload();

DO $$
DECLARE
    v_n integer;
BEGIN
    UPDATE public.workers
       SET level = public.worker_level_for_xp(COALESCE(xp, 0))
     WHERE level IS DISTINCT FROM public.worker_level_for_xp(COALESCE(xp, 0));
    GET DIAGNOSTICS v_n = ROW_COUNT;
    RAISE NOTICE 'level reconciliado em % linha(s)', v_n;
END $$;

-- 2. Chat
DROP POLICY IF EXISTS "Participants can view messages" ON public."Message";
DROP POLICY IF EXISTS "Users can view messages in their conversations" ON public."Message";
DROP POLICY IF EXISTS "Participants can insert messages" ON public."Message";
DROP POLICY IF EXISTS "Users can insert messages in their conversations" ON public."Message";

DROP POLICY IF EXISTS "message_select_participants" ON public."Message";
CREATE POLICY "message_select_participants" ON public."Message"
    FOR SELECT TO authenticated
    USING (public.can_access_conversation(conversationid));

DROP POLICY IF EXISTS "message_insert_participants" ON public."Message";
CREATE POLICY "message_insert_participants" ON public."Message"
    FOR INSERT TO authenticated
    WITH CHECK (senderid = (SELECT auth.uid())::text AND public.can_access_conversation(conversationid));

CREATE OR REPLACE FUNCTION public.notify_new_message()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE
    v_recipient_id   uuid;
    v_sender_name    text;
    v_app_id         uuid;
    v_worker_id      uuid;
    v_job_company_id uuid;
    v_link_base      text;
BEGIN
    SELECT c.application_uuid INTO v_app_id
      FROM public."Conversation" c
     WHERE c.id = NEW.conversationid;

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

    IF NEW.senderid = v_worker_id::text THEN
        v_recipient_id := v_job_company_id;
        v_link_base    := '/company/messages?conversation=';
        SELECT w.full_name INTO v_sender_name FROM public.workers w WHERE w.id = v_worker_id;
    ELSE
        v_recipient_id := v_worker_id;
        v_link_base    := '/messages?conversation=';
        SELECT comp.name INTO v_sender_name FROM public.companies comp WHERE comp.id = v_job_company_id;
    END IF;

    IF v_recipient_id IS NULL THEN
        RETURN NEW;
    END IF;

    INSERT INTO public.notifications (user_id, type, title, message, link, read_at, created_at)
    VALUES (
        v_recipient_id,
        'message',
        'Nova mensagem de ' || COALESCE(v_sender_name, 'Alguém'),
        left(NEW.content, 100),
        v_link_base || NEW.conversationid,
        NULL,
        now()
    )
    ON CONFLICT DO NOTHING;

    RETURN NEW;
EXCEPTION WHEN OTHERS THEN
    -- Aviso nunca derruba a mensagem.
    RAISE WARNING 'notify_new_message falhou (mensagem % da conversa %): % %',
                  NEW.id, NEW.conversationid, SQLSTATE, SQLERRM;
    RETURN NEW;
END;
$$;

-- 3. Elenco
CREATE OR REPLACE FUNCTION public.team_connections_insert_guard()
RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
BEGIN
    IF current_user IN ('postgres', 'service_role', 'supabase_admin') THEN
        RETURN NEW;
    END IF;
    NEW.blocked_by  := NULL;
    NEW.accepted_at := NULL;
    NEW.created_at  := pg_catalog.now();
    NEW.updated_at  := pg_catalog.now();
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_zz_team_connections_insert_guard ON public.team_connections;
CREATE TRIGGER trg_zz_team_connections_insert_guard
    BEFORE INSERT ON public.team_connections
    FOR EACH ROW EXECUTE FUNCTION public.team_connections_insert_guard();

CREATE OR REPLACE FUNCTION public.team_connections_update_guard()
RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
DECLARE
    v_uid uuid;
BEGIN
    IF current_user IN ('postgres', 'service_role', 'supabase_admin') THEN
        RETURN NEW;
    END IF;
    v_uid := (SELECT auth.uid());

    -- Lista de permitidos: so status, accepted_at, blocked_by e updated_at mudam pelo cliente.
    IF (pg_catalog.to_jsonb(NEW) - ARRAY['status', 'accepted_at', 'blocked_by', 'updated_at'])
       IS DISTINCT FROM
       (pg_catalog.to_jsonb(OLD) - ARRAY['status', 'accepted_at', 'blocked_by', 'updated_at'])
    THEN
        RAISE EXCEPTION 'team_connections: coluna do vinculo nao pode ser alterada.' USING ERRCODE = '42501';
    END IF;

    -- Bloqueio so e mexido por quem bloqueou (blocked_by NULL = ninguem pelo cliente).
    IF OLD.status = 'blocked' AND OLD.blocked_by IS DISTINCT FROM v_uid THEN
        RAISE EXCEPTION 'team_connections: bloqueio so pode ser alterado por quem bloqueou.' USING ERRCODE = '42501';
    END IF;

    -- Ninguem grava bloqueio em nome de outra pessoa.
    IF NEW.blocked_by IS DISTINCT FROM OLD.blocked_by
       AND NEW.blocked_by IS NOT NULL AND NEW.blocked_by IS DISTINCT FROM v_uid THEN
        RAISE EXCEPTION 'team_connections: blocked_by invalido.' USING ERRCODE = '42501';
    END IF;

    -- Bloqueio sem autor ninguem desfaz.
    IF NEW.status = 'blocked' AND (v_uid IS NULL OR NEW.blocked_by IS DISTINCT FROM v_uid) THEN
        RAISE EXCEPTION 'team_connections: bloqueio exige o autor em blocked_by.' USING ERRCODE = '42501';
    END IF;

    RETURN NEW;
END;
$$;

-- 4. Pagamento
CREATE OR REPLACE FUNCTION public.shift_payments_insert_guard()
RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
BEGIN
    IF current_user IN ('postgres', 'service_role', 'supabase_admin') THEN
        RETURN NEW;
    END IF;
    IF NOT EXISTS (
        SELECT 1 FROM public.applications a
         WHERE a.id = NEW.application_id AND a.job_id = NEW.job_id AND a.worker_id = NEW.worker_id
    ) THEN
        RAISE EXCEPTION 'shift_payments: pagamento exige a candidatura deste freela neste turno.'
            USING ERRCODE = '42501';
    END IF;
    IF EXISTS (
        SELECT 1 FROM public.applications a
         WHERE a.id = NEW.application_id
           AND a.status IN ('pending', 'reviewing', 'interview', 'applied', 'invited', 'declined', 'rejected')
           AND a.invitation_response IS DISTINCT FROM 'accepted'
           AND a.worker_checkin_at IS NULL AND a.worker_checkout_at IS NULL
           AND a.company_checkin_confirmed_at IS NULL AND a.company_checkout_confirmed_at IS NULL
    ) THEN
        RAISE EXCEPTION 'shift_payments: este freela nunca foi contratado para o turno.'
            USING ERRCODE = '42501';
    END IF;
    RETURN NEW;
END;
$$;

-- 5. Verificacao
DO $$
DECLARE
    v_n integer;
BEGIN
    IF EXISTS (SELECT 1 FROM public.workers
                WHERE level IS DISTINCT FROM public.worker_level_for_xp(COALESCE(xp, 0))) THEN
        RAISE EXCEPTION 'VERIFICACAO: ainda ha level incoerente. HALT.';
    END IF;

    -- Outro gatilho de workers que mexa em level/xp seria uma segunda formula.
    IF EXISTS (SELECT 1 FROM pg_catalog.pg_trigger t JOIN pg_catalog.pg_proc p ON p.oid = t.tgfoid
                WHERE t.tgrelid = 'public.workers'::regclass AND NOT t.tgisinternal
                  AND p.prosrc ~* 'NEW\.(level|xp)\s*:=') THEN
        RAISE EXCEPTION 'VERIFICACAO: outro gatilho de workers calcula level/xp. HALT.';
    END IF;

    -- polcmd: r=SELECT, a=INSERT, *=ALL. Policy permissiva extra reabriria o acesso.
    SELECT count(*) INTO v_n FROM pg_catalog.pg_policy
     WHERE polrelid = 'public."Message"'::regclass AND polcmd IN ('r', 'a', '*')
       AND polname NOT IN ('message_select_participants', 'message_insert_participants');
    IF v_n <> 0 THEN
        RAISE EXCEPTION 'VERIFICACAO: Message tem % policy(ies) de leitura/envio inesperada(s). HALT.', v_n;
    END IF;

    SELECT count(*) INTO v_n
      FROM pg_catalog.pg_trigger t JOIN pg_catalog.pg_proc p ON p.oid = t.tgfoid
     WHERE t.tgname IN ('trg_zz_team_connections_guard', 'trg_zz_team_connections_insert_guard',
                        'trg_zz_shift_payments_insert_guard')
       AND t.tgenabled = 'O' AND NOT p.prosecdef;
    IF v_n <> 3 THEN
        RAISE EXCEPTION 'VERIFICACAO: esperava 3 guards INVOKER ativos, achei %. HALT.', v_n;
    END IF;
END $$;

COMMIT;
