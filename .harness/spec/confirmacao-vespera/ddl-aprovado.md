# DDL aprovado — Confirmação de véspera (F4)

> **Fonte:** parecer do `harness-architect` (gate de 17/08/2026), veredito `APPROVED_WITH_CHANGES`.
> ADR: `.harness/memory-bank/decisions/ADR-20260817-confirmacao-vespera-log-evento.md`
>
> **Por que este arquivo existe:** o ADR registra a *decisão*; o DDL aprovado vive no parecer do gate e
> se perde na conversa. Na F3 isso custou um achado HIGH — o trigger `enforce_job_series_same_owner`
> foi especificado no parecer, não chegou ao ADR, e o builder implementou sem ele. O que o builder lê
> tem que ser o que foi aprovado, não a lembrança de quem orquestra.

---

## Contexto do gate

A spec propunha 4 colunas em `applications` + Edge Function `request-shift-confirmations` agendada por
pg_cron "como TODO de ops". O gate reprovou **o schema e o agendamento**, mantendo a feature.

**Verificado em produção (17/08/2026, projeto `vrklakcbkcsonarmhqhp`):**
- `jobs.start_date` é **`timestamp with time zone`** — resolve o landmine L2, que o architect não pôde checar.
- `pg_cron` está **disponível (1.6.4) mas NÃO instalado** (`installed_version: null`). `pg_net` idem.
  Habilitar a extensão é **pré-requisito de merge**, não TODO.

---

## Os três blockers do gate

### 1. Colunas em `applications` nascem graváveis pelo freela → tabela-evento própria

`20260317150000_fix_applications_companies_rls.sql:27` faz `GRANT SELECT, INSERT, UPDATE ON applications
TO authenticated` — grant de **tabela** — e a policy `Workers can update their own application fields`
(`USING (worker_id = auth.uid())`) **não restringe coluna nenhuma**.

Consequência das colunas propostas: o freela, via PostgREST direto, poderia setar o próprio
`attendance_confirmation_requested_at` (auto-pedido), reescrever `response` quantas vezes quisesse
(a imutabilidade de R2/A5 vira decorativa) e zerar `request_count` (fura o anti-spam). Tapar isso exigiria
estender `validate_application_update` com imutabilidade de 4 colunas — mais SQL que a tabela.

> Nota: o achado da F2 (`GRANT UPDATE (coluna)` é aditivo) **não** se aplica aqui. O grant é de tabela.
> O problema é o oposto e pior.

Segundo motivo: escrever em `applications` acorda `trg_validate_application_update`, que usa ancoragem
**simples** (`jobs.company_id = auth.uid()`), enquanto R3 autoriza por `is_job_owner` (ancoragem **dupla**).
Para empresa ancorada via `companies.owner_id`, a RPC autoriza e o trigger derruba com EXCEPTION.

**O precedente certo não é `invitation_*` — é `shift_call_targets` (`20260817000100`):** confirmação de
véspera é **tentativa**, não contrato. E o argumento é assimétrico no tempo: o log não se reconstrói
retroativamente; a conveniência de leitura se recupera a qualquer momento.

### 2. Não existe agendador no projeto → remover a Edge Function, versionar o cron

Varredura do repositório: nenhum `cron.schedule` em migration, nenhum `crons` em `frontend/vercel.json`,
nenhum `schedule` em `.github/workflows/`. `expire-invites` **nunca rodou uma vez**. E a F1
(`20260817000200`, escrita um dia antes) rejeitou explicitamente esse caminho: *"Expiração preguiçosa:
quem chega atrasado fecha o chamado. Sem cron, sem job agendado."*

A correção **não** é arrumar o cron da Edge Function — é **remover a Edge Function**. A varredura é 100%
SQL (`applications` + `jobs` + `notifications`), sem API externa. A função só existiria para dar um
endereço HTTP ao cron, e obrigaria a guardar a `service_role` key no banco para o `pg_net` chamá-la.

`supabase/functions/request-shift-confirmations/` **não deve ser criada**.

### 3. O CTA de A8 está quebrado por construção

