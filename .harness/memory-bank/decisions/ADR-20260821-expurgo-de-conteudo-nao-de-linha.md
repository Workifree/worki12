# ADR-20260821 — Expurgo de retenção apaga CONTEÚDO PESSOAL, não a LINHA de auditoria

## Status
ACEITO — 21/08/2026. Complementa (não substitui) `ADR-20260821-anonimizacao-em-vez-de-exclusao.md`
e `ADR-20260821-lapide-neutraliza-acao-referencial.md`.

## Contexto

O owner fechou H1 do gate `lgpd-producao`: **retenção de 5 anos** para `shift_payments` e
`service_terms`, contada de `paid_at` e `accepted_at`; decorrido o prazo, **expurgo**. O desenho
anterior assumia "retenção indefinida até decisão em contrário" e o gate já havia anotado que um
prazo transforma a decisão num **cron de expurgo, que não existe**.

Ao especificar esse cron, três fatos do schema real mudaram o desenho:

1. **`service_terms.shift_payment_id` é `ON DELETE RESTRICT`**, e ainda há a FK composta
   `service_terms_payment_identity` (também RESTRICT). Um expurgo por `DELETE` teria ordem
   obrigatória (`service_terms` antes de `shift_payments`) e qualquer erro de ordem aborta o lote
   inteiro.
2. **Os dois guardas de imutabilidade são `BEFORE UPDATE`, e só isso** — verificado em
   `20260630000000:215` e `20260817001100:422`. Um `DELETE` **não passa por nenhum dos dois**. Ou
   seja: a rota destrutiva é justamente a que **escapa** de toda a proteção de auditoria que o
   projeto construiu. O `DELETE` é fácil porque ninguém está olhando, não porque é seguro.
3. `shift_payments` **não tem policy de DELETE** — decisão explícita de `20260630000000`
   ("auditoria não se apaga; correção = `voided`"). Um cron que apaga linhas contradiz uma decisão
   escrita no schema.

O que de fato expira em 5 anos não é o **registro contábil** — é a **justificativa para reter o
conteúdo pessoal dentro dele**. `service_terms.term_text` guarda nome e CPF em texto claro; essa é
a única razão pela qual a retenção precisava de prazo. O `id`, o `amount`, o `paid_at` e os uuids
não identificam ninguém depois que a lápide esvaziou `workers`.

## Decisão

**O expurgo é um `UPDATE` que remove o conteúdo pessoal e preserva a linha pseudônima.** Nenhum
`DELETE` em `shift_payments` ou `service_terms`, nunca — nem pelo cron, nem por ninguém.

1. **`service_terms`**: `term_text` → marcador `'[REGISTRO EXPURGADO ...]'`;
   `accepted_ip`/`accepted_user_agent` → `NULL`; `purged_at` → `now()`.
   **RETIDOS:** `amount`, `accepted_at`, `term_version`, `job_id`, `worker_id`, `company_id`,
   `shift_payment_id`.
2. **`shift_payments`**: `note` → `NULL` (único texto livre da tabela; risco residual §5.3 do
   contrato); `purged_at` → `now()`. **Todo o resto retido.** A linha continua contando no BI.
3. **Prazo é do DADO, não da conta** — cutoff sobre `coalesce(accepted_at, created_at)` e
   `coalesce(paid_at, created_at)`, sem qualquer referência a `anonymized_at`.
4. **O prazo vira um único ponto:** `public.lgpd_retention_interval()` (`interval '5 years'`),
   consumido **tanto** pela RPC **quanto** pelos dois triggers. Trocar 5→6 anos é `CREATE OR
   REPLACE` de uma função.
5. **Os triggers ganham uma exceção auto-limitada.** O expurgo só é expressável se
   (a) `auth.uid() IS NULL` (service_role/cron), (b) a linha passou do prazo, (c) `purged_at` vai
   de `NULL` para timestamp, e (d) **nenhuma outra coluna muda** — verificado por
   `to_jsonb(NEW) - <colunas do expurgo> IS NOT DISTINCT FROM to_jsonb(OLD) - <as mesmas>`.
   A **regra de retenção passa a morar no guarda de imutabilidade**: nem o `service_role` consegue
   expurgar um registro de ontem.
6. **Trava de litígio:** `service_terms.retention_hold_reason` (nullable). Não-NULL = a linha (e o
   `note` do pagamento correspondente) é pulada pelo expurgo. `service_terms` só tem policy de
   `SELECT` — a coluna é inalcançável pelo client por construção.
7. **Agendamento:** `pg_cron`, diário às `03:30 UTC` (00:30 BRT), guardado por
   `IF EXISTS (pg_extension)` + `RAISE WARNING`, no molde de `20260817000800` e `20260817001300`.
   Lote limitado (`p_batch_limit`), idempotente, drena backlog em dias.
8. **Prova de conformidade:** cada execução grava uma linha em `data_retention_purge_runs`
   (registro das operações de tratamento — LGPD art. 37).

## Consequências

