-- Migration: Escala Recorrente — `job_series` + colunas de ocorrência em `jobs` (F3)
-- File: supabase/migrations/20260817000400_job_series.sql
-- Spec: .harness/spec/escala-recorrente/spec.md (R1, R2, R3, R4, R5, R6, R7, R9, R10, R11, R13)
-- Gate: .harness/memory-bank/decisions/ADR-20260817-serie-eager-e-cancelamento-suave.md
--
-- ============================================================================
-- 1. GERAÇÃO EAGER — `job_series` é MOLDE + AUDITORIA, não dono das ocorrências (ADR, decisão 1)
-- ============================================================================
--   Lazy é impossível neste schema: `shift_calls.job_id`, `applications.job_id` e
--   `shift_payments.job_id` são FKs para `jobs(id)`. No instante em que uma ocorrência é
--   convidada, ela precisa existir como linha de `jobs` — lazy só adiaria a materialização para
--   dentro de um caminho concorrente (dois freelas convidados materializando a mesma ocorrência
--   duas vezes). `create_job_series` materializa TODAS as ocorrências na criação.
--
--   Depois de gerada, cada `jobs` é canônico e autônomo — editar uma ocorrência isolada faz ela
--   DIVERGIR do que `job_series` registra, e isso é o comportamento CORRETO (não um bug). Por
--   isso `job_series` só tem UM campo mutável (`status`), via `GRANT UPDATE (status)` — privilégio
--   de coluna, sem trigger de imutabilidade (só se justifica quando há transição condicional a
--   validar; aqui não há).
--
-- ============================================================================
-- 2. CANCELAR/EXCLUIR É SEMPRE `status = 'deleted'` — NUNCA `DELETE` (ADR, decisão 2; LM-1/LM-2)
-- ============================================================================
--   A spec original dizia "EXCLUI (mesmo mecanismo do botão 'Excluir' de hoje)" — isso é
--   FACTUALMENTE INCORRETO: o botão "Excluir" de hoje (`CompanyJobs.handleDelete`,
--   `CompanyJobDetails.tsx:136`) já faz `UPDATE jobs SET status = 'deleted'` (soft delete). Um
--   DELETE literal em lote de até 60 linhas exerceria PELA PRIMEIRA VEZ estas cascatas, todas
--   silenciosas:
--     - shift_calls.job_id      ON DELETE CASCADE  → apaga first_claim_at (métrica de ROI do F1)
--     - escrow_transactions.job_id ON DELETE CASCADE → apaga a linha de escrow SEM devolver saldo
--     - shift_payments.job_id   ON DELETE RESTRICT → aborta o LOTE INTEIRO se 1 ocorrência tiver recibo
--
--   `jobs.series_id` usa `ON DELETE SET NULL` (nunca CASCADE) — a série parar não apaga histórico
--   de turno nenhum. `job_series` reusa o MESMO valor `'deleted'` que `jobs.status` já usa em
--   produção (LM-2): `.neq('status','deleted')` já está espalhado (`CompanyJobs.tsx:308`,
--   `orderReportService.ts:251`) e `jobs.status` NÃO tem CHECK no banco — um status novo
--   (`'cancelled'`) vazaria silenciosamente por todo filtro que ainda não o conhece.
--
-- ============================================================================
-- 3. PREDICADO ÚNICO DE "OCORRÊNCIA TOCÁVEL" — mais estreito que a spec (ADR, decisão 3)
-- ============================================================================
--   A spec definia "sem freela ativo" como ausência de applications hired/in_progress/completed.
--   Isso deixava 2 furos: convite PENDENTE ('invited') seria editado/cancelado em massa enquanto
--   o freela ainda vê o convite vivo; e `claim_shift_slot` NÃO verifica `jobs.status` (corrigido
--   na migration seguinte, 20260817000500) — um chamado aberto sobreviveria ao cancelamento em
--   massa e um freela poderia aceitar vaga de turno já cancelado. O predicado usado nas duas RPCs
--   de massa (`update_job_series_future`, `stop_job_series`) é:
--
--     status = 'open' AND series_occurrence_date >= <data>
--     AND NOT EXISTS (applications COM status IN invited/applied/accepted/hired/in_progress/completed)
--     AND NOT EXISTS (escrow_transactions COM status IN reserved/authorized)
--     AND NOT EXISTS (shift_calls ABERTO)
--
--   Também resolve o risco de baixar `slots` numa ocorrência já parcialmente preenchida (quebraria
--   o invariante do F1 "o chamado fecha quando preenchidas >= slots").
--
--   CORREÇÃO (revisão pós-implementação, F3) — a checagem de escrow foi ADICIONADA depois da
--   primeira versão desta migration. A afirmação "ocorrência tocável nunca tem linha de escrow"
--   (ver ADR, seção "Verificação") só é verdadeira PORQUE este predicado agora exclui
--   explicitamente ocorrências com escrow vivo — sem esta linha, uma application 'hired' que
--   depois virasse 'cancelled' (não capturada pela lista invited..completed acima) deixaria a
--   ocorrência "tocável" com escrow 'reserved' ainda preso, e a RPC soft-deletaria o turno sem
--   devolver o saldo. Ambas as RPCs de massa PULAM essa ocorrência (mesmo balde
--   `skipped_filled`) em vez de chamar `refundEscrow` em laço — ver comentário inline em cada
--   função para o raciocínio completo.
--
-- ============================================================================
-- 3B. GUARDA CROSS-TENANT `jobs.series_id` ↔ `jobs.company_id` (hardening pós-revisão)
-- ============================================================================
--   NOTA DE PRECISÃO: este item foi levantado numa revisão de segurança como se estivesse no ADR
--   ("seção 3, GUARDA CROSS-TENANT", trigger `enforce_job_series_same_owner`). Conferido no texto
--   de ADR-20260817-serie-eager-e-cancelamento-suave.md: essa seção e esse nome NÃO existem lá — a
--   citação está incorreta. Registrando aqui com exatidão para não repetir a atribuição errada.
--   Isso NÃO muda o mérito: o vetor abaixo é real, verificado por leitura direta do código
--   (RLS de `jobs`, 20260816210000) e independente de qualquer citação de origem.
--
--   O VETOR: `jobs_update_company_owner` (20260816210000:181-190) só trava `company_id` no
--   `WITH CHECK` — permite à empresa reescrever QUALQUER outra coluna do PRÓPRIO turno, incluindo
--   `series_id`. Nada impede a empresa B de fazer
--     `UPDATE jobs SET series_id = <série da empresa A> WHERE id = <turno da própria B>`
--   (RLS permite: B segue dona do turno que edita; `company_id` não mudou). Se a empresa A depois
--   chama `stop_job_series`/`update_job_series_future` sobre a PRÓPRIA série, o `WHERE
--   j.series_id = p_series_id` das duas RPCs (antes desta seção) não tinha NENHUMA correlação com
--   `j.company_id` — encontraria e soft-deletaria/mutaria o turno de B. `is_company_owner
--   (v_series.company_id)` autoriza corretamente a operação SOBRE A SÉRIE; o furo é o `WHERE` que
--   seleciona as LINHAS afetadas não amarrar isso a `j.company_id`.
--
--   DUAS camadas, nenhuma dependendo só da outra:
--   (1) TRIGGER `enforce_job_series_same_owner` (`BEFORE INSERT OR UPDATE OF series_id,
--       company_id ON jobs`): exige que o `job_series.company_id` do `series_id` referenciado
--       bata com `NEW.company_id`; senão `RAISE EXCEPTION` (foreign_key_violation). Fecha o vetor
--       na ORIGEM — a escrita de `jobs.series_id` propriamente, de qualquer caminho futuro.
--   (2) `AND j.company_id = v_series.company_id` acrescentado ao `WHERE` das duas RPCs de massa —
--       barato e independente do trigger: se alguém rodar `DROP TRIGGER` no futuro, a RPC segue
--       correta por conta própria.
--
--   SECURITY INVOKER (decisão registrada — o revisor sugeriu DEFINER "por robustez", e a
--   objeção é legítima; a escolha aqui é INVOKER, com o motivo escrito): sob RLS,
--   `job_series_select` (`is_company_owner`) já torna a série alheia INVISÍVEL para a sessão que
--   tenta a escrita — o `EXISTS` dá falso e a exceção dispara, falha FECHADO, sem criar mais um
--   objeto SECURITY DEFINER para auditar (mesmo raciocínio de `is_job_owner`/`is_company_owner`
--   serem INVOKER quando a tabela subjacente já tem SELECT aberto ao papel certo). A checagem
--   explícita `s.company_id = NEW.company_id` dentro do `EXISTS` é a garantia que NÃO depende de
--   RLS (vale também para um executor com bypassrls, ex.: `service_role`) — ela SOMA-SE à
--   invisibilidade por RLS, não a substitui. Se no futuro `job_series` ganhar uma policy de
--   SELECT mais permissiva, only a garantia explícita (não a invisibilidade) continua segurando.
--
-- ============================================================================
-- 4. TRÊS OPERAÇÕES DE MASSA SÃO RPC, NÃO IDAS-E-VINDAS DO CLIENT (ADR, decisão 4)
-- ============================================================================
--   `create_job_series` é INVOKER (só insere linhas do PRÓPRIO chamador; as policies
--   `jobs_insert_company_owner`/`job_series_insert` já cobrem — INVOKER falha fechado).
--   `update_job_series_future`/`stop_job_series` são DEFINER com checagem EXPLÍCITA de
--   `is_company_owner` no topo (mesmo padrão de `cancel_shift_call`/`is_job_owner`,
--   20260817000200): o predicado-guarda precisa ver TODAS as applications/shift_calls da
--   ocorrência para decidir se ela é tocável, e a policy de `applications` ancora só em
--   `jobs.company_id = auth.uid()` (âncora SIMPLES) enquanto `jobs`/`job_series` usam ancoragem
--   DUPLA — numa empresa ancorada só por `companies.owner_id`, ler sob RLS faria o `NOT EXISTS`
--   "ver menos do que existe" e cancelar um turno com freela. Falha aberta. Por isso DEFINER.
--   As duas também SERIALIZAM com `FOR UPDATE OF j` — sem isso, ler→filtrar→escrever em até 60
--   linhas abriria uma janela de corrida check-then-act (freela aceita entre a leitura e a escrita).
--
-- ============================================================================
-- 4B. PRÉVIA (DRY-RUN) NAS DUAS RPCs DE MASSA — pedido de revisão de UX pós-review
-- ============================================================================
--   Sem prévia, o gestor confirma "Cancelar a série" às cegas quanto ao IMPACTO: só descobre
--   quantos turnos foram afetados DEPOIS de confirmar uma ação que pode desmarcar até 60 turnos
--   da agenda de uma vez. Calcular essa contagem no CLIENT duplicaria o predicado-guarda da seção
--   3 contra a RLS SIMPLES de `applications` — o mesmo argumento da seção 4 ("falha aberta") vale
--   aqui: a contagem MENTIRIA para uma empresa ancorada só via `companies.owner_id`. Número
--   mentiroso é pior que número nenhum.
--
--   `p_dry_run boolean DEFAULT false` em `update_job_series_future`/`stop_job_series`: MESMO
--   predicado, MESMO loop, MESMO lock (`FOR UPDATE OF j`) — a ÚNICA diferença é que o `UPDATE`
--   mutante não executa quando `p_dry_run = true`. `outcome` muda para `'preview'` e os
--   contadores trocam de nome (`would_update`/`would_cancel`) para o client nunca confundir
--   prévia com execução. A autorização (`is_company_owner`) roda igual no dry-run — não vira um
--   oráculo para contar turnos de série alheia (outcome `forbidden`/`not_found` idênticos).
--
--   Default `false`: chamadas existentes de `update_job_series_future`/`stop_job_series` sem o
--   4º parâmetro continuam idênticas — PostgREST aplica o DEFAULT do lado do banco quando o
--   client omite um argumento nomeado. Nenhuma mudança de contrato para quem já chama as duas.
--
-- ============================================================================
-- 5. `is_company_owner` REUSADA VERBATIM (NÃO cria helper novo) — ADR, decisão 5
-- ============================================================================
--   `job_series` ancora direto na empresa (sem job no caminho da criação) — mesma forma de
--   `team_lists` (20260817000300). Reusa `public.is_company_owner(uuid)` como está; NÃO unifica
--   com `is_job_owner` aqui (o gatilho dessa unificação é a mudança da REGRA de autorização de
--   empresa — multi-unidade/gerente —, que não acontece nesta migration, ver
--   ADR-20260817-seam-autorizacao-empresa.md).
--
-- ============================================================================
-- 6. FUSO — data local é a fonte da verdade; `start_date` é DERIVADO (ADR, decisão 6; LM-5)
-- ============================================================================
--   `job_series.range_start_date/range_end_date` e `jobs.series_occurrence_date`: `date` (sem
--   fuso, identidade estável da ocorrência — é a chave do índice único parcial que impede
--   duplicação por duplo-clique/bug). `jobs.start_date` (timestamptz) é DERIVADO com a mesma
--   convenção de meio-dia usada no client (`dateUtils.localDateToTimestamp`, extraída da cópia
--   inline que existia em `CompanyCreateJob.handleSubmit:187`):
--     (data::text || ' 12:00:00')::timestamp AT TIME ZONE 'America/Sao_Paulo'
--   Meio-dia dá ±3h de folga: qualquer fuso brasileiro cai no mesmo dia civil. A aritmética de
--   QUAIS datas gerar (iterar dias, casar dia-da-semana) mora em `lib/recurrence.ts` (client, pura,
--   testável) — de propósito NÃO em SQL puro (`generate_series`+`EXTRACT(DOW)`): isso tiraria a
--   regra do alcance dos testes unitários e deixaria o cap do R7 sem validação ANTES do INSERT.
--   O client calcula; a RPC revalida (cap) e materializa.
--
-- ============================================================================
-- 7. CAP DE 60 — DEFESA EM PROFUNDIDADE REAL (ADR, decisão 7)
-- ============================================================================
--   Um `CHECK (occurrences_generated <= 60)` em `job_series` não defenderia nada — o client
--   escreve esse valor. A defesa real é um TRIGGER DE STATEMENT em `jobs`
--   (`REFERENCING NEW TABLE`), que conta as linhas REAIS por `series_id` depois de cada INSERT.
--   Statement-level (não row-level): `create_job_series` faz um ÚNICO `INSERT ... SELECT` para
--   o lote inteiro (nunca um laço de INSERTs de 1 linha) — assim o trigger conta UMA vez por
--   gesto, não sessenta. `SECURITY DEFINER` para a contagem não depender da RLS de `jobs`.
--
-- Article 8 INTACTO: nenhuma tabela/RPC de saldo tocada (ver ADR, seção "Verificação").
-- Risk: MEDIUM (3 funções SECURITY DEFINER novas — cap, update_job_series_future, stop_job_series
-- — mitigado por checagem explícita de is_company_owner nas duas últimas + REVOKE de PUBLIC/anon
-- nas três; a guarda cross-tenant, seção 3B, é INVOKER). Reversível (DOWN abaixo).
--
-- ============================================================================
-- DOWN (rollback)
-- ============================================================================
--   DROP TRIGGER IF EXISTS trg_check_job_series_cap ON public.jobs;
--   DROP FUNCTION IF EXISTS public.check_job_series_cap();
--   DROP TRIGGER IF EXISTS trg_enforce_job_series_same_owner ON public.jobs;
--   DROP FUNCTION IF EXISTS public.enforce_job_series_same_owner();
--   DROP FUNCTION IF EXISTS public.create_job_series(uuid, text, integer[], date, date, date[], jsonb);
--   DROP FUNCTION IF EXISTS public.update_job_series_future(uuid, date, jsonb, boolean);
--   DROP FUNCTION IF EXISTS public.stop_job_series(uuid, date, boolean);
--   DROP INDEX IF EXISTS public.idx_jobs_series_occurrence_unique;
--   DROP INDEX IF EXISTS public.idx_jobs_series_id;
--   ALTER TABLE public.jobs DROP COLUMN IF EXISTS series_occurrence_date;
--   ALTER TABLE public.jobs DROP COLUMN IF EXISTS series_id;
--   DROP TABLE IF EXISTS public.job_series;
--
-- ============================================================================
-- COMO VERIFICAR (read-only, depois de aplicar)
-- ============================================================================
--   V1. RLS ligada, FORCE desligada:
--       SELECT relname, relrowsecurity, relforcerowsecurity FROM pg_class
--        WHERE oid = 'public.job_series'::regclass;
--       -- ESPERADO: job_series | t | f
--
--   V2. Exatamente 3 policies (SELECT/INSERT/UPDATE) — NENHUMA DELETE (LM-11):
--       SELECT policyname, cmd FROM pg_policies
--        WHERE tablename = 'job_series' ORDER BY cmd;
--       -- ESPERADO: 3 linhas, cmd IN ('SELECT','INSERT','UPDATE'); nenhuma 'DELETE'.
--
--   V3. anon sem privilégio; authenticated com SELECT/INSERT de tabela e UPDATE SÓ de `status`:
--       SELECT has_table_privilege('anon','public.job_series','SELECT')            AS anon_sel,
--              has_table_privilege('authenticated','public.job_series','SELECT')   AS auth_sel,
--              has_table_privilege('authenticated','public.job_series','INSERT')   AS auth_ins,
--              has_column_privilege('authenticated','public.job_series','status','UPDATE')     AS upd_status,
--              has_column_privilege('authenticated','public.job_series','company_id','UPDATE') AS upd_company_id;
--       -- ESPERADO: f | t | t | t | f
--
--   V4. `jobs` ganhou as 2 colunas + os 2 índices:
--       SELECT column_name, is_nullable FROM information_schema.columns
--        WHERE table_schema='public' AND table_name='jobs'
--          AND column_name IN ('series_id','series_occurrence_date');
--       -- ESPERADO: 2 linhas, ambas is_nullable = 'YES'
--       SELECT indexname FROM pg_indexes WHERE tablename = 'jobs' AND indexname LIKE 'idx_jobs_series%';
--       -- ESPERADO: idx_jobs_series_id, idx_jobs_series_occurrence_unique
--
--   V5. Trigger de cap é STATEMENT-level (não ROW) — bit 0 de tgtype = 0 quando statement-level:
--       SELECT tgname, (tgtype & 1) AS is_row_level, tgfoid::regproc AS fn
--         FROM pg_trigger WHERE tgrelid = 'public.jobs'::regclass
--          AND tgname = 'trg_check_job_series_cap';
--       -- ESPERADO: 1 linha, is_row_level = 0, fn = check_job_series_cap
--
--   V6. GRANTs das RPCs/triggers — authenticated com EXECUTE, anon sem:
--       SELECT p.proname,
--              has_function_privilege('authenticated', p.oid, 'EXECUTE') AS auth_exec,
--              has_function_privilege('anon', p.oid, 'EXECUTE')          AS anon_exec
--         FROM pg_proc p WHERE p.proname IN
--             ('create_job_series','update_job_series_future','stop_job_series',
--              'check_job_series_cap','enforce_job_series_same_owner');
--       -- ESPERADO: 5 linhas, auth_exec = t, anon_exec = f
--
--   V7. Isolamento entre empresas (A8 da spec) — substitua pelos ids reais de duas empresas
--       distintas (A tem ao menos uma linha em job_series; a sessão abaixo é da empresa B):
--       BEGIN;
--         SELECT set_config('role','authenticated',true);
--         SELECT set_config('request.jwt.claims','{"sub":"<UUID_EMPRESA_B>","role":"authenticated"}',true);
--         SELECT count(*) FROM public.job_series WHERE company_id = '<UUID_EMPRESA_A>';
--         -- ESPERADO: 0 (RLS filtra a linha alheia, sem erro, sem vazar existência)
--       ROLLBACK;
--
--   V8. Guarda cross-tenant fechada (seção 3B) — sob role=authenticated como empresa B, tentar
--       apontar o PRÓPRIO turno para a série de outra empresa falha:
--       BEGIN;
--         SELECT set_config('role','authenticated',true);
--         SELECT set_config('request.jwt.claims','{"sub":"<UUID_EMPRESA_B>","role":"authenticated"}',true);
--         UPDATE public.jobs SET series_id = '<SERIE_DA_EMPRESA_A>' WHERE id = '<TURNO_DA_EMPRESA_B>';
--         -- ESPERADO: erro (foreign_key_violation) — trigger enforce_job_series_same_owner bloqueia
--       ROLLBACK;
--
--   V9. Dry-run não muta (seção 4B) — substitua pelos ids de uma série própria com ao menos uma
--       ocorrência futura tocável:
--       SELECT public.stop_job_series('<SERIE_ID>', NULL, true);
--       -- ESPERADO: {"outcome":"preview","would_cancel":N,...} com N > 0
--       SELECT status FROM public.jobs WHERE series_id = '<SERIE_ID>' AND status = 'deleted';
--       -- ESPERADO: 0 linhas (nada foi soft-deletado pela prévia)
--
--   V10. Escrow vivo é pulado (não soft-deletado, não refundado em laço) — substitua pelos ids
--        de uma ocorrência com escrow_transactions.status IN ('reserved','authorized') e SEM
--        application não-terminal (simula application 'hired' que foi cancelada depois de
--        auto_reserve_escrow_on_hire ter reservado):
--        SELECT public.stop_job_series('<SERIE_ID>', NULL, false);
--        -- ESPERADO: skipped_filled >= 1 (inclui esta ocorrência)
--        SELECT status FROM public.jobs WHERE id = '<JOB_ID_COM_ESCROW>';
--        -- ESPERADO: 'open' (NÃO 'deleted' — a ocorrência não foi tocada)
--        SELECT status FROM public.escrow_transactions WHERE job_id = '<JOB_ID_COM_ESCROW>';
--        -- ESPERADO: ainda 'reserved'/'authorized' (nem refundado nem perdido — saldo intacto,
--        -- Article 8; resolução é manual, mesmo fluxo do botão "Excluir" individual)
-- ============================================================================

