# DDL aprovado — `lgpd-producao` (débitos pré-piloto #5 e #9)

> ## Regra de normatividade (2026-08-22 — **Hh1 fechada**)
>
> **Este documento manda em _o que decidimos e por quê_. O arquivo `.sql` manda em _como está
> escrito_.**
>
> | Pergunta | Fonte normativa |
> |---|---|
> | O que acontece com esta coluna / esta tabela, e sob qual base legal? | **este documento** — §2.1, §2.7.0–2.7.1, §3.1–3.2, §4, §5, §6 |
> | Como o predicado, a asserção, a função, a RPC ou o `DOWN` está escrito? | **o arquivo** `supabase/migrations/<timestamp>_*.sql` |
>
> Em divergência, **o arquivo vence para o corpo** — sem consulta, sem gate, sem parar o trabalho —
> e a divergência é **bug deste documento**, nunca do arquivo. Consertar significa reescrever a
> *decisão* aqui ou corrigir o ponteiro; **nunca** copiar SQL para cá.
>
> **Corolário operacional: este documento não contém corpo de migration.** Onde havia bloco copiado,
> há ponteiro para arquivo, seção e função. Um ponteiro nunca está desatualizado.
>
> ### A fronteira: nem todo SQL num contrato é duplicação
>
> Um trecho de SQL citado para **sustentar um argumento** não é corpo — é o argumento. O que separa
> os dois não é o tamanho, é a **função no texto**:
>
> | | Corpo (proibido aqui) | **Ilustração não-normativa** (permitida) |
> |---|---|---|
> | Serve para | ser **executado** | ser **lido**, para provar um ponto |
> | Se divergir do arquivo | o leitor implementa a coisa errada | o argumento continua válido; o valor exato está no arquivo |
> | Forma | função inteira, bloco `DO` inteiro, lista completa | um predicado, uma expressão, um contra-exemplo |
> | Exemplo neste documento | ~~os blocos de §2.2, §2.4, §2.5, §2.6, §2.7.2-7, §3.3~~ (agora ponteiros) | `format('%I.%I', ns.nspname, cl.relname)` em §2.1.1; o `CHECK (... char_length(...) <= 200)` de §5.4/Hh6, que existe **exatamente** para mostrar que ter `CHECK` não prova conjunto fechado; o esboço de §4.4.1 |
>
> **Convenção:** todo trecho da coluna da direita é marcado **_(ilustração não-normativa)_** no
> ponto de uso. O que não estiver marcado assim e parecer executável **é bug deste documento**.
>
> ### O `regclass::text` como caso de teste da regra (2026-08-22)
>
> O defeito que este documento carregou por um dia — comparar `conrelid::regclass::text` contra
> literal `'public.x'`, que **omite o schema** quando ele está no `search_path` e por isso acusa
> **todas** as tabelas — reapareceu **de forma independente** em
> `20260821001100_accept_manager_invite_dep_guard.sql` (F13) e **derrubou a aplicação em produção**,
> acusando as 14 tabelas que já estavam na própria allow-list. Corrigido lá com o mesmo
> `format('%I.%I', ns.nspname, cl.relname)`.
>
> A distinção que ficou clara, e que vale além desta leva: **`regclass::text` é correto quando o
> nome vai ser EXECUTADO** — `format('ALTER TABLE %s DROP CONSTRAINT %I', ...)` (§2.3) — porque o
> mesmo `search_path` que o renderiza também o resolve. **O defeito existe só na COMPARAÇÃO contra
> literal.** A migration #1 usa as duas formas, e as duas estão certas hoje pelo motivo certo.
> *(Ilustração não-normativa; as ocorrências reais estão no arquivo.)*
>
> Gate: `harness-architect`, 21/08/2026; regra de normatividade em 22/08/2026.
> ADR: `.harness/memory-bank/decisions/ADR-20260822-contrato-normativo-para-decisao-arquivo-para-corpo.md`
>
> ADRs: `.harness/memory-bank/decisions/ADR-20260821-anonimizacao-em-vez-de-exclusao.md`
>       `.harness/memory-bank/decisions/ADR-20260821-reviews-por-vinculo.md`
>       `.harness/memory-bank/decisions/ADR-20260821-lapide-neutraliza-acao-referencial.md`
>       `.harness/memory-bank/decisions/ADR-20260821-expurgo-de-conteudo-nao-de-linha.md`
>       `.harness/memory-bank/decisions/ADR-20260822-fronteira-lgpd-multi-unidade.md`
>       `.harness/memory-bank/decisions/ADR-20260822-token-de-cartao-permanece-no-asaas.md`
>
> **EMENDA 2026-08-21 (cobertura).** Migration #1 (§2). Fecha lacunas de **classificação**, não de
> lógica — a lógica de §2.4/§2.5 auditada pelo evaluator (emenda ip/ua, UPDATE único, fail-closed,
> Articles 8/9) está **inalterada**. Delta: §2.1.0 (regra estrutural nova), 4 colunas classificadas
> (`companies.city`, `workers.badges_hidden|accepts_referrals|discoverable_for_sos`), 7 tabelas
> classificadas (`worker_referrals`, `worker_company_badge_prefs`, `team_lists`,
> `company_spend_limits`, `company_monthly_revenue`, `job_series`, ramo empresa de
> `worker_trainings`), asserção (c) em §2.2, V9–V12 em §2.6, 1 risco residual em §5.3.
>
> **EMENDA 2026-08-21 (retenção/expurgo).** **H1 e H2 VIERAM DO OWNER — ver §5.** H1: retenção de
> **5 anos** (contada de `paid_at` / `accepted_at`), depois **expurgo**. H2: **remover** as FKs
> CASCADE, como desenhado. Delta desta emenda: **§2.7 (migration #3 — expurgo)**; §0.3 (o veredito
> de `enforce_shift_payment_immutability` MUDOU — agora **precisa** de emenda); §5/H1–H2
> reescritos como DECIDIDO; §5.3 (`shift_payments.note` deixa de ser risco *permanente* e vira
> risco *com prazo*); e **§6 (texto de política e de tela)**, entregável desta emenda.
> O que **NÃO** muda: toda a §2.1–§2.6 (cobertura de 7 tabelas, 4 colunas, asserção (c)) —
> **não reabrir**.
> **Bloqueio remanescente: TÉCNICO, não de decisão.** A #1 não vai a produção sozinha: sem a #3,
> a promessa de 5 anos não é cumprida por nada.
>
> **Três migrations.** #1 e #2 são independentes entre si; aplicar a #1 antes da #2 (a #1 contém
> asserções de schema que valem como diagnóstico geral do banco). **A #3 DEPENDE da #1** — ela
> reescreve `enforce_service_term_immutability` com o corpo-**superset** (delta da anonimização
> **mais** o do expurgo). Ordem obrigatória: **#1 → #3**.

---

## 0. Achados que mudam o desenho (leia antes do SQL)

### 0.1 O `delete-account` está quebrado por DOIS caminhos, não um

O débito #5 registra o caminho `workers → shift_payments (RESTRICT)`. A leitura do schema encontrou
um **segundo** caminho, igualmente fatal e não registrado:

```
auth.users ──CASCADE──> wallets              (001_create_wallet_escrow_tables.sql:7)
wallets    ──NO ACTION─< wallet_transactions (001:30)   ⇒ DELETE bloqueado
wallets    ──NO ACTION─< escrow_transactions (001:22)   ⇒ DELETE bloqueado
```

`wallet_transactions.wallet_id` e `escrow_transactions.company_wallet_id/worker_wallet_id` não
declaram `ON DELETE`, logo são `NO ACTION`. Qualquer usuário que já teve **uma** linha de
`wallet_transactions` derruba `auth.admin.deleteUser` — independente de `shift_payments`.

E, se alguém "consertar" isso trocando esses FKs para CASCADE, o resultado é **destruir o
livro-caixa** — o que viola Article 8/9 (a garantia de idempotência de `wallet_transactions` só
existe enquanto a linha existe). **A cascata é o bug; não o RESTRICT.**

### 0.2 A F6 agrava, sim — e de forma pior que a original

`service_terms` (aplicada em produção em 18/08) adiciona **quatro** FKs `RESTRICT` novas
(`shift_payment_id`, `job_id`, `worker_id`, `company_id`) **mais** a FK composta
`service_terms_payment_identity`. Efeito prático: mesmo que alguém apagasse `shift_payments` para
destravar a exclusão (o que nunca deve acontecer), `service_terms` bloquearia igual. O bloqueio virou
redundante e mais difícil de contornar por acidente — o que é **bom** para a auditoria e **ruim** para
quem acreditava que `deleteUser` funcionava.

### 0.3 O que os guardas de imutabilidade permitem hoje (resposta à pergunta 3 do gate)

| Guarda | Ator `service_role` / `auth.uid()` NULL | Veredito para a anonimização |
|---|---|---|
| `enforce_shift_payment_immutability` (20260630/20260712) | A partição por papel está dentro de `IF auth.uid() IS NOT NULL` — sem sessão não há partição. Mas as colunas materiais (`amount`, `note`, `source`, `paid_at`, …) são imutáveis **antes** disso, para todos os papéis. | ~~Não precisa mudar~~ → **PRECISA de emenda (§2.7)**. Continua verdade que **nada em `shift_payments` é anonimizado** na exclusão de conta (§2.1) — a migration #1 segue sem tocar neste trigger. Mas o **expurgo** (migration #3) apaga `note`, que está na lista de colunas materiais. Ver o quadro abaixo. |
| `enforce_service_term_immutability` (20260817001100) | Vale para **todos** os papéis, inclusive `service_role` e owner. Permite reescrever `term_text` **apenas** na transição `anonymized_at NULL→ts`. | **Precisa de uma emenda cirúrgica.** `accepted_ip` e `accepted_user_agent` são imutáveis após o aceite **sem exceção** — e IP é dado pessoal (art. 5º, I). Hoje a anonimização seria **barrada** ao tentar apagá-los. Emenda em §2.4: permitir `ip/ua → NULL` (só para NULL, nunca para outro valor) dentro da mesma transição. |
| `enforce_certification_update_scope` (F8, 20260817001300) | Ramo **(c)** (`v_uid IS NULL`): `RAISE EXCEPTION` se `v_content_changed`. | **Barra a anonimização por UPDATE.** O ramo (c) foi escrito para cron e FK SET NULL, não para apagar conteúdo. Conclusão: `worker_certifications` e `worker_trainings` **não** se anonimizam — **apagam-se** (`DELETE`), que nenhum trigger `BEFORE UPDATE` intercepta e que é o tratamento correto (certificação não tem valor fiscal). Ver §2.1. |

#### 0.3.1 O expurgo bate nos MESMOS guardas — e agora bate nos dois (emenda 2026-08-21)

A pergunta que o gate reabriu: *com o expurgo apagando **conteúdo** (UPDATE) em vez de apagar a
**linha** (DELETE, ADR-20260821-expurgo-de-conteudo-nao-de-linha), os guardas barram de novo?*
**Sim — e é assim que tem de ser.** Escolher `UPDATE` foi justamente escolher a rota que **passa**
pelos guardas: um `DELETE` não dispara trigger `BEFORE UPDATE` nenhum e seria a única operação
destrutiva do sistema sem supervisão. O preço de estar sob supervisão é ter de escrever a exceção.

| Guarda | O que barra o expurgo hoje | Delta em §2.7 |
|---|---|---|
| `enforce_shift_payment_immutability` | **Três** bloqueios, não um. (1) `note` está na lista de colunas materiais "imutáveis SEMPRE, inclusive `service_role`" (20260712000000:145–160) ⇒ `note → NULL` levanta exceção. (2) `IF OLD.status = 'voided' THEN RAISE` — e um pagamento **estornado** de 6 anos atrás carrega `note` igual; sem tratar isto, exatamente as linhas mais antigas ficariam de fora. (3) `purged_at` é coluna **nova**: nenhuma checagem a menciona, então ela passaria **em silêncio** por qualquer caminho — inclusive por um `authenticated`. | Ganha um ramo de expurgo **auto-limitado** no topo (`RETURN NEW` cedo) + um bloqueio explícito de `purged_at` para todo o resto. Corpo vigente **inalterado** abaixo disso. |
| `enforce_service_term_immutability` | `term_text` pós-aceite só muda sob `v_anonymizing` (§2.4); `accepted_ip`/`accepted_user_agent` idem. O expurgo atinge **conta viva** (decisão 3 do ADR — prazo é do dado), e numa conta viva `anonymized_at` é e continua `NULL` ⇒ `v_anonymizing` é `false` ⇒ **barrado**. Reaproveitar `anonymized_at` para escapar disso está **proibido** (marcaria como "conta excluída" quem não excluiu conta). | Ganha o **mesmo** ramo auto-limitado, `v_purging`, ao lado de `v_anonymizing`. ⚠️ **Corpo-superset:** esta função é reescrita por §2.4 **e** por §2.7 — a #3 tem de conter as duas emendas. Ordem obrigatória **#1 → #3**, com asserção em §2.7 que **HALTa** se a #1 não estiver aplicada. |
| `enforce_certification_update_scope` (F8) | Irrelevante para o expurgo: `worker_certifications` **não** tem retenção — é `DELETE` na própria exclusão da conta (§2.1). | Nenhum. |

**A forma da exceção (vale para os dois, e é o que a torna segura).** O ramo só existe se as cinco
condições valerem juntas — qualquer uma faltando é `RAISE`, nunca fall-through silencioso:

1. `auth.uid() IS NULL` — só `service_role`/cron. Nenhuma sessão humana expurga.
2. `purged_at` vai de `NULL` para timestamp (marcador novo, one-way). É também o **gatilho barato**
   do ramo: numa `UPDATE` normal a condição falha na primeira comparação e nada mais é avaliado.
3. **A linha passou do prazo**, medido pela mesma `public.lgpd_retention_interval()` que a RPC usa.
   Consequência declarada: **nem o `service_role` consegue expurgar um registro de ontem.** A regra
   de retenção passa a morar no guarda de imutabilidade, não só na rotina que ele guarda.
4. **Nenhuma trava de litígio ativa** (`service_terms.retention_hold_reason`; para o pagamento, a
   trava do termo correspondente).
5. **Nada além das colunas do expurgo mudou**, verificado por
   `to_jsonb(NEW) - <colunas do expurgo> IS NOT DISTINCT FROM to_jsonb(OLD) - <as mesmas>`.

É (5) que autoriza o `RETURN NEW` cedo sem reexecutar o corpo vigente: se `to_jsonb` de tudo o mais
é idêntico, então `amount`, `job_id`, `worker_id`, `accepted_at`, `status` e a confirmação do freela
**não podem** ter mudado — o corpo abaixo não teria o que reprovar. E a comparação protege
**colunas que ainda não existem**: quem adicionar coluna em `shift_payments` amanhã a ganha
protegida contra o expurgo sem editar uma linha deste trigger.

### 0.4 O nome honesto disto não é "anonimização"

Depois desta rotina, `service_terms.term_text` de um termo **aceito** continua contendo nome e CPF do
freela (é a prova da transação). Logo o conjunto **não** é anonimizado no sentido do art. 5º, XI — é
**eliminação parcial + retenção justificada (art. 16, I)** sobre uma chave **pseudônima**
(`workers.id`). O produto pode chamar a operação de "excluir conta" na UI (o acesso acaba de verdade),
mas **não pode** afirmar "todos os seus dados foram apagados". Copy e Política de Privacidade precisam
dizer o que fica e por quê — é o débito #1, que passa a ser **pré-requisito** deste aqui.

---

## 1. Decisão estrutural — lápide pseudônima (migration #1)

**A linha de `workers`/`companies`/`wallets` sobrevive à exclusão da conta.** Ela vira uma lápide:
mantém `id` (a chave que sustenta `shift_payments` e `service_terms`) e perde todo o conteúdo pessoal.
Para isso, as FKs `CASCADE` que ligam essas três tabelas a `auth.users` são **removidas**.
`auth.admin.deleteUser` passa a apagar **só** a credencial.

Por que remover a FK e não outra coisa:

- **Trocar `RESTRICT` por `SET NULL` em `shift_payments.worker_id`** — impossível: a coluna é
  `NOT NULL`, é âncora de RLS e participa da FK composta `service_terms_payment_identity`. Torná-la
  nullable destrói a política de acesso do freela ao próprio recibo.
- **Trocar `RESTRICT` por `CASCADE`** — apaga documento fiscal e recibo bilateral. Fora de cogitação.
- **Manter a FK e nunca apagar `auth.users`** (banir + trocar e-mail por placeholder) — mantém uma
  casca de conta reativável e um registro de identidade que o titular pediu para eliminar. É a
  alternativa rejeitada; ver ADR e §5/H2.
- **Remover a FK** — a integridade que ela dava não é a única defesa: a policy de INSERT de `workers`
  é `WITH CHECK (id = auth.uid())` (20260309000000:23) e a criação real vem do trigger
  `handle_new_user`. Nenhum client consegue inventar uma linha com `id` alheio. O custo é aceitar
  linhas órfãs **por construção** — que é exatamente o que uma lápide é.

> ⚠️ **DECISÃO QUE VAI AO HUMANO (H2).** Ver §5.

---

## 2. Migration #1 — `supabase/migrations/20260821000000_lgpd_account_anonymization.sql`

### 2.1 Classificação coluna a coluna (contrato — a `UPDATE` do §2.5 tem de bater com esta tabela)

#### 2.1.0 Regra estrutural — a lápide neutraliza TODA ação referencial (emenda 2026-08-21)

> **A linha de `workers`/`companies` nunca é apagada. Logo nenhum `ON DELETE` pendurado nela dispara —
> nunca mais.**