### Positivas
- **O problema de ordem das FKs `RESTRICT` deixa de existir.** Sem `DELETE`, não há cascata, não
  há ordem, não há lote abortado. O perigo que o owner apontou some por escolha de desenho, não por
  cuidado de implementação.
- **Article 8/9 intactos por construção:** nenhuma linha de `wallet_transactions`/
  `escrow_transactions` é lida ou escrita; a garantia de idempotência `(wallet_id, reference_id)` só
  existe enquanto a linha existe, e ela nunca é tocada.
- O BI de gasto histórico (`amount`, `paid_at`) **sobrevive ao expurgo**. Um expurgo por `DELETE`
  teria reescrito silenciosamente todo relatório anterior a 5 anos.
- A trava de prazo dentro do trigger torna o expurgo prematuro **inexpressável**, não apenas
  "não implementado".
- A comparação por `to_jsonb` protege **colunas que ainda não existem**: quem adicionar uma coluna
  em `shift_payments` a ganha protegida contra o expurgo sem editar nada.

### Negativas / Trade-offs
- Duas funções aplicadas em produção precisam de `CREATE OR REPLACE`
  (`enforce_shift_payment_immutability`, `enforce_service_term_immutability`). A segunda **já** é
  reescrita pela migration de anonimização ⇒ **ordem de aplicação obrigatória** e corpo-superset.
  É o acoplamento mais frágil desta entrega.
- Duas colunas novas (`purged_at` em duas tabelas) + uma (`retention_hold_reason`) + uma tabela de
  auditoria de execução. Superfície cresce para uma rotina que roda uma vez por dia.
- O expurgo atinge **contas vivas**, não só lápides (consequência direta da decisão 3). Um freela
  ativo há 7 anos perde o texto dos termos mais antigos. É correto e precisa estar na política.
- `term_text` deixa de existir para registros antigos: se um litígio nascer no ano 6, a prova
  documental terá sumido — mitigado só pela trava de litígio, que exige alguém **saber antes**.

## Alternativas rejeitadas

- **`DELETE` das linhas de `service_terms` + `shift_payments`** (leitura literal de "expurgo"):
  destrói documento contábil e BI histórico, contradiz a ausência deliberada de policy de DELETE em
  `shift_payments`, e — o pior — **escapa dos dois triggers de imutabilidade**, que são `BEFORE
  UPDATE`. Seria a única operação destrutiva do sistema sem guarda nenhum.
- **Contar o prazo da data de exclusão da conta:** faria o titular que exerce o art. 18, VI
  **prolongar** a retenção dos próprios dados. Perverso e indefensável. Ver §"prazo é do dado".
- **Reaproveitar `anonymized_at` como marcador do expurgo:** a transição já foi gasta na exclusão da
  conta (`NULL→ts`, one-way). Um registro de conta viva nunca teria `anonymized_at`, e um de conta
  excluída já teria — o marcador não distingue os dois eventos. Marcador novo é obrigatório.
- **Prazo como constante literal em cada lugar:** garante que a revisão jurídica (5 vs 6 anos)
  vire caça a literais em trigger, RPC e cron. Função única.
- **Não expurgar `shift_payments.note`** (mantê-lo como risco residual permanente): depois do prazo
  não existe mais justificativa para reter texto livre com nome de pessoa. Seria assumir que o
  risco residual §5.3 é eterno.

## Aberto — confirmação jurídica (NÃO é decisão técnica)

- **5 anos pode ser curto pelo vetor trabalhista.** A prescrição civil (CC art. 206, §5º, I) dá 5
  anos, mas uma reclamação alegando vínculo tem 2 anos após o fim da relação (CF art. 7º, XXIX) e o
  processo dura anos — a prova que interessa é exatamente o `term_text` que declara ausência de
  vínculo. Cenário realista: precisar do documento **no ano 6 ou 7**. Recomendação técnica: **6
  anos**, se jurídico não tiver posição contrária. O desenho torna a troca trivial (decisão 4).
- **Apagar `accepted_ip` na exclusão da conta** pode colidir com o dever de guarda de registros de
  acesso a aplicações por 6 meses (Marco Civil, art. 15). Não bloqueia nada hoje; precisa de
  parecer.
- A moldura "documento fiscal" usada informalmente no contrato é frouxa no **modo A**: a obrigação
  fiscal é da **empresa**, não da Worki. A Worki retém como prova de que **intermediou**, o que
  sustenta art. 7º, VI e art. 16, I — não uma obrigação fiscal própria.

## Referências
- Contrato: `.harness/spec/lgpd-producao/ddl-aprovado.md` §2.7 (SQL normativo), §5/H1, §6 (copy)
- `supabase/migrations/20260630000000_shift_payments.sql:215` (trigger BEFORE UPDATE)
- `supabase/migrations/20260712000000_shift_payment_scheduled.sql:134` (corpo vigente)
- `supabase/migrations/20260817001100_service_terms.sql:73,116,422` (FKs RESTRICT + trigger)
- Molde de cron: `20260817000800`, `20260817001300`
