# ADR-20260822 — Contrato normativo para a DECISÃO; arquivo normativo para o CORPO

## Status

ACEITO — 2026-08-22. Decisão do owner (fechamento de `Hh1` em
`.harness/spec/lgpd-producao/ddl-aprovado.md` §5.5).

Escopo: **todos** os contratos de gate do harness (`.harness/spec/<slug>/ddl-aprovado.md` e
equivalentes), não apenas o de `lgpd-producao`.

## Contexto

Os contratos de gate do `harness-architect` nasceram com o cabeçalho *"Fonte normativa. O builder
implementa **isto**, byte a byte."* — o que, na prática, significou **copiar o corpo inteiro das
migrations para dentro do markdown**. No contrato de `lgpd-producao` isso somava mais de 1.200
linhas de SQL duplicado: asserções, dois triggers reescritos inteiros, duas RPCs, dois blocos de
verificação e dois `DOWN`.

Duplicata sem mecanismo de sincronização **diverge**. Não é hipótese — divergiu, em um dia:

- Os blocos de §2.2 e §2.5 congelaram no baseline de 21/08 enquanto o `.sql` recebia, ao longo de
  22/08, as varreduras **(d)/(e)**, a **GUARDA 4** (`sole_organization_owner`), o **soft-remove** de
  `company_members`/`organization_members` e a correção do `regclass::text`.
- O contrato ficou, portanto, exibindo o `regclass::text` **na forma quebrada** — sob etiqueta de
  "fonte normativa, byte a byte".
- O bloco de verificação do contrato parou em **V12** enquanto o arquivo chegava a **V22** — e o
  próprio contrato, em outra seção, já citava "ensaio de regressão em **V22**". O documento
  referenciava um item que a sua própria cópia não continha.
- Em §3.3, o bloco copiado descrevia uma migration **já aplicada em produção** e a descrevia
  **errado** em dois pontos (tipo das colunas de `reviews`; nomes na lista de `DROP POLICY`) —
  exatamente os dois defeitos que obrigaram a aplicação a ser feita em duas tentativas, e que já
  tinham sido corrigidos **no arquivo**.

**Nada no projeto força a sincronização.** Não há build, lint, teste ou hook que compare markdown
com `.sql`. A promessa de "ressincronizar" é uma promessa de continuar ressincronizando para sempre,
sustentada só por disciplina — e a disciplina já falhou dentro de uma única sessão.

**Já custou trabalho concreto:** o builder da Edge Function `delete-account` precisou **escolher**
entre o contrato e o arquivo, escolheu o arquivo — e ainda assim teve de **parar e reportar a
divergência**. O próximo builder escolheria o outro, sem parar.

**Sinal independente, no mesmo dia:** o mesmo defeito de `regclass::text` comparado contra literal
reapareceu, por conta própria, em `20260821001100_accept_manager_invite_dep_guard.sql` (F13) e
**derrubou a aplicação em produção**, acusando as 14 tabelas que já estavam na própria allow-list.
Ou seja: o padrão que o contrato duplicava errado é um padrão que se **repete** entre levas. Um
contrato que congela a versão errada de um padrão recorrente não é neutro — ele **propaga**.

## Decisão

**Repartir a normatividade por tipo de pergunta, e não por documento.**

| Pergunta | Fonte normativa |
|---|---|
| O que decidimos sobre esta coluna, esta tabela, este fluxo? Por quê? Sob qual base legal? Quais alternativas foram rejeitadas? | **o contrato** (`ddl-aprovado.md`) |
| Como o predicado, a asserção, a função, a RPC, o `GRANT` ou o `DOWN` está escrito? | **o arquivo** (`supabase/migrations/*.sql`) |

Três regras derivadas:

1. **Em divergência, o arquivo vence para o corpo** — sem consulta, sem gate, sem parar o trabalho.
   E a divergência é **bug do contrato**, nunca do arquivo. Consertar = reescrever a *decisão* no
   contrato ou corrigir o ponteiro; **nunca** copiar SQL de volta.
2. **O contrato não contém corpo de migration.** Onde havia bloco copiado, há **ponteiro** para
   arquivo + seção + nome da função. Um ponteiro nunca está desatualizado.
3. **Para migration já aplicada, nem o contrato nem o `.sql` são fonte de verdade sobre o estado do
   banco** — só o catálogo é (`pg_policies`, `pg_proc`, `information_schema`, `cron.job`).

### A fronteira: nem todo SQL num contrato é duplicação

Esta é a distinção que a decisão precisa deixar escrita, ou a regra vira "proibido SQL em markdown"
— o que jogaria fora argumento junto com corpo.

