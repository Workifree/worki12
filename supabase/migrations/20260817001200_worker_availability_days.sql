-- Migration: Disponibilidade declarada pelo freela — grade dia × período (F7)
-- File: supabase/migrations/20260817001200_worker_availability_days.sql
-- Spec: .harness/spec/disponibilidade-freela/spec.md
-- DDL aprovado: .harness/spec/disponibilidade-freela/ddl-aprovado.md
-- ADR: .harness/memory-bank/decisions/ADR-20260821-disponibilidade-grade-jsonb.md
--
-- ============================================================================
-- O QUE ESTA MIGRATION FAZ
-- ============================================================================
--   (a) `workers` ganha UMA coluna nullable: `availability_days jsonb`.
--   (b) Um CHECK nomeado que trava a FORMA do jsonb (domínio de dia, enum de período,
--       cardinalidade) — porque o client escreve esta coluna direto (ver seção seguinte).
--   (c) Dois COMMENT: um documentando a coluna nova, outro marcando o campo LEGADO
--       `workers.availability` como legado/write-once, para o próximo que abrir a tabela não
--       ficar em dúvida sobre qual dos dois manda.
--
--   NÃO cria tabela. NÃO cria função. NÃO cria trigger. NÃO cria índice. NÃO cria policy.
--   NÃO altera GRANT. NÃO faz backfill. NÃO toca `availability` (dado legado preservado).
--
-- ============================================================================
-- POR QUE O CHECK É GORDO (e não `jsonb_typeof = 'object'`)
-- ============================================================================
--   O grant vigente é de TABELA, sem lista de colunas:
--       GRANT SELECT, INSERT, UPDATE ON public.workers TO authenticated;   -- 20260816120000:175
--   Ou seja: o freela autenticado faz `PATCH /rest/v1/workers?id=eq.<ele>` com QUALQUER corpo
--   JSON nesta coluna. A policy de UPDATE (`id = auth.uid()`) decide QUEM escreve, nunca O QUÊ.
--   Não há trigger, não há RPC, não há Edge Function no caminho. Logo o CHECK é a ÚNICA
--   validação que existe de verdade — a validação no client é UX, exatamente como a RLS é a
--   primeira linha de defesa e o filtro no client é só UX (Article 4).
--
--   O CHECK abaixo é uma expressão pura (nenhuma função de usuário, nenhuma subquery). Foi
--   escolhido de propósito em vez de um validador `LANGUAGE sql`: CHECK que depende de função
--   de usuário é um foot-gun conhecido (o Postgres NÃO revalida as linhas existentes quando a
--   função é substituída com CREATE OR REPLACE, e a ordem de restore de um pg_dump passa a
--   importar). Expressão pura não tem dependência, não tem ordem, não tem versão.
--
--   O que cada pedaço trava:
--     jsonb_typeof(...) = 'object'
--         Rejeita `'"texto"'`, `'[1,2]'`, `'123'` e — de propósito — o JSON `null` literal.
--         "Não declarou" tem que ser SQL NULL, porque é isso que o CTA do Dashboard (R14)
--         testa (`availability_days IS NULL`). Duas representações de "vazio" quebrariam a R14.
--     ... <@ '{"0":["manha","tarde","noite"], ... "6":[...]}'::jsonb
--         Containment de jsonb: toda chave presente tem que existir no universo (⇒ só '0'..'6',
--         mata `{"lixo":true}` e `{"99":[...]}`) e todo valor tem que estar CONTIDO no array de
--         períodos (⇒ só 'manha'|'tarde'|'noite'). A exceção do Postgres que deixa um escalar
--         ser contido por um array vale SÓ no nível de topo, não aninhado — então
--         `{"2":"manha"}` (string onde devia ter array) é REJEITADO. Array vazio (`{"2":[]}`)
--         passa: significa "declarei este dia e não marquei período", inofensivo.
--     coalesce(jsonb_array_length(availability_days -> 'N'), 0) <= 3
--         Containment permite duplicata (`["manha","manha","manha",...]` continua contido).
--         Sem este limite, o freela pode gravar megabytes na PRÓPRIA linha — e essa linha é
--         lida no roster de TODA empresa do elenco dele, no caminho mais quente do produto
--         (o modal das 8h30). Chave ausente -> `->` devolve NULL -> coalesce 0 -> passa.
--     Teto real da coluna com este CHECK: 7 chaves × 3 períodos ≈ 250 bytes.
--
-- ============================================================================
-- POR QUE NENHUM GRANT NOVO (landmine da F5, mesma conclusão)
-- ============================================================================
--   NÃO escrever `GRANT UPDATE (availability_days) ON public.workers TO authenticated`.
--   GRANT por coluna é ADITIVO: enquanto existir o grant de tabela, ele não restringe nada —
--   é decoração que engana a próxima revisão. E o `REVOKE UPDATE ON public.workers FROM
--   authenticated` que o tornaria efetivo **derrubaria a edição de perfil inteira do freela**
--   (nome, cidade, bio, PIX, foto — `Profile.tsx:handleSave`). Foi exatamente a conclusão do
--   gate da F5 para `companies`. Se um dia o projeto quiser grant por coluna em `workers`, isso
--   é uma migration própria, com a lista COMPLETA de colunas editáveis, e não cabe nesta fatia.
--   Também NÃO usar `REVOKE ALL ... FROM PUBLIC` em tabela: 20260318000000 documenta que isso
--   derrubou o service_role.
--
-- ============================================================================
-- POR QUE SEM ÍNDICE
-- ============================================================================
--   Não existe nenhuma query que filtre por esta coluna. A leitura é sempre "a linha inteira do
--   worker, dentro de um roster já carregado" (o embed `worker:workers(...)` de
--   `TeamConnectionService.listTeamMembers`). Um GIN aqui seria custo de escrita puro. Quando o
--   ranking automático (SOS) precisar de `WHERE availability_days @> ...` no servidor, aí sim:
--       CREATE INDEX CONCURRENTLY idx_workers_availability_days
--           ON public.workers USING gin (availability_days);
--   (fora de transação — migrations do Supabase rodam em transação, então isso vai por psql).
--
-- Article 8: INTACTO. Nenhuma tabela financeira (`wallets`, `wallet_transactions`,
--   `escrow_transactions`, `shift_payments`) é lida ou escrita. Nenhuma RPC de saldo é criada
--   ou alterada. Nenhum valor monetário aparece nesta migration.
--
-- Risk: LOW. Coluna nova, nullable, sem default, sem backfill, sem reescrita de heap.
-- Backup required before production deploy: NO.
--
-- DOWN (rollback):
--   ALTER TABLE public.workers DROP CONSTRAINT IF EXISTS workers_availability_days_shape;
--   ALTER TABLE public.workers DROP COLUMN IF EXISTS availability_days;
-- ============================================================================

