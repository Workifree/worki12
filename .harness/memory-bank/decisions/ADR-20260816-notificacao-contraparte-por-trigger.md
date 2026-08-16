# ADR-20260816 — Notificação à contraparte é garantia do banco (trigger), não cortesia do client

## Status
ACEITO

## Contexto

O piloto roda 100% no **modo A** (ADR-20260630): a empresa monta o Elenco, convida o freela para o
turno (push), confere presença, **paga por fora** (PIX/dinheiro) e **registra** no Worki, que emite o
recibo. O contrato de valor do modo A é um **loop bilateral**: a empresa DECLARA, o freela CONFIRMA
(`shift_payments.worker_confirmed_at`). Sem a confirmação do freela, o recibo é uma declaração
unilateral da empresa — exatamente o que o piloto existe para superar.

A revisão pré-piloto encontrou **dois buracos no mesmo eixo: o freela não é avisado de nada que a
empresa faz.**

**Buraco 1 — pagamento.** Rastreado ponta a ponta: não há `INSERT` em `notifications` em
`paymentRecordService.ts`, não há trigger em `20260630000000_shift_payments.sql` nem em
`20260712000000_shift_payment_scheduled.sql`, não há edge function. O freela só descobre que foi pago
(ou que a empresa prometeu pagar dia X, ou que o registro foi estornado) se abrir `/recebimentos` por
conta própria. O loop bilateral não fecha.

**Buraco 2 — a empresa desfaz.** A revisão adicionou `cancelInvite` (`invited → cancelled`) e
`dismissFromShift` (`hired | in_progress → cancelled`) em `shiftInviteService`. O freela perde a diária
com que contava e não recebe aviso: o item só some da tela na próxima abertura do app.

**Correção do diagnóstico levado ao gate.** A causa-raiz apontada — *"a policy de INSERT em
`notifications` é `WITH CHECK (auth.uid() = user_id)`, então a empresa não consegue notificar o
freela"* — **está desatualizada**. Essa policy (`20260623000200`) foi **substituída** por
`20260702000000_notifications_notify_counterpart.sql`, que já permite notificar a **contraparte** quando
existe `team_connections.status = 'accepted'` nas duas direções. Prova viva: `shiftInviteService`
insere hoje, pelo client, a notificação de convite para o `workerId` (linha 286) e ela funciona em
produção. Ou seja: **o INSERT pelo client é possível**; a decisão abaixo não é forçada por RLS, é uma
escolha de garantia.

**Achado adicional (bug latente já em produção).** `trg_notify_company_on_worker_cancel`
(`20260714000000`) dispara em `NEW.status='cancelled' AND OLD.status IN ('hired','in_progress')` **sem
olhar quem cancelou**, e sempre notifica a empresa com o texto "Turno cancelado pelo freela". Mas a
**empresa** também produz essa transição hoje: `CompanyJobDetails.tsx:106` e `CompanyJobs.tsx:426`
cancelam as applications ativas ao excluir/encerrar o turno — e `dismissFromShift` fará o mesmo.
Resultado atual: a empresa recebe "Fulano cancelou o turno" logo depois de **ela mesma** ter cancelado,
e o freela — o único prejudicado — não recebe nada.

## Decisão

**Toda notificação de contraparte nesses dois eixos passa a ser emitida por trigger `SECURITY DEFINER`
no Postgres, nunca pelo client.**

### 1. Pagamento — `20260816140000_notify_worker_on_shift_payment.sql`

Uma função (`public.notify_worker_on_shift_payment()`) e **dois triggers** sobre `shift_payments`
(um `AFTER INSERT`, um `AFTER UPDATE` — o `WHEN` de um trigger de INSERT não pode referenciar `OLD`).
Quatro fatos distintos, quatro mensagens distintas:

| Evento | Título | Ação do freela | Link |
|---|---|---|---|
| `INSERT status='scheduled'` | Pagamento agendado | nenhuma (é promessa) | `/recibo/<job_id>` |
| `INSERT status='recorded'` | Pagamento registrado — confirme | confirmar recebimento | `/recibo/<job_id>` |
| `UPDATE scheduled → recorded` | Pagamento efetivado — confirme | confirmar recebimento | `/recibo/<job_id>` |
| `UPDATE → voided` | Agendamento cancelado / Registro estornado | procurar a empresa | `/recebimentos` |

Um trigger só de `INSERT` **não bastaria**: a efetivação (`scheduled → recorded`) é um `UPDATE` e é
o momento em que o freela de fato precisa confirmar. `type='payment'` (valor válido no CHECK de
`notifications.type`, com ícone e filtro próprios em `Notifications.tsx`).

O estorno aponta para `/recebimentos`, **não** para `/recibo/<job_id>`: `getReceipt()` filtra
`status IN ('scheduled','recorded')` e devolveria `NULL` para uma linha estornada — o link do recibo
levaria a uma tela vazia.

