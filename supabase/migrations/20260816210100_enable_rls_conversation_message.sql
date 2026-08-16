-- Migration: LIGAR RLS em `public."Conversation"` e `public."Message"` + revogar `anon`
-- File: supabase/migrations/20260816210100_enable_rls_conversation_message.sql
-- ADR: .harness/memory-bank/decisions/ADR-20260816-rls-desligada-jobs-conversation.md
--
-- ============================================================================
-- PROBLEMA (evidência de produção)
-- ============================================================================
--   public."Conversation": relrowsecurity = FALSE, 1 policy, anon TEM SELECT.
--   ⇒ RLS desligada + GRANT SELECT para `anon` = QUALQUER PESSOA SEM CONTA lista o índice de
--     conversas da plataforma (id, application_uuid, createdat, islocked) via
--     `GET /rest/v1/Conversation?select=*` com a anon key (que é pública por desenho).
--   A única policy existente ("Participants can update conversations", 20260317012800) é INERTE.
--
--   public."Message": ESTADO A CONFIRMAR antes de aplicar (não estava no censo original).
--   Histórico do repositório é ambíguo de propósito — a tabela foi ligada/desligada 4x:
--     20260314000001 ENABLE → 20260314000003 DISABLE → 20260314000006 ENABLE → 20260317012423 ENABLE.
--   Se `Message` estiver como `Conversation`, o CONTEÚDO das mensagens (coluna `content`) está
--   exposto a `anon`, não só a metadata. Esta migration fecha os dois casos de forma idempotente.
--
--   CONFIRME PRIMEIRO (read-only), e cole o resultado no ADR:
--     SELECT c.relname, c.relrowsecurity,
--            (SELECT count(*) FROM pg_policies p WHERE p.tablename = c.relname) AS policies,
--            has_table_privilege('anon', c.oid, 'SELECT')          AS anon_select,
--            has_table_privilege('authenticated', c.oid, 'UPDATE') AS auth_update
--       FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
--      WHERE n.nspname='public' AND c.relname IN ('Conversation','Message');
--
-- ============================================================================
-- POR QUE A DEFESA NÃO PODE SER O FILTRO NO CLIENT
-- ============================================================================
--   `pages/Messages.tsx:93` e `pages/company/CompanyMessages.tsx:71` fazem
--   `.from('Conversation').select(...)` SEM `.eq()` — buscam TUDO e filtram em JS
--   (`Messages.tsx:144`, `CompanyMessages.tsx:123`). Article 4: filtro no client é UX.
--   Depois desta migration esses filtros viram redundância inofensiva, não a defesa.
--
-- ============================================================================
-- DECISÃO
-- ============================================================================
--   1. Duas funções SECURITY DEFINER (`search_path = ''`) como ponto único de decisão:
--        public.can_access_application(text)  — participante da candidatura (freela OU empresa dona)
--        public.can_access_conversation(text) — participante da conversa (delega à de cima)
--      POR QUÊ FUNÇÃO E NÃO SUBQUERY INLINE (mesmo argumento de 20260816120000):
--        a policy legada de "Message" (20260317012423) faz `FROM "Conversation" c JOIN applications a
--        JOIN jobs j` INLINE. Subquery em policy é avaliada SOB A RLS das tabelas referenciadas —
--        então, no instante em que esta migration liga RLS em "Conversation", a policy de "Message"
--        passa a depender da policy de "Conversation", que depende da de `applications`, que depende
--        da de `jobs`. Três níveis de acoplamento silencioso, dias antes do piloto, e uma bomba-relógio
--        para a Fase 3 (apertar SELECT de `jobs`). A função DEFINER corta a cadeia: devolve boolean.
--
--   2. Casts defensivos por TEXT em todo lugar. `Conversation.id` é uuid, `Message.conversationid`
--      é TEXT (Prisma), `Conversation.application_uuid` é uuid. Comparar sempre `x::text = y::text`
--      nunca levanta erro de cast (o inverso, `texto::uuid`, aborta a query inteira se houver 1 valor
--      malformado). Mesmo estilo já usado em 20260317012423 e em notify_new_message().
--
--   3. "Message" ganha policy de UPDATE — que HOJE NÃO EXISTE em lugar nenhum do repositório.
--      `Messages.tsx:56` e `CompanyMessages.tsx:183` fazem UPDATE de `read_at` (recibo de leitura).
--      Se ligássemos RLS em "Message" sem essa policy, o recibo de leitura pararia EM SILÊNCIO
--      (PostgREST devolve 0 linhas, sem erro) — regressão de produto invisível.
--      A policy é restrita ao DESTINATÁRIO (`senderid <> auth.uid()::text`), e um trigger
--      BEFORE UPDATE garante que só `read_at` muda (RLS é row-level, não column-level: sem o trigger,
--      o destinatário poderia reescrever o `content` da mensagem que recebeu).
--
--   Article 8 INTACTO: nenhuma tabela/RPC financeira tocada.
--
-- Risk: MEDIUM (mensageria é caminho de uso diário). Reversível em 2 comandos (ver DOWN).
-- Backup required: NO (nenhuma escrita de dado).
--
-- ============================================================================
-- DOWN (rollback — copiar/colar)
-- ============================================================================
--   ALTER TABLE public."Message"      DISABLE ROW LEVEL SECURITY;
--   ALTER TABLE public."Conversation" DISABLE ROW LEVEL SECURITY;
--   DROP TRIGGER IF EXISTS trg_message_update_read_only ON public."Message";
--   -- (o GRANT para anon NÃO é restaurado de propósito — ele nunca deveria ter existido)
--
-- ============================================================================
-- COMO VERIFICAR O EFEITO (read-only, DEPOIS de aplicar)
-- ============================================================================
--  V1. RLS ligada nas duas, anon sem nada:
--      SELECT c.relname, c.relrowsecurity, c.relforcerowsecurity,
--             has_table_privilege('anon', c.oid, 'SELECT') AS anon_select,
--             has_table_privilege('anon', c.oid, 'INSERT') AS anon_insert
--        FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
--       WHERE n.nspname='public' AND c.relname IN ('Conversation','Message');
--      -- ESPERADO: t | f | f | f  nas duas linhas
--
--  V2. Policies criadas (3 em Conversation, 3 em Message):
--      SELECT tablename, policyname, cmd FROM pg_policies
--       WHERE schemaname='public' AND tablename IN ('Conversation','Message')
--       ORDER BY tablename, cmd;
--
--  V3. Funções DEFINER com search_path travado e SEM execute para anon:
--      SELECT p.proname, p.prosecdef, p.proconfig,
--             has_function_privilege('anon', p.oid, 'EXECUTE')          AS anon_exec,
--             has_function_privilege('authenticated', p.oid, 'EXECUTE') AS auth_exec
--        FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
--       WHERE n.nspname='public' AND p.proname IN ('can_access_application','can_access_conversation');
--      -- ESPERADO: prosecdef=t, proconfig={search_path=}, anon_exec=f, auth_exec=t
--
--  V4. Trigger de imutabilidade presente:
--      SELECT tgname, tgenabled FROM pg_trigger
--       WHERE tgrelid = 'public."Message"'::regclass AND NOT tgisinternal;
--
-- ============================================================================
-- QUAL QUERY PROVA QUE O PRODUTO NÃO QUEBROU (read-only)
-- ============================================================================
--  P0. Baseline (rode ANTES de aplicar e guarde os números):
--      SELECT (SELECT count(*) FROM public."Conversation") AS convs,
--             (SELECT count(*) FROM public."Message")      AS msgs;
--      -- Escolha uma conversa real e seus dois participantes:
--      SELECT c.id AS conversation_id, a.worker_id, j.company_id
--        FROM public."Conversation" c
--        JOIN public.applications a ON a.id::text = c.application_uuid::text
--        JOIN public.jobs j ON j.id = a.job_id
--       ORDER BY c.createdat DESC LIMIT 5;
--
--  P1. O FREELA participante continua vendo a conversa dele e as mensagens dela:
--      BEGIN;
--        SELECT set_config('role','authenticated',true);
--        SELECT set_config('request.jwt.claims','{"sub":"<WORKER_ID>","role":"authenticated"}',true);
--        SELECT count(*) AS convs_do_freela FROM public."Conversation";        -- ESPERADO: >= 1
--        SELECT count(*) AS msgs_da_conversa FROM public."Message"
--          WHERE conversationid = '<CONVERSATION_ID>';                          -- ESPERADO: = P0 da conversa
--      ROLLBACK;
--
--  P2. A EMPRESA participante idem:
--      BEGIN;
--        SELECT set_config('role','authenticated',true);
--        SELECT set_config('request.jwt.claims','{"sub":"<COMPANY_ID>","role":"authenticated"}',true);
--        SELECT count(*) AS convs_da_empresa FROM public."Conversation";       -- ESPERADO: >= 1
--        SELECT count(*) AS msgs_da_conversa FROM public."Message"
--          WHERE conversationid = '<CONVERSATION_ID>';                          -- ESPERADO: = P0 da conversa
--      ROLLBACK;
--
--  P3. Um TERCEIRO autenticado (freela sem relação) NÃO vê nada:
--      BEGIN;
--        SELECT set_config('role','authenticated',true);
--        SELECT set_config('request.jwt.claims','{"sub":"<OUTRO_UID>","role":"authenticated"}',true);
--        SELECT count(*) AS convs_de_terceiro FROM public."Conversation";      -- ESPERADO: 0
--        SELECT count(*) AS msgs_de_terceiro  FROM public."Message";           -- ESPERADO: 0
--      ROLLBACK;
--
--  P4. `anon` não vê nada:
--      BEGIN;
--        SELECT set_config('role','anon',true);
--        SELECT count(*) AS convs_anon FROM public."Conversation";  -- ESPERADO: erro de permissão (grant revogado)
--      ROLLBACK;
--
--  P5. TESTE MANUAL OBRIGATÓRIO (não dá para provar por SQL): abrir o chat no app com uma conta de
--      empresa e uma de freela, enviar 1 mensagem de cada lado, e confirmar que (i) a mensagem
--      aparece em tempo real (Realtime passa a respeitar RLS: o assinante precisa satisfazer a policy
--      de SELECT) e (ii) o contador de não-lidas zera ao abrir (UPDATE de read_at).
-- ============================================================================