-- =============================================
-- 1. COLUNA
--    Nullable, sem DEFAULT: NULL = "nunca declarou" (estado inicial de toda a base, e a
--    condição do CTA da R14). ADD COLUMN nullable sem default não reescreve a tabela.
-- =============================================
ALTER TABLE public.workers
    ADD COLUMN IF NOT EXISTS availability_days jsonb;

-- =============================================
-- 2. CHECK DE FORMA
--    `ADD CONSTRAINT` não tem IF NOT EXISTS -> DROP IF EXISTS antes, para a migration ser
--    idempotente (rodar duas vezes não pode falhar).
--    Sem NOT VALID: a coluna acabou de nascer, toda linha existente tem NULL, a validação é
--    trivialmente satisfeita e o scan é irrelevante na escala do piloto. (Em tabela grande com
--    dado preexistente o padrão seria ADD ... NOT VALID + VALIDATE CONSTRAINT depois — não é o
--    caso aqui, e constraint NOT VALID esquecida é armadilha pior.)
-- =============================================
ALTER TABLE public.workers
    DROP CONSTRAINT IF EXISTS workers_availability_days_shape;

ALTER TABLE public.workers
    ADD CONSTRAINT workers_availability_days_shape CHECK (
        availability_days IS NULL
        OR (
            jsonb_typeof(availability_days) = 'object'
            AND availability_days <@ '{
                  "0": ["manha","tarde","noite"],
                  "1": ["manha","tarde","noite"],
                  "2": ["manha","tarde","noite"],
                  "3": ["manha","tarde","noite"],
                  "4": ["manha","tarde","noite"],
                  "5": ["manha","tarde","noite"],
                  "6": ["manha","tarde","noite"]
                }'::jsonb
            AND coalesce(jsonb_array_length(availability_days -> '0'), 0) <= 3
            AND coalesce(jsonb_array_length(availability_days -> '1'), 0) <= 3
            AND coalesce(jsonb_array_length(availability_days -> '2'), 0) <= 3
            AND coalesce(jsonb_array_length(availability_days -> '3'), 0) <= 3
            AND coalesce(jsonb_array_length(availability_days -> '4'), 0) <= 3
            AND coalesce(jsonb_array_length(availability_days -> '5'), 0) <= 3
            AND coalesce(jsonb_array_length(availability_days -> '6'), 0) <= 3
        )
    );

-- =============================================
-- 3. DOCUMENTAÇÃO NA PRÓPRIA TABELA
--    O COMMENT do campo legado não é cosmético: a partir desta migration existem DOIS campos
--    chamados "disponibilidade" na mesma linha, e quem abrir a tabela daqui a seis meses precisa
--    saber, sem ler o repositório, qual dos dois manda numa decisão.
-- =============================================
COMMENT ON COLUMN public.workers.availability_days IS
    'F7 — grade de disponibilidade declarada pelo freela. Objeto jsonb: chave = dia da semana '
    'como texto ''0''(domingo)..''6''(sabado), MESMA convencao de job_series.weekdays; valor = '
    'array de periodos, subconjunto de [''manha'',''tarde'',''noite''] (madrugada dobrada em '
    'noite). Chave ausente = NAO DECLARADO para aquele dia (neutro, nunca "indisponivel"). '
    'Coluna NULL = nunca declarou nada (condicao do CTA no Dashboard do worker). Escrita SOMENTE '
    'pelo proprio freela (policy de UPDATE id = auth.uid()); a forma e garantida pelo CHECK '
    'workers_availability_days_shape, que e a UNICA validacao real (o grant de UPDATE e de '
    'tabela, o client escreve direto). E SINAL, NUNCA TRAVA: so reordena o ShiftCallModal, nunca '
    'filtra, nunca bloqueia disparo. Nao toca saldo (Article 8).';

COMMENT ON COLUMN public.workers.availability IS
    'LEGADO (pre-F7, write-once no passo 3 do WorkerOnboarding, nunca editavel). Periodos soltos, '
    'SEM dia da semana — nao responde "quem pode vir nesta terca de manha". Mantido intacto por '
    'compatibilidade e para nao destruir dado ja coletado. NAO e fonte de verdade para nenhuma '
    'decisao automatica: quem manda em ordenacao/ranking/aviso e availability_days. Nao ha '
    'backfill de um para o outro (o legado nao tem dia; inventar dia seria mentira, e preencher '
    'availability_days mataria o CTA de adocao da F7 para a base inteira).';
