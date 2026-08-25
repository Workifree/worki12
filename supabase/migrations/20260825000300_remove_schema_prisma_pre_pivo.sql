-- Migration: remove o schema Prisma anterior ao pivo (11 tabelas), incluindo PII sem finalidade
--
-- ACHADO (25/08/2026, varredura de codigo morto): sobraram 13 tabelas PascalCase do backend
-- anterior ao pivo. Elas NAO sao um bloco homogeneo, e a diferenca e o ponto inteiro desta
-- migration:
--
--   (a) VIVAS -- `Conversation` (13 linhas) e `Message` (6 linhas) SAO o chat do produto de hoje.
--       O frontend as usa em 18 pontos. O nome PascalCase engana: parecem legado e nao sao.
--       ESTA MIGRATION NAO AS TOCA (exceto por remover uma FK e uma coluna mortas de `Conversation`,
--       ver abaixo).
--
--   (b) VAZIAS -- `Job`, `JobApplication`, `ClientProfile`, `ClientReview`, `FreelancerReview`,
--       `Skill`, `WorkExperience`, `_FreelancerProfileToSkill`, `_JobToSkill`: 0 linhas, nenhuma
--       referencia no frontend.
--
--   (c) COM DADO PESSOAL E SEM CONSUMIDOR -- `User` (5 linhas) e `FreelancerProfile` (5 linhas).
--       `User` guarda email, firstname, lastname e avatarurl, e QUATRO dos cinco emails
--       correspondem a contas que existem no `auth.users` de hoje: pessoas reais, usando a
--       plataforma, com dado pessoal duplicado numa tabela que nada le. Isso e retencao sem
--       finalidade (LGPD) -- nao e vazamento, e a categoria mais facil de resolver e a mais
--       dificil de justificar se alguem perguntar.
--       (A coluna `password` NAO e credencial: as 5 linhas tem o literal `managed_by_supabase_auth`.
--        Conferido antes de escrever isto -- nao e hash.)
--
-- O QUE TORNOU ISTO SEGURO DE FAZER AGORA: as tres edge functions que liam estas tabelas
-- (`jobs-api`, `applications-api`, `profiles-api`) foram removidas de producao hoje. Enquanto elas
-- existiam, dropar as tabelas transformaria um endpoint ocioso em um endpoint quebrado.
--
-- A FK MORTA NA TABELA VIVA (o unico ponto delicado):
-- `Conversation` tem DUAS FKs de application:
--   - `fk_conversation_application_uuid` (application_uuid -> applications)  <- a viva, usada pelas 13
--   - `fk_conversation_application`      (applicationid   -> "JobApplication") <- morta, 0 linhas
-- Conferido: `count(applicationid) = 0` e `count(application_uuid) = 13`. O frontend so conhece
-- `application_uuid` (chega a nomear o embed `applications!fk_conversation_application_uuid`).
-- Logo a FK legada e a coluna que a sustenta saem junto -- sem elas, `JobApplication` nao poderia
-- ser dropada.
--
-- SEM `CASCADE`, DE PROPOSITO: as tabelas sao dropadas em ordem de dependencia explicita. Se o
-- grafo que levantei estiver errado, esta migration FALHA em vez de destruir silenciosamente um
-- objeto que eu nao previ. `CASCADE` aqui trocaria uma falha barulhenta por um estrago quieto.
--
-- Article 8: nao toca saldo. Nenhuma destas tabelas participa de `wallets`, `escrow_transactions`
-- ou `shift_payments`.
--
-- IRREVERSIVEL POR DESENHO: o objetivo de (c) e apagar dado pessoal. Nao ha backup das linhas em
-- lugar nenhum deste repositorio -- guardar PII "por seguranca" anularia a migration. A ESTRUTURA
-- (DDL) permanece recuperavel pelo historico do git.

-- ---------------------------------------------------------------------------
-- 1. Guarda: aborta se a realidade mudou desde a verificacao
-- ---------------------------------------------------------------------------
DO $guard$
DECLARE
    v_legado int;
    v_uuid   int;
    v_nao_vazia text;