-- =============================================
-- 1. FUNÇÕES DE VISIBILIDADE (retornam só boolean; nunca devolvem dado)
-- =============================================
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
                a.worker_id = v_uid                                    -- freela dono da candidatura
             OR j.company_id = v_uid                                   -- empresa dona do turno (canônico)
             OR j.company_id IN (SELECT c.id FROM public.companies c WHERE c.owner_id = v_uid)
          )
    );
END;
$$;

COMMENT ON FUNCTION public.can_access_application(text) IS
    'Decide se auth.uid() é participante de uma candidatura (freela dono OU empresa dona do turno). '
    'Retorna só boolean. Usada nas policies de "Conversation".';

CREATE OR REPLACE FUNCTION public.can_access_conversation(p_conversation_id text)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_uid uuid := auth.uid();
BEGIN
    IF v_uid IS NULL OR p_conversation_id IS NULL THEN
        RETURN false;
    END IF;

    RETURN EXISTS (
        SELECT 1
        FROM public."Conversation" c
        WHERE c.id::text = p_conversation_id
          AND public.can_access_application(c.application_uuid::text)
    );
END;
$$;

COMMENT ON FUNCTION public.can_access_conversation(text) IS
    'Decide se auth.uid() é participante de uma conversa. Retorna só boolean. '
    'Usada nas policies de "Message".';

