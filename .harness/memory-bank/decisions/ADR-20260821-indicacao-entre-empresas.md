# ADR-20260821 — Indicação de freela entre empresas: apresentação sem entrega (F10)

## Status

ACEITO (gate de arquitetura, 21/08/2026). Contrato de implementação:
`.harness/spec/troca-freelas/ddl-aprovado.md` — onde este ADR e o `spec.md` divergirem, vale o DDL.

## Contexto

A entrevista de 17/08/2026 (sócio de 10 unidades, Divino Fogão) descreveu um comportamento que **já
existe e não é digital**: gerentes de unidades diferentes trocam freelas de confiança por WhatsApp.
A tese do humano é "já acontece, nós estamos só capturando isso".

Capturar é a parte fácil. O risco é que a captura mude a natureza do ato. Hoje, no WhatsApp, o gerente
manda um contato — informal, sem registro, sem consentimento, mas também **sem a autoridade de uma
plataforma**. Dentro do Worki, o mesmo gesto passa a ter efeito de sistema: se a feature criar vínculo,
liberar dado, ou entregar o identificador do freela para a outra empresa, o produto passa a **afirmar**
que a pessoa é um ativo que circula entre controladores de dado por decisão deles. Isso contradiz:

- `team_connections` (Slice 1): a conexão só vira `accepted` por ação do **freela**.
- Migração `20260816000000` (ADR-20260816-veto-freela-imutavel-delete): o `status='blocked'` é
  **indelével para a empresa** — só quem gravou o bloqueio pode deletá-lo.
- Migração `20260816120000` (ADR-20260816-workers-select-por-vinculo): a linha de `workers`
  (CPF, telefone, PIX, nascimento) só é legível por quem tem vínculo real.
- Article 12 da constitution e a anti-vision do `product.md` ("o Worki não trata gente como recurso").

O gate foi acionado para responder, com rigor de SQL e não de intenção: **o veto sobrevive a este
caminho lateral?** E: **quanto dado pessoal, exatamente, sai para quem ainda não tem vínculo?**

## Decisão

### D1 — O nome é a arquitetura: "indicação", nunca "troca"

Tabela `worker_referrals`, RPCs `create/accept/decline/cancel_worker_referral`, rotas `/indicacoes`.
Nenhuma string de UI, comentário, coluna ou rota usa *trocar, emprestar, ceder, transferir, repassar*.
Não é preferência estética: o vocabulário é a única parte da feature que toda pessoa envolvida lê. Se a
tela disser que uma empresa "empresta" gente, o modelo de consentimento vira teatro em cima de uma
afirmação contrária.

### D2 — A empresa destino não obtém o `worker_id` antes do aceite

Divergência da **R11** da spec, que dava a A leitura RLS da própria linha de `worker_referrals`
inclusive pendente. A linha carrega `worker_id`; de posse do uuid, A executa
`INSERT team_connections(company_id = A, worker_id = X, status = 'pending')` — permitido por
`tc_insert_company`, que só exige ser dona e nascer 'pending'. A partir daí A convida X direto, e o
"sim" que a feature existe para pedir vira opcional. É a definição operacional de "B entregou o freela".

Portanto:
- RLS de A em `worker_referrals`: `status = 'accepted' AND is_company_owner(requesting_company_id)`.
- Pré-aceite, A enxerga a indicação **só** por `get_worker_referral_card(referral_id)` e
  `list_worker_referral_cards()` — que devolvem `worker_id = null` enquanto pendente.

### D3 — A vitrine é uma projeção exaustiva, montada campo a campo

`get_worker_referral_card` devolve **somente** `full_name`, `avatar_url`, `rating_average`,
`reviews_count`, `primary_role`, `roles`, mais metadado não-pessoal da indicação e a identificação
pública da empresa indicadora. Nunca `to_jsonb(w.*)` — construção que faria qualquer coluna futura de
`workers` vazar sozinha, sem revisão. `can_view_worker_profile` **não é alterada** (Out-of-scope da
spec, respeitado).

Nenhuma das duas funções aceita "por qual empresa perguntar": a entrada é o `referral_id` (ou nada) e a
autorização é sempre sobre `auth.uid()`. Precedente explícito: `is_shift_call_target` (F1), que é sempre
sobre `auth.uid()` justamente para não servir de varredura.

