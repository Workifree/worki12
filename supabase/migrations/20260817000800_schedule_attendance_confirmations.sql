-- Migration: Agendamento da varredura D-1 — `pg_cron` versionado (F4)
-- File: supabase/migrations/20260817000800_schedule_attendance_confirmations.sql
-- Spec: .harness/spec/confirmacao-vespera/spec.md (R4 — REVISADO pelo gate)
-- DDL aprovado (fonte normativa): .harness/spec/confirmacao-vespera/ddl-aprovado.md
-- ADR: .harness/memory-bank/decisions/ADR-20260817-confirmacao-vespera-log-evento.md
--
-- ============================================================================
-- POR QUE ISTO É UMA MIGRATION (e não um TODO de ops)
-- ============================================================================
--   A spec original deixava o agendamento como "OPS TODO não-bloqueante", mesmo padrão de
--   `expire-invites`. O gate verificou o repositório: NENHUM `cron.schedule` existe em migration
--   alguma, `vercel.json` não tem `crons`, os workflows do GitHub são CI/deploy. `expire-invites`
--   não é um padrão aceito — é uma função que NUNCA rodou. Sem agendador, a promessa desta
--   feature ("descobrir o furo 12h antes, não 2h30") não é cumprida por nenhum código do PR —
--   é a definição de feature nascendo morta. Por isso o agendamento é artefato VERSIONADO, não
--   comentário TODO (ADR, decisão 5).
--
-- ============================================================================
-- `pg_cron` DISPONÍVEL MAS NÃO INSTALADO (verificado em produção 17/08/2026)
-- ============================================================================
--   `SELECT * FROM pg_available_extensions WHERE name='pg_cron'` mostra a extensão disponível
--   (1.6.4) mas `installed_version IS NULL`. Habilitar é PRÉ-REQUISITO DE MERGE (ADR), não TODO.
--   Este bloco é guardado por `IF EXISTS (... pg_extension ...)` para não quebrar
--   `supabase db reset`/CI quando a extensão não está habilitada no ambiente, e falha
--   RUIDOSAMENTE com `RAISE WARNING` no caminho de skip. Antes de aplicar em produção: habilitar
--   a extensão (`CREATE EXTENSION IF NOT EXISTS pg_cron;` — requer privilégio de superuser/
--   dashboard Supabase) e SÓ ENTÃO reaplicar esta migration (ou rodar o bloco DO manualmente).
--
--   ATENÇÃO — CANAL DE APLICAÇÃO (achado do evaluator, 18/08/2026): `supabase/migrations/
--   APLICACAO-2026-08-16.md` documenta que as migrations desta base são aplicadas via **MCP do
--   Supabase**, que NÃO devolve `NOTICE`/`WARNING` do servidor de volta para quem aplicou — a
--   promessa de "falha ruidosamente, visível no log de aplicação" só é verdadeira para `psql`/
--   `supabase db push` (CLI), não para o caminho real usado neste projeto. **Esta migration DEVE
--   ser aplicada via CLI** (`supabase db push` ou `psql` direto), não via MCP, justamente para o
--   `RAISE WARNING` do caminho de skip ser visível caso a extensão ainda não esteja habilitada.
--   Se for aplicada via MCP mesmo assim, o silêncio do WARNING não significa sucesso — a V1 da
--   seção COMO VERIFICAR abaixo é OBRIGATÓRIA, não opcional, exatamente por isso.
--
-- ============================================================================
-- FUSO — SEM DST
-- ============================================================================
--   `pg_cron` interpreta o schedule em UTC: `0 21 * * *` = 21:00 UTC = 18:00 BRT. Brasil não
--   tem horário de verão desde 2019 — offset fixo (UTC-3), sem lógica de DST a manter.
--
-- ============================================================================
-- POR QUE NÃO EXISTE EDGE FUNCTION AQUI (blocker 2 do gate)
-- ============================================================================
--   A varredura é 100% SQL (`applications` + `jobs` + `notifications`), sem chamada a API
--   externa. Uma Edge Function só existiria para dar ao cron um endereço HTTP — e obrigaria
--   guardar a `service_role` key em algum lugar (Vault, ou pior, texto na definição do job) para
--   uma operação que não sai do Postgres. O cron chama `request_attendance_confirmations_due()`
--   (20260817000700) DIRETO — nenhuma chave trafega. `supabase/functions/request-shift-
--   confirmations/` NÃO deve ser criada.
--
-- Article 8 INTACTO: nenhuma tabela/RPC de saldo tocada.
-- Risk: LOW — aditivo; se a extensão faltar, a migration degrada para o botão manual (visível
-- via RAISE WARNING), não trava o `db push`.
--
-- ============================================================================
-- DOWN (rollback)
-- ============================================================================
--   SELECT cron.unschedule('shift-attendance-confirmations-d1');
--
-- ============================================================================
-- COMO VERIFICAR (OBRIGATÓRIO após aplicar — não apenas "como", ver nota de canal acima)
-- ============================================================================
--   V1. Extensão habilitada e job agendado (PASSO DE RUNBOOK OBRIGATÓRIO, não opcional — é a
--       ÚNICA confirmação confiável de que o agendamento pegou, já que o canal de aplicação
--       real deste projeto (MCP) engole o RAISE WARNING do caminho de skip):
--       SELECT extname, extversion FROM pg_extension WHERE extname = 'pg_cron';
--       SELECT jobname, schedule, active FROM cron.job WHERE jobname LIKE 'shift-attendance%';
--       -- ESPERADO: 1 linha, schedule = '0 21 * * *', active = t
--       -- Se 0 linhas: a extensão não estava habilitada no momento da aplicação (o bloco DO
--       -- pulou em silêncio via MCP). Habilitar `pg_cron` e reaplicar esta migration via CLI.
--
--   V2. Reaplicar a migration não duplica o job (upsert por nome, pg_cron >= 1.4):
--       -- rodar o bloco DO $$ ... $$ novamente e repetir V1 — ainda 1 linha só.
--
--   V3. Se aplicada via CLI/psql (não MCP), o log mostra o WARNING quando a extensão falta:
--       -- procurar "pg_cron ausente" no log de `supabase db push` / `psql`. Via MCP este log
--       -- não chega até quem aplicou — por isso V1 é o passo que manda, não este.
-- ============================================================================

DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
        -- cron.schedule(jobname, ...) faz upsert por nome (pg_cron >= 1.4) → idempotente, seguro
        -- para reaplicar esta migration mais de uma vez.
        PERFORM cron.schedule(
            'shift-attendance-confirmations-d1',
            '0 21 * * *',
            $cron$SELECT public.request_attendance_confirmations_due();$cron$
        );
    ELSE
        RAISE WARNING 'pg_cron ausente: a confirmação de véspera NÃO será disparada '
                      'automaticamente. Habilite a extensão e reaplique esta migration.';
    END IF;
END $$;
