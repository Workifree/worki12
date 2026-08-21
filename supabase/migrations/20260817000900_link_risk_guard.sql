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
