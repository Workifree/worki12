# ADR-20260817 — Escala recorrente: geração EAGER e cancelamento SUAVE (nunca DELETE)

## Status

ACEITO (2026-08-17) — gate de migration da feature "Escala Recorrente / Bloco de Cobertura"
(`.harness/spec/escala-recorrente/spec.md`, R1/R2/R3/R7/R11).

Não substitui, mas **precisa** o gatilho de `ADR-20260817-seam-autorizacao-empresa.md` (seção
"Decisão", item 3) — ver "Decisão", ponto 5 abaixo.

## Contexto

A entrevista de 17/08/2026 (sócio-operador, 10 unidades) mostrou que o volume dominante de freela é
**programado** (cobertura de folga dominical semanal, bloco de férias), não emergencial. O F1
(Chamado de Turno) atende a emergência; a recorrência é o que gera uso semanal. A spec propõe um
registro-mãe `job_series` que materializa N linhas de `jobs`.

Três perguntas de reversibilidade difícil precisavam de resposta antes de qualquer DDL:

**(a) Eager vs. lazy.** Materializar as ocorrências como `jobs` reais na criação, ou gerar sob
demanda? Eager custa até 60 linhas por série e edição em massa; lazy custaria ensinar toda leitura de
`jobs` a expandir séries.

**(b) O que "cancelar a série" faz com o histórico.** A spec diz "EXCLUI (mesmo mecanismo do botão
'Excluir' de hoje, RLS `jobs_delete_company_owner`)". **Isso é factualmente incorreto** e a
verificação do código foi o achado decisivo deste gate: o botão "Excluir" de hoje
(`CompanyJobs.handleDelete:382` e `CompanyJobDetails.tsx:136`) executa
`UPDATE jobs SET status = 'deleted'` — um **soft delete**. A policy `jobs_delete_company_owner`
existe, mas **nenhum caminho de produto a exerce**. Se a F3 tivesse implementado o DELETE literal
que a spec descreve, teria estreado o primeiro DELETE real de `jobs` do produto — em lote de até 60
linhas — com estas consequências de cascata, todas silenciosas:

| FK para `jobs(id)` | Ação | Efeito de um DELETE |
|---|---|---|
| `shift_calls.job_id` (20260817000100) | `ON DELETE CASCADE` | apaga o chamado e, por cascata, `shift_call_targets` — incluindo `first_claim_at`, a métrica de ROI do produto ("de 2 horas para 6 minutos") |
| `escrow_transactions.job_id` (001) | `ON DELETE CASCADE` | apaga a linha de escrow **sem devolver saldo**: `reserve_escrow` debita `wallets.balance` e grava a linha; sumindo a linha, o dinheiro fica debitado sem contrapartida no razão |
| `shift_payments.job_id` (20260630000000) | `ON DELETE RESTRICT` | o DELETE falha com erro de FK — o lote inteiro aborta se **uma** ocorrência já tiver recibo |

**(c) Fuso horário.** `jobs.start_date` é `timestamptz`, mas a ocorrência de uma série é
conceitualmente uma **data local**. O projeto já tem cicatriz disso: `lib/dateUtils.ts` existe, com
comentários, por causa do off-by-one entre 21h e 23h59 em BRT, e `CompanyCreateJob.handleSubmit:187`
usa o truque do meio-dia (`new Date(d + 'T12:00:00').toISOString()`) **inline, em cópia única**.
Recorrência é o lugar mais fácil do mundo para criar a segunda cópia e divergir.

## Decisão

**1. Geração EAGER — confirmada, com reenquadramento do papel de `job_series`.**

O argumento decisivo não é o custo de reescrever `groupJobsByDay`. É que **lazy é impossível neste
schema**: no instante em que uma ocorrência é convidada, ela precisa existir como linha de `jobs`,
porque `shift_calls.job_id`, `applications.job_id` e `shift_payments.job_id` são FKs para `jobs(id)`.
Lazy não evita a materialização — só a adia para dentro de um caminho concorrente (dois freelas
recebendo o mesmo convite materializam a mesma ocorrência duas vezes) e obriga a manter **dois**
caminhos de leitura para sempre. Lazy = eager + uma corrida + um caminho duplicado.

