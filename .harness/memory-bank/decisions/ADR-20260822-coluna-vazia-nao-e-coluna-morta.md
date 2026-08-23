# ADR-20260822 — Coluna vazia não é coluna morta: classificação das 17 colunas que HALTaram a asserção (b)

> Escrito em duas passadas no mesmo dia: `workers` (10 colunas) e, depois que a migration avançou,
> `companies` (7). Mesma decisão, mesma régua — um ADR só, porque o owner decide as duas tabelas de
> uma vez.

## Status
ACEITO

## Contexto

A migration `20260821000000_lgpd_account_anonymization.sql` HALTou em produção na asserção (b) da
seção 1, com a lista real de colunas de `public.workers` que não constavam nem entre as APAGADAS
(`v_expected_workers`) nem entre as RETIDAS:

```
goal, recommendation_score, views, stripe_account_id, stripe_onboarding_completed,
postal_code, address, address_number, province, income_value
```

O HALT está **correto** e é o motivo pelo qual a asserção existe: as colunas de `workers` **não têm
DDL no repositório** (a tabela nasceu fora de migration), então a única fonte confiável do conjunto
de colunas é o catálogo do banco — e ele discordou da lista escrita. Nada foi aplicado; o banco está
intacto.

Levantamento (produção, 15 linhas em `workers`) trazido pelo humano:

| Coluna | Tipo | Preenchidas | Uso no frontend |
|---|---|---|---|
| `goal` | text | 12 (3 valores distintos) | `WorkerOnboarding.tsx` — `radio` de 3 opções fixas |
| `recommendation_score` | numeric | 15 | `WorkerPublicProfile.tsx`, `types/index.ts` |
| `views` | integer | 15 | nenhum |
| `address`, `address_number`, `postal_code`, `province`, `income_value` | text/numeric | **0** | nenhum |
| `stripe_account_id`, `stripe_onboarding_completed` | text/boolean | **0** | nenhum |

Duas armadilhas estavam postas, e as duas foram evitadas:

1. **"É enum, então retém."** `goal` é um `radio` de três opções no React. A tentação é classificá-la
   como conjunto fechado e retê-la. **A asserção (b3) desta mesma migration existe para recusar
   exatamente essa justificativa:** o conjunto fechado tem de ter evidência no **catálogo**
   (`CHECK ... = ANY (ARRAY[...])`), porque schema muda e componente React não é schema.
   `workers.goal` é `text` **sem CHECK**, e a policy de UPDATE de `workers` é `id = auth.uid()` — o
   próprio titular escreve, e um `PATCH` direto no PostgREST grava qualquer prosa. Conjunto fechado
   que só existe na UI é conjunto aberto no banco.
2. **"Está vazia, então não importa."** Sete colunas têm 0 linhas. Dado vazio hoje **não é** dado que
   não existirá amanhã (mesma razão pela qual `paused` entrou num CHECK nesta leva). Uma coluna de
   endereço vazia continua sendo coluna de endereço. E a assimetria de custo é total: **apagar coluna
   vazia custa uma atribuição; classificar depois que ela enche custa uma migration nova mais um
   intervalo em que o dado sobreviveu à exclusão de conta** — argumento que este contrato já usou
   para `applications.message` (§2.1).

## Decisão

**1. As 8 viram APAGADAS** (entram em `v_expected_workers` e na `UPDATE public.workers` da RPC):

- `goal` → `NULL`. Preferência declarada de perfil, mesma classe de `primary_role`/`availability`,
  já APAGADAS. Recusada a retenção-como-enum pelo argumento (b3) acima.
- `address`, `address_number`, `postal_code`, `province` → `NULL`. Endereço residencial. Régua já
  aplicada a `companies.address` e a `workers.city`.
- `income_value` → `NULL`. Renda declarada — dado pessoal financeiro, classe imediatamente abaixo
  de `cpf`/`pix_key`.
- `stripe_account_id` → `NULL`. Identificador da pessoa num terceiro. Origem morta não torna um
  identificador menos pessoal.
- `stripe_onboarding_completed` → `false`. **Não** por ser "boolean sem conteúdo pessoal" — essa
  justificativa já foi recusada nesta tabela (`badges_hidden`, 21/08). É afirmação sobre uma
  identidade que deixou de existir, exatamente como `verified_identity = false`.

**2. As 2 viram RETIDAS** (entram na allow-list da asserção (b)):