-- =============================================
-- 1. TABELA `job_series` — o molde + registro de auditoria
-- =============================================
CREATE TABLE IF NOT EXISTS public.job_series (
    id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    company_id            uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
    recurrence_type       text NOT NULL CHECK (recurrence_type IN ('weekly', 'daily')),
    -- 0=domingo..6=sábado. NULL quando 'daily'; obrigatório e não-vazio quando 'weekly'.
    weekdays              integer[],
    range_start_date      date NOT NULL,
    range_end_date        date NOT NULL,
    occurrences_generated integer NOT NULL DEFAULT 0 CHECK (occurrences_generated >= 0),
    -- 'stopped' = "Cancelar a série inteira" (R11) — impede reaproveitar a série. NÃO é exclusão:
    -- não há policy de DELETE (LM-11, ver seção 4).
    status                text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'stopped')),
    created_by            uuid NOT NULL,
    created_at            timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT job_series_range_order CHECK (range_end_date >= range_start_date),
    CONSTRAINT job_series_weekly_weekdays CHECK (
        (recurrence_type = 'weekly' AND weekdays IS NOT NULL AND array_length(weekdays, 1) > 0)
        OR (recurrence_type = 'daily' AND weekdays IS NULL)
    ),
    -- Containment de array (`<@`), não subquery: CHECK não pode referenciar outra linha nem
    -- rodar um SELECT — `<@` é uma expressão booleana pura.
    CONSTRAINT job_series_weekdays_domain CHECK (weekdays IS NULL OR weekdays <@ ARRAY[0,1,2,3,4,5,6])
);