`claim_shift_slot` conta ocupação como `applications.status IN ('hired','in_progress','completed')`.
R10 proíbe alterar `applications.status`. Logo **o freela que respondeu `cannot_attend` continua ocupando
a vaga**. A empresa clica "reabrir a vaga", dispara um `shift_call`, e todo alvo recebe `outcome='filled'`
— o chamado fecha sozinho com `status='filled'`, todos os alvos viram `response='closed'` e disparam
notificação de "Vaga preenchida" para gente que nunca teve chance. Falha silenciosa, com ruído no elenco.

**Resolução (sequenciar, não violar R10):** o CTA não é "abrir Chamado de Turno". É **"Dispensar e chamar
substituto"** — `dismissFromShift(applicationId)` (→ `status='cancelled'`, sai da contagem e dispara
`trg_notify_counterpart_on_application_cancel` avisando o freela) **e só então** o fluxo F1. Decisão
continua manual e explícita da empresa.

Herda as guardas de `dismissFromShift`: `hasAttendedShift` (irrelevante na véspera) e **pagamento ativo**
(`shift_payments` em `scheduled`/`recorded` **barra a dispensa** — e o modo A do piloto agenda). A UI
precisa tratar `blockedByPayment` e mandar estornar o agendamento antes.

---

## `20260817000600_shift_attendance_confirmations.sql`

```sql
-- Helper de data local — uma expressão canônica para "que dia é este turno".
CREATE OR REPLACE FUNCTION public.job_local_date(p_job_id uuid)
RETURNS date LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = '' SET timezone = 'America/Sao_Paulo'
AS $$ SELECT j.start_date::timestamptz::date FROM public.jobs j WHERE j.id = p_job_id; $$;

REVOKE ALL ON FUNCTION public.job_local_date(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.job_local_date(uuid) TO authenticated, service_role;

CREATE TABLE IF NOT EXISTS public.shift_attendance_confirmations (
    id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    application_id uuid NOT NULL REFERENCES public.applications(id) ON DELETE CASCADE,
    -- denormalizados de colunas IMUTÁVEIS (validate_application_update trava job_id/worker_id):
    -- as policies leem daqui sem join, e não podem divergir.
    job_id         uuid NOT NULL REFERENCES public.jobs(id) ON DELETE CASCADE,
    worker_id      uuid NOT NULL,
    source         text NOT NULL CHECK (source IN ('auto','manual')),
    requested_by   uuid,                       -- NULL sempre que source='auto'
    requested_at   timestamptz NOT NULL DEFAULT now(),
    response       text CHECK (response IS NULL OR response IN ('confirmed','cannot_attend')),
    responded_at   timestamptz,
    CONSTRAINT sac_response_pair CHECK ((response IS NULL) = (responded_at IS NULL)),
    CONSTRAINT sac_author CHECK (
        (source = 'manual' AND requested_by IS NOT NULL) OR
        (source = 'auto'   AND requested_by IS NULL)
    )
);

-- Idempotência da varredura por ÍNDICE, não por convenção de WHERE ... IS NULL:
-- duas execuções simultâneas do cron não duplicam pedido nem notificação.
CREATE UNIQUE INDEX IF NOT EXISTS uq_sac_auto_once
    ON public.shift_attendance_confirmations (application_id) WHERE source = 'auto';
CREATE INDEX IF NOT EXISTS idx_sac_application ON public.shift_attendance_confirmations (application_id);
CREATE INDEX IF NOT EXISTS idx_sac_job         ON public.shift_attendance_confirmations (job_id);
CREATE INDEX IF NOT EXISTS idx_sac_worker_open ON public.shift_attendance_confirmations (worker_id)
    WHERE response IS NULL;
-- CONCURRENTLY é desnecessário (tabela nasce vazia) e quebraria a transação da migration.

-- Policies ANTES do ENABLE. Só SELECT: toda mutação é RPC/trigger DEFINER (padrão shift_calls).
DROP POLICY IF EXISTS "sac_select" ON public.shift_attendance_confirmations;
CREATE POLICY "sac_select" ON public.shift_attendance_confirmations
    FOR SELECT TO authenticated
    USING (worker_id = (SELECT auth.uid()) OR public.is_job_owner(job_id));

ALTER TABLE public.shift_attendance_confirmations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.shift_attendance_confirmations NO FORCE ROW LEVEL SECURITY;

REVOKE ALL  ON public.shift_attendance_confirmations FROM anon;   -- nunca FROM PUBLIC (20260318000000)
GRANT SELECT ON public.shift_attendance_confirmations TO authenticated;
GRANT ALL    ON public.shift_attendance_confirmations TO service_role;

-- Notificação do PEDIDO: UMA cópia do texto, os dois escritores passam por aqui.
CREATE OR REPLACE FUNCTION public.notify_worker_on_attendance_request()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER
SET search_path = '' SET timezone = 'America/Sao_Paulo'
AS $$
DECLARE v_when text;
BEGIN
    SELECT to_char(public.job_local_date(NEW.job_id), 'DD/MM') INTO v_when;
    INSERT INTO public.notifications (user_id, type, title, message, link)
    VALUES (NEW.worker_id, 'status_change',
        'Confirma seu turno de ' || COALESCE(v_when, 'amanhã') || '?',
        'A empresa precisa saber se você vai. Responda com um toque em Meus Turnos — '
        || 'se não puder ir, avisar agora ajuda todo mundo.',
        '/my-jobs');
    RETURN NEW;
END; $$;

DROP TRIGGER IF EXISTS trg_notify_worker_on_attendance_request ON public.shift_attendance_confirmations;
CREATE TRIGGER trg_notify_worker_on_attendance_request
    AFTER INSERT ON public.shift_attendance_confirmations
    FOR EACH ROW EXECUTE FUNCTION public.notify_worker_on_attendance_request();

REVOKE ALL ON FUNCTION public.notify_worker_on_attendance_request() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.notify_worker_on_attendance_request() TO authenticated, service_role;
-- ^ EXECUTE em função de TRIGGER: lição 20260816201420 / 20260816201457.

-- DOWN:
--   DROP TABLE IF EXISTS public.shift_attendance_confirmations;
--   DROP FUNCTION IF EXISTS public.notify_worker_on_attendance_request();
--   DROP FUNCTION IF EXISTS public.job_local_date(uuid);
```

