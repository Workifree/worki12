# DDL aprovado — Guarda de risco de vínculo (F5, `guarda-vinculo`)

> **Este arquivo é o contrato.** O que está aqui é o que foi aprovado no gate do architect
> (18/08/2026). O builder implementa **isto**, não a proposta original do `spec.md` — onde os dois
> divergem, este arquivo vence, e a divergência está justificada em
> `.harness/memory-bank/decisions/ADR-20260818-guarda-vinculo-contagem-no-banco.md`.
>
> Motivo de existir: na F3 o DDL do gate ficou só no relatório, não chegou ao ADR, e o builder
> implementou sem uma peça de segurança — achado HIGH que só apareceu na revisão.

---

## 0. O que muda em relação ao `spec.md`

| Spec original | Aprovado | Por quê (resumo) |
|---|---|---|
| R5: query agregada montada no client (PostgREST + `Map` no JS) | **Uma função Postgres** `count_worker_shifts_by_week` | Fuso, ancoragem dupla de empresa, soft delete e a unificação com a F3 são todos problemas de SQL. Ver ADR. |
| R3: `getWeekBoundsSundayToSaturday` no client define a janela da contagem | Janela **calculada no banco**; o client só rotula (`localWeekStartKey`/`weekRangeLabel`, já existentes e testados) | O client não tem como derivar a data local do turno com segurança a partir de `jobs.start_date` (timestamptz). |
| R2: só filtra `applications.status` | `applications.status` **+ `jobs.status <> 'deleted'`** | Turno cancelado (soft delete) não foi trabalhado — não pode contar. |
| R1: `CHECK (threshold >= 1)` | `CHECK (threshold BETWEEN 1 AND 7)` | O client escreve a coluna direto (grant de tabela). O CHECK é a única validação real. |
| A5: "nenhuma query dispara quando desligado" | Ver §5 (LM-9) — relaxar ou pagar um round-trip serial às 8h30 | Custo no caminho mais quente da feature. |

Inalterado e confirmado: **Article 8 intacto** (nenhuma tabela/RPC de saldo lida ou escrita — ver §6),
semana **domingo–sábado**, aviso **nunca bloqueia**, contador **por empresa inteira**.

---

## 1. Migration

**Arquivo:** `supabase/migrations/20260817000900_link_risk_guard.sql`
(as aplicadas em produção vão até `20260817000800`; esta é a próxima da fila)

