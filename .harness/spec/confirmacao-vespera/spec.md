# Confirmação de véspera (D-1) — spec

## Context

Entrevista com sócio-operador de 10 unidades do Divino Fogão (17/08/2026): a operação do restaurante começa
às 8h no shopping para abrir às 11h. A quebra de escala é descoberta às 8h30 — "os funcionários não vieram
naquele dia" — e o gerente sai ligando para conhecidos até alguém chegar por volta das 11h. O F1 (Chamado de
Turno, PR #211, `shift_calls`/`shift_call_targets`) já ataca o SINTOMA: preencher rápido depois que a falta
aconteceu (de "2 horas" para "6 minutos", segundo a métrica `first_claim_at` que o próprio F1 grava). Esta
feature ataca a CAUSA: perguntar ao freela já escalado, na véspera, "você confirma amanhã?" — descobrindo o
furo com ~12h de antecedência (à noite, antes de dormir) em vez de 2h30 (de manhã, com o turno já furado).

O freela confirmado (`applications.status IN ('hired','in_progress')`, já contratado — não é mais o convite
em aberto do F1, que tem seu próprio ciclo de aceite/recusa via `claim_shift_slot`/`decline_shift_call`) recebe
um pedido de confirmação um dia antes do turno. Resposta em UM toque. Se ele avisar que não vai poder, a
empresa é notificada AGORA (não às 8h30 do dia seguinte) e tem a noite inteira para reabrir a vaga pelo F1
já existente — as duas features se encaixam: esta gera o alerta antecipado, o F1 já resolvido é o remédio.

O dado que a feature produz (quem confirma, quem não responde, quem confirma e falta) fica gravado no schema
para alimentar o BI de desempenho e o ranking de descoberta futura — não construído aqui, só a base de dados.

## O que já existe (grounding)

- `applications` — colunas de convite já seguem o padrão `invited_by_company_at` / `invitation_response`
  (`'accepted'|'declined'`) / `invitation_responded_at` (migração `20260622000100`). Esta feature segue o
  MESMO padrão de nomenclatura para o par pergunta/resposta, mas em colunas NOVAS e semanticamente distintas
  (confirmação de presença de quem JÁ está contratado, não aceite/recusa de convite).
- `hasAttendedShift` (`frontend/src/services/shiftInviteService.ts`) — predicado único de "o freela já
  compareceu". Não precisa mudar; a confirmação de véspera acontece ANTES de qualquer sinal de presença.
- F1 (Chamado de Turno): `shift_calls`/`shift_call_targets` + RPCs `claim_shift_slot`/`decline_shift_call`/
  `cancel_shift_call` (`supabase/migrations/20260817000100_shift_calls.sql`,
  `20260817000200_shift_call_rpcs.sql`). Padrão de notificação observado e REPLICADO aqui: `type='status_change'`
  mesmo para avisos informativos (não só mudança formal de status), texto de produto acentuado, `link` sempre
  aponta para a tela onde o destinatário resolve a situação (`/my-jobs` para freela,
  `/company/jobs/:job_id/candidates` para empresa).
- `is_job_owner(p_job_id uuid)` (mesma migração do F1) — ancoragem dupla (`jobs.company_id = auth.uid()` OU
  via `companies.owner_id`) já pronta e reaproveitável por esta feature, sem reescrever a lógica.
- `expire-invites` (`supabase/functions/expire-invites/index.ts`) — ÚNICO precedente de job em lote no
  projeto: Edge Function autenticada por `SUPABASE_SERVICE_ROLE_KEY` no header `Authorization`, UPDATE
  idempotente guardado por coluna `IS NULL`, e agendamento (`pg_cron`) deixado como **OPS TODO explícito**,
  não bloqueante para o merge. Esta spec segue o MESMO contrato — não existe cron ativo confirmado no projeto
  hoje; construir a Edge Function e deixar o agendamento como tarefa de ops, documentada, é o padrão já aceito
  aqui (não uma decisão nova desta spec).
