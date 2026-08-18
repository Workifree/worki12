# ADR-20260817 — Confirmação de véspera: log de evento próprio + agendamento como artefato versionado

## Status

ACEITO (2026-08-17) — gate de migration da feature F4 "Confirmação de véspera (D-1)"
(`.harness/spec/confirmacao-vespera/spec.md`, R1/R4).

Substitui as decisões 2 e 1 da seção "Decisões fixadas" da spec (4 colunas em `applications`;
agendamento como OPS TODO não-bloqueante).

## Contexto

A F4 pergunta ao freela já contratado, na véspera, se ele confirma o turno. A spec fixou duas
decisões que este gate reverte.

**(a) Onde mora o estado.** A spec escolheu quatro colunas em `applications`
(`attendance_confirmation_requested_at` / `_response` / `_responded_at` / `_request_count`),
justificando pela cardinalidade 1:1 e pela simetria com o par `invitation_*` de
`20260622000100`. Três fatos contradizem a justificativa:

1. A própria spec cria um **contador de pedidos** (`_request_count`, cap 2) e um **cooldown de 6h**
   medido sobre `_requested_at`. Contador e cooldown são agregados sobre uma sequência de eventos.
   A relação não é 1:1 com a application, é 1:N comprimida em duas colunas; o segundo pedido
   sobrescreve o `requested_at` do primeiro e o tempo de resposta ao primeiro pedido deixa de
   existir.
2. **`applications` tem `GRANT SELECT, INSERT, UPDATE ... TO authenticated` no nível de TABELA**
   (`20260317150000`), e as policies de UPDATE (`20260311100000`, `20260317160000`) não restringem
   coluna. Toda coluna nova nasce **gravável pelo client**: o freela pode setar o próprio
   `_requested_at`, reescrever `_response` quantas vezes quiser e zerar `_request_count` com uma
   chamada PostgREST direta. As guardas de idempotência, cap e cooldown das RPCs viram decorativas
   a menos que `validate_application_update` ganhe um bloco de imutabilidade para as quatro colunas
   (padrão `enforce_shift_payment_immutability`) — trabalho que a spec não previu.
   Nota: por serem grants de tabela e não de coluna, o achado da F2 sobre `GRANT UPDATE (coluna)`
   ser aditivo **não** se aplica; o problema aqui é o oposto e mais grave.
3. Escrever em `applications` faz disparar `trg_validate_application_update` (BEFORE UPDATE), cujo
   `v_is_company` usa ancoragem **simples** (`EXISTS(SELECT 1 FROM jobs WHERE id=NEW.job_id AND
   company_id=auth.uid())`), enquanto a autorização da RPC usaria `is_job_owner` (ancoragem
   **dupla**). Para uma empresa ancorada por `companies.owner_id`, a RPC autorizaria e o trigger
   derrubaria com `EXCEPTION 'Usuario nao autorizado a atualizar esta candidatura'`. Também
   dispararia `trg_notify_counterpart_on_application_cancel` e `trg_auto_reserve_escrow_on_hire` a
   cada pedido de confirmação (ambos saem cedo hoje, mas passam a estar no caminho quente de uma
   feature que roda em lote toda noite).

O precedente correto não é `invitation_*`: é `shift_call_targets`, criado **um dia antes** por
`20260817000100`, cujo cabeçalho já resolveu a mesma pergunta com as mesmas palavras — "guardar as
tentativas (inclusive as perdidas) é o que permite medir tempo de resposta e taxa de aceite por
freela". Confirmação de véspera é a mesma classe de dado: tentativa, não contrato.

**(b) Como a coisa roda.** A spec propõe uma Edge Function `request-shift-confirmations` no
contrato de `expire-invites`, com `pg_cron` como OPS TODO não-bloqueante, apresentando isso como
"padrão já aceito no projeto". Verificação do repositório: **não existe nenhum agendador**
(`cron.schedule` não aparece em migration alguma; `vercel.json` não tem `crons`; os dois workflows
do GitHub são CI e deploy). `expire-invites` não é um padrão aceito — é uma função que nunca rodou.
E `20260817000200` (F1, mesma semana) **rejeitou** explicitamente esse caminho: *"Expiração
preguiçosa: quem chega atrasado fecha o chamado. Sem cron, sem job agendado."*