### 2. Cancelamento — `20260816150000_notify_counterpart_on_application_cancel.sql`

Uma função (`public.notify_counterpart_on_application_cancel()`) e **um** trigger `AFTER UPDATE` sobre
`applications`, com `WHEN (NEW.status='cancelled' AND OLD.status IN ('invited','hired','in_progress'))`,
que **substitui** `notify_company_on_worker_cancel` (dropado nesta migration). Ramifica por **ator**:

| Ator (`auth.uid()`) | Notifica | Texto |
|---|---|---|
| `= NEW.worker_id` | empresa | "Turno cancelado pelo freela" (comportamento de 20260714, preservado) |
| `= jobs.company_id` | freela | "Convite de turno cancelado" (de `invited`) ou "Turno cancelado pela empresa" (de `hired`/`in_progress`) |
| `NULL` (service_role / cron / `delete-account`) | **ambos** | "Turno cancelado" — texto neutro, sem atribuir culpa |

**`auth.uid()` funciona dentro de trigger `SECURITY DEFINER`**: `SECURITY DEFINER` troca o *role* de
execução, não as claims do JWT (que vivem no GUC `request.jwt.claims`, lido por `auth.uid()`).
Precedente no próprio projeto: `validate_application_update` (20260622000300) e
`enforce_shift_payment_immutability` (20260630000000) são ambas `SECURITY DEFINER` e particionam por
papel com `auth.uid()`. **Nenhuma coluna `cancelled_by` é necessária** — e ela seria pior, pois
dependeria do client preencher honestamente quem cancelou.

O ramo `'system'` existe porque `delete-account` (service_role) cancela applications ativas dos dois
lados. Silenciar seria regressão (hoje a empresa é avisada quando o freela apaga a conta); atribuir a
alguém seria mentira. Notificar os dois com texto neutro é a única saída honesta.

### 3. Invariantes preservadas

- **Article 8 intacto**: nenhuma RPC de saldo criada/alterada, nenhum `UPDATE` em `wallets` ou
  `escrow_transactions`. Notificação não move dinheiro.
- **Article 9 não se aplica**: `notifications` não é tabela financeira.
- Nenhuma policy, constraint, transição de status ou GRANT é alterado. Só funções e triggers.
- Todas as funções: `SECURITY DEFINER` + `SET search_path = ''` + objetos schema-qualificados +
  `EXCEPTION WHEN OTHERS THEN RETURN NEW` (best-effort).
- **Nenhum trigger de DELETE** é criado (lição do gate anterior): `shift_payments` tem FKs
  `ON DELETE RESTRICT` e nenhuma policy de DELETE; `delete-account` faz `UPDATE`, não `DELETE`, em
  `applications`. O bloco `EXCEPTION` garante que nada aqui pode abortar o apagamento de conta (LGPD).
- Todos os links apontam para rotas existentes em `App.tsx` (`/recibo/:jobId`, `/recebimentos`,
  `/my-jobs`, `/company/jobs/:id/candidates`). Nenhuma referência a `/wallet` ou `/company/financeiro`,
  removidas na Onda 2.

### 4. Idempotência

Sem dedupe explícito — e ele seria **errado** aqui:

- As colunas materiais de `shift_payments` são imutáveis e a máquina de estados é one-way
  (`scheduled → recorded → voided`, `voided` terminal). Cada transição ocorre no máximo uma vez por
  linha ⇒ **exatamente uma notificação por fato real**.
- "Editar" um pagamento é `void` + **nova linha** — fato novo, que **deve** notificar de novo (há um
  novo registro a confirmar). Dedupe por `link` (padrão do `spendLimitService.evaluateSpendAlert`)
  suprimiria justamente esse caso legítimo, e no cancelamento colidiria entre turnos distintos da mesma
  empresa (o link `/my-jobs` é o mesmo para todos).
- Em `applications`, reentrar em `'cancelled'` exigiria sair de `'cancelled'` antes — nenhum fluxo do
  produto faz isso.

## Consequências

### Positivas
- O loop bilateral do modo A **fecha sozinho**: o freela é sempre puxado ao recibo, com Realtime
  (`NotificationContext` escuta `postgres_changes` em `notifications`) e sino, sem abrir tela por conta.
- Nenhum lado consegue suprimir o aviso da contraparte — é garantia do banco, não da UI.
- Funciona mesmo sem `team_connections` viva: se o freela sair do Elenco ou **bloquear** a empresa depois
  do turno, a policy `notifications_insert_self_or_connected` negaria o INSERT pelo client; o trigger não
  passa por RLS. Justamente quem já tem atrito é quem mais precisa da trilha do recibo.
- Corrige o bug de atribuição já em produção (empresa notificando a si mesma com texto falso) e, de
  quebra, faz o freela ser avisado quando a empresa **exclui/encerra o turno inteiro**
  (`CompanyJobDetails`, `CompanyJobs`) — caminho que ninguém havia coberto.
