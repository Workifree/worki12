# ADR-20261127 — Leitura de turnos (`jobs`) escopada por quem opera ou participa

## Status
APROVADO (emendado em 27/11/2026 após revisão de segurança: SOS limitado no tempo e DROP da INSERT de candidatura)

## Contexto
Teste real em produção: um Encarregado confirmado faz
`GET /rest/v1/jobs?select=id,title,responsible_id&company_id=eq.<empresa>` e recebe **todos** os turnos da
company (título, valor, responsável de outros operadores). A escrita já é barrada pelo seam
(`session_can_operate_job`), e `applications`/`shift_payments` vêm vazios, mas a leitura de `jobs` não.

Catálogo de produção (consultado em 27/11/2026, `pg_policies`):

| Policy | Cmd | Roles | USING |
|---|---|---|---|
| `Authenticated can view jobs` | SELECT | authenticated | `true` |
| `jobs_select_authenticated` | SELECT | authenticated | `true` |
| `jobs_insert_company_owner` / `jobs_update_company_owner` / `jobs_delete_company_owner` | escrita | authenticated | seam |

São **duas** policies permissivas `true` (somadas por OR). Remover só uma não fecha nada.
Efeito colateral do mesmo furo, além do Encarregado: **qualquer conta autenticada** (outra empresa, qualquer
freela) lê todos os turnos de todas as empresas. `anon` não tem policy, então não lê nada hoje.

### Inventário de consumidores de `jobs`
- **Vitrine/feed do freela: não existe mais.** Não há rota `Jobs`/`JobDetails`/feed em `App.tsx` (pivô
  empresa-primeiro, convite push). Nenhuma query do lado do freela lista vagas abertas sem vínculo.
- **Freela, sempre via vínculo próprio:** `MyJobs` (embed `job:jobs` em applications), `Dashboard` (embeds em
  applications/shift_payments), `Messages` (embed), `ReceiptView` (`jobs.presence_mode` por id do próprio
  recibo), `CompanyPublicProfile` (`applications ... jobs!inner(company_id)` filtrado por `worker_id = eu`),
  `Notifications` (rótulo por id do link), `shiftCallService:436` / `shiftInviteService:633,710` (embed do
  turno no convite/chamado, inclusive SOS antes do aceite), `paymentRecordService:207,620`, `walletService:266`.
- **Empresa (Gestor/Encarregado):** `CompanyJobs`, `CompanyJobDetails`, `CompanyJobCandidates`,
  `CompanyCreateJob` (inclui `insert(...).select().single()` — RETURNING exige SELECT), `CompanyDashboard`,
  `CompanyMessages`, `CompanyTeam`, `WorkerPublicProfile`, `InviteSeriesModal`, `InviteToShiftModal`,
  `useBatchLabels`, `applyPresenceToJobs`, `shiftBatchService` (lista, detalhe, `countPublishedBatch`),
  `shiftOperationService`, `shiftCallService:182`, `operationAnalyticsService`, `orderReportService`,
  `paymentRecordService:172`.
- **Banco, INVOKER (sofrem a RLS de `jobs`):** `is_job_owner` (lê `jobs` e chama o seam),
  `applications_update_guard` e `applications_presence_guard` (worker lê o turno da própria application),
  `enforce_job_series_same_owner`, `create_job_series`, `create_jobs_batch` (empresa). Todas as DEFINER
  (seam, RPCs de chamado/SOS/série/convite, `get_*`) não são afetadas.
- **Realtime:** `jobs` não está em `supabase_realtime` (0 linhas em `pg_publication_tables`).
- **Edge Functions:** usam `service_role` e ignoram a RLS.

## Decisão
Trocar as duas policies `true` por **uma** policy de SELECT ancorada no registro:

```
jobs_select_scoped USING (
     session_can_operate_job(company_id, responsible_id, (start_date AT TIME ZONE 'America/Sao_Paulo')::date)
  OR session_is_job_participant(id)
)
```

- **Gestor/dono/operador de organização:** primeiro ramo, via `is_company_owner` dentro do seam. Vê todos.
- **Encarregado confirmado:** primeiro ramo, só turnos de que é responsável ou que cobre na data. Turno com
  `responsible_id` NULL ou de operador removido tem como responsável efetivo o Gestor, então fica fora (coerente
  com a escrita). Encarregado não confirmado vê zero.
- **Freela:** segundo ramo, função nova `session_is_job_participant(job_id)`, SECURITY DEFINER, sempre sobre
  `auth.uid()` (não aceita "de qual usuário"), verdadeira se ele tem `applications`, `shift_call_targets` ou
  `shift_payments` naquele turno. Cobre convite, chamado de equipe e SOS antes do aceite, contrato, histórico,
  recibo e chat.