---

## `20260817000700_attendance_confirmation_rpcs.sql`

Cabeçalho obrigatório nas três: `SECURITY DEFINER`, `SET search_path = ''`, `SET timezone = 'America/Sao_Paulo'`.

### `request_attendance_confirmation(p_application_id uuid) RETURNS jsonb`

```
 1. auth.uid() IS NULL                          → 'unauthenticated'
 2. SELECT ... FROM applications WHERE id = p_application_id FOR UPDATE
    ^ SERIALIZA o cap de 2. Sem o lock, dois cliques simultâneos passam os dois
      (o count() não é atômico). Mesmo raciocínio do lock de `jobs` em claim_shift_slot.
 3. NOT public.is_job_owner(job_id)             → 'forbidden'        [A11]
 4. status NOT IN ('hired','in_progress')       → 'invalid_status'
 5. NOT public.job_is_active(job_id)            → 'job_inactive'     [MESMO predicado de 000500]
 6. public.job_local_date(job_id) < now()::date → 'job_past'
 7. EXISTS(response IS NOT NULL)                → 'already_responded'
 8. count(*) >= 2                               → 'limit_reached'    [A10]
 9. max(requested_at) > now() - '6 hours'       → 'cooldown' (+ retry_after)
10. INSERT (..., source='manual', requested_by=auth.uid()) → trigger notifica
    → {'outcome':'requested','request_count':n+1}
```

### `respond_attendance_confirmation(p_application_id uuid, p_response text) RETURNS jsonb`