COMMENT ON TABLE public.job_series IS
    'Registro-mãe da Escala Recorrente (F3). MOLDE + AUDITORIA do que foi pedido — não é dono das '
    'ocorrências: depois de create_job_series materializar as linhas de jobs, cada uma é canônica '
    'e autônoma (ADR-20260817-serie-eager-e-cancelamento-suave, decisão 1). Único campo mutável: '
    'status (GRANT UPDATE de coluna) — via stop_job_series, nunca .update() direto do client em '
    'uso normal.';
COMMENT ON COLUMN public.job_series.weekdays IS
    '0=domingo..6=sábado. NULL quando recurrence_type=daily; obrigatório e não-vazio quando weekly.';
COMMENT ON COLUMN public.job_series.occurrences_generated IS
    'Quantas ocorrências create_job_series materializou. Informativo/auditoria — o CAP real (60) '
    'é reforçado pelo trigger de statement em jobs (check_job_series_cap), não por CHECK aqui '
    '(CHECK validaria um número que o próprio client escolhe — teatro de constraint).';
COMMENT ON COLUMN public.job_series.status IS
    'active = em vigor (histórico do que foi pedido). stopped = "Cancelar a série inteira" (R11): '
    'impede reaproveitar a série para extensões futuras. NÃO é exclusão — job_series não tem '
    'policy de DELETE de propósito (LM-11).';