- Um só lugar para auditar/ajustar a política de aviso (4 call sites de pagamento viram 0 no client).

### Negativas / Trade-offs
- **O texto das notificações passa a viver em SQL.** Mudar copy exige migration. Aceito: são 7 mensagens
  curtas e estáveis; a alternativa (tabela de templates) é desproporcional ao piloto.
- **Acoplamento a `auth.uid()` no trigger.** Se algum fluxo futuro cancelar via edge function com
  `service_role` em nome de um usuário específico, cairá no ramo `'system'` e notificará os dois lados.
  Documentado; mitigável depois com um GUC de ator, se surgir o caso.
- **Um `EXCEPTION WHEN OTHERS` engole erros de notificação em silêncio** (padrão já adotado em
  20260714). Uma falha sistemática de INSERT seria invisível. Aceito para o piloto: bloquear um
  pagamento ou um apagamento de conta por causa de um aviso seria pior.
- **Duas notificações no fluxo agendado** (agendou, depois efetivou). É intencional — são fatos
  diferentes — mas soma volume no sino de quem trabalha muito.
- `DROP FUNCTION notify_company_on_worker_cancel` torna o rollback dependente de reaplicar
  `20260714000000` na íntegra (documentado no `-- DOWN` da migration).

## Alternativas rejeitadas

- **INSERT no client (`paymentRecordService` / `shiftInviteService`)**: tecnicamente possível hoje
  (policy `notifications_insert_self_or_connected`), mas depende de um vínculo de equipe **vivo** — o
  aviso some justamente quando o freela bloqueia a empresa; replica lógica best-effort em 4+ call sites;
  e trata como cortesia de UI o que o produto vende como garantia.
- **Edge function (Deno + service_role)**: bypassa RLS igual, mas adiciona latência, CORS, chave e um
  ponto de falha de rede para uma operação puramente intra-banco. Reservado a chamadas externas (Asaas).
- **Alargar a policy de INSERT de `notifications` para `applications`/`shift_payments`**: aumentaria a
  superfície de spam user→user sem resolver o caso do freela que bloqueou a empresa.
- **Coluna `cancelled_by` em `applications`** para identificar o ator: exige confiar no client, precisa
  de backfill e de guarda de imutabilidade própria. `auth.uid()` no trigger é a fonte da verdade e já é
  o padrão do projeto.
- **Um único trigger `AFTER INSERT` em `shift_payments`**: perderia a efetivação (`scheduled → recorded`),
  que é um `UPDATE` e é o evento mais importante para o freela.
- **Segundo trigger empilhado sobre `applications`, preservando o de 20260714**: `WHEN` sobreposto, busca
  duplicada de `jobs`/`workers` e o bug de atribuição do trigger antigo permaneceria vivo.
- **Notificar também a empresa quando o freela confirma o recebimento**: fecharia o círculo, mas não é
  bloqueador do piloto (a empresa vê o estado na tela do turno). Fora de escopo — reabrir se o piloto
  mostrar que a empresa perde a confirmação.

## Gatilho de reabertura

Revisar esta decisão se qualquer um ocorrer:

1. **Volume/ruído**: freelas do piloto reclamarem de excesso de notificações → agrupar
   (ex.: uma por turno, não por transição) ou introduzir preferências por canal.
2. **Copy virar produto**: mais de duas mudanças de texto em um mês → mover mensagens para tabela de
   templates ou para `send-notification` (edge function).
3. **Canal externo**: quando WhatsApp/e-mail entrar como canal obrigatório do aviso de pagamento, o
   trigger deixa de bastar (precisa sair do banco) → avaliar `pg_net`/fila + edge function consumidora.
4. **Ator não resolvível**: se algum fluxo legítimo passar a cancelar via `service_role` em nome de um
   usuário, trocar a heurística de ator por um GUC explícito (`set_config('app.actor_id', ...)`).
5. **Falha silenciosa observada**: se aparecer suspeita de notificação perdida, o `EXCEPTION WHEN OTHERS`
   precisa virar log (tabela de erro ou `RAISE WARNING` capturado), não silêncio.

## Referências

- Spec: `.harness/spec/revisao-piloto/spec.md`
- ADR-mãe do modo A: `.harness/memory-bank/decisions/ADR-20260630-pagamento-opcional-piloto.md`
- Migrations criadas: `supabase/migrations/20260816140000_notify_worker_on_shift_payment.sql`,
  `supabase/migrations/20260816150000_notify_counterpart_on_application_cancel.sql`
- Migration substituída: `supabase/migrations/20260714000000_notify_company_on_worker_cancel.sql`
- Policy de INSERT vigente: `supabase/migrations/20260702000000_notifications_notify_counterpart.sql`
- Tabela e máquina de estados: `supabase/migrations/20260630000000_shift_payments.sql`,
  `supabase/migrations/20260712000000_shift_payment_scheduled.sql`