```
 1. p_response NOT IN ('confirmed','cannot_attend') → 'invalid_response'
 2. applications.worker_id <> auth.uid()            → 'not_target'    [A12]
 3. status NOT IN ('hired','in_progress')           → 'invalid_status'
 4. UPDATE sac SET response=..., responded_at=now()
      WHERE application_id = p_application_id AND response IS NULL;
    GET DIAGNOSTICS v_rows = ROW_COUNT;
    ^ ATÔMICO. Nada de SELECT-depois-UPDATE: duplo toque perde a corrida no próprio WHERE.
    v_rows = 0 → 'already_responded' (se existe linha respondida) senão 'not_requested'  [A5]
 5. SE 'cannot_attend': INSERT em notifications INLINE (um único escritor — ver ADR item 4),
    destinatário resolvido com ANCORAGEM DUPLA, verbatim de claim_shift_slot:
        SELECT c.owner_id INTO v_user FROM public.companies c WHERE c.id = v_company_id;
        IF v_user IS NULL THEN v_user := v_company_id; END IF;
    título com "não vai poder", link '/company/jobs/<job_id>/candidates'.        [A4]
    SE 'confirmed': nenhuma notificação.                                          [A3]
```

### `request_attendance_confirmations_due() RETURNS jsonb`

> **CORREÇÃO pós-implementação (evaluator, 18/08/2026 — L12):** a versão abaixo, aprovada neste
> gate, tinha uma lacuna: sem guarda de cap/resposta, a varredura furava o cap de 2 pedidos
> (inseria uma 3ª linha quando a empresa já tinha usado os 2 pedidos manuais) e re-perguntava a
> quem já tinha respondido (o card de confirmação reaparecia em `MyJobs` como se a resposta
> anterior nunca tivesse existido). O `WHERE` real, implementado em `20260817000700`, ganhou
> `AND NOT EXISTS (... response IS NOT NULL ...)` e `AND count(*) < 2` — ver a migration para o
> SQL completo e o raciocínio da escolha (`count(*) < 2`, simétrico entre 'auto'/'manual', em vez
> de excluir toda application que já teve QUALQUER pedido manual).

```sql
INSERT INTO public.shift_attendance_confirmations
       (application_id, job_id, worker_id, source, requested_by)
SELECT a.id, a.job_id, a.worker_id, 'auto', NULL
  FROM public.applications a JOIN public.jobs j ON j.id = a.job_id
 WHERE a.status IN ('hired','in_progress')
   AND j.start_date::timestamptz::date = now()::date + 1
   AND public.job_is_active(j.id)
ON CONFLICT (application_id) WHERE source = 'auto' DO NOTHING;   -- idempotente  [A2]
```

> Ver correção acima — este bloco não tem a guarda de cap/resposta; é preservado aqui só como
> registro do que foi literalmente aprovado no gate, não como fonte de verdade da implementação.

### Grants

```sql
REVOKE ALL ON FUNCTION public.request_attendance_confirmation(uuid)       FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.respond_attendance_confirmation(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.request_attendance_confirmation(uuid)       TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.respond_attendance_confirmation(uuid, text) TO authenticated, service_role;

-- A varredura é a ÚNICA que authenticated NÃO pode chamar: senão qualquer conta dispara
-- notificação em massa para todos os freelas de todos os turnos de amanhã.
REVOKE ALL ON FUNCTION public.request_attendance_confirmations_due() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.request_attendance_confirmations_due() TO service_role;
```

---

## `20260817000800_schedule_attendance_confirmations.sql`

```sql
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
        -- cron.schedule(jobname, ...) faz upsert por nome (pg_cron >= 1.4) → idempotente.
        -- pg_cron interpreta o schedule em UTC: 21:00 UTC = 18:00 BRT.
        -- Brasil sem horário de verão desde 2019 → offset fixo, sem lógica de DST.
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

-- Verificar: SELECT jobname, schedule, active FROM cron.job WHERE jobname LIKE 'shift-attendance%';
-- DOWN:      SELECT cron.unschedule('shift-attendance-confirmations-d1');
```

---

## Landmines (ordenados por custo se ignorados)