O reenquadramento que fecha a pergunta "o que acontece com `jobs.slots`/`budget` quando a série é
editada depois": **`job_series` é um molde e um registro de auditoria, não o dono das ocorrências.**
Depois da geração, cada `jobs` é canônico e autônomo. Editar a série **não é uma operação suportada** —
`job_series` é imutável exceto por `status`, garantido por `GRANT UPDATE (status)` (privilégio de
coluna, precedente `team_lists` em 20260817000300). Não existe, portanto, propagação série→ocorrências;
existe uma operação de UPDATE em massa sobre `jobs` que por acaso usa `series_id` como seletor. A
classe inteira de bugs de sincronização molde↔instância é eliminada por construção, não por disciplina.

**2. Cancelar/excluir é SEMPRE `status = 'deleted'` — nunca DELETE.**

A F3 reusa o soft delete que já existe, e reusa **o mesmo valor** `'deleted'` (não inventa
`'cancelled'`), porque os filtros `.neq('status','deleted')` já estão espalhados
(`CompanyJobs.tsx:308`, `orderReportService.ts:251`). Um status novo vazaria para toda lista que
ainda não o conhece.

Consequência: nenhuma cascata é exercida, `first_claim_at` sobrevive, o razão de escrow sobrevive,
e o `RESTRICT` de `shift_payments` nunca aborta o lote. `jobs.series_id` recebe `ON DELETE SET NULL`
(nunca CASCADE) e `job_series` **não ganha policy de DELETE** — a série para, não some.

**3. Predicado único de "ocorrência tocável", e ele é mais estreito do que a spec.**

A spec define "sem freela ativo" como ausência de `applications` em `hired|in_progress|completed`.
Isso deixa dois furos:

- Ocorrência com convite **pendente** (`applications.status = 'invited'`) seria cancelada em massa
  enquanto o freela ainda vê o convite vivo.
- Ocorrência com `shift_calls.status = 'open'`: `claim_shift_slot` (20260817000200) **não verifica
  `jobs.status`** — verificado linha a linha. Um freela pode reivindicar vaga de um turno já
  cancelado e sair `hired` de um turno que não existe mais.

Fica valendo, para edição em massa **e** para cancelamento em massa, um único predicado:

```
series_id = X
AND status = 'open'
AND series_occurrence_date >= <hoje local>
AND NOT EXISTS (applications a WHERE a.job_id = jobs.id
                  AND a.status IN ('invited','applied','accepted','hired','in_progress','completed'))
AND NOT EXISTS (shift_calls sc WHERE sc.job_id = jobs.id AND sc.status = 'open')
```

O mesmo predicado também resolve o risco de `slots`: baixar `slots` numa ocorrência que já tem
posições ocupadas quebraria o invariante do F1 ("o chamado fecha quando preenchidas ≥ slots").
Ocorrências com qualquer vínculo não-terminal simplesmente não são tocadas em massa.

**4. As três operações de massa são RPC, não idas e voltas do client.**

`create_job_series` (INVOKER), `update_job_series_future` (DEFINER) e `stop_job_series` (DEFINER).
Motivos, nesta ordem de peso:

- **Corrida check-then-act.** Fazer "lê candidatas → filtra no client → UPDATE por lista de ids"
  abre uma janela em que um freela aceita entre a leitura e a escrita, e o turno recém-preenchido é
  cancelado. Com até 60 linhas por gesto, a janela não é teórica.
- **O predicado-guarda não pode depender de RLS.** As duas operações de massa precisam ver
  **todas** as `applications`/`shift_calls` da ocorrência para decidir se ela é tocável. A policy
  "Companies can view applications for their jobs" ancora só em `jobs.company_id = auth.uid()`
  (âncora simples), enquanto `job_series`/`jobs` usam ancoragem **dupla**. Numa empresa ancorada por
  `companies.owner_id`, uma `applications` invisível faria o `NOT EXISTS` retornar verdadeiro e o
  turno com freela seria cancelado. Predicado de segurança lido sob RLS **falha aberto** — por isso
  as duas são `SECURITY DEFINER` com checagem explícita de `is_company_owner` no topo (padrão de
  `claim_shift_slot`).
- **Os contadores dos critérios A5/A6** ("N turnos não foram alterados porque...") saem do
  `RETURNING`, sem uma segunda contagem que pode divergir.