```sql
-- Migration: Guarda de risco de vínculo trabalhista — config por empresa + contagem semanal (F5)
-- File: supabase/migrations/20260817000900_link_risk_guard.sql
-- Spec: .harness/spec/guarda-vinculo/spec.md
-- DDL aprovado: .harness/spec/guarda-vinculo/ddl-aprovado.md
-- ADR: .harness/memory-bank/decisions/ADR-20260818-guarda-vinculo-contagem-no-banco.md
--
-- ============================================================================
-- O QUE ESTA MIGRATION FAZ
-- ============================================================================
--   (a) `companies` ganha a configuração do aviso (ligado/desligado + limite por semana).
--   (b) Uma função de LEITURA que devolve, por freela e por semana corrida (dom–sáb, data local
--       America/Sao_Paulo), quantos turnos DESTA empresa o freela já tem confirmados.
--   (c) Uma função que resolve a config da empresa da sessão com fallback seguro.
--   (d) Dois índices de suporte.
--
--   O sistema AVISA, NUNCA BLOQUEIA (decisão do owner). Nada aqui impede um INSERT/UPDATE:
--   não há trigger, não há constraint sobre `applications`. A guarda é informação, não trava.
--
-- ============================================================================
-- POR QUE A CONTAGEM MORA NO BANCO (e não numa query montada no client)
-- ============================================================================
--   1. FUSO. `jobs.start_date` é timestamptz e o servidor roda em UTC. "Que semana é esta"
--      é pergunta de data LOCAL. `AT TIME ZONE 'America/Sao_Paulo'` explícito é a única
--      resposta que não depende do relógio do navegador de quem abriu o modal. O client não
--      tem como derivar a data local do turno com segurança (o `.split('T')[0]` que o resto do
--      app usa só acerta porque `start_date` é gravado com âncora de meio-dia — convenção, não
--      garantia).
--   2. ANCORAGEM DUPLA DE EMPRESA. `jobs.company_id` pode ser o id da empresa OU o uid do dono
--      (ver 20260816210000). A policy de SELECT de `applications` ("Companies can view
--      applications for their jobs", 20260317160000) é ancorada SÓ em `companies.owner_id` —
--      uma contagem feita sob ela devolveria menos linhas do que existem, e uma guarda de
--      segurança que erra para MENOS diz "sem risco" quando quer dizer "não enxerguei".
--      `public.is_job_owner` (20260817000100) já é o superconjunto correto; esta função a
--      reusa VERBATIM, honrando o contrato de manutenção conjunta do
--      ADR-20260817-seam-autorizacao-empresa (é a razão de NÃO existir aqui uma terceira cópia
--      inline do predicado de dono).
--   3. FASE 3 DO ADR-20260816-rls-desligada-jobs-conversation. Está planejado apertar o SELECT
--      de `jobs` (`can_view_job`). Uma contagem client-side pendurada no `USING (true)` de hoje
--      mudaria de semântica em silêncio naquele dia. SECURITY DEFINER desacopla.
--   4. UNIFICAÇÃO COM A F3. `InviteSeriesModal` conta HOJE só as ocorrências da própria série,
--      ignorando a carga preexistente do freela (`seriesWeekRisk.ts:weeksOverThreshold`). Uma
--      função que devolve (freela, semana, contagem) sobre um INTERVALO serve os dois chamadores
--      — a F5 no `ShiftCallModal` (uma semana) e a F3 no `InviteSeriesModal` (a série inteira) —
--      com UMA implementação de "o que conta como uma vez".
--
-- ============================================================================
-- ORDEM DENTRO DO ARQUIVO (regra de patterns.md, achado de 18/08/2026)
-- ============================================================================
--   `LANGUAGE sql` valida o corpo no CREATE. `my_link_risk_config()` LÊ as duas colunas novas de
--   `companies` ⇒ as colunas são criadas na seção 1, ANTES da função na seção 4. Inverter a ordem
--   torna esta migration inaplicável (42703). `count_worker_shifts_by_week` é plpgsql (precisa de
--   RAISE) e só lê tabelas/funções pré-existentes.
--
-- Article 8 INTACTO: nenhuma tabela financeira (`wallets`, `wallet_transactions`,
--   `escrow_transactions`, `shift_payments`) e nenhuma RPC de saldo é lida ou escrita.
-- Risk: LOW. Aditivo e reversível — 2 colunas, 2 funções de LEITURA, 2 índices. Zero trigger,
--   zero policy nova, zero escrita.
-- Backup required: NO.
--
-- ============================================================================
-- DOWN (rollback — copiar/colar)
-- ============================================================================
--   DROP FUNCTION IF EXISTS public.count_worker_shifts_by_week(uuid[], uuid, date, date);
--   DROP FUNCTION IF EXISTS public.my_link_risk_config();
--   DROP INDEX IF EXISTS public.idx_applications_job_status;
--   DROP INDEX IF EXISTS public.idx_jobs_company_start_date;
--   ALTER TABLE public.companies DROP CONSTRAINT IF EXISTS companies_link_risk_threshold_range;
--   ALTER TABLE public.companies DROP COLUMN IF EXISTS link_risk_alert_threshold;
--   ALTER TABLE public.companies DROP COLUMN IF EXISTS link_risk_alert_enabled;
-- ============================================================================


-- =============================================
-- 1. CONFIGURAÇÃO POR EMPRESA
--    ADD COLUMN com DEFAULT constante não reescreve a tabela (PG 11+). `companies` é pequena.
--    NOT NULL + DEFAULT: nenhuma linha existente fica indefinida, nenhum backfill necessário.
-- =============================================
ALTER TABLE public.companies
    ADD COLUMN IF NOT EXISTS link_risk_alert_enabled   boolean NOT NULL DEFAULT true,
    ADD COLUMN IF NOT EXISTS link_risk_alert_threshold integer NOT NULL DEFAULT 2;

-- CHECK como constraint NOMEADA e separada (não inline no ADD COLUMN): com
-- `ADD COLUMN IF NOT EXISTS`, um CHECK inline é silenciosamente pulado se a coluna já existir —
-- a migration "passaria" deixando a tabela sem a validação.
DO $$ BEGIN
    ALTER TABLE public.companies
        ADD CONSTRAINT companies_link_risk_threshold_range
        CHECK (link_risk_alert_threshold BETWEEN 1 AND 7);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

COMMENT ON COLUMN public.companies.link_risk_alert_enabled IS
    'Mostrar o aviso de frequência do mesmo freela na mesma semana? Default true. NÃO bloqueia '
    'nada em lugar nenhum — só liga/desliga um aviso de tela (decisão do owner: o Worki avisa, '
    'não decide risco jurídico de terceiro).';

COMMENT ON COLUMN public.companies.link_risk_alert_threshold IS
    'A partir de quantos turnos na MESMA semana corrida (dom-sáb, data local America/Sao_Paulo) '
    'avisar. Default 2 (entrevista Divino Fogão 17/08/2026); configurável 1..7. O client escreve '
    'esta coluna DIRETO (grant de tabela em companies) — o CHECK é a única validação real, não '
    'confiar no <input type=number>. Espelhado no client por '
    'components/company/seriesWeekRisk.ts:DEFAULT_LINK_RISK_THRESHOLD (fallback quando a config '
    'não carregou): os dois valores mudam juntos. ATENÇÃO: companies tem SELECT USING (true) '
    'para authenticated (20260317160000) — esta coluna é legível por QUALQUER conta autenticada. '
    'Não colocar nada sensível ao lado dela sem antes apertar aquela policy.';


-- =============================================
-- 2. ÍNDICES DE SUPORTE
--    Sem CONCURRENTLY: migrations do Supabase rodam dentro de transação (CONCURRENTLY é proibido
--    em bloco transacional) e estas tabelas são pequenas no pré-piloto — mesma decisão e mesma
--    justificativa de 20260816120000. `IF NOT EXISTS` mantém idempotência.
--
--    idx_applications_job_status paga por si fora desta feature: `claim_shift_slot` conta
--    `WHERE job_id = ... AND status IN ('hired','in_progress','completed')` DENTRO do lock do
--    turno (20260817000200) e hoje só tem o índice PARCIAL idx_applications_invited
--    (WHERE invited_by_company_at IS NOT NULL), que não cobre as applications do fluxo pull.
-- =============================================
CREATE INDEX IF NOT EXISTS idx_applications_job_status
    ON public.applications (job_id, status);

CREATE INDEX IF NOT EXISTS idx_jobs_company_start_date
    ON public.jobs (company_id, start_date);


-- =============================================
-- 3. CONTAGEM POR FREELA E POR SEMANA
--
--    DOIS MODOS, um só corpo:
--      - âncora (`p_anchor_job_id`): a semana que contém o turno-alvo. É o modo do
--        ShiftCallModal (F5). Exclui as applications DO PRÓPRIO turno-alvo — assim o "+1"
--        prospectivo do client (R4) nunca conta duas vezes.
--      - intervalo (`p_range_start`/`p_range_end`): todas as semanas tocadas. É o modo do
--        InviteSeriesModal (F3).
--    O intervalo é SEMPRE expandido para semanas INTEIRAS (domingo anterior .. sábado seguinte):
--    sem isso a carga preexistente das pontas some e a F3 repete o bug que esta feature vem
--    consertar (contar só as ocorrências da própria série).
--
--    O CLIENT NÃO RECEBE p_company_id — não há tenant forjável no contrato. A empresa é derivada
--    da sessão via is_job_owner (ancoragem dupla). Um atacante autenticado só consegue contar
--    dentro dos turnos que já são dele.
--
--    NUNCA conta turnos de OUTRAS empresas. É decisão de produto (R9: o risco de vínculo é por
--    empregador) E de privacidade (contar cross-company entregaria a agenda do freela na
--    concorrência). Quem for "melhorar" isso um dia: não é melhoria, é vazamento.
-- =============================================
CREATE OR REPLACE FUNCTION public.count_worker_shifts_by_week(
    p_worker_ids    uuid[],
    p_anchor_job_id uuid DEFAULT NULL,
    p_range_start   date DEFAULT NULL,
    p_range_end     date DEFAULT NULL
)
RETURNS TABLE (worker_id uuid, week_start date, shift_count integer)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_uid  uuid := (SELECT auth.uid());
    v_from date;
    v_to   date;
    v_lo   timestamptz;
    v_hi   timestamptz;
BEGIN
    -- Sem sessão: nada. (anon nem tem EXECUTE — ver seção 5.)
    IF v_uid IS NULL THEN
        RETURN;
    END IF;

    IF p_worker_ids IS NULL OR array_length(p_worker_ids, 1) IS NULL THEN
        RETURN;
    END IF;

    -- Teto de higiene numa função DEFINER: elenco real é dezenas, não centenas.
    IF array_length(p_worker_ids, 1) > 200 THEN
        RAISE EXCEPTION 'link_risk: lista de freelas grande demais (max 200)';
    END IF;

    -- Exatamente um dos dois modos.
    IF (p_anchor_job_id IS NOT NULL) = (p_range_start IS NOT NULL OR p_range_end IS NOT NULL) THEN
        RAISE EXCEPTION 'link_risk: informe p_anchor_job_id OU (p_range_start, p_range_end)';
    END IF;

    IF p_anchor_job_id IS NOT NULL THEN
        -- Autorização explícita: DEFINER desliga a RLS, então a checagem é na unha (mesmo
        -- padrão de cancel_shift_call, 20260817000200).
        IF NOT public.is_job_owner(p_anchor_job_id) THEN
            RAISE EXCEPTION 'link_risk: turno não pertence a esta empresa';
        END IF;

        v_from := public.job_local_date(p_anchor_job_id);
        IF v_from IS NULL THEN
            RETURN;
        END IF;
        v_to := v_from;
    ELSE
        IF p_range_start IS NULL OR p_range_end IS NULL OR p_range_end < p_range_start THEN
            RAISE EXCEPTION 'link_risk: intervalo inválido';
        END IF;
        IF (p_range_end - p_range_start) > 370 THEN
            RAISE EXCEPTION 'link_risk: intervalo grande demais (max 370 dias)';
        END IF;
        v_from := p_range_start;
        v_to   := p_range_end;
    END IF;

    -- Semana corrida DOMINGO-SÁBADO. EXTRACT(DOW) sobre `date` é aritmética pura de calendário
    -- (domingo = 0), sem fuso envolvido — é o MESMO cálculo de
    -- components/company/seriesWeekRisk.ts:localWeekStartKey, e por operar sobre data-only os
    -- dois não têm como divergir.
    v_from := v_from - EXTRACT(DOW FROM v_from)::int;
    v_to   := v_to   + (6 - EXTRACT(DOW FROM v_to)::int);

    -- Fronteiras em timestamptz derivadas da data LOCAL. Feito assim (e não com
    -- `(start_date AT TIME ZONE ...)::date BETWEEN ...`) porque a comparação fica SARGABLE:
    -- usa índice btree em start_date. `timezone(text, timestamptz)` é STABLE, não IMMUTABLE —
    -- não daria para indexar a expressão.
    v_lo := (v_from::text      || ' 00:00:00')::timestamp AT TIME ZONE 'America/Sao_Paulo';
    v_hi := ((v_to + 1)::text  || ' 00:00:00')::timestamp AT TIME ZONE 'America/Sao_Paulo';

    RETURN QUERY
    SELECT a.worker_id,
           (ld.d - EXTRACT(DOW FROM ld.d)::int)::date,
           count(*)::integer
      FROM public.applications a
      JOIN public.jobs j ON j.id = a.job_id
      CROSS JOIN LATERAL (
          SELECT (j.start_date AT TIME ZONE 'America/Sao_Paulo')::date AS d
      ) ld
     WHERE a.worker_id = ANY (p_worker_ids)
       -- MESMO conjunto que claim_shift_slot trata como "vaga ocupada" (20260817000200).
       -- 'invited' fora de propósito: um chamado dispara para N e só 1 leva.
       AND a.status IN ('hired', 'in_progress', 'completed')
       -- Turno cancelado (soft delete, patterns.md) NÃO foi trabalhado ⇒ não conta. Sem isto,
       -- `stop_job_series` cancelando 60 ocorrências deixaria 60 applications 'hired' inflando
       -- a guarda de todo mundo.
       AND j.status <> 'deleted'
       AND j.start_date >= v_lo
       AND j.start_date <  v_hi
       -- O turno-alvo não conta: o "+1" prospectivo é do client (R4).
       AND (p_anchor_job_id IS NULL OR a.job_id <> p_anchor_job_id)
       -- Por ÚLTIMO de propósito: função tem cost 100, o planner a avalia depois dos filtros
       -- baratos e indexados acima — sobram dezenas de linhas, não a tabela toda.
       AND public.is_job_owner(a.job_id)
     GROUP BY 1, 2;
END;
$$;

COMMENT ON FUNCTION public.count_worker_shifts_by_week(uuid[], uuid, date, date) IS
    'Guarda de vínculo (F5): quantos turnos DESTA empresa cada freela já tem confirmados '
    '(hired/in_progress/completed, turno não-deletado) por semana corrida dom-sáb em data local '
    'America/Sao_Paulo. Modo âncora (p_anchor_job_id) = a semana do turno-alvo, exclui o próprio '
    'turno; modo intervalo = a série inteira (F3), sempre expandido para semanas cheias. '
    'SOMENTE LEITURA — não avisa, não bloqueia, não escreve: quem decide é a tela. '
    'Autorização por public.is_job_owner (ancoragem dupla, ADR-20260817-seam-autorizacao-empresa) '
    'porque a policy de SELECT de applications é ancorada só em companies.owner_id e devolveria '
    'menos do que existe. NUNCA estender para contar turnos de outras empresas (R9 + privacidade).';


-- =============================================
-- 4. CONFIG DA EMPRESA DA SESSÃO
--    LANGUAGE sql: DEPENDE das colunas da seção 1 (validado no CREATE — ver cabeçalho).
--    Devolve SEMPRE uma linha: sem empresa resolvida, cai no default LIGADO. Fail-safe na
--    direção certa (um aviso a mais nunca fez mal; um aviso a menos é a feature falhando calada).
--    SECURITY INVOKER basta: companies já tem SELECT USING (true) (mesma leitura de
--    is_company_owner, 20260817000300).
--    ORDER BY prefere a linha ancorada em `id` porque é a linha que CompanyProfile.tsx GRAVA
--    (`.update(...).eq('id', userId)`) — ler de uma linha diferente da que a tela escreve faria
--    o toggle "não salvar".
-- =============================================
CREATE OR REPLACE FUNCTION public.my_link_risk_config()
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = ''
AS $$
    SELECT COALESCE(
        (
            SELECT jsonb_build_object(
                       'enabled',   c.link_risk_alert_enabled,
                       'threshold', c.link_risk_alert_threshold
                   )
              FROM public.companies c
             WHERE (SELECT auth.uid()) IS NOT NULL
               AND (c.id = (SELECT auth.uid()) OR c.owner_id = (SELECT auth.uid()))
             ORDER BY (c.id = (SELECT auth.uid())) DESC, c.id
             LIMIT 1
        ),
        jsonb_build_object('enabled', true, 'threshold', 2)
    );
$$;

COMMENT ON FUNCTION public.my_link_risk_config() IS
    'Config do aviso de vínculo da empresa da sessão: {"enabled": bool, "threshold": int}. '
    'SEMPRE devolve uma linha — sem empresa resolvida, default LIGADO/2 (fail-safe: a guarda '
    'nunca some em silêncio). Resolve a empresa com a MESMA ancoragem dupla do resto do schema, '
    'preferindo companies.id = auth.uid() porque é a linha que CompanyProfile.tsx grava.';


-- =============================================
-- 5. GRANTS
--    REVOKE de PUBLIC/anon é em FUNÇÃO (nunca `REVOKE ALL ON <tabela> FROM PUBLIC`).
--    Nenhuma das duas é função de trigger — a lição de 20260816201420/201457 (revogar EXECUTE
--    quebrou triggers) não se aplica, e `authenticated` mantém EXECUTE de todo jeito.
-- =============================================
REVOKE ALL ON FUNCTION public.count_worker_shifts_by_week(uuid[], uuid, date, date) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.my_link_risk_config()                                  FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION public.count_worker_shifts_by_week(uuid[], uuid, date, date) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.my_link_risk_config()                                  TO authenticated, service_role;

-- NENHUM grant de coluna. As colunas novas herdam `GRANT SELECT, INSERT, UPDATE ON companies TO
-- authenticated` (20260317150000) — grant de TABELA, sem lista de colunas: a empresa escreve as
-- duas colunas na própria linha, que é exatamente o desejado (é a config dela), e a RLS de
-- companies (owner_id = auth.uid() OR id = auth.uid()) já barra a linha alheia. NÃO tentar
-- `GRANT UPDATE (coluna)` aqui: grant de coluna só tem efeito depois de
-- `REVOKE UPDATE ON companies FROM authenticated`, o que derrubaria TODA a edição de perfil
-- existente (logo, capa, briefing, TOS...) no mesmo comando.
```