CREATE INDEX IF NOT EXISTS idx_job_series_company ON public.job_series (company_id, created_at DESC);

-- =============================================
-- 2. `jobs` GANHA A OCORRÊNCIA — 2 colunas nullable (R2: turno avulso = series_id IS NULL)
-- =============================================
ALTER TABLE public.jobs
    ADD COLUMN IF NOT EXISTS series_id uuid REFERENCES public.job_series(id) ON DELETE SET NULL,
    ADD COLUMN IF NOT EXISTS series_occurrence_date date;

COMMENT ON COLUMN public.jobs.series_id IS
    'FK para job_series (nullable — NULL = turno avulso, comportamento de hoje inalterado). '
    'ON DELETE SET NULL (nunca CASCADE): job_series não tem policy de DELETE mesmo assim (LM-11), '
    'então este ON DELETE só protege contra um DELETE manual via service_role/console. Guardado '
    'contra cross-tenant pelo trigger enforce_job_series_same_owner (seção 2B).';
COMMENT ON COLUMN public.jobs.series_occurrence_date IS
    'Data LOCAL (date, sem fuso) desta ocorrência dentro da série — identidade estável, chave do '
    'índice único parcial que impede duplicação por duplo-clique/retry (idx_jobs_series_occurrence_unique). '
    'jobs.start_date (timestamptz) é DERIVADO desta coluna com a âncora de meio-dia '
    '(ADR, decisão 6) — nunca o contrário.';

-- Dedupe DENTRO DE UMA SÉRIE: no máximo 1 ocorrência ativa por (série, dia). Isso cobre datas
-- duplicadas no MESMO array `p_occurrence_dates` de uma chamada de create_job_series (ex.: bug
-- futuro no gerador de datas do client) — a segunda linha do lote colidiria e o INSERT...SELECT
-- inteiro falharia com 23505 (LM-12: o service traduz esse código, ver jobSeriesService.ts).
-- `WHERE status <> 'deleted'`: uma ocorrência cancelada (soft delete) libera o dia para uma nova
-- geração futura, sem reviver a linha antiga.
--
-- CORREÇÃO (revisão pós-implementação, F3) — o QUE ESTE ÍNDICE NÃO FAZ: NÃO protege contra
-- duplo-clique em "Criar Série". `create_job_series` cria um `job_series` NOVO
-- (`gen_random_uuid()`) a cada chamada — duas submissões idênticas (duplo-clique) produzem DUAS
-- séries com `series_id` DIFERENTES, e este índice, chaveado por `(series_id,
-- series_occurrence_date)`, nunca colide entre séries distintas. Resultado real de um
-- duplo-clique: 2 séries + 2N turnos, sem erro nenhum. A proteção contra duplo-clique HOJE é só
-- de UI (`disabled={loading}` no botão de submit da página, fora do território deste service) —
-- não existe defesa de banco para isso. Uma defesa de banco real exigiria uma UNIQUE separada em
-- job_series (ex.: `(company_id, recurrence_type, weekdays, range_start_date, range_end_date)
-- WHERE status='active'`), avaliada e DELIBERADAMENTE NÃO adotada aqui: bloquearia duas séries
-- CONCORRENTES legítimas com o mesmo padrão de dias/intervalo mas job_template diferente (ex.:
-- "Garçom" e "Cozinheiro", ambos toda semana no mesmo período) — job_series não guarda o
-- template, então a constraint não teria como distinguir os dois casos legítimos do duplo-clique.
CREATE UNIQUE INDEX IF NOT EXISTS idx_jobs_series_occurrence_unique
    ON public.jobs (series_id, series_occurrence_date)
    WHERE series_id IS NOT NULL AND status <> 'deleted';