`create_job_series` fica **INVOKER** de propósito: ela só insere linhas do próprio chamador, as
policies `jobs_insert_company_owner` e `job_series_insert` já cobrem o caso, e INVOKER falha fechado.
A superfície privilegiada nova da feature é de duas funções, não três.

**5. `is_job_owner` / `is_company_owner`: NÃO unificar aqui. O gatilho era outro.**

`ADR-20260817-seam-autorizacao-empresa` agendou a unificação "para a migration de F3, onde as duas
mudam juntas de qualquer forma" — e ali "F3" significava **multi-unidade/gerente**, não "a terceira
feature da fila". Esta feature é a terceira da fila e se chama F3, mas o `Out-of-scope` da própria
spec diz, textualmente, "Multi-unidade/gerente — fora de escopo do produto hoje". A colisão de nome
é a armadilha; a condição do contrato é **"a regra de autorização de empresa muda"**, e ela não muda
aqui: `job_series` ancora na empresa e consome `is_company_owner(company_id)` verbatim, sem tocar
nenhuma das duas funções.

Unificar agora significaria reescrever, a dias do piloto, uma função da qual dependem quatro policies
de `shift_calls`/`shift_call_targets` e a RPC `cancel_shift_call`, por ganho funcional zero.

Registra-se, porém, o **mecanismo** que resolve a objeção que bloqueou a delegação — para que a
próxima passagem não reabra a discussão do zero. A objeção era: corpo de função SQL escrito como
string (`AS $$ ... $$`) não registra dependência no catálogo, então `DROP FUNCTION is_company_owner`
quebraria `is_job_owner` em runtime, em silêncio. **Corpo SQL padrão (`BEGIN ATOMIC ... END`, PG14+)
é parseado no CREATE e registra a dependência**: com ele, o `DROP` passa a falhar com
"cannot drop ... because other objects depend on it", que é exatamente a proteção que faltava. A
unificação, quando o gatilho real ocorrer, deve usar `BEGIN ATOMIC`.

O gatilho fica reescrito assim, para não depender de ordinal: **a migration que alterar a regra de
autorização de empresa (multi-unidade/gerente, papel de gerente, ou qualquer terceira âncora além de
`company_id = auth.uid()` e `companies.owner_id`)** deve alterar as duas funções juntas e unificá-las
com `BEGIN ATOMIC`.

**6. Fuso: a data local é a fonte da verdade; `start_date` é derivado.**

- `job_series.range_start_date` / `range_end_date`: `date`.
- `jobs.series_occurrence_date`: **`date`** — não `timestamptz`, não `text`. É a identidade da
  ocorrência, estável, independente do fuso de quem lê, e é a chave do índice único que impede
  duplicação por duplo-clique.
- `jobs.start_date` (`timestamptz`) continua sendo o que a agenda lê, e é **derivado** da data local.
- A conversão mora em **exatamente dois lugares, com uma convenção só** — âncora de meio-dia:
  - **Client:** a aritmética de datas (iterar dias, casar dia-da-semana) é uma função **pura** em
    `lib/recurrence.ts`, que devolve `string[]` de `YYYY-MM-DD` e é testável com data de referência
    injetada (precedente: `groupJobsByDay(jobs, referenceDate)`). Usa componentes locais
    (`getDay()`, `setDate()`), nunca `getUTC*` nem `toISOString().split('T')[0]`.
  - **Banco:** a RPC converte `date` → `timestamptz` com
    `(d::text || ' 12:00:00')::timestamp AT TIME ZONE 'America/Sao_Paulo'`. Meio-dia dá ±3h de
    folga: qualquer fuso brasileiro cai no mesmo dia civil.
  - A cópia inline de `CompanyCreateJob.handleSubmit:187` é **extraída** para
    `dateUtils.localDateToTimestamp(dateStr)` e a página passa a usá-la. Sem isso, a feature cria a
    segunda cópia do truque do meio-dia e o off-by-one volta pela porta dos fundos.
- Invariante verificável, que vira teste: para toda ocorrência,
  `parseDateOnly(job.start_date)` cai no mesmo dia civil de `job.series_occurrence_date`.

**7. Cap de 60: defesa em profundidade real.**

Um `CHECK (occurrences_generated <= 60)` em `job_series` não defende nada — o client escreve o valor.
A defesa é um **trigger de statement** em `jobs` (`REFERENCING NEW TABLE`), que conta as linhas reais
por `series_id` após cada INSERT. Statement-level (não row-level) porque o INSERT do lote é um
statement só: uma contagem por gesto, não sessenta. `SECURITY DEFINER` para que a contagem não
dependa da RLS de `jobs` (relevante quando a Fase 3 apertar o SELECT de `jobs`).