### D4 — Toda recusa por fato privado do freela devolve o MESMO outcome

Veto contra A, opt-out (`accepts_referrals = false`), vínculo já existente com A, teto de indicações
abertas e indicação pendente criada por outra empresa colapsam em **`not_available`**. A R3 pedia
resposta genérica só para o veto; um outcome genérico cercado de outcomes específicos não esconde nada —
B descobre o motivo por eliminação. Os outcomes específicos que sobram (`not_in_roster`,
`already_pending` da própria B, `rate_limited`) são fatos que B já enxerga por RLS.

Pelo mesmo motivo, **`blocked_by_veto` não existe como status persistido**: B lê as próprias linhas, e
um status de veto gravado contaria pela tabela o que a RPC esconde na resposta. Toda terminação sem
aceite é `declined`. E a notificação que B recebe é **idêntica** em aceite, recusa e expiração — se o
aceite fosse distinguível, a recusa voltaria a ser inferível.

### D5 — O veto sobrevive por três mecanismos, dois deles redundantes de propósito

1. **Criação:** `create_worker_referral` recusa se existir **qualquer** linha `blocked` do par
   (destino, freela), sem olhar `blocked_by` — fail-closed idêntico ao da `20260816000000`
   (`blocked_by IS NULL` de linha legada também barra). Recusa **antes** de gravar e **antes** de notificar.
2. **Proativo:** trigger `trg_cancel_referrals_on_block` em `team_connections` mata as indicações
   pendentes do freela com aquela empresa (nas duas pontas) no instante em que o bloqueio nasce.
   Ancorado em `OLD.worker_id` / `OLD.company_id` — achado DS8 da F8: quando a pergunta é "de quem é o
   vínculo que está sendo destruído", a resposta honesta está em `OLD`.
3. **Reativo:** `accept_worker_referral` relê `team_connections` com `FOR UPDATE` — a mesma linha que o
   UPDATE de bloqueio toca — e **nunca** escreve por cima de `blocked`. Nada de
   `ON CONFLICT DO UPDATE SET status='accepted'`, que atravessaria a linha bloqueada em silêncio.

O ABBA de ordem de lock entre (2) e (3) é conhecido e aceito: se o victim do deadlock for o trigger, o
bloqueio do freela é gravado (o que não pode falhar) e a defesa reativa segura; se for o aceite, a
transação inteira rola de volta.

### D6 — Tetos de abuso entram agora, não depois do piloto

20 indicações por empresa/24h; 3 por par (B, freela)/30 dias; 5 pendentes simultâneas por freela somando
todas as empresas. O vetor não é "A varre elenco alheio" (A não pede nada dentro do app e precisaria
adivinhar uuids v4), é **B inundar o freela de notificações e distribuir cartões do elenco inteiro**.
O teto por freela devolve `not_available` genérico — o número é fato sobre o freela, não sobre B.

### D7 — Prazo de 14 dias

Sem prazo, uma indicação abandonada ocupa para sempre o índice único parcial e a feature deixa de
funcionar para aquele par sem sintoma legível. Expiração preguiçosa no aceite e na criação, mais
`expire_worker_referrals()` para higiene (só service_role, sem `pg_cron`).

### D8 — Ciclo de vida

Freela **bloqueia** B ou A → indicação pendente morre. Freela **sai do elenco** de B (linha deletada) →
indicação **sobrevive**: é uma declaração datada, feita quando o vínculo existia, e o `expires_at` já
limita sua validade; matá-la daria a B um jeito indireto de retirar a apresentação sem clicar em
"cancelar". Empresa ou freela **deletado** → `ON DELETE CASCADE` (tabela organizacional, não financeira).
Vínculo com A **nasce entre a criação e o aceite** → aceite idempotente (`already_connected`).

## Consequências

### Positivas

- O veto do freela continua sendo o fato mais forte do sistema: nenhum caminho desta feature o
  atravessa, e o caminho lateral (B) é barrado nos três momentos possíveis.
- A empresa destino nunca recebe o identificador do freela sem consentimento — o "sim" do freela deixa
  de ser cerimônia e volta a ser a única porta.
- A superfície de dado pessoal é uma lista fechada de seis campos, revisável de relance, que não cresce
  sozinha quando alguém adicionar uma coluna em `workers`.