- `frontend/src/lib/dateUtils.ts` (`todayLocalDate`, `parseDateOnly`) — existe por causa de um off-by-one de
  fuso já vivido no projeto. "Véspera" é conceito de DATA LOCAL; o lado SQL precisa do equivalente
  (`AT TIME ZONE 'America/Sao_Paulo'`), não `CURRENT_DATE` cru (que é UTC no servidor Postgres do Supabase).
- `frontend/src/pages/MyJobs.tsx` (freela) e `frontend/src/pages/company/CompanyJobCandidates.tsx`
  ("Presença e Pagamento", empresa) são as telas onde esta feature se encaixa — sem tela nova.

## Decisões fixadas (Assumido — sem pergunta ao humano)

1. **Quem dispara e quando (Assumido):** HÍBRIDO — automático via Edge Function em lote +
   botão manual da empresa como reforço/fallback dia-1 (não depende de ops agendar cron para existir):
   - **Automático:** nova Edge Function `request-shift-confirmations` (mesmo contrato de auth/idempotência de
     `expire-invites`), pensada para rodar 1x/dia via `pg_cron` (**Assumido: 18:00 horário de Brasília =
     `21 0 * * *` UTC**, texto sugerido no cabeçalho da função — agendamento real é OPS TODO não-bloqueante,
     mesmo padrão de `expire-invites`). Varre `applications` com `status IN ('hired','in_progress')` cujo
     `jobs.start_date` (convertido para data local `America/Sao_Paulo`) é AMANHÃ e
     `attendance_confirmation_requested_at IS NULL`.
   - **Manual (fallback + lembrete):** botão "Pedir confirmação" em `CompanyJobCandidates`, via RPC
     `request_attendance_confirmation`, disponível também fora da janela D-1 estrita (a empresa pode adiantar)
     e como ÚNICO lembrete extra permitido (ver anti-spam, item 6).
   - Rejeitado explicitamente: opção pura "disparo preguiçoso ao abrir tela" — não notifica quem não abre o
     app, que é exatamente o freela que a feature precisa alcançar (mesmo raciocínio do brief).
2. **Onde mora o estado (Assumido):** colunas NOVAS em `applications` (não tabela própria) — mesma
   granularidade 1:1 (job, freela) do par `invitation_*` já existente; uma tabela própria duplicaria FK/RLS
   sem ganho, e o histórico "confirmou e faltou" já é derivável cruzando estas colunas com `hasAttendedShift`.
   - `attendance_confirmation_requested_at timestamptz` — `NULL` = nunca pedido.
   - `attendance_confirmation_response text` — `NULL` = sem resposta; `'confirmed' | 'cannot_attend'`.
   - `attendance_confirmation_responded_at timestamptz`.
   - `attendance_confirmation_request_count integer NOT NULL DEFAULT 0` — contador de pedidos (cap = 2,
     ver anti-spam).
3. **O que o freela vê, em quantos toques (Assumido):** UM toque = um único tap de botão, sem navegação
   extra. Card destacado no topo de `MyJobs.tsx` (não takeover novo, não modal) com dois botões: "Sim, vou" /
   "Não vou poder", chamando a RPC `respond_attendance_confirmation` direto no clique. A notificação in-app
   linka para `/my-jobs`, onde o card já está visível.
4. **O que a empresa vê (Assumido):** em `CompanyJobCandidates.tsx`, para turnos com confirmação pendente/
   respondida: (a) resumo agregado ("3 confirmados · 1 sem resposta · 1 não vai") no topo da lista de
   candidatos do turno; (b) badge de status por linha de freela (Confirmado / Sem resposta / Não vai); (c)
   quando o status é "Não vai" ou "Sem resposta" perto do turno, um CTA que leva direto ao fluxo já existente
   de Chamado de Turno (F1) para reabrir a vaga — LIGA as duas features, não duplica UI de convite.