---

## 2. Contrato consumido pelo frontend

```ts
// services/linkRiskService.ts (novo) — leitura pura, sem saldo, sem edge function.

export interface LinkRiskConfig { enabled: boolean; threshold: number }

/** RPC `my_link_risk_config` → sempre 1 objeto. Erro ⇒ fallback LIGADO/DEFAULT. */
async getConfig(): Promise<LinkRiskConfig>

/** RPC `count_worker_shifts_by_week` (modo âncora). Erro ⇒ Map vazio + logError. */
async countForShift(jobId: string, workerIds: string[]): Promise<Map<string /*workerId*/, number>>

/** RPC `count_worker_shifts_by_week` (modo intervalo). Chave: `${workerId}|${weekStart}`. */
async countForRange(
  workerIds: string[], rangeStart: string, rangeEnd: string,
): Promise<Map<string, number>>
```

Chamadas PostgREST (argumentos NOMEADOS — os `DEFAULT NULL` só funcionam assim):

```ts
supabase.rpc('count_worker_shifts_by_week', { p_worker_ids: ids, p_anchor_job_id: jobId })
supabase.rpc('count_worker_shifts_by_week', { p_worker_ids: ids, p_range_start: from, p_range_end: to })
supabase.rpc('my_link_risk_config')
```