- `recommendation_score`, `views` → agregados numéricos sobre chave pseudônima, mesma classe de
  `xp`/`rating_average`/`profile_views`. **O argumento sobrevive ao dia em que forem preenchidas:**
  escalar ou contar sobre um pseudônimo não identifica ninguém com 0 nem com 10.000. É a diferença
  **categórica** para o bloco de endereço/renda, cujo conteúdo **é** a pessoa. (`views` é ainda
  contador legado sem consumidor, sucedido por `profile_views` em 20260317140300 — mas isso é
  observação, não a razão da retenção.)

**3. Recomendo `DROP COLUMN` das 12 colunas mortas — `workers` (7) e `companies` (5), em
migration SEPARADA, decisão do owner, DEPOIS da #1.** Registrado como Hh7 na §5.5 do contrato e no
débito #19. Não implementado aqui. **Ficam de fora, de propósito:** `workers.goal`,
`companies.company_type` e `companies.size` são APAGADAS mas estão **vivas** — o onboarding escreve
nas três. Apagar na lápide, sim; derrubar, não.

## Consequências

### Positivas
- A asserção (b) de `workers` passa a ficar **fechada**: toda coluna está APAGADA ou RETIDA, com
  justificativa escrita. Nenhuma sobrevive em silêncio a uma exclusão de conta.
- A #1 fica **desbloqueada** sem depender da decisão de DROP.
- A doutrina (b3) foi aplicada contra a própria conveniência (era mais barato reter `goal`), o que é
  a única forma de uma regra desse tipo continuar valendo.
- As 7 colunas vazias ficam corretas **nas duas hipóteses** — preenchidas ou não.

### Negativas / Trade-offs
- A rotina de LGPD passa a escrever em 7 colunas que hoje não têm nada. Custo real: 7 atribuições
  num `UPDATE` que já roda.
- **Acoplamento novo, e é o que precisa ser dito em voz alta:** com as 7 dentro de
  `v_expected_workers` e da RPC, um `DROP COLUMN` futuro **quebra a RPC em runtime** se a migration
  do DROP não recriar `anonymize_account`. Mitigação: está escrito em comentário no ponto exato
  do arquivo, em Hh7 do contrato e neste ADR.
- Uma reaplicação da #1 após o DROP passará a HALTar na asserção (a). **Isso é o comportamento
  correto** — o schema deixou de ser o que aquele arquivo verificou — mas quem encontrar o HALT sem
  contexto vai achar que é defeito.

## Segunda passada — `companies` (7 colunas)

Com `workers` fechada, a asserção (b) HALTou em `companies`:

```
size, stripe_customer_id, postal_code, address_number, province, income_value, company_type
```

**Cinco são gêmeas exatas** das de `workers` (`postal_code`, `address_number`, `province`,
`income_value`, `stripe_customer_id`): mesmo nome, mesma origem, 0 linhas, nenhum uso. A régua se
transfere inteira → **APAGADAS**. Com um reforço local: `companies.address` já estava APAGADO, e
`postal_code`/`address_number`/`province` são **partes** desse endereço — retê-las seria re-derivar
o que a linha acima acabou de eliminar, o mesmo defeito que a emenda de 21/08 encontrou em `city`.

As duas com dado exigiram julgamento, e **nenhuma das duas foi decidida por consistência**:

- **`company_type` → APAGADO.** É a coluna que **declara que a "empresa" é pessoa natural**. O
  `<select>` oferece `MEI`, `INDIVIDUAL_PERSON` ("Pessoa Física / Autônomo"), `LIMITED`,
  `INDIVIDUAL` (EI), `ASSOCIATION`, `OTHER`. O contrato já apagava `cnpj` sob o argumento "de MEI/EI
  identifica pessoa natural" — **inferência**. Aqui a coluna grava a string `MEI`. O argumento fica
  mais forte que o original, não igual a ele.
- **`size` → APAGADO, e o nome mente.** Não é porte da empresa: `CompanyOnboarding.tsx:134` grava
  `size: formData.hiringVolume`, o radio "Turnos por mês (estimativa)" (`1-5`/`6-20`/`20+`). É
  intenção operacional autodeclarada, mesma classe de `workers.goal`. O argumento de BI — que para
  `companies.city` foi pesado e recusado — aqui é **mais fraco ainda**: o volume real de contratação
  é derivável de `jobs`/`shift_payments`, ambos RETIDOS. Reter a **estimativa autodeclarada** do
  número que a plataforma **mede de verdade** é guardar a cópia pior.
  *Registro de método:* classificar por nome de coluna teria produzido o enquadramento errado
  ("porte da empresa, dado comercial de PJ"). O nome é a última fonte a consultar; o consumidor é a
  primeira.

