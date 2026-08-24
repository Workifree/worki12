# Architecture — Worki

> Como as partes do sistema se compõem. Atualizar quando: introduzir camada, trocar tecnologia macro,
> adicionar serviço externo, mudar o fluxo de pagamento.

> **Aviso de verificação (22/08/2026):** As afirmações de schema abaixo (tabelas, colunas, índices, RPCs, policies)
> foram conferidas contra o catálogo de produção (`information_schema`, `pg_policies`, `pg_proc`, `pg_indexes`, `cron.job`).
> Este arquivo descreve a **intenção** das migrations; nada no build/lint/teste cruza isso com o banco em runtime.
> **Schema aqui vale o que o catálogo diz** — não o histórico de migrations. Ver seção "Estado do banco de produção".

## Visão macro

SPA React 19 em Vite, servida pela Vercel como estático. Backend é Supabase (PostgreSQL + PostgREST +
Realtime + Auth + Storage + Edge Functions Deno). Pagamentos são intermediados pelo **Asaas** através de
Edge Functions; uma **carteira central** detém os fundos e o saldo por usuário vive no DB com **escrow**.

O frontend é uma camada fina sobre o Supabase: leituras são `supabase.from(...)` diretas
(`useState`+`useEffect`, sem React Query na prática); operações privilegiadas (pagamentos, admin, exclusão
de conta) passam por Edge Functions. A segurança dura mora em **RLS + RPCs atômicas** no Postgres.

Observabilidade via **Sentry** (erros + user context).

## Request flow

```
Browser (SPA React 19)
   │
   ├─→ React Router (App.tsx, React.lazy + Suspense)
   │      │
   │      └─→ <ProtectedRoute> — sessão (useAuth) + onboarding + isolamento de papel + TOS gate
   │              │
   │              └─→ <MainLayout> (worker) | <CompanyLayout> (empresa)
   │                      │
   │                      └─→ <Página> (pages/ | pages/company/)
   │                              │
   │                              ├─→ leitura: supabase.from('tabela').select() (PostgREST + RLS)
   │                              │
   │                              ├─→ carteira/escrow: walletService.* → RPC atômica no Postgres
   │                              │
   │                              └─→ privilegiado: services/api.ts invokeFunction() → Edge Function (Deno)
   │                                            │
   │                                            └─→ Asaas API (PIX/Boleto/Cartão)  +  service_role no DB
   │
   └─→ Realtime: NotificationContext escuta postgres_changes + canal broadcast 'new_notification'
```

## Camadas e responsabilidades

| Camada | Responsabilidade |
|---|---|
| `App.tsx` / `main.tsx` | Composição — router, providers (Auth, Notification, Toast, QueryClient), bootstrap. |
| `pages/`, `pages/company/`, `pages/worker/` | Telas de rota por papel. Lógica de tela + fetch direto. |
| `components/` | UI reutilizável cross-papel (cards, modais, navegação, guards). |
| `contexts/` | Estado global de sessão, notificações, toasts. |
| `services/` | Lógica de negócio não-UI: `walletService` (escrow prepago/postpago, ramificação por `kind`), `paymentMethodService` (tokenize, capture, release-hold de cartão), `paymentRecordService` (modo A — registro de pagamento externo, sem mover saldo), `teamConnectionService` (equipe/relações), `shiftInviteService` (convites push), `analytics`, `api` (edge functions). |
| `lib/` | Config e utilitários: `supabase` (client), `gamification`, `validation`, `logger`. |
| `types/` | Contrato de tipos do domínio (à mão — fonte da verdade). |
| `supabase/functions/` | Operações privilegiadas (Asaas, admin, notificações) — Deno + service_role. |
| `supabase/migrations/` | Schema + RLS + RPCs atômicas de escrow/carteira. |

## Camada de relações worker↔empresa (Slice 1: loop relacional)

**Antes do Slice 1:** relação transacional pura via `applications`. Toda interação passava por candidatura/contratação.

**Slice 1 (novo):** camada consentida permanente (`team_connections`):
- Empresa convida worker → status 'pending'
- Worker aceita → status 'accepted' (equipe permanente)
- Worker sai/bloqueia → status 'blocked'

Canais de convite: **link** (token via URL `/convite/:token`), **telefone** (Worki ID manual), **QR** (v1.1).
Após aceitação da equipe, convites de turno seguintes (push via `applications.status='invited'`) não re-pedem handshake
— lista fechada. Política de INSERT em `applications` garante que só membros aceitos podem ser convidados.

**Guarda de consentimento no DELETE (migração `20260816000000`):** A política UPDATE já impedia a empresa de mudar `status='blocked'`,
mas DELETE não tinha a mesma proteção — a empresa podia deletar a linha bloqueada e reconvidar, anulando o veto do freela.
A policy `tc_delete_company` passou a exigir `(status <> 'blocked' OR blocked_by = auth.uid())`: apenas a pessoa que gravou o bloqueio
pode deletá-lo. Veto do freela é indelével para a empresa; bloqueio feito pela própria empresa pode ser removido (evita auto-trancamento).

## Convite push de turno (Slice 1: operação freelancer)

Novo fluxo coexistente com pull (candidatura):
- **Pull:** worker se candidata a vaga aberta → empresa revisa → contrata (reserve_escrow se pré-pago)
- **Push:** empresa cria `applications` com `status='invited'` para worker da equipe aceita → worker aceita (→'hired')
  ou recusa (→'declined', neutro) → empresa procede (check-in/checkout) ou slot reabre

Máquina de estados: `invited` → `accepted` | `declined`. Aceite seta `status='hired'` (base do ciclo).
Transição validada em `shiftInviteService`, não só em RLS.

**Modelo de pagamento (Slice 1):** o fluxo **push** (criar turno → convite → aceite) **NÃO reserva escrow** — o
trigger `auto_reserve_escrow_on_hire` pula a reserva no aceite de convite (ADR-20260622). Só o **fluxo pull
legado** (candidatura → hired) ainda reserva no aceite (modelo prepago original, inalterado). O pagamento do
push é o **Slice 2: postpago** (cartão on-file + captura na conclusão, sem depósito antecipado).

## Chamado de Turno (F1: disparo 1→N com primeiro-aceite)

> Entrevista 17/08/2026 (sócio de 10 unidades Divino Fogão): a dor #1 não é controle de gasto — é
> **disponibilidade**. "Oferecer a vaga para vários freelancers simultaneamente, sem segurar a vaga por
> uma ou duas horas... o primeiro que aceitar preenche, mais ou menos como o Uber faz."

**Tabelas (migrations `20260817000000`–`20260817000200`):**
- `jobs.slots` (int, default 1, CHECK >= 1) — quantas pessoas o turno precisa. Uma posição preenchida =
  uma `applications` em `hired|in_progress|completed`.
- `shift_calls` — o disparo: `(job_id, company_id, created_by, slots, reason, message, targets_count,
  status, expires_at, created_at, closed_at, first_claim_at)`. Status: `open | filled | cancelled | expired`.
- `shift_call_targets` — quem foi chamado: `(call_id, worker_id, notified_at, responded_at, response)`.
  Response: `accepted | declined | closed` (NULL = pendente). UNIQUE `(call_id, worker_id)`.

**Por que tabelas novas e não `applications` estendida (ADR embutido):** `applications_job_worker_unique
UNIQUE (job_id, worker_id)` + `'cancelled'` irreversível fariam os perdedores da corrida ficarem
**permanentemente inelegíveis** àquele turno — inclusive se a vaga reabrisse. Apagar as linhas perdedoras
para liberar o UNIQUE destruiria o histórico "quem foi chamado × quem respondeu × em quanto tempo", que é
o insumo do BI de operação e do ranking de descoberta futura. Logo: a **tentativa** vive em
`shift_call_targets`; o **contrato** continua em `applications`, criado só para quem ocupou a vaga.

**Convite individual = chamado de um alvo.** `shiftInviteService.inviteWorkerToShift` delega para
`ShiftCallService.createShiftCall(jobId, [workerId])`. Não existem dois produtores de convite com regras
diferentes de reversibilidade.

**RPCs (`20260817000200`, todas SECURITY DEFINER + search_path=''):**
- `claim_shift_slot(call_id)` — o aceite. **Lock em `jobs`, não em `shift_calls`**: dois chamados abertos
  do mesmo turno disputam as mesmas vagas, então o recurso escasso é o turno. Devolve jsonb com `outcome`:
  `claimed | filled | expired | cancelled | not_target | already_responded | already_hired |
  blocked_cancelled | not_found | unauthenticated`.
- `decline_shift_call(call_id)` — recusa NEUTRA (R6/R7). Avisa a empresa quando o chamado esvazia.
- `cancel_shift_call(call_id)` — empresa para de procurar. NÃO desfaz quem já aceitou (isso é
  `dismissFromShift`, com as guardas de pagamento ativo e presença).

**Como o aceite atravessa os dois triggers de `applications` (conhecimento reutilizável):**
Ambos são de **UPDATE** (`trg_validate_application_update` BEFORE, `trg_auto_reserve_escrow_on_hire` AFTER).
- Caminho normal (sem application prévia) → **INSERT** direto com `status='hired'`. Nenhum trigger de
  UPDATE dispara ⇒ **nenhum escrow reservado, sem flag nenhuma**. Article 8 intacto por construção.