CREATE INDEX IF NOT EXISTS idx_jobs_series_id
    ON public.jobs (series_id)
    WHERE series_id IS NOT NULL;

-- =============================================
-- 2B. GUARDA CROSS-TENANT — `jobs.series_id` só pode apontar para série da MESMA empresa
--     (ver cabeçalho, seção 3B, para o vetor completo e a decisão INVOKER vs DEFINER)
-- =============================================
CREATE OR REPLACE FUNCTION public.enforce_job_series_same_owner()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
BEGIN
    IF NEW.series_id IS NOT NULL THEN
        IF NOT EXISTS (
            SELECT 1 FROM public.job_series s
             WHERE s.id = NEW.series_id AND s.company_id = NEW.company_id
        ) THEN
            RAISE EXCEPTION
                'jobs.series_id % nao pertence a company_id % (guarda cross-tenant)',
                NEW.series_id, NEW.company_id
                USING ERRCODE = 'foreign_key_violation';
        END IF;
    END IF;
    RETURN NEW;
END;
$$;

COMMENT ON FUNCTION public.enforce_job_series_same_owner() IS
    'Guarda cross-tenant (seção 3B do cabeçalho desta migration): jobs.series_id só pode '
    'referenciar uma job_series cujo company_id bate com o do próprio jobs. SECURITY INVOKER de '
    'propósito — sob RLS, job_series_select (is_company_owner) já torna série alheia invisível '
    'para quem tenta a escrita, então o EXISTS falha e a exceção dispara (falha fechado) sem mais '
    'um objeto DEFINER para auditar; a checagem explícita s.company_id=NEW.company_id é a '
    'garantia que independe de RLS (cobre também executores com bypassrls).';

REVOKE ALL ON FUNCTION public.enforce_job_series_same_owner() FROM PUBLIC, anon;
-- Trigger function: precisa manter EXECUTE para `authenticated` (lição de
-- 20260816201420/20260816201457) — senão todo INSERT/UPDATE de series_id/company_id em jobs
-- quebraria para quem não é dono da função, inclusive create_job_series.
GRANT EXECUTE ON FUNCTION public.enforce_job_series_same_owner() TO authenticated, service_role;

DROP TRIGGER IF EXISTS trg_enforce_job_series_same_owner ON public.jobs;
CREATE TRIGGER trg_enforce_job_series_same_owner
    BEFORE INSERT OR UPDATE OF series_id, company_id ON public.jobs
    FOR EACH ROW
    EXECUTE FUNCTION public.enforce_job_series_same_owner();

-- =============================================
-- 3. CAP DE 60 — trigger de STATEMENT (defesa em profundidade real, ADR decisão 7)
-- =============================================
CREATE OR REPLACE FUNCTION public.check_job_series_cap()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_series_id uuid;
    v_count     integer;
BEGIN
    -- new_table cobre TODO o lote de um único INSERT ... SELECT (create_job_series faz UM
    -- statement, nunca um laço de INSERTs de 1 linha) — por isso esta contagem roda 1x por
    -- gesto, não 60x. Para INSERT de turno avulso (series_id NULL) o loop não itera nada.
    FOR v_series_id IN
        SELECT DISTINCT nt.series_id FROM new_table nt WHERE nt.series_id IS NOT NULL
    LOOP
        SELECT count(*) INTO v_count FROM public.jobs WHERE series_id = v_series_id;
        IF v_count > 60 THEN
            RAISE EXCEPTION
                'A serie % excederia o limite de 60 ocorrencias (tem %). INSERT revertido.',
                v_series_id, v_count
                USING ERRCODE = 'check_violation';
        END IF;
    END LOOP;
    RETURN NULL;
END;
$$;

COMMENT ON FUNCTION public.check_job_series_cap() IS
    'Defesa em profundidade do cap de 60 ocorrencias por serie (R7). CHECK em '
    'job_series.occurrences_generated nao defenderia nada (o client escreve esse numero) — este '
    'trigger conta as linhas REAIS de jobs por series_id apos cada INSERT statement. '
    'SECURITY DEFINER para a contagem nao depender da RLS de jobs.';

REVOKE ALL ON FUNCTION public.check_job_series_cap() FROM PUBLIC, anon;
-- Trigger function: PostgREST nunca expõe funções `RETURNS trigger` e o Postgres recusa chamada
-- direta ("trigger functions can only be called as triggers") — mas o disparo em runtime PRECISA
-- de EXECUTE para o papel que fez o INSERT (lição de 20260816201420/20260816201457: revogar de
-- `authenticated` aqui derrubaria toda criação de turno avulso, não só a série).
GRANT EXECUTE ON FUNCTION public.check_job_series_cap() TO authenticated, service_role;

DROP TRIGGER IF EXISTS trg_check_job_series_cap ON public.jobs;
CREATE TRIGGER trg_check_job_series_cap
    AFTER INSERT ON public.jobs
    REFERENCING NEW TABLE AS new_table
    FOR EACH STATEMENT
    EXECUTE FUNCTION public.check_job_series_cap();

-- =============================================
-- 4. RLS de `job_series`
--    Policies PRIMEIRO, ENABLE por último. SEM policy de DELETE (LM-11, de propósito).
-- =============================================
DROP POLICY IF EXISTS "job_series_select" ON public.job_series;
DROP POLICY IF EXISTS "job_series_insert" ON public.job_series;
DROP POLICY IF EXISTS "job_series_update" ON public.job_series;

CREATE POLICY "job_series_select" ON public.job_series
    FOR SELECT TO authenticated
    USING (public.is_company_owner(company_id));

CREATE POLICY "job_series_insert" ON public.job_series
    FOR INSERT TO authenticated
    WITH CHECK (public.is_company_owner(company_id) AND created_by = (SELECT auth.uid()));