Isto é mais amplo do que "CASCADE deixou de limpar os filhos". A ação referencial só existe no ato do
`DELETE` da linha referenciada; sem esse ato, **`CASCADE`, `SET NULL` e `SET DEFAULT` viram, de fato,
`NO ACTION`**. `RESTRICT`/`NO ACTION` continuam declarados, mas o efeito deles ("bloquear o DELETE")
também vira moot, porque não há mais DELETE. O schema passa a declarar uma intenção
(`ON DELETE CASCADE` = "apague junto") que **o runtime não executa mais**.

Consequências, em ordem de importância:

1. **Toda tabela pendurada em `workers`/`companies` precisa de linha explícita nesta §2.1.** O que
   antes era de graça agora é código na RPC do §2.5. Sem a linha, o dado sobrevive **em silêncio** —
   que é o pior modo de falhar numa rotina de LGPD.
2. **Toda tabela futura também.** Isto não é manutenção de lista: é uma obrigação permanente que
   nasce hoje. Por isso a §2.2 ganha a **asserção (c)**, que enumera os dependentes por
   `pg_constraint` e **HALTa** se algum não estiver na allow-list classificada. A lista à mão passa a
   ser apenas a *declaração de que foi decidido*; quem **descobre** é o catálogo.
3. **Cascatas intra-domínio continuam valendo.** `team_list_members → team_lists(id)` dispara
   normalmente, porque `team_lists` **é** apagada. Só quebram as FKs cujo alvo é a lápide. Isso é
   explorável: apagar o pai intra-domínio limpa o filho de graça (ver `team_lists` abaixo).
4. **A assimetria worker/empresa era um bug latente.** A RPC do §2.5 (versão original) trata
   `team_list_members` e `worker_trainings` **só** dentro de `IF v_is_worker`. Uma **empresa**
   excluindo a conta deixava atrás listas, treinamentos, tetos de gasto e faturamento declarado.
   Corrigido nesta emenda.

> ADR: `.harness/memory-bank/decisions/ADR-20260821-lapide-neutraliza-acao-referencial.md`

#### 2.1.1 O limite do mecanismo: `pg_constraint` só acha dependência **declarada** (emenda 2026-08-22)

> **Uma coluna `uuid` que aponta para uma pessoa e não tem FK é uma dependência real e invisível.
> Depois de H2, ela não é um descuido: é a forma canônica.**

A asserção (c) (§2.2) enumera `pg_constraint`. Isso a torna completa para "quem pendura FK em
`workers`/`companies`" e **estruturalmente cega** para o resto. A F13 exibiu os dois lados no mesmo
dia: `company_members.company_id` **tem** FK e foi vista (a ponto de HALTar a migration); já
`organization_members.user_id` e `organizations.created_by` são **uuid nu** — invisíveis para a
asserção *e* para a resolução de escopo da RPC, que também é feita por FK.

**A resposta NÃO é "exigir FK".** É o contrário: **H2 proibiu a FK** justamente para a coluna que
mais importa. Uma FK de `organization_members.user_id → auth.users` teria que escolher entre
`ON DELETE CASCADE` — que apagaria a linha e destruiria a trilha que a decisão acima acabou de
preservar — e `NO ACTION`/`RESTRICT`, que voltaria a **bloquear o `deleteUser`**, que é exatamente
o bug (§0.1) que esta leva inteira existe para corrigir. Exigir FK aqui seria desfazer H2 por outro
nome. Logo: **"uuid nu apontando para gente" é permanente neste desenho**, e qualquer guarda que
dependa só do catálogo de FK nasce incompleta.

Daí duas varreduras novas, ambas **fail-closed** e ambas por **nome de coluna** — não por tipo
sozinho (`uuid` está em toda parte) nem por FK (que não existe):

| | O que varre | O que pegou na estreia |
|---|---|---|
| **(d)** ponteiro-de-pessoa | coluna `uuid` cujo **nome** está no vocabulário (`user_id`, `owner_id`, `created_by`, `worker_id`, `company_id`, `reviewer_id`, `recorded_by`, …) em tabela `public` fora da lista classificada | `organization_members`, `organizations` |
| **(e)** contato/identificador | coluna cujo nome casa `(email\|phone\|cpf\|cnpj\|pix\|birth_date\|full_name)` em tabela `public` fora da lista classificada | `company_members.invited_email` — e teria pego `company_spend_limits.financial_contact_email` **meses antes** |

Três propriedades deliberadas:

1. **Granularidade de tabela, não de coluna.** A allow-list continua sendo "esta tabela foi
   olhada", igual à de (c). Coluna nova em tabela já classificada segue coberta por (a)/(b) para
   `workers`/`companies`; para as demais, a decisão é de tabela.
2. **`pg_catalog`, não `information_schema`.** `information_schema` só mostra o que o papel corrente
   tem privilégio de ver — uma varredura que **falha aberto** por falta de privilégio não é guarda.
   (As asserções (a)/(b) usam `information_schema` por herança; ali o alvo é `workers`/`companies`,
   sempre visíveis. Aqui o alvo é *"tabela que eu não conheço"*.)
3. **Nome qualificado montado à mão, não `regclass::text`.** `regclass::text` **omite o schema**
   quando ele está no `search_path` — e as migrations do Supabase rodam com `public` no
   `search_path`. A asserção (c), como estava escrita, compararia `shift_payments` contra
   `'public.shift_payments'` e acusaria **todas** as tabelas. Nunca detonou porque a migration
   nunca foi aplicada. Corrigido em (c), em (d)/(e) e na varredura de CASCADE remanescente do §2.3:
   `format('%I.%I', ns.nspname, cl.relname)`, determinístico e que cita `"Message"` sozinho.

**Regra de construção (permanente, vale para F14+):** toda migration que criar tabela com
ponteiro-de-pessoa ou coluna de contato **classifica a tabela nesta §2.1 na mesma migration**. O
catálogo continua sendo quem *descobre*; a lista à mão continua sendo apenas a *declaração de que
foi decidido*. O que não pode existir é dependência **não decidida**.

> ADR: `.harness/memory-bank/decisions/ADR-20260822-fronteira-lgpd-multi-unidade.md`

#### `workers`