**Onde mora a regra de aviso (client, presentação):** `prospectivo = contagem + 1` no
`ShiftCallModal`; avisa quando `prospectivo > threshold`. Na F3, `prospectivo[semana] =
contagem[semana] + ocorrências-alvo da série naquela semana` — sem risco de contagem dupla,
porque as ocorrências-alvo são, por definição, as que ainda **não têm freela**.

**`types/index.ts`:** `Company` ganha `link_risk_alert_enabled?: boolean` e
`link_risk_alert_threshold?: number` (opcionais — nem toda query traz a coluna; ver LM-6).

---

## 3. Refactor obrigatório da F3 (R10)

`frontend/src/components/company/seriesWeekRisk.ts`:

- `localWeekStartKey`, `weekRangeLabel` — **inalteradas** (puras, testadas, e é o mesmo cálculo
  do SQL).
- `DEFAULT_LINK_RISK_THRESHOLD = 2` — **permanece**, mas muda de papel: deixa de ser "o limite" e
  passa a ser **o fallback quando `my_link_risk_config()` não respondeu**. Atualizar o docblock
  (hoje diz "F5 troca este valor fixo por configuração"). Seu valor tem de continuar igual ao
  `DEFAULT` da coluna no banco — a coluna já carrega esse acoplamento no `COMMENT`.