BEGIN
    -- (a) o chat vivo nao pode depender da coluna legada
    SELECT count(applicationid), count(application_uuid) INTO v_legado, v_uuid
      FROM public."Conversation";
    IF v_legado <> 0 THEN
        RAISE EXCEPTION 'ABORTADO: % conversa(s) usam applicationid legado. Dropar a FK perderia o vinculo.', v_legado;
    END IF;
    RAISE NOTICE 'Conversation: % linhas no vinculo moderno, 0 no legado -- ok', v_uuid;

    -- (b) as que eu declarei vazias precisam estar vazias
    SELECT string_agg(t.tabela || '=' || t.n, ', ') INTO v_nao_vazia
      FROM (
        SELECT 'Job' AS tabela, count(*) AS n FROM public."Job"
        UNION ALL SELECT 'JobApplication', count(*) FROM public."JobApplication"
        UNION ALL SELECT 'ClientProfile',  count(*) FROM public."ClientProfile"
        UNION ALL SELECT 'ClientReview',   count(*) FROM public."ClientReview"
        UNION ALL SELECT 'FreelancerReview', count(*) FROM public."FreelancerReview"
        UNION ALL SELECT 'Skill',          count(*) FROM public."Skill"
        UNION ALL SELECT 'WorkExperience', count(*) FROM public."WorkExperience"
        UNION ALL SELECT '_JobToSkill',    count(*) FROM public."_JobToSkill"
        UNION ALL SELECT '_FreelancerProfileToSkill', count(*) FROM public."_FreelancerProfileToSkill"
      ) t
     WHERE t.n > 0;
    IF v_nao_vazia IS NOT NULL THEN
        RAISE EXCEPTION 'ABORTADO: tabela(s) que eu declarei vazias tem linhas: %', v_nao_vazia;
    END IF;
END
$guard$;

-- ---------------------------------------------------------------------------
-- 2. Solta a tabela viva do schema morto
-- ---------------------------------------------------------------------------
ALTER TABLE public."Conversation" DROP CONSTRAINT IF EXISTS fk_conversation_application;
ALTER TABLE public."Conversation" DROP COLUMN  IF EXISTS applicationid;

COMMENT ON TABLE public."Conversation" IS
    'CHAT VIVO do produto -- nao e legado, apesar do nome PascalCase. Amarrada a `applications` '
    'por `application_uuid` (FK fk_conversation_application_uuid). A coluna `applicationid` e a FK '
    'para "JobApplication" foram removidas em 20260825000300 junto com o schema Prisma pre-pivo.';

-- ---------------------------------------------------------------------------
-- 3. Dropa o schema Prisma em ordem de dependencia (filhos antes dos pais)
-- ---------------------------------------------------------------------------
DROP TABLE public."_JobToSkill";
DROP TABLE public."_FreelancerProfileToSkill";
DROP TABLE public."WorkExperience";
DROP TABLE public."ClientReview";
DROP TABLE public."FreelancerReview";
DROP TABLE public."JobApplication";
DROP TABLE public."Job";
DROP TABLE public."ClientProfile";
DROP TABLE public."FreelancerProfile";
DROP TABLE public."Skill";
DROP TABLE public."User";

-- ---------------------------------------------------------------------------
-- 4. Verificacao final
-- ---------------------------------------------------------------------------
DO $check$
DECLARE
    v_sobrou text;
    v_conv   int;
    v_msg    int;
BEGIN
    SELECT string_agg(c.relname, ', ' ORDER BY c.relname) INTO v_sobrou
      FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
     WHERE n.nspname = 'public' AND c.relkind = 'r' AND c.relname ~ '[A-Z]';

    IF v_sobrou IS DISTINCT FROM 'Conversation, Message' THEN
        RAISE EXCEPTION 'ABORTADO: sobraram tabelas PascalCase inesperadas: %', coalesce(v_sobrou, '(nenhuma)');
    END IF;

    SELECT count(*) INTO v_conv FROM public."Conversation";
    SELECT count(*) INTO v_msg  FROM public."Message";
    IF v_conv < 13 OR v_msg < 6 THEN
        RAISE EXCEPTION 'ABORTADO: o chat perdeu dado -- Conversation=% (esperado >=13), Message=% (esperado >=6)', v_conv, v_msg;
    END IF;

    RAISE NOTICE 'OK: 11 tabelas removidas. Chat intacto: % conversas, % mensagens.', v_conv, v_msg;
END
$check$;

NOTIFY pgrst, 'reload schema';

-- ============================================================================
-- DOWN: nao ha. A estrutura esta no historico do git; as 10 linhas de dado
-- pessoal foram apagadas de proposito e nao devem voltar.
-- ============================================================================