| Coluna | Ação | Justificativa / base legal |
|---|---|---|
| `id` | **RETIDO** | Chave **pseudônima**. É o que sustenta `shift_payments`/`service_terms`. Sem ela não há trilha fiscal. Art. 16, I. |
| `full_name` | **SUBSTITUÍDO** por `'[Conta Deletada]'` | Rótulo estável já usado pelo produto; `mask_display_name` (20260816130000) devolve `NULL` para strings `'[%'`, então a autoria em `ProfileReviews` degrada para o rótulo genérico **retroativamente**. Não usar `NULL`: a coluna é `NOT NULL` e o rótulo é o sinal de lápide. |
| `cpf` | **APAGADO** (`NULL`) | Dado pessoal sem função após o encerramento. (A cópia dentro de `term_text` aceito é retida — ver `service_terms` abaixo.) |
| `phone` | **APAGADO** | Contato. |
| `birth_date` | **APAGADO** | Dado pessoal. |
| `pix_key` | **APAGADO** | Dado de pagamento. Prioridade máxima: é o dado que a Onda 1 passou a coletar e trafegar. |
| `bio`, `city` | **APAGADOS** | Perfil livre / localização. |
| `avatar_url`, `cover_url` | **APAGADOS** | Imagem de pessoa. **O arquivo no Storage também precisa sumir** — contrato da Edge Function, §4.1(3a). |
| `primary_role`, `roles`, `tags` | **APAGADOS** | Perfil profissional. Sem valor fiscal. |
| `availability`, `availability_days` | **APAGADOS** | `availability_days` é **perfil comportamental de rotina** (débito #1). Apagar não é opcional. |
| `experience_years` | **APAGADO** | Perfil. |
| `goal` (onboarding do freela, step 3) | **APAGADO** *(emenda 2026-08-22)* | Preferência declarada de perfil ("o que você procura como freela?"), mesma classe de `primary_role`/`availability` — que esta tabela já APAGA. 12 de 15 linhas preenchidas em produção. **A tentação era retê-la** como enum: a UI é um `radio` de 3 opções fixas (`WorkerOnboarding.tsx:444`), logo "não pode conter texto livre". **Essa justificativa é exatamente a que a asserção (b3) desta migration existe para recusar:** o conjunto fechado vive no componente React, não no schema — a coluna é `text` **sem CHECK**, e um `PATCH` direto no PostgREST (a policy de UPDATE de `workers` é `id = auth.uid()`, o próprio titular escreve) grava qualquer prosa. Conjunto fechado sem evidência no catálogo não é conjunto fechado. Apagar custa uma atribuição e é correto nas duas hipóteses. |
| `address`, `address_number`, `postal_code`, `province` | **APAGADOS** *(emenda 2026-08-22)* | Endereço residencial do freela. **0 linhas preenchidas hoje, e isso não é argumento** — coluna de endereço vazia continua sendo coluna de endereço. A régua é a mesma que já se aplicou a `companies.address` (APAGADO) e a `workers.city` (APAGADO); reter aqui exigiria um argumento que sobrevivesse ao dia em que alguém preenchesse, e não existe. Sobre a **origem**: são, campo a campo, o cadastro de `customer` do Asaas (`postalCode`/`addressNumber` aparecem hoje só em `asaas-tokenize-card` e em `paymentMethodService.SaveCardInput`, **nunca lidos de `workers`**) — resíduo de um caminho que nunca chegou a escrever aqui e que a pausa do processamento de pagamento (ADR-20260822) tornou ainda mais improvável. A origem justifica a **recomendação de DROP** (ver §5.4 / débito), não a retenção. |
| `income_value` | **APAGADO** *(emenda 2026-08-22)* | Renda declarada — dado pessoal financeiro, a classe mais sensível desta tabela depois de `cpf`/`pix_key`. 0 linhas hoje; mesmo raciocínio do bloco acima, com margem ainda menor: se um dia for preenchida e não estiver classificada, sobrevive **em silêncio** a uma exclusão de conta. Mesma origem (cadastro de `customer` Asaas). |
| `stripe_account_id` | **APAGADO** *(emenda 2026-08-22)* | Identificador da pessoa num **terceiro** (gateway). Ainda que o Stripe esteja fora do produto, um identificador externo persistido é ponteiro-de-pessoa: se a coluna tiver valor, ela **é** dado pessoal, e a origem morta não o torna menos pessoal. 0 linhas hoje. |
| `stripe_onboarding_completed` | **`false`** *(emenda 2026-08-22)* | **Não é "retida por ser boolean sem conteúdo pessoal"** — esta justificativa já foi recusada uma vez nesta mesma tabela (`badges_hidden`, emenda 2026-08-21). Aqui o motivo é outro e mais simples: é uma **afirmação sobre uma identidade que deixou de existir**, exatamente como `verified_identity`. Deixar `true` ao lado de um `stripe_account_id` recém-apagado é deixar o registro afirmando um fato que ele não pode mais sustentar. |
| `verified_identity` | **`false`** | Afirmação sobre uma identidade que não existe mais. |
| `badges_hidden` (F12, 20260817001400) | **`true`** *(emenda 2026-08-21)* | **Não é "retida por ser boolean sem conteúdo pessoal".** O badge "Já trabalhou com" é **derivado** de `applications`/`jobs`/`reviews` — todos **RETIDOS**. `get_worker_company_badges` (20260817001400:159) só zera a seção quando `w.badges_hidden`. Como a lápide **apaga** `worker_company_badge_prefs` (o opt-out por empresa, abaixo), deixar `badges_hidden=false` faria o grafo "onde essa pessoa trabalhou" **ressuscitar** para toda empresa que ainda passa em `can_view_worker_profile` (ramo `applications`, que sobrevive). Forçar `true` é o único ponto único que fecha a seção inteira. Mesma classe de `verified_identity=false`: afirmação sobre um perfil que não existe mais. |
| `accepts_referrals` (F10, 20260817001500) | **`false`** *(emenda 2026-08-21)* | Default é `true`. `create_worker_referral` lê esta coluna (20260817001500:503) como opt-in. O caminho já está fechado a montante (a indicação exige `team_connections` aceita, e a lápide **apaga** `team_connections`), mas defesa em profundidade custa uma atribuição: uma pessoa que pediu para ser eliminada não permanece **oferecível** a outras empresas. |
| `discoverable_for_sos` (F11, 20260817001600) | **`false`** *(emenda 2026-08-21)* | **Este não é opcional.** O pool de SOS é calculado no disparo por `... WHERE discoverable_for_sos` (20260817001600:305) — **sem** filtro de `anonymized_at`, que não existia quando F11 foi escrita. Um freela que tinha optado por `true` continuaria sendo alcançado por chamados de empresas fora do Elenco **depois de excluir a conta**. Alternativa considerada e rejeitada: emendar o predicado de `create_sos_call` com `AND anonymized_at IS NULL` — corrige um consumidor e deixa os próximos por conta da memória de quem escrever. Zerar a flag na lápide corrige na fonte. (Emendar o predicado também é bom-vindo depois; não substitui isto.) |
| `xp`, `level`, `rating_average`, `reviews_count`, `completed_jobs_count`, `earnings_total`, `profile_views`, `recommendation_score`, `views` *(os dois últimos: emenda 2026-08-22)* | **RETIDOS** | Agregados numéricos sobre chave pseudônima; não identificam. `earnings_total` alimenta BI. Zerá-los reescreveria histórico agregado sem ganho de privacidade. **`recommendation_score`** (numeric, exibido em `WorkerPublicProfile`) e **`views`** (integer, contador legado sem consumidor no repositório — sucedido por `profile_views`, 20260317140300) entram por este mesmo raciocínio, e o argumento **sobrevive ao dia em que forem preenchidas**: escalar ou contar sobre uma chave pseudônima continua não identificando ninguém, com 0 ou com 10.000 de valor. É a diferença categórica para o bloco de endereço/renda acima, cujo conteúdo **é** a pessoa. |
| `accepted_tos`, `tos_accepted_at`, `tos_version` | **RETIDOS** | Prova de que o contrato de uso foi aceito, e quando. Art. 7º, V (execução de contrato) e VI (exercício de direito em processo). Apagar é destruir a defesa do controlador. |
| `onboarding_completed`, `created_at`, `updated_at` | **RETIDOS** | Metadado operacional, não identifica. |
| `anonymized_at` | **NOVO**, recebe `now()` | Marca a lápide. Permite ao produto (e a uma auditoria) distinguir "conta ativa sem foto" de "conta excluída". |

#### `companies`

| Coluna | Ação | Justificativa |
|---|---|---|
| `id`, `owner_id` | **RETIDOS** | Chaves pseudônimas; âncora de `shift_payments.company_id`, `service_terms.company_id`, `jobs.company_id`. |
| `name` | **SUBSTITUÍDO** por `'[Empresa Deletada]'` | Rótulo estável (já usado hoje pelo `delete-account`). |
| `cnpj` | **APAGADO** | CNPJ de PJ não é, por si, dado pessoal — mas de MEI/EI identifica pessoa natural. Apaga-se por precaução; a retenção fiscal vive em `shift_payments`/`service_terms`, não aqui. |
| `city` (20260317140000 — **em produção desde março**) | **APAGADO** *(emenda 2026-08-21)* | Decisão escrita, não omissão. O argumento "empresa é PJ, cidade é dado comercial" **falha nos próprios termos deste documento**: (1) `address` já está classificado como APAGADO, e `city` é um **subconjunto estrito** de `address` — reter a cidade é re-derivar parte de um dado que a linha acima já decidiu apagar; (2) o mesmo raciocínio que apaga `cnpj` ("de MEI/EI identifica pessoa natural") vale aqui, e no piloto o cliente típico é uma unidade de rede/restaurante onde `companies.id = auth.uid()` de uma pessoa física; (3) simetria com `workers.city`, APAGADO. Perda aceita: BI regional sobre lápides. É uma minoria e o `id` pseudônimo continua ancorando `jobs`/`shift_payments`, que é onde o BI de operação vive de verdade. |
| `email`, `address`, `website`, `description`, `industry`, `logo_url`, `cover_url`, `default_briefing` | **APAGADOS** | Conteúdo identificável ou livre. `default_briefing` é texto da empresa e pode conter nomes. |
| `rating_average`, `reviews_count`, `link_risk_alert_enabled`, `link_risk_alert_threshold` | **RETIDOS** | Agregado / configuração sem conteúdo pessoal. |
| `anonymized_at` | **NOVO**, `now()` | Idem `workers`. |

#### `service_terms` (usa `anonymized_at`, como o gate exigiu)

| Situação | Ação | Justificativa |
|---|---|---|
| `accepted_at IS NULL` (**rascunho**) | `term_text` → marcador de redação; `anonymized_at` → `now()` | Rascunho não foi aceito, **não tem valor probatório nenhum** e carrega nome + CPF renderizados. Não há base legal para reter. |
| `accepted_at IS NOT NULL` (**aceito**) | `term_text` **RETIDO INTEGRALMENTE**; `accepted_ip` e `accepted_user_agent` → `NULL`; `anonymized_at` → `now()` | O termo aceito é a prova da transação encerrada entre empresa e freela — art. 7º, VI e art. 16, I; o COMMENT da própria coluna já declara essa retenção ("termo assinado é retido como prova", ADR-20260818). O que **não** é elemento do negócio jurídico é a telemetria do aceite: IP é dado pessoal autônomo e `user-agent` é fingerprint de dispositivo. Ambos são declarados `BEST-EFFORT e FALSIFICÁVEIS` pelo próprio schema — retê-los não sustenta prova alguma e só aumenta a superfície. |
| `amount`, `accepted_at`, `job_id`, `worker_id`, `company_id`, `term_version` | **RETIDOS** (imutáveis por trigger, e corretamente) | São o negócio jurídico. |

> **Extensão semântica declarada:** `anonymized_at` passa a significar "esta linha passou pela rotina
> de anonimização de conta". A reescrita de `term_text` acontece **só** no ramo rascunho. O COMMENT da
> coluna é atualizado em §2.4 — não deixar a semântica antiga mentindo no schema.

#### Demais tabelas

| Tabela | Ação | Justificativa |
|---|---|---|
| `shift_payments` | **INTOCADA** | Documento fiscal declaratório. Nenhuma coluna de dado pessoal além de `note` (texto da empresa) — risco residual em §5.3. Nenhuma mudança no trigger de imutabilidade. |
| `worker_certifications` | **DELETE** | Documento profissional pessoal (título, emissor, **número de registro de conselho**). Zero valor fiscal. `UPDATE` seria barrado pelo ramo (c) do trigger F8; `DELETE` não passa por trigger `BEFORE UPDATE`. |
| `worker_trainings` (do freela) | **DELETE** | Registro da empresa sobre o freela; sem valor fiscal, e a empresa perde só um apontamento interno. |
| `team_connections` | **DELETE** (`worker_id` ou `company_id`) | Vínculo consentido; o consentimento acabou. `service_role` ignora a guarda de `blocked`. |
| `team_list_members` | **DELETE** | Idem. **Dois ramos** (emenda): pelo `worker_id` (freela sai das listas alheias) **e** por cascata intra-domínio quando `team_lists` da empresa é apagada. |
| `team_lists` | **DELETE** (`company_id`) *(emenda 2026-08-21)* | Não estava classificada — a CASCADE para `companies` não dispara mais. `name` é texto livre de até 60 chars escolhido pela empresa e **pode conter nome de pessoa** ("Turma da Ana"). Apagar `team_lists` limpa `team_list_members` **de graça**: aquela FK aponta para `team_lists(id)`, que é apagada de verdade (§2.1.0, item 3). |
| `company_spend_limits` | **DELETE** (`company_id`) *(emenda 2026-08-21)* | **Achado desta emenda.** Carrega `financial_contact_email` e `financial_contact_phone` (20260623000000:60–64) — **contato de pessoa natural** dentro de uma tabela de configuração, que ninguém classificou porque a CASCADE dava conta. Hoje sobreviveria à exclusão da conta em silêncio. Zero valor fiscal: é teto de gasto e destinatário de alerta. |
| `company_monthly_revenue` | **DELETE** (`company_id`) *(emenda 2026-08-21)* | Faturamento bruto **declarado pela própria empresa** como input do BI de custo-%-faturamento dela. Nenhuma obrigação legal do Worki sobre esse número, nenhum consumidor além do dono. O titular pediu para sair. |
| `job_series` | **DELETE** (`company_id`) *(emenda 2026-08-21)* | `job_template jsonb` carrega o briefing do turno — mesma classe de `companies.default_briefing`, que é APAGADO. Seguro por construção: **não existe FK de `jobs` para `job_series`** (ADR-20260817-serie-eager-e-cancelamento-suave, decisão 1 — a ocorrência materializada é canônica e autônoma). As ocorrências em `jobs` **permanecem** (pseudônimas, sustentam BI e `shift_payments`); `jobs.series_id` fica pendurado num molde inexistente, que é exatamente o estado que o desenho EAGER já previa. Perda aceita: a auditoria "o que a empresa pediu" — cujo único público era a empresa que saiu. |
| `worker_trainings` (**ramo empresa**) | **DELETE** (`company_id`) *(emenda 2026-08-21)* | A linha de cima cobre o freela excluído. Faltava o inverso: uma **empresa** excluindo a conta deixava para trás anotações internas (`title`, `note`) que ela escreveu **sobre terceiros que continuam na plataforma**. Mesma justificativa da linha original: sem valor fiscal, apontamento interno. |
| `worker_certifications.verified_by_company_id` | **RETIDO** (nada a fazer) *(emenda 2026-08-21)* | O `ON DELETE SET NULL` também deixou de disparar (§2.1.0) — a certificação de **outro** freela mantém o uuid da empresa excluída e o `verified_note`. **Decisão: não mexer**, por três razões que se somam: (a) o uuid é chave **pseudônima** e a UI resolve para `'[Empresa Deletada]'` — a mesma degradação graciosa de que `reviews` já depende; (b) o par `verified_by_company_id`/`verified_at` é travado por CHECK (conferência anônima é estado inexpressável), então "só limpar o id" **não é expressável**; (c) um `UPDATE` aqui seria **barrado pelo ramo (c)** de `enforce_certification_update_scope` (§0.3) — a mesma armadilha que já obrigou `DELETE` em vez de `UPDATE`. `verified_note` é texto sobre terceiro escrito pela empresa que saiu → **risco residual**, §5.3. |
| `worker_referrals` | **DELETE** (`worker_id` **ou** `referring_company_id` **ou** `requesting_company_id`) *(emenda 2026-08-21)* | Confirmado o palpite do evaluator: **mesma régua de `team_connections`**, e por um motivo mais forte do que "a CASCADE não dispara". A linha é um **grafo de relacionamento sobre uma pessoa que pediu para ser eliminada** — três partes, mais `message` (até 500 chars que uma empresa escreveu **sobre** o freela: "a Ana é ótima no salão"). Não há valor fiscal nem probatório: `service_terms` e `shift_payments` é que provam transação. **O BI de aquisição não se perde:** a proveniência sobrevive em `team_connections.source='referral'` (20260817001500), que é justamente onde ela foi desnormalizada. Os **três** predicados são obrigatórios — a indicação é um triângulo, e apagar só pelo `worker_id` deixaria de fora a empresa que sai tendo indicado ou sido indicada. |
| `worker_company_badge_prefs` | **DELETE** (`worker_id` **ou** `company_id`) *(emenda 2026-08-21)* | Confirmado DELETE — **mas o DELETE sozinho é uma regressão de privacidade** e é isso que a emenda corrige. A linha é o **opt-out do freela** ("não mostre que trabalhei na empresa X"); o badge em si é derivado de `applications`/`jobs`/`reviews`, todos RETIDOS. Apagar o veto sem mais nada **ressuscita** o badge que ele suprimia, para toda empresa que ainda passa em `can_view_worker_profile` pelo ramo `applications`. Por isso o DELETE só é aceito **acompanhado** de `workers.badges_hidden = true` (ver tabela `workers`), que é a chave-mestra e fecha a seção inteira num ponto só. **DELETE e a flag andam juntos ou nenhum dos dois vai.** |
| `notifications` | **DELETE** (`user_id`) | Títulos e mensagens contêm nome, valor e link. |
| `payment_methods` (empresa) | **DELETE** | Token de cartão. ~~**Também revogar no Asaas**~~ — **não há revogação verificada; o token PERMANECE no processador.** Ver §4.1-4b (o que a Edge Function faz e o que lhe é proibido), §5.3 (retenção declarada + gate de publicação) e §5.4 J5 (decisão de owner/jurídico). *(emenda 2026-08-22)* |
| `shift_call_targets`, `shift_attendance_confirmations` | **RETIDOS** — e agora **dentro do fecho** da asserção (b2). *(revisão 2026-08-22)* | Chaves pseudônimas + timestamps, **e só isso** — agora conferido no catálogo, não afirmado. As **quatro** colunas textuais das duas (`source`, `response`, `origin`, `response`) são **enums com `CHECK` de conjunto fechado**: `'auto'|'manual'`, `NULL|'confirmed'|'cannot_attend'`, `'team'|'sos'`, `NULL|'accepted'|'declined'|'closed'`. **Não há coluna `jsonb`/`json` em nenhuma das duas** — o `metadata jsonb` que o `architecture.md` descrevia (junto de `confirmation_status`, `created_at`, `request_sent_at`, `worker_responded_at`) **não existe em produção**: a tabela real é `id, application_id, job_id, worker_id, source, requested_by, requested_at, response, responded_at`. O risco residual que este contrato registrava sobre `metadata` era herdado de documentação errada e foi **anulado**. Art. 7º, IX sobre dado pseudônimo. |
| `jobs` | **LINHA RETIDA, TEXTO LIVRE REDIGIDO** — `briefing`, `description`, `requirements`, **`certification_requirement`** → marcador `'[CONTEUDO REMOVIDO …]'`. Predicado: `company_id = ANY(<empresas do titular>)`. `title`, `location` e todo o resto **RETIDOS**. *(emenda 2026-08-22; `certification_requirement` na revisão do mesmo dia, após varredura de catálogo)* | **Correção de uma incoerência do próprio contrato, não classificação nova.** A versão anterior desta linha declarava `jobs` retida porque "nenhum conteúdo pessoal" — e isso é **falso**: `briefing` é texto livre da empresa, da **mesma classe** de `companies.default_briefing`, que esta rotina **APAGA** por "pode conter nomes", e de `job_series.job_template`, que esta rotina **DELETA** dizendo "mesma classe de `default_briefing`". E `create_job_series` (20260817000400) escreve `jobs.briefing` **copiando `job_template` literalmente**: a rotina apagava o molde e guardava as cópias. `description`/`requirements` são o mesmo campo de texto livre por outro nome — distinguir um do outro seria arbitrário. **A linha não pode sair** (âncora de `shift_payments`/`service_terms`, BI, integridade), então sai o **conteúdo**: é exatamente o padrão de `ADR-20260821-expurgo-de-conteudo-nao-de-linha`, aplicado agora fora do expurgo por prazo. **Marcador e não `NULL`:** `title`/`location` provam que este schema tem coluna textual `NOT NULL`, a lista vai crescer, e um `NULL` em coluna `NOT NULL` estouraria **dentro** da transação destrutiva; o marcador também explica o vazio para a contraparte em vez de parecer defeito. **`title`/`location` ficam, e é decisão escrita:** não são narrativa livre, são o rótulo operacional e o local que o **freela — terceiro que continua na plataforma** — lê no próprio recibo; e ambos já estão **congelados** dentro de `service_terms.term_text` aceito, que é RETIDO INTEGRALMENTE como prova. Apagar aqui não elimina a informação e degrada o registro de terceiro sobre transação encerrada. Risco residual em §5.3. **`certification_requirement` (F8)** entrou na revisão: é `<input maxLength={200} placeholder="Ex: CREF válido">` (`CompanyCreateJob.tsx:466`) e o próprio código a declara "texto livre ≤200, advisory" — a empresa escrevendo exigência **em prosa**, que nomeia credencial, condição e pode nomear pessoa. Mesma classe de `briefing`; **0 linhas hoje só porque o F8 acabou de subir**, e classificar depois de haver dado é classificar tarde. |
| `applications` | **LINHA RETIDA, `cover_letter` e `message` REDIGIDAS** (marcador). Predicado: `worker_id = <titular>` — **só o ramo freela**. *(emenda 2026-08-22)* | `cover_letter` é texto que o **freela escreveu sobre si mesmo** (nome, telefone, histórico) no fluxo pull legado. Zero valor fiscal ou probatório — quem prova a transação é `service_terms`/`shift_payments`. **Sem ramo empresa:** o texto pertence ao freela; a empresa que sai não apaga o que o freela escreveu. Hoje há 0 linhas preenchidas em produção, mas a coluna existe e a UI escreve nela — classificar depois de haver dado seria classificar tarde. **`message`** entra pelo mesmo motivo, e a decisão é deliberada apesar de a coluna estar morta: 0 linhas, nenhuma escrita no frontend, aparentemente legada do modelo pull — mas o **nome e o tipo são os de texto livre do titular**, mesma classe de `cover_letter` e de `workers.bio`, que §2.1 APAGA. Classificar coluna vazia custa uma linha; classificar depois que ela enche custa uma migration nova **e** um intervalo em que o dado sobreviveu à exclusão. `invitation_response` fica **retida**: 11 linhas, **1 valor distinto**, 8 caracteres — é enum (`accepted`/`declined`) em coluna `text`, conferido no catálogo, não presumido. |
| `shift_calls` | **LINHA RETIDA, `message` REDIGIDA** (marcador). **Dois** predicados: `company_id = ANY(<empresas>)` **ou** `created_by = <titular>`. *(emenda 2026-08-22)* | Texto livre que a empresa (ou o **gerente** dela) escreveu no disparo 1→N — mesma classe do `message` de `worker_referrals`, que esta rotina **DELETA**. **O predicado tem de ser explícito e duplo:** `shift_calls.company_id` e `created_by` são `uuid` **nu, sem FK** (conferido no catálogo de produção — §2.1.1), então nada aqui é alcançado por cascata; e `created_by` é a **única** forma de chegar ao texto escrito pelo **gerente**, cuja unidade pertence a outro dono e portanto nunca aparece em `v_company_ids`. `reason`, `status` e `origin` ficam: são enums com `CHECK` de conjunto fechado **conferido no catálogo** em 22/08 (`falta|demissao|…`, `open|filled|cancelled|expired`, `team|sos`) — classe de evidência forte, vigiada pela asserção **(b3)**. |
| `reviews` | **RETIDAS** | O texto pertence ao autor e descreve a contraparte (reputação de terceiro). A autoria degrada sozinha: `get_profile_reviews` resolve o nome **ao vivo** em `workers`, e a lápide `'[Conta Deletada]'` faz `mask_display_name` devolver `NULL`. É por isso que `reviewer_name` nunca foi desnormalizado (20260816130000). |
| `wallets`, `wallet_transactions`, `escrow_transactions` | **INTOCADAS — Article 8/9** | Nenhum `UPDATE` de saldo, nenhum `DELETE` de linha de razão. A rotina **recusa** rodar se houver saldo > 0 ou escrow ativo. |
| `company_members` (F13) | **SOFT-REMOVE** — `status='removed'` + `invited_email = NULL` + `invite_token = NULL`. **TRÊS** predicados: `user_id = <titular>` **ou** `company_id = ANY(<empresas do titular>)` **ou** (`status='invited' AND created_by = <titular>`). *(emenda 2026-08-22; 3º predicado na revisão do mesmo dia)* | **A classificação é decisão de produto, não manutenção de lista.** As três opções e por que só uma sobra: **(a) DELETE** — a própria F13 já recusou apagar este vínculo (`revoke_company_manager`: "NUNCA DELETE"; `ON DELETE RESTRICT` em `company_id`), e a rotina de LGPD não pode ser a porta dos fundos que faz o que a RPC do produto proíbe. Some o registro de quem operou a unidade e quando, enquanto os turnos, convites e pagamentos criados por essa pessoa **continuam existindo**, pendurados na unidade, sem referência de autoria. **(b) RETER** — errado e sem discussão: `status='active'` é autorização operacional; quem pediu exclusão não pode seguir com alcance sobre a unidade. **(c) SOFT-REMOVE** — fecha o acesso e preserva a trilha. É o que fica. **O que sai é PII, não a linha:** `invited_email` é e-mail de pessoa natural — dado pessoal **direto**, não pseudônimo, e é *o* item de PII desta tabela; `invite_token` é credencial portadora e um convite pendente de conta excluída não pode continuar resgatável. **O que fica é pseudônimo:** `user_id`/`created_by` são uuid apontando para uma lápide — mesma régua já aceita em `worker_certifications.verified_by_company_id`; `invited_at`/`accepted_at` são a trilha que justifica o soft. **O segundo predicado não é simetria decorativa:** quando a **empresa** sai, seus gerentes são terceiros que continuam na plataforma — a unidade virou lápide (ninguém opera lápide) e o e-mail deles perde a base que o sustentava. **O terceiro predicado fecha um buraco que a abertura do portão para a classe gerente/sócio (§2.5) tornou alcançável:** quem emite convite de gerente é o **operador de rede** (`invite_company_manager` exige `is_organization_operator`), logo ele convida para unidades **irmãs**, que **não** estão em `v_company_ids`. Sem ele, a exclusão apagaria a credencial e deixaria linhas `status='invited'` com `invited_email` **de terceiro** e `invite_token` **vivo** (índice único, validade de 7 dias), assinadas por uma conta que não existe mais — credencial portadora resgatável emitida por ninguém. **E ele é restrito a `status='invited'` de propósito:** a linha **ativa** pertence ao **gerente**, terceiro que continua operando uma unidade de **outro** dono; ali `created_by` é só a trilha de quem convidou, e derrubar o acesso dele porque o convidante saiu seria dano a terceiro. É a **simetria exata** do predicado de `organization_members`, que já carregava este ramo com esta justificativa — a assimetria era o defeito. |
| `organization_members` (F13) | **SOFT-REMOVE** — `status='removed'` + `invited_email = NULL` + `invite_token = NULL`. Predicados: `user_id = <titular>` **ou** (`status='invited' AND created_by = <titular>`). **Sem ramo por `company_id`.** *(emenda 2026-08-22)* | Mesma régua de `company_members`, com uma diferença que **não pode ser copiada errado**: a organização pertence também às unidades **irmãs, de outros sócios**. Excluir a conta de um sócio **não** desliga os demais — por isso não existe predicado por empresa aqui. O segundo predicado cobre o convite **ainda pendente** emitido por quem está saindo: um convite de rede assinado por uma conta que deixou de existir não deve continuar aceitável, e carrega o e-mail de um terceiro. Esta tabela **não tem FK nenhuma** para `workers`/`companies`/`auth.users` — foi por isso que passou despercebida; ver §2.1.1. |
| `organizations` (F13) | **RETIDA** (nada a fazer — declarado, não esquecido) *(emenda 2026-08-22)* | `name` é o nome da **rede**, compartilhado com as unidades irmãs de outros sócios: apagar ou branquear seria dano a terceiro. `created_by` é uuid pseudônimo apontando para lápide (régua de `verified_by_company_id`). Não há coluna de contato. **Mas a retenção só é segura junto com a GUARDA 4** (§2.5): sem ela, fechar os `organization_members` do último dono deixaria a rede **órfã** — ninguém passa em `is_organization_operator`, e os dois `ON DELETE RESTRICT` (`companies.organization_id` e `organization_members.organization_id`) impedem qualquer limpeza. Rede inoperável **e** inapagável. |
| `companies.organization_id` (F13) | **RETIDA** *(emenda 2026-08-22)* | FK pseudônima para a rede, que sobrevive por causa das irmãs. Além disso a Fase 1 da F13 põe `NOT NULL` nesta coluna — branquear seria inexpressável. |
| `"User"`, `"ClientReview"`, `"FreelancerReview"`, `"_JobToSkill"`, `"_FreelancerProfileToSkill"`, `messages` (legado Prisma) | **FORA da RPC — dívida declarada** *(emenda 2026-08-22)* | Apareceram quando a varredura por nome (§2.1.1) passou pela primeira vez. Mesmo tratamento já dado a `Message`/`Conversation`: schema legado **não auditado** não entra numa RPC transacional de LGPD sem verificação. Constam da allow-list **para não HALTar**, o que significa "olhamos e adiamos", não "está resolvido" — risco residual em §5.3. Não copiar este tratamento para tabela viva. |
| `Message` / `Conversation` (legado) | fora da RPC | Continua na Edge Function (§4.1). Schema legado não auditado aqui — não entra numa RPC transacional sem verificação. |

### 2.1.2 Ordem de replay: os dois ambientes falhavam de formas diferentes (emenda 2026-08-22)

A F13 Fase 0 é `20260818100000`; esta migration é `20260821000000`. Logo:

| Ambiente | Ordem real | Sem esta emenda |
|---|---|---|
| **CI / staging** (replay do zero) | F13 **antes** | `company_members` existe quando a asserção (c) roda → **HALT**. Ruidoso, mas honesto: uma entrega de segurança já aprovada fica travada, e a descoberta acontece no pior momento. |
| **Produção** (fila incremental — nada da leva aplicado) | LGPD **antes** | A asserção não vê `company_members`; a F13 sobe depois e **nada avisa**. A lacuna passa em **silêncio**. |

Falhar de dois jeitos diferentes conforme o ambiente é o pior estado possível — é o que faz o teste
verde mentir. Como **nada** das duas levas foi aplicado, a correção custa uma edição de arquivo:
classificar aqui, antes de qualquer `db push`. Depois de aplicado, custaria uma migration nova.

**Sobre o rebatismo das correções da F13** (`2026081810xx` → `2026082100xx`): está **correto e é
necessário**, e não conflita com esta leva. Verificado que `20260821001000_seam_irmas_delegam.sql`
redefine `can_view_worker_profile`, `list_team_connection_cards`, `can_view_reviews_of` e
`get_profile_reviews` — as **quatro** funções que `20260821000100` e `20260821000300` (DS-PII-1..3)
acabaram de endurecer. Com os nomes antigos, o LGPD escreveria por último e a delegação da F13
sumiria (F13 quebrada, sem regressão de segurança); com os nomes novos, a F13 escreve por último.
Os corpos da F13 **são supersets explícitos** dos baselines DS-PII (o ramo `'pending'` segue
removido, com o comentário "NAO REINTRODUZIR"; só a ancoragem muda) — então o rebatismo é seguro.
**Recomendação para o dono da F13** (não editado aqui: é o worktree `worki12-multi-unidade`): o
arquivo `20260821001000` afirma seu baseline apenas em comentário e só *asserta* a existência de
`is_company_owner`. Acrescentar uma asserção de que o baseline DS-PII está aplicado — o mesmo
padrão "falha fechado se a #1 não estiver aplicada" que a migration #3 do expurgo já usa — tira o
resultado da mão da ordem alfabética.

### 2.2 Cabeçalho e asserções de schema — *ponteiro*

> **Corpo: `supabase/migrations/20260821000000_lgpd_account_anonymization.sql`, seção 1
> (`ASSERÇÕES DE SCHEMA`).** Não reproduzido aqui — ver a **regra de normatividade** no topo.
> A lista de colunas e de tabelas dentro das asserções é **derivada** da classificação de §2.1;
> quando as duas divergirem, §2.1 é a decisão e o arquivo é a escrita.

O que é normativo **aqui** é *o que cada asserção precisa garantir* — não como está escrita:

| | Garante | Falha fechado quando |
|---|---|---|
| **(a)** | toda coluna que a rotina pretende apagar em `workers`/`companies` **existe** | coluna sumiu ou foi renomeada |
| **(a2)** | toda coluna a ser **redigida** (`jobs`, `applications`, `shift_calls`) existe **e é textual** | tipo mudou sob a rotina |
| **(b)** | nenhuma coluna de `workers`/`companies` fica **fora** da classificação (apagada **ou** retida) | coluna nova não classificada = dado sobrevivendo em silêncio |
| **(b2)** | fecha a classificação **textual** de `jobs`, `applications`, `shift_calls`, `shift_call_targets`, `shift_attendance_confirmations` | coluna `text` nova em tabela retida |
| **(b3)** | as colunas retidas **por serem enum** ainda têm `CHECK` de conjunto fechado, na forma `<coluna> = ANY (ARRAY[...])` adjacente ao nome | a evidência sumiu — a guarda confere a evidência, não a lista |
| **(c)** | nenhuma **tabela dependente** de `workers`/`companies` (via `pg_constraint`) fica fora de §2.1 | FK nova não classificada (§2.1.0) |
| **(d)** | nenhuma tabela com **ponteiro-de-pessoa** (`uuid` cujo *nome* está no vocabulário) fica fora | tabela sem FK, invisível a (c) (§2.1.1) |
| **(e)** | nenhuma tabela com coluna de **contato/identificador** (nome casando `email`, `phone`, `cpf`, `cnpj`, `pix`, `birth_date`, `full_name`) fica fora | idem |

**Regra que não se negocia, e que é a razão de a asserção existir:** adicionar um nome à allow-list
**não** é "fazer passar" — significa *"eu decidi o que acontece com essa tabela e escrevi na §2.1"*.
Editar a lista às cegas transforma a guarda em decoração.

#### 2.2.1 Promoção pendente no arquivo — Hh5 (2026-08-22)

> **Decisão registrada aqui; escrita pendente no `.sql`.** É o primeiro uso deliberado da regra de
> normatividade do topo, e por isso o handoff está escrito em vez de acontecer em silêncio.

`20260822000400_checks_enum_jobs_applications.sql` foi **aplicada em produção** e deu `CHECK` de
conjunto fechado a três colunas que este contrato classificava como classe fraca:

| Coluna | `CHECK` aplicado | Efeito na classificação |
|---|---|---|
| `jobs.status` | `open`, `paused`, `deleted` | classe fraca **->** forte |
| `jobs.budget_type` | `hourly`, `daily`, `project` | classe fraca **->** forte |
| `applications.status` | 13 valores (ver 2.2.1.a) | classe fraca **->** forte |

**Ação, e ela é no arquivo:** mover os três nomes de `v_retained_text` para `v_enum_text` na
**seção 1** de `20260821000000_lgpd_account_anonymization.sql`. A migration **ainda não foi
aplicada**, então é edição de arquivo — não migration nova. Depois disso a asserção **(b3)** passa a
vigiá-las: derrubar o `CHECK` vira **HALT**, não mentira silenciosa.

**O que NÃO muda:** as três continuam **retidas** e **não redigidas**. A promoção é sobre *quem
garante a evidência* (o banco, agora, em vez do `CompanyCreateJob.tsx`), não sobre o destino do dado.

##### 2.2.1.a O domínio de `applications.status` tem **13** valores, não os 10 da união TS

Três valores que **nenhum código escreve** mas que o **banco espera encontrar**, e por isso estão no
`CHECK`:

- `'applied'` e `'accepted'` — vivem no **predicado** de `update_job_series_future` e
  `stop_job_series` (`20260817000400`). Omiti-los faria as RPCs de série deixarem de casar linhas
  que elas hoje casam.
- `'approved'` — é **testado pelo trigger vivo** `validate_application_update` (`20260622000300`).

**Por que isso passou despercebido até agora:** `types/index.ts` declara
`status: ApplicationStatus | string` *(ilustração não-normativa)*. Com o `| string`, a união **não
tipa nada** — ela documenta uma intenção e não recusa valor nenhum. Qualquer trecho deste contrato,
ou de qualquer outro, que tenha tratado a união TS como se fosse o domínio estava **lendo
documentação como se fosse garantia**. É o Article 4 outra vez, um andar acima: não é só o filtro no
client que é UX — **o tipo no client também é**, quando ele tem `| string`.

##### 2.2.1.b `'paused'` prova a regra: dado de hoje não é domínio

`'paused'` está no `CHECK` de `jobs.status` e **não existe em nenhuma linha de produção** — nenhuma
empresa pausou turno ainda. Entrou porque **o botão Pausar existe**.

Montar o domínio com `SELECT DISTINCT` teria produzido um `CHECK` que passa em 100% da base e
**quebra no primeiro clique** em "Pausar". A simétrica também é verdadeira e apareceu no mesmo
levantamento: `jobs.scope`/`type` têm valores **órfãos** em produção (`'full-time'`, `'hybrid'`) que
**não existem em lugar nenhum do repositório** — montar o domínio pelo código teria quebrado a
edição de toda linha legada.

**A regra, nas duas direções:** o domínio é a **união** do que o código escreve, do que o banco lê e
do que a UI oferece — nunca só o `SELECT DISTINCT`, nunca só o `grep`. Este documento já dizia isso
sobre o **catálogo × repositório** (§2.1.2, §3.3); Hh5 mostra que vale também para **dados ×
código**. É a mesma nota de §5.4/Hh6 sobre confiar na evidência em vez da lista, com o sinal
trocado: ali o risco era promover demais, aqui era restringir demais.


> **Nota sobre a asserção (c) — por que ela cobre `SET NULL` também.** O filtro **não** discrimina
> `confdeltype`. É de propósito: `RESTRICT`/`NO ACTION` continuam sendo dependência que a rotina
> precisa ter pensado (é o caso de `shift_payments`/`service_terms`, cuja decisão foi "INTOCADA"),
> e `SET NULL` é justamente o caso de `worker_certifications.verified_by_company_id`, que também
> deixou de disparar. Uma dependência **decidida como "nada a fazer"** entra na lista igual — o que
> não pode existir é dependência **não decidida**.

### 2.3 Quebra das CASCADEs para `auth.users` — *ponteiro*

> **Corpo: `20260821000000_lgpd_account_anonymization.sql`, seções 2 e 3.** Não reproduzido — ver a
> regra de normatividade no topo.

Normativo **aqui** (a decisão, não a escrita):

1. **Descoberta dinâmica do nome da constraint.** As tabelas foram criadas fora de migration; o nome
   `workers_id_fkey` **não** está no repositório. Hard-codar nome é proibido — enumerar
   `pg_constraint` e executar `format(...)`. É o caso em que `regclass::text` é **correto** (o nome
   vai ser executado, não comparado contra literal; ver a regra no topo).
2. **Alvo exato:** as FKs `workers`, `companies` e `wallets` -> `auth.users`. Nada mais.
3. **Varredura do que sobrou:** qualquer **outra** FK `CASCADE` para `auth.users` fora da allow-list
   (`notifications`, `analytics_events`, `"Message"`, `"Conversation"`) **HALTa** — cascata não
   revisada é dado retido que `deleteUser` destrói em silêncio.
4. **Marcador de lápide:** `anonymized_at timestamptz` **nullable e sem `DEFAULT`** nas duas tabelas
   (sem reescrita de heap), com `COMMENT` explicando que a linha sobrevive por ser chave pseudônima,
   e índice **parcial** `WHERE anonymized_at IS NOT NULL` (a lápide é minoria). Sem `CONCURRENTLY`:
   migration do Supabase roda dentro de transação.

### 2.4 Emenda ao `enforce_service_term_immutability` — *ponteiro*

> **Reproduzir a função INTEIRA.** É `CREATE OR REPLACE` sobre função aplicada em produção
> (20260817001100). O único delta é o marcado `EMENDA 2026-08-21`. Não reordenar e não reescrever
> mensagens de erro (há teste e log dependendo delas). O trigger
> `trg_enforce_service_term_immutability` **não** é recriado — `CREATE OR REPLACE FUNCTION` mantém o
> trigger existente apontando para o novo corpo.

> **Corpo: `20260821000000_lgpd_account_anonymization.sql`, seção 4**
> (`enforce_service_term_immutability()`). Não reproduzido — ver a regra de normatividade no topo.

Normativo **aqui**:

1. **Delta único** sobre o corpo aplicado em produção (`20260817001100`): `accepted_ip` e
   `accepted_user_agent` podem ir a `NULL` — **e só a `NULL`** — dentro da transição de anonimização
   (`anonymized_at` de `NULL` para timestamp). Levar a qualquer **outro** valor continua proibido:
   não se falsifica trilha de aceite. IP é dado pessoal autônomo (art. 5º, I) e `user-agent` é
   fingerprint; nenhum dos dois é elemento do negócio jurídico, e o próprio schema os declara
   **BEST-EFFORT e FALSIFICÁVEIS**.
2. **A função é reproduzida INTEIRA no arquivo**, porque é `CREATE OR REPLACE` sobre função viva em
   produção. Não reordenar e **não reescrever mensagens de erro existentes** — há teste e log
   dependendo delas.
3. **O trigger `trg_enforce_service_term_immutability` não é recriado**: `CREATE OR REPLACE
   FUNCTION` mantém o trigger existente apontando para o novo corpo.
4. **O `COMMENT` da coluna `service_terms.anonymized_at` é atualizado na mesma seção** — a semântica
   passa a ser "esta linha passou pela rotina de anonimização de conta", habilitando **duas**
   reescritas e só elas: `term_text` **apenas** em rascunho, e `ip`/`ua` para `NULL`. Não deixar a
   semântica antiga mentindo no schema.
5. **Este corpo é reescrito de novo pela migration #3** (§2.7.4) como **corpo-superset**. Ordem
   obrigatória **#1 -> #3**.

### 2.5 A RPC `anonymize_account` — *ponteiro*

> **Emenda 2026-08-22 (F13):** os três deltas da emenda —
> **GUARDA 4** (`sole_organization_owner`), o bloco **SOFT-REMOVE** de
> `company_members`/`organization_members` sob `pg_catalog.to_regclass` (a migration pode ir ao
> banco **antes** da F13), e as asserções **(d)/(e)** — estão escritos em
> `supabase/migrations/20260821000000_lgpd_account_anonymization.sql`, que é a **cópia normativa**
> desses trechos. Não duplicados aqui para não criar duas fontes divergentes do mesmo corpo.
> *(Esta nota antecipava, em 22/08, a regra que hoje vale para o documento inteiro.)*
>
> **Revisão 2026-08-22 (mesma regra, quatro deltas a mais).** Também vivem só no arquivo da
> migration, pela mesma razão:
> 1. **Reconhecimento da classe GERENTE/SÓCIO** (`v_is_member`), sob `to_regclass` — no-op
>    enquanto a F13 não subir. **Muda o D4 do ADR-20260822** e o §4.4: o reconhecimento fica
>    **aqui**, não na migration da F13. Motivo decisivo: em replay de CI a F13 (`20260818100000`)
>    roda **antes** desta, então um `CREATE OR REPLACE anonymize_account` lá seria **sobrescrito**
>    por esta migration e o reconhecimento **sumiria em CI e existiria em produção** — a doença de
>    §2.1.2 e do D5, de novo. O corpo da função tem **um** dono.
> 2. **Terceiro predicado de `company_members`** (`status='invited' AND created_by = titular`) —
>    ver §2.1.
> 3. **Redação de texto livre** em `jobs`, `applications` e `shift_calls` — ver §2.1 — mais duas
>    asserções novas em §2.2: **(a2)**, que exige que cada coluna redigida exista **e seja
>    textual** antes de a transação destrutiva começar, e **(b2)**, que fecha a classificação
>    textual dessas três tabelas (toda coluna `text` está redigida **ou** retida; coluna nova
>    ⇒ HALT), cobrindo também `shift_call_targets` e `shift_attendance_confirmations`. O baseline
>    de (b2) é o **catálogo de produção de 22/08/2026**, conferido coluna a coluna contra o uso no
>    frontend e contra o `pg_constraint` — não uma enumeração de memória. Mais a **(b3)**, que
>    re-verifica a cada aplicação que as colunas retidas *por serem enum* ainda têm `CHECK` de
>    conjunto fechado: a guarda confere a **própria evidência**, em vez de confiar na lista.
> 4. **`v_counts` nasce com todas as chaves em zero** e o retorno ganha **`is_member`**. Chave
>    **ausente** e chave **zero** são fatos diferentes: para a classe gerente o retorno era
>    `is_worker=false`, `company_ids=[]` e as chaves de domínio **sumidas** — indistinguível de
>    "bug, as âncoras não resolveram".
>
> **Corpo: `20260821000000_lgpd_account_anonymization.sql`, seção 5** (`anonymize_account(p_user_id
> uuid)` + `REVOKE`/`GRANT`). Não reproduzido — ver a regra de normatividade no topo.
>
> **Isto encerra o drift que §5.5/Hh1 registrava.** O baseline de 21/08 que vivia aqui não tinha as
> asserções (d)/(e), a GUARDA 4, o SOFT-REMOVE de membership nem a correção do `regclass::text` — e
> continuaria não tendo, porque **nada no build compara os dois**. O que era "drift declarado" virou
> ausência de duplicata.

### 2.6 Verificação obrigatória e DOWN — *ponteiro*

> **Corpo: `20260821000000_lgpd_account_anonymization.sql`, rodapé** (`COMO VERIFICAR` + `DOWN`).
> Não reproduzido — ver a regra de normatividade no topo.
>
> Este bloco era a prova mais barata do problema: o arquivo tem **V1-V22**; a cópia que vivia aqui
> parou em **V12**, enquanto o próprio §5.4/Hh6 deste documento já citava "ensaio de regressão em
> **V22**" — o documento referenciava um item que a sua própria cópia não continha.

Normativo **aqui** é *que a verificação existe e é obrigatória*, e o que ela precisa provar:

| Prova | Por quê |
|---|---|
| nenhuma FK `CASCADE` de identidade (`workers`/`companies`/`wallets` -> `auth.users`) sobreviveu | é o coração de H2 |
| ensaio de `anonymize_account` em conta de **teste** (nunca real) devolve `outcome='anonymized'` com os `counts` conferidos | rotina destrutiva não se verifica por leitura de código |
| termo **aceito** retido integralmente, com `ip`/`ua` nulos; termo **rascunho** redigido | é a fronteira de §2.1 entre prova e telemetria |
| saldo e razão **intactos** — mesma contagem de `wallet_transactions`, `balance` zerado | Article 8/9 |
| `auth.admin.deleteUser` retorna 200 **e** a linha de `workers` continua existindo | é a definição de lápide |
| o recibo do turno pago continua abrindo para a **contraparte**, com o rótulo genérico | dano a terceiro é o teste que mais falha em silêncio |
| flags de alcance zeradas (`badges_hidden` / `accepts_referrals` / `discoverable_for_sos`) e badges **não** ressuscitam | §2.1, `worker_company_badge_prefs` |
| nenhum dependente sobreviveu, rodado para conta de **freela** *e* de **empresa** | a assimetria era o bug latente de §2.1.0, item 4 |
| classe **gerente/sócio** reconhecida; GUARDA 4 recusa sócio único; irmãos **não** são desligados | §4.4.1 e §5.4/J1 |
| texto livre redigido em `jobs`/`applications`/`shift_calls` **com a linha preservada** | §2.1 |
| **o `DOWN` não desfaz dado já anonimizado** — irreversível por natureza; por isso o backup do cabeçalho é obrigatório | não existe rollback de eliminação |

---

## 2.7 Migration #3 — `supabase/migrations/20260821000400_lgpd_retention_purge.sql`

> **Entregável da emenda de retenção.** H1 veio do owner: **5 anos**, contados de `paid_at` /
> `accepted_at`, depois **expurgo**. Sem esta migration, a #1 promete um prazo que **nenhum código
> cumpre** — por isso as duas andam juntas (§0, bloqueio remanescente).
>
> ADR: `.harness/memory-bank/decisions/ADR-20260821-expurgo-de-conteudo-nao-de-linha.md`.
> O que o ADR decidiu e este documento apenas implementa: **o expurgo é `UPDATE`, não `DELETE`** —
> apaga o **conteúdo pessoal** e preserva a **linha pseudônima**. Nenhum `DELETE` em
> `shift_payments` ou `service_terms`, nem pelo cron, nem por ninguém.
>
> **Depende da #1.** Reescreve `enforce_service_term_immutability` com o corpo-**superset**
> (emenda da anonimização §2.4 **mais** a do expurgo). Aplicar na ordem inversa faria a #1
> sobrescrever a exceção de expurgo em silêncio. Há asserção que **HALTa** se a #1 faltar.

### 2.7.0 O prazo é do DADO, não da conta (decisão desta emenda)

Pergunta que muda a query: *uma conta excluída hoje, com um pagamento de 4 anos atrás — expurga em
1 ano (idade do dado) ou em 5 (data da exclusão)?*

**Decisão: em 1 ano. O relógio é do dado.** Cutoff sobre `coalesce(paid_at, created_at)` e
`coalesce(accepted_at, created_at)`, **sem nenhuma referência a `anonymized_at`**.

Por quê:

1. **Contar da exclusão é perverso.** O titular que exerce o art. 18, VI passaria a **prolongar** a
   retenção dos próprios dados: quem nunca pede exclusão tem o dado apagado em 5 anos, quem pede
   fica com ele por 9. Punir o exercício do direito com mais retenção é indefensável perante
   qualquer autoridade — e é o oposto do princípio da necessidade (art. 6º, III).
2. **A base legal já é datada pelo fato, não pela conta.** O que sustenta a retenção é a
   prescrição da pretensão nascida **daquela transação** (CC art. 189: o prazo corre da lesão do
   direito). O prazo do documento começa quando o documento nasce. A conta do titular é irrelevante
   para o relógio: uma empresa que nunca sai da plataforma também deixa de ter justificativa para
   guardar o nome e o CPF de um freela num termo de 2021.
3. **Consequência assumida: o expurgo atinge conta VIVA.** Um freela ativo há 7 anos perde o
   `term_text` dos termos mais antigos. Isso é correto (a retenção tem prazo porque o prazo existe,
   não porque a pessoa saiu) e **é a razão pela qual a exceção nos triggers não pode reaproveitar
   `v_anonymizing`** — numa conta viva `anonymized_at` é `NULL` e continua `NULL` (§0.3.1).
4. **Operacionalmente é a única query sã.** Cutoff por coluna própria da tabela = varredura por
   índice parcial em `shift_payments`/`service_terms`, sem `JOIN` com a lápide. Contar da exclusão
   exigiria juntar `workers`/`companies` a cada varredura **e** deixaria todo registro de conta viva
   **fora do expurgo para sempre** — ou seja: a variante "da conta" não é só pior, ela **não cumpre**
   a promessa de 5 anos para a maioria da base.

> ⚠️ **Confirmação jurídica pendente (não bloqueia o código, muda um literal).** 5 anos é a
> prescrição civil (CC art. 206, §5º, I) — o número que o próprio contrato já apontava como padrão,
> **escolhido pela orquestração, não por parecer de advogado**. A recomendação técnica é **6 anos**:
> a reclamação trabalhista alegando vínculo pode ser ajuizada **até 2 anos após o fim da relação**
> (CF art. 7º, XXIX) e o processo dura anos — a prova que interessa nesse cenário é exatamente o
> `term_text` que declara ausência de vínculo, e o cenário realista é precisar dele **no ano 6 ou 7**.
> O desenho torna a troca trivial de propósito: o prazo vive numa função só
> (`lgpd_retention_interval()`), consumida pela RPC **e** pelos dois triggers. Trocar 5→6 é um
> `CREATE OR REPLACE` de três linhas — **não** é caça a literal espalhado. Enquanto não houver
> parecer, quem precisar de mais prazo numa linha específica usa a **trava de litígio**
> (`retention_hold_reason`), que é o instrumento correto para exceção pontual.

### 2.7.1 Classificação — o que o expurgo apaga e o que fica

| Tabela / coluna | Ação no expurgo | Justificativa |
|---|---|---|
| `service_terms.term_text` | **SUBSTITUÍDO** por marcador `'[REGISTRO EXPURGADO …]'` | É o único lugar do sistema com **nome e CPF em texto claro**. É por causa dele que a retenção precisava de prazo. Marcador (e não `NULL`) porque a coluna é `NOT NULL` e porque o rótulo é o sinal auditável de que houve expurgo, não de que houve bug. |
| `service_terms.accepted_ip`, `accepted_user_agent` | **APAGADOS** (`NULL`) | Se já não sobrevivem à exclusão da conta (§2.1), não há razão para sobreviverem ao prazo numa conta viva. Telemetria `BEST-EFFORT e FALSIFICÁVEL` pelo próprio schema. |
| `service_terms.amount`, `accepted_at`, `term_version`, `job_id`, `worker_id`, `company_id`, `shift_payment_id`, `created_at` | **RETIDOS** | O **fato** da transação (valor, data, partes pseudônimas) não identifica ninguém depois que a lápide esvaziou `workers`/`companies`. É o que sustenta BI e a integridade referencial `RESTRICT`. |
| `shift_payments.note` | **APAGADO** (`NULL`) | Único texto livre da tabela e o risco residual §5.3. Depois do prazo não existe mais justificativa para guardar texto da empresa que **pode** conter nome de pessoa. §5.3 deixa de ser risco permanente e vira risco **com prazo**. |
| `shift_payments` — todo o resto | **RETIDO** | Documento declaratório. `amount`/`paid_at` continuam contando no BI de gasto. Um expurgo por `DELETE` teria reescrito, em silêncio, todo relatório anterior a 5 anos. |
| `purged_at` (novo, nas duas tabelas) | **RECEBE** `now()` | Marcador do expurgo. **Não** reaproveitar `anonymized_at`: a transição dele já foi gasta na exclusão da conta e o marcador não distinguiria os dois eventos. |
| `service_terms.retention_hold_reason` (nova) | **trava** — linha com valor não-`NULL` é **pulada** | Litígio/investigação em curso. Trava o termo **e** o `note` do pagamento correspondente. `service_terms` só tem policy de `SELECT` ⇒ a coluna é inalcançável pelo client **por construção**. |
| `wallets`, `wallet_transactions`, `escrow_transactions` | **NÃO SÃO LIDAS NEM ESCRITAS** | Article 8/9 intactos **por construção**, não por cuidado: a garantia de idempotência `(wallet_id, reference_id)` só existe enquanto a linha existe, e o expurgo não conhece essas tabelas. |
| `workers`, `companies` (lápide ou não) | **INTOCADAS** | O expurgo é sobre **registro de transação**, não sobre perfil. Perfil é tratado pela #1. |

### 2.7.2 Cabeçalho, asserção de ordem e o prazo num lugar só — *ponteiro*

> **Corpo: `supabase/migrations/20260821000400_lgpd_retention_purge.sql`, seções 1 e 2.** Não
> reproduzido — ver a regra de normatividade no topo.

Normativo **aqui**:

1. **Asserção de ordem (`#1 -> #3`).** A migration **HALTa** se `20260821000000` não estiver
   aplicada. Aplicar na ordem inversa faria a #1 sobrescrever a exceção de expurgo **em silêncio**,
   e o silêncio é o modo de falha que este documento inteiro combate.
2. **O prazo mora num lugar só:** `public.lgpd_retention_interval()`, consumida pela RPC **e** pelos
   dois triggers. É o que torna 5->6 anos um `CREATE OR REPLACE` de três linhas em vez de caça a
   literal espalhado (§2.7.0 e §5/H1). Nenhum outro objeto do schema pode carregar o literal — e a
   verificação do arquivo checa exatamente isso, lendo `pg_get_functiondef`.

### 2.7.3 Marcadores, trava de litígio e prova de conformidade — *ponteiro*

> **Corpo: `20260821000400_lgpd_retention_purge.sql`, seções 3 e 4.** Não reproduzido — ver a regra
> de normatividade no topo.

Normativo **aqui**:

1. **`purged_at`** (em `service_terms` e `shift_payments`) — marcador do expurgo, nullable e sem
   `DEFAULT`. **Não** reaproveitar `anonymized_at`: a transição dele já foi gasta na exclusão da
   conta e o marcador deixaria de distinguir os dois eventos (§2.7.1).
2. **`service_terms.retention_hold_reason`** — trava de litígio. Linha com valor não-`NULL` é
   **pulada** pelo expurgo, e a trava do termo protege também o `note` do pagamento correspondente.
   `service_terms` só tem policy de `SELECT`, logo a coluna é **inalcançável pelo client por
   construção**. É o instrumento de exceção pontual enquanto o parecer jurídico sobre 5 x 6 anos não
   vem (§5/H1).
3. **Índices parciais de vencimento** nas duas tabelas — o expurgo é varredura por índice, sem
   `JOIN` com a lápide (§2.7.0, item 4).
4. **`data_retention_purge_runs`** — registro das operações de tratamento (**LGPD art. 37**), com
   RLS habilitada. Contagens por execução, incluindo as linhas **travadas** (`*_held`): sem elas,
   "expurgou 0" e "havia 40 travadas" seriam indistinguíveis num relatório à autoridade.

### 2.7.4 Os dois guardas de imutabilidade (corpos-superset) — *ponteiro*

> **Reproduzir as funções INTEIRAS.** São `CREATE OR REPLACE` sobre funções **aplicadas em
> produção**. `enforce_shift_payment_immutability` parte do corpo de `20260712000000` (§4);
> `enforce_service_term_immutability` parte do corpo **já emendado em §2.4** — este é o
> corpo-superset, e é o motivo da ordem `#1 → #3`. Não reordenar e **não reescrever mensagens de
> erro existentes** (há teste e log dependendo delas). Os triggers não são recriados:
> `CREATE OR REPLACE FUNCTION` mantém os existentes apontando para o novo corpo.

> **Corpo: `20260821000400_lgpd_retention_purge.sql`, seções 5 e 6.** Não reproduzido — ver a regra
> de normatividade no topo. As **funções inteiras** vivem lá, e é lá que se lê o que a exceção
> permite exatamente.

Normativo **aqui** é a **forma da exceção** — e é ela, não o texto, que a torna segura. O ramo de
expurgo só existe se as **cinco** condições valerem juntas; qualquer uma faltando é `RAISE`, nunca
fall-through silencioso (as cinco estão enunciadas em §0.3.1):

1. `auth.uid()` nulo — só `service_role`/cron; nenhuma sessão humana expurga.
2. `purged_at` de `NULL` para timestamp, one-way — e é também o **gatilho barato**: num `UPDATE`
   normal a condição falha na primeira comparação e nada mais é avaliado.
3. **A linha passou do prazo**, medido pela mesma `lgpd_retention_interval()` que a RPC usa.
   Consequência declarada: **nem o `service_role` expurga um registro de ontem** — a regra de
   retenção passa a morar no guarda, não só na rotina que ele guarda.
4. **Nenhuma trava de litígio ativa.**
5. **Nada além das colunas do expurgo mudou**, verificado por
   `to_jsonb(NEW) - <colunas> IS NOT DISTINCT FROM to_jsonb(OLD) - <as mesmas>`
   *(ilustração não-normativa)*. É (5) que autoriza o `RETURN NEW` cedo sem reexecutar o corpo
   vigente — e que protege **colunas que ainda não existem**: quem adicionar coluna amanhã a ganha
   protegida sem editar o trigger.

Mais três pontos que **não** podem ser perdidos numa reescrita:

- **`enforce_shift_payment_immutability`** ganha o ramo no topo **e** um bloqueio explícito de
  `purged_at` para todo o resto — a coluna é nova, nenhuma checagem antiga a menciona, então sem
  isso ela passaria em silêncio inclusive por um `authenticated` (§0.3.1). Trata também
  `OLD.status = 'voided'`: sem isso, exatamente as linhas mais antigas ficariam de fora.
- **`enforce_service_term_immutability` é CORPO-SUPERSET** — a emenda da anonimização (§2.4)
  **mais** a do expurgo. É o motivo da ordem obrigatória **#1 -> #3**.
- **`v_purging` é distinto de `v_anonymizing`, e não pode ser fundido.** O expurgo atinge **conta
  viva**, onde `anonymized_at` é e continua `NULL`. Reaproveitar `anonymized_at` para escapar disso
  está **proibido**: marcaria como "conta excluída" quem não excluiu conta.

### 2.7.5 A RPC `purge_expired_personal_data` — *ponteiro*

> **Corpo: `20260821000400_lgpd_retention_purge.sql`, seção 7** (`purge_expired_personal_data(integer,
> boolean)` + `REVOKE`/`GRANT`). Não reproduzido — ver a regra de normatividade no topo.

Normativo **aqui**:

1. **`SECURITY DEFINER` + `search_path=''` + `GRANT EXECUTE` SOMENTE a `service_role`.** Nenhum
   `authenticated` expurga.
2. **Cutoff sobre `coalesce(paid_at, created_at)` e `coalesce(accepted_at, created_at)`, sem
   nenhuma referência a `anonymized_at`** — o relógio é do **dado**, não da conta (§2.7.0).
3. **Dry-run** roda o **mesmo predicado** sem escrever — mesmo padrão de
   `previewUpdateFutureOccurrences` (F3). É o que permite a verificação obrigatória rodar em
   produção no mesmo dia da aplicação, com o cron já agendado.
4. **Limite de lote** mantém a varredura contida; a rotina é reentrante e idempotente (linha já com
   `purged_at` não volta ao conjunto).
5. **Article 8/9 por construção, não por cuidado:** a função **não menciona** `wallets`,
   `wallet_transactions` nem `escrow_transactions`. A verificação do arquivo prova isso lendo o
   próprio `pg_get_functiondef` — a guarda confere a evidência, não a intenção.
6. **Grava `data_retention_purge_runs`** a cada execução efetiva, com as contagens **e** as
   travadas.

### 2.7.6 Agendamento (`pg_cron`) — *ponteiro*

> **Corpo: `20260821000400_lgpd_retention_purge.sql`, seção 8.** Não reproduzido — ver a regra de
> normatividade no topo.

Normativo **aqui**:

1. **`pg_cron` diário, `'30 3 * * *'` = 03:30 UTC = 00:30 BRT** — janela de menor tráfego. `pg_cron`
   interpreta o schedule em **UTC**; o Brasil não tem DST desde 2019, logo o offset é fixo e não há
   nada a manter.
2. **`cron.schedule(jobname, ...)` faz upsert por nome** (pg_cron >= 1.4), logo reaplicar não
   duplica job.
3. **Degrada com `RAISE WARNING`** se a extensão faltar — mesmo molde de `20260817000800` (F4) e
   `20260817001300` (F8). Diferença em relação àquelas datas: em 21/08/2026 a extensão está
   **instalada e com job ativo** em produção.
4. **Sem o agendamento, a promessa de 5 anos não é cumprida por nada** — o cron não é housekeeping,
   é a feature.

> ⚠️ **O canal de aplicação engole o `WARNING`.** `supabase/migrations/APLICACAO-2026-08-16.md`
> registra que as migrations deste projeto são aplicadas via **MCP do Supabase**, que não devolve
> `NOTICE`/`WARNING` do servidor. Silêncio **não** é sucesso: **V6** da seção abaixo é obrigatória,
> não opcional — é a única confirmação confiável de que o agendamento pegou.

### 2.7.7 Verificação obrigatória e DOWN — *ponteiro*

> **Corpo: `20260821000400_lgpd_retention_purge.sql`, rodapé** (`COMO VERIFICAR` V1-V9 + `DOWN`).
> Não reproduzido — ver a regra de normatividade no topo.

Normativo **aqui** é *que a verificação existe e é obrigatória*, e o que ela precisa provar:

| Prova | Por quê |
|---|---|
| a asserção de ordem não levantou exceção | a #1 está aplicada; sem ela o corpo-superset se perde |
| `lgpd_retention_interval()` devolve o prazo **e é o único objeto do schema com o literal** | é o que torna 5->6 uma linha (§2.7.0) |
| **dry-run antes de qualquer coisa**, no mesmo dia — hoje o esperado é **0 e 0** (base nova) | número > 0 = **PARE e explique** antes de deixar o cron rodar |
| tentar expurgar registro **recente** falha, rodado em transação com `ROLLBACK` | prova que o **prazo** é verificado pelo trigger, não só pela RPC |
| tentar **carona** (mudar `amount` junto do expurgo) falha | prova a auto-limitação, condição (5) de §2.7.4 |
| `cron.job` tem a linha, com o schedule certo e ativa | **passo de runbook obrigatório**: o canal de aplicação engole o `WARNING` do ramo `ELSE` |
| trava de litígio: linha vencida com `retention_hold_reason` **não** conta no expurgo e **conta** em `*_held` | §2.7.3 |
| a função **não menciona** `wallet`/`escrow` (lido de `pg_get_functiondef`) | Article 8/9 verificado, não afirmado |
| `data_retention_purge_runs` tem linha após a primeira execução efetiva | prova de conformidade, art. 37 |

**O `DOWN` restaura os corpos de trigger, e a ordem importa:** `enforce_service_term_immutability`
volta para o corpo da **migration #1 / §2.4** — **não** para o de `20260817001100` puro, ou a #1
quebra junto. E `lgpd_retention_interval()` cai **por último**: os triggers a usam. Conteúdo já
expurgado **não** é restaurado — irreversível por natureza.

---

## 3. Migration #2 — `supabase/migrations/20260821000100_reviews_select_by_relationship.sql`

### 3.1 O achado que muda o desenho

Apertar a policy de `reviews` **sozinha não resolve nada**: `get_profile_reviews`
(SECURITY DEFINER, 20260816130000) só exige `auth.uid() IS NOT NULL`. Ela devolve, para qualquer conta
autenticada, **as mesmas avaliações** — nota, comentário, data e nome da empresa avaliadora. A RPC é a
mesma porta, com outra placa.

Logo o fecho tem **duas metades obrigatórias**:

1. policy de `reviews` escopada por vínculo (fecha a leitura direta da tabela);
2. gate de vínculo **dentro** de `get_profile_reviews` para `p_direction = 'worker'` (fecha a RPC).

E uma assimetria deliberada, que é produto e não descuido:

| `p_direction` | Quem é avaliado | Quem pode ler | Por quê |
|---|---|---|---|
| `'company'` | a **empresa** | **qualquer autenticado** | É a prova social que existe para o freela decidir **antes** de aceitar convite (`/empresa/:id`). Assimetria de confiança deliberada do produto. Os avaliadores (freelas) já saem **mascarados** ("Carlos S."). |
| `'worker'` | o **freela** | só quem passa em `can_view_worker_profile` | Reputação de pessoa física. Mesma régua da migração `20260816120000`, que já decidiu quem pode ver esse perfil. |

### 3.2 Consumidores — o que cada um precisa

| Consumidor | Como lê hoje | Depois | Ação do builder |
|---|---|---|---|
| `components/ProfileReviews.tsx` | RPC `get_profile_reviews` | Idem | **Nenhuma** |
| ↳ `pages/Profile.tsx:957` (freela vê as próprias) | RPC, `direction='worker'`, `reviewed_id = eu` | OK — `can_view_worker_profile(self)` = true (ramo 0) | Nenhuma |
| ↳ `pages/company/CompanyProfile.tsx:790` (empresa vê as próprias) | RPC, `direction='company'` | OK — ramo aberto | Nenhuma |
| ↳ `pages/CompanyPublicProfile.tsx:262` (**freela vê empresa — prova social**) | RPC, `direction='company'` | **OK — preservado de propósito** | Nenhuma |
| `pages/company/WorkerPublicProfile.tsx:122` | `from('reviews').select('*').eq('reviewed_id', id)` + `from('companies').in('id', reviewerIds)` | Continua funcionando: a empresa que abre esse perfil tem vínculo (é como ela chega lá) e o ramo (3) da policy nova concede | **Nenhuma mudança obrigatória.** Recomendado (não bloqueante): trocar pelas duas queries por `<ProfileReviews reviewedId={id} reviewerRole="company" />` — some código duplicado e a tela deixa de depender da policy de tabela |
| `pages/MyJobs.tsx:163` | `from('reviews').select('job_id').eq('reviewer_id', user.id)` | OK — ramo (1), autor | Nenhuma |
| `pages/MyJobs.tsx:524` e `pages/company/CompanyJobCandidates.tsx:777` | `insert` | Policy de INSERT **não é tocada** | Nenhuma |
| **F12 (badges)** — `.harness/spec/badges-empresas/ddl-aprovado.md` | RPC própria, SECURITY DEFINER, agrega `reviews` sem devolver linha | **Confirmado: não muda uma linha.** DEFINER ignora a policy nova, e a RPC devolve média e contagem, não conteúdo | Nenhuma |

### 3.3 A migration — *ponteiro*

> **Corpo: `supabase/migrations/20260821000100_reviews_select_by_relationship.sql`.** Não
> reproduzido — ver a regra de normatividade no topo.

#### ⚠️ Este era o bloco mais perigoso dos três, e por um motivo específico

**Esta migration já está APLICADA em produção** (verificada contra o catálogo em 21/08/2026: hoje
`reviews` tem **uma única** policy de `SELECT`). Um bloco de SQL num contrato descrevendo algo que
**já está no banco** não é especificação: é um rascunho pré-aplicação com aparência de
especificação — o pior dos dois mundos, porque não manda em nada e ainda assim é lido como se
mandasse.

E ele **estava errado sobre produção em dois pontos**, exatamente os dois que fizeram a aplicação
precisar de **duas tentativas**:

1. Declarava `reviews.reviewer_id` / `reviewed_id` como **`text`** (herdado da migration legada
   `20260314000008`). **São `uuid` em produção.**
2. O `DROP POLICY` mirava **três nomes que não existiam**. O nome real da policy permissiva era
   `"Public view reviews"` — e `DROP POLICY IF EXISTS` de nome inexistente **não falha, passa em
   silêncio**. Como policies de `SELECT` são combinadas por `OR`, a policy restritiva **não
   restringia nada** enquanto a permissiva sobrevivia: a dívida #9 apareceria como paga com o buraco
   aberto.

Os dois achados foram corrigidos **no arquivo**, que hoje carrega os comentários de verificação
pós-aplicação. Manter aqui a versão anterior seria conservar, sob etiqueta de "fonte normativa",
justamente o texto que produziu o erro.

**Decisão: ponteiro, não registro histórico.** Registro histórico se guarda quando o passado é
informativo; aqui ele é um contra-exemplo **já absorvido** — a lição sobreviveu (é o parágrafo
acima), o SQL errado não precisa sobreviver junto. Quem quiser o texto original tem `git log` do
arquivo.

**E uma advertência que vale para as três migrations:** para migration **já aplicada**, nem este
documento nem o `.sql` são fonte de verdade sobre o **estado do banco** — só o catálogo é
(`pg_policies`, `pg_proc`, `information_schema`). Esta migration é a prova: repositório e banco
discordaram em dois pontos, e quem tinha razão era o banco.

#### O que é normativo aqui (a decisão, não a escrita)

As **duas metades obrigatórias** de §3.1, mais o que as sustenta:

1. **`try_uuid(text)`** — cast que devolve `NULL` em vez de erro `22P02`. Existe por causa do
   **parâmetro `text`** de `get_profile_reviews` (o client passa string), **não** por causa do tipo
   das colunas. `::uuid` puro em policy é bomba: uma linha não-uuid derruba o `SELECT` inteiro, e o
   conteúdo de `reviewed_id` é escolhido por quem faz o `INSERT`.
2. **Índice de suporte por autor** (`reviews.reviewer_id`) — a policy filtra por ele.
   `(reviewed_id, direction)` já existe desde `20260816130000`.
3. **`can_view_reviews_of(uuid)`** — a função de visibilidade, com a assimetria deliberada da tabela
   de §3.1: `'company'` aberta a qualquer autenticado (prova social de `/empresa/:id`), `'worker'`
   pela mesma régua de `can_view_worker_profile`.
4. **Policy `reviews_select_related`**, três ramos: sou o **autor**, sou o **avaliado**, ou tenho
   **vínculo** com o perfil avaliado. **`DROP` da permissiva primeiro** — policies permissivas são
   combinadas por `OR`, e enquanto a `USING (true)` existir a restritiva não restringe nada.
   **Conferir `pg_policies` DEPOIS de aplicar** é parte da entrega, não zelo extra.
5. **Gate de vínculo DENTRO de `get_profile_reviews`** — fechar só a tabela deixaria a mesma leitura
   aberta pela porta da RPC (`SECURITY DEFINER` ignora a policy). As duas metades andam juntas.
6. **`GRANT`s:** revogar de `anon` na tabela; **nunca `REVOKE ALL ... FROM PUBLIC` em TABELA** —
   lição de `20260318000000`, que derrubou o `service_role`. A policy de **`INSERT`** de `reviews`
   **não é tocada** (dívida #11); a de `companies` também não (dívida #10).

---

## 4. Contrato da Edge Function `delete-account` (outro agente implementa — NÃO implementar aqui)

### 4.1 Forma nova

```
POST /functions/v1/delete-account   (JWT do próprio usuário; service_role interno)

1. Autentica pelo JWT (inalterado). CORS preflight inalterado (Article 11).
2. LER ANTES DE APAGAR: guardar em memória `workers.avatar_url/cover_url` (ou os paths derivados
   por userId) — o passo 3 os apaga. **De `payment_methods`, ler APENAS a CONTAGEM, nunca os
   tokens** (emenda 2026-08-22): sem revogação possível (4b), carregar o token para a memória da
   função é manusear credencial de pagamento sem finalidade — e foi por aí que ele quase acabou
   escrito em log, dentro da rotina de LGPD. A contagem é o que o aviso de (4b) precisa.
3. supabaseAdmin.rpc('anonymize_account', { p_user_id: userId })
   ├─ 'wallet_has_balance'        → 400 "Saque seu saldo antes de excluir a conta."
   ├─ 'escrow_active'             → 400 "Você tem pagamentos em aberto. Conclua ou cancele antes."
   ├─ 'scheduled_payment_pending' → 400 "Há pagamento agendado pendente. Efetive ou estorne antes."
   ├─ 'sole_organization_owner'   → 400 "Você é o único responsável por uma rede que tem
   │                                  unidades de outras pessoas. Promova outro sócio a
   │                                  responsável antes de excluir a conta." (emenda 2026-08-22)
   ├─ 'not_found' / 'invalid_input' → 400 **e ABORTA — ver §4.4** (não seguir para o passo 5)
   └─ 'anonymized'                → segue
4. Efeitos colaterais FORA do Postgres (idempotentes):
   4a. Storage: remover os objetos de avatar/cover lidos em (2).
   4b. Asaas: **NÃO HÁ REVOGAÇÃO — e isto é a descrição do que acontece, não um TODO**
       *(emenda 2026-08-22)*. A versão anterior deste passo dizia "revogar os cartões
       tokenizados". **Não existe caminho verificado para revogar um `creditCardToken` isolado:**
       o endpoint `DELETE /creditCard/{token}` não tem precedente no repositório (o único DELETE
       ao Asaas é `asaas-release-hold`, sobre `payments` — outro recurso) e a documentação
       pública não descreve revogação de token avulso; o token é vinculado ao **cliente**, e o
       caminho documentado para eliminar o dado do cartão parece ser remover o cliente — ação de
       escopo muito maior, que afeta cobranças e histórico. **Ação correta:** um aviso único com
       a **contagem** de tokens que permanecem no processador. **Proibido:** (i) chamar o
       endpoint "por melhor esforço" — um 404 em toda exclusão produz log de "revogação não
       confirmada" que **fabrica evidência de esforço** onde só houve chamada a endereço
       inexistente, e quem audita lê tentativa legítima; (ii) escrever o token em log, em
       qualquer nível. Retenção declarada em §5.3; decisão de owner/jurídico em §5.4 J5.
   4c. Legado: DELETE em "Message" por senderid (comportamento atual, mantido).
5. supabaseAdmin.auth.admin.deleteUser(userId) → agora SUCEDE (as CASCADEs foram removidas).
   Se falhar: 500 + log de incidente. A conta fica anonimizada com credencial viva; o retry é
   seguro (a RPC é idempotente).
6. 200 { success: true }
```

### 4.2 O que **sai** do TypeScript

Os passos 5 e 6 atuais (anonimizar worker / anonimizar company) **saem** e passam para a RPC. Os
passos 3 (cancelar `applications` ativas) e 4 (`jobs → 'deleted'`) **permanecem** no TS por ora:
não são dado pessoal e dependem de listas de status espalhadas. Regra: **nada que seja anonimização
de conteúdo pessoal fica fora da RPC**, porque só dentro dela existe transação.

### 4.3 Ordem que NÃO pode ser invertida

`deleteUser` **depois** da RPC. Se a credencial cair primeiro e a RPC falhar, sobra uma linha com CPF
e PIX sem nenhum titular capaz de pedir a exclusão de novo.

**Emenda 2026-08-22 — o que a exclusão destrói e o que ela NÃO destrói, do lado do Asaas.** Isto
decide onde uma remediação futura pode morar, e por isso entra no contrato agora e não quando a
decisão de J5 vier:

- **A lista de tokens só existe ANTES do passo 3.** A RPC apaga `payment_methods`; depois dela,
  ninguém mais sabe *quais* tokens eram daquela conta. Qualquer ação **por token** teria de
  acontecer entre (2) e (3) — e é exatamente a ação que não existe.
- **O `asaas_customer_id` SOBREVIVE.** Ele vive em `wallets` (`20250222153500`), tabela
  **INTOCADA** pela rotina por força do Article 8/9. Consequência: a remediação de J5 continua
  possível **depois** da exclusão, na granularidade de **cliente** — que é justamente a
  granularidade que o Asaas documenta. A janela não fecha.

Ou seja: a mesma linha que é preservada para proteger o razão é a que mantém aberto o caminho de
remediação. Não é sorte a ser confiada em silêncio — é fato de schema que precisa estar escrito,
porque uma "limpeza" futura de `wallets` órfãs fecharia essa porta sem que ninguém percebesse.

### 4.4 `not_found` é FALHA, não "nada a fazer" — a classe GERENTE (emenda 2026-08-22)

`anonymize_account` devolve `not_found` quando o `p_user_id` não é worker nem dono de company. Com a
F13 isso **deixa de ser um caminho impossível** e passa a descrever um usuário legítimo e completo:
o **gerente**. `accept_manager_invite` (`20260818100300`) **apaga a casca de `companies`** criada
pelo signup — de propósito, para o gerente não cair no loop de onboarding — e ele nunca teve linha
em `workers`. Resultado: existe uma classe inteira de usuário do produto que a rotina de exclusão
**não reconhece**.

Duas leituras possíveis, e uma delas é um vazamento:

- ❌ Tratar `not_found` como "não havia dado pessoal, siga em frente" e chamar `deleteUser`: a
  credencial some e `company_members` fica `status='active'` com `invited_email` intacto —
  **exatamente as duas coisas** que a decisão de §2.1 existe para impedir, e sem ninguém para
  reclamar depois.
- ✅ `not_found` é **falha**: a Edge Function responde 400 e **não** chama `deleteUser`. O gerente
  que pede exclusão precisa de um caminho que **existe** — não de um que falha em silêncio.

Mas **as duas leituras acima tratam do lado da Edge Function.** Deixar o contrato só nisso fecharia o
furo de **segurança** (credencial apagada com vínculo ativo) às custas de abrir um furo de
**direito**: o gerente ficaria **permanentemente impedido** de excluir a própria conta — dentro da
rotina que existe justamente para cumprir o art. 18, VI. O portão correto é **reconhecer a classe**,
não recusá-la.

#### 4.4.1 Onde mora o reconhecimento — **revisão 2026-08-22 do D4**

> **Decisão revisada: o reconhecimento fica na migration de LGPD (`20260821000000`), guardado por
> `pg_catalog.to_regclass`, e NÃO na migration da F13.**

A versão anterior deste parágrafo mandava fazer a emenda "na migration da F13, que ordena depois
desta". **Isso só é verdade em produção.** Em replay do zero (CI/staging) a F13 é `20260818100000`
e roda **antes** de `20260821000000`: um `CREATE OR REPLACE FUNCTION public.anonymize_account` na
F13 seria **sobrescrito** pela migration de LGPD logo em seguida, e o reconhecimento **existiria em
produção e sumiria em CI**. É literalmente o defeito que §2.1.2 e o D5 do ADR-20260822 existem para
matar — reintroduzido pela recomendação do próprio ADR.

Regra que fica: **o corpo de `anonymize_account` tem um único dono, a migration que o define.**
Fronteira com feature futura se resolve com `to_regclass` (execução dinâmica, no-op enquanto a
tabela não existir), não com reescrita da função a partir de outra leva. Implementado assim — **ilustração
não-normativa**; o corpo está em `20260821000000`, seção 5:

```sql
-- em anonymize_account, ANTES do not_found (guardado por to_regclass — a tabela pode não existir):
--   IF pg_catalog.to_regclass('public.company_members') IS NOT NULL THEN
--       EXECUTE 'SELECT EXISTS (SELECT 1 FROM public.company_members WHERE user_id = $1)'
--          INTO v_is_member USING p_user_id;
--   END IF;   -- idem organization_members
--   IF NOT v_is_worker AND cardinality(v_company_ids) = 0 AND NOT v_is_member THEN ... not_found
```

O que **não** muda: `not_found` continua sendo **falha** para a Edge Function (400, sem
`deleteUser`) — agora significando de verdade "não existe titular". O que a F13 herda: o **E2E de
exclusão de conta de gerente** continua sendo **critério de aceite dela**, porque só lá a classe
passa a existir. O que a F13 **não** faz mais: tocar no corpo desta função.

E o reconhecimento **não vem sozinho** — abrir o portão tornou alcançável o buraco do
`created_by` em `company_members` (terceiro predicado, §2.1). Portão e predicado sobem juntos.

---

## 5. Itens que foram ao humano — **DECIDIDOS em 21/08/2026**

> Ambos voltaram do owner. Esta seção deixa de ser pergunta e passa a ser registro. O que sobra de
> bloqueio é **técnico** (§0: a #1 não vai sozinha, precisa da #3) e **jurídico-consultivo** (o
> número de anos, marcado abaixo), não de decisão de produto.

### H1 — DECIDIDO: retenção de **5 anos**, depois expurgo. "Excluir a conta" = perder o acesso + anonimizar

Não existe caminho em que o direito do art. 18, VI seja cumprido **e** a trilha da transação
sobreviva. Decisão: **anonimização com retenção**, como desenhado neste documento.

1. **Prazo de retenção — DECIDIDO: 5 anos**, contados de `paid_at` (`shift_payments`) e
   `accepted_at` (`service_terms`). Base: prescrição civil, **CC art. 206, §5º, I** — o mesmo número
   que este contrato já apontava como padrão de mercado. Vencido o prazo, **expurgo**.
   - **O prazo é do DADO, não da conta** — §2.7.0. Conta excluída hoje com pagamento de 4 anos
     atrás expurga em **1 ano**, não em 5. Contar da exclusão faria o titular que exerce o art. 18,
     VI **prolongar** a retenção dos próprios dados.
   - **O expurgo apaga CONTEÚDO, não a LINHA** — ADR-20260821-expurgo-de-conteudo-nao-de-linha.
     Nenhum `DELETE` em `shift_payments`/`service_terms`. O BI de gasto histórico sobrevive.
   - **Materializado em §2.7** (migration #3 + `pg_cron` diário). Sem ela, o prazo é promessa que
     nenhum código cumpre — por isso a #1 **não vai a produção sozinha**.
   - ⚠️ **Marcado: escolha da orquestração, a confirmar com advogado.** 5 anos é a prescrição
     **civil**. Recomendação técnica: **6 anos**, pelo vetor **trabalhista** — reclamação alegando
     vínculo pode ser ajuizada até 2 anos após o fim da relação (CF art. 7º, XXIX) e o processo dura
     anos; a prova que interessa nesse cenário é exatamente o `term_text` que declara ausência de
     vínculo, e o cenário realista é precisar dele **no ano 6 ou 7**. O vetor **fiscal** não puxa
     para cima no modo A: a obrigação fiscal é da **empresa**, não da Worki — a Worki retém como
     prova de que **intermediou** (art. 7º, VI + art. 16, I), não por escrituração própria. Trocar
     5→6 é `CREATE OR REPLACE` de `lgpd_retention_interval()` e mais nada (§2.7.2). Até haver
     parecer, exceção pontual usa a trava `retention_hold_reason`.
2. **Texto da Política de Privacidade e da tela de exclusão — ENTREGUE em §6.** Hoje a UI implica
   apagamento total. O texto de §6 diz, com todas as letras, que **o termo de prestação aceito é
   retido com nome e CPF por 5 anos**, e **não chama isso de anonimização**. Continua sendo
   **pré-requisito de ida a público** (débito #1): o texto precisa ser publicado **antes** de a
   rotina ficar acessível ao usuário.

### H2 — DECIDIDO: remover as FKs `CASCADE` para `auth.users`

Confirmado como desenhado (§1, §2.3). É o coração da solução. Consequência aceita: passam a existir
linhas de `workers`/`companies`/`wallets` sem `auth.users` correspondente — **por construção**.
Alternativa rejeitada pelo owner: manter a conta `auth.users` viva, banida e com e-mail trocado por
placeholder (preserva integridade referencial, mas deixa uma casca de conta reativável e um registro
de identidade que o titular pediu para eliminar).

### 5.4 ⚖️ PENDENTE DE CONFIRMAÇÃO JURÍDICA (emenda 2026-08-22)

| # | Item | O que precisa ser confirmado | Se o parecer for contrário |
|---|---|---|---|
| J1 | **GUARDA 4 — `sole_organization_owner`** | Recusar a exclusão enquanto o titular for o único responsável ativo de uma rede com unidades de terceiros é **pré-condição operacional sanável pelo próprio titular** (promover outro sócio), da mesma classe já aceita em `wallet_has_balance` / `scheduled_payment_pending` — **não** recusa do direito do art. 18, VI. | Inverter para "anonimiza e a rede fica órfã", o que exige **antes** uma rotina de sucessão/limpeza de organização órfã (hoje inexistente, e impossível com os dois `ON DELETE RESTRICT`). Não é troca de uma linha. |
| J2 | **Retenção de `user_id`/`created_by` em membership após a exclusão** | Que uuid apontando para lápide seja tratado como **pseudônimo**, e a trilha "quem operou esta unidade e quando" como legítimo interesse (art. 7º, IX) / defesa em processo (art. 16, III). Mesma régua já assumida para `verified_by_company_id` e `reviews`. | Passa a exigir expurgo por prazo, e a linha entra na migration #3 (`purge_expired_personal_data`) em vez de ficar retida sem prazo. |
| J3 | **Purga de `invited_email` de terceiro quando a EMPRESA sai** | Que o e-mail do gerente (terceiro que **continua** na plataforma) perca a base legal junto com a unidade que o convidou. Assumimos que sim. | Manter o e-mail exigiria base própria e um aviso a esse terceiro — nenhum dos dois existe hoje. |
| J4 | **Texto da Política de Privacidade** (§6.1) | Precisa passar a mencionar que o vínculo de operação (gerente/sócio) é **retido de forma pseudônima** após a exclusão. O texto vigente só fala de `shift_payments`/`service_terms`. | Reescrita de §6.1 antes de a rotina ir a público. |

| ~~Hh4~~ | ~~**Conferir o `CHECK` de `jobs.scope` e `applications.invitation_response`**~~ — **FECHADO em 22/08/2026.** | Conferido em `pg_constraint`, e o resultado foi mais amplo que a pergunta: `applications.invitation_response` **tem** `CHECK` fechado (`NULL|'accepted'|'declined'`) e foi **promovida** para `v_enum_text` — a asserção **(b3)** passa a vigiá-la. `jobs.scope` **não tem**, e mais **cinco** da mesma família também não (`jobs.status`, `type`, `category`, `budget_type`, `applications.status`). Reclassificadas com a justificativa correta — "constantes do cliente, sem enforcement no banco" — em §5.3. **Desfecho (Hh5, 22/08):** três das cinco (`jobs.status`, `budget_type`, `applications.status`) ganharam `CHECK` em produção e promoveram; `jobs.scope`, `type` e `category` ficam na classe fraca **em definitivo**, por serem taxonomia aberta com valores órfãos — ver §5.3. |
| ~~Hh5~~ | ~~**Propor `CHECK` de conjunto fechado para as seis colunas sem enforcement**, em leva própria.~~ — **FECHADO em 22/08/2026: três ganharam `CHECK`, duas foram recusadas com evidência, uma segue por decisão.** | **Aplicado em produção** (`20260822000400_checks_enum_jobs_applications.sql`): `jobs.status` (`open\|paused\|deleted`), `jobs.budget_type` (`hourly\|daily\|project`) e `applications.status` (13 valores). As três **promovem** de `v_retained_text` para `v_enum_text` e passam a ser vigiadas pela **(b3)** — derrubar o `CHECK` vira **HALT** em vez de mentira silenciosa. **O subconjunto que este item sugeria como "barato" estava errado, e o levantamento provou:** propunha começar por `scope`, `type` e `budget_type` "que ninguém digita" — mas `scope` e `type` têm **valores órfãos em produção** (`'full-time'`, `'hybrid'`) sem nenhuma origem no repositório, e o round-trip de edição de `CompanyCreateJob.tsx` faria um `CHECK` incompleto **quebrar a edição de toda linha legada**. As duas ficam na classe fraca **em definitivo** — taxonomia aberta, como `jobs.category` — e §5.3 passa a dizer isso em vez de tratá-las como pendência. **Ação pendente, e ela é no ARQUIVO:** mover `jobs.status`, `jobs.budget_type` e `applications.status` de `v_retained_text` para `v_enum_text` na seção 1 de `20260821000000` (ainda não aplicada ⇒ edição de arquivo, não migration nova). A decisão é deste documento; a escrita é do `.sql` — regra de normatividade no topo. |
| ~~Hh6~~ | ~~**Varredura completa "toda coluna `text` de tabela retida × tem `CHECK` fechado?"**~~ — **FECHADO em 22/08/2026.** | 27 linhas para **25 colunas textuais distintas** nas cinco tabelas; **nenhuma ficou sem classificação possível**. Resultado: **8 promovidas** à classe forte (`applications.invitation_response`, `shift_calls.reason/status/origin`, `shift_call_targets.origin/response`, `shift_attendance_confirmations.source/response`) — inclusive as três de `shift_calls` que estavam rebaixadas por disciplina, e cujos `CHECK`s no catálogo vieram **idênticos** ao que o repositório declarava. **E um achado que quase inverteu uma decisão desta mesma leva:** `jobs.certification_requirement` **tem `check_def` não-nulo** — `CHECK (… char_length(certification_requirement) <= 200)` *(ilustração não-normativa)*. Uma regra de promoção do tipo *"tem `CHECK` ⇒ classe forte"* a teria promovido e **tirado da redação**, em silêncio, justo a coluna de texto livre que esta rodada mandou redigir. **`CHECK` de comprimento não é evidência de conjunto fechado: limita o tamanho da prosa, não o fato de ser prosa.** A asserção **(b3)** foi apertada para exigir a forma `<coluna> = ANY (ARRAY[…])` **adjacente ao nome da coluna** — o que também impede carona em `CHECK` composto (`foo = 'x' AND bar = ANY(…)`) e resolve, via `EXISTS`, as colunas que participam de **mais de um** `CHECK` (as de coerência simplesmente não casam). Ensaio de regressão em **V22**. |

| J5 | **Token de cartão retido no Asaas após a exclusão** *(emenda 2026-08-22)* | Duas perguntas, nesta ordem. **(a) Técnica, para o Asaas:** existe revogação de `creditCardToken` avulso? A resposta muda tudo o que vem depois, e não é nossa — é da referência completa da API ou do suporte. **(b) De owner + jurídico, se (a) for "não":** aceitar **remover o cliente no Asaas** na exclusão (escopo maior: afeta cobranças e histórico daquele cliente) **ou** declarar a retenção na Política de Privacidade e mantê-la. Não é escolha de engenharia: uma opção mexe no contrato financeiro, a outra no que o produto promete ao titular. | Se o parecer for "não pode reter": a exclusão passa a depender de uma chamada ao Asaas que **pode falhar**, e o contrato precisa decidir se essa falha **bloqueia** a exclusão (e o titular fica preso ao gateway) ou apenas registra incidente. Hoje nada disso existe. |

> J4 é **bloqueante para publicação** junto com o débito #1 já registrado no cabeçalho da migration
> #1 (item (2)). J1–J3 não bloqueiam a aplicação da migration; bloqueiam o **release ao usuário**.

### 5.3 Riscos residuais aceitos (registrar, não corrigir agora)

| Risco | Por que fica |
|---|---|
| `shift_payments.note` é texto livre da empresa e pode conter o nome do freela. **Deixou de ser risco permanente e virou risco COM PRAZO** *(emenda 2026-08-21)*. | Continua sobrevivendo à exclusão da conta (é coluna material do documento declaratório, §2.1), mas **não sobrevive ao prazo**: o expurgo de §2.7 apaga `note` 5 anos depois de `paid_at`. A "troca ruim" que este contrato recusava — reescrever `enforce_shift_payment_immutability` — deixou de ser opcional quando H1 fixou um prazo, e foi feita **na forma auto-limitada** (§0.3.1), que é o que a torna aceitável: o trigger passa a **exigir** o prazo em vez de apenas permitir a escrita. Mitigação enquanto o prazo corre: hint na UI de registro de pagamento ("não escreva dado pessoal aqui"). |
| `reviews.comment` escrito **pelo** titular excluído sobrevive. | Texto opinativo sobre terceiro; a autoria já degrada para o rótulo genérico. Remoção específica = atendimento manual. |
| `worker_certifications.verified_note` escrito pela **empresa** excluída sobre um freela que continua na plataforma. *(emenda 2026-08-21)* | O `ON DELETE SET NULL` da FK não dispara mais (§2.1.0) e o par `verified_by_company_id`/`verified_at` é travado por CHECK — "conferência anônima" é estado inexpressável. Um `UPDATE` seria barrado pelo ramo (c) de `enforce_certification_update_scope` (§0.3). Mitigação existente: o uuid é pseudônimo e resolve para `'[Empresa Deletada]'`. Mesma classe de `reviews.comment`: remoção específica = atendimento manual. |
| **O `creditCardToken` do cartão da empresa PERMANECE no Asaas depois da exclusão da conta.** `payment_methods` é apagada pela RPC, então o Worki perde a referência — o dado **sai do nosso banco e fica no processador**. *(emenda 2026-08-22)* | Não há caminho verificado de revogação de token avulso (ver §4.1-4b). A alternativa documentada — **remover o cliente no Asaas** — tem escopo muito maior (afeta cobranças e histórico) e é decisão de owner + jurídico: **§5.4 J5**. **Gate explícito, e ele é de PUBLICAÇÃO, não de aplicação:** antes de a rotina ser liberada ao usuário final, confirmar contra a **referência completa da API do Asaas ou o suporte deles** se existe revogação de `creditCardToken`. Se existir, este risco vira bug com correção conhecida e volta para §4.1-4b como ação de verdade; se não existir, a retenção tem de estar **na Política de Privacidade** (§6.1), porque hoje ela promete o oposto pelo silêncio. **O que torna isto aceitável no intervalo:** o token é **opaco** (nunca PAN/CVV — Article 10 e o `COMMENT` da própria coluna), sozinho não é utilizável fora da conta Asaas do Worki, e o `asaas_customer_id` sobrevive em `wallets`, então a remediação por cliente continua possível depois (§4.3). **O que NÃO é aceitável e foi removido:** chamar um endpoint inexistente por melhor esforço, o que produziria log de esforço onde não houve nenhum. |
| A contraparte mantém o histórico da conversa (`Message` recebidas). | Mensagem tem dois titulares. Apagar o lado do outro é destruir dado alheio. |
| `companies` continua `USING (true)` com `cnpj`, `email` e `address` legíveis por qualquer autenticado. | **Débito NOVO (#10)** — mesma classe do #9, descoberto neste gate. Não entra aqui porque `/empresa/:id` e `CompanyProfile` dependem dessa policy e o fecho correto é column-scoped (RPC `get_company_public_profile` + policy restrita), o que é spec própria. |
| A policy de INSERT de `reviews` é `WITH CHECK (reviewer_id = auth.uid())` — não exige turno concluído. | Qualquer conta pode inventar avaliação sobre qualquer id. Fora do escopo deste débito: **#11**. |
| `jobs.title` e `jobs.location` da empresa excluída **sobrevivem** e podem conter dado pessoal ("Casa da Dona Maria, Rua X"). *(emenda 2026-08-22)* | Decisão escrita em §2.1, não omissão: os dois são o **registro da contraparte** sobre uma transação encerrada — o freela, que continua na plataforma, os lê no recibo — e ambos já estão **congelados** dentro de `service_terms.term_text` **aceito**, que é RETIDO INTEGRALMENTE como prova (art. 16, I). Apagar em `jobs` **não elimina** a informação e degrada dado de terceiro. Mesma classe de `reviews.comment`: remoção específica = atendimento manual. **Peso real, conferido em 22/08:** 16 turnos, **13 `location` distintos, endereços de verdade** — não é hipótese, é o dado que fica. O que sustenta a decisão continua sendo que apagar aqui **não elimina** a informação (ela está congelada no `term_text` aceito, retido como prova) e degrada o recibo de um terceiro. |
| ~~**Toda a classe de evidência fraca vive em `jobs`/`applications`**~~ — **REDUZIDA em 22/08/2026 pelo fechamento de Hh5.** Três das oito colunas saíram do risco: `jobs.status`, `jobs.budget_type` e `applications.status` ganharam `CHECK` de conjunto fechado **aplicado em produção** (`20260822000400_checks_enum_jobs_applications.sql`) e **promoveram** para a classe forte, sob vigilância da asserção **(b3)**. | O argumento que este risco fazia era o do **Article 4**: o que mantinha essas colunas com cara de enum era `CompanyCreateJob.tsx`, e a constitution diz que filtro no client é só UX. Agora, para as três, **quem garante é o banco** — um `PATCH` direto via PostgREST não escreve mais texto livre nelas, e se alguém derrubar o `CHECK` a migration **HALTa** em vez de mentir. É a diferença entre "hoje só tem esses valores" e "o banco não aceita outro". **Ação pendente no arquivo, não neste documento:** mover os três nomes de `v_retained_text` para `v_enum_text` na seção 1 de `20260821000000_lgpd_account_anonymization.sql` (a migration ainda não foi aplicada, então é edição de arquivo, não migration nova). Ver o item no topo de §2.2. |
| **O que sobra da classe fraca é DEFINITIVO, não pendência:** `jobs.scope`, `jobs.type`, `jobs.category`, `jobs.work_start_time`, `jobs.work_end_time`. Continuam sem `CHECK`, continuam **retidas** e continuam **não redigidas**. *(revisão 2026-08-22, fechamento de Hh5)* | **`scope` e `type` não ganharam `CHECK` e não vão ganhar — e a razão é um achado, não uma omissão.** Produção tem valores **órfãos** nas duas — `'full-time'` e `'hybrid'` — que **não aparecem em nenhuma linha do repositório**: nem viva, nem morta, nem em teste, nem em `backend_legacy/`, nem em `frontend-angular-backup/`. Foram gravados por uma UI que não existe mais no git. E `CompanyCreateJob.tsx` faz **round-trip na edição** (lê a linha e regrava os mesmos campos), então um `CHECK` que omitisse os órfãos quebraria "editar turno" em **toda linha legada** — falha em produção, no gesto mais banal do produto. Como **não há como provar que esses são os únicos órfãos**, e como as duas colunas não têm UI, união de tipo nem seletor, a classificação honesta é **taxonomia aberta — mesma cara de `jobs.category`**, e não "enum ainda sem `CHECK`". `work_start_time`/`work_end_time` são formato `'HH:MM'` do client, mesma classe. **Nada disso é redigido:** sustentam filtro, horário e BI, e redigir quebraria o produto para fechar uma via de abuso auto-infligida (a empresa dona do turno já passa na policy de UPDATE). O risco residual que **fica** é este, escrito na forma honesta: **são constantes do cliente, sem enforcement no banco**, e o que a empresa escrever nelas por `PATCH` direto sobrevive à exclusão da conta. |
| **Bug de produto achado de passagem no levantamento de Hh5 — já corrigido e no build.** O payload de `CompanyCreateJob` mandava `status: 'open'` **fixo** e era **compartilhado por criação e edição**: editar um turno **pausado o reabria**, e editar um **deletado o ressuscitava** — sem nada na tela dizendo isso. Corrigido: `status` só vai no INSERT. *(22/08/2026)* | **Registrado aqui porque toca a fundação deste contrato, não porque é bug de UI.** O soft-delete `jobs.status='deleted'` é **load-bearing** para a LGPD: §2.1 redige `briefing`/`description`/`requirements`/`certification_requirement` mas **retém a linha**, e todo consumidor confia em `.neq('status','deleted')`. Um caminho que ressuscita linha deletada por acidente é uma via de retorno para conteúdo que a operação já tinha tirado de circulação. **E é a demonstração empírica do argumento do Article 4 na linha acima:** a máquina de estados vivia numa constante literal de um payload de frontend compartilhado entre dois gestos — e o `CHECK` novo em `jobs.status`, sozinho, **não** teria pego este bug (`'open'` é valor válido). Guarda de client e guarda de banco fecham buracos diferentes; nenhuma das duas dispensa a outra. |
| Turno **futuro** de uma empresa excluída fica com `briefing`/`description` redigidos e a empresa como lápide. *(emenda 2026-08-22)* | Consequência esperada da lápide, não da redação: a empresa deixou de existir e o turno está morto de qualquer modo (ninguém opera lápide). O freela já contratado é avisado pelo caminho normal de cancelamento se a empresa cancelar antes; se não cancelar, o turno apenas não acontece. Fechar isso exigiria soft-delete em massa dos turnos futuros na exclusão — decisão de produto, não de LGPD, e fora do escopo desta leva. |

### 5.5 Vai ao humano (revisão 2026-08-22 — não bloqueia a aplicação, bloqueia o "está fechado")

> **Estado em 22/08/2026 (fim do dia): Hh1, Hh2, Hh4, Hh5 e Hh6 fechadas.** Sobram **Hh3**
> (bloqueio técnico já conhecido: a #1 não vai sozinha) e **uma ação de arquivo** herdada de Hh5 —
> mover três colunas de `v_retained_text` para `v_enum_text` em `20260821000000` (§2.2.1). Essa
> ação **não** vai ao humano: é edição mecânica de arquivo não aplicado, com a decisão já escrita.

| # | Item | Por que não foi resolvido aqui |
|---|---|---|
| ~~Hh1~~ | ~~**Ressincronizar os blocos SQL de §2.2 e §2.5** com o arquivo da migration.~~ — **FECHADA em 22/08/2026 por decisão do owner: NÃO ressincronizar.** | **A escolha foi a primeira das duas alternativas que esta própria linha enunciava:** *contrato normativo para classificação/decisão + arquivo normativo para corpo* — agora **escrita como regra**, no topo do documento, e não mais como observação de rodapé. **Razão:** ressincronizar é uma **promessa de continuar ressincronizando**, e **nada a força** — nenhum build, lint ou teste compara os dois. O drift era a prova de que a promessa não se cumpre sozinha: o contrato ficou parado no baseline de 21/08 (sem as varreduras (d)/(e), sem a GUARDA 4, sem o soft-remove de `company_members`, e com o `regclass::text` **quebrado**) enquanto o arquivo andou o dia inteiro. E já custou concreto: o builder da Edge Function teve de **escolher** entre contrato e arquivo, escolheu o arquivo — e ainda assim precisou **parar para reportar** a divergência; o próximo escolheria o outro. **Um ponteiro nunca está desatualizado. Executado:** os blocos de §2.2, §2.3, §2.4, §2.5, §2.6, §2.7.2-§2.7.7 e §3.3 viraram ponteiro; prosa, tabelas de classificação e justificativa **preservadas integralmente**; trechos de SQL que sustentam argumento ficam, marcados **_(ilustração não-normativa)_**. §3.3 recebeu tratamento próprio por ser migration **já aplicada** cujo bloco descrevia produção **errado** em dois pontos. ADR: `ADR-20260822-contrato-normativo-para-decisao-arquivo-para-corpo.md`. |
| ~~Hh2~~ | ~~**Estender a asserção (b) a `jobs` e `applications`**~~ — **FECHADO em 22/08/2026.** | O catálogo de produção foi consultado e cada coluna textual de `jobs`/`applications`/`shift_calls` conferida contra o uso real no frontend. Resultado: **asserção (b2)** (classificação textual fechada, HALT em coluna nova) + duas colunas de texto livre que a lista original não cobria — `jobs.certification_requirement` e `applications.message` — agora redigidas. Dois falsos positivos descartados com evidência, não por palpite: `jobs.scope` (2 valores distintos, 7 chars) e `applications.invitation_response` (1 valor distinto, 8 chars) são **enums em coluna `text`**. **Fechado por completo na revisão do mesmo dia:** as duas tabelas-evento entraram no fecho (as quatro colunas textuais delas têm `CHECK` de conjunto fechado, verificado), e o `metadata jsonb` que constava como risco **não existe** — era descrição errada do `architecture.md`, que diverge da tabela real em seis pontos. Nenhuma coluna `jsonb`/`json` existe nas duas. |
| Hh3 | **`shift_payments.note` e `service_terms` só ficam honestos com a migration #3.** | Já registrado no cabeçalho da migration (bloqueio técnico (1)). Repetido aqui porque a redação de texto livre de §2.1 aumenta o contraste: `jobs.briefing` sai na hora, `shift_payments.note` só sai em 5 anos — e essa diferença **tem** de estar na Política de Privacidade (§6.1 / J4). |
| Hh7 | **Recomendação de `DROP COLUMN` das 7 colunas mortas de `workers`** (`address`, `address_number`, `postal_code`, `province`, `income_value`, `stripe_account_id`, `stripe_onboarding_completed`) — **decisão do owner, não do gate.** | **Recomendo derrubar; e a #1 NÃO espera por isso.** As 7 já estão classificadas como APAGADAS (§2.1) e a rotina as apaga hoje — a #1 está desbloqueada com ou sem esta decisão. O que o DROP compra é diferente e é o motivo da recomendação: **coluna que não existe não pode ser preenchida por acidente**, e é essa a única defesa que não depende de alguém lembrar. As 5 de endereço/renda são, campo a campo, o cadastro de `customer` do Asaas — caminho que nunca escreveu nelas e que a pausa do processamento (ADR-20260822) tornou hipótese remota; as 2 do Stripe são resíduo de um gateway que o **Article 6 da constitution declara "100% removido"** e que sobreviveu no schema (ver ADR desta emenda). **O DROP não é grátis e é isso que vai ao owner:** a migration que derrubar tem de **recriar `public.anonymize_account`** sem as 7 atribuições, senão a RPC quebra em runtime; e uma reaplicação da #1 passará a HALTar na asserção (a) — o que é o comportamento **correto** (o schema deixou de ser o que aquele arquivo verificou), não um defeito a contornar. **Ordem recomendada: #1 primeiro, DROP depois** — nunca o inverso, para não trocar um HALT diagnóstico por uma janela em que a rotina de LGPD referencia coluna inexistente. |

---

## 6. Texto da Política de Privacidade e da tela de exclusão (entregável da emenda)

> **Pré-requisito de ida a público (débito #1).** Este texto é **normativo como o SQL**: a rotina de
> exclusão não fica acessível ao usuário antes de a Política publicada dizer isto. Hoje a UI implica
> apagamento total — sem esta correção a promessa continua falsa, só que na direção oposta.
>
> **Regra que não se negocia:** ⚠️ **a política NÃO pode chamar isto de "anonimização"** (§0.4).
> O que a rotina faz é **eliminação parcial com retenção justificada** (art. 16, I) sobre uma chave
> **pseudônima** (`workers.id`). Enquanto `service_terms.term_text` de um termo aceito guardar nome e
> CPF, o conjunto **não** é anonimizado no sentido do **art. 5º, XI** (que exige que o titular não
> possa mais ser identificado, "considerando a utilização de meios técnicos razoáveis e disponíveis
> na ocasião do tratamento"). Chamar de anonimização seria declarar um regime jurídico que não se
> cumpre — e dado anonimizado está **fora** da LGPD (art. 12), o que transformaria uma imprecisão de
> copy em afirmação de que a lei não se aplica a esses registros. Vocabulário aprovado: **"excluir a
> conta"**, **"eliminar seus dados pessoais"**, **"registros retidos"**, **"expurgo"**. Vocabulário
> proibido nesta seção: **"anonimizar"**, **"anônimo"**, **"todos os seus dados serão apagados"**.

### 6.1 Política de Privacidade — seção "Exclusão da conta e retenção de dados"

> Você pode excluir sua conta a qualquer momento pelo aplicativo. Quando você faz isso:
>
> **O que é eliminado imediatamente.** Suas credenciais de acesso são apagadas — a conta deixa de
> existir e não pode ser reativada. Eliminamos também seus dados de identificação e de perfil: nome,
> CPF/CNPJ, telefone, data de nascimento, chave PIX, endereço, cidade, foto e imagem de capa,
> biografia, funções, disponibilidade, certificações e treinamentos, vínculos com empresas
> ("Elenco"), indicações, notificações e meios de pagamento cadastrados.
>
> **O que é retido, por quanto tempo e por quê.** Não conseguimos apagar tudo. Cada turno pago pela
> plataforma gera dois registros que continuam existindo depois da exclusão da sua conta:
>
> - **O termo de prestação de serviço que você aceitou.** Ele é retido **na íntegra, com nome e
>   CPF/CNPJ das partes**. É a prova de que aquele serviço foi contratado e prestado nas condições
>   declaradas — inclusive de que **não havia vínculo empregatício**. Sem ele, nem você nem a empresa
>   teriam como demonstrar o que foi combinado, se isso for questionado depois.
> - **O registro do pagamento** (valor, data e as partes envolvidas), que sustenta o recibo da outra
>   parte da transação.
>
> Retemos esses dois registros por **5 (cinco) anos**, contados da data do pagamento e da data do
> aceite do termo. O prazo é o da prescrição das pretensões relativas àquela transação (Código Civil,
> art. 206, §5º, I), e a base legal é o cumprimento de obrigação legal ou regulatória e o exercício
> regular de direitos (LGPD, art. 7º, II e VI; art. 16, I e III).
>
> **O prazo conta a partir do registro, não da exclusão da sua conta.** Um pagamento feito há quatro
> anos será expurgado daqui a um ano, tenha você excluído a conta ou não.
>
> **O que acontece no fim do prazo.** Eliminamos automaticamente o conteúdo pessoal desses registros:
> o texto do termo — com os nomes e o CPF/CNPJ — é substituído por um marcador, e as observações
> livres do pagamento são apagadas. Permanecem apenas o valor, as datas e identificadores internos,
> que **não** identificam você. Essa rotina roda diariamente.
>
> **O que continua existindo e não é seu para apagar.** Avaliações que você escreveu sobre empresas
> permanecem publicadas, sem o seu nome — aparecem como de uma conta excluída. Mensagens que você
> enviou continuam na caixa de quem recebeu, porque pertencem também à outra pessoa.
>
> **Exceção.** Se houver processo judicial, administrativo ou arbitral em curso relacionado a um
> registro específico, ele é preservado até o fim do processo, mesmo depois dos 5 anos.
>
> **Honestidade sobre o que isto é.** Este processo **não é uma anonimização**: enquanto o termo
> aceito estiver retido, ele contém dados que identificam você. É uma **eliminação parcial dos seus
> dados pessoais, com retenção justificada** dos registros acima pelo prazo declarado. Enquanto
> esses registros existirem, todos os seus direitos previstos na LGPD continuam valendo sobre eles —
> inclusive o de pedir explicações sobre a retenção, pelo canal de privacidade.

### 6.2 Tela de exclusão de conta (copy do produto)

**Título:** `EXCLUIR MINHA CONTA`

**Corpo (antes do botão):**

> **Isso não pode ser desfeito.** Sua conta e seu acesso acabam agora. Apagamos seu nome, CPF,
> telefone, chave PIX, foto, perfil profissional, vínculos com empresas e notificações.
>
> **O que fica:** por exigência legal, mantemos por **5 anos** o **termo de serviço que você
> aceitou** — que inclui **seu nome e seu CPF** — e o **registro dos pagamentos** (valor e data) dos
> turnos que você já fez. É a prova da transação, para você e para a empresa. Depois dos 5 anos,
> apagamos automaticamente o conteúdo pessoal desses registros.
>
> **Suas avaliações sobre empresas continuam no ar, sem o seu nome.** Mensagens já enviadas
> continuam com quem as recebeu.
>
> [Ler a seção completa da Política de Privacidade →]

**Confirmação:** exigir digitar `EXCLUIR` (gesto deliberado; a operação é irreversível).

**Estados de recusa** — a rotina se recusa a rodar e a tela precisa dizer o porquê (§4.1(3)):

| `outcome` da RPC | Texto |
|---|---|
| `wallet_has_balance` | `Você tem saldo na carteira. Saque antes de excluir a conta.` |
| `escrow_active` | `Você tem pagamentos em aberto. Conclua ou cancele antes de excluir a conta.` |
| `scheduled_payment_pending` | `Há um pagamento agendado pendente. Ele precisa ser efetivado ou estornado antes.` |

**Depois da exclusão (o que a outra parte vê):** onde havia seu nome, a empresa passa a ver
`[Conta Deletada]`. **Não** prometer na tela que a empresa "não verá mais nada": o histórico de
turnos e o termo continuam abrindo para ela — é o mesmo documento que protege os dois lados.

### 6.3 Onde isto entra (para quem implementar — não é escopo deste gate)

| Superfície | Mudança |
|---|---|
| `frontend/src/pages/Privacy*` (Política publicada) | Nova seção com o texto de §6.1, **na íntegra**. É o que torna a rotina publicável. |
| Tela de exclusão de conta (Perfil → Excluir conta) | Copy de §6.2 + confirmação por digitação + tratamento dos três `outcome` de recusa. |
| Modal de registro de pagamento (`shift_payments.note`) | Hint: *"Não escreva dados pessoais aqui."* — mitigação de §5.3 enquanto o prazo corre. |
| Termo de prestação (`ServiceTermSection`) | Uma linha no rodapé do termo: *"Este documento é retido por 5 anos como prova da prestação, mesmo que uma das contas seja excluída."* Quem aceita fica sabendo **no ato**, não só na política. |