- `weeksOverThreshold(targets, threshold)` — passa a receber a carga preexistente:
  `weeksOverThreshold(targets, threshold, existingByWeek: Map<string, number>)`. Hoje ela ignora
  a carga preexistente do freela, que é metade do número que a empresa precisa ver.
- `InviteSeriesModal` — o aviso hoje é calculado **antes** de escolher o freela
  (worker-independente). Passa a ser **por freela** (uma chamada `countForRange` para o elenco
  inteiro, no mesmo carregamento de `useCompanyTeam`). O desenho do selo/banner é do
  frontend-builder; o dado é este.

---

## 4. Verificação (read-only, depois de aplicar)

```sql
-- V1. Colunas, defaults e constraint.
SELECT column_name, data_type, is_nullable, column_default
  FROM information_schema.columns
 WHERE table_schema='public' AND table_name='companies'
   AND column_name LIKE 'link_risk%';
-- ESPERADO: enabled/boolean/NO/true · threshold/integer/NO/2
SELECT conname, pg_get_constraintdef(oid) FROM pg_constraint
 WHERE conrelid='public.companies'::regclass AND conname='companies_link_risk_threshold_range';

-- V2. O CHECK é a validação real (o client escreve a coluna direto).
BEGIN;
  UPDATE public.companies SET link_risk_alert_threshold = 0 WHERE id = (SELECT id FROM public.companies LIMIT 1);
  -- ESPERADO: ERROR 23514
ROLLBACK;

-- V3. Grants das funções (sem isto, .rpc() falha).
SELECT p.proname,
       has_function_privilege('authenticated', p.oid, 'EXECUTE') AS auth_exec,
       has_function_privilege('anon',          p.oid, 'EXECUTE') AS anon_exec
  FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
 WHERE n.nspname='public' AND p.proname IN ('count_worker_shifts_by_week','my_link_risk_config');
-- ESPERADO: t | f  nas duas

-- V4. Contagem real, na sessão da empresa (substituir os <...>).
BEGIN;
  SELECT set_config('role','authenticated',true);
  SELECT set_config('request.jwt.claims','{"sub":"<COMPANY_UID>","role":"authenticated"}',true);
  SELECT * FROM public.count_worker_shifts_by_week(ARRAY['<WORKER_ID>']::uuid[], '<JOB_ID>');
  -- Conferir contra a contagem crua:
  SELECT count(*) FROM public.applications a JOIN public.jobs j ON j.id=a.job_id
   WHERE a.worker_id='<WORKER_ID>' AND a.status IN ('hired','in_progress','completed')
     AND j.status <> 'deleted' AND a.job_id <> '<JOB_ID>'
     AND (j.start_date AT TIME ZONE 'America/Sao_Paulo')::date
         BETWEEN (public.job_local_date('<JOB_ID>') - EXTRACT(DOW FROM public.job_local_date('<JOB_ID>'))::int)
             AND (public.job_local_date('<JOB_ID>') - EXTRACT(DOW FROM public.job_local_date('<JOB_ID>'))::int + 6);
ROLLBACK;

-- V5. Cross-tenant: turno de OUTRA empresa levanta exceção (não devolve 0 em silêncio).
BEGIN;
  SELECT set_config('role','authenticated',true);
  SELECT set_config('request.jwt.claims','{"sub":"<OUTRA_EMPRESA_UID>","role":"authenticated"}',true);
  SELECT * FROM public.count_worker_shifts_by_week(ARRAY['<WORKER_ID>']::uuid[], '<JOB_ID>');
  -- ESPERADO: ERROR 'link_risk: turno não pertence a esta empresa'
ROLLBACK;

-- V6. Fuso: turno às 23h local (= dia seguinte em UTC) cai na semana CERTA.
SELECT public.job_local_date('<JOB_ID_23H_LOCAL>');  -- ESPERADO: a data civil brasileira

-- V7. Turno soft-deletado não conta.
--     (marcar um job status='deleted' num BEGIN/ROLLBACK e reconferir V4: contagem cai em 1)

-- V8. CENSO DA ANCORAGEM DUPLA — a pergunta que decide se a contagem client-side teria mentido:
SELECT count(*) AS jobs_ancorados_no_uid_do_dono
  FROM public.jobs j
 WHERE NOT EXISTS (SELECT 1 FROM public.companies c WHERE c.id = j.company_id);
-- Se > 0: a policy de SELECT de applications JÁ esconde essas applications da empresa e há
-- dívida a tratar fora desta feature. Se = 0: a ancoragem dupla é só defensiva, e esta função
-- continua sendo a forma certa (é superconjunto, nunca subconjunto).

-- V9. Article 8: nada de saldo.
SELECT p.proname FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
 WHERE n.nspname='public' AND p.proname IN ('count_worker_shifts_by_week','my_link_risk_config')
   AND (p.prosrc ~* 'wallet|escrow|shift_payments|balance');
-- ESPERADO: 0 linhas
```