- **Outra empresa / freela sem vínculo / anon:** nada.

**É a mesma expressão que as policies de escrita já usam.** O predicado de leitura passa a ser o predicado de
operação mais a participação do freela. Assim não existe um terceiro lugar com a regra "quem é a empresa".

### Por que DEFINER no ramo do freela (42P17)
Uma subquery direta em `applications` dentro da policy de `jobs` seria avaliada sob a RLS de `applications`, cuja
policy `Companies can view applications for their jobs` chama `is_job_owner` (INVOKER), que lê `jobs` →
recursão infinita de policy (42P17) **em runtime**. `shift_call_targets` e `shift_payments` têm o mesmo ciclo
via `is_job_owner`. A função DEFINER lê as três tabelas sem RLS e devolve só um booleano sobre a própria sessão.
O primeiro ramo não lê `jobs` (o seam recebe as colunas da linha), então também não recursa.
`is_job_owner` continua INVOKER e passa a ler `jobs` sob a nova RLS. O resultado é o mesmo, porque a linha só é
visível quando o próprio seam já seria verdadeiro.

## Consequências
### Positivas
- Fecha o vazamento para o Encarregado e o vazamento maior para outras empresas e freelas sem vínculo.
- Nenhuma mudança de contrato de RPC, nenhum toque em saldo/escrow (Article 8 intacto).
- O F13/E2 continua sendo a única costura de autorização de empresa.

### Negativas / Trade-offs
- **Revisado após a revisão de segurança:** o alvo de SOS NÃO mantém leitura para sempre. A notificação do SOS só
  traz o nome da empresa; título, valor, local e briefing do turno vazariam para quem foi sorteado e nunca aceitou.
  Regra: alvo de SOS lê o turno só enquanto o chamado está `open` e não expirado, ou depois de `response='accepted'`.
  Recusou, perdeu a corrida, expirou ou foi cancelado = perde a leitura. Alvos `team` (elenco) mantêm a leitura.
  A lista de convites pendentes do freela (`listPendingForWorkerChecked`) já descarta chamado não aberto ou expirado,
  então não depende de embed de chamado fechado.
- A policy de INSERT `Workers can insert applications` (worker_id = auth.uid(), qualquer job_id) é removida na mesma
  migration: com leitura por participação, ela permitiria ao freela se auto-conceder leitura de qualquer turno por
  uuid. O frontend não tem INSERT de candidatura pull; o convite da empresa segue por `applications_insert_company_invite`
  e o aceite é `claim_shift_slot` (DEFINER).
- O seam passa a rodar por linha nas leituras de `jobs`. São 59 linhas hoje, e as funções são STABLE. Revisar com
  `EXPLAIN` quando houver mais de 10 mil linhas.
- Para o Encarregado, relatórios e contagens (`orderReportService`, `operationAnalyticsService`,
  `CompanyDashboard`) passam a mostrar só o escopo dele. É o comportamento desejado.
- `Notifications` de turno alheio fica sem rótulo. A tela já degrada para o texto da notificação.
- Uma feature futura de vitrine pública ou de candidatura aberta exigirá policy nova e explícita (RPC projetada,
  não `USING (true)`).

## Alternativas rejeitadas
- **Manter `USING(true)` e filtrar no client:** viola o Article 4 (RLS é a primeira linha).
- **Ramo "vaga aberta" (`status='open'`) para freela:** não há consumidor. 35 turnos estão `open`, e reabriria o
  mesmo vazamento para qualquer conta.
- **View/RPC projetada só para o Encarregado:** deixa a tabela crua aberta, e o PostgREST continua expondo `jobs`.
- **Subquery direta em `applications` na policy:** 42P17 em runtime.

## Plano de testes
1. Pré-aplicação (read-only, já feito): catálogo das policies, `prosecdef` do seam e publicação de realtime.
2. Pós-aplicação, em transação com ROLLBACK, para cada papel:
   ```sql
   BEGIN;
   SET LOCAL ROLE authenticated;
   SELECT set_config('request.jwt.claims', json_build_object('sub','<uid>','role','authenticated')::text, true);
   SELECT count(*), count(*) FILTER (WHERE responsible_id IS DISTINCT FROM '<uid>') FROM public.jobs WHERE company_id='<empresa>';
   ROLLBACK;
   ```
   Esperado: Gestor = total da company não deletado+deletado. Encarregado = só os dele e os cobertos (segunda
   contagem só por cobertura). Encarregado não confirmado = 0. Freela = só turnos com application, alvo ou
   pagamento. Freela de outra empresa = 0. Outro dono de company = 0 da empresa alheia.
   Recursão: no papel freela, rodar `SELECT a.id, j.title FROM applications a JOIN jobs j ON j.id=a.job_id`
   e `SELECT * FROM shift_call_targets t JOIN shift_calls c ON c.id=t.call_id JOIN jobs j ON j.id=c.job_id`.
   Nenhum dos dois pode dar 42P17.
