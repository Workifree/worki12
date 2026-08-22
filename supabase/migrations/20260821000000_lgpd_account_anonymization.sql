-- ============================================================================
-- ⚠️ NÃO APLICAR SOZINHA — BLOQUEIO TÉCNICO (H1/H2 JÁ FORAM DECIDIDOS)
-- ----------------------------------------------------------------------------
-- ATUALIZADO EM 21/08/2026. O bloqueio ANTERIOR era de DECISÃO ("H1/H2 do owner não vieram").
-- AS DECISÕES VIERAM. O que resta é bloqueio TÉCNICO — outra coisa, e menor:
--
--   H1. DECIDIDO: retenção de 5 ANOS de `shift_payments` e `service_terms`, contados de `paid_at`
--       e `accepted_at`; vencido o prazo, EXPURGO. Base: prescrição civil (CC art. 206 §5º I).
--       ⚠️ O NÚMERO é escolha da orquestração, PENDENTE de confirmação com advogado — a
--       recomendação técnica é 6 anos pelo vetor trabalhista (ddl-aprovado §2.7.0). Isso NÃO
--       bloqueia nada: o prazo mora em `public.lgpd_retention_interval()` e trocar 5→6 é um
--       CREATE OR REPLACE de três linhas.
--       O expurgo apaga CONTEÚDO PESSOAL, NÃO A LINHA de auditoria — nenhum DELETE em
--       shift_payments/service_terms, nunca (ADR-20260821-expurgo-de-conteudo-nao-de-linha).
--       O prazo é do DADO, não da conta: conta excluída hoje com pagamento de 4 anos atrás
--       expurga em 1 ano. Contar da exclusão faria quem exerce o art. 18, VI PROLONGAR a própria
--       retenção.
--   H2. DECIDIDO: REMOVER as FKs CASCADE `workers/companies/wallets -> auth.users`, como
--       desenhado (§2 abaixo). Consequência aceita: linhas "lápide" sem `auth.users`
--       correspondente, POR CONSTRUÇÃO.
--
-- ----------------------------------------------------------------------------
-- O QUE AINDA BLOQUEIA (técnico, verificável — não é decisão de ninguém):
-- ----------------------------------------------------------------------------
--   (1) A migration #3 do expurgo — `20260821000400_lgpd_retention_purge.sql`
--       (ddl-aprovado §2.7) — NÃO ESTÁ ESCRITA/APLICADA. Sem ela a promessa de 5 anos não é
--       cumprida por NENHUM código: esta migration passa a reter conteúdo pessoal sem prazo real.
--       ORDEM OBRIGATÓRIA: esta (#1) ANTES da #3. A #3 reescreve
--       `enforce_service_term_immutability` com o corpo-SUPERSET (a emenda daqui + a do expurgo);
--       aplicar fora de ordem faria ESTA migration apagar a exceção do expurgo em silêncio.
--       A #3 carrega asserção que falha fechado se esta aqui não estiver aplicada.
--   (2) O texto da Política de Privacidade / tela de exclusão (ddl-aprovado §6, ENTREGUE) precisa
--       estar PUBLICADO antes de a rotina ficar acessível ao usuário. Ele diz, com todas as
--       letras, que o termo ACEITO é retido COM NOME E CPF por 5 anos — e NÃO chama isso de
--       "anonimização" (§0.4: é eliminação parcial + retenção justificada sobre chave pseudônima;
--       não é anonimização no sentido do art. 5º, XI).
--
--   (3) EMENDA 2026-08-22 — CLASSE DE USUÁRIO NÃO COBERTA: o GERENTE da F13. Depois de
--       `accept_manager_invite`, a casca de `companies` do gerente é APAGADA (20260818100300),
--       e ele nunca teve linha em `workers`. Logo `anonymize_account` devolve `not_found` para
--       ele — é a ÚNICA classe de usuário do produto que a rotina não reconhece. A Edge Function
--       (§4) NÃO pode tratar `not_found` como "nada a fazer, siga para o deleteUser": isso
--       apagaria a credencial deixando `company_members` ACTIVE com `invited_email` intacto.
--       Contrato: `not_found` é FALHA, e a Edge Function aborta ANTES do deleteUser.
--       Enquanto a F13 não subir, esta classe não existe em produção — mas a ordem de replay em
--       CI já a cria. Ver ddl-aprovado §4.4.
--
-- Até (1), (2) e (3): esta migration pode ir ao banco, mas a Edge Function `delete-account` NÃO
-- deve ser liberada ao usuário final. Ver `.harness/spec/lgpd-producao/ddl-aprovado.md` §0.3.1,
-- §0.4, §2.7 e §5 (H1/H2 — DECIDIDOS) para o racional completo.
--
-- ----------------------------------------------------------------------------
-- EMENDA 2026-08-22 — FRONTEIRA COM A F13 (multi-unidade). Nada aplicado ainda.
-- ----------------------------------------------------------------------------
--   Por que entra AGORA e não depois: a F13 cria `public.company_members REFERENCES companies`,
--   e o arquivo dela ordena em `20260818100000` — ANTES desta. Em todo replay de CI/staging a
--   partir do zero, a asserção (c) desta migration HALTaria. Em PRODUÇÃO, onde esta sobe
--   primeiro, a asserção não veria nada e a lacuna passaria em SILÊNCIO. Dois ambientes falhando
--   de formas diferentes é o pior estado possível — e ambos somem se a classificação entra aqui
--   antes de qualquer aplicação. Ver ADR-20260822-fronteira-lgpd-multi-unidade.md.
-- ============================================================================

-- Migration: LGPD — exclusão de conta vira ANONIMIZAÇÃO + lápide pseudônima (débito pré-piloto #5)
-- File: supabase/migrations/20260821000000_lgpd_account_anonymization.sql
-- ADR: .harness/memory-bank/decisions/ADR-20260821-anonimizacao-em-vez-de-exclusao.md
-- DDL aprovado (FONTE NORMATIVA): .harness/spec/lgpd-producao/ddl-aprovado.md
-- Gate: harness-architect (21/08/2026).
--
-- ============================================================================
-- PROBLEMA (em produção, pré-existente — nenhuma feature desta leva criou)
-- ----------------------------------------------------------------------------
--   auth.admin.deleteUser falha por DOIS caminhos independentes:
--     (1) auth.users --CASCADE--> workers --RESTRICT-- shift_payments / service_terms
--     (2) auth.users --CASCADE--> wallets --NO ACTION-- wallet_transactions / escrow_transactions
--   O produto promete o direito de eliminação (LGPD art. 18, VI) e não cumpre.
--
-- DECISÃO
-- ----------------------------------------------------------------------------
--   A credencial (auth.users) é APAGADA. As linhas de workers/companies/wallets SOBREVIVEM como
--   lápide pseudônima, sem conteúdo pessoal. Para isso as FKs CASCADE para auth.users são
--   REMOVIDAS. shift_payments e service_terms continuam RESTRICT e continuam intactos.
--
--   ⚠️ NÃO é "anonimização" no sentido do art. 5º, XI: term_text de termo ACEITO retém nome e CPF
--   como prova (art. 7º, VI + art. 16, I). É eliminação parcial + retenção justificada. A Política
--   de Privacidade PRECISA dizer isso (débito #1) antes desta rotina ir a público.
--
-- FRONTEIRA FINANCEIRA (Article 8/9) — INALTERADA
-- ----------------------------------------------------------------------------
--   Nenhum UPDATE em wallets.balance. Nenhum DELETE em wallet_transactions/escrow_transactions.
--   Nenhuma RPC de saldo tocada. A remoção da CASCADE de wallets EXISTE PARA PROTEGER o razão:
--   hoje a cascata tentaria apagar a carteira e o NO ACTION do razão derruba a transação inteira.
--
-- Risk: MEDIUM-HIGH — remove FKs de identidade em tabelas centrais e cria rotina destrutiva.
-- Backup required before production deploy: SIM (pg_dump de workers, companies, service_terms).
--
-- DOWN (rollback): ver rodapé.
-- ============================================================================

-- =============================================
-- 1. ASSERÇÕES DE SCHEMA — a migration FALHA FECHADO se o banco não for o esperado
--    "Migration não aplicada é migration não verificada": as colunas de `workers`/`companies`
--    NÃO têm DDL no repositório (tabelas criadas fora de migration). Em vez de assumir, exigimos.
--    Falha aqui = HALT, volta ao architect com a lista real de colunas. NÃO editar a lista
--    às cegas para "fazer passar".
-- =============================================
DO $$
DECLARE
    -- Colunas que a rotina ESCREVE (apaga ou substitui por valor). Emenda 2026-08-21:
    -- +badges_hidden, +accepts_referrals, +discoverable_for_sos (F10/F11/F12) e +companies.city.
    v_expected_workers   text[] := ARRAY[
        'full_name','cpf','phone','birth_date','pix_key','bio','city','avatar_url','cover_url',
        'primary_role','roles','tags','availability','availability_days','experience_years',
        'verified_identity','badges_hidden','accepts_referrals','discoverable_for_sos'
    ];
    v_expected_companies text[] := ARRAY[
        'name','cnpj','city','email','address','website','description','industry','logo_url',
        'cover_url','default_briefing'
    ];

    -- Emenda 2026-08-21 — asserção (c): dependentes de workers/companies JÁ CLASSIFICADOS em §2.1.
    -- Ver §2.1.0: a lápide neutraliza CASCADE/SET NULL/SET DEFAULT. Tabela fora desta lista =
    -- dado sobrevivendo em silêncio. NÃO adicionar nome aqui para "fazer passar": adicionar
    -- significa "eu decidi o que acontece com essa tabela e escrevi na §2.1".
    v_classified_deps text[] := ARRAY[
        'public.shift_payments',              -- RESTRICT, INTOCADA (documento fiscal)
        'public.service_terms',               -- RESTRICT, retido/redigido conforme aceite
        'public.team_connections',            -- DELETE
        'public.team_lists',                  -- DELETE (empresa)
        'public.team_list_members',           -- DELETE (freela) + cascata intra-domínio
        'public.payment_methods',             -- DELETE (empresa)
        'public.company_spend_limits',        -- DELETE (empresa)
        'public.company_monthly_revenue',     -- DELETE (empresa)
        'public.job_series',                  -- DELETE (empresa)
        'public.worker_certifications',       -- DELETE (freela) / verified_by_company_id RETIDO
        'public.worker_trainings',            -- DELETE (freela E empresa)
        'public.worker_referrals',            -- DELETE (3 predicados)
        'public.worker_company_badge_prefs',  -- DELETE + workers.badges_hidden = true
        -- EMENDA 2026-08-22 — fronteira com a F13 (multi-unidade). Ver §2.1 `company_members`.
        -- Sem esta linha, a F13 (que cria company_members REFERENCES companies) faz ESTA
        -- migration HALTar em todo replay de CI/staging a partir de zero, porque
        -- 20260818100000 ordena ANTES de 20260821000000.
        'public.company_members',             -- SOFT-REMOVE (status='removed') + purga de PII
        -- EMENDA 2026-08-22 (2) — achadas pela PRÓPRIA asserção (c) depois que o conserto do
        -- `regclass::text` acima a fez funcionar de verdade: ela acusou `applications` e `jobs`.
        -- NÃO é "adicionar para fazer passar" — a decisão já estava escrita em §2.1 "Demais
        -- tabelas": RETIDAS, chaves pseudônimas + timestamps, sem conteúdo pessoal, sustentando
        -- o BI e a integridade referencial de `shift_payments`. O que faltava era o NOME aqui.
        -- (As irmãs `shift_calls`/`shift_call_targets`/`shift_attendance_confirmations` NÃO
        --  aparecem porque penduram em `jobs`, não em workers/companies — a asserção só enxerga
        --  dependência DIRETA das duas âncoras, e é assim que deve ser.)
        'public.applications',                -- RETIDA (§2.1) — worker_id pseudônimo
        'public.jobs'                         -- RETIDA (§2.1) — company_id pseudônimo
    ];

    -- EMENDA 2026-08-22 — asserções (d)/(e): o universo do sweep POR NOME (ver §2.1.1).
    -- Toda tabela BASE de `public` que aponta para uma PESSOA ou guarda CONTATO precisa
    -- constar aqui. Diferente de v_classified_deps (que só enxerga dependência DECLARADA por
    -- FK), esta lista é a declaração de que a tabela foi olhada — com ou sem FK.
    v_classified_tables text[] := ARRAY[
        -- as duas âncoras
        'public.workers', 'public.companies',
        -- dependentes por FK (mesma decisão de v_classified_deps)
        'public.shift_payments', 'public.service_terms', 'public.team_connections',
        'public.team_lists', 'public.team_list_members', 'public.payment_methods',
        'public.company_spend_limits', 'public.company_monthly_revenue', 'public.job_series',
        'public.worker_certifications', 'public.worker_trainings', 'public.worker_referrals',
        'public.worker_company_badge_prefs', 'public.company_members',
        -- RETIDOS (§2.1 "Demais tabelas"): chave pseudônima + timestamp, sem conteúdo pessoal
        'public.applications', 'public.jobs', 'public.shift_calls', 'public.shift_call_targets',
        'public.shift_attendance_confirmations', 'public.reviews',
        -- Article 8/9 — INTOCADAS
        'public.wallets', 'public.wallet_transactions', 'public.escrow_transactions',
        -- apagadas pela RPC ou pela CASCADE de auth.users
        'public.notifications', 'public.analytics_events',
        -- conformidade do expurgo (#3) — não guarda dado pessoal, só contagem
        'public.data_retention_purge_runs',
        -- EMENDA 2026-08-22 (fronteira F13): ver §2.1
        'public.organization_members', 'public.organizations',
        -- LEGADO Prisma, NÃO auditado: fica FORA da RPC transacional, tratado (ou não) na Edge
        -- Function. Declarado aqui para não HALTar — a dívida está registrada em §5.3, não
        -- resolvida. NÃO copiar este tratamento para tabela viva.
        'public."Message"', 'public."Conversation"', 'public."User"',
        'public."ClientReview"', 'public."FreelancerReview"',
        'public."_JobToSkill"', 'public."_FreelancerProfileToSkill"',
        'public.messages', 'public.job_categories',
        -- infra do harness/agentes, sem titular de dado do produto
        'public.agent_kpis', 'public.agent_memory'
    ];

    -- Vocabulário de "esta coluna aponta para uma PESSOA". Não é heurística bonita: é a única
    -- varredura possível depois que H2 proibiu FK para auth.users (§2.1.1).
    v_person_cols text[] := ARRAY[
        'user_id','owner_id','created_by','worker_id','company_id','organization_id',
        'reviewer_id','reviewed_id','recorded_by','added_by','invited_by','blocked_by',
        'verified_by_company_id','referring_company_id','requesting_company_id',
        'freelancer_id','client_id','sender_id','recipient_id','author_id','member_id',
        'requested_by','responded_by','closed_by','accepted_by'
    ];

    v_col     text;
    v_unknown text;
BEGIN
    -- (a) toda coluna que a rotina PRETENDE apagar precisa existir
    FOREACH v_col IN ARRAY v_expected_workers LOOP
        IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                        WHERE table_schema = 'public' AND table_name = 'workers'
                          AND column_name = v_col) THEN
            RAISE EXCEPTION 'ASSERCAO: public.workers.% nao existe. HALT -> architect (ddl-aprovado 2.1).', v_col;
        END IF;
    END LOOP;

    FOREACH v_col IN ARRAY v_expected_companies LOOP
        IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                        WHERE table_schema = 'public' AND table_name = 'companies'
                          AND column_name = v_col) THEN
            RAISE EXCEPTION 'ASSERCAO: public.companies.% nao existe. HALT -> architect (ddl-aprovado 2.1).', v_col;
        END IF;
    END LOOP;

    -- (b) nenhuma coluna pode ficar FORA da classificação (apagada OU retida).
    --     Coluna nova não classificada = dado pessoal potencialmente sobrevivendo em silêncio.
    SELECT string_agg(c.column_name, ', ') INTO v_unknown
    FROM information_schema.columns c
    WHERE c.table_schema = 'public' AND c.table_name = 'workers'
      AND c.column_name <> ALL (v_expected_workers)
      AND c.column_name <> ALL (ARRAY[
            'id','xp','level','rating_average','reviews_count','completed_jobs_count',
            'earnings_total','profile_views','accepted_tos','tos_accepted_at','tos_version',
            'onboarding_completed','created_at','updated_at','anonymized_at'
      ]);
    IF v_unknown IS NOT NULL THEN
        RAISE EXCEPTION 'ASSERCAO: colunas nao classificadas em public.workers: %. HALT -> architect.', v_unknown;
    END IF;

    SELECT string_agg(c.column_name, ', ') INTO v_unknown
    FROM information_schema.columns c
    WHERE c.table_schema = 'public' AND c.table_name = 'companies'
      AND c.column_name <> ALL (v_expected_companies)
      AND c.column_name <> ALL (ARRAY[
            'id','owner_id','rating_average','reviews_count','onboarding_completed',
            'accepted_tos','tos_accepted_at','tos_version','created_at','updated_at',
            'link_risk_alert_enabled','link_risk_alert_threshold','anonymized_at',
            -- EMENDA 2026-08-22 (fronteira F13): RETIDA. FK pseudonima para a rede; a
            -- organizacao sobrevive porque pertence tambem as unidades IRMAS, de outros socios.
            -- Apagar seria dano a terceiro; e a Fase 1 da F13 poe NOT NULL nesta coluna.
            'organization_id'
      ]);
    IF v_unknown IS NOT NULL THEN
        RAISE EXCEPTION 'ASSERCAO: colunas nao classificadas em public.companies: %. HALT -> architect.', v_unknown;
    END IF;

    -- (c) EMENDA 2026-08-21 — nenhuma TABELA dependente pode ficar fora da classificação.
    --     Por que existe (§2.1.0): a lápide nunca é apagada, logo NENHUM ON DELETE pendurado em
    --     workers/companies dispara — CASCADE, SET NULL e SET DEFAULT viram NO ACTION de fato.
    --     O que antes o banco limpava de graça agora TEM de estar na RPC do §2.5.
    --     Esta asserção é o mecanismo que descobre tabela nova; a lista à mão só DECLARA a decisão.
    --     (F10 `worker_referrals` e F12 `worker_company_badge_prefs` nasceram depois do contrato
    --      congelado e passaram despercebidas justamente por não haver esta checagem.)
    -- ⚠️ EMENDA 2026-08-22 — NÃO usar `conrelid::regclass::text` para comparar com a lista.
    --    `regclass::text` OMITE o schema quando ele está no `search_path` (e as migrations do
    --    Supabase rodam com `public` no search_path). O texto sairia `shift_payments`, jamais
    --    casaria com `'public.shift_payments'`, e a asserção acusaria TODA tabela como não
    --    classificada. O nome é montado explicitamente a partir de `pg_namespace`/`pg_class`:
    --    determinístico, independente de search_path, e `%I` cita `"Message"` do mesmo jeito.
    SELECT string_agg(DISTINCT format('%I.%I', ns.nspname, cl.relname), ', ') INTO v_unknown
    FROM pg_constraint con
    JOIN pg_class     cl ON cl.oid = con.conrelid
    JOIN pg_namespace ns ON ns.oid = cl.relnamespace
    WHERE con.contype = 'f'
      AND con.confrelid IN ('public.workers'::regclass, 'public.companies'::regclass)
      AND con.conrelid NOT IN ('public.workers'::regclass, 'public.companies'::regclass)
      AND format('%I.%I', ns.nspname, cl.relname) <> ALL (v_classified_deps);
    IF v_unknown IS NOT NULL THEN
        RAISE EXCEPTION
          'ASSERCAO: tabelas dependentes de workers/companies NAO classificadas em §2.1: %. '
          'A lapide neutraliza ON DELETE (CASCADE/SET NULL/SET DEFAULT nao disparam mais): esse '
          'dado sobreviveria a exclusao da conta EM SILENCIO. HALT -> architect.', v_unknown;
    END IF;

    -- (d) EMENDA 2026-08-22 — SEGUNDA VARREDURA: ponteiro para pessoa SEM FK.
    --     Por que (c) não basta (§2.1.1): a asserção (c) enumera `pg_constraint`, e
    --     `pg_constraint` só conhece dependência DECLARADA. Depois de H2, uma coluna uuid que
    --     aponta para uma pessoa NÃO PODE ter FK: para `auth.users` a FK está proibida (CASCADE
    --     destruiria a lápide; NO ACTION voltaria a BLOQUEAR o deleteUser — o bug que esta leva
    --     existe para corrigir). Ou seja, "uuid nu apontando para gente" não é desleixo de
    --     ninguém: é a forma CANÔNICA e PERMANENTE que este desenho impõe. Logo a varredura por
    --     catálogo de FK é estruturalmente incompleta, e a varredura por NOME é obrigatória.
    --     Descoberta que motivou: `organization_members.user_id` e `organizations.created_by`
    --     (F13) são invisíveis para (c) E para a RPC do §2.5.
    -- pg_catalog e não `information_schema`: este último só mostra o que o papel corrente tem
    -- privilégio de ver, e uma varredura que FALHA ABERTO por falta de privilégio não serve de
    -- guarda. (As asserções (a)/(b) usam information_schema por herança; ali o alvo é
    -- workers/companies, sempre visíveis. Aqui o alvo é "tabela que eu não conheço".)
    SELECT string_agg(DISTINCT format('%I.%I', ns.nspname, cl.relname), ', ') INTO v_unknown
    FROM pg_attribute  a
    JOIN pg_class      cl ON cl.oid = a.attrelid
    JOIN pg_namespace  ns ON ns.oid = cl.relnamespace
    WHERE ns.nspname = 'public'
      AND cl.relkind = 'r'
      AND a.attnum > 0
      AND NOT a.attisdropped
      AND a.atttypid = 'uuid'::regtype
      AND a.attname = ANY (v_person_cols)
      AND format('%I.%I', ns.nspname, cl.relname) <> ALL (v_classified_tables);
    IF v_unknown IS NOT NULL THEN
        RAISE EXCEPTION
          'ASSERCAO (d): tabela com ponteiro-de-pessoa NAO classificada em §2.1: %. '
          'FK nao e exigivel aqui (H2 proibiu FK para auth.users), entao o catalogo nao acha '
          'sozinho — a classificacao e obrigacao de quem cria a tabela. HALT -> architect.',
          v_unknown;
    END IF;

    -- (e) EMENDA 2026-08-22 — TERCEIRA VARREDURA: contato/identificador de pessoa natural.
    --     Independente de (d): pega dado pessoal DIRETO (não pseudônimo) onde ninguém procurou.
    --     Foi o que expôs `company_members.invited_email` (F13) e, antes dele,
    --     `company_spend_limits.financial_contact_email`, que sobreviveu à exclusão da conta
    --     durante meses porque a CASCADE "dava conta" — e deixou de dar com a lápide.
    SELECT string_agg(DISTINCT format('%I.%I', ns.nspname, cl.relname), ', ') INTO v_unknown
    FROM pg_attribute  a
    JOIN pg_class      cl ON cl.oid = a.attrelid
    JOIN pg_namespace  ns ON ns.oid = cl.relnamespace
    WHERE ns.nspname = 'public'
      AND cl.relkind = 'r'
      AND a.attnum > 0
      AND NOT a.attisdropped
      AND a.attname ~ '(email|phone|cpf|cnpj|pix|birth_date|full_name)'
      AND format('%I.%I', ns.nspname, cl.relname) <> ALL (v_classified_tables);
    IF v_unknown IS NOT NULL THEN
        RAISE EXCEPTION
          'ASSERCAO (e): tabela com contato/identificador de pessoa natural NAO classificada '
          'em §2.1: %. Esse dado NAO e pseudonimo e sobreviveria a exclusao da conta. '
          'HALT -> architect.', v_unknown;
    END IF;
END $$;

-- Nota sobre a asserção (c) — por que ela cobre `SET NULL` também.
-- O filtro NÃO discrimina `confdeltype`. É de propósito: `RESTRICT`/`NO ACTION` continuam sendo
-- dependência que a rotina precisa ter pensado (é o caso de `shift_payments`/`service_terms`,
-- cuja decisão foi "INTOCADA"), e `SET NULL` é justamente o caso de
-- `worker_certifications.verified_by_company_id`, que também deixou de disparar. Uma dependência
-- decidida como "nada a fazer" entra na lista igual — o que não pode existir é dependência
-- NÃO decidida.

-- =============================================
-- 2. REMOÇÃO DAS FKs CASCADE PARA auth.users
--    Descoberta dinâmica: o nome da constraint NÃO está no repositório (tabelas criadas fora de
--    migration). NUNCA hard-codar `workers_id_fkey`.
--    Idempotente: rodar duas vezes não faz nada na segunda.
-- =============================================
DO $$
DECLARE
    r          record;
    v_leftover text;
BEGIN
    FOR r IN
        SELECT con.conname, con.conrelid::regclass::text AS tbl
        FROM pg_constraint con
        WHERE con.contype = 'f'
          AND con.confrelid = 'auth.users'::regclass
          AND con.conrelid IN ('public.workers'::regclass,
                               'public.companies'::regclass,
                               'public.wallets'::regclass)
    LOOP
        RAISE NOTICE 'Removendo FK % em % -> auth.users (lapide LGPD).', r.conname, r.tbl;
        EXECUTE format('ALTER TABLE %s DROP CONSTRAINT %I', r.tbl, r.conname);
    END LOOP;

    -- Qualquer OUTRA tabela que ainda apague em cascata junto com auth.users precisa ser
    -- conscientemente revisada: se guardar dado retido, deleteUser o destrói em silêncio.
    -- A lista abaixo é a de tabelas cujo apagamento em cascata é DESEJADO.
    -- EMENDA 2026-08-22: mesma correção de search_path da asserção (c) — ver nota lá.
    SELECT string_agg(DISTINCT format('%I.%I', ns.nspname, cl.relname), ', ') INTO v_leftover
    FROM pg_constraint con
    JOIN pg_class     cl ON cl.oid = con.conrelid
    JOIN pg_namespace ns ON ns.oid = cl.relnamespace
    WHERE con.contype = 'f'
      AND con.confrelid = 'auth.users'::regclass
      AND con.confdeltype = 'c'   -- 'c' = CASCADE
      AND format('%I.%I', ns.nspname, cl.relname) <> ALL (ARRAY[
            'public.notifications', 'public.analytics_events',
            'public."Message"', 'public."Conversation"'
      ]);
    IF v_leftover IS NOT NULL THEN
        RAISE EXCEPTION
          'ASSERCAO: FK CASCADE para auth.users nao revisada em: %. deleteUser apagaria esse dado. HALT -> architect.',
          v_leftover;
    END IF;
END $$;

-- =============================================
-- 3. MARCADOR DE LÁPIDE
--    ADD COLUMN nullable sem DEFAULT = sem reescrita de heap.
-- =============================================
ALTER TABLE public.workers   ADD COLUMN IF NOT EXISTS anonymized_at timestamptz;
ALTER TABLE public.companies ADD COLUMN IF NOT EXISTS anonymized_at timestamptz;

COMMENT ON COLUMN public.workers.anonymized_at IS
    'Lapide LGPD: a conta foi excluida (auth.users apagado) e o conteudo pessoal desta linha foi '
    'removido por anonymize_account(). A linha SOBREVIVE porque e chave pseudonima de shift_payments '
    'e service_terms (retencao por obrigacao legal, art. 16 I). NULL = conta viva. One-way.';
COMMENT ON COLUMN public.companies.anonymized_at IS
    'Lapide LGPD — ver public.workers.anonymized_at.';

-- Índices parciais: a lápide é minoria, e a consulta útil é "quem já foi anonimizado".
-- Sem CONCURRENTLY: migration do Supabase roda dentro de transação.
CREATE INDEX IF NOT EXISTS idx_workers_anonymized
    ON public.workers (anonymized_at) WHERE anonymized_at IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_companies_anonymized
    ON public.companies (anonymized_at) WHERE anonymized_at IS NOT NULL;

-- =============================================
-- 4. IMUTABILIDADE DO TERMO — emenda LGPD
--    Delta único: accepted_ip / accepted_user_agent podem ir a NULL (e SÓ a NULL) dentro da
--    transição de anonimização (anonymized_at NULL -> ts). IP é dado pessoal autônomo e
--    user-agent é fingerprint; nenhum dos dois é elemento do negócio jurídico, e o próprio
--    schema os declara BEST-EFFORT e FALSIFICÁVEIS.
-- =============================================
CREATE OR REPLACE FUNCTION public.enforce_service_term_immutability()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    -- EMENDA 2026-08-21: a transição de anonimização, calculada uma vez.
    v_anonymizing boolean := (OLD.anonymized_at IS NULL AND NEW.anonymized_at IS NOT NULL);
BEGIN
    -- === Vínculo e valor: imutáveis SEMPRE ===
    IF NEW.id               IS DISTINCT FROM OLD.id
       OR NEW.shift_payment_id IS DISTINCT FROM OLD.shift_payment_id
       OR NEW.job_id           IS DISTINCT FROM OLD.job_id
       OR NEW.worker_id        IS DISTINCT FROM OLD.worker_id
       OR NEW.company_id       IS DISTINCT FROM OLD.company_id
       OR NEW.amount           IS DISTINCT FROM OLD.amount
       OR NEW.created_at       IS DISTINCT FROM OLD.created_at
    THEN
        RAISE EXCEPTION 'service_terms: vinculo e valor sao imutaveis (shift_payment_id, job_id, worker_id, company_id, amount, created_at).';
    END IF;

    -- === accepted_at: ONE-WAY (NULL -> timestamp). Nunca altera, nunca limpa. ===
    IF OLD.accepted_at IS NOT NULL AND NEW.accepted_at IS DISTINCT FROM OLD.accepted_at THEN
        RAISE EXCEPTION 'service_terms: accepted_at e imutavel apos o aceite.';
    END IF;

    -- === IP/UA: só podem ser gravados NO aceite; nunca reescritos depois. ===
    -- EMENDA 2026-08-21 (LGPD): exceção única — a anonimização pode APAGÁ-LOS (levar a NULL).
    -- Levar a QUALQUER OUTRO VALOR continua proibido: não se falsifica trilha de aceite.
    IF OLD.accepted_at IS NOT NULL
       AND (NEW.accepted_ip         IS DISTINCT FROM OLD.accepted_ip
         OR NEW.accepted_user_agent IS DISTINCT FROM OLD.accepted_user_agent)
       AND NOT (v_anonymizing
                AND NEW.accepted_ip IS NULL
                AND NEW.accepted_user_agent IS NULL)
    THEN
        RAISE EXCEPTION 'service_terms: accepted_ip/accepted_user_agent sao imutaveis apos o aceite (unica excecao: anonimizacao LGPD, e apenas para NULL).';
    END IF;

    -- === anonymized_at: ONE-WAY (NULL -> timestamp). Nunca volta. ===
    IF OLD.anonymized_at IS NOT NULL AND NEW.anonymized_at IS DISTINCT FROM OLD.anonymized_at THEN
        RAISE EXCEPTION 'service_terms: anonymized_at e imutavel.';
    END IF;

    -- === term_text / term_version: livres ENQUANTO rascunho; congelados no aceite. ===
    -- Única exceção pós-aceite: a anonimização LGPD (NULL -> ts), que é o ato de
    -- reescrever o texto. Fora dela, um termo aceito não muda mais.
    IF OLD.accepted_at IS NOT NULL
       AND (NEW.term_text IS DISTINCT FROM OLD.term_text
         OR NEW.term_version IS DISTINCT FROM OLD.term_version)
       AND NOT v_anonymizing
    THEN
        RAISE EXCEPTION 'service_terms: term_text/term_version sao imutaveis apos o aceite (unica excecao: anonimizacao LGPD).';
    END IF;

    RETURN NEW;
END;
$$;

COMMENT ON FUNCTION public.enforce_service_term_immutability() IS
    'BEFORE UPDATE em service_terms. term_text e rascunho enquanto accepted_at IS NULL e CONGELA no '
    'aceite. Vale para TODOS os papeis (service_role e owner inclusive) — RLS nao cobriria. Unica '
    'reescrita pos-aceite: anonimizacao LGPD (anonymized_at NULL->ts), que tambem pode APAGAR '
    'accepted_ip/accepted_user_agent (so para NULL). ADR-20260818 + ADR-20260821.';

COMMENT ON COLUMN public.service_terms.anonymized_at IS
    'Marca que a linha passou pela rotina de anonimizacao de conta (anonymize_account). One-way, '
    'fechada ao client. Habilita DUAS reescritas e so elas: (1) term_text, usada APENAS quando o '
    'termo era RASCUNHO (accepted_at IS NULL) — termo ACEITO e RETIDO INTEGRALMENTE como prova de '
    'transacao encerrada (LGPD art. 7 VI / art. 16 I, ADR-20260818); (2) accepted_ip / '
    'accepted_user_agent -> NULL (telemetria; nao e elemento do negocio juridico).';

-- =============================================
-- 5. RPC DE ANONIMIZAÇÃO
--    Uma transação (corpo de função = transação): ou a conta inteira é anonimizada, ou nada.
--    SECURITY DEFINER + search_path='' + GRANT EXECUTE SOMENTE a service_role.
--    Chamada exclusivamente pela Edge Function `delete-account` (Article 10).
--    Devolve `outcome` estruturado — NUNCA levanta exceção em caminho esperado.
-- =============================================
CREATE OR REPLACE FUNCTION public.anonymize_account(p_user_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_now           timestamptz := now();
    v_is_worker     boolean;
    v_company_ids   uuid[];
    v_balance       numeric;
    v_counts        jsonb := '{}'::jsonb;
    v_n             integer;
    v_txt           text;          -- EMENDA 2026-08-22 (GUARDA 4, fronteira F13)
    v_is_member     boolean := false;  -- EMENDA 2026-08-22 (classe GERENTE/SOCIO, fronteira F13)
    c_worker_label  constant text := '[Conta Deletada]';
    c_company_label constant text := '[Empresa Deletada]';
    c_redacted      constant text :=
        '[TERMO REMOVIDO — a conta do titular foi excluida a pedido dele (LGPD art. 18, VI). '
        'Este termo nao havia sido aceito e, portanto, nao possui valor probatorio.]';
BEGIN
    IF p_user_id IS NULL THEN
        RETURN jsonb_build_object('outcome', 'invalid_input');
    END IF;

    SELECT EXISTS (SELECT 1 FROM public.workers w WHERE w.id = p_user_id) INTO v_is_worker;

    -- Ancoragem DUPLA de empresa (mesma regra de is_company_owner / is_job_owner):
    -- companies.id = auth.uid() no caso canônico, owner_id nos registros com dono separado.
    SELECT array_agg(c.id) INTO v_company_ids
    FROM public.companies c
    WHERE c.id = p_user_id OR c.owner_id = p_user_id;
    v_company_ids := coalesce(v_company_ids, ARRAY[]::uuid[]);

    -- ---- EMENDA 2026-08-22: a classe GERENTE/SOCIO tambem e titular ----
    -- Sem isto, `not_found` era devolvido para um usuario LEGITIMO. O gerente da F13, depois de
    -- `accept_manager_invite`, NAO tem linha em `companies` (a casca e APAGADA de proposito,
    -- 20260818100300) e nunca teve linha em `workers`: as duas ancoras acima dao vazio. O socio
    -- de rede que nao e dono de nenhuma unidade cai no mesmo buraco.
    --
    -- Tratar isso apenas como "a Edge Function aborta antes do deleteUser" fecharia o furo de
    -- SEGURANCA (credencial apagada com o vinculo ativo) as custas de criar um furo de DIREITO:
    -- essa pessoa ficaria PERMANENTEMENTE impedida de excluir a propria conta -- violando o
    -- art. 18, VI dentro da rotina que existe justamente para cumpri-lo. O portao correto e
    -- reconhecer a classe, nao recusa-la.
    --
    -- O corpo da rotina ja atende este caso sem nenhuma outra mudanca: os blocos de
    -- workers/companies nao acham linha e nao fazem nada, e os blocos de
    -- company_members/organization_members fecham o vinculo pelo predicado `user_id = $1`
    -- (o ramo por `company_id` recebe array vazio e e inofensivo).
    IF pg_catalog.to_regclass('public.company_members') IS NOT NULL THEN
        EXECUTE 'SELECT EXISTS (SELECT 1 FROM public.company_members WHERE user_id = $1)'
           INTO v_is_member USING p_user_id;
    END IF;
    IF NOT v_is_member AND pg_catalog.to_regclass('public.organization_members') IS NOT NULL THEN
        EXECUTE 'SELECT EXISTS (SELECT 1 FROM public.organization_members WHERE user_id = $1)'
           INTO v_is_member USING p_user_id;
    END IF;

    IF NOT v_is_worker AND cardinality(v_company_ids) = 0 AND NOT v_is_member THEN
        -- Agora `not_found` significa mesmo "nao existe titular", e segue valendo como FALHA
        -- para a Edge Function (§4): nunca seguir para o deleteUser depois deste retorno.
        RETURN jsonb_build_object('outcome', 'not_found');
    END IF;

    -- ---- GUARDA 1: saldo. Article 8 — não zeramos saldo aqui; RECUSAMOS. ----
    SELECT w.balance INTO v_balance FROM public.wallets w WHERE w.user_id = p_user_id;
    IF coalesce(v_balance, 0) > 0 THEN
        RETURN jsonb_build_object('outcome', 'wallet_has_balance', 'balance', v_balance);
    END IF;

    -- ---- GUARDA 2: escrow em aberto ----
    IF EXISTS (
        SELECT 1
        FROM public.escrow_transactions e
        JOIN public.wallets w
          ON w.id = e.company_wallet_id OR w.id = e.worker_wallet_id
        WHERE w.user_id = p_user_id
          AND e.status IN ('reserved', 'authorized')
    ) THEN
        RETURN jsonb_build_object('outcome', 'escrow_active');
    END IF;

    -- ---- GUARDA 3: pagamento prometido e não liquidado (modo A) ----
    IF EXISTS (
        SELECT 1 FROM public.shift_payments sp
        WHERE sp.status = 'scheduled'
          AND (sp.worker_id = p_user_id OR sp.company_id = ANY (v_company_ids))
    ) THEN
        RETURN jsonb_build_object('outcome', 'scheduled_payment_pending');
    END IF;

    -- ---- GUARDA 4 (EMENDA 2026-08-22): ultimo dono de organizacao com unidade de terceiro ----
    -- Fronteira com a F13. Mesma filosofia das guardas 1-3: quando a exclusao causaria dano
    -- IRREVERSIVEL a TERCEIRO, a rotina RECUSA e diz o que fazer -- nao destroi em silencio.
    -- Se este for o UNICO `organization_members.role='owner'` ativo de uma organizacao que ainda
    -- tem unidade que NAO e dele, fechar o vinculo (abaixo) deixaria a rede ORFA: ninguem mais
    -- passa em `is_organization_operator`, e os dois `ON DELETE RESTRICT`
    -- (companies.organization_id e organization_members.organization_id) impedem qualquer
    -- limpeza. Rede inoperavel e inapagavel, com unidades de socios que nao pediram nada.
    -- Remediavel pelo proprio titular: promover outro socio a `owner` e repetir a exclusao.
    -- CONFIRMAR COM JURIDICO (ddl-aprovado 5.4): e bloqueio temporario e sanavel pelo titular,
    -- da mesma classe de `wallet_has_balance`; a leitura de art. 18 VI assumida e que isso NAO e
    -- recusa do direito, e sim pre-condicao operacional. Nao subir a publico sem esse aval.
    -- Executado dinamicamente: esta migration PODE ir ao banco antes da F13.
    IF pg_catalog.to_regclass('public.organization_members') IS NOT NULL THEN
        EXECUTE $q$
            SELECT string_agg(DISTINCT om.organization_id::text, ', ')
            FROM public.organization_members om
            WHERE om.user_id = $1
              AND om.status  = 'active'
              AND om.role    = 'owner'
              AND NOT EXISTS (
                    SELECT 1 FROM public.organization_members o2
                     WHERE o2.organization_id = om.organization_id
                       AND o2.status = 'active'
                       AND o2.role   = 'owner'
                       AND o2.user_id IS DISTINCT FROM $1)
              AND EXISTS (
                    SELECT 1 FROM public.companies c
                     WHERE c.organization_id = om.organization_id
                       AND c.id <> ALL ($2))
        $q$ INTO v_txt USING p_user_id, v_company_ids;

        IF v_txt IS NOT NULL THEN
            RETURN jsonb_build_object('outcome', 'sole_organization_owner',
                                      'organization_ids', v_txt);
        END IF;
    END IF;

    -- =========================================================
    -- A PARTIR DAQUI É DESTRUTIVO. Tudo numa transação só.
    -- =========================================================

    -- ---- service_terms: rascunho é redigido; termo ACEITO é retido (só ip/ua saem) ----
    -- UM ÚNICO UPDATE por linha: o trigger só libera a reescrita quando anonymized_at vai de
    -- NULL para ts NO MESMO statement. Dois UPDATEs separados seriam BARRADOS.
    UPDATE public.service_terms st
       SET term_text           = CASE WHEN st.accepted_at IS NULL THEN c_redacted ELSE st.term_text END,
           accepted_ip         = NULL,
           accepted_user_agent = NULL,
           anonymized_at       = v_now
     WHERE st.anonymized_at IS NULL
       AND (st.worker_id = p_user_id OR st.company_id = ANY (v_company_ids));
    GET DIAGNOSTICS v_n = ROW_COUNT;
    v_counts := v_counts || jsonb_build_object('service_terms', v_n);

    -- ---- certificações/treinamentos do freela: DELETE (ramo (c) do trigger F8 barra UPDATE) ----
    IF v_is_worker THEN
        DELETE FROM public.worker_certifications wc WHERE wc.worker_id = p_user_id;
        GET DIAGNOSTICS v_n = ROW_COUNT;
        v_counts := v_counts || jsonb_build_object('worker_certifications', v_n);

        DELETE FROM public.worker_trainings wt WHERE wt.worker_id = p_user_id;
        GET DIAGNOSTICS v_n = ROW_COUNT;
        v_counts := v_counts || jsonb_build_object('worker_trainings', v_n);

        DELETE FROM public.team_list_members tlm WHERE tlm.worker_id = p_user_id;
        GET DIAGNOSTICS v_n = ROW_COUNT;
        v_counts := v_counts || jsonb_build_object('team_list_members', v_n);
    END IF;

    -- ---- EMENDA 2026-08-21: ramo EMPRESA (era mais fino que o ramo freela — §2.1.0, item 4) ----
    IF cardinality(v_company_ids) > 0 THEN
        -- `team_lists` apaga `team_list_members` por cascata INTRA-DOMÍNIO (a FK aponta para
        -- team_lists(id), que é apagada de verdade — essa cascata continua disparando).
        DELETE FROM public.team_lists tl WHERE tl.company_id = ANY (v_company_ids);
        GET DIAGNOSTICS v_n = ROW_COUNT;
        v_counts := v_counts || jsonb_build_object('team_lists', v_n);

        -- financial_contact_email / financial_contact_phone = contato de pessoa natural.
        DELETE FROM public.company_spend_limits csl WHERE csl.company_id = ANY (v_company_ids);
        GET DIAGNOSTICS v_n = ROW_COUNT;
        v_counts := v_counts || jsonb_build_object('company_spend_limits', v_n);

        DELETE FROM public.company_monthly_revenue cmr WHERE cmr.company_id = ANY (v_company_ids);
        GET DIAGNOSTICS v_n = ROW_COUNT;
        v_counts := v_counts || jsonb_build_object('company_monthly_revenue', v_n);

        -- job_template carrega briefing (mesma classe de companies.default_briefing).
        -- Seguro: NÃO há FK de jobs para job_series — as ocorrências materializadas permanecem.
        DELETE FROM public.job_series js WHERE js.company_id = ANY (v_company_ids);
        GET DIAGNOSTICS v_n = ROW_COUNT;
        v_counts := v_counts || jsonb_build_object('job_series', v_n);

        -- anotação interna que a empresa escreveu sobre terceiros que CONTINUAM na plataforma.
        DELETE FROM public.worker_trainings wt WHERE wt.company_id = ANY (v_company_ids);
        GET DIAGNOSTICS v_n = ROW_COUNT;
        v_counts := v_counts || jsonb_build_object('worker_trainings_company', v_n);
    END IF;

    -- ---- vínculo de elenco: dos dois lados ----
    DELETE FROM public.team_connections tc
     WHERE tc.worker_id = p_user_id OR tc.company_id = ANY (v_company_ids);
    GET DIAGNOSTICS v_n = ROW_COUNT;
    v_counts := v_counts || jsonb_build_object('team_connections', v_n);

    -- ---- EMENDA 2026-08-21: indicação entre empresas (F10) — grafo sobre a pessoa ----
    -- TRÊS predicados: a indicação é um triângulo (freela, quem indica, para quem se indica).
    -- A proveniência do BI de aquisição NÃO se perde: vive em team_connections.source='referral'.
    DELETE FROM public.worker_referrals wr
     WHERE wr.worker_id = p_user_id
        OR wr.referring_company_id  = ANY (v_company_ids)
        OR wr.requesting_company_id = ANY (v_company_ids);
    GET DIAGNOSTICS v_n = ROW_COUNT;
    v_counts := v_counts || jsonb_build_object('worker_referrals', v_n);

    -- ---- EMENDA 2026-08-21: opt-out de badge por empresa (F12) ----
    -- ⚠️ Este DELETE só é seguro porque a lápide de `workers` seta badges_hidden = true logo
    --    abaixo. Sozinho, ele RESSUSCITARIA os badges que estas linhas suprimiam (o badge é
    --    derivado de applications/jobs/reviews, todos RETIDOS). Os dois andam juntos.
    DELETE FROM public.worker_company_badge_prefs bp
     WHERE bp.worker_id = p_user_id OR bp.company_id = ANY (v_company_ids);
    GET DIAGNOSTICS v_n = ROW_COUNT;
    v_counts := v_counts || jsonb_build_object('worker_company_badge_prefs', v_n);

    -- ---- EMENDA 2026-08-22: vinculo de operacao (F13) -- SOFT-REMOVE, nunca DELETE ----
    -- Executado dinamicamente porque esta migration pode ser aplicada ANTES da F13 (em producao
    -- ela E a proxima da fila; em CI a F13 vem antes). `to_regclass` NULL = tabela ainda nao
    -- existe = nada a fazer, sem erro. Quando a F13 subir, o mesmo corpo passa a agir.
    --
    -- POR QUE SOFT E NAO DELETE (ver 2.1): a propria F13 ja decidiu que este vinculo NAO se
    -- apaga (`revoke_company_manager`: "NUNCA DELETE"; `ON DELETE RESTRICT` em company_id). A
    -- rotina de LGPD nao pode ser a porta dos fundos que faz o que a RPC do produto recusa:
    -- apagar a linha levaria junto o registro de QUEM operou a unidade e QUANDO -- e os turnos,
    -- convites e pagamentos que essa pessoa criou continuam existindo, pendurados na UNIDADE, e
    -- ficariam sem referencia de autoria. Reter tambem e errado: `status='active'` e
    -- autorizacao operacional, e quem pediu exclusao nao pode seguir operando.
    --
    -- O QUE SAI: `invited_email` (e-mail de pessoa natural -- dado pessoal DIRETO, nao
    -- pseudonimo, e O item de PII desta tabela) e `invite_token` (credencial portadora: convite
    -- pendente de conta excluida nao pode continuar resgatavel). O que FICA: `user_id` e
    -- `created_by` -- uuid pseudonimo apontando para uma lapide, mesma regua de
    -- `worker_certifications.verified_by_company_id`; e `invited_at`/`accepted_at`, que sao a
    -- trilha de auditoria que justifica o soft.
    --
    -- DOIS predicados: (1) a pessoa que sai era gerente de unidades alheias -> perde o acesso;
    -- (2) a EMPRESA que sai tinha gerentes que CONTINUAM na plataforma -> a unidade virou
    -- lapide, ninguem opera lapide, e o e-mail desses terceiros perde a base que o sustentava.
    IF pg_catalog.to_regclass('public.company_members') IS NOT NULL THEN
        EXECUTE $q$
            UPDATE public.company_members cm
               SET status = CASE WHEN cm.status IN ('invited', 'active')
                                 THEN 'removed' ELSE cm.status END,
                   invited_email = NULL,
                   invite_token  = NULL
             WHERE (cm.user_id = $1 OR cm.company_id = ANY ($2))
               AND (cm.status IN ('invited', 'active')
                    OR cm.invited_email IS NOT NULL
                    OR cm.invite_token  IS NOT NULL)
        $q$ USING p_user_id, v_company_ids;
        GET DIAGNOSTICS v_n = ROW_COUNT;
        v_counts := v_counts || jsonb_build_object('company_members', v_n);
    END IF;

    -- ---- EMENDA 2026-08-22: vinculo de rede (F13) -- idem, SEM ramo por empresa ----
    -- Aqui NAO existe predicado por `company_id`: a organizacao pertence tambem as unidades
    -- IRMAS, de outros socios. Excluir a conta de UM socio nao desliga os outros.
    -- Ramo (2): convite AINDA PENDENTE emitido por quem esta saindo. Um convite de rede assinado
    -- por uma conta que deixou de existir nao deve continuar aceitavel -- e carrega o e-mail de
    -- um terceiro. A GUARDA 4 acima ja garantiu que a rede nao fica sem dono ao fazer isto.
    IF pg_catalog.to_regclass('public.organization_members') IS NOT NULL THEN
        EXECUTE $q$
            UPDATE public.organization_members om
               SET status = CASE WHEN om.status IN ('invited', 'active')
                                 THEN 'removed' ELSE om.status END,
                   invited_email = NULL,
                   invite_token  = NULL
             WHERE (om.user_id = $1
                    OR (om.status = 'invited' AND om.created_by = $1))
               AND (om.status IN ('invited', 'active')
                    OR om.invited_email IS NOT NULL
                    OR om.invite_token  IS NOT NULL)
        $q$ USING p_user_id;
        GET DIAGNOSTICS v_n = ROW_COUNT;
        v_counts := v_counts || jsonb_build_object('organization_members', v_n);
    END IF;

    -- ---- `organizations`: RETIDA, nada a fazer (declarado, nao esquecido) ----
    -- `name` e o nome da REDE, compartilhado com as unidades irmas de outros socios; apaga-lo
    -- seria dano a terceiro. `created_by` e uuid pseudonimo apontando para lapide -- mesma regua
    -- de `worker_certifications.verified_by_company_id`. Nao ha coluna de contato.

    -- ---- notificações: texto com nome, valor e link ----
    DELETE FROM public.notifications n WHERE n.user_id = p_user_id;
    GET DIAGNOSTICS v_n = ROW_COUNT;
    v_counts := v_counts || jsonb_build_object('notifications', v_n);

    -- ---- token de cartão da empresa (revogar no Asaas é da Edge Function) ----
    IF cardinality(v_company_ids) > 0 THEN
        DELETE FROM public.payment_methods pm WHERE pm.company_id = ANY (v_company_ids);
        GET DIAGNOSTICS v_n = ROW_COUNT;
        v_counts := v_counts || jsonb_build_object('payment_methods', v_n);
    END IF;

    -- ---- LÁPIDE: workers ----
    IF v_is_worker THEN
        UPDATE public.workers w
           SET full_name         = c_worker_label,
               cpf               = NULL,
               phone             = NULL,
               birth_date        = NULL,
               pix_key           = NULL,
               bio               = NULL,
               city              = NULL,
               avatar_url        = NULL,
               cover_url         = NULL,
               primary_role      = NULL,
               roles             = NULL,
               tags              = NULL,
               availability      = NULL,
               availability_days = NULL,
               experience_years  = NULL,
               verified_identity = false,
               -- EMENDA 2026-08-21 — flags de alcance/exposição (F10/F11/F12).
               -- Não são "boolean sem conteúdo pessoal": governam quem alcança e quem enxerga
               -- o grafo desta pessoa. Ver §2.1 (workers) para o raciocínio de cada uma.
               badges_hidden        = true,   -- fecha "Já trabalhou com" (derivado de dado RETIDO)
               accepts_referrals    = false,  -- não é mais oferecível a outras empresas
               discoverable_for_sos = false,  -- sai do pool de SOS (o predicado de F11 não filtra lápide)
               anonymized_at     = coalesce(w.anonymized_at, v_now)
         WHERE w.id = p_user_id;
        GET DIAGNOSTICS v_n = ROW_COUNT;
        v_counts := v_counts || jsonb_build_object('workers', v_n);
    END IF;

    -- ---- LÁPIDE: companies ----
    IF cardinality(v_company_ids) > 0 THEN
        UPDATE public.companies c
           SET name             = c_company_label,
               cnpj             = NULL,
               city             = NULL,   -- EMENDA 2026-08-21: subconjunto de `address`, que já sai
               email            = NULL,
               address          = NULL,
               website          = NULL,
               description      = NULL,
               industry         = NULL,
               logo_url         = NULL,
               cover_url        = NULL,
               default_briefing = NULL,
               anonymized_at    = coalesce(c.anonymized_at, v_now)
         WHERE c.id = ANY (v_company_ids);
        GET DIAGNOSTICS v_n = ROW_COUNT;
        v_counts := v_counts || jsonb_build_object('companies', v_n);
    END IF;

    RETURN jsonb_build_object(
        'outcome',       'anonymized',
        'user_id',       p_user_id,
        'is_worker',     v_is_worker,
        'company_ids',   to_jsonb(v_company_ids),
        'anonymized_at', v_now,
        'counts',        v_counts
    );
END;
$$;

COMMENT ON FUNCTION public.anonymize_account(uuid) IS
    'LGPD art. 18 VI — remove o conteudo pessoal da conta e deixa uma LAPIDE PSEUDONIMA '
    '(workers/companies/wallets sobrevivem porque sao chave de shift_payments/service_terms, '
    'retidos por obrigacao legal — art. 16 I). NAO toca saldo nem razao (Article 8/9): recusa com '
    'outcome se houver saldo, escrow ativo ou pagamento agendado pendente. Chamada SO pela Edge '
    'Function delete-account (service_role). Devolve outcome, nunca excecao em caminho esperado. '
    'Idempotente: rodar de novo devolve counts zerados e outcome anonymized. ADR-20260821. '
    'EMENDA 2026-08-22 (F13): fecha company_members/organization_members por SOFT-REMOVE '
    '(status=removed + purga de invited_email/invite_token), NUNCA DELETE — o vinculo de operacao '
    'e trilha de auditoria. Recusa com outcome=sole_organization_owner se a exclusao deixaria uma '
    'organizacao com unidades de TERCEIROS sem nenhum dono ativo. ADR-20260822.';

REVOKE ALL ON FUNCTION public.anonymize_account(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.anonymize_account(uuid) TO service_role;

-- ============================================================================
-- COMO VERIFICAR (obrigatório após aplicar — sem isto, a migration NÃO está verificada)
-- ----------------------------------------------------------------------------
-- V1. Nenhuma FK CASCADE de identidade sobreviveu:
--     SELECT conrelid::regclass, conname, confdeltype FROM pg_constraint
--      WHERE contype='f' AND confrelid='auth.users'::regclass;
--     ⇒ workers, companies e wallets NÃO podem aparecer.
--
-- V2. Ensaio em conta de TESTE (nunca em conta real):
--     SELECT public.anonymize_account('<uuid-de-teste>');
--     ⇒ outcome='anonymized'; conferir counts.
--     SELECT full_name, cpf, phone, pix_key, anonymized_at FROM public.workers WHERE id='<uuid>';
--     ⇒ '[Conta Deletada]', NULL, NULL, NULL, timestamp.
--
-- V3. Termo ACEITO foi RETIDO e a telemetria saiu:
--     SELECT accepted_at IS NOT NULL AS aceito, length(term_text) > 0 AS texto_retido,
--            accepted_ip, accepted_user_agent, anonymized_at
--       FROM public.service_terms WHERE worker_id='<uuid>';
--     ⇒ aceito=t, texto_retido=t, ip/ua NULL, anonymized_at preenchido.
--
-- V4. Termo RASCUNHO foi redigido ⇒ term_text começa com '[TERMO REMOVIDO'.
--
-- V5. Saldo e razão intactos (Article 8/9):
--     SELECT count(*) FROM public.wallet_transactions wt
--       JOIN public.wallets w ON w.id=wt.wallet_id WHERE w.user_id='<uuid>';
--     ⇒ mesmo número de antes. E: SELECT balance FROM public.wallets WHERE user_id='<uuid>' ⇒ 0.
--
-- V6. Só então: auth.admin.deleteUser('<uuid>') ⇒ 200, e a linha de workers CONTINUA existindo.
--
-- V7. O recibo do turno pago continua abrindo para a EMPRESA (/recibo/:jobId), com '[Conta Deletada]'.
--
-- V8. Guardas: em conta com saldo > 0 ⇒ outcome='wallet_has_balance' e NENHUMA escrita.
--
-- --- EMENDA 2026-08-21 ---
-- V9.  Flags de alcance zeradas na lápide do freela:
--      SELECT badges_hidden, accepts_referrals, discoverable_for_sos FROM public.workers
--       WHERE id='<uuid>';   ⇒ t, f, f
--      E: rpc get_worker_company_badges('<uuid>') por uma EMPRESA que ainda tem applications
--         com esse freela ⇒ lista VAZIA (o grafo não ressuscitou com o DELETE das prefs).
-- V10. Nenhum dependente sobreviveu — rodar para conta de teste de FREELA e de EMPRESA:
--      SELECT 'referrals', count(*) FROM public.worker_referrals
--        WHERE worker_id='<uuid>' OR referring_company_id='<cid>' OR requesting_company_id='<cid>'
--      UNION ALL SELECT 'badge_prefs', count(*) FROM public.worker_company_badge_prefs
--        WHERE worker_id='<uuid>' OR company_id='<cid>'
--      UNION ALL SELECT 'lists',       count(*) FROM public.team_lists        WHERE company_id='<cid>'
--      UNION ALL SELECT 'spend',       count(*) FROM public.company_spend_limits WHERE company_id='<cid>'
--      UNION ALL SELECT 'revenue',     count(*) FROM public.company_monthly_revenue WHERE company_id='<cid>'
--      UNION ALL SELECT 'series',      count(*) FROM public.job_series        WHERE company_id='<cid>'
--      UNION ALL SELECT 'trainings',   count(*) FROM public.worker_trainings  WHERE company_id='<cid>';
--      ⇒ TODAS zero. (Antes da emenda, o ramo EMPRESA deixava as cinco últimas para trás.)
-- V11. `companies.city` saiu: SELECT city FROM public.companies WHERE id='<cid>' ⇒ NULL.
-- --- EMENDA 2026-08-22 (fronteira F13) — só verificável DEPOIS que a F13 subir ---
-- V13. Gerente que pediu exclusão perde o acesso e o e-mail sai, mas a trilha FICA:
--      SELECT status, user_id IS NOT NULL AS trilha_user, created_by IS NOT NULL AS trilha_autor,
--             invited_email, invite_token, accepted_at
--        FROM public.company_members WHERE user_id='<uuid>';
--      ⇒ status='removed', trilha_user=t, trilha_autor=t, invited_email NULL, invite_token NULL,
--        accepted_at PRESERVADO. E: get_my_companies() com o JWT dele (antes de expirar) ⇒ vazio.
-- V14. Empresa excluída não deixa gerente operando lápide nem e-mail de terceiro:
--      SELECT count(*) FROM public.company_members
--       WHERE company_id='<cid>' AND (status IN ('invited','active') OR invited_email IS NOT NULL);
--      ⇒ 0. E a linha CONTINUA existindo (count(*) total > 0) — soft, não DELETE.
-- V15. GUARDA 4 — sócio único de rede com unidade de terceiro é RECUSADO:
--      SELECT public.anonymize_account('<uuid-do-unico-owner>');
--      ⇒ outcome='sole_organization_owner' + organization_ids, e NENHUMA escrita (conferir que
--        company_members/organization_members/workers seguem intactos).
--      Depois de promover outro sócio a owner ⇒ outcome='anonymized'.
-- V16. Sócio que sai NÃO desliga os irmãos:
--      SELECT count(*) FROM public.organization_members
--       WHERE organization_id='<org>' AND status='active' AND user_id <> '<uuid>';
--      ⇒ igual a antes. E: SELECT name FROM public.organizations WHERE id='<org>' ⇒ INALTERADO.
-- V17. As varreduras novas rodam sem HALT em banco com a F13 aplicada:
--      re-executar o bloco DO da seção 1 ⇒ silêncio. Qualquer nome que apareça é tabela nova
--      criada por outra feature sem classificação — HALT correto, NÃO adicionar à lista sem
--      escrever a decisão em ddl-aprovado §2.1.
--
-- V12. Ocorrências de série SOBREVIVERAM ao DELETE de job_series (não há FK):
--      SELECT count(*) FROM public.jobs WHERE series_id='<serie-da-empresa>'; ⇒ igual a antes.
--
-- DOWN (rollback — copiar/colar). ATENÇÃO: NÃO desfaz dados já anonimizados. Irreversível por
-- natureza; por isso o backup do cabeçalho é obrigatório.
--   DROP FUNCTION IF EXISTS public.anonymize_account(uuid);
--   -- restaurar o corpo anterior de enforce_service_term_immutability (20260817001100 §7)
--   ALTER TABLE public.workers   DROP COLUMN IF EXISTS anonymized_at;
--   ALTER TABLE public.companies DROP COLUMN IF EXISTS anonymized_at;
--   -- re-adicionar as FKs exige que NÃO existam lápides órfãs:
--   ALTER TABLE public.workers   ADD CONSTRAINT workers_id_fkey
--       FOREIGN KEY (id) REFERENCES auth.users(id) ON DELETE CASCADE;
--   ALTER TABLE public.companies ADD CONSTRAINT companies_id_fkey
--       FOREIGN KEY (id) REFERENCES auth.users(id) ON DELETE CASCADE;
--   ALTER TABLE public.wallets   ADD CONSTRAINT wallets_user_id_fkey
--       FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;
-- ============================================================================