## Consequências

### Positivas

- `groupJobsByDay`, `CompanyJobs`, `CompanyJobCandidates`, o convite direto, o Chamado de Turno (F1),
  o recibo do modo A e o BI continuam operando sobre `jobs` puro, sem uma linha de mudança.
- Nenhuma cascata de FK é exercida: `first_claim_at`, `escrow_transactions` e `shift_payments`
  sobrevivem a qualquer cancelamento, individual ou em massa.
- O índice único parcial `(series_id, series_occurrence_date) WHERE series_id IS NOT NULL AND
  status <> 'deleted'` impede DUAS ocorrências no MESMO dia DENTRO DA MESMA série (datas
  duplicadas no mesmo lote de `create_job_series`). Mesmo formato do UNIQUE parcial de
  `shift_payments` (ADR-20260816).
  **Correção (revisão pós-implementação, F3):** a formulação original desta linha dizia que o
  índice "torna a criação resistente a duplo-clique" — isso é FACTUALMENTE INCORRETO e foi
  removido daqui. `create_job_series` cria um `job_series` NOVO (id gerado por `gen_random_uuid()`)
  a cada chamada; duas submissões idênticas (duplo-clique) geram DUAS séries com `series_id`
  diferentes, e o índice — chaveado por `(series_id, series_occurrence_date)` — nunca colide
  entre séries distintas. Resultado real de um duplo-clique: 2 séries e 2N turnos, sem erro
  nenhum. A proteção contra duplo-clique hoje é só de UI (`disabled={loading}` no botão de
  submit) — ver `20260817000400_job_series.sql` para o texto corrigido e a análise completa.
- `job_series` imutável por privilégio de coluna elimina a classe de bugs molde↔instância sem
  trigger de imutabilidade (mais barato que `enforce_shift_payment_immutability`).
- Zero contato com `wallets`, `escrow_transactions`, `wallet_transactions`, `shift_payments` ou
  qualquer RPC de saldo — **Article 8 e Article 9 intactos** (ver "Verificação" abaixo).

### Negativas / Trade-offs

- **Até 60 linhas de `jobs` por gesto.** A agenda da empresa (`CompanyJobs`) e o
  `CompanyDashboard` passam a poder receber dezenas de turnos idênticos. `CompanyDashboard` hoje nem
  filtra `status='deleted'` (não tem `.neq`), então uma série cancelada continuaria visível lá — a
  correção desse filtro passa a ser obrigatória junto com a feature. O agrupamento visual por série
  na agenda fica como dívida de UI declarada.
- **Deriva molde↔instância é permitida de propósito.** Depois da geração, editar uma ocorrência
  isolada faz ela divergir do que `job_series` registra. É o comportamento correto (a ocorrência é
  canônica), mas significa que `job_series` **não** pode ser usado como fonte para reconstruir a
  série. Ele é histórico do que foi pedido, não do que existe.
- **Uma série = um horário.** O índice único por `(série, dia)` impede duas ocorrências no mesmo dia
  dentro da mesma série. Empresa que precise de turno de manhã e de noite no mesmo dia cria duas
  séries. Aceito: é o modelo da spec (um único `work_start_time` por série).
- **Duas funções `SECURITY DEFINER` novas** para auditar. Mitigado por checagem explícita de
  `is_company_owner` na primeira linha das duas e por `REVOKE ... FROM PUBLIC, anon`.
- A ancoragem dupla continua divergindo de `applications` (âncora simples). Esta ADR contorna o
  sintoma (usando DEFINER nas RPCs de massa) em vez de saldar a dívida — que segue agendada para a
  migration de multi-unidade, junto com a unificação do par de helpers.

## Alternativas rejeitadas

- **Geração lazy / série virtual:** impossível de manter pura — `shift_calls`, `applications` e
  `shift_payments` têm FK para `jobs(id)`, então convidar já obriga a materializar. Entrega a corrida
  de materialização concorrente e o caminho de leitura duplo, sem eliminar o custo que motivou a
  escolha.