| # | Achado | Consequência | Correção |
|---|---|---|---|
| **L1** | CTA de A8 abre Chamado de Turno sem liberar a vaga | Todo alvo recebe `filled`; chamado fecha sozinho; notificação de "Vaga preenchida" para quem nunca teve chance | CTA = `dismissFromShift` **e depois** F1; tratar `blockedByPayment` |
| **L2** | Tipo de `jobs.start_date` | Off-by-one de véspera: pedido no dia errado, ou nenhum pedido | **RESOLVIDO** — confirmado `timestamptz` em produção. `job_local_date` com `SET timezone` + `::timestamptz::date` |
| **L3** | Cap de 2 sem lock | Dois cliques simultâneos → 3+ pedidos | `SELECT ... FROM applications WHERE id = ... FOR UPDATE` no topo da RPC manual |
| **L4** | `job_is_active` tem que ser o **mesmo** predicado de `20260817000500` | F1 recusa turno cancelado, F4 continua notificando os freelas dele | Reusar o helper; NÃO reescrever a condição |
| **L5** | Varredura executável por `authenticated` | Qualquer conta dispara notificação em massa. `EXECUTE` é `PUBLIC` por default — o REVOKE é obrigatório, não higiene | `REVOKE ... FROM PUBLIC, anon, authenticated` |
| **L6** | `EXECUTE` da função de trigger | Advisor 0028 já custou 2 migrations corretivas (`20260816201420`/`201457`) | `GRANT EXECUTE ... TO authenticated, service_role` |
| **L7** | Acentos em texto de produto | `20260816201322` perdeu acentos no transporte MCP | Aplicar via CLI/arquivo; conferir depois |
| **L8** | `respond` com SELECT-depois-UPDATE | Duplo toque grava duas vezes; A5 falha | `UPDATE ... WHERE response IS NULL` + `ROW_COUNT` |
| **L9** | UPDATE sob RLS retorna 0 linhas sem erro | Irrelevante nas RPCs (DEFINER), **relevante no service**: `.select('id')` obrigatório | Padrão `removeFromTeam` |
| **L10** | Ancoragem simples de `validate_application_update` vs. dupla de `is_job_owner` | **Pré-existente, inerte** com o schema em tabela (não escrevemos em `applications`) | Alinhar quando o par `is_job_owner`/`is_company_owner` for unificado |
| **L11** | `job_is_active` como `SECURITY INVOKER` dependeria da policy de SELECT de `jobs`, que o `ADR-20260816-rls-desligada-jobs-conversation.md` planeja apertar na Fase 3 (`can_view_job`) | A varredura roda via `pg_cron` SEM SESSÃO (`auth.uid()` NULL) — se a policy futura exigir sessão, `job_is_active` INVOKER devolveria `false` para tudo, e a feature morreria em silêncio (zero pedido, zero erro, zero log) | `job_is_active` é `SECURITY DEFINER` (achado do security-reviewer, 18/08/2026) — desacopla o predicado da policy de `jobs` |
| **L12** | Varredura sem guarda de cap/resposta (lacuna deste próprio documento, seção `request_attendance_confirmations_due`) | Empresa com os 2 pedidos manuais já usados recebe uma 3ª notificação (fura o cap); freela que já respondeu é perguntado de novo e o card reaparece em `MyJobs` (destrói a confiança que a feature existe para construir) | `AND NOT EXISTS (... response IS NOT NULL ...)` + `AND count(*) < 2` no `WHERE` da varredura (achado do evaluator, 18/08/2026 — ver `20260817000700`) |

---

## Ajustes a propagar na spec

- **R1** → tabela, não colunas. **R6** cai; entra `ShiftAttendanceConfirmation` em `types/index.ts`.
- **R4** → deixa de ser Edge Function; vira `request_attendance_confirmations_due()` + migration de cron.
- **R3** → acrescentar `job_inactive` e `job_past` aos `outcome`s.
- **R5** → `attendanceConfirmationService` ganha leitores (`getConfirmationsForJob`, `getMyPendingConfirmations`).
- **R8(c)/A8** → CTA passa a ser "Dispensar e chamar substituto".
- **R10/A6** → mantidos, agora estruturais.