-- Existe para simetria com o GRANT UPDATE (status) da seção 5 (mesmo par de team_lists, F2) —
-- mas na prática o client NUNCA chama .update() aqui: quem para a série é stop_job_series
-- (SECURITY DEFINER), que ignora RLS por rodar como dono da tabela.
CREATE POLICY "job_series_update" ON public.job_series
    FOR UPDATE TO authenticated
    USING (public.is_company_owner(company_id))
    WITH CHECK (public.is_company_owner(company_id));

ALTER TABLE public.job_series ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.job_series NO FORCE ROW LEVEL SECURITY;

-- =============================================
-- 5. GRANTS de `job_series`
--    NÃO fazer `REVOKE ALL ... FROM PUBLIC` (lição de 20260318000000: derruba service_role).
-- =============================================
REVOKE ALL ON public.job_series FROM anon;
GRANT SELECT, INSERT ON public.job_series TO authenticated;

-- GRANT de coluna é ADITIVO em Postgres — só restringe algo se `authenticated` NÃO tiver UPDATE
-- de TABELA. O REVOKE roda SEMPRE antes do GRANT de coluna (mesmo padrão de team_lists,
-- 20260817000300, e de 20260311300000_restrict_wallet_update_columns.sql).
REVOKE UPDATE ON public.job_series FROM authenticated;
GRANT UPDATE (status) ON public.job_series TO authenticated;

GRANT ALL ON public.job_series TO service_role;

