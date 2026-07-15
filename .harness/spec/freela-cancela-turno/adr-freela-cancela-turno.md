# ADR-20260714 — Freela cancela turno agendado (aceito) → notifica a empresa

## Status
ACEITO

## Contexto
O freela precisa poder cancelar um turno que **já aceitou** (`applications.status` em
`'hired'` ou `'in_progress'`) e a empresa precisa **saber** para reabrir o slot / convidar outro
freela do Elenco.

Fatos do banco (verificados via MCP):
- A **transição já é permitida**: o trigger `validate_application_update` (SECURITY DEFINER) NÃO
  bloqueia `status='cancelled'`; a RLS `"Workers can update own applications"`
  (USING `worker_id = auth.uid()`) deixa o freela atualizar a própria linha. Logo o freela **já
  consegue** setar `'cancelled'` hoje. Nenhuma migration de transição é necessária.
- **NÃO existe** trigger de notificação em `applications`.
- A RLS de INSERT de `notifications` exige `auth.uid() = user_id` OU contraparte de
  `team_connections` aceita. O freela **poderia** inserir via cláusula de contraparte, mas isso é
  frágil (depende de vínculo aceito e de o client fazer o INSERT correto). O canal robusto é um
  **trigger no servidor**, igual ao padrão já usado em `notify_new_message` e no fluxo push.
- Invariante confirmada: `jobs.company_id = auth.uid()` do dono da empresa
  (migration `20260622000300`, linha 57; e `notify_new_message` usa `jobs.company_id` direto como
  `notifications.user_id`). Não é preciso join com `companies`.
- Push/modo A (piloto): turnos push **não reservam escrow** (o trigger `auto_reserve_escrow` pula
  convites). Só o **fluxo pull-legado prepago** reserva no aceite.

## Decisão

### Estados a partir dos quais o freela cancela
`OLD.status IN ('hired', 'in_progress')` → `NEW.status = 'cancelled'`. Só essa transição dispara a
notificação. Outras transições (aceite de convite, conclusão, etc.) são ignoradas pela cláusula
`WHEN` do trigger.

### Notificação (o que ESTA migration entrega)
Trigger **AFTER UPDATE** em `public.applications`, `SECURITY DEFINER`, `SET search_path = ''`,
`WHEN (NEW.status = 'cancelled' AND OLD.status IN ('hired','in_progress'))`, que INSERE **uma**
notificação para `jobs.company_id` (dono da empresa):
- `type = 'status_change'` (valor válido no CHECK de `notifications.type`).
- `title = 'Turno cancelado pelo freela'`.
- `message = '<nome do freela> cancelou o turno "<título da vaga>".'`
- `link = '/company/jobs/<job_id>/candidates'` (rota real da empresa).
- Resiliente: `EXCEPTION WHEN OTHERS THEN RETURN NEW` — falha de notificação **nunca** bloqueia o
  cancelamento do freela (mesmo padrão de `notify_new_message`).
- Idempotência não é crítica: a cláusula `WHEN` garante 1 disparo por transição de cancelamento.

### Reabertura do slot — NADA a fazer no banco
O `job` continua com seu status atual (ex.: `'open'`); a empresa convida outro freela do Elenco. A
única unique relevante em `applications` é `(job_id, worker_id)`, que só impede **re-convidar o
mesmo** worker — comportamento desejado. Não há constraint que impeça convidar **outro** freela
após o cancelamento. Nenhuma alteração de schema é necessária para reabrir o slot.

### Escrow — NÃO tocar saldo (Article 8)
- **Turnos push (modo A, default do piloto):** não têm escrow; o cancelamento **só notifica**.
- **Fluxo pull-legado prepago:** se `OLD` tinha escrow `kind='prepaid'` em `status='reserved'`, o
  cancelamento pelo freela **deixa o valor travado**. Esta migration **NÃO** faz refund: mover saldo
  exige RPC atômica (`refund_escrow`) e decisão de quem arca com o cancelamento (freela vs. empresa),
  o que é escopo maior. O trigger de notificação **não move saldo**. O refund permanece a cargo do
  **fluxo de estorno existente da empresa** (`refund_escrow`), disparado manualmente.
  - **Risco documentado:** um refund automático dentro deste trigger violaria Article 8 (RPC de saldo
    embutida em trigger de notificação, sem idempotência/reference_id estável e sem controle de quem
    perde o valor). Fica explicitamente **fora** desta entrega e recomendado como follow-up separado
    (edge function / ação da empresa) caso o piloto passe a usar pull-prepago com cancelamento.

## Consequências
### Positivas
- Empresa é notificada em tempo real (Realtime já escuta `notifications`) sem client privilegiado.
- Superfície mínima: uma função + um trigger; zero mudança de saldo, zero risco financeiro.
- Reversível: `DROP TRIGGER` / `DROP FUNCTION` limpos.

### Negativas / Trade-offs
- Para o fluxo pull-prepago (não-piloto), o escrow reservado fica preso até a empresa estornar
  manualmente. Aceitável no piloto (push/modo A não usa escrow); follow-up registrado.
- Notificação best-effort: se o INSERT falhar (ex.: mudança futura de schema), o cancelamento
  ocorre mesmo assim e a empresa não é avisada por esse canal (mitigado pelo bloco EXCEPTION +
  observabilidade).

## Alternativas rejeitadas
- **INSERT de notificação pelo client (via cláusula de contraparte da RLS):** frágil, depende de
  `team_connections` aceita e de o MyJobs fazer o INSERT — o servidor é a fonte da verdade.
- **Refund automático no trigger:** viola Article 8 (RPC de saldo fora de contexto atômico
  controlado) e mistura auditoria de notificação com liquidação financeira.
- **Novo status/tabela de cancelamento:** desnecessário; `'cancelled'` já é aceito.

## Referências
- Migration: `supabase/migrations/20260714000000_notify_company_on_worker_cancel.sql`
- Padrões: `20260314000005_final_fix_message_trigger.sql`,
  `20260702000000_notifications_notify_counterpart.sql`
- Invariante `jobs.company_id = auth.uid()`: `20260622000300_invite_accept_hired_transition.sql`