Sem agendador, a F4 se reduz ao botão manual, e a promessa de produto — descobrir o furo 12h antes
em vez de 2h30 — passa a depender de o gerente lembrar de apertar um botão na véspera, que é
exatamente o comportamento que a feature existe para substituir.

Fato adicional: a varredura D-1 é **100% SQL** (`applications` + `jobs` + `notifications`). Não há
chamada a API externa. Pela tabela de decisão do harness ("chamada a API externa → Edge Function;
lote/reação no banco → Postgres"), a Edge Function aqui é uma camada de transporte que só existe
para dar ao cron um endereço HTTP — e que obrigaria a guardar a `service_role` key em algum lugar
para o cron poder chamá-la.

## Decisão

1. **Tabela-evento `public.shift_attendance_confirmations`, uma linha por PEDIDO**, com
   `application_id`/`job_id`/`worker_id` (os dois últimos denormalizados de colunas imutáveis, para
   as policies não dependerem de join), `source ('auto'|'manual')`, `requested_by`, `requested_at`,
   `response ('confirmed'|'cannot_attend')`, `responded_at`. **Zero coluna nova em
   `applications`.** `request_count` = `count(*)`; cooldown = `max(requested_at)`; "confirmou e
   faltou" = `response='confirmed'` cruzado com `hasAttendedShift`; latência de resposta preservada
   por pedido.

2. **RLS só de leitura.** Policies de SELECT (`worker_id = auth.uid() OR is_job_owner(job_id)`),
   `GRANT SELECT` para `authenticated`, e **nenhuma** policy/grant de INSERT/UPDATE/DELETE — toda
   mutação passa por função `SECURITY DEFINER`, exatamente como `shift_calls`/`shift_call_targets`.
   A máquina de estados fica em um lugar auditável e não há superfície de escrita pelo client.

3. **R10 (nenhuma automação altera `applications.status`) passa a ser verdade estrutural**, não
   política: nenhum objeto desta feature escreve em `applications`. Mesmo argumento com que
   `claim_shift_slot` provou Article 8 pelo caminho de INSERT.

4. **A notificação do PEDIDO vai por trigger `AFTER INSERT` `SECURITY DEFINER`; a notificação da
   RESPOSTA fica inline na RPC.** A regra é o número de escritores, não o papel do destinatário:
   o pedido tem dois caminhos de escrita (RPC manual da empresa + varredura em lote) e o texto de
   produto não pode existir em duas cópias — `20260816201322` (acentos perdidos no transporte) é a
   cicatriz. A resposta tem um único escritor (a RPC do freela), então o trigger não compraria
   garantia nenhuma e criaria um problema real: com dois pedidos abertos, um trigger por linha
   emitiria duas notificações para um único "não vou poder".

5. **O agendamento é artefato versionado, em migration própria**
   (`2026081700080_..._cron.sql`): `cron.schedule('shift-attendance-confirmations-d1','0 21 * * *',
   $$SELECT public.request_attendance_confirmations_due();$$)` — 21:00 UTC = 18:00 BRT. O bloco é
   guardado por `IF EXISTS (SELECT 1 FROM pg_extension WHERE extname='pg_cron')` para não quebrar
   `supabase db reset`/CI, e a migration falha ruidosamente com `RAISE WARNING` quando pula. **Não
   existe Edge Function nesta feature.** O cron chama a função SQL diretamente; nenhuma chave de
   serviço trafega.

6. **Fuso em um lugar só.** Toda função da feature declara `SET search_path = ''` **e**
   `SET timezone = 'America/Sao_Paulo'`, e a data local de um turno é sempre
   `start_date::timestamptz::date` (correta para `date` e para `timestamptz`, que é o que a
   varredura precisa já que `jobs` não é definida por migration neste repo).

## Consequências

### Positivas

- O log de confirmação começa a acumular no dia 1. É o insumo do BI de desempenho e do ranking de
  descoberta que as specs F1 e F4 já citam; histórico não se reconstrói retroativamente.
- Nenhuma coluna nova gravável pelo client em `applications`; nenhum trigger existente entra no
  caminho quente; `validate_application_update` não precisa ser alterada.
- A varredura D-1 fica em SQL testável (`SELECT public.request_attendance_confirmations_due();` em
  qualquer sessão de service_role), sem Deno, sem CORS, sem key.
- Um objeto a menos para deployar: a feature inteira sobe com `supabase db push`.
- Idempotência da varredura garantida por índice (`UNIQUE (application_id) WHERE source='auto'`),
  não por convenção de `WHERE ... IS NULL` — duas execuções simultâneas não duplicam notificação.

### Negativas / Trade-offs

- **Mais um objeto de banco** (tabela + 2 policies + 4 índices + 1 trigger) contra 4 colunas. O
  custo real recai sobre `MyJobs` e `CompanyJobCandidates`, que ganham uma consulta a mais cada.
  Aceitável no padrão do projeto (Article 5, `useState`/`useEffect` com múltiplos selects).
- **A leitura deixa de ser "vem junto com a application"**. Quem no futuro quiser exibir o estado de
  confirmação numa listagem já existente precisa lembrar de buscar a tabela. Mitigação: o serviço
  `attendanceConfirmationService` expõe um único `getConfirmationsForJob(jobId)` /
  `getMyPendingConfirmations()`, e é ali que a regra vive.
- **`pg_cron` vira dependência operacional de produção.** Se a extensão não estiver habilitada no
  projeto `vrklakcbkcsonarmhqhp`, a migration do item 5 pula com WARNING e a feature degrada para o
  botão manual — o mesmo destino que a spec original tinha, mas agora **visível no log de aplicação**
  em vez de escondido num comentário TODO. Verificar antes de aplicar:
  `SELECT extname FROM pg_extension WHERE extname='pg_cron';` e depois
  `SELECT jobname, schedule, active FROM cron.job;`.
- **A tabela cresce sem retenção definida.** Ordem de grandeza no piloto: ~1-2 linhas por
  (turno × freela). Não é problema no horizonte visível; fica registrado que não há política de
  expurgo (e não deve haver enquanto o dado alimentar ranking).
- **`ON DELETE CASCADE`** de `application_id`/`job_id` apaga o log junto com o turno. É a escolha
  consistente com `shift_calls` (`20260817000100`), e o log perde sentido sem o turno — mas é uma
  perda de auditoria assumida, não um descuido. `shift_payments` (financeiro) continua sendo a
  tabela onde CASCADE é proibido.

## Landmines pós-implementação

- **L11 (security-reviewer, 18/08/2026): `job_is_active(uuid)` é `SECURITY DEFINER`, não
  `INVOKER` — de propósito, apesar de `jobs` ter SELECT `USING (true)` para `authenticated` hoje
  (o que tornaria INVOKER "suficiente" na superfície).** `request_attendance_confirmations_due`
  roda via `pg_cron` **sem sessão** (`auth.uid()` é `NULL`). Se `job_is_active` fosse INVOKER, o
  resultado do predicado passaria a depender de como a policy de SELECT de `jobs` trata um
  contexto sem sessão — hoje indiferente (`USING (true)` não olha `auth.uid()`), mas o
  `ADR-20260816-rls-desligada-jobs-conversation.md` **planeja apertar esse SELECT na Fase 3**
  via `can_view_job(uuid)`. Quando isso acontecer, um `job_is_active` INVOKER passaria a devolver
  `false` para tudo dentro da varredura noturna — a feature morre em silêncio (zero pedido
  criado, zero erro, zero log), e o sintoma ("ninguém recebe confirmação de véspera") aparece
  meses depois, longe da causa. **Quem for implementar `can_view_job(uuid)` precisa saber que
  `job_is_active` é um consumidor sem sessão de `jobs`** — não presumir que toda leitura de
  `jobs` acontece dentro de uma request autenticada. Não há custo de segurança na escolha:
  `job_is_active` devolve só um booleano de "existe e não foi soft-deletado" — nenhum conteúdo de
  `jobs` vaza pela troca de INVOKER para DEFINER.

- **L12 (evaluator, mutation testing, 18/08/2026): a varredura D-1, como especificada acima
  (decisão 5) e no `ddl-aprovado.md`, não tinha guarda de cap nem de resposta já dada.** Dois
  cenários reais quebravam a promessa da feature:
  1. Empresa já usa os 2 pedidos manuais (cap atingido, cooldown de 6h respeitado nos dois) → o
     cron de D-1 inseria uma 3ª linha `'auto'` e disparava uma 3ª notificação — cap furado.
  2. Freela já respondeu (`confirmed`/`cannot_attend`) a um pedido manual anterior → o cron
     perguntava de novo em D-1, e o card de confirmação **reaparecia** em `MyJobs` como se a
     resposta nunca tivesse existido. É o pior sinal possível numa feature cujo produto inteiro
     é "a empresa confia na resposta do freela".

  Fix aplicado em `20260817000700` (função `request_attendance_confirmations_due`): o `WHERE` da
  varredura ganhou `AND NOT EXISTS (... response IS NOT NULL ...)` (nunca re-perguntar quem já
  respondeu, qualquer source) e `AND (SELECT count(*) ... ) < 2` (nunca ultrapassar o cap total
  de pedidos por application). Escolha deliberada: `count(*) < 2` — o MESMO predicado de cap já
  usado em `request_attendance_confirmation` — em vez de "excluir toda application que já teve
  QUALQUER pedido manual" (alternativa mais simples, mas mais restritiva: barraria o cron mesmo
  quando a empresa usou só 1 dos 2 pedidos manuais, contrariando R3 — "a empresa pode adiantar" o
  pedido manual antes da janela D-1). `count(*) < 2` trata `'auto'` e `'manual'` simetricamente:
  o teto é por application, não por origem do pedido — que é a leitura mais fiel de R6 ("cap = 2,
  1 automático + 1 lembrete manual, OU 2 manuais se o automático nunca rodar").

## Alternativas rejeitadas

- **4 colunas em `applications` (proposta da spec):** destrói silenciosamente o histórico de
  pedidos, nasce gravável pelo client, obriga a estender `validate_application_update` com
  imutabilidade de 4 colunas, e coloca a divergência de ancoragem simples/dupla no caminho de uma
  rotina noturna. Cada um desses é contornável; juntos custam mais SQL do que a tabela.
- **Híbrido (colunas como read-model + tabela como log):** dois lugares para a mesma verdade, com
  a obrigação de mantê-los sincronizados por trigger. Preço alto por uma consulta a menos na tela.
- **Edge Function + `pg_cron` chamando HTTP via `pg_net`:** exige a `service_role` key guardada no
  banco (Vault ou, pior, em texto na definição do job) para uma operação que não sai do Postgres.
  Aumenta a superfície de credencial sem comprar nada.
- **Manter o TODO de ops e mergear assim mesmo:** entrega a UI de uma feature cuja promessa
  ("descobrir o furo na véspera") não é cumprida por nenhum código do PR. É a definição de feature
  nascendo morta; o piloto atribuiria o silêncio ao produto, não à configuração ausente.
- **Expiração/pedido preguiçoso ao abrir a tela (padrão F1):** funciona para F1 porque quem chega
  atrasado é o próprio interessado. Aqui o alvo é o freela que **não** abre o app — a spec já
  rejeitou isso com o argumento certo, e este ADR concorda.

## Referências

- Spec: `.harness/spec/confirmacao-vespera/spec.md` (R1, R2, R3, R4, R10)
- Precedente de tabela-tentativa: `supabase/migrations/20260817000100_shift_calls.sql` (cabeçalho
  "POR QUE TABELAS NOVAS")
- Precedente de "sem cron, sem job agendado": `supabase/migrations/20260817000200_shift_call_rpcs.sql`
- Grant de tabela em `applications`: `supabase/migrations/20260317150000_fix_applications_companies_rls.sql`
- Ancoragem simples de `validate_application_update`:
  `supabase/migrations/20260622000300_invite_accept_hired_transition.sql`
- Ancoragem dupla e por que existe: `supabase/migrations/20260816210000_enable_rls_jobs.sql`,
  `ADR-20260816-rls-desligada-jobs-conversation.md`, `ADR-20260817-seam-autorizacao-empresa.md`
- Notificação da contraparte como garantia: `ADR-20260816-notificacao-contraparte-por-trigger.md`
- Perda de acentos em transporte de texto de produto: `supabase/migrations/20260816201322_*.sql`
- Constitution Article 8 — **intacto**: nenhuma tabela ou RPC de saldo/escrow é lida ou escrita.