5. **Não-resposta ≠ recusa (Assumido, requisito duro):** silêncio na véspera NUNCA muda
   `applications.status`. Nem "não vou poder" muda o status automaticamente — é só um ALERTA; a empresa
   decide manualmente (dispensar via `dismissFromShift` já existente, com suas guardas de pagamento/presença,
   ou simplesmente aceitar o risco). Nenhum trigger novo escreve em `applications.status`.
6. **Anti-spam (Assumido):** `attendance_confirmation_request_count` cap = 2 (1 automático + 1 lembrete
   manual, ou 2 manuais se o automático nunca rodar). O botão manual só fica habilitado quando
   `response IS NULL AND request_count < 2 AND (requested_at IS NULL OR requested_at < now() - interval '6 hours')`
   — cooldown de 6h entre pedidos, mesmo raciocínio de não "metralhar" o freela.
7. **Fuso (Assumido):** `America/Sao_Paulo`, offset fixo UTC-3 (Brasil não tem horário de verão desde 2019 —
   não precisa de lógica de DST).
8. **Tipo de notificação (Assumido):** `type='status_change'` em todos os INSERTs desta feature — replica o
   padrão já usado pelo F1 para avisos informativos que não são literalmente uma mudança de status formal
   (`'Vaga preenchida'`, `'Ninguém aceitou o chamado'`), evitando introduzir `'system'` sem precedente de uso
   real no projeto.

## Requirements

- [ ] R1: Nova migration adiciona a `applications`: `attendance_confirmation_requested_at timestamptz NULL`,
  `attendance_confirmation_response text NULL CHECK (attendance_confirmation_response IS NULL OR
  attendance_confirmation_response IN ('confirmed','cannot_attend'))`,
  `attendance_confirmation_responded_at timestamptz NULL`,
  `attendance_confirmation_request_count integer NOT NULL DEFAULT 0
  CHECK (attendance_confirmation_request_count BETWEEN 0 AND 2)`. Timestamp da migration a definir pelo
  builder, posterior a `20260817000300_team_lists.sql` (em edição paralela).
- [ ] R2: RPC `public.respond_attendance_confirmation(p_application_id uuid, p_response text) RETURNS jsonb`
  — `SECURITY DEFINER`, `SET search_path = ''`. Valida: `auth.uid()` é o `worker_id` da application; status
  atual `IN ('hired','in_progress')`; `attendance_confirmation_requested_at IS NOT NULL` (não responde a algo
  que não foi pedido); `attendance_confirmation_response IS NULL` (imutável após a primeira resposta —
  idempotente em retry/duplo toque); `p_response IN ('confirmed','cannot_attend')`. Em sucesso, grava
  `response`, `responded_at = now()`. Se `p_response = 'cannot_attend'`, insere `notifications` para o owner
  da empresa (mesma resolução `companies.owner_id` já usada em `claim_shift_slot`), `type='status_change'`,
  título contendo "não vai poder", `link='/company/jobs/' || job_id || '/candidates'`. Se `'confirmed'`,
  NENHUMA notificação extra (evita ruído — a empresa lê ao vivo na própria tela). `GRANT EXECUTE TO
  authenticated, service_role`.
- [ ] R3: RPC `public.request_attendance_confirmation(p_application_id uuid) RETURNS jsonb` — `SECURITY
  DEFINER`, `SET search_path = ''`. Disparo MANUAL pela empresa. Valida explicitamente (DEFINER desliga RLS —
  checagem na unha, mesmo padrão de `cancel_shift_call`): `public.is_job_owner(job_id)`; status atual
  `IN ('hired','in_progress')`; `attendance_confirmation_response IS NULL`;
  `attendance_confirmation_request_count < 2`; cooldown `(requested_at IS NULL OR requested_at < now() -
  interval '6 hours')`. Em sucesso, grava `requested_at = now()`, incrementa `request_count`, insere
  `notifications` para `worker_id` (`type='status_change'`, título "Confirma seu turno de amanhã?" ou
  equivalente, `link='/my-jobs'`). Fora das condições acima, devolve `outcome` explicando o motivo
  (`'forbidden' | 'invalid_status' | 'already_responded' | 'limit_reached' | 'cooldown'`) sem gravar nada.
  `GRANT EXECUTE TO authenticated, service_role`.