-- Sem GRANT EXECUTE a policy falha para `authenticated` (a função roda no contexto do caller).
REVOKE ALL ON FUNCTION public.can_access_application(text)  FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.can_access_conversation(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.can_access_application(text)  TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.can_access_conversation(text) TO authenticated, service_role;

-- =============================================
-- 2. TRIGGER: em "Message", UPDATE só pode mexer em read_at
--    (RLS é row-level; sem isto o destinatário poderia reescrever `content`.)
-- =============================================
CREATE OR REPLACE FUNCTION public.enforce_message_update_read_only()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
    -- service_role / triggers internos (auth.uid() NULL) passam direto.
    IF auth.uid() IS NULL THEN
        RETURN NEW;
    END IF;

    IF NEW.id            IS DISTINCT FROM OLD.id
    OR NEW.conversationid IS DISTINCT FROM OLD.conversationid
    OR NEW.senderid      IS DISTINCT FROM OLD.senderid
    OR NEW.content       IS DISTINCT FROM OLD.content
    OR NEW.createdat     IS DISTINCT FROM OLD.createdat THEN
        RAISE EXCEPTION 'Em "Message" somente read_at pode ser alterado';
    END IF;

    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_message_update_read_only ON public."Message";
CREATE TRIGGER trg_message_update_read_only
    BEFORE UPDATE ON public."Message"
    FOR EACH ROW
    EXECUTE FUNCTION public.enforce_message_update_read_only();

-- =============================================
-- 3. POLICIES DE "Conversation" (criar ANTES de ligar RLS)
-- =============================================
DROP POLICY IF EXISTS "Participants can view conversations"   ON public."Conversation";
DROP POLICY IF EXISTS "Participants can create conversations" ON public."Conversation";
DROP POLICY IF EXISTS "Participants can update conversations" ON public."Conversation";
DROP POLICY IF EXISTS "conversation_select_participants"      ON public."Conversation";
DROP POLICY IF EXISTS "conversation_insert_participants"      ON public."Conversation";
DROP POLICY IF EXISTS "conversation_update_participants"      ON public."Conversation";

CREATE POLICY "conversation_select_participants" ON public."Conversation"
    FOR SELECT TO authenticated
    USING (public.can_access_application(application_uuid::text));

-- INSERT: hoje só a empresa cria (CompanyJobCandidates.tsx:590), mas a policy cobre os dois
-- participantes — se o freela puder abrir conversa no futuro, não vira migration nova.
CREATE POLICY "conversation_insert_participants" ON public."Conversation"
    FOR INSERT TO authenticated
    WITH CHECK (public.can_access_application(application_uuid::text));

CREATE POLICY "conversation_update_participants" ON public."Conversation"
    FOR UPDATE TO authenticated
    USING (public.can_access_application(application_uuid::text))
    WITH CHECK (public.can_access_application(application_uuid::text));

-- =============================================
-- 4. POLICIES DE "Message" (criar ANTES de ligar RLS)
-- =============================================
DROP POLICY IF EXISTS "Participants can view messages"   ON public."Message";
DROP POLICY IF EXISTS "Participants can insert messages" ON public."Message";
DROP POLICY IF EXISTS "message_select_participants"      ON public."Message";
DROP POLICY IF EXISTS "message_insert_sender"            ON public."Message";
DROP POLICY IF EXISTS "message_update_read_receipt"      ON public."Message";

CREATE POLICY "message_select_participants" ON public."Message"
    FOR SELECT TO authenticated
    USING (public.can_access_conversation(conversationid));

CREATE POLICY "message_insert_sender" ON public."Message"
    FOR INSERT TO authenticated
    WITH CHECK (
        senderid = auth.uid()::text
        AND public.can_access_conversation(conversationid)
    );

-- UPDATE: só o DESTINATÁRIO, e (via trigger acima) só a coluna read_at.
CREATE POLICY "message_update_read_receipt" ON public."Message"
    FOR UPDATE TO authenticated
    USING (
        senderid IS DISTINCT FROM auth.uid()::text
        AND public.can_access_conversation(conversationid)
    )
    WITH CHECK (
        senderid IS DISTINCT FROM auth.uid()::text
        AND public.can_access_conversation(conversationid)
    );

-- =============================================
-- 5. LIGAR RLS + GRANTS
--    NÃO usar FORCE (lição de 20260318000000). NÃO usar REVOKE ALL FROM PUBLIC.
-- =============================================
ALTER TABLE public."Conversation" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."Conversation" NO FORCE ROW LEVEL SECURITY;
ALTER TABLE public."Message"      ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."Message"      NO FORCE ROW LEVEL SECURITY;

REVOKE ALL ON public."Conversation" FROM anon;
REVOKE ALL ON public."Message"      FROM anon;

GRANT SELECT, INSERT, UPDATE ON public."Conversation" TO authenticated;
GRANT SELECT, INSERT, UPDATE ON public."Message"      TO authenticated;
GRANT ALL    ON public."Conversation" TO service_role;
GRANT ALL    ON public."Message"      TO service_role;