-- =============================================
-- 6. RPC 1/3 — create_job_series (INVOKER: só insere linhas do próprio chamador)
-- =============================================
CREATE OR REPLACE FUNCTION public.create_job_series(
    p_company_id       uuid,
    p_recurrence_type  text,
    p_weekdays         integer[],
    p_range_start_date date,
    p_range_end_date   date,
    -- Datas já calculadas no client por lib/recurrence.ts (generateOccurrenceDates) — a RPC NÃO
    -- recalcula em SQL puro (ADR, "Alternativas rejeitadas": generate_series+EXTRACT(DOW) tiraria
    -- a regra do alcance dos testes unitários). O client calcula; a RPC revalida o CAP e materializa.
    p_occurrence_dates date[],
    -- Campos herdados por TODA ocorrência (R3). jsonb, não parâmetros text individuais (LM-15):
    -- work_start_time/work_end_time são `time` — um parâmetro `text` passado direto para a coluna
    -- exige cast explícito e um esquecimento quebra o INSERT; jsonb_populate_record usa a função
    -- de ENTRADA de cada coluna e resolve isso por construção.
    p_job_template     jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
DECLARE
    v_uid       uuid := (SELECT auth.uid());
    v_series_id uuid;
    v_rec       public.jobs;
    v_n         integer;
BEGIN
    IF v_uid IS NULL THEN
        RETURN jsonb_build_object('outcome', 'unauthenticated');
    END IF;

    v_n := COALESCE(cardinality(p_occurrence_dates), 0);
    IF v_n = 0 THEN
        RETURN jsonb_build_object('outcome', 'no_occurrences');
    END IF;
    -- Revalidação do cap (R7): o client já bloqueia antes de chamar, isto é defesa em
    -- profundidade com um outcome amigável — o trigger de statement (seção 3) é a última linha,
    -- para qualquer caminho que não passe por aqui.
    IF v_n > 60 THEN
        RETURN jsonb_build_object('outcome', 'cap_exceeded', 'occurrences', v_n);
    END IF;

    IF p_recurrence_type NOT IN ('weekly', 'daily') THEN
        RETURN jsonb_build_object('outcome', 'invalid_recurrence_type');
    END IF;
    IF p_recurrence_type = 'weekly' AND (p_weekdays IS NULL OR cardinality(p_weekdays) = 0) THEN
        RETURN jsonb_build_object('outcome', 'invalid_weekdays');
    END IF;

    -- INVOKER de propósito (ADR, decisão 4): a policy job_series_insert já garante
    -- is_company_owner(company_id) AND created_by=auth.uid() — falha fechado, sem checagem
    -- redundante aqui. created_by vem de auth.uid() direto (nunca de um parâmetro do client).
    INSERT INTO public.job_series (
        company_id, recurrence_type, weekdays, range_start_date, range_end_date,
        occurrences_generated, status, created_by
    ) VALUES (
        p_company_id,
        p_recurrence_type,
        CASE WHEN p_recurrence_type = 'weekly' THEN p_weekdays ELSE NULL END,
        p_range_start_date,
        p_range_end_date,
        v_n,
        'active',
        v_uid
    ) RETURNING id INTO v_series_id;

    -- Molde resolvido UMA vez (é igual para todas as ocorrências; só start_date/
    -- series_occurrence_date variam por linha).
    v_rec := jsonb_populate_record(NULL::public.jobs, p_job_template);

    -- UM `INSERT ... SELECT` para o lote inteiro (nunca um laço de INSERTs de 1 linha): é o que
    -- faz o trigger de cap (seção 3) contar uma vez por gesto, não sessenta (ADR, decisão 7).
    -- jobs_insert_company_owner (RLS) valida company_id por linha, igual a qualquer outro INSERT.
    -- series_id/company_id aqui SEMPRE nascem coerentes (v_series_id acabou de ser criado com
    -- company_id = p_company_id nesta mesma transação) — o trigger da seção 2B passa por
    -- construção; o vetor que ele fecha é UPDATE posterior por outro caminho, não este INSERT.
    INSERT INTO public.jobs (
        company_id, title, category, type, description, requirements, briefing,
        location, budget, budget_type, start_date, scope,
        work_start_time, work_end_time, has_lunch, slots, status,
        series_id, series_occurrence_date
    )
    SELECT
        p_company_id, v_rec.title, v_rec.category, v_rec.type, v_rec.description,
        v_rec.requirements, v_rec.briefing, v_rec.location, v_rec.budget, v_rec.budget_type,
        -- Meio-dia local — mesma convenção de dateUtils.localDateToTimestamp (ADR, decisão 6).
        ((occ.d::text || ' 12:00:00')::timestamp AT TIME ZONE 'America/Sao_Paulo'),
        v_rec.scope, v_rec.work_start_time, v_rec.work_end_time, v_rec.has_lunch, v_rec.slots,
        'open', v_series_id, occ.d
    FROM unnest(p_occurrence_dates) AS occ(d);

    RETURN jsonb_build_object('outcome', 'ok', 'series_id', v_series_id, 'occurrences', v_n);
END;
$$;

COMMENT ON FUNCTION public.create_job_series(uuid, text, integer[], date, date, date[], jsonb) IS
    'Cria job_series + materializa N jobs (ocorrencias) numa unica transacao (LM-11: nao existe '
    'nem precisa de "desfazer a serie se o lote falhar" — e uma so operacao atomica). INVOKER: '
    'falha fechado sob as policies existentes. UM INSERT...SELECT para o lote inteiro (nao um '
    'laco), para o trigger de cap contar uma vez por gesto. Outcomes: ok|unauthenticated|'
    'no_occurrences|cap_exceeded|invalid_recurrence_type|invalid_weekdays.';

-- =============================================
-- 7. RPC 2/3 — update_job_series_future (DEFINER: "este e os futuros", R11)
-- =============================================
CREATE OR REPLACE FUNCTION public.update_job_series_future(
    p_series_id uuid,
    p_from_date date,
    p_patch     jsonb,
    -- Prévia (seção 4B): quando true, roda os MESMOS contadores/predicado e NÃO executa nenhum
    -- UPDATE. Default false preserva o contrato para quem já chama sem este parâmetro.
    p_dry_run   boolean DEFAULT false
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_series         public.job_series%ROWTYPE;
    v_updated        integer := 0;
    v_skipped_filled integer := 0;
    v_skipped_called integer := 0;
    v_job_id         uuid;
BEGIN
    SELECT * INTO v_series FROM public.job_series WHERE id = p_series_id;
    IF NOT FOUND THEN
        RETURN jsonb_build_object('outcome', 'not_found');
    END IF;

    -- DEFINER desliga a RLS: autorizacao explicita, na unha (mesmo padrao de cancel_shift_call /
    -- is_job_owner, 20260817000200). O predicado-guarda abaixo precisa ver TODAS as applications/
    -- shift_calls da ocorrencia — nao pode depender de uma RLS que pode "esconder" uma linha e
    -- fazer o NOT EXISTS mentir (ADR, decisao 4).
    IF NOT public.is_company_owner(v_series.company_id) THEN
        RETURN jsonb_build_object('outcome', 'forbidden');
    END IF;

    -- FOR UPDATE OF j serializa contra a mesma corrida check-then-act que claim_shift_slot
    -- resolve com lock em jobs: sem isso, um freela poderia aceitar/ser convidado ENTRE a leitura
    -- e o UPDATE desta ocorrencia.
    FOR v_job_id IN
        SELECT j.id
          FROM public.jobs j
         WHERE j.series_id = p_series_id
           -- Guarda cross-tenant (seção 2B/3B), redundante com o trigger de propósito: mesmo que
           -- o trigger seja removido no futuro, esta RPC continua correta por conta própria.
           AND j.company_id = v_series.company_id
           AND j.status = 'open'
           AND j.series_occurrence_date >= p_from_date
         ORDER BY j.series_occurrence_date
         FOR UPDATE OF j
    LOOP
        -- Predicado unico de "ocorrencia tocavel" (ADR, decisao 3) — mais estreito que a spec
        -- original: convite PENDENTE ('invited') e chamado ABERTO tambem travam a edicao em
        -- massa, nao so hired/in_progress/completed.
        IF EXISTS (
            SELECT 1 FROM public.applications a
             WHERE a.job_id = v_job_id
               AND a.status IN ('invited', 'applied', 'accepted', 'hired', 'in_progress', 'completed')
        ) THEN
            v_skipped_filled := v_skipped_filled + 1;
            CONTINUE;
        END IF;

        -- CORREÇÃO (revisão pós-implementação, F3): o predicado acima ('invited'..'completed')
        -- NÃO inclui 'cancelled'. auto_reserve_escrow_on_hire (20260311200000) reserva escrow no
        -- fluxo PULL legado sempre que uma application vai a 'hired' — inclusive numa ocorrência
        -- de série (nada impede um freela de se candidatar por pull a um turno gerado pela
        -- série). Se essa application depois é cancelada, a ocorrência PASSA no filtro acima
        -- (nenhuma application não-terminal) mas ainda tem escrow_transactions 'reserved'/
        -- 'authorized' vivo — dinheiro reservado da empresa. O caminho individual de exclusão
        -- (CompanyJobs.handleDelete) chama WalletService.refundEscrow ANTES do soft delete; esta
        -- RPC de massa não deve chamar refundEscrow em laço (N chamadas não-atômicas para
        -- reverter reservas — o ADR rejeita esse padrão) — em vez disso, pula a ocorrência: o
        -- saldo fica preso (nunca perdido, nunca movido indevidamente — Article 8 intacto), e a
        -- empresa resolve manualmente (mesmo fluxo de "Excluir" de hoje, que refunda antes de
        -- deletar). Conta no MESMO balde skipped_filled (não um terceiro contador): do ponto de
        -- vista do gestor, "este turno tem uma pendência que exige atenção manual" é a mesma
        -- categoria de aviso, e um balde novo exigiria mudar o contrato consumido pela UI.
        IF EXISTS (
            SELECT 1 FROM public.escrow_transactions e
             WHERE e.job_id = v_job_id AND e.status IN ('reserved', 'authorized')
        ) THEN
            v_skipped_filled := v_skipped_filled + 1;
            CONTINUE;
        END IF;

        IF EXISTS (
            SELECT 1 FROM public.shift_calls sc
             WHERE sc.job_id = v_job_id AND sc.status = 'open'
        ) THEN
            v_skipped_called := v_skipped_called + 1;
            CONTINUE;
        END IF;

        -- jsonb_populate_record(jt, p_patch): campos AUSENTES em p_patch mantem o valor ATUAL da
        -- linha (base = a propria linha, nao NULL) — patch parcial sem COALESCE manual por campo.
        -- budget/budget_type/type/scope/has_lunch NUNCA entram no SET list abaixo (R11: budget e
        -- imutavel pos-criacao; os demais nao fazem parte da edicao em massa da spec) — mesmo que
        -- o client mande essas chaves no jsonb, sao ignoradas por construcao (nao por validacao).
        IF NOT p_dry_run THEN
            UPDATE public.jobs jt
               SET (title, category, description, requirements, briefing, location,
                    work_start_time, work_end_time, slots)
                 = (SELECT r.title, r.category, r.description, r.requirements, r.briefing, r.location,
                           r.work_start_time, r.work_end_time, r.slots
                      FROM jsonb_populate_record(jt, p_patch) r)
             WHERE jt.id = v_job_id;
        END IF;

        v_updated := v_updated + 1;
    END LOOP;

    IF p_dry_run THEN
        RETURN jsonb_build_object(
            'outcome', 'preview',
            'would_update', v_updated,
            'skipped_filled', v_skipped_filled,
            'skipped_called', v_skipped_called
        );
    END IF;

    RETURN jsonb_build_object(
        'outcome', 'ok',
        'updated', v_updated,
        'skipped_filled', v_skipped_filled,
        'skipped_called', v_skipped_called
    );
END;
$$;

COMMENT ON FUNCTION public.update_job_series_future(uuid, date, jsonb, boolean) IS
    'R11 "Este e os futuros": aplica p_patch (title/category/description/requirements/briefing/'
    'location/work_start_time/work_end_time/slots — NUNCA budget) as ocorrencias com '
    'series_occurrence_date >= p_from_date, status=open, company_id=v_series.company_id (guarda '
    'cross-tenant, secao 2B/3B), sem vinculo nao-terminal (applications invited/applied/'
    'accepted/hired/in_progress/completed OU shift_call aberto) e sem escrow vivo (reserved/'
    'authorized — pulada no mesmo balde skipped_filled em vez de refundEscrow em laco). DEFINER '
    'com checagem explicita de is_company_owner. p_dry_run=true roda o mesmo predicado sem '
    'escrever (outcome preview). Outcomes: ok|preview|not_found|forbidden.';

-- =============================================
-- 8. RPC 3/3 — stop_job_series (DEFINER: "Cancelar a série inteira", R11)
-- =============================================
CREATE OR REPLACE FUNCTION public.stop_job_series(
    p_series_id uuid,
    p_from_date date DEFAULT NULL,
    -- Prévia (seção 4B): mesma semântica de update_job_series_future.p_dry_run.
    p_dry_run   boolean DEFAULT false
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_series         public.job_series%ROWTYPE;
    v_from           date;
    v_cancelled      integer := 0;
    v_skipped_filled integer := 0;
    v_skipped_called integer := 0;
    v_job_id         uuid;
BEGIN
    SELECT * INTO v_series FROM public.job_series WHERE id = p_series_id;
    IF NOT FOUND THEN
        RETURN jsonb_build_object('outcome', 'not_found');
    END IF;

    IF NOT public.is_company_owner(v_series.company_id) THEN
        RETURN jsonb_build_object('outcome', 'forbidden');
    END IF;

    -- "Hoje" local do servidor (America/Sao_Paulo) quando o client nao informa — mesma
    -- convencao de fuso do resto da feature (ADR, decisao 6).
    v_from := COALESCE(p_from_date, ((now() AT TIME ZONE 'America/Sao_Paulo'))::date);

    FOR v_job_id IN
        SELECT j.id
          FROM public.jobs j
         WHERE j.series_id = p_series_id
           -- Guarda cross-tenant (seção 2B/3B) — mesma razão de update_job_series_future.
           AND j.company_id = v_series.company_id
           AND j.status = 'open'
           AND j.series_occurrence_date >= v_from
         ORDER BY j.series_occurrence_date
         FOR UPDATE OF j
    LOOP
        IF EXISTS (
            SELECT 1 FROM public.applications a
             WHERE a.job_id = v_job_id
               AND a.status IN ('invited', 'applied', 'accepted', 'hired', 'in_progress', 'completed')
        ) THEN
            v_skipped_filled := v_skipped_filled + 1;
            CONTINUE;
        END IF;

        -- CORREÇÃO (revisão pós-implementação, F3): o predicado acima ('invited'..'completed')
        -- NÃO inclui 'cancelled'. auto_reserve_escrow_on_hire (20260311200000) reserva escrow no
        -- fluxo PULL legado sempre que uma application vai a 'hired' — inclusive numa ocorrência
        -- de série (nada impede um freela de se candidatar por pull a um turno gerado pela
        -- série). Se essa application depois é cancelada, a ocorrência PASSA no filtro acima
        -- (nenhuma application não-terminal) mas ainda tem escrow_transactions 'reserved'/
        -- 'authorized' vivo — dinheiro reservado da empresa. O caminho individual de exclusão
        -- (CompanyJobs.handleDelete) chama WalletService.refundEscrow ANTES do soft delete; esta
        -- RPC de massa não deve chamar refundEscrow em laço (N chamadas não-atômicas para
        -- reverter reservas — o ADR rejeita esse padrão) — em vez disso, pula a ocorrência: o
        -- saldo fica preso (nunca perdido, nunca movido indevidamente — Article 8 intacto), e a
        -- empresa resolve manualmente (mesmo fluxo de "Excluir" de hoje, que refunda antes de
        -- deletar). Conta no MESMO balde skipped_filled (não um terceiro contador): do ponto de
        -- vista do gestor, "este turno tem uma pendência que exige atenção manual" é a mesma
        -- categoria de aviso, e um balde novo exigiria mudar o contrato consumido pela UI.
        IF EXISTS (
            SELECT 1 FROM public.escrow_transactions e
             WHERE e.job_id = v_job_id AND e.status IN ('reserved', 'authorized')
        ) THEN
            v_skipped_filled := v_skipped_filled + 1;
            CONTINUE;
        END IF;

        IF EXISTS (
            SELECT 1 FROM public.shift_calls sc
             WHERE sc.job_id = v_job_id AND sc.status = 'open'
        ) THEN
            v_skipped_called := v_skipped_called + 1;
            CONTINUE;
        END IF;

        -- LM-1/ADR decisao 2: SEMPRE soft delete, NUNCA DELETE literal. Reusa o MESMO valor
        -- 'deleted' que CompanyJobs/CompanyJobDetails ja usam (LM-2).
        IF NOT p_dry_run THEN
            UPDATE public.jobs SET status = 'deleted' WHERE id = v_job_id;
        END IF;
        v_cancelled := v_cancelled + 1;
    END LOOP;

    IF p_dry_run THEN
        -- Prévia: nem a série é marcada 'stopped' — dry-run é 100% sem efeito colateral.
        RETURN jsonb_build_object(
            'outcome', 'preview',
            'would_cancel', v_cancelled,
            'skipped_filled', v_skipped_filled,
            'skipped_called', v_skipped_called
        );
    END IF;

    -- Para a serie (impede reaproveitar para extensoes futuras). NAO e exclusao: job_series nao
    -- tem policy de DELETE de proposito (LM-11) — este UPDATE (via DEFINER) e o unico caminho.
    UPDATE public.job_series SET status = 'stopped' WHERE id = p_series_id;

    RETURN jsonb_build_object(
        'outcome', 'ok',
        'cancelled', v_cancelled,
        'skipped_filled', v_skipped_filled,
        'skipped_called', v_skipped_called
    );
END;
$$;

COMMENT ON FUNCTION public.stop_job_series(uuid, date, boolean) IS
    'R11 "Cancelar a serie inteira": job_series.status=stopped + soft delete (status=deleted, '
    'NUNCA DELETE literal — ADR decisao 2) das ocorrencias futuras com company_id=v_series.'
    'company_id (guarda cross-tenant, secao 2B/3B), sem vinculo nao-terminal e sem escrow vivo '
    '(reserved/authorized). Ocorrencias com applications ativas, chamado aberto OU escrow preso '
    '(fluxo pull legado que reservou e depois cancelou — auto_reserve_escrow_on_hire) sao '
    'mantidas e reportadas no mesmo balde skipped_filled — NUNCA refundEscrow em laco. DEFINER '
    'com checagem explicita de is_company_owner. p_dry_run=true roda o mesmo predicado sem '
    'escrever nada, nem em jobs nem em job_series.status (outcome preview). '
    'Outcomes: ok|preview|not_found|forbidden.';

-- =============================================
-- 9. GRANTS das 3 RPCs
-- =============================================
REVOKE ALL ON FUNCTION public.create_job_series(uuid, text, integer[], date, date, date[], jsonb) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.update_job_series_future(uuid, date, jsonb, boolean)                  FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.stop_job_series(uuid, date, boolean)                                   FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION public.create_job_series(uuid, text, integer[], date, date, date[], jsonb) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.update_job_series_future(uuid, date, jsonb, boolean)                  TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.stop_job_series(uuid, date, boolean)                                   TO authenticated, service_role;