- [ ] R4: Nova Edge Function `supabase/functions/request-shift-confirmations/index.ts` — mesmo contrato de
  auth de `expire-invites` (header `Authorization: Bearer <SUPABASE_SERVICE_ROLE_KEY>`, CORS preflight
  Article 11). Em lote: seleciona `applications` com `status IN ('hired','in_progress')`,
  `attendance_confirmation_requested_at IS NULL`, cujo `jobs.start_date` convertido para data local
  `America/Sao_Paulo` é a data de amanhã (local). Para cada linha: `UPDATE` com `requested_at = now()`,
  `request_count = 1` (idempotente — filtro `requested_at IS NULL` no `WHERE` impede reprocessar), e insere
  `notifications` em lote para os `worker_id` correspondentes (mesmo formato de R3). NÃO chama a RPC de R3
  (que depende de `auth.uid()` de sessão de usuário, ausente numa chamada service-role em lote) — replica a
  mesma lógica via SQL direto, como `expire-invites` já faz para seu próprio UPDATE em lote. Docstring do
  arquivo documenta o agendamento sugerido (`pg_cron`, `21 0 * * *` UTC = 18h BRT) como OPS TODO explícito,
  não-bloqueante — mesmo texto/padrão do cabeçalho de `expire-invites`.
- [ ] R5: `frontend/src/services/attendanceConfirmationService.ts` (novo arquivo, mesmo estilo de
  `shiftCallService.ts`): `respondAttendanceConfirmation(applicationId, response)` chamando a RPC de R2;
  `requestAttendanceConfirmation(applicationId)` chamando a RPC de R3. Tratamento de erro no padrão do
  projeto (`logError`, retorno estruturado `{ success, error? }`/`outcome`).
- [ ] R6: `frontend/src/types/index.ts` — `Application` ganha os 4 campos opcionais de R1
  (`attendance_confirmation_requested_at?`, `attendance_confirmation_response?`,
  `attendance_confirmation_responded_at?`, `attendance_confirmation_request_count?`). Coordenar com a edição
  paralela em curso neste arquivo (adicionar, não sobrescrever).
- [ ] R7: `frontend/src/pages/MyJobs.tsx` — card destacado, um toque, para applications com
  `status IN ('hired','in_progress')`, `attendance_confirmation_requested_at IS NOT NULL`,
  `attendance_confirmation_response IS NULL`, e turno futuro. Dois botões ("Sim, vou" / "Não vou poder") cada
  um chama `attendanceConfirmationService.respondAttendanceConfirmation` direto (sem modal/navegação
  intermediária). Após resposta, o card não mostra mais os botões — passa a exibir um badge de status
  (Confirmado / Avisou que não vai). Mobile-first, neo-brutalista (Article 13).
- [ ] R8: `frontend/src/pages/company/CompanyJobCandidates.tsx` — (a) resumo agregado de confirmação por
  turno (contagem de confirmados / sem resposta / não vão, sobre as applications `hired`/`in_progress` do
  job); (b) badge de status de confirmação por linha de freela; (c) CTA visível para "Não vai"/"Sem resposta"
  que leva ao fluxo já existente de Chamado de Turno (F1) para reabrir a vaga; (d) botão "Pedir confirmação"
  por freela, habilitado/desabilitado conforme as condições de R3 (desabilitado com texto explicando o
  motivo — limite atingido ou cooldown — quando aplicável).