Um trecho de SQL citado para **sustentar um argumento** não é corpo: é o argumento. O critério não é
o tamanho, é a **função no texto**.

| | Corpo (proibido no contrato) | Ilustração não-normativa (permitida) |
|---|---|---|
| Serve para | ser **executado** | ser **lido**, para provar um ponto |
| Se divergir do arquivo | o leitor implementa a coisa errada | o argumento continua válido; o valor exato está no arquivo |
| Forma típica | função inteira, bloco `DO` inteiro, lista completa de colunas | um predicado, uma expressão, um contra-exemplo |

Exemplos reais, do próprio contrato de LGPD:

- `format('%I.%I', ns.nspname, cl.relname)` — citado para mostrar **por que** `regclass::text`
  comparado contra literal está errado. Sem a expressão, o parágrafo não se sustenta.
- `CHECK (… char_length(certification_requirement) <= 200)` — citado como **contra-exemplo**: é um
  `CHECK` que **não** é enum, e existe no texto exatamente para mostrar que "tem `CHECK`" não prova
  conjunto fechado. Uma regra de promoção ingênua teria tirado da redação, em silêncio, justamente a
  coluna de texto livre que a rodada mandou redigir.
- `to_jsonb(NEW) - <colunas> IS NOT DISTINCT FROM to_jsonb(OLD) - <as mesmas>` — a forma que torna a
  exceção de expurgo auto-limitada. É a ideia que precisa ser entendida, não o texto a ser colado.

**Convenção obrigatória:** todo trecho dessa classe é marcado **_(ilustração não-normativa)_** no
ponto de uso. O que não estiver marcado assim e parecer executável **é bug do documento**.

### Nota técnica que a investigação produziu (registrada para não se perder)

`regclass::text` **é correto** quando o nome vai ser **EXECUTADO** —
`format('ALTER TABLE %s DROP CONSTRAINT %I', …)` — porque o mesmo `search_path` que o renderiza
também o resolve. **O defeito existe só na COMPARAÇÃO contra literal**, porque `regclass::text`
**omite o schema** quando ele está no `search_path`, e as migrations do Supabase rodam com `public`
no `search_path`. A migration de LGPD usa as duas formas, e as duas estão certas hoje pelo motivo
certo.

## Consequências

### Positivas

- **A divergência deixa de ser possível por construção**, em vez de ser evitada por disciplina.
  Não há mais duas cópias do mesmo corpo.
- **O builder para de escolher.** A pergunta "qual das duas vale?" tem resposta escrita, e ele não
  precisa interromper para reportar.
- **O contrato encolhe e o sinal sobe.** O que sobra é o que só o contrato tem: classificação, base
  legal, alternativas rejeitadas, riscos residuais, itens que vão ao humano. Isso não existe em
  lugar nenhum do `.sql`.
- **Revisão fica mais barata.** Revisar decisão e revisar SQL passam a ser dois atos separados, cada
  um no artefato certo.
- **O ponteiro envelhece bem.** "Seção 5, `anonymize_account`" continua verdadeiro depois de dez
  emendas ao corpo.

### Negativas / Trade-offs

- **O contrato deixa de ser auto-suficiente.** Quem quiser ler a decisão *e* o código precisa abrir
  dois arquivos. Aceito: já era assim na prática, só que sem admitir.
- **Ponteiro pode apodrecer se a seção for renumerada** no `.sql`. Mitigação: apontar por **nome de
  objeto** (`anonymize_account`, `enforce_service_term_immutability`) além do número da seção — o
  nome sobrevive à renumeração.
- **Perde-se o registro histórico do que foi aprovado no gate.** Aceito: `git log` do `.sql` cobre
  isso, com data e autor, e melhor.
- **A fronteira "argumento × corpo" exige julgamento**, e julgamento erra. Mitigação: a convenção de
  marcação torna o erro **visível** (trecho não marcado e executável = bug), em vez de silencioso.
- **Dívida deixada:** os cabeçalhos dos `.sql` desta leva ainda dizem
  `-- DDL aprovado (FONTE NORMATIVA): .harness/spec/lgpd-producao/ddl-aprovado.md`. A frase agora é
  imprecisa (o contrato é normativo para decisão, não para corpo). **Não corrigido aqui** — mexer em
  migration está fora do escopo desta emenda, e uma delas já está aplicada em produção. Corrigir na
  próxima migration que tocar cada arquivo.

## Alternativas rejeitadas