3. Requisição REST real com o token do Encarregado, repetindo o GET do incidente.
4. harness-tester com 3 papéis (Gestor 9222, freela 9223, Encarregado):
   - Gestor: lista, detalhe, criar turno (RETURNING), lote, relatório.
   - Encarregado: vê só os próprios turnos, cria turno e o vê, "Cobrir" faz aparecer o turno coberto na data.
   - Freela: convite pendente com card do turno, chamado SOS antes do aceite, MyJobs, check-in (guard lê
     `jobs`), recibo `/recibo/:jobId`, chat, `/empresa/:id`.

## Migration
`supabase/migrations/20261206000100_jobs_select_escopado.sql`. O número é maior que 20261205000500 e que a
última do repositório (20261204000300).

```sql
CREATE OR REPLACE FUNCTION public.session_is_job_participant(p_job_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT (SELECT auth.uid()) IS NOT NULL AND (
       EXISTS (SELECT 1 FROM public.applications a
                WHERE a.job_id = p_job_id AND a.worker_id = (SELECT auth.uid()))
    OR EXISTS (SELECT 1 FROM public.shift_call_targets t
                 JOIN public.shift_calls c ON c.id = t.call_id
                WHERE c.job_id = p_job_id AND t.worker_id = (SELECT auth.uid())
                  AND (COALESCE(c.origin,'team') <> 'sos' OR t.response = 'accepted'
                       OR (c.status = 'open' AND c.expires_at > now())))
    OR EXISTS (SELECT 1 FROM public.shift_payments sp
                WHERE sp.job_id = p_job_id AND sp.worker_id = (SELECT auth.uid()))
  );
$$;
REVOKE ALL ON FUNCTION public.session_is_job_participant(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.session_is_job_participant(uuid) TO authenticated, service_role;
COMMENT ON FUNCTION public.session_is_job_participant(uuid) IS
  'Ramo do freela na leitura de jobs. Sempre sobre auth.uid(). DEFINER para quebrar o ciclo jobs->applications->is_job_owner->jobs (42P17). ADR-20261127-leitura-de-turnos-do-encarregado.';

DROP POLICY IF EXISTS "Authenticated can view jobs" ON public.jobs;
DROP POLICY IF EXISTS jobs_select_authenticated ON public.jobs;
DROP POLICY IF EXISTS jobs_select_scoped ON public.jobs;
CREATE POLICY jobs_select_scoped ON public.jobs FOR SELECT TO authenticated USING (
     public.session_can_operate_job(company_id, responsible_id, ((start_date AT TIME ZONE 'America/Sao_Paulo'))::date)
  OR public.session_is_job_participant(id)
);

-- Índices de apoio: nenhum novo (applications UNIQUE(job_id, worker_id); shift_calls(job_id); shift_call_targets
-- UNIQUE(call_id, worker_id); shift_payments(job_id)).
-- (O SQL final, com a regra de SOS no tempo e o DROP da policy de INSERT, está na migration.)

-- DOWN (restaura o estado anterior, inclusive o furo):
-- DROP POLICY IF EXISTS jobs_select_scoped ON public.jobs;
-- CREATE POLICY jobs_select_authenticated ON public.jobs FOR SELECT TO authenticated USING (true);
-- DROP FUNCTION IF EXISTS public.session_is_job_participant(uuid);
```

## Frontend a ajustar
Nenhum ajuste é obrigatório. Os consumidores do freela usam vínculo e os da empresa passam pelo seam.
Recomendado conferir, sem bloquear a entrega:
- `pages/Notifications.tsx`: rótulo ausente para turno fora do escopo (já degrada).
- `pages/company/CompanyDashboard.tsx`, `services/orderReportService.ts`, `services/operationAnalyticsService.ts`:
  textos de "total da empresa" vistos por Encarregado agora mostram só o escopo dele.

## Referências
- ADR-20261123-responsavel-efetivo-derivado-no-seam, ADR-20261123-encarregado-confirmado-e-pii
- architecture.md, "Equipe e encarregados"