- [ ] R9: Nenhum requisito desta spec grava, atualiza ou lê `wallets`, `escrow_transactions`,
  `wallet_transactions` ou `shift_payments`. Article 8 intacto — nenhuma RPC de saldo é chamada.
- [ ] R10: Nenhum requisito desta spec altera `applications.status` automaticamente — nem por
  não-resposta, nem por `'cannot_attend'`. A única forma de o turno mudar de status continua sendo os
  fluxos já existentes (`dismissFromShift`, check-in/checkout, `claim_shift_slot`/`decline_shift_call` do F1).

## Acceptance criteria

- [ ] A1: Dado um job com `start_date` = amanhã (data local `America/Sao_Paulo`) e uma application com
  `status='hired'` e `attendance_confirmation_requested_at IS NULL`, quando a Edge Function
  `request-shift-confirmations` roda, então a application recebe `attendance_confirmation_requested_at = now()`
  e `attendance_confirmation_request_count = 1`, e uma linha em `notifications` é inserida para o
  `worker_id` com `type='status_change'`, título sobre confirmar o turno de amanhã e `link='/my-jobs'`.
- [ ] A2: Dado que essa mesma application já tem `attendance_confirmation_requested_at` preenchido, quando a
  Edge Function roda de novo (reexecução/retry), então nenhuma nova notificação é criada para essa
  application e nenhuma coluna muda (idempotência via filtro `requested_at IS NULL`).
- [ ] A3: Dado o freela em `/my-jobs` vendo o card de confirmação pendente, quando toca em "Sim, vou", então
  a RPC `respond_attendance_confirmation` grava `attendance_confirmation_response='confirmed'` e
  `attendance_confirmation_responded_at=now()`, NENHUMA notificação extra é criada, e o card troca os botões
  por um badge "Confirmado" sem navegação adicional.
- [ ] A4: Dado o mesmo cenário, quando o freela toca em "Não vou poder", então
  `attendance_confirmation_response='cannot_attend'`, `attendance_confirmation_responded_at=now()`, e uma
  linha em `notifications` é criada para `companies.owner_id` do job com `type='status_change'`, título
  contendo "não vai poder" e `link='/company/jobs/<job_id>/candidates'`.
- [ ] A5: Dado que o freela já respondeu (`attendance_confirmation_response` preenchido), quando chama
  `respond_attendance_confirmation` de novo (duplo toque/retry), então a RPC devolve um `outcome` indicando
  resposta já registrada e NÃO sobrescreve `response`/`responded_at` (resposta imutável após a primeira).
- [ ] A6: Dado um freela que nunca respondeu à confirmação de véspera, quando chega a hora do turno, então
  `applications.status` permanece `'hired'`/`'in_progress'` — nenhum processo desta feature move o status
  para `'cancelled'`/`'declined'` por ausência de resposta.
- [ ] A7: Dado `/company/jobs/:id/candidates` de um turno de amanhã com 5 freelas confirmados (3 responderam
  `'confirmed'`, 1 respondeu `'cannot_attend'`, 1 sem resposta), quando a página carrega, então exibe o
  resumo "3 confirmados · 1 sem resposta · 1 não vai" e cada linha de freela mostra o badge correspondente.
- [ ] A8: Dado um freela com badge "Não vai" ou "Sem resposta" na tela de candidatos, quando a empresa olha
  essa linha, então um CTA visível leva ao fluxo já existente de Chamado de Turno (F1) para reabrir a vaga
  daquele turno.
- [ ] A9: Dado uma application `hired` com `attendance_confirmation_request_count=1`, `response IS NULL` e
  `requested_at` há mais de 6 horas, quando a empresa clica "Pedir confirmação" em `CompanyJobCandidates`,
  então a RPC `request_attendance_confirmation` roda com sucesso, `request_count` vira 2, `requested_at`
  atualiza para agora, e uma nova notificação é criada para o `worker_id`.