- **Ressincronizar os blocos e seguir com duplicata.** É a alternativa que `Hh1` propunha. Rejeitada:
  é uma promessa de continuar ressincronizando, sustentada por nada. O drift de 21→22/08 é a prova
  empírica de que a promessa não se cumpre nem dentro de uma sessão.
- **Contrato normativo para tudo, com o `.sql` gerado a partir dele.** Seria coerente e eliminaria a
  divergência na outra direção. Rejeitada: exige um gerador, um formato intermediário e um passo de
  build que hoje não existem — e criaria uma dependência de tooling num fluxo que precisa funcionar
  com um editor de texto. Reabrir se algum dia houver esse gerador.
- **Manter o bloco de §3.3 (migration já aplicada) como "registro histórico marcado".** Foi oferecido
  pelo owner e recusado com justificativa: registro histórico se guarda quando o passado é
  informativo. Ali o passado é um **contra-exemplo já absorvido** — a lição ficou escrita em prosa
  (colunas eram `uuid`, `DROP POLICY` de nome inexistente passa em silêncio, policies permissivas se
  combinam por `OR`), e o SQL errado não precisa sobreviver junto para ensiná-la. Guardar SQL errado
  sob etiqueta de contrato é convidar alguém a lê-lo como especificação.
- **Proibir SQL em markdown de contrato.** Rejeitada: jogaria fora o argumento junto com o corpo.
  Ver a fronteira acima.

## Confirmação em uso (mesmo dia, 2026-08-22)

A regra teve o primeiro caso real horas depois de aceita, e ele saiu do jeito que a decisão previa.

`20260822000400_checks_enum_jobs_applications.sql` (fechamento de `Hh5`) deu `CHECK` de conjunto
fechado a `jobs.status`, `jobs.budget_type` e `applications.status`, o que **promove** as três da
classe de evidência fraca para a forte. O trabalho se repartiu exatamente pela linha do ADR:

- **No contrato** (`ddl-aprovado.md`): a promoção como *decisão* — §2.2.1 nova, §5.3 reescrita, `Hh5`
  e `Hh4` emendadas, e as duas lições epistêmicas que o levantamento produziu (o domínio de
  `applications.status` tem 13 valores e não os 10 da união TS, porque `types/index.ts` a declara
  `| string` e portanto ela não tipa nada; e `'paused'` está no `CHECK` sem existir em nenhuma linha
  de produção, provando que `SELECT DISTINCT` não é domínio).
- **No arquivo** (`20260821000000`, ainda não aplicada): mover três nomes de `v_retained_text` para
  `v_enum_text` — edição mecânica, registrada como ação explícita em §2.2.1 em vez de acontecer em
  silêncio ou de ser esquecida.

Duas observações que valem para a próxima vez:

1. **O handoff precisa ser escrito.** Sem a regra, a promoção teria sido "editada nos dois lugares" —
   ou, mais provavelmente, em um só. A ação pendente no `.sql` é o preço da separação, e o preço só é
   pago se estiver anotado. **Contrato que decide sem apontar a ação vira contrato que mente.**
2. **A regra não protege contra decisão errada, só contra divergência.** `Hh5` estava escrito no
   contrato propondo começar por `scope`/`type`/`budget_type` "que ninguém digita" — e o levantamento
   mostrou que `scope` e `type` têm valores **órfãos em produção**, sem origem em nenhuma linha do
   repositório, que um `CHECK` incompleto quebraria na edição de toda linha legada. O contrato estava
   errado sobre o mundo; nenhum ponteiro teria evitado isso. O que a regra garante é só que o erro
   existe **em um lugar** e é corrigido **uma vez**.

## Referências

- Contrato emendado: `.harness/spec/lgpd-producao/ddl-aprovado.md` (regra no topo; §5.5 `Hh1` fechada)
- Corpos: `supabase/migrations/20260821000000_lgpd_account_anonymization.sql`,
  `supabase/migrations/20260821000400_lgpd_retention_purge.sql`,
  `supabase/migrations/20260821000100_reviews_select_by_relationship.sql`
- Sinal independente do mesmo defeito:
  `supabase/migrations/20260821001100_accept_manager_invite_dep_guard.sql` (F13)
- ADRs relacionados: `ADR-20260821-anonimizacao-em-vez-de-exclusao.md`,
  `ADR-20260821-reviews-por-vinculo.md`, `ADR-20260822-fronteira-lgpd-multi-unidade.md`
- Constitution: Article 4 (RLS é a defesa dura; filtro no client é só UX) — o mesmo raciocínio de
  "qual camada garante de verdade" aplicado a documentação.