- **`DELETE` real nas ocorrências ao cancelar a série:** destrói `first_claim_at` por cascata (a
  métrica que prova o ROI do F1), apaga linha de `escrow_transactions` sem devolver saldo, e aborta o
  lote inteiro no `RESTRICT` de `shift_payments`. Além de não ser o que o botão "Excluir" de hoje faz.
- **Status novo `'cancelled'` para ocorrência de série cancelada:** todo `.neq('status','deleted')`
  existente deixaria a linha passar. Um valor, um filtro.
- **Trigger de imutabilidade em `job_series`** (padrão `enforce_shift_payment_immutability`):
  `GRANT UPDATE (status)` obtém o mesmo resultado sem objeto novo. O trigger só se justifica quando há
  transição condicional a validar — aqui não há.
- **Cap por `CHECK` em `job_series.occurrences_generated`:** valida um número que o client escolhe.
  Teatro de constraint.
- **Cap por trigger de linha (`FOR EACH ROW`):** 60 contagens por lote em vez de uma. Transition
  table resolve.
- **Bulk edit/cancel no client (3-4 round-trips + filtro em memória):** corrida check-then-act sobre
  até 60 linhas e predicado-guarda lido sob uma RLS que pode escondê-lo (falha aberto).
- **Aritmética de datas em SQL puro (`generate_series` + `EXTRACT(DOW)`), sem passar datas do
  client:** tecnicamente o caminho mais imune a fuso (tipo `date` não tem fuso), mas move a regra de
  recorrência para fora do alcance dos testes unitários do projeto e deixa o cap do R7 sem validação
  antes do INSERT (o R7 exige bloqueio **no client**, antes de qualquer escrita). O client calcula e
  a RPC revalida.
- **Unificar `is_job_owner`/`is_company_owner` nesta migration:** o gatilho do ADR anterior é a
  mudança da regra de autorização, não o ordinal da feature. Ver "Decisão", ponto 5.

## Verificação — Article 8 / Article 9

Nenhum objeto desta feature referencia `wallets`, `wallet_transactions`, `escrow_transactions`,
`payment_methods` ou `shift_payments`. Nenhuma RPC de saldo (`reserve_escrow`, `release_escrow`,
`refund_escrow`, `credit_deposit`, `update_wallet_balance`) é criada, alterada ou chamada.
`WalletService.refundEscrow` **não** é chamado no cancelamento em massa e não deve ser: o predicado
de "ocorrência tocável" garante ausência de `applications` em `hired|in_progress|completed`, e escrow
só nasce por `auto_reserve_escrow_on_hire` — logo, ocorrência tocável nunca tem linha de escrow.
Chamar `refundEscrow` em laço seria N chamadas não-atômicas para reverter zero reservas.

O único ponto onde esta feature **poderia** ter tocado saldo era o `ON DELETE CASCADE` de
`escrow_transactions.job_id`, e a decisão 2 (cancelamento suave) o torna inalcançável.

## Referências

- Spec: `.harness/spec/escala-recorrente/spec.md` (R1, R2, R3, R4, R7, R11, R13)
- Migration a produzir: `supabase/migrations/20260817000400_job_series.sql`
- Soft delete real (contradiz o R11 da spec): `frontend/src/pages/company/CompanyJobs.tsx:362-396`,
  `frontend/src/pages/company/CompanyJobDetails.tsx:136`
- Cascatas de FK: `supabase/migrations/001_create_wallet_escrow_tables.sql:18`,
  `20260630000000_shift_payments.sql:74`, `20260817000100_shift_calls.sql:170`
- `claim_shift_slot` não valida `jobs.status`: `20260817000200_shift_call_rpcs.sql:105-146`
- Ancoragem dupla e sua instabilidade: `20260816210000_enable_rls_jobs.sql` +
  `ADR-20260816-rls-desligada-jobs-conversation.md`
- Par de helpers e contrato de manutenção: `ADR-20260817-seam-autorizacao-empresa.md`
- Cicatriz de fuso: `frontend/src/lib/dateUtils.ts`, `CompanyCreateJob.tsx:187`
- UNIQUE parcial como dedupe de marcador: `ADR-20260816-marcador-pagamento-por-freela.md`
- Lições de GRANT: `20260318000000` (nunca `REVOKE ALL ... FROM PUBLIC` em tabela),
  `20260816201420` / `20260816201457` (EXECUTE em função de trigger)