---

## 5. Landmines (o builder lê esta lista antes de escrever a primeira linha)

- **LM-1 — Ordem dentro do arquivo.** `my_link_risk_config()` é `LANGUAGE sql` e lê as colunas
  novas: corpo validado no CREATE. Seção 1 antes da seção 4, sempre. Inverter = migration
  inaplicável (42703). É a mesma classe de erro de `20260817000100` (42P01), que passou por build,
  lint, 495 testes e quatro revisões de agente.
- **LM-2 — `RETURNS TABLE` cria variáveis com os nomes das colunas.** `worker_id` e `week_start`
  existem como OUT params dentro do corpo. **Toda** referência a coluna no `RETURN QUERY` precisa
  ser qualificada (`a.worker_id`), senão é `column reference is ambiguous` em tempo de execução —
  não de criação. O `GROUP BY 1, 2` posicional existe por isso.
- **LM-3 — `RAISE`, não retorno vazio, na negativa de autorização.** Guarda de segurança que
  devolve 0 em silêncio diz "sem risco" quando quer dizer "não enxerguei". Modo âncora sem
  `is_job_owner` **levanta exceção**; o client trata como "não consegui verificar" (log), nunca
  como "está tudo bem".
- **LM-4 — Nunca contar cross-company.** É vazamento da agenda do freela para a concorrência,
  além de contrariar R9. Está no `COMMENT` da função de propósito.