- [ ] A10: Dado a mesma application agora com `request_count=2`, quando a empresa tenta pedir confirmação de
  novo, então a RPC devolve `outcome='limit_reached'` sem gravar nada, e o botão "Pedir confirmação" aparece
  desabilitado na UI com o motivo (limite atingido).
- [ ] A11: Dado uma empresa que NÃO é dona do job (`is_job_owner` falso), quando tenta chamar
  `request_attendance_confirmation` para uma application desse job, então a RPC devolve
  `outcome='forbidden'` e nenhuma coluna muda (checagem explícita dentro do `SECURITY DEFINER`, RLS
  desligada por definição).
- [ ] A12: Dado um worker que NÃO é o `worker_id` da application, quando tenta chamar
  `respond_attendance_confirmation` para essa application, então a RPC devolve um `outcome` de negação
  (ex.: `'not_target'`/`'forbidden'`) e nenhuma coluna muda.
- [ ] A13: `cd frontend && npm run build` e `cd frontend && npm run lint` passam sem erro após a
  implementação (Article 3).

## Out-of-scope

- Agendar o `pg_cron` de verdade (só o TODO documentado no cabeçalho da Edge Function, mesmo padrão de
  `expire-invites`) — tarefa de ops, fora do código desta entrega.
- Qualquer alteração automática de `applications.status` a partir da resposta de confirmação (nem por
  silêncio, nem por `'cannot_attend'`) — a empresa decide manualmente via fluxos já existentes.
- Nova tela/takeover para a resposta do freela — reaproveita card em `MyJobs.tsx`, sem componente de tela
  nova.
- Expandir ou alterar `shift_calls`/`shift_call_targets`/RPCs do F1 — esta feature só LINKA para o fluxo já
  existente, não modifica seu contrato.
- Push nativo fora do app / SMS — só notificação in-app (Realtime já existente via `NotificationContext`) e,
  no máximo, o link/CTA de WhatsApp já existente (`buildShiftInviteWhatsAppMessage`), sem estendê-lo aqui.
- Dashboard/relatório de BI de "taxa de confirmação por freela" — o dado fica gravado no schema (colunas de
  R1) para uso futuro; nenhuma tela de relatório nova é construída nesta entrega.
- Qualquer leitura/escrita em `wallets`, `escrow_transactions`, `wallet_transactions`, `shift_payments`.
- Multi-unidade/gerente (F3) — fora do escopo, `is_job_owner` já é o ponto único de costura para quando
  entrar.

## Clarifications log

- Q (implícita, item 1 do brief): quem dispara e quando? → A (Assumido): híbrido — Edge Function em lote
  D-1 (agendamento real = OPS TODO, mesmo padrão não-bloqueante de `expire-invites`) + botão manual da
  empresa como fallback/lembrete, evitando depender de alguém agendar cron para a feature funcionar dia-1.
- Q (implícita, item 2): onde mora o estado? → A (Assumido): 4 colunas novas em `applications`, replicando o
  padrão de nomenclatura já usado para `invitation_*`.
- Q (implícita, item 3): UI do freela em quantos toques? → A (Assumido): card em `MyJobs.tsx`, um tap por
  botão, sem tela/modal novo.
- Q (implícita, item 4): o que a empresa vê e o que faz a partir dali? → A (Assumido): resumo + badges em
  `CompanyJobCandidates.tsx`, com CTA que abre o Chamado de Turno (F1) já existente — as duas features se
  encaixam, nenhuma duplica a outra.
- Q (implícita, item 5): não-resposta vs recusa? → A (Assumido, requisito duro R10): nenhuma automação muda
  `applications.status`; silêncio e "não vou poder" são só sinal/alerta, decisão final é manual da empresa.
- Q (implícita, item 6): anti-spam? → A (Assumido): cap de 2 pedidos por application (automático + 1
  lembrete manual) com cooldown de 6h entre pedidos.