- Caminho com application prévia ('invited' legado, 'declined', ou status do fluxo pull) → **DOIS UPDATEs**:
  passo 1 normaliza para `status='invited'` + `invited_by_company_at` (nenhum trigger reage a 'invited'),
  passo 2 vai para 'hired'. Só assim os dois triggers reconhecem "aceite de convite" e liberam — um UPDATE
  único vindo de 'declined' seria barrado pelo validador e, se passasse, reservaria escrow prepago
  (que em modo A aborta por falta de saldo e derrubaria o aceite inteiro).

**Recursão de policy — armadilha resolvida:** a policy de `shift_calls` precisa ler `shift_call_targets`
(sou alvo?) e a de `shift_call_targets` precisa ler `shift_calls` (sou dono do turno?). Subquery em policy
é avaliada sob a RLS da tabela referenciada ⇒ A→B→A = erro 42P17 **em runtime, não no CREATE**. Quebrado
com duas funções SECURITY DEFINER mínimas: `shift_call_job_id(call_id)` (devolve só um uuid) e
`is_shift_call_target(call_id)` (booleano, sempre sobre `auth.uid()` — não aceita "por qual usuário
perguntar", então não serve para varrer dado alheio).

**`is_job_owner(job_id)` (SECURITY INVOKER):** repete a ancoragem dupla de `jobs.company_id`
(`= auth.uid()` OU via `companies.owner_id`) num lugar só. Não é DEFINER de propósito — `jobs`/`companies`
já têm SELECT `USING (true)`. **É a costura por onde o multi-unidade/gerente (F3) vai passar.**

**Sem policy de UPDATE/DELETE** em nenhuma das duas tabelas: toda transição de estado passa pelas RPCs,
mantendo a máquina de estados em um lugar auditável.

**Métrica de topo:** `first_claim_at - created_at` = tempo de preenchimento. É o número que prova o ROI
("de 2 horas para 6 minutos") e aparece na tela da operação, não só em relatório.

**`shift_calls.reason`** (`falta | demissao | pico_previsto | evento | ferias | folga | reforco | outro`)
devolve o relatório que o sócio-operador já monta na mão: ele controla gasto com freela cruzando com
nível de falta e quebra de escala.

## Listas do Elenco (F2: camada organizacional)

> Entrevista 17/08/2026 (sócio de 10 unidades Divino Fogão): com o F1 resolvido (disparo 1→N primeiro-aceite),
> a operação real ainda não é rápida o bastante — às 8h30 de abertura, o gerente não quer marcar 8 freelas
> uma a uma, quer um atalho por função/turma que seleciona o grupo inteiro de uma vez.

**Tabelas (migration `20260817000300`):**
- `team_lists` — `(id uuid PK, company_id uuid NOT NULL, name text NOT NULL CHECK (length(trim(name)) > 0), created_by uuid, created_at timestamptz, updated_at timestamptz)`. RLS via função nova `is_company_owner(company_id)` (SECURITY INVOKER, ancoragem dupla idêntica a `is_job_owner`). SELECT/INSERT/UPDATE/DELETE todos restritos a `is_company_owner`.
- `team_list_members` — `(id uuid PK, list_id uuid NOT NULL REFERENCES team_lists(id) ON DELETE CASCADE, worker_id uuid NOT NULL REFERENCES workers(id) ON DELETE CASCADE, added_at timestamptz)`, UNIQUE `(list_id, worker_id)`. RLS: SELECT/INSERT/DELETE restritos a `is_company_owner` do `company_id` da lista via subquery em `team_lists`. INSERT trava lista fechada (SÓ `worker_id` com `team_connections.status='accepted'`), espelhando `shift_call_targets`. Um freela pode estar em N listas; lista pode estar/ser criada vazia.

**`is_company_owner(p_company_id uuid)` (SECURITY INVOKER, migração `20260817000300`):** Função paralela a `is_job_owner`, ancoragem dupla (R1/R12 da spec):
```sql
company_id = auth.uid() OR company_id IN (SELECT id FROM companies WHERE owner_id = auth.uid())
```
INVOKER porque `companies` tem SELECT `USING (true)` — como DEFINER compraria nada. **Contrato de manutenção:** `is_job_owner` e `is_company_owner` são um par — qualquer mudança na regra de autorização de empresa (F3 — multi-unidade/gerente) DEVE alterar ambas na mesma migration (agendado para unificação com BEGIN ATOMIC). Cada função carrega COMMENT apontando para a outra e para ADR-20260817-seam-autorizacao-empresa.md.

**Grafo acíclico de policies (conhecimento reutilizável):** `team_lists` references `companies` (SELECT `USING (true)`), `team_list_members` references `team_lists` (via RLS subquery) e `companies` — mas `team_lists` NÃO referencia `team_list_members` em policy. Grafo acíclico = sem recursão 42P17 = sem SECURITY DEFINER precisado. F1 teve de criar dois DEFINERs mínimos por causa da recursão `shift_calls ↔ shift_call_targets`; F2 dispensa isso. Padrão a observar: listar dependências policy de forma orientada antes de criar função com search_path.

**Uso no ShiftCallModal (R8–R11):** O modal já carrega o elenco aceito (`teamMembers`) e os excludos do turno (`excludeWorkerIds`). Listas renderizam como chips entre o grid Motivo/Expira e a barra de busca. Clique num chip calcula interseção com `available` (aceitos - excluídos). Se TODOS disponíveis da lista já estão em `selected`, clique os REMOVE; caso contrário, ADICIONA (união — não limpa seleção manual). Chip desabilitado se contagem = 0. Freela fora do elenco (team_connections não-accepted) é silenciosamente ignorado (filtro client contra `available`, nenhuma query nova, nenhum trigger de limpeza).

**Organizacional puro (Article 8 intacto):** F2 não cria papel novo, não move dinheiro, não muda máquina de estados de F1. É camada de UI/DB que acelera gesto de seleção. Zero impacto em `wallets`, `escrow_transactions`, `shift_payments`.

## Escala recorrente (F3: série EAGER de turnos)

> Entrevista 17/08/2026 (sócio de 10 unidades Divino Fogão): "A maior parte do volume NÃO é emergência — é cobertura de férias, 
> folgas dominicais, escalas fixas. Sem isso, a plataforma é botão de emergência 2-3×/mês e elenco desatualizado faz falhar justamente quando importa."

**Tabelas (migrations `20260817000400`–`20260817000500`):**
- `job_series` — `(id uuid PK, company_id uuid NOT NULL, recurrence_type 'weekly'|'daily', weekdays int[], range_start_date date, range_end_date date, occurrences_generated integer NOT NULL DEFAULT 0, status 'active'|'stopped', created_by uuid NOT NULL, created_at timestamptz)`. RLS via `is_company_owner(company_id)` (ancoragem dupla idêntica a F1/F2). Máximo 60 ocorrências por série (constraint SQL + trigger de statement + validação client). (`p_job_template jsonb` existe só como parâmetro de `create_job_series`, não como coluna armazenada.)
- `jobs` — duas colunas novas (nullable): `series_id uuid`, `series_occurrence_date date`. Um `jobs` com `series_id` é ocorrência materializável; sem `series_id`, é turno avulso (pull legado ou job single-shot). FK `jobs_series_id_fkey` de `series_id` → `job_series(id)` com `ON DELETE SET NULL` — delete da série apaga o vínculo das ocorrências, perdendo rastreabilidade "veio daquela série". Índice UNIQUE parcial `idx_jobs_series_occurrence_unique (series_id, series_occurrence_date) WHERE series_id IS NOT NULL AND status <> 'deleted'` para evitar datas duplicadas em uma criação lote.

**Geração EAGER:** Ao criar a série, `create_job_series` (RPC INVOKER) materializa **todos** os `jobs` de uma vez (não lazy no aceite/pull). Datas são calculadas **no cliente** (`lib/recurrence.ts`, `generateOccurrenceDates`), repassadas como array à RPC. Motivo: (1) teste determinístico sem mock de servidor; (2) UI mostra "isso vai criar N turnos" antes de confirmar; (3) limpa o conceito ("serie" é só config; "ocorrência" é turno concreto). A RPC roda em transação única: ou todas as ocorrências são criadas ou nenhuma é (Article 8 intacto — `INSERT jobs` não move saldo).

**Soft delete de turno (`status='deleted'`):** Cancelamento de ocorrência futura = `UPDATE jobs SET status='deleted'` nunca `DELETE`. Razão: `DELETE` em cascata apagaria `shift_calls` (perdia métrica `first_claim_at`/ROI), `escrow_transactions` (perdia razão/auditoria, não devolvia saldo) e seria rejeitado por `shift_payments` RESTRICT (aborta operação em lote). O valor `'deleted'` já está espalhado nos consumidores (`.neq('status','deleted')`), nenhum CHECK vigente o bloqueia. RPC `update_job_series_future` e `stop_job_series` usam `status='deleted'` para ocorrências futuras, nunca DELETE. Metadado `deleted_at` é imutável (documentação de quando foi macio).

**Operações em massa (RPCs SECURITY DEFINER):** `update_job_series_future` (edita N ocorrências futuras), `stop_job_series` (para série inteira) são DEFINER com `search_path=''` porque predicados incluem ancoragem dupla (`is_company_owner`) — se rodassem INVOKER, RLS simples de `applications` faria contagem de "qual será tocável" mentir (efeito: feature mostraria "vou alterar 10" mas alteraria 3). Padrão: cliente monta parâmetros, RPC decide "quem é tocável" atomicamente sob DEFINER, devolve `outcome` estruturado com contagem de afetados.

**Pré-visualização com `p_dry_run`:** `previewUpdateFutureOccurrences` e `previewStopSeries` (client) chamam as **mesmas** RPCs passando `p_dry_run=true`. Nenhuma escrita; mesmo predicado; desvio só no statement mutante (SKIP UPDATE/DELETE). Padrão: nunca calcular impacto no client (RLS simples mente); trazer do banco, sempre.

**Capítulo conhecimento de F1:** Ambas RPCs de transição de turno (`claim_shift_slot` em F1, `stop_job_series` em F3) travam o **mesmo objeto** (`jobs FOR UPDATE`). Quem para a série primeiro faz a outra ler `status='deleted'` e cair no ramo "série parada" — ordem de serialização está segura.

**Ocorrência de série é `jobs` normal:** `series_id` é só etiqueta; `applications`, `shift_calls`, `shift_payments`, `escrow_transactions` apontam para `jobs.id` como sempre. Agenda, Chamado de Turno, e convite direto não sabem que série existe. EAGER venceu lazy por causa dos 3 FKs — materializamos tudo no início, eliminamos carregamento assíncrono e máquinas de estado implícitas.

## Confirmação de Véspera (F4: descoberta de furo com 12h de antecedência)

> Entrevista 17/08/2026 (sócio de 10 unidades Divino Fogão): a quebra das 8h30 (turno aberto, ninguém aparece)
> **nasce de gente que não apareceu**. F1 ataca o sintoma (preencher rápido depois da falha); F4 ataca a causa
> (descobrir o furo com 12h de antecedência em vez de 2h30 antes da hora).

**Tabelas (migrations `20260817000600`):**
- `shift_attendance_confirmations` — tabela-evento. Colunas **conferidas no catálogo de produção em 22/08/2026** (`pg_attribute`, na ordem real): `id uuid, application_id uuid, job_id uuid, worker_id uuid, source text, requested_by uuid, requested_at timestamptz, response text, responded_at timestamptz`. Índices: `idx_sac_application (application_id)`, `idx_sac_job (job_id)`, `idx_sac_worker_open (worker_id) WHERE response IS NULL`, **`uq_sac_auto_once UNIQUE (application_id) WHERE source='auto'`** (automático é uma tentativa; manual repete). RLS **SELECT-only** (não há UPDATE/INSERT via client — tudo por RPC DEFINER).
  - `source` ∈ `{auto, manual}` e `response` ∈ `{confirmed, cannot_attend}` (ou NULL) — **CHECK fechado**, então nenhuma das duas pode carregar texto livre por construção. Dois CHECKs de coerência: `sac_author` (`manual` exige `requested_by`; `auto` exige `requested_by IS NULL` — o cron não tem autor) e `sac_response_pair` (`response` e `responded_at` são nulos juntos ou preenchidos juntos).
  - ⚠️ **A versão anterior desta linha estava errada em seis pontos** e sobreviveu por meses: inventava `confirmation_status`, `metadata jsonb` e `created_at` (nenhuma das três existe), trocava `requested_at`/`responded_at` por `request_sent_at`/`worker_responded_at`, e omitia `application_id` e `source`. Custo real: a revisão de LGPD registrou "`metadata jsonb` é risco inalcançável por asserção textual" — um risco **vazio**, sobre coluna inexistente, que quase virou dívida escrita. Schema aqui vale o que o catálogo diz; contrato de migration e memória descrevem a intenção, não o estado.

**Helpers SECURITY DEFINER (migração `20260817000600`):**
- `job_local_date(job_id uuid) → date` — retorna data local do turno convertida do UTC `job.start_date` via fuso 'America/Sao_Paulo' (configurado via GUC `proconfig` da função; não consultável em runtime). Corpo: `SELECT j.start_date::timestamptz::date FROM public.jobs j WHERE j.id = p_job_id;`. Usado por cron para saber "é hoje 20h se eu enviar confirmação agora?". Problema: cron roda sem sessão (`auth.uid()` NULL), logo não pode depender de policy de SELECT simples em `jobs`. Solução: **`SECURITY DEFINER` obrigatório** (predicado sem sessão = deve ter DEFINER).
- `job_is_active(job_id uuid) → boolean` — retorna true se turno não foi deletado (`status <> 'deleted'`), não está no passado, e tem freelas candidatos. Também SECURITY DEFINER (mesma razão: cron lê sem sessão).

**Gatilho de tentativa (trigger, migração `20260817000600`):**
- `trg_notify_worker_on_attendance_request` (AFTER INSERT ON shift_attendance_confirmations) — SECURITY DEFINER, insere notificação apenas para o freela (`worker` recebe; link `/my-jobs`).

**RPCs de mutação (migração `20260817000700`, todas SECURITY DEFINER + search_path=''):**
- `request_attendance_confirmation(p_application_id uuid)` — VOLATILE. Empresa pede confirmação de presença ao freela para turno. Insere linha em `shift_attendance_confirmations` com `source='manual'` + dispara notificação.
- `respond_attendance_confirmation(p_application_id uuid, p_response text)` — VOLATILE. Freela responde (ex.: "confirmed" / "cannot_attend"). Seta `responded_at` + `response`.
- `request_attendance_confirmations_due()` — RPC de leitura (SEM parâmetro), VOLATILE. **Mutador em lote do cron:** insere `shift_attendance_confirmations` com `source='auto'` via `ON CONFLICT (application_id) WHERE source='auto' DO NOTHING`, devolve `{outcome, requested}`. **GRANT exclusivo a `postgres` e `service_role`** — `authenticated` NÃO tem EXECUTE, logo não é acessível à UI worker (`MyJobs`).

**Agendador (migração `20260817000800`, `pg_cron`) — MANDATÓRIO para cumprir promessa**
```sql
IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
  SELECT cron.schedule(
    'shift-attendance-confirmations-d1',
    '0 21 * * *',                 -- 21h UTC = 18h BRT (descobre furos 12h antes de 8h30 do turno)
    $$SELECT public.request_attendance_confirmations_due();$$
  );
END IF;
```
**Proteção graceful:** `IF EXISTS` garante que migração passa sem erro se pg_cron não instalado. **Mas a feature é incompleta sem cron** — a promessa ("descobrir furo 12h antes") depende do alcance proativo. Sem agendador: empresa teria de lembrar de apertar botão manual na véspera = **comportamento humano que F4 existe para substituir** (feedback do evaluator: "ALTO" blocker). RPC `request_attendance_confirmations_due()` roda diariamente às 21h UTC (18h BRT) alcançando **freelas que não abriram o app** — diferencial vs. F1.

**Pre-requisito:** ops habilita `pg_cron` como passo de validação em produção. Não é "TODO futuro" — é gate de entrega.

**Modelo de dados (por quê tabela-evento e não coluna):**
Confirmação de véspera é uma **tentativa**, não o contrato. Uma vaga pode ter 10 freelas, cada um recebe N tentativas (reenvios se não responder). Adicionar colunas de tentativa em `applications` levaria a:
- Duplicação de lógica de notificação
- Histórico perdido (N tentativas em uma coluna `jsonb` é não-consultável)
- Máquina de estados em dois lugares (`applications.status` + `applications.attendance_attempt_status`)

`shift_attendance_confirmations` é **evento**: cada linha = uma tentativa. Reutilizável para futuro (webhook de SMS, retry com backoff, análise de padrão de não-aparecimento).

**Dual-flow:** empresa pode clicar manualmente "Pedir Confirmação" (bloqueia no clique) OU cron dispara automaticamente 20h antes. Clique é fallback; automação é padrão. Diferencia de F1 (`expire-invites` é housekeeping de máquina de estados, não core da promessa).

**Padrão: ✓ Tentativa é evento, contrato é linha** + **Escolha de timing depende do alcance necessário** — padrões catalogados em `patterns.md`.

## Cancelamento de turno (Slice 5: notificação obrigatória — bidirecional desde 20260816)

**Antes (até 20260714):** só o worker podia cancelar turno após aceite (status `hired` | `in_progress` → `cancelled`).

**Agora (20260816150000):** tanto **worker** quanto **empresa** podem cancelar:
- **Worker:** cancela convite/turno (`cancelApplication` em client) → empresa é notificada (título: "Turno cancelado pelo freela").
- **Empresa:** desfaz convite (`cancelInvite` no `shiftInviteService`, estado `invited`) ou dispensa do turno (`dismissFromShift`,
  estados `hired`/`in_progress`) → **freela é notificado** (título diferenciado: "Convite de turno cancelado" se era `invited`,
  "Turno cancelado pela empresa" se era `hired`/`in_progress`).
- **Ator desconhecido** (service_role, `delete-account`, cron): **ambos** são notificados com texto neutro
  ("O turno foi cancelado"), sem atribuir culpa.

**Trigger `trg_notify_counterpart_on_application_cancel` (SECURITY DEFINER, search_path='', migração 20260816150000):**
Substitui o antigo `trg_notify_company_on_worker_cancel` (20260714). Ramifica por `auth.uid()`:
```
AFTER UPDATE ON applications
WHEN (NEW.status='cancelled' AND OLD.status IN ('invited', 'hired', 'in_progress'))
→ Se auth.uid() = NEW.worker_id:     INSERT para empresa (link: '/company/jobs/<job_id>/candidates')
→ Se auth.uid() = jobs.company_id:  INSERT para freela (link: '/my-jobs')
→ Se auth.uid() IS NULL (ator desconhecido): INSERT para AMBOS
```

**Conhecimento reutilizável:** `auth.uid()` **funciona corretamente** dentro de `SECURITY DEFINER` (o DEFINER muda o ROLE de execução,
não as claims do JWT que vivem em `request.jwt.claims`). Precedentes: `validate_application_update`, `enforce_shift_payment_immutability`.

**Guarda em `dismissFromShift`:** não se pode dispensar um freela que já tem `shift_payments` ativo (`scheduled`/`recorded`), 
porque o UNIQUE parcial `(job_id, worker_id) WHERE status IN ('scheduled','recorded')` barra um novo marcador para o mesmo freela+turno.
Empresa precisa estornar o pagamento antigo (voided) primeiro, ou dispensar outro freela.

**Princípio:** saldo intacto (Article 8) — refund de escrow (Slice 1 prepago) é manual, disparado por empresa via
`refundEscrow` se desejado. Cancelamento não toca `shift_payments` — empresa estorna em operação separada.

## Modelo de pagamento (carteira central + escrow + postpago Slice 2)

> ⚠️ **REVISADO por ADR-20260630-pagamento-opcional-piloto (2026-06-30).** No piloto o pagamento pelo Worki é
> **OPCIONAL**. Três modos coexistem: **(A) pagamento externo registrado** — default do piloto, Worki registra
> PIX/dinheiro fora + recibo, **sem mover saldo** (novo marcador de pagamento por turno, fora de
> `escrow_transactions`); **(B) PIX-único → distribuição** — conveniência opt-in, 1 PIX da empresa distribuído
> a N freelas via RPC atômica idempotente; **(C) postpago cartão on-file** — o fluxo descrito abaixo, agora
> **opt-in / semente da expansão**, não o trilho padrão. Article 8/9 seguem valendo para B/C (todo movimento
> de saldo por RPC atômica). O modo A não toca saldo. O BI de gasto passa a unir escrow (B/C) + marcador (A).
> Diagramas abaixo = caminho postpago histórico, preservado.

### Fluxo prepago (Slice 1 — pull legado; intacto)

```
Empresa deposita (PIX) ──→ asaas-deposit ──→ Asaas ──webhook──→ credit_deposit (RPC) ──→ wallets.balance↑ (empresa)
Empresa contrata worker (pull) ──→ reserve_escrow (RPC) ──→ trava saldo em escrow_transactions
Turno confirmado         ──→ releaseEscrow (edge function) ──→ release_escrow (RPC) ──→ credita wallets.balance do worker
Cancelamento             ──→ refund_escrow (RPC, atômico) ──→ devolve saldo à empresa
Worker saca (PIX)        ──→ asaas-withdraw ──→ transferência da conta master ──→ wallets.balance↓ (worker)
```

**Kind:** `escrow_transactions.kind = 'prepaid'` (default histórico).

### Fluxo postpago (Slice 2 — push com cartão on-file; NOVO)

```
Empresa cadastra cartão ──→ asaas-tokenize-card ──→ token opaco Asaas em payment_methods (NUNCA PAN/CVV)
Empresa convida worker ──→ application.status='invited' ──→ Worker aceita (→'hired') ──→ SEM reserva
Worker faz check-in/checkout ──→ Empresa confirma conclusão (confirma turno + autoriza pagamento)
Confirma conclusão ──→ asaas-authorize-payment ──→ authorize_escrow_postpago (RPC, pré-autorização/hold) ──→ escrow.status='authorized'
Captura autorização ──→ asaas-capture-payment ──→ capture_escrow_postpago (RPC) ──→ escrow.status='captured' + credita worker
Cancelamento/no-show ──→ asaas-release-hold ──→ release_hold_postpago (RPC, type='escrow_void') ──→ devolve crédito à empresa
```

**Kind:** `escrow_transactions.kind = 'postpaid'`. Fluxo: `authorized` → `captured` → `released`, ou `authorized` → `refunded` (cancel).

### Estrutura de dados

- **`workers.pix_key`** (coluna existente, agora central no modo A): chave PIX do freela (CPF/CNPJ/e-mail/telefone/aleatória), coletada no onboarding
  (`WorkerOnboarding` R1.1) e normalizada (`normalizePixKeyForStorage` em `lib/validation.ts`). Exibida para empresa com `team_connections` aceita/pendente (R1.2, R1.3) 
  e no modal de "Registrar Pagamento" (R1.4). **Jamais** exposta a quem não tem vínculo (policy de SELECT em `workers` bloqueia).
- **`payment_methods`** (nova tabela): `(id, company_id, asaas_credit_card_token, brand, last4, holder_name, is_default, created_at, updated_at)`.
  RLS por `company_id`. NUNCA carrega PAN/CVV (Article 10).
- **`shift_payments`** (modo A — pagamento externo registrado): `(id, job_id, worker_id, company_id, application_id, amount, source, paid_at, status, scheduled_for, recorded_by, worker_confirmed_at, voided_at, void_reason, note, created_at)`.
  Status: `scheduled | recorded | voided`. `scheduled_for` (data prevista) é material/imutável; `paid_at` é nullable (NULL em scheduled, setado na efetivação) e depois imutável.
  UNIQUE parcial `(job_id, worker_id) WHERE status IN ('scheduled','recorded')` — garante 1 marcador ativo por (turno, freela). Turno com N freelas tem N marcadores, um por freela. ADR-20260816.
  RLS bilateral: empresa (registra/efetiva/cancela), worker (confirma recebimento em recorded). **NUNCA toca saldo** (auditoria, não liquidação).
- **`escrow_transactions`** (estendida):
  - `kind`: `'prepaid'` (default) | `'postpaid'`
  - `status`: `'reserved' | 'authorized' | 'captured' | 'released' | 'refunded'`
  - `asaas_payment_id`: id do hold/charge no Asaas (NULL para prepago)
  - `authorized_at`, `captured_at`: timestamps das transições
- **`wallet_transactions`** (novo type): `'escrow_authorize'` | `'escrow_void'` para rastrear holds.

### Princípios

- **Carteira central:** uma conta master Asaas; NÃO há subcontas. Saldo por usuário é só DB.
- **Atomicidade:** todas as operações de escrow (reserve/release/authorize/capture/release_hold/refund) são RPCs Postgres atômicas.
- **Idempotência:** `wallet_transactions` com índice parcial UNIQUE `idx_wallet_tx_unique_reference (wallet_id, reference_id) WHERE reference_id IS NOT NULL` evita crédito duplicado para linhas com `reference_id` preenchido. Postpago usa `reference_id` estável (`job_id:worker_id:attempt_#`) para retry-safe.
- **Taxa de plataforma:** 5% no saque (worker), TBD no escrow (empresa).
- **Coexistência:** prepago e postpago rodam em paralelo por `kind`. Ramificação acontece em `walletService.releaseOrCaptureEscrow(jobId, workerId, kind)`
  que despacha para `asaas-checkout` (prepago) ou `asaas-capture-payment` (postpago).

## Agregados do worker (Slice 4: engajamento)

Campos derivados (`xp`, `level`, `completed_jobs_count`, `earnings_total`) são **recomputados canonicamente** por uma única função Postgres
`recompute_worker_aggregates(worker_id)` (SECURITY DEFINER, search_path='', idempotente).

**Fórmula (XP):** `xp = completed_jobs_count * 100 + profile_bonus`
- `completed_jobs_count` = COUNT de `applications` com `status='completed'` (source de verdade)
- `profile_bonus` = 50 (foto/avatar_url) + 75 (especialidades: primary_role OU roles array) = até +125
- `level` derivado via função `worker_level_for_xp(xp)`
- `earnings_total` = SUM dos budgets dos turnos concluídos (agregado de exibição, não saldo — Article 8 intacto)

**Fontes de chamada:**
1. **Trigger `trg_worker_completion_aggregates` (AFTER INSERT/UPDATE OF status ON applications WHEN status→'completed')** — empresa conclui turno, recomputa do worker.
2. **Cliente via `recompute_my_aggregates()` (SECURITY DEFINER)** — após worker editar foto/especialidades no perfil (mudou bônus).

**Segurança:**
- `recompute_worker_aggregates(uuid)` é SECURITY DEFINER com search_path='', **sem GRANT a PUBLIC/anon/authenticated** — só service_role e trigger interno.
- Cliente acessa via wrapper `recompute_my_aggregates()` (auth-scoped, trabalha sobre `auth.uid()` apenas) — GRANT EXECUTE TO authenticated.
- Landmine corrigido: trigger legado `award_xp_on_job_completion` NÃO era SECURITY DEFINER → quando a empresa concluía o turno, o RLS bloqueava o UPDATE em workers (invoker não tinha permissão na linha do worker) = causa real de "XP não sobe"; **foi removido** e substituído pelo novo que é DEFINER.

## Pagamento agendado (Slice 3: modo A pós-turno)

`shift_payments` (modo A — pagamento externo registrado) ganhou suporte a **agendamento** com status `scheduled` + data prevista.

**Máquina de estados (mesma linha):**
```
INSERT → scheduled (promessa) ──efetivar──► recorded (realizado) ──estornar──► voided
             │                                                                   ▲
             └─────────────────── cancelar ───────────────────────────────────┘
INSERT → recorded (direto legado) ──estornar──► voided
```

**Colunas novas:**
- `scheduled_for date` — data prevista do pagamento (imutável; reagendar = void + novo). NULL em registros diretos (`recorded` sem agendamento prévio).
- `paid_at` — agora **NULLABLE** (era NOT NULL). NULL enquanto `scheduled`; setado **UMA vez** na efetivação (`scheduled→recorded`) e depois imutável. Timestamps reais (nunca data futura disfarçada).

**Dedupe:** UNIQUE parcial `(job_id, worker_id) WHERE status IN ('scheduled','recorded')` = **um marcador ativo por (turno, freela)**, impedindo duas promessas ou promessa+pagamento **do mesmo freela** no mesmo turno. N linhas `voided` permitidas (re-agendar/re-registrar). Turno com N freelas tem N marcadores. ADR-20260816.

**Trigger `enforce_shift_payment_immutability` reescrito:**
- Material columns (job_id, company_id, worker_id, application_id, source, amount, recorded_by, note, created_at, **scheduled_for**) → imutáveis sempre.
- `paid_at` → imutável, EXCETO na única transição permitida: `scheduled→recorded` (NULL→data real, uma vez).
- Transições válidas (só empresa): `scheduled→recorded` (efetivar), `scheduled→voided` (cancelar), `recorded→voided` (estornar). Qualquer outra é rejeitada.
- Partição por papel: empresa efetiva/cancela/estorna; worker só confirma recebimento em `recorded`.

**BI e comprovante:**
- BI de gasto conta **SÓ** `recorded` (promessa ≠ liquidação — `scheduled` não infla gasto).
- `ReceiptView` reutilizável: ramifica por status (scheduled → "Comprovante de Agendamento", recorded → recibo bilateral).
- ZERO impacto em saldo/escrow/RPC — Article 8 intacto.

## Briefing padrão (Slice 3: operação)

`companies.default_briefing` (text, nullable) — a empresa cadastra UMA vez o briefing padrão do negócio (ex.: "calça jeans, barba feita, camisa branca").
Ao criar um turno, pré-preenche o campo Briefing; empresa ajusta/incrementa por turno (ex.: "camisa verde" para estoquista). Simples editável, NÃO toca saldo (Article 8).

## Segurança

- **RLS é a primeira linha de defesa** — filtros no client são só UX. Toda tabela tem políticas por papel.
- **Isolamento de papel** no frontend via `ProtectedRoute` (worker ⇎ company) — espelha o RLS do DB.
- **`service_role` nunca no frontend** — só dentro de Edge Functions (`Deno.env`).
- **CORS:** toda Edge Function trata preflight `OPTIONS`; funções Asaas aceitam origens de prod + local
  (`localhost:5173`).
- **JWT:** `asaas-webhook` e `admin-data` fazem deploy `--no-verify-jwt` (webhook não traz JWT Supabase;
  admin-data tem checagem própria). As demais validam o JWT do gateway.

### SELECT em `workers` restrito por vínculo (Onda 1 — Revisão Piloto)

Migração `20260816120000` substituiu `USING (true)` por `USING (public.can_view_worker_profile(id))`. A tabela `workers` carrega dado sensível
(CPF, telefone, PIX, data de nascimento) — **qualquer conta autenticada podia varrer a base inteira**. A nova policy restringe a leitura a três branches:

1. **Self:** o próprio freela lê a própria linha (Profile, Dashboard, onboarding, Sidebar, etc.). Mantém `select('*')` funcionando.
2. **Vínculo de elenco:** empresa com `team_connections` status `'pending'` ou `'accepted'` com este freela. `'blocked'` (veto do freela) **NÃO** concede leitura.
3. **Vínculo operacional:** empresa que tem `applications` do freela em um turno dela (pull OU push — ambos criam linha). Cobre CompanyJobCandidates, relatório de ordens, BI financeiro, recibos históricos.

**Efeito colateral:** DELETE/UPDATE sob RLS que não casa com USING retorna 0 linhas sem erro, não EXCEPTION. O padrão
`removeFromTeam(workerId)` em `teamConnectionService` exige `.select('id')` (sem `maybeSingle()`) e checa `!data || data.length === 0` para distinguir "removido com sucesso" de "negado por RLS".

**RPC de leitura `get_profile_reviews(reviewed_id, direction)` (migração `20260816130000`):** com a política nova, um freela lendo reviews de uma empresa
(no perfil público da empresa) não conseguia resolver os nomes de freelas que avaliaram — sua policy impedia ler linhas de outros freelas.
`get_profile_reviews` é SECURITY DEFINER e resolve nomes sem expor dados pessoais (mascaramento: "Carlos S." para terceiros, nome completo só para o dono do perfil).

## Notificações de pagamento (Onda 1 — Revisão Piloto, modo A)

O modo A (pagamento externo registrado) é **loop bilateral:** empresa declara pagamento em `shift_payments` e freela confirma recebimento.
Antes, o side do freela nunca era avisado — faltava aviso de "pagamento foi registrado, confirme no recibo". Sem isso, o loop só fecha se freela
abrir `/recebimentos` por conta própria.

**Migração `20260816140000` — função `notify_worker_on_shift_payment()` (SECURITY DEFINER, search_path=''):**
Dispara em 4 eventos distintos via 2 triggers (INSERT e UPDATE):

| Evento | Transição | Título | Link | Mensagem |
|---|---|---|---|---|
| Agendamento | INSERT com status='scheduled' | "Pagamento agendado" | `/recibo/:job_id` | "agendou o pagamento de R$ X para DATA. Você não precisa fazer nada agora." |
| Registro | INSERT com status='recorded' | "Pagamento registrado — confirme" | `/recibo/:job_id` | "registrou o pagamento de R$ X... Abra o recibo e confirme." |
| Efetivação | UPDATE `scheduled→recorded` | "Pagamento efetivado — confirme" | `/recibo/:job_id` | "marcou como pago o valor de R$ X... Abra o recibo e confirme." |
| Estorno | UPDATE `{scheduled\|recorded}→voided` | "Agendamento cancelado" / "Registro estornado" | `/recebimentos` | "cancelou o agendamento" / "estornou o registro"... |

**Por que `/recebimentos` no estorno (não `/recibo/:job_id`):** A rota `getReceipt()` filtra por `status IN ('scheduled','recorded')`;
uma linha `voided` devolveria tela vazia naquele link. Usar `/recebimentos` (lista de pagamentos históricos) oferece contexto útil.

**Por que trigger (não INSERT no client):** A policy vigente permite empresa notificar worker com `team_connections.status='accepted'`,
mas se o freela **sair do Elenco ou bloquear** a empresa depois do turno, o INSERT seria negado silenciosamente — exatamente para quem
tem atrito e mais precisa da trilha. Trigger SECURITY DEFINER não passa por essa RLS, garantindo a notificação.
**Landmark pattern:** notificação à contraparte = garantia do produto, não cortesia da UI — mesmo de `trg_notify_counterpart_on_application_cancel`.

## Rating bidirecional (Slice 1: confiança)

Worker avalia company e vice-versa. Implementado via coluna `reviews.direction` ('worker' | 'company'):
- `direction='worker'` → company avalia worker → atualiza `workers.rating_average/reviews_count` (trigger `update_worker_rating_on_review`)
- `direction='company'` → worker avalia company → atualiza `companies.rating_average/reviews_count` (trigger `update_company_rating_on_review`)

Antes de Slice 1, ambos os reviews iam para a mesma tabela; inferencialmente "o id não existia em workers" era tratado como
empresa, mas sem explicitação. Slice 1 torna direction mandatório e consultável. Trigger `set_review_direction()` (BEFORE INSERT)
auto-preenche direction pela presença do `reviewed_id` em companies/workers, mantendo compatibilidade com clients que não enviam
direction. Backfill resolveu reviews legados (≥2 migrations para worker e company ratings).

## Perfil público da empresa (Onda 1 — Revisão Piloto)

Nova rota **`/empresa/:id`** (`pages/CompanyPublicProfile.tsx`) sob `<MainLayout>` (papel worker), fora de `/company/*`.
Exibe: nome, logo, capa, setor, descrição, endereço, briefing padrão, avaliações recebidas de freelas (via `components/ProfileReviews` com `reviewerRole="worker"`).
**Objetivo:** o freela consegue abrir o perfil da empresa a partir do convite pendente (`InviteTakeover`), da **Carteira de Clientes** (lista de empresas em `team_connections`),
ou do cabeçalho do chat, **antes de aceitar** o convite — assimetria de confiança que equilibra o fluxo push.
Gera prova social: "o que outros freelas disseram sobre esta empresa?" (via `get_profile_reviews` com mascaramento de nomes de avaliadores).

## Guarda de risco de vínculo (F5: configurável por empresa)

> Entrevista 17/08/2026 (sócio de 10 unidades Divino Fogão): operação sabe que a lei pode não gostar de "mesma pessoa, mesma empresa, muitos dias na semana". Feature não bloqueia — avisa. Empresa configura o limite; Worki informa.

**Configuração por empresa:**
- `companies.link_risk_alert_enabled` (boolean, default true) — avisar ou não
- `companies.link_risk_alert_threshold` (integer, default 2, range 1..7) — a partir de quantos turnos na mesma semana

**RPC `count_worker_shifts_by_week` (SECURITY DEFINER, `search_path=''`):**
- Parâmetro: `p_worker_ids uuid[]`, `p_anchor_job_id uuid`, `p_range_start date`, `p_range_end date`
- Devolve: array de `(worker_id, week_start date, shift_count int)`
- Semana corrida: domingo–sábado, data local `America/Sao_Paulo` (não UTC)
- Conta DESTA empresa (ancoragem dupla via `is_job_owner`), NUNCA cross-company (privacidade + produto)
- Exclui soft-deleted (`jobs.status <> 'deleted'`), exclui o próprio turno-alvo se `p_anchor_job_id` fornecido
- **Porquê SECURITY DEFINER:** (1) fuso é pergunta de data local; (2) ancoragem dupla de empresa; (3) SELECT futuro de `jobs` será apertado (Fase 3); (4) F3 reutiliza a mesma RPC para contagem de intervalo

**Componentes de UI:**
- `ShiftCallModal` (F1 — disparo 1→N): aviso em R5 (antes de disparar)
- `InviteSeriesModal` (F3 — série EAGER): aviso na pré-visualização de toda a série + por semana

**Princípio:** avisa, nunca bloqueia. Inserção/update de `applications` prossegue. Erro de leitura (RPC falha) degrada para "sem aviso" + log (never break the feature). ADR-20260818-guarda-vinculo-contagem-no-banco.md.

## Termo de prestação de serviço com aceite eletrônico (F6: modo A pós-turno)

> Entrevista 17/08/2026 (sócio de 10 unidades Divino Fogão, jurista): recibo de pagamento precisa de termo de serviço assinado por ambos para cobrir a empresa juridicamente.

**Tabela `service_terms`:**
- Relação 1:1 com `shift_payments` (FK `shift_payment_id` NOT NULL UNIQUE)
- Campos: `id, job_id, worker_id, company_id` (denormalizados para RLS + snapshot), `shift_payment_id, term_version, term_text, amount` (cópia de `shift_payments.amount`, NÃO SALDO), `accepted_at, accepted_ip, accepted_user_agent, created_at, anonymized_at`
- UNIQUE `(id, job_id, worker_id, company_id)` na parent `shift_payments` para garantir denormalizados casam

**Máquina de estados do termo:**
- Rascunho: `accepted_at IS NULL`, term_text é renderização atual (pode divergir se config mudou)
- Aceite: RPC `accept_service_term` re-renderiza term_text + grava `accepted_at + accepted_ip + accepted_user_agent` **em um UPDATE** (atomicamente)
- Congelado: Depois do aceite, `term_text` é imutável (trigger `enforce_service_term_immutability`, SECURITY DEFINER). Nem service_role consegue mudar.

**Função de renderização `render_service_term_text(p_worker_name text, p_worker_cpf text, p_company_name text, p_company_cnpj text, p_job_title text, p_job_date date, p_amount numeric, p_term_version text)` (SECURITY INVOKER):**
- Monta o texto HTML que o freela lê
- 4 seções: turno (data, hora, local, duração), equipamento/segurança, cláusulas de trabalho, cláusula de não-responsabilidade Worki (congelada no texto)
- Testa conteúdo do worker (CPF, nome) — se missing, texto diz "não informado" (não bloqueia aceite, UI avisa)

**Componente `ServiceTermSection`:**
- Renderiza o termo (ler) + checkbox "Concordo com os termos"
- Quando em `shift_payment.status='recorded'` (pagamento confirmado), libera confirmar recebimento E aceitar termo **no mesmo gesto** (gate de leitura + concordância)
- Implementação: o aceite + confirmação foram desacoplados no DB, acoplados na UI (contrato de UI; ver ADR)

**Princípio:** Aceite e confirmação de recebimento = UX de um gesto (gate de leitura + checkbox), DB de dois eventos (term + shift_payment). Congelar no aceite garante "o que assinaram" é documentado. ADR-20260818-termo-congelado-no-aceite.md.

## Disponibilidade declarada do freela (F7: grade de dias da semana)

> Entrevista 17/08/2026 (sócio de 10 unidades Divino Fogão): "Alguns freelas só trabalham terça a sexta. É informação que muda, que a gente usa pra não convidar em vão."

**Coluna `workers.availability_days` (jsonb):**
- Objeto com chaves `"0"`..`"6"`, **`0` = domingo … `6` = sábado**, e valores subconjunto de `["manha","tarde","noite"]` (máximo 3 períodos por dia)
- Exemplo: `{"1":["manha","tarde"],"2":["noite"]}` = segundas manhã/tarde, terças à noite; `null` = sem restrição
- ⚠️ O rótulo desta linha já dizia "0–6 (segunda–domingo, convenção ISO `getDay()`)" — **errado duas vezes**: `getDay()` não é a convenção ISO (a ISO-8601 é 1=segunda…7=domingo) e começa no **domingo**. O texto se contradizia sozinho, porque o exemplo ao lado tratava `1` como segunda, o que só fecha com `0` = domingo. Fonte da verdade, conferida: `lib/availability.ts:94`, `types/index.ts:10` e o teste canônico `getWeekdayIndex` em `lib/dateUtils.test.ts` (`domingo (2026-09-06) → 0`, `sábado (2026-09-12) → 6`). **Mesma convenção de `job_series.weekdays`** — é justamente para não existir uma segunda convenção de semana concorrente no projeto.
- Validação SQL: CHECK `workers_availability_days_shape` (jsonb_typeof = 'object' + containment + jsonb_array_length ≤ 3 por dia)
- Frontend (`types/index.ts`, `lib/availability.ts`) já implementa corretamente; erro era só da documentação.

**Uso:**
- `ShiftCallModal` (F1) + `InviteSeriesModal` (F3): mostrar badge de indisponibilidade se freela não trabalha naquele dia
- Filtro client (nenhuma RPC): se `jobs.start_date` cai em dia não-permitido, exibir ícone ou desabilitar seleção (UX futura)

**Padrão:** Grade JSONB com validação semântica no banco (CHECK por containment), exibição mascarada no client. Sem consentimento/sem impacto em saldo — é marcação descritiva (Article 8 intacto). ADR-20260821-disponibilidade-grade-jsonb.md.

## Certificações e capacitações (F8: metadados de validação perecível)

> Entrevista 17/08/2026 (sócio fitness): "Freelas treinam internamente. Worki precisa saber quem foi treinado em que, quando vence, quem conferiu." Piloto: só metadado, sem upload.

**Duas tabelas com modelos DIFERENTES — não são simétricas.** A distinção é de autoria: a certificação
é **do freela** (ele declara, uma empresa confere); o treinamento é **da empresa** (ela declara que deu
a um freela dela).

- `worker_certifications`: `id, worker_id, title, issuer, registration_number, issued_at, expires_at,
  verified_by_company_id, verified_at, verified_note, notified_30d_at, notified_expired_at, created_at, updated_at`.
  **Quem confere é a EMPRESA** (`verified_by_company_id → companies`), nunca outro freela.
- `worker_trainings`: `id, company_id, worker_id, title, completed_at, note, created_by, created_at,
  revoked_at, revoked_reason`. Treinamento **não se apaga, se revoga com motivo** — não há policy de
  DELETE nem `GRANT DELETE`.
- **Validade é derivada em query** (`isCertificationExpired`), nunca status congelado que envelhece
  errado com o relógio. Certificação vencida continua visível, marcada.
- **Sem upload de arquivo na v1** (ADR-20260821): o arquivo não compra verdade — a conferência é visual
  sobre o documento original, e o caso crítico do piloto (treinamento interno) não tem documento nenhum.
  Guardar o PDF adicionaria custódia de CPF/foto/assinatura, estrearia o primeiro bucket privado e a
  primeira signed URL, em cima de um `delete-account` já quebrado. Adiar é reversível; adiantar não.
- **Dado de saúde é vetado** (atestado, ASO, exame, vacina, laudo — LGPD art. 5º, II), com cinco defesas:
  ausência de upload, tetos de caracteres, `COMMENT ON TABLE`, item em `debitos-pre-piloto.md` e a copy
  no formulário — a única que fala com a pessoa no momento em que ela digita.

**Guarda `DS8` — congelar conferência de conteúdo antigo (achado F8):**
- Coluna `verified_by/verified_at` zera quando `NEW.* IS DISTINCT FROM OLD.*` (qualquer mudança em conteúdo) — conferência é sobre conteúdo **atual** (descrita em ADR)
- Defesa: âncora em `OLD` (o que está sendo reescrito), não em `NEW` (o que vai se tornar). Padrão: "de quem é o que está sendo destruído?", não "para onde vai?"

**Três furos de RLS que a spec original tinha — TODOS CORRIGIDOS no gate, antes de qualquer código:**

1. **Auto-atribuição de treinamento pelo freela.** A policy proposta (`company_id = auth.uid() AND
   can_view_worker_profile(worker_id)`) era satisfeita por um freela passando o **próprio uuid** como
   `company_id`: `can_view_worker_profile(self)` é true no primeiro ramo, e `is_company_owner` tem o
   mesmo ramo `p_company_id = auth.uid()`. A pessoa se certificaria sozinha — exatamente o que a spec
   declarava impossível.
   **Correção aplicada:** FK `company_id REFERENCES public.companies(id)` (uuid de freela vive em
   `workers`, não lá, então a FK barra antes do CHECK), mais `CHECK (worker_id <> company_id)` e
   `created_by = auth.uid()` na policy `wt_insert_company`.
2. **Ator sem sessão no trigger de UPDATE.** A spec mandava rejeitar "qualquer outro ator", o que
   quebraria o cron de vencimento e o `delete-account` — ambos rodam como service_role com
   `auth.uid()` NULL.
   **Correção aplicada:** ramo (c) explícito para sessão nula, limitado a limpar `verified_*` e marcar
   `notified_*`; nunca cria conferência. `anon` não alcança (sem GRANT, sem policy).
3. **Vazamento entre empresas no SELECT de `worker_trainings`.** Usar `can_view_worker_profile` ali
   responde à pergunta errada: ela diz "posso ver este freela?", não "posso ver este registro?" — a
   empresa B com vínculo próprio leria o treinamento interno da empresa A.
   **Correção aplicada:** `wt_select` usa `worker_id = auth.uid() OR is_company_owner(company_id)` —
   ancorado no registro, não na pessoa.

**Aviso de vencimento:** função `notify_certification_expiries()` (SECURITY DEFINER) + colunas
`notified_*` na própria linha da certificação, agendada por `pg_cron` (`'10 22 * * *'`, degradando com
`RAISE WARNING` se a extensão faltar — mesmo padrão do F4). **Não** há tabela-evento separada de alertas.

**Padrão:** metadado perecível sem arquivo de prova; a conferência é visual sobre o documento original,
e é **do conferente** — só quem conferiu desfaz ou altera (DS8). ADRs:
`ADR-20260821-certificacoes-metadado-sem-arquivo.md`, `ADR-20260821-conferencia-de-certificacao-e-do-conferente.md`.

## Indicação entre empresas (F10: "Já trabalhou com" em loop consentido)

> Entrevista 17/08/2026 (sócio de 10 unidades Divino Fogão): freelas pulam entre empresas do rede própria, trazendo histórico de confiança. A feature autoriza uma empresa **apresentar** um freela a outra.

**Regra central:** empresa **B apresenta** freela **X** a empresa **A**; só o **"sim" do próprio X** cria a conexão em `team_connections`. O uuid de X nunca sai antes do aceite — com ele em mãos, **A teria caminho lateral** para convidar X direto, contornando o consentimento.

**Tabela nova `worker_referrals`:**
- Quem indica (B), para quem (A), e quem (X) são os três pontos
- Status: `awaiting_worker | accepted | declined | cancelled | expired` (SEM `blocked_by_*` de propósito — fatos privados do X colapsam em respostas genéricas)
- Prazo de 14 dias; índice único parcial em `(worker_id, requesting_company_id) WHERE status='awaiting_worker'` evita duplicata pendente
- RLS SELECT-only; INSERT/UPDATE/DELETE exclusivos de RPCs SECURITY DEFINER

**Coluna nova `workers.accepts_referrals` (boolean, default true):**
- Opt-out do freela (R7 da spec). Escrita exclusiva do próprio freela.

**Alteração do CHECK de `team_connections.source`:**
- Ganhou valor `'referral'` (era `qr|link|phone`). O aceite cria a conexão com esse source.

**Veto do freela é indelével:** a guardarama de 20260816000000 (DELETE em conexão bloqueada) se estende para indicação — quatro caminhos (A já bloqueada, freela bloqueia depois, bloqueio nasce entre criação e aceite, aceite tenta escrever por cima) com defesas de trigger (proativa) + lock `FOR UPDATE` (reativa).

**Tetos de anti-abuso (constantes na RPC, ajustáveis sem schema):**
- T1: 20 indicações por empresa indicadora em 24h
- T2: 3 indicações do mesmo par (B, X) em 30 dias
- T3: 5 indicações `awaiting_worker` simultâneas para o MESMO X de TODAS as empresas

**RPCs (SECURITY DEFINER, search_path=''):**
- `create_worker_referral` — B indica X a A; checa veto, opt-out, vinculo, tetos; devolve `{outcome, referral_id}` (nunca lista)
- `accept_worker_referral` — X aceita, cria/promove `team_connections` com `source='referral'`; serializa contra bloqueio
- `decline_worker_referral` — X recusa, NEUTRA (sem penalidade)
- `cancel_worker_referral` — B retira a indicação pendente
- `get_worker_referral_card` — vitrine pré-aceite (projeção fechada de 6 campos, sem uuid)
- `list_worker_referral_cards()` — caixa de entrada de A, SEM parâmetro

**Ciclo de vida:** indicação sobrevive a X sair do elenco de B (gratuidade da recusa); morre se X bloqueia B; CASCADE em deleção de conta.

**Padrão:** Destinatário nunca é enumerado (pool não sai); pré-aceite é vitrine mínima; veto pluralista (trigger + lock serializa).

## SOS — Descoberta de freelas em urgência (F11: alcance 1→N fora do elenco, opt-in)

> Entrevista 17/08/2026 (sócio de 10 unidades Divino Fogão): "Quando preciso rápido, 4 horas, não quero ficar preso ao elenco — quero ligar pra cidade inteira."

**Promessa:** empresa abre turno com `origin='sos'`, RPC calcula pool **internamente**, dispara convites sem entregar a lista.

**Colunas novas:**
- `workers.discoverable_for_sos` (boolean, default false) — opt-in explícito do freela
- `shift_calls.origin` (text, `'team'|'sos'`) — default `'team'`; client só escreve `'team'` (policy), `'sos'` nasce exclusivo de `create_sos_call`
- `shift_call_targets.origin` (text, `'team'|'sos'`) — cópia de `shift_calls.origin` via trigger BEFORE INSERT (denormalizado para evitar recursão de policy 42P17)

**Trigger `sync_shift_call_target_origin` (BEFORE INSERT, SECURITY DEFINER):**
- Copia origin do chamado para o alvo, ignorando o que o cliente mandou. Load-bearing: o WITH CHECK da policy de INSERT avalia após o trigger, sobre o valor real.

**Normalizador `normalize_city(text)** (IMMUTABLE):**
- Trim + lower + translate de acentos (sem extensão `unaccent`). Retorna NULL para vazio — NULL nunca casa com NULL (falha segura em comparação de cidade).

**Três policies reescritas (F1):**
- `shift_calls_insert_company`: client só escreve `origin='team'`
- `shift_call_targets_select`: SOS mostra só os aceitos (`response='accepted'`); team mostra todos
- `shift_call_targets_insert`: client só insere `origin='team'`; alvo de SOS nasce dentro da RPC

**Cota (R10):** 1 SOS aberto + 3 SOS em 7 dias por empresa. **Varredura de expirados ANTES da cota** — chamado vencido trancaria cota permanentemente.

**Pool (R1–R4, R11) — NUNCA devolvido à empresa:**
- Mesma cidade (normalizada)
- Histórico ≥3 turnos
- Avaliação ≥4.0 ou sem avaliação
- Opt-in explícito
- Fora do elenco (em QUALQUER status)
- Sem relação com THIS turno
- Cota por freela: <2 SOS em 7 dias
- Máximo 30; ORDER BY histórico (desempate, não ranking)

**RPCs (SECURITY DEFINER, search_path=''):**
- `sos_call_eligibility(job_id)` — botão deveria aparecer? (STABLE, leitura só)
- `create_sos_call(job_id, reason, message)` — abre chamado, calcula pool, insere alvos e notificações; devolve `{outcome, call_id, targets_count, expires_at}` (**nunca a lista**)

**Lock advisory por DONO** (não por turno) — serializa cotas entre SOS simultâneos de turnos diferentes.

**Janela de urgência:** 4 horas antes do turno (R8.2, não configurável — cada empresa definindo é gatilho da banalização).

**Notificação com consentimento informado** (R4): explica opt-in, explica como desligar. Freela tem DADO para decidir *por que* foi alcançado (não "aleatório").

**Textos em `claim_shift_slot` e `decline_shift_call` ramificados por `origin`** — quem perde a corrida de SOS não entra no elenco (C7 do ADR).

**Padrão:** Pool internamente, vitrine mínima, consentimento explícito, descoberta sem enumeração.

## Badges das empresas (F12: histórico visível, bisturi de privacidade)

> Onda 1 — Revisão Piloto: "Já trabalhou com" = comprovação de confiança. Freela esconde empresa inteira ou por empresa.

**Princípio:** badge é **derivado** de `applications.status='completed'` + `jobs` + `reviews` — **nunca materializado**. Reputação materializada envelhece errado (estorno, LGPD, troca de logo).

**Colunas novas:**
- `workers.badges_hidden` (boolean, default false) — chave-mestra: oculta seção inteira (terceiro recebe ZERO badges; o dono vê todos com `hidden=true` para reverter)

**Tabela nova `worker_company_badge_prefs`:**
- Bisturi (badge por empresa): `(worker_id, company_id, hidden, updated_at)`
- RLS SELECT-only (só o dono lê)
- Sem policy de INSERT/UPDATE/DELETE (toda escrita via RPC DEFINER)

**RPC `get_worker_company_badges(worker_id)** (SECURITY DEFINER):**
- Devolve array derivado com 8 colunas fixas: id/nome/logo da empresa, contagem, data, nota, contagem de notas, hidden
- **NUNCA devolve:** cpf, phone, pix_key, birth_date, email, valor de turno, título de vaga, endereço, CNPJ
- Visível para próprio freela OU para quem passa em `can_view_worker_profile` E `badges_hidden=false`
- Terceiro recebe conjunto vazio (não EXCEPTION — nunca oráculo de existência)
- Dono vê os ocultos com `hidden=true` para poder reexibir
- Ordem **cronológica** — nunca por nota (score/ranking exige ADR próprio, rejeitado em spec)

**RPC `set_worker_badge_visibility(company_id, hidden)** (SECURITY DEFINER):**
- Escrita única da preferência. Requer turno concluído com AQUELA empresa (guard DS3)
- Retorna boolean (não detalhes) — sucesso ou ignorado
- Devolve false sem gravar quando sem histórico
- Idempotente: upsert via ON CONFLICT

**Uso em UI:**
- Página `CompanyBadges` (novo componente, reutilizável). Chips clicáveis toggle hidden.
- Perfil público `/empresa/:id`: badges com logo e contagem — o freela vê prova social antes de aceitar convite.

**Padrão:** Derivado canonicamente, nunca materializado; prefs separadas para reexibição.

## Segurança PII — `uuid` de freela deixa de ser credencial (DS-PII, migração 20260821000300)

**Problema:** `can_view_worker_profile` (20260816120000) concedia leitura de CPF/PIX/data_nascimento para `team_connections.status='pending'` — estado que **a empresa escreve unilateralmente** (`tc_insert_company` só exige ser dona). Conhecer o uuid = ter autorização; uuid virava credencial.

**Três correções (todas BLOQUEANTES):**

1. **DS-PII-1:** `can_view_worker_profile` **perde ramo `'pending'`**. Ficam: (0) self, (1) elenco **ACCEPTED**, (2) vínculo operacional via `applications`. Política: 'pending' = "quero"; 'accepted' = "pode".

2. **DS-PII-2:** `can_view_worker_profile` esvazia o embed `worker:workers(...)` de `listAllConnections` para linhas pending (RLS nega → PostgREST devolve `worker: null`). Cartão fica sem nome. **RPC nova `list_team_connection_cards()`** (SECURITY DEFINER, SEM parâmetro):
   - Projeção FECHADA: id, full_name, avatar_url, primary_role, rating_average, city (**NENHUM PII**)
   - Cobre TODAS as conexões (pending + accepted + blocked)
   - Autorização: ancoragem dupla sobre `auth.uid()`

3. **DS-PII-3:** `get_profile_reviews` entregava `reviewer_id` cru. Com `p_direction='company'`, avaliadores são freelas: nome mascarado ("Carlos S."), mas uuid ao lado — mesma classe de vazamento. **`reviewer_id` passa a sair NULL quando:** avaliador é freela E caller não é o dono do perfil avaliado (MESMO predicado que já mascarava nome). Com `p_direction='worker'` (avaliador é empresa, dado público), segue saindo.

**Padrão:** Identificador nunca é credencial de acesso; consentimento é explícito + bilateral.

## Estado do banco de produção (Onda 1 — Revisão Piloto, atualizado 21/08/2026)

As migrations de F1–F8 + F10–F12 + DS-PII (`20260817000000`–`20260821000300`) estão **escritas e aprovadas**.


> Verificar em produção (`vrklakcbkcsonarmhqhp`) antes de assegurar que o schema atual contém estas mudanças.

Próximas mudanças de schema/RLS/RPC exigem revisão deste estado.

## Estado do banco de produção (Onda 1 — Revisão Piloto)

As migrations da Onda 1 e as de **F1–F8** + **F10–F12** + **DS-PII** e **F13 Fases 0/1/2** foram aplicadas em
produção (`vrklakcbkcsonarmhqhp`). Ver `supabase/migrations/APLICACAO-2026-08-16.md` para: divergência
de timestamp entre repositório e histórico do banco, verificações executadas contra dados reais e
lacunas declaradas.

> ⚠️ **VERIFICADO CONTRA O CATÁLOGO em 22/08/2026** — **Estado de produção é a informação mais difícil de
> manter honesta no memory-bank, porque muda **fora** do repositório: nenhum teste, lint ou build a
> valida. Afirmações abaixo consultam o catálogo** (`information_schema`, `pg_policies`,
> `pg_proc`, `cron.job`) — **não o histórico de migrations e não o relato de quem aplicou.**
>
> **APLICADAS e confirmadas em produção (em 22/08):**
> - `20260817000900` (F5 risco de vínculo), `001100` (F6 termos), `001200` (F7 disponibilidade),
>   `001300` (F8 certificações) — colunas, tabelas e cron conferidos no catálogo.
> - `20260821000100` + `000200` (dívida #9 — `reviews` escopado por vínculo). Exigiu duas
>   tentativas no histórico: as colunas são `uuid` e não `text`, e o `DROP POLICY` era inerte.
>   Hoje `reviews` tem uma única policy de SELECT.
> - `20260821000300` (DS-PII) — `can_view_worker_profile` sem o ramo `'pending'`,
>   `list_team_connection_cards()` DEFINER sem parâmetro, `get_profile_reviews` anulando
>   `reviewer_id` para terceiro. `anon` sem EXECUTE nas três.
> - **`20260817001400` (F12 badges)**, **`001500` (F10 indicação)**, **`001600` (F11 SOS)** — confirmado no catálogo: `worker_company_badge_prefs` existe, `worker_referrals` existe, `workers.discoverable_for_sos` existe, `create_sos_call` existe, `workers.badges_hidden` existe, `workers.accepts_referrals` existe, `shift_calls.origin` existe, `shift_call_targets.origin` existe, CHECK `team_connections_source_check` com `'referral'`, três policies reescritas de F11.
> - **`20260821001000` + `20260822000000` (F13 Fases 0/1/2)** — `organizations`, `organization_members`, `company_members`, `companies.organization_id` NOT NULL, `is_organization_operator`, `is_organization_member`, `company_organization_id`, `session_operates_company_membership`, `autoprovision_company_organization`, `is_company_owner` com corpo BEGIN ATOMIC. Policies `"Company owner can manage jobs"` e `"Company owner can view own company"` foram removidas.
>
> **F13 Fase 3** — **APLICADA** (corrigido em 24/08/2026). As quatro RPCs existem no catálogo
> (`invite_company_manager`, `accept_company_invite_by_token`, `revoke_company_manager`,
> `get_my_companies`) e o fluxo inteiro foi percorrido no browser: convite por e-mail → cadastro
> do gerente → aceite → operação da unidade. A nota anterior dizia "NÃO APLICADA" e me levou a
> concluir, por um dia, que a fiação incompleta do frontend era fase adiada em vez de defeito.
>
> ⚠️ **O papel de gerente só passou a funcionar de fato em 24/08.** Quatro camadas decidiam
> "quem é a empresa?" reescrevendo a pergunta na mão, fora do seam — policy de UPDATE de
> `applications`, trigger `validate_application_update`, trigger
> `enforce_shift_payment_immutability` e dez resolvedores locais no frontend (três com o mesmo
> NOME do seam, `getAuthenticatedCompanyId`, o que faz o grep mentir). Ver migrations
> `20260824000100`–`000300` e o commit `bc43beb0`. Ao mexer em autorização de empresa, a
> pergunta certa é sempre `is_company_owner` / `is_job_owner` / `getAuthenticatedCompanyId` —
> nunca `company_id = auth.uid()` nem `owner_id = auth.uid()` escrito na mão.
>
> **`20260821000000` (anonimização)** — NÃO APLICADA: `anonymize_account` não existe no banco. (Bloqueada por decisão do owner.)
>
> **`service_terms.anonymized_at`** — Coluna **existe**, mas **NÃO VERIFICADO** de qual migration veio; não aparece em histórico visível.
>
> **Ordem de deploy obrigatória:** migration antes do frontend. Coluna que o `select` pede e não
> existe devolve `42703` e derruba a **query inteira**, não só o campo — no F7 isso derrubaria o
> roster do `ShiftCallModal` **e** o salvamento completo do perfil do freela.

Próximas mudanças de schema/RLS/RPC exigem revisão deste estado.

## Dependências externas

| Dependência | Uso | Crítico? |
|---|---|---|
| Supabase | Backend completo (DB, auth, realtime, storage, functions) | Sim |
| Asaas | Pagamentos (PIX/Boleto/Cartão), carteira master | Sim — sem Asaas, sem fluxo financeiro |
| Vercel | Hosting do frontend (`worki-opal.vercel.app`) | Sim — deploy alvo |
| Sentry | Observabilidade de erros | Não — degrada silenciosamente |
| Anthropic / Claude Code | Implementação (orquestrador deste harness) | Não-runtime; só desenvolvimento |

## Pontos de extensão

- **Nova página:** criar em `pages/` (worker) ou `pages/company/` (empresa); registrar rota em `App.tsx`
  sob `ProtectedRoute`; adicionar ao `Sidebar`/`BottomNav` se navegável.
- **Nova tabela:** migration com RLS + (se mexe em saldo) RPC atômica com `GRANT EXECUTE`; atualizar
  `types/index.ts` à mão.
- **Nova operação privilegiada:** nova Edge Function (CORS preflight + validação de auth + Asaas se aplicável).
- **Nova notificação:** inserir em `notifications` (dispara Realtime) ou via `send-notification`.

## Pontos sensíveis (exigem ADR antes de mudar)

- Substituir Supabase por outro backend.
- Reintroduzir qualquer gateway além do Asaas (Stripe foi removido por decisão do owner).
- Adotar subcontas Asaas em vez da carteira central.
- Mudar o contrato das RPCs de escrow ou a constraint de idempotência de `wallet_transactions`.
- Mover lógica privilegiada do Edge Function para o frontend.
- Trocar o modelo de isolamento de papel (worker/company).
- Mudar a direção postpago (Slice 1) para prepago — Slice 2 trata dessa migração.
- Tornar o pagamento pelo Worki **obrigatório** de novo (reabrir postpago/hold como default), criar o marcador
  de pagamento externo, ou a RPC de distribuição PIX-único — ver ADR-20260630 (pagamento opcional no piloto)
  e seus gatilhos de reabertura.