**A armadilha (b3) reapareceu nas duas.** `<select>` de 6 opções e radio de 3, ambas `text` **sem
CHECK** — conjunto fechado que só existe no React. Recusadas como enum pelo mesmo motivo de `goal`.

## Achado que muda a recomendação de DROP: a migration do Stripe existe e nunca foi aplicada

`supabase/migrations/20260310000000_drop_stripe_columns.sql` (commit `61e8e957`) derruba
**exatamente** `workers.stripe_account_id`, `workers.stripe_onboarding_completed` e
`companies.stripe_customer_id`. É idempotente (`DROP COLUMN IF EXISTS`). **As três continuam em
produção**, e a migration não aparece em nenhum log de aplicação.

Isso divide a recomendação em dois lotes com custos diferentes (Hh7 / débito #19): **Lote A
(Stripe, 3 colunas)** não é escrever migration, é **aplicar uma que o repositório já acredita ter
aplicado**; **Lote B (Asaas, 9 colunas)** é migration nova. Ambos **depois** da #1 — inclusive o A,
que é tentador aplicar já por estar pronto: aplicá-lo antes faz a #1 HALTar na asserção (a) em três
colunas de uma vez.

## Achado constitucional (registrar independentemente da decisão)

**O Article 6 afirma que "Stripe foi 100% removido". Não foi — pelo menos não do schema.**
`workers.stripe_account_id`, `workers.stripe_onboarding_completed` e `companies.stripe_customer_id`
estão em produção hoje. E a segunda passada mostrou que o diagnóstico inicial ("a remoção parou na
fronteira do banco") era **generoso demais com o repositório e injusto com quem fez o trabalho**: a
remoção do schema **foi escrita**, em `20260310000000_drop_stripe_columns.sql`. Ela parou **entre o
commit e o banco** — que é exatamente a fronteira onde nenhum build, lint ou teste olha, e que o
`architecture.md` já descreve em voz alta ("Estado de produção é a informação mais difícil de manter
honesta no memory-bank, porque muda fora do repositório"). Não altero a constitution aqui (Article é imutável
sem decisão explícita do owner, com data e justificativa); registro o fato e proponho a redação
honesta para quando o owner decidir: *"Stripe foi removido do código e da integração; resíduos de
schema são derrubados sob migration própria"* — ou, se o DROP recomendado acontecer, o Article volta
a ser verdadeiro literalmente e nada muda.

Isto tem valor além do Stripe: é **evidência de que "removido" verificado só no código é uma
afirmação parcial**. O mesmo vale para o Asaas a partir da pausa de processamento
(ADR-20260822-pausa-do-processamento-de-pagamento) — as 5 colunas de endereço/renda são, campo a
campo, o cadastro de `customer` do Asaas, e sobreviveriam à mesma varredura.

## Alternativas rejeitadas

- **Reter `goal` como enum de 3 valores.** Recusada pela asserção (b3): a evidência do conjunto
  fechado tem de estar no catálogo, e não está. Ceder aqui esvaziaria a regra no primeiro caso
  concreto em que ela custou algo.
- **Deixar as 7 vazias fora da classificação, "porque não têm dado".** É o modo de falha que a
  asserção (b) existe para impedir. Vazio é estado, não classificação.
- **Classificar as 7 como "APAGADAS por DROP" (sem `SET NULL`), esperando a migration de remoção.**
  Cria uma janela — entre agora e uma decisão de owner que pode não vir — em que a coluna aceita
  escrita e sobrevive à exclusão de conta. A classificação não pode depender de uma migration que
  ainda não existe.
- **Fazer o DROP agora, junto.** `DROP COLUMN` é irreversível quanto ao dado e é decisão de owner.
  E inverter a ordem (DROP antes da #1) trocaria um HALT diagnóstico por uma janela em que a rotina
  de LGPD referencia coluna inexistente.
- **Editar a lista "para fazer passar"**, que é o que o próprio cabeçalho da migration proíbe. Cada
  uma das 10 tem linha na §2.1 com justificativa; adicionar nome à lista significa "eu decidi", não
  "eu silenciei".

## Referências
- Contrato: `.harness/spec/lgpd-producao/ddl-aprovado.md` §2.1 (`workers`), §5.5 (Hh7)
- Arquivo: `supabase/migrations/20260821000000_lgpd_account_anonymization.sql` (seção 1, asserções
  (a)/(b); RPC `anonymize_account`, bloco "LÁPIDE: workers")
- `ADR-20260821-anonimizacao-em-vez-de-exclusao.md`
- `ADR-20260822-contrato-normativo-para-decisao-arquivo-para-corpo.md`
- `ADR-20260822-pausa-do-processamento-de-pagamento.md`
- Constitution, Article 6