- Nenhuma policy existente muda: `can_view_worker_profile`, `tc_*` e as políticas de `workers` ficam
  exatamente como estão. A feature é aditiva.
- Article 8 intacto: nenhuma tabela ou RPC de saldo é lida ou escrita.

### Negativas / Trade-offs

- **A UI de A fica menos "natural":** a caixa de entrada de indicações pendentes não sai de
  `from('worker_referrals')`, sai de uma RPC sem parâmetro. Qualquer pessoa que tentar "simplificar"
  isso reabre o furo — daí LM-1/LM-2 no DDL aprovado.
- **B recebe pouca informação de volta.** Uma indicação que não avança é indistinguível de todas as
  outras que não avançam. É o preço de não construir um oráculo sobre o histórico do freela; do ponto
  de vista de B, é uma feature "quieta".
- **Deadlock possível** (raro) entre bloqueio e aceite simultâneos. Documentado, com fail-safe na
  direção certa, mas é uma linha de log que alguém vai ver um dia.
- **Tetos chutados** (20/3/5) sem dado real; ajustar exige migration (`CREATE OR REPLACE FUNCTION`).
- **Mais uma função DEFINER** na superfície a auditar (seis, contando triggers). Cada uma é pequena e
  ancorada em `auth.uid()`, mas o inventário cresce.
- **`team_connections.source` ganha um valor** — qualquer código que trate a lista `qr|link|phone` como
  exaustiva (BI, filtros de UI) precisa ser revisto.

## Alternativas rejeitadas

- **Estender `team_connections` com um status `'referred'`** em vez de tabela nova: colocaria uma
  proposta de terceiro dentro da tabela que é a fonte da verdade do consentimento, sob o `UNIQUE
  (company_id, worker_id)` — uma indicação para uma empresa que já bloqueou o freela ocuparia a mesma
  linha do veto. Mesmo raciocínio de F1 (tentativa é evento; contrato é linha).
- **Abrir `can_view_worker_profile` para "empresa com indicação pendente"**: transformaria a criação de
  uma indicação — ato unilateral de B — em concessão de leitura da linha completa de `workers` para A,
  desfazendo a `20260816120000`. É Out-of-scope explícito da spec e foi confirmado como tal.
- **Dar a A o `worker_id` pré-aceite "só para exibir o card"**: o uuid não é exibição, é capacidade
  (convite direto via `tc_insert_company`). Ver D2.
- **Outcomes específicos (`blocked_by_veto`, `worker_opted_out`, `already_connected`) como pede a spec**:
  transformam a RPC num oráculo consultável, uma tentativa por vez, sobre o histórico do freela com
  qualquer empresa. Ver D4.
- **Notificar B de forma distinta no aceite** (mais gratificante para quem indicou): torna a recusa
  inferível por eliminação e mata a neutralidade da R6.
- **Deixar anti-spam para depois do piloto** (como a spec sugeria): o alvo do spam é o freela, que é
  quem a feature deveria proteger. Oito linhas de SQL agora, contra uma incidência de suporte depois.
- **Permitir que o aceite levante o bloqueio** (`blocked` → `accepted` num gesto só): tecnicamente é o
  freela agindo sobre o próprio veto, mas transformaria "aceitar uma indicação" no gesto que apaga um
  bloqueio deliberado. Levantar veto continua sendo ato explícito, na tela de bloqueios.

## Referências

- Spec: `.harness/spec/troca-freelas/spec.md`
- DDL aprovado (contrato do builder): `.harness/spec/troca-freelas/ddl-aprovado.md`
- Migration alvo: `supabase/migrations/20260817001400_worker_referrals.sql`
- `ADR-20260816-veto-freela-imutavel-delete.md` — o veto indelével que esta feature não pode contornar
- `ADR-20260816-workers-select-por-vinculo.md` — a policy de `workers` que esta feature não altera
- `ADR-20260817-seam-autorizacao-empresa.md` — o par `is_job_owner` / `is_company_owner`
- Precedentes de código: `decline_shift_call` (recusa neutra), `is_shift_call_target` (função sempre
  sobre `auth.uid()`), `notify_worker_on_shift_payment` (notificação como garantia do produto)