- **LM-5 — Frontend não pode ir a produção antes da migration.** `CompanyProfile.tsx` já tem o
  fallback "salva de novo sem a coluna se ela não existe" para `default_briefing`
  (linhas ~127-135). **Estender esse mesmo fallback para as duas colunas novas**, senão um deploy
  na Vercel antes da aplicação manual da migration quebra o salvamento INTEIRO do perfil (logo,
  capa, endereço), não só a config nova. Mesma regra para as RPCs: `PGRST202`/404 ⇒ sem selo, sem
  banner, `logError`, e o disparo segue (A7).
- **LM-6 — `undefined` não é `false`.** `Company.link_risk_alert_enabled` é opcional no TS porque
  nem toda query traz a coluna. Ler `if (company.link_risk_alert_enabled)` desliga a guarda em
  silêncio sempre que o campo não veio. A leitura correta é `!== false`, e a fonte canônica é
  `my_link_risk_config()`, não um `select('*')` qualquer.
- **LM-7 — Sem `CREATE INDEX CONCURRENTLY`.** Migration do Supabase roda em transação;
  `CONCURRENTLY` é proibido em bloco transacional (precedente e justificativa em
  `20260816120000`). As tabelas são pequenas no pré-piloto.
- **LM-8 — Nenhum grant de coluna em `companies`.** `GRANT UPDATE (col)` é aditivo e só passa a
  valer depois de `REVOKE UPDATE ON companies FROM authenticated` — que derrubaria toda a edição
  de perfil existente. Fora de escopo, e perigoso a dias do piloto.
- **LM-9 — A5 do spec cobra um round-trip serial no pior momento.** "Nenhuma query de contagem é
  disparada quando desligado" obriga a esperar `my_link_risk_config()` antes de contar — duas
  idas ao servidor em série no modal que abre às 8h30. Preferir: disparar as duas em paralelo no
  `Promise.all` que já existe e simplesmente não renderizar nada quando `enabled=false`
  (A5 vira "nenhum selo/banner aparece"). Se o evaluator exigir A5 ao pé da letra, é o clarifier
  que decide — **não** é decisão do builder no meio da implementação.
- **LM-10 — O aviso não pode segurar a lista.** Os selos entram em estado próprio, resolvidos
  depois; a lista do elenco renderiza assim que `listTeamMembers` volta. Nada de `loading` único
  que espere a contagem — a feature existe para ajudar às 8h30, não para atrasar o disparo.
- **LM-11 — `p_worker_ids` só com quem está VISÍVEL no modal.** Mandar o elenco inteiro quando a
  busca filtrou 3 nomes é desperdício; mandar quem está em `excludeWorkerIds` é contar quem nem
  aparece.
