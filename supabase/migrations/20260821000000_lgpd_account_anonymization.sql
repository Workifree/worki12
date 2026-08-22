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
--   (3) EMENDA 2026-08-22 — CLASSE DE USUÁRIO GERENTE (F13): RECONHECIDA AQUI, não na F13.
--       Depois de `accept_manager_invite`, a casca de `companies` do gerente é APAGADA
--       (20260818100300), e ele nunca teve linha em `workers`: as duas âncoras da rotina dão
--       vazio e ela devolveria `not_found` para um titular LEGÍTIMO. O portão foi aberto no §5
--       (`v_is_member`), guardado por `to_regclass` — no-op enquanto a F13 não subir.
--       ⚠️ REVISÃO 2026-08-22 do D4 do ADR-20260822: pôr esse reconhecimento "na migration da
--       F13" era IMPLEMENTÁVEL SÓ EM PRODUÇÃO. Em CI a F13 (20260818100000) roda ANTES desta;
--       um `CREATE OR REPLACE anonymize_account` lá seria SOBRESCRITO por esta migration e o
--       reconhecimento SUMIRIA — exatamente a doença "dois ambientes falhando de formas
--       diferentes" que a §2.1.2 e o D5 existem para matar. O corpo da função tem UM dono: esta
--       migration. Ver ddl-aprovado §2.5/§4.4 e ADR-20260822 D4 (revisado).
--       O contrato da Edge Function NÃO muda: `not_found` continua sendo FALHA, e ela aborta
--       ANTES do deleteUser — agora `not_found` significa mesmo "não existe titular".
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
        -- tabelas": a LINHA é RETIDA (chave pseudônima + timestamps), sustentando o BI e a
        -- integridade referencial de `shift_payments`. O que faltava era o NOME aqui.
        -- ⚠️ EMENDA 2026-08-22 (3) — "RETIDA" NÃO é mais "nada a fazer". A justificativa antiga
        --    dizia "nenhum conteúdo pessoal", e isso era FALSO: `jobs.briefing/description/
        --    requirements`, `applications.cover_letter` e `shift_calls.message` são TEXTO LIVRE.
        --    A rotina apagava o MOLDE (`companies.default_briefing`, `job_series.job_template`)
        --    e retinha as CÓPIAS — `create_job_series` (20260817000400) copia `job_template`
        --    literalmente para `jobs.briefing`. Agora a linha fica e o TEXTO sai (redação com
        --    marcador), no padrão de ADR-20260821-expurgo-de-conteudo-nao-de-linha. Ver §2.1.
        -- ⚠️ CORREÇÃO 2026-08-22 — a primeira versão deste comentário dizia que as irmãs
        --    `shift_calls`/`shift_call_targets`/`shift_attendance_confirmations` não aparecem
        --    aqui "porque penduram em `jobs`". Isso é FALSO, e foi conferido no catálogo de
        --    produção: `shift_calls.company_id`, `shift_calls.created_by`,
        --    `shift_call_targets.worker_id` e `shift_attendance_confirmations.worker_id` são
        --    uuid NU, SEM FK nenhuma. Elas somem da asserção (c) pela ausência TOTAL de FK —
        --    exatamente o ponto cego descrito em §2.1.1 — e quem as cobre é a varredura (d),
        --    via `v_classified_tables`. O framing antigo era pior que o erro: ensinava que
        --    "dependência transitiva por `jobs`" estaria coberta. Não estaria — `jobs` também
        --    nunca é apagada (§2.1.0), então nada cascateia de lá tampouco.
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

    -- EMENDA 2026-08-22 — colunas de TEXTO LIVRE em tabela RETIDA que a rotina REDIGE (§2.1,
    -- "Demais tabelas"). Mesma régua da asserção (a): a rotina não escreve às cegas em coluna
    -- que talvez não exista. `qualificada.coluna`, split no ponto.
    v_redacted_text text[] := ARRAY[
        'jobs.briefing',            -- cópia literal de job_series.job_template (20260817000400)
        'jobs.description',
        'jobs.requirements',
        -- EMENDA 2026-08-22 (2) — achada na varredura de catálogo que fechou a asserção (b2).
        -- `<input maxLength={200} placeholder="Ex: CREF válido">` (CompanyCreateJob.tsx:466);
        -- o próprio código a declara "texto livre ≤200, advisory" (F8). É a empresa escrevendo
        -- exigência em prosa: nomeia credencial, condição e pode nomear pessoa. Mesma classe de
        -- `briefing`. 0 linhas hoje só porque o F8 acabou de subir — classificar depois de haver
        -- dado seria classificar tarde.
        'jobs.certification_requirement',
        'applications.cover_letter', -- texto do FREELA sobre si mesmo
        'applications.message',      -- idem — coluna legada do pull, 0 linhas, mesma classe
        'shift_calls.message'        -- texto da EMPRESA no disparo 1→N
    ];

    -- EMENDA 2026-08-22 — asserção (b2): classificação FECHADA de texto em tabela RETIDA.
    -- Fecha a lacuna Hh2 (§5.3/§5.5): (a)/(b) varrem coluna a coluna só `workers`/`companies`, e
    -- (c)/(d)/(e) têm granularidade de TABELA — uma coluna de texto livre nova em `jobs` entraria
    -- retida EM SILÊNCIO. A lista abaixo é o CATÁLOGO DE PRODUÇÃO conferido em 22/08/2026 contra
    -- o uso real no frontend, não uma suposição: enumerá-la às cegas antes disso teria produzido
    -- HALT garantido e lista inventada — pior que guarda ausente.
    -- Coluna textual NOVA nestas três tabelas ⇒ HALT. A decisão é binária e tem de ser escrita:
    -- ou entra em v_redacted_text (texto livre) ou entra aqui (enum/operacional/estrutural).
    -- EMENDA 2026-08-22 (3) — RETIDAS por GARANTIA DO BANCO, nao por observacao.
    -- Estas colunas tem CHECK de conjunto fechado: nao PODEM conter texto livre, por construcao.
    -- E uma classe de evidencia diferente (e melhor) do que "hoje so tem 2 valores distintos":
    -- contagem de distintos descreve o dado de hoje; CHECK descreve o que o banco aceita amanha.
    -- A assercao (b3) abaixo VERIFICA essa afirmacao a cada aplicacao: se alguem derrubar o
    -- CHECK, a justificativa da retencao evapora e a migration HALTa -- a guarda confere a
    -- propria evidencia em vez de confiar na lista.
    v_enum_text text[] := ARRAY[
        'shift_attendance_confirmations.source',    -- CHECK: 'auto' | 'manual'
        'shift_attendance_confirmations.response',  -- CHECK: NULL | 'confirmed' | 'cannot_attend'
        'shift_call_targets.origin',                -- CHECK: 'team' | 'sos'
        'shift_call_targets.response',              -- CHECK: NULL | accepted|declined|closed
        -- PROMOVIDA em 22/08 (Hh4): tem CHECK fechado de verdade. Estava classificada por
        -- observacao ("1 valor distinto"); a evidencia subiu de "hoje so tem um valor" para
        -- "o banco nao aceita outro", e (b3) passa a vigia-la.
        'applications.invitation_response',         -- CHECK: NULL | 'accepted' | 'declined'
        -- PROMOVIDAS em 22/08 pela varredura completa: os tres CHECKs ESTAO no catalogo,
        -- identicos ao que o repositorio declara (20260817000100, 20260817001600). O
        -- rebaixamento preventivo anterior ("repo nao e catalogo") era disciplina correta, e a
        -- varredura a absolveu -- aqui, desta vez, repo e catalogo coincidem.
        'shift_calls.reason',                       -- CHECK: falta|demissao|...|outro
        'shift_calls.status',                       -- CHECK: open|filled|cancelled|expired
        'shift_calls.origin'                        -- CHECK: 'team' | 'sos'
    ];

    -- RETIDAS por DECISAO ESCRITA ou por observacao do dado. Evidencia mais fraca que v_enum_text
    -- de proposito: `jobs.title`/`location` NAO tem (nem devem ter) CHECK -- sao retidas porque a
    -- decisao de §2.1 diz que sao, nao porque o banco impeca texto livre nelas. E por isso que a
    -- lista a mao NAO pode ser substituida por uma regra derivada "sem CHECK => HALT": ela
    -- HALTaria para sempre justamente nas duas colunas cuja retencao e a decisao mais deliberada
    -- deste contrato.
    v_retained_text text[] := ARRAY[
        -- jobs: rótulo, enums em coluna text, e os dois RETIDOS por decisão (§2.1)
        'jobs.title',            -- RETIDO por decisão: rótulo operacional, congelado no term_text
        'jobs.location',         -- RETIDO por decisão: idem. Endereços reais — risco em §5.3
        -- ⚠️ SEIS COLUNAS SEM ENFORCEMENT NENHUM NO BANCO (conferido em pg_constraint, 22/08):
        --    jobs.scope, jobs.status, jobs.type, jobs.category, jobs.budget_type e
        --    applications.status NAO TEM CHECK NENHUM. O que as mantem com cara de enum e CODIGO DE
        --    FRONTEND -- `CompanyCreateJob.tsx` grava 'on-site'/'freelance'/'daily' como
        --    CONSTANTES e `category` vem de selecao validada.
        --    Chama-las de "enum" e impreciso e envelhece mal: Article 4 da constitution diz que
        --    filtro no client e so UX e que a defesa dura e o banco. Um PATCH direto via
        --    PostgREST (a empresa dona do turno passa na policy de UPDATE) escreve o que quiser
        --    nelas HOJE. Logo a frase honesta nao e "sao enums", e "sao CONSTANTES DO CLIENTE,
        --    sem enforcement no banco" -- risco declarado em ddl-aprovado §5.3, e proposta de
        --    CHECK adiada para leva propria (§5.5 Hh5): adicionar CHECK em `jobs.status` vivo
        --    exige varrer os valores existentes antes, e isso e migration com risco proprio.
        --    NAO redigir nenhuma delas: `status` e maquina de estados (todo consumidor faz
        --    `.neq('status','deleted')`) e as outras quatro sustentam filtro e BI.
        'jobs.scope',                                   -- constante do cliente: 'on-site'
        'jobs.type', 'jobs.budget_type',                -- constantes: 'freelance' / 'daily'
        'jobs.category',                                -- selecao validada no client
        'jobs.status',                                  -- maquina de estados (client + RPCs)
        'jobs.work_start_time', 'jobs.work_end_time',   -- horario 'HH:MM', formato do client
        -- applications
        'applications.status'                           -- idem: maquina de estados, sem CHECK
        -- `shift_calls` nao tem mais coluna aqui: reason/status/origin foram PROMOVIDAS para
        -- v_enum_text (CHECK conferido no catalogo) e `message` e REDIGIDA. Inventario das cinco
        -- tabelas fechado em 22/08: 25 colunas textuais distintas, nenhuma sem classificacao.
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

    -- (a2) EMENDA 2026-08-22 — as colunas de texto livre que a rotina REDIGE precisam existir
    --      E ser de tipo textual. Se `jobs.requirements` for `text[]` em algum ambiente, a
    --      atribuição de um marcador `text` falharia EM RUNTIME, dentro da transação destrutiva,
    --      depois de metade da conta já ter sido anonimizada. Falha aqui, antes, e fechado.
    FOREACH v_col IN ARRAY v_redacted_text LOOP
        IF NOT EXISTS (
            SELECT 1 FROM information_schema.columns c
             WHERE c.table_schema = 'public'
               AND c.table_name   = split_part(v_col, '.', 1)
               AND c.column_name  = split_part(v_col, '.', 2)
               AND c.data_type IN ('text', 'character varying', 'character')
        ) THEN
            RAISE EXCEPTION
              'ASSERCAO (a2): public.% nao existe ou nao e textual. A rotina de LGPD pretende '
              'REDIGIR esta coluna (ddl-aprovado 2.1, "Demais tabelas"). HALT -> architect.', v_col;
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

    -- (b2) EMENDA 2026-08-22 — classificacao FECHADA de texto em tabela RETIDA (fecha Hh2).
    --      Mesma regra de (b), aplicada a `jobs`/`applications`/`shift_calls`: toda coluna
    --      TEXTUAL dessas tabelas esta OU em v_redacted_text (texto livre -> redigido) OU em
    --      v_retained_text (enum/operacional/decisao escrita). Coluna nova => HALT.
    --      pg_catalog e nao information_schema: varredura que falha ABERTO por falta de
    --      privilegio nao e guarda (mesma razao de (d)/(e)).
    --      NAO adicionar nome a v_retained_text para "fazer passar": adicionar significa
    --      "conferi o conteudo real e decidi que nao e texto livre", como foi feito em 22/08
    --      com `jobs.scope` e `applications.invitation_response` (enums em coluna text).
    SELECT string_agg(DISTINCT format('%s.%s', cl.relname, a.attname), ', ') INTO v_unknown
    FROM pg_attribute  a
    JOIN pg_class      cl ON cl.oid = a.attrelid
    JOIN pg_namespace  ns ON ns.oid = cl.relnamespace
    WHERE ns.nspname = 'public'
      AND cl.relkind = 'r'
      AND cl.relname IN ('jobs', 'applications', 'shift_calls',
                         -- EMENDA 2026-08-22 (3): as duas ultimas tabelas RETIDAS entram no
                         -- fecho. Catalogo conferido; as quatro colunas textuais delas tem
                         -- CHECK de conjunto fechado (v_enum_text) e sao verificadas em (b3).
                         'shift_call_targets', 'shift_attendance_confirmations')
      AND a.attnum > 0
      AND NOT a.attisdropped
      AND a.atttypid = ANY (ARRAY['text', 'character varying', 'character']::regtype[])
      AND format('%s.%s', cl.relname, a.attname) <> ALL (v_redacted_text)
      AND format('%s.%s', cl.relname, a.attname) <> ALL (v_retained_text)
      AND format('%s.%s', cl.relname, a.attname) <> ALL (v_enum_text);
    IF v_unknown IS NOT NULL THEN
        RAISE EXCEPTION
          'ASSERCAO (b2): coluna TEXTUAL nao classificada em tabela RETIDA: %. '
          'A linha destas tabelas nunca e apagada (ancora de shift_payments/BI), entao texto '
          'livre nao classificado sobrevive a exclusao da conta EM SILENCIO. Decida: redigir '
          '(ddl-aprovado 2.1) ou reter com justificativa escrita. HALT -> architect.', v_unknown;
    END IF;

    -- (b3) EMENDA 2026-08-22 (3) — a guarda CONFERE A PROPRIA EVIDENCIA.
    --      Toda coluna declarada em v_enum_text foi retida com a justificativa "tem CHECK de
    --      conjunto fechado, logo nao PODE conter texto livre". Isso e uma afirmacao sobre o
    --      SCHEMA, e schema muda: um `DROP CONSTRAINT` num sabado transforma a coluna em texto
    --      livre e a classificacao passa a mentir EM SILENCIO -- exatamente o modo de falha que
    --      esta migration inteira existe para eliminar. Aqui a afirmacao e re-verificada a cada
    --      aplicacao. Se o CHECK sumiu, HALT: ou o CHECK volta, ou a coluna e reclassificada.
    FOREACH v_col IN ARRAY v_enum_text LOOP
        IF NOT EXISTS (
            SELECT 1
            FROM pg_constraint con
            JOIN pg_class     cl ON cl.oid = con.conrelid
            JOIN pg_namespace ns ON ns.oid = cl.relnamespace
            WHERE ns.nspname = 'public'
              AND cl.relname = split_part(v_col, '.', 1)
              AND con.contype = 'c'
              -- ⚠️ O PREDICADO E "CHECK QUE ENUMERA VALORES DESTA COLUNA", NAO "CHECK EXISTE".
              -- Contra-exemplo real, achado na varredura de 22/08 e que quase inverteu uma
              -- decisao desta mesma leva:
              --   CHECK ((certification_requirement IS NULL)
              --          OR (char_length(certification_requirement) <= 200))
              -- `jobs.certification_requirement` TEM check_def nao-nulo -- e e exatamente a
              -- coluna de TEXTO LIVRE que esta migration REDIGE. Uma regra "tem CHECK => classe
              -- forte" a promoveria para v_enum_text e a TIRARIA da redacao, em silencio.
              -- CHECK de COMPRIMENTO nao e evidencia de conjunto fechado: limita o tamanho da
              -- prosa, nao o fato de ser prosa. Por isso a exigencia e a forma
              -- `<coluna> = ANY (ARRAY[...])`, que e como o Postgres renderiza tanto
              -- `= ANY (ARRAY[..])` quanto `IN (..)`.
              -- Colateral resolvido pelo EXISTS: colunas que participam de MAIS DE UM CHECK
              -- (ex.: shift_attendance_confirmations.response tambem aparece em
              -- `(response IS NULL) = (responded_at IS NULL)`) passam pela linha que ENUMERA,
              -- e as de coerencia simplesmente nao casam. Uma leitura "primeira linha da
              -- coluna" pegaria a errada; EXISTS nao.
              -- A ENUMERACAO TEM DE SER DESTA COLUNA: o `= ANY (ARRAY[` vem ADJACENTE ao nome
              -- (com no maximo `)` de fecho de cast e um `::tipo` no meio, que e como o Postgres
              -- renderiza coluna varchar). Sem a adjacencia, um CHECK composto do tipo
              -- `CHECK (foo = 'x' AND bar = ANY (ARRAY[...]))` faria `foo` -- texto livre --
              -- passar de carona pela enumeracao de `bar`.
              AND pg_catalog.pg_get_constraintdef(con.oid)
                    ~ ('(^|[^a-zA-Z0-9_])' || split_part(v_col, '.', 2) ||
                       '\)?[[:space:]]*(::[a-zA-Z0-9_ ]+)?[[:space:]]*=[[:space:]]*ANY[[:space:]]*\(ARRAY\[')
        ) THEN
            RAISE EXCEPTION
              'ASSERCAO (b3): public.% foi RETIDA em §2.1 sob a justificativa "CHECK de conjunto '
              'fechado, nao pode conter texto livre" -- e nao ha mais (ou nunca houve) CHECK que '
              'ENUMERE valores dela. Atencao: CHECK de comprimento (char_length <= N) NAO conta '
              'e nao deve ser aceito como substituto -- limita o tamanho da prosa, nao o fato de '
              'ser prosa. A retencao ficou sem evidencia: a coluna passou a aceitar texto livre e '
              'sobreviveria a exclusao da conta EM SILENCIO. Restaure o CHECK ou reclassifique a '
              'coluna (redigir, ou reter com justificativa NOVA). HALT -> architect.', v_col;
        END IF;
    END LOOP;

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
    -- EMENDA 2026-08-22: `v_counts` NASCE com todas as chaves em zero. Antes, as chaves de
    -- domínio viviam dentro de `IF v_is_worker` / `IF cardinality(...) > 0` e simplesmente NÃO
    -- APARECIAM no retorno para quem não é freela nem dono de empresa (a classe GERENTE, por
    -- exemplo). "Chave ausente" e "chave zero" são fatos diferentes: a primeira é indistinguível
    -- de "as âncoras não resolveram, isto é um bug". Quem lê o retorno (Edge Function, auditoria,
    -- suporte) precisa ver a rotina declarar que olhou e não achou nada.
    v_counts        jsonb := jsonb_build_object(
        'service_terms', 0, 'worker_certifications', 0, 'worker_trainings', 0,
        'team_list_members', 0, 'team_lists', 0, 'company_spend_limits', 0,
        'company_monthly_revenue', 0, 'job_series', 0, 'worker_trainings_company', 0,
        'team_connections', 0, 'worker_referrals', 0, 'worker_company_badge_prefs', 0,
        'company_members', 0, 'organization_members', 0, 'notifications', 0,
        'payment_methods', 0, 'applications_redacted', 0, 'jobs_redacted', 0,
        'shift_calls_redacted', 0, 'workers', 0, 'companies', 0
    );
    v_n             integer;
    v_txt           text;          -- EMENDA 2026-08-22 (GUARDA 4, fronteira F13)
    v_is_member     boolean := false;  -- EMENDA 2026-08-22 (classe GERENTE/SOCIO, fronteira F13)
    c_worker_label  constant text := '[Conta Deletada]';
    c_company_label constant text := '[Empresa Deletada]';
    c_redacted      constant text :=
        '[TERMO REMOVIDO — a conta do titular foi excluida a pedido dele (LGPD art. 18, VI). '
        'Este termo nao havia sido aceito e, portanto, nao possui valor probatorio.]';
    -- EMENDA 2026-08-22 — marcador de redacao de TEXTO LIVRE em linha RETIDA.
    -- Marcador e nao NULL, por tres razoes: (1) `jobs.title`/`location` mostram que este schema
    -- tem coluna textual NOT NULL, e a lista de redacao vai crescer -- um NULL em coluna NOT NULL
    -- estouraria DENTRO da transacao destrutiva; (2) a UI da contraparte (recibo, MyJobs) explica
    -- o vazio em vez de parecer defeito; (3) e o mesmo padrao de c_redacted / '[Conta Deletada]'.
    c_redacted_text constant text :=
        '[CONTEUDO REMOVIDO — a conta de quem escreveu este texto foi excluida a pedido do '
        'titular (LGPD art. 18, VI).]';
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
    -- TRES predicados: (1) a pessoa que sai era gerente de unidades alheias -> perde o acesso;
    -- (2) a EMPRESA que sai tinha gerentes que CONTINUAM na plataforma -> a unidade virou
    -- lapide, ninguem opera lapide, e o e-mail desses terceiros perde a base que o sustentava;
    -- (3) EMENDA 2026-08-22 (C-LGPD-GATE-INVITES) -- convite AINDA PENDENTE emitido por quem
    -- esta saindo, em unidade que NAO e dele.
    --
    -- Por que (3) e obrigatorio e nao existia: quem emite convite de gerente e o operador de
    -- REDE (`invite_company_manager` exige `is_organization_operator`), logo ele convida para
    -- unidades IRMAS, que NAO estao em `v_company_ids`. Sem este ramo, abrir o portao para a
    -- classe gerente/socio (acima) tornou ALCANCAVEL um buraco real: a conta e apagada e ficam
    -- para tras linhas `status='invited'` com `invited_email` DE TERCEIRO e `invite_token` VIVO
    -- (indice unico, 7 dias), assinadas por uma conta que nao existe mais. Credencial portadora
    -- resgatavel emitida por ninguem.
    --
    -- Por que SO `status='invited'` (e nao `created_by` em qualquer status): a linha ATIVA
    -- pertence ao GERENTE, um terceiro que continua na plataforma operando uma unidade que e de
    -- OUTRO dono. `created_by` ali e so a trilha de quem convidou; derrubar o acesso dele porque
    -- o convidante saiu seria dano a terceiro -- a mesma razao pela qual `organization_members`
    -- nao tem ramo por empresa. Simetria EXATA com o predicado de `organization_members` abaixo,
    -- que ja carregava este ramo com esta justificativa.
    IF pg_catalog.to_regclass('public.company_members') IS NOT NULL THEN
        EXECUTE $q$
            UPDATE public.company_members cm
               SET status = CASE WHEN cm.status IN ('invited', 'active')
                                 THEN 'removed' ELSE cm.status END,
                   invited_email = NULL,
                   invite_token  = NULL
             WHERE (cm.user_id = $1
                    OR cm.company_id = ANY ($2)
                    OR (cm.status = 'invited' AND cm.created_by = $1))
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

    -- ---- EMENDA 2026-08-22: TEXTO LIVRE em tabela RETIDA (C-LGPD-CLASS-JOBS/APPLICATIONS) ----
    -- A linha FICA (ancora de shift_payments, BI, integridade referencial); o TEXTO SAI. E o
    -- padrao de ADR-20260821-expurgo-de-conteudo-nao-de-linha, aplicado agora tambem fora do
    -- expurgo por prazo. Corrige uma INCOERENCIA do proprio contrato: a rotina apagava
    -- `companies.default_briefing` ("texto da empresa, pode conter nomes") e DELETAVA
    -- `job_series` ("job_template carrega o briefing -- mesma classe"), mas RETINHA as copias
    -- materializadas em `jobs.briefing` -- que `create_job_series` (20260817000400) escreve
    -- copiando `job_template` LITERALMENTE. Apagar o molde e guardar as copias nao e decisao,
    -- e descuido; e a §5.3 nao registrava esta classe (registrava `shift_payments.note`,
    -- `reviews.comment` e `verified_note`, que sao exatamente a mesma familia).
    --
    -- O que NAO e redigido, e por que (decisao escrita, nao omissao):
    --   `jobs.title` / `jobs.location` -- nao sao narrativa livre: sao o rotulo operacional e o
    --   local do estabelecimento que a CONTRAPARTE (o freela, que continua na plataforma) le no
    --   proprio recibo e no `service_terms.term_text` ACEITO, que e RETIDO INTEGRALMENTE como
    --   prova. Apagar aqui nao elimina a informacao (ela esta congelada no termo) e degrada o
    --   registro de um terceiro sobre uma transacao encerrada. Risco residual em §5.3.
    IF v_is_worker THEN
        -- Texto que o FREELA escreveu SOBRE SI MESMO na candidatura (pull legado). Zero valor
        -- fiscal; `service_terms`/`shift_payments` e que provam a transacao.
        -- `message` (EMENDA 2026-08-22 (2)): coluna legada do modelo pull, 0 linhas e nenhuma
        -- escrita no frontend hoje. Entra pelo NOME e pelo TIPO, nao pelo volume: e texto livre
        -- do titular, mesma classe de `cover_letter` e de `workers.bio` (APAGADO em §2.1).
        -- Classificar coluna vazia custa uma linha; classificar depois que ela enche custa uma
        -- migration nova e um intervalo em que o dado sobreviveu.
        UPDATE public.applications a
           SET cover_letter = CASE WHEN a.cover_letter IS NULL THEN NULL ELSE c_redacted_text END,
               message      = CASE WHEN a.message      IS NULL THEN NULL ELSE c_redacted_text END
         WHERE a.worker_id = p_user_id
           AND (   (a.cover_letter IS NOT NULL AND a.cover_letter IS DISTINCT FROM c_redacted_text)
                OR (a.message      IS NOT NULL AND a.message      IS DISTINCT FROM c_redacted_text));
        GET DIAGNOSTICS v_n = ROW_COUNT;
        v_counts := v_counts || jsonb_build_object('applications_redacted', v_n);
    END IF;

    IF cardinality(v_company_ids) > 0 THEN
        UPDATE public.jobs j
           SET briefing     = CASE WHEN j.briefing     IS NULL THEN NULL ELSE c_redacted_text END,
               description  = CASE WHEN j.description  IS NULL THEN NULL ELSE c_redacted_text END,
               requirements = CASE WHEN j.requirements IS NULL THEN NULL ELSE c_redacted_text END,
               -- F8: exigencia de certificacao em PROSA (<=200, advisory). Mesma classe do
               -- briefing -- a empresa nomeia credencial, condicao e pode nomear pessoa.
               certification_requirement = CASE WHEN j.certification_requirement IS NULL
                                                THEN NULL ELSE c_redacted_text END
         WHERE j.company_id = ANY (v_company_ids)
           AND (   (j.briefing     IS NOT NULL AND j.briefing     IS DISTINCT FROM c_redacted_text)
                OR (j.description  IS NOT NULL AND j.description  IS DISTINCT FROM c_redacted_text)
                OR (j.requirements IS NOT NULL AND j.requirements IS DISTINCT FROM c_redacted_text)
                OR (j.certification_requirement IS NOT NULL
                    AND j.certification_requirement IS DISTINCT FROM c_redacted_text));
        GET DIAGNOSTICS v_n = ROW_COUNT;
        v_counts := v_counts || jsonb_build_object('jobs_redacted', v_n);
    END IF;

    -- `shift_calls.message`: texto que a empresa (ou o GERENTE dela) escreveu no disparo 1->N.
    -- DOIS predicados, e o segundo e obrigatorio: `shift_calls.company_id` NAO TEM FK (uuid nu,
    -- conferido no catalogo de producao -- §2.1.1), entao nada aqui e resolvido por cascata; e
    -- `created_by` e a UNICA forma de alcancar o texto escrito pelo GERENTE, cuja unidade
    -- pertence a outro dono e portanto nunca aparece em `v_company_ids`.
    UPDATE public.shift_calls sc
       SET message = c_redacted_text
     WHERE (sc.company_id = ANY (v_company_ids) OR sc.created_by = p_user_id)
       AND sc.message IS NOT NULL
       AND sc.message IS DISTINCT FROM c_redacted_text;
    GET DIAGNOSTICS v_n = ROW_COUNT;
    v_counts := v_counts || jsonb_build_object('shift_calls_redacted', v_n);

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
        -- EMENDA 2026-08-22 (C-LGPD-RETURN-CLASSE): sem esta chave, o retorno da classe
        -- GERENTE/SOCIO era `is_worker=false` + `company_ids=[]` -- indistinguivel de "bug: as
        -- ancoras nao resolveram". Quem le precisa saber POR QUE a rotina aceitou o titular.
        'is_member',     v_is_member,
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
    'organizacao com unidades de TERCEIROS sem nenhum dono ativo. Reconhece a classe GERENTE/'
    'SOCIO (sem linha em workers/companies) — o corpo desta funcao tem UM dono, esta migration, '
    'nunca a da F13 (que ordena antes em replay e seria sobrescrita). ADR-20260822. '
    'EMENDA 2026-08-22 (2): REDIGE texto livre em linha RETIDA — jobs.briefing/description/'
    'requirements/certification_requirement, applications.cover_letter/message e '
    'shift_calls.message viram marcador; a LINHA fica (ancora de shift_payments/BI), o TEXTO sai. '
    'jobs.title/location sao RETIDOS de proposito (o termo aceito ja os congela como prova e a '
    'contraparte le no proprio recibo). A classificacao textual das CINCO tabelas retidas do '
    'dominio de turno e FECHADA pela assercao (b2) -- coluna de texto nova nelas HALTa a '
    'migration -- e a (b3) re-verifica que as colunas retidas "por serem enum" ainda tem CHECK '
    'de conjunto fechado.';

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
-- V18. EMENDA 2026-08-22 — convite de gerente EMITIDO pelo titular em unidade IRMÃ morre junto
--      (C-LGPD-GATE-INVITES). Cenário: sócio de rede convida gerente para a unidade B, que NÃO
--      está em `v_company_ids` dele; depois pede exclusão.
--      SELECT status, invited_email, invite_token FROM public.company_members
--       WHERE created_by='<uuid-do-socio>' AND company_id='<unidade-irma>';
--      ⇒ status='removed', invited_email NULL, invite_token NULL. E o link do convite
--        (/convite-gerente/<token>) deixa de resolver.
--      E o CONTRAPONTO, que é o que prova que o predicado não é largo demais:
--      SELECT status FROM public.company_members
--       WHERE created_by='<uuid-do-socio>' AND status='active' AND user_id<>'<uuid-do-socio>';
--      ⇒ CONTINUA 'active'. Gerente em exercício é terceiro; não perde acesso porque quem o
--        convidou saiu.
-- V19. EMENDA 2026-08-22 — texto livre de tabela RETIDA foi redigido, e a linha ficou:
--      SELECT count(*) AS linhas, count(*) FILTER (WHERE briefing LIKE '[CONTEUDO REMOVIDO%')
--        FROM public.jobs WHERE company_id='<cid>' AND briefing IS NOT NULL;
--      ⇒ linhas = igual a antes (nada apagado) e TODAS redigidas.
--      SELECT cover_letter, message FROM public.applications WHERE worker_id='<uuid>'
--       AND (cover_letter IS NOT NULL OR message IS NOT NULL);  ⇒ só o marcador.
--      SELECT certification_requirement FROM public.jobs WHERE company_id='<cid>'
--       AND certification_requirement IS NOT NULL;  ⇒ só o marcador.
--      SELECT message FROM public.shift_calls WHERE company_id='<cid>' OR created_by='<uuid>';
--       ⇒ só o marcador (ou NULL onde já era NULL).
--      E o que NÃO pode ter mudado: SELECT title, location FROM public.jobs WHERE id='<jid>'
--       ⇒ INALTERADOS (retidos de propósito — §2.1 e §5.3).
--      Idempotência: rodar `anonymize_account` de novo ⇒ counts *_redacted = 0.
-- V20. EMENDA 2026-08-22 — classe GERENTE é reconhecida e o retorno diz por quê:
--      SELECT public.anonymize_account('<uuid-de-gerente-sem-workers-sem-companies>');
--      ⇒ outcome='anonymized', is_worker=false, company_ids=[], **is_member=true**, e `counts`
--        com TODAS as chaves presentes (zeros onde não havia nada) — nunca chave ausente.
-- V21. EMENDA 2026-08-22 (2/3) — a classificação textual das CINCO tabelas retidas do domínio de
--      turno (`jobs`, `applications`, `shift_calls`, `shift_call_targets`,
--      `shift_attendance_confirmations`) é FECHADA. Re-executar o bloco DO da seção 1 num banco
--      onde alguém adicionou coluna de texto a uma delas ⇒ HALT em (b2) com o nome da coluna. É
--      o comportamento CORRETO: a decisão é binária (redigir OU reter com justificativa escrita
--      em §2.1) e nunca implícita. Baseline conferido contra o catálogo de produção em 22/08.
-- V22. EMENDA 2026-08-22 (3) — a evidência das colunas retidas "por serem enum" é verificada, não
--      declarada. Ensaio em banco de TESTE:
--        ALTER TABLE public.shift_call_targets DROP CONSTRAINT <check_do_origin>;
--        <re-executar o bloco DO da seção 1>
--      ⇒ HALT em (b3) nomeando `shift_call_targets.origin`. Restaurar o CHECK ⇒ silêncio.
--      É o que impede a classificação de continuar verde depois que o schema deixou de
--      sustentá-la.
--      SEGUNDA metade do ensaio (a que pega o erro sutil): substituir o CHECK de conjunto por um
--      de COMPRIMENTO —
--        ALTER TABLE public.shift_call_targets
--          ADD CONSTRAINT sct_origin_len CHECK (origin IS NULL OR char_length(origin) <= 8);
--      ⇒ (b3) tem de continuar HALTando. Se passar, o predicado degenerou para "existe CHECK" e
--        a guarda perdeu o sentido: é exatamente por aí que `jobs.certification_requirement`
--        (que TEM CHECK, de char_length <= 200, e é TEXTO LIVRE que esta rotina REDIGE) entraria
--        na classe forte e sairia da redação em silêncio.
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
