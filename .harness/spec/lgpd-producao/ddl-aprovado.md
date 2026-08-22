# DDL aprovado — `lgpd-producao` (débitos pré-piloto #5 e #9)

> **Fonte normativa.** O builder implementa **isto**, byte a byte. Divergência entre este arquivo e
> qualquer outro documento (spec, memory-bank, comentário de código) resolve-se **a favor deste**.
> Gate: `harness-architect`, 21/08/2026.
>
> ADRs: `.harness/memory-bank/decisions/ADR-20260821-anonimizacao-em-vez-de-exclusao.md`
>       `.harness/memory-bank/decisions/ADR-20260821-reviews-por-vinculo.md`
>       `.harness/memory-bank/decisions/ADR-20260821-lapide-neutraliza-acao-referencial.md`
>       `.harness/memory-bank/decisions/ADR-20260821-expurgo-de-conteudo-nao-de-linha.md`
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
| `verified_identity` | **`false`** | Afirmação sobre uma identidade que não existe mais. |
| `badges_hidden` (F12, 20260817001400) | **`true`** *(emenda 2026-08-21)* | **Não é "retida por ser boolean sem conteúdo pessoal".** O badge "Já trabalhou com" é **derivado** de `applications`/`jobs`/`reviews` — todos **RETIDOS**. `get_worker_company_badges` (20260817001400:159) só zera a seção quando `w.badges_hidden`. Como a lápide **apaga** `worker_company_badge_prefs` (o opt-out por empresa, abaixo), deixar `badges_hidden=false` faria o grafo "onde essa pessoa trabalhou" **ressuscitar** para toda empresa que ainda passa em `can_view_worker_profile` (ramo `applications`, que sobrevive). Forçar `true` é o único ponto único que fecha a seção inteira. Mesma classe de `verified_identity=false`: afirmação sobre um perfil que não existe mais. |
| `accepts_referrals` (F10, 20260817001500) | **`false`** *(emenda 2026-08-21)* | Default é `true`. `create_worker_referral` lê esta coluna (20260817001500:503) como opt-in. O caminho já está fechado a montante (a indicação exige `team_connections` aceita, e a lápide **apaga** `team_connections`), mas defesa em profundidade custa uma atribuição: uma pessoa que pediu para ser eliminada não permanece **oferecível** a outras empresas. |
| `discoverable_for_sos` (F11, 20260817001600) | **`false`** *(emenda 2026-08-21)* | **Este não é opcional.** O pool de SOS é calculado no disparo por `... WHERE discoverable_for_sos` (20260817001600:305) — **sem** filtro de `anonymized_at`, que não existia quando F11 foi escrita. Um freela que tinha optado por `true` continuaria sendo alcançado por chamados de empresas fora do Elenco **depois de excluir a conta**. Alternativa considerada e rejeitada: emendar o predicado de `create_sos_call` com `AND anonymized_at IS NULL` — corrige um consumidor e deixa os próximos por conta da memória de quem escrever. Zerar a flag na lápide corrige na fonte. (Emendar o predicado também é bom-vindo depois; não substitui isto.) |
| `xp`, `level`, `rating_average`, `reviews_count`, `completed_jobs_count`, `earnings_total`, `profile_views` | **RETIDOS** | Agregados numéricos sobre chave pseudônima; não identificam. `earnings_total` alimenta BI. Zerá-los reescreveria histórico agregado sem ganho de privacidade. |
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

### 2.2 SQL — cabeçalho e asserções de schema

```sql
-- Migration: LGPD — exclusão de conta vira ANONIMIZAÇÃO + lápide pseudônima (débito pré-piloto #5)
-- File: supabase/migrations/20260821000000_lgpd_account_anonymization.sql
-- ADR: .harness/memory-bank/decisions/ADR-20260821-anonimizacao-em-vez-de-exclusao.md
-- DDL aprovado (FONTE NORMATIVA): .harness/spec/lgpd-producao/ddl-aprovado.md
-- Gate: harness-architect (21/08/2026).
--
-- ============================================================================
-- PROBLEMA (em produção, pré-existente — nenhuma feature desta leva criou)
-- ----------------------------------------------------------------------------
--   auth.admin.deleteUser falha por DOIS caminhos independentes:
--     (1) auth.users --CASCADE--> workers --RESTRICT-- shift_payments / service_terms
--     (2) auth.users --CASCADE--> wallets --NO ACTION-- wallet_transactions / escrow_transactions
--   O produto promete o direito de eliminação (LGPD art. 18, VI) e não cumpre.
--
-- DECISÃO
-- ----------------------------------------------------------------------------
--   A credencial (auth.users) é APAGADA. As linhas de workers/companies/wallets SOBREVIVEM como
--   lápide pseudônima, sem conteúdo pessoal. Para isso as FKs CASCADE para auth.users são
--   REMOVIDAS. shift_payments e service_terms continuam RESTRICT e continuam intactos.
--
--   ⚠️ NÃO é "anonimização" no sentido do art. 5º, XI: term_text de termo ACEITO retém nome e CPF
--   como prova (art. 7º, VI + art. 16, I). É eliminação parcial + retenção justificada. A Política
--   de Privacidade PRECISA dizer isso (débito #1) antes desta rotina ir a público.
--
-- FRONTEIRA FINANCEIRA (Article 8/9) — INALTERADA
-- ----------------------------------------------------------------------------
--   Nenhum UPDATE em wallets.balance. Nenhum DELETE em wallet_transactions/escrow_transactions.
--   Nenhuma RPC de saldo tocada. A remoção da CASCADE de wallets EXISTE PARA PROTEGER o razão:
--   hoje a cascata tentaria apagar a carteira e o NO ACTION do razão derruba a transação inteira.
--
-- Risk: MEDIUM-HIGH — remove FKs de identidade em tabelas centrais e cria rotina destrutiva.
-- Backup required before production deploy: SIM (pg_dump de workers, companies, service_terms).
--
-- DOWN (rollback): ver rodapé.
-- ============================================================================

-- =============================================
-- 1. ASSERÇÕES DE SCHEMA — a migration FALHA FECHADO se o banco não for o esperado
--    "Migration não aplicada é migration não verificada": as colunas de `workers`/`companies`
--    NÃO têm DDL no repositório (tabelas criadas fora de migration). Em vez de assumir, exigimos.
--    Falha aqui = HALT, volta ao architect com a lista real de colunas. NÃO editar a lista
--    às cegas para "fazer passar".
-- =============================================
DO $$
DECLARE
    -- Colunas que a rotina ESCREVE (apaga ou substitui por valor). Emenda 2026-08-21:
    -- +badges_hidden, +accepts_referrals, +discoverable_for_sos (F10/F11/F12) e +companies.city.
    v_expected_workers   text[] := ARRAY[
        'full_name','cpf','phone','birth_date','pix_key','bio','city','avatar_url','cover_url',
        'primary_role','roles','tags','availability','availability_days','experience_years',
        'verified_identity','badges_hidden','accepts_referrals','discoverable_for_sos'
    ];
    v_expected_companies text[] := ARRAY[
        'name','cnpj','city','email','address','website','description','industry','logo_url',
        'cover_url','default_briefing'
    ];

    -- Emenda 2026-08-21 — asserção (c): dependentes de workers/companies JÁ CLASSIFICADOS em §2.1.
    -- Ver §2.1.0: a lápide neutraliza CASCADE/SET NULL/SET DEFAULT. Tabela fora desta lista =
    -- dado sobrevivendo em silêncio. NÃO adicionar nome aqui para "fazer passar": adicionar
    -- significa "eu decidi o que acontece com essa tabela e escrevi na §2.1".
    v_classified_deps text[] := ARRAY[
        'public.shift_payments',              -- RESTRICT, INTOCADA (documento fiscal)
        'public.service_terms',               -- RESTRICT, retido/redigido conforme aceite
        'public.team_connections',            -- DELETE
        'public.team_lists',                  -- DELETE (empresa)
        'public.team_list_members',           -- DELETE (freela) + cascata intra-domínio
        'public.payment_methods',             -- DELETE (empresa)
        'public.company_spend_limits',        -- DELETE (empresa)
        'public.company_monthly_revenue',     -- DELETE (empresa)
        'public.job_series',                  -- DELETE (empresa)
        'public.worker_certifications',       -- DELETE (freela) / verified_by_company_id RETIDO
        'public.worker_trainings',            -- DELETE (freela E empresa)
        'public.worker_referrals',            -- DELETE (3 predicados)
        'public.worker_company_badge_prefs'   -- DELETE + workers.badges_hidden = true
    ];

    v_col     text;
    v_unknown text;
BEGIN
    -- (a) toda coluna que a rotina PRETENDE apagar precisa existir
    FOREACH v_col IN ARRAY v_expected_workers LOOP
        IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                        WHERE table_schema = 'public' AND table_name = 'workers'
                          AND column_name = v_col) THEN
            RAISE EXCEPTION 'ASSERCAO: public.workers.% nao existe. HALT -> architect (ddl-aprovado 2.1).', v_col;
        END IF;
    END LOOP;

    FOREACH v_col IN ARRAY v_expected_companies LOOP
        IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                        WHERE table_schema = 'public' AND table_name = 'companies'
                          AND column_name = v_col) THEN
            RAISE EXCEPTION 'ASSERCAO: public.companies.% nao existe. HALT -> architect (ddl-aprovado 2.1).', v_col;
        END IF;
    END LOOP;

    -- (b) nenhuma coluna pode ficar FORA da classificação (apagada OU retida).
    --     Coluna nova não classificada = dado pessoal potencialmente sobrevivendo em silêncio.
    SELECT string_agg(c.column_name, ', ') INTO v_unknown
    FROM information_schema.columns c
    WHERE c.table_schema = 'public' AND c.table_name = 'workers'
      AND c.column_name <> ALL (v_expected_workers)
      AND c.column_name <> ALL (ARRAY[
            'id','xp','level','rating_average','reviews_count','completed_jobs_count',
            'earnings_total','profile_views','accepted_tos','tos_accepted_at','tos_version',
            'onboarding_completed','created_at','updated_at','anonymized_at'
      ]);
    IF v_unknown IS NOT NULL THEN
        RAISE EXCEPTION 'ASSERCAO: colunas nao classificadas em public.workers: %. HALT -> architect.', v_unknown;
    END IF;

    SELECT string_agg(c.column_name, ', ') INTO v_unknown
    FROM information_schema.columns c
    WHERE c.table_schema = 'public' AND c.table_name = 'companies'
      AND c.column_name <> ALL (v_expected_companies)
      AND c.column_name <> ALL (ARRAY[
            'id','owner_id','rating_average','reviews_count','onboarding_completed',
            'accepted_tos','tos_accepted_at','tos_version','created_at','updated_at',
            'link_risk_alert_enabled','link_risk_alert_threshold','anonymized_at'
      ]);
    IF v_unknown IS NOT NULL THEN
        RAISE EXCEPTION 'ASSERCAO: colunas nao classificadas em public.companies: %. HALT -> architect.', v_unknown;
    END IF;

    -- (c) EMENDA 2026-08-21 — nenhuma TABELA dependente pode ficar fora da classificação.
    --     Por que existe (§2.1.0): a lápide nunca é apagada, logo NENHUM ON DELETE pendurado em
    --     workers/companies dispara — CASCADE, SET NULL e SET DEFAULT viram NO ACTION de fato.
    --     O que antes o banco limpava de graça agora TEM de estar na RPC do §2.5.
    --     Esta asserção é o mecanismo que descobre tabela nova; a lista à mão só DECLARA a decisão.
    --     (F10 `worker_referrals` e F12 `worker_company_badge_prefs` nasceram depois do contrato
    --      congelado e passaram despercebidas justamente por não haver esta checagem.)
    SELECT string_agg(DISTINCT con.conrelid::regclass::text, ', ') INTO v_unknown
    FROM pg_constraint con
    WHERE con.contype = 'f'
      AND con.confrelid IN ('public.workers'::regclass, 'public.companies'::regclass)
      AND con.conrelid NOT IN ('public.workers'::regclass, 'public.companies'::regclass)
      AND con.conrelid::regclass::text <> ALL (v_classified_deps);
    IF v_unknown IS NOT NULL THEN
        RAISE EXCEPTION
          'ASSERCAO: tabelas dependentes de workers/companies NAO classificadas em §2.1: %. '
          'A lapide neutraliza ON DELETE (CASCADE/SET NULL/SET DEFAULT nao disparam mais): esse '
          'dado sobreviveria a exclusao da conta EM SILENCIO. HALT -> architect.', v_unknown;
    END IF;
END $$;
```

> **Nota sobre a asserção (c) — por que ela cobre `SET NULL` também.** O filtro **não** discrimina
> `confdeltype`. É de propósito: `RESTRICT`/`NO ACTION` continuam sendo dependência que a rotina
> precisa ter pensado (é o caso de `shift_payments`/`service_terms`, cuja decisão foi "INTOCADA"),
> e `SET NULL` é justamente o caso de `worker_certifications.verified_by_company_id`, que também
> deixou de disparar. Uma dependência **decidida como "nada a fazer"** entra na lista igual — o que
> não pode existir é dependência **não decidida**.

### 2.3 SQL — quebra das CASCADEs para `auth.users`

```sql
-- =============================================
-- 2. REMOÇÃO DAS FKs CASCADE PARA auth.users
--    Descoberta dinâmica: o nome da constraint NÃO está no repositório (tabelas criadas fora de
--    migration). NUNCA hard-codar `workers_id_fkey`.
--    Idempotente: rodar duas vezes não faz nada na segunda.
-- =============================================
DO $$
DECLARE
    r          record;
    v_leftover text;
BEGIN
    FOR r IN
        SELECT con.conname, con.conrelid::regclass::text AS tbl
        FROM pg_constraint con
        WHERE con.contype = 'f'
          AND con.confrelid = 'auth.users'::regclass
          AND con.conrelid IN ('public.workers'::regclass,
                               'public.companies'::regclass,
                               'public.wallets'::regclass)
    LOOP
        RAISE NOTICE 'Removendo FK % em % -> auth.users (lapide LGPD).', r.conname, r.tbl;
        EXECUTE format('ALTER TABLE %s DROP CONSTRAINT %I', r.tbl, r.conname);
    END LOOP;

    -- Qualquer OUTRA tabela que ainda apague em cascata junto com auth.users precisa ser
    -- conscientemente revisada: se guardar dado retido, deleteUser o destrói em silêncio.
    -- A lista abaixo é a de tabelas cujo apagamento em cascata é DESEJADO.
    SELECT string_agg(DISTINCT con.conrelid::regclass::text, ', ') INTO v_leftover
    FROM pg_constraint con
    WHERE con.contype = 'f'
      AND con.confrelid = 'auth.users'::regclass
      AND con.confdeltype = 'c'   -- 'c' = CASCADE
      AND con.conrelid::regclass::text <> ALL (ARRAY[
            'public.notifications', 'public.analytics_events',
            'public."Message"', 'public."Conversation"'
      ]);
    IF v_leftover IS NOT NULL THEN
        RAISE EXCEPTION
          'ASSERCAO: FK CASCADE para auth.users nao revisada em: %. deleteUser apagaria esse dado. HALT -> architect.',
          v_leftover;
    END IF;
END $$;

-- =============================================
-- 3. MARCADOR DE LÁPIDE
--    ADD COLUMN nullable sem DEFAULT = sem reescrita de heap.
-- =============================================
ALTER TABLE public.workers   ADD COLUMN IF NOT EXISTS anonymized_at timestamptz;
ALTER TABLE public.companies ADD COLUMN IF NOT EXISTS anonymized_at timestamptz;

COMMENT ON COLUMN public.workers.anonymized_at IS
    'Lapide LGPD: a conta foi excluida (auth.users apagado) e o conteudo pessoal desta linha foi '
    'removido por anonymize_account(). A linha SOBREVIVE porque e chave pseudonima de shift_payments '
    'e service_terms (retencao por obrigacao legal, art. 16 I). NULL = conta viva. One-way.';
COMMENT ON COLUMN public.companies.anonymized_at IS
    'Lapide LGPD — ver public.workers.anonymized_at.';

-- Índices parciais: a lápide é minoria, e a consulta útil é "quem já foi anonimizado".
-- Sem CONCURRENTLY: migration do Supabase roda dentro de transação.
CREATE INDEX IF NOT EXISTS idx_workers_anonymized
    ON public.workers (anonymized_at) WHERE anonymized_at IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_companies_anonymized
    ON public.companies (anonymized_at) WHERE anonymized_at IS NOT NULL;
```

### 2.4 SQL — emenda ao `enforce_service_term_immutability`

> **Reproduzir a função INTEIRA.** É `CREATE OR REPLACE` sobre função aplicada em produção
> (20260817001100). O único delta é o marcado `EMENDA 2026-08-21`. Não reordenar e não reescrever
> mensagens de erro (há teste e log dependendo delas). O trigger
> `trg_enforce_service_term_immutability` **não** é recriado — `CREATE OR REPLACE FUNCTION` mantém o
> trigger existente apontando para o novo corpo.

```sql
-- =============================================
-- 4. IMUTABILIDADE DO TERMO — emenda LGPD
--    Delta único: accepted_ip / accepted_user_agent podem ir a NULL (e SÓ a NULL) dentro da
--    transição de anonimização (anonymized_at NULL -> ts). IP é dado pessoal autônomo e
--    user-agent é fingerprint; nenhum dos dois é elemento do negócio jurídico, e o próprio
--    schema os declara BEST-EFFORT e FALSIFICÁVEIS.
-- =============================================
CREATE OR REPLACE FUNCTION public.enforce_service_term_immutability()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    -- EMENDA 2026-08-21: a transição de anonimização, calculada uma vez.
    v_anonymizing boolean := (OLD.anonymized_at IS NULL AND NEW.anonymized_at IS NOT NULL);
BEGIN
    -- === Vínculo e valor: imutáveis SEMPRE ===
    IF NEW.id               IS DISTINCT FROM OLD.id
       OR NEW.shift_payment_id IS DISTINCT FROM OLD.shift_payment_id
       OR NEW.job_id           IS DISTINCT FROM OLD.job_id
       OR NEW.worker_id        IS DISTINCT FROM OLD.worker_id
       OR NEW.company_id       IS DISTINCT FROM OLD.company_id
       OR NEW.amount           IS DISTINCT FROM OLD.amount
       OR NEW.created_at       IS DISTINCT FROM OLD.created_at
    THEN
        RAISE EXCEPTION 'service_terms: vinculo e valor sao imutaveis (shift_payment_id, job_id, worker_id, company_id, amount, created_at).';
    END IF;

    -- === accepted_at: ONE-WAY (NULL -> timestamp). Nunca altera, nunca limpa. ===
    IF OLD.accepted_at IS NOT NULL AND NEW.accepted_at IS DISTINCT FROM OLD.accepted_at THEN
        RAISE EXCEPTION 'service_terms: accepted_at e imutavel apos o aceite.';
    END IF;

    -- === IP/UA: só podem ser gravados NO aceite; nunca reescritos depois. ===
    -- EMENDA 2026-08-21 (LGPD): exceção única — a anonimização pode APAGÁ-LOS (levar a NULL).
    -- Levar a QUALQUER OUTRO VALOR continua proibido: não se falsifica trilha de aceite.
    IF OLD.accepted_at IS NOT NULL
       AND (NEW.accepted_ip         IS DISTINCT FROM OLD.accepted_ip
         OR NEW.accepted_user_agent IS DISTINCT FROM OLD.accepted_user_agent)
       AND NOT (v_anonymizing
                AND NEW.accepted_ip IS NULL
                AND NEW.accepted_user_agent IS NULL)
    THEN
        RAISE EXCEPTION 'service_terms: accepted_ip/accepted_user_agent sao imutaveis apos o aceite (unica excecao: anonimizacao LGPD, e apenas para NULL).';
    END IF;

    -- === anonymized_at: ONE-WAY (NULL -> timestamp). Nunca volta. ===
    IF OLD.anonymized_at IS NOT NULL AND NEW.anonymized_at IS DISTINCT FROM OLD.anonymized_at THEN
        RAISE EXCEPTION 'service_terms: anonymized_at e imutavel.';
    END IF;

    -- === term_text / term_version: livres ENQUANTO rascunho; congelados no aceite. ===
    -- Única exceção pós-aceite: a anonimização LGPD (NULL -> ts), que é o ato de
    -- reescrever o texto. Fora dela, um termo aceito não muda mais.
    IF OLD.accepted_at IS NOT NULL
       AND (NEW.term_text IS DISTINCT FROM OLD.term_text
         OR NEW.term_version IS DISTINCT FROM OLD.term_version)
       AND NOT v_anonymizing
    THEN
        RAISE EXCEPTION 'service_terms: term_text/term_version sao imutaveis apos o aceite (unica excecao: anonimizacao LGPD).';
    END IF;

    RETURN NEW;
END;
$$;

COMMENT ON FUNCTION public.enforce_service_term_immutability() IS
    'BEFORE UPDATE em service_terms. term_text e rascunho enquanto accepted_at IS NULL e CONGELA no '
    'aceite. Vale para TODOS os papeis (service_role e owner inclusive) — RLS nao cobriria. Unica '
    'reescrita pos-aceite: anonimizacao LGPD (anonymized_at NULL->ts), que tambem pode APAGAR '
    'accepted_ip/accepted_user_agent (so para NULL). ADR-20260818 + ADR-20260821.';

COMMENT ON COLUMN public.service_terms.anonymized_at IS
    'Marca que a linha passou pela rotina de anonimizacao de conta (anonymize_account). One-way, '
    'fechada ao client. Habilita DUAS reescritas e so elas: (1) term_text, usada APENAS quando o '
    'termo era RASCUNHO (accepted_at IS NULL) — termo ACEITO e RETIDO INTEGRALMENTE como prova de '
    'transacao encerrada (LGPD art. 7 VI / art. 16 I, ADR-20260818); (2) accepted_ip / '
    'accepted_user_agent -> NULL (telemetria; nao e elemento do negocio juridico).';
```

### 2.5 SQL — a RPC `anonymize_account`

> **Emenda 2026-08-22 (F13):** o SQL abaixo é o de 21/08. Os três deltas da emenda —
> **GUARDA 4** (`sole_organization_owner`), o bloco **SOFT-REMOVE** de
> `company_members`/`organization_members` sob `pg_catalog.to_regclass` (a migration pode ir ao
> banco **antes** da F13), e as asserções **(d)/(e)** — estão escritos em
> `supabase/migrations/20260821000000_lgpd_account_anonymization.sql`, que é a **cópia normativa**
> desses trechos. Não duplicados aqui para não criar duas fontes divergentes do mesmo corpo.
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
> ⚠️ **Drift declarado (pré-existente, não introduzido nesta revisão):** os blocos SQL de §2.2 e
> §2.5 são o baseline de 21/08 e **não** contêm as emendas de 22/08 — inclusive a correção D5 de
> `regclass::text`, que aqui ainda aparece na forma **quebrada**. Enquanto a migration não for
> aplicada, o arquivo `.sql` é a fonte de verdade do **corpo**; esta seção continua normativa para
> a **classificação** (§2.1) e para as **decisões**. Ressincronizar os blocos é tarefa própria e
> vai ao humano (§5.5).

```sql
-- =============================================
-- 5. RPC DE ANONIMIZAÇÃO
--    Uma transação (corpo de função = transação): ou a conta inteira é anonimizada, ou nada.
--    SECURITY DEFINER + search_path='' + GRANT EXECUTE SOMENTE a service_role.
--    Chamada exclusivamente pela Edge Function `delete-account` (Article 10).
--    Devolve `outcome` estruturado — NUNCA levanta exceção em caminho esperado.
-- =============================================
CREATE OR REPLACE FUNCTION public.anonymize_account(p_user_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_now           timestamptz := now();
    v_is_worker     boolean;
    v_company_ids   uuid[];
    v_balance       numeric;
    v_counts        jsonb := '{}'::jsonb;
    v_n             integer;
    c_worker_label  constant text := '[Conta Deletada]';
    c_company_label constant text := '[Empresa Deletada]';
    c_redacted      constant text :=
        '[TERMO REMOVIDO — a conta do titular foi excluida a pedido dele (LGPD art. 18, VI). '
        'Este termo nao havia sido aceito e, portanto, nao possui valor probatorio.]';
BEGIN
    IF p_user_id IS NULL THEN
        RETURN jsonb_build_object('outcome', 'invalid_input');
    END IF;

    SELECT EXISTS (SELECT 1 FROM public.workers w WHERE w.id = p_user_id) INTO v_is_worker;

    -- Ancoragem DUPLA de empresa (mesma regra de is_company_owner / is_job_owner):
    -- companies.id = auth.uid() no caso canônico, owner_id nos registros com dono separado.
    SELECT array_agg(c.id) INTO v_company_ids
    FROM public.companies c
    WHERE c.id = p_user_id OR c.owner_id = p_user_id;
    v_company_ids := coalesce(v_company_ids, ARRAY[]::uuid[]);

    IF NOT v_is_worker AND cardinality(v_company_ids) = 0 THEN
        RETURN jsonb_build_object('outcome', 'not_found');
    END IF;

    -- ---- GUARDA 1: saldo. Article 8 — não zeramos saldo aqui; RECUSAMOS. ----
    SELECT w.balance INTO v_balance FROM public.wallets w WHERE w.user_id = p_user_id;
    IF coalesce(v_balance, 0) > 0 THEN
        RETURN jsonb_build_object('outcome', 'wallet_has_balance', 'balance', v_balance);
    END IF;

    -- ---- GUARDA 2: escrow em aberto ----
    IF EXISTS (
        SELECT 1
        FROM public.escrow_transactions e
        JOIN public.wallets w
          ON w.id = e.company_wallet_id OR w.id = e.worker_wallet_id
        WHERE w.user_id = p_user_id
          AND e.status IN ('reserved', 'authorized')
    ) THEN
        RETURN jsonb_build_object('outcome', 'escrow_active');
    END IF;

    -- ---- GUARDA 3: pagamento prometido e não liquidado (modo A) ----
    IF EXISTS (
        SELECT 1 FROM public.shift_payments sp
        WHERE sp.status = 'scheduled'
          AND (sp.worker_id = p_user_id OR sp.company_id = ANY (v_company_ids))
    ) THEN
        RETURN jsonb_build_object('outcome', 'scheduled_payment_pending');
    END IF;

    -- =========================================================
    -- A PARTIR DAQUI É DESTRUTIVO. Tudo numa transação só.
    -- =========================================================

    -- ---- service_terms: rascunho é redigido; termo ACEITO é retido (só ip/ua saem) ----
    -- UM ÚNICO UPDATE por linha: o trigger só libera a reescrita quando anonymized_at vai de
    -- NULL para ts NO MESMO statement. Dois UPDATEs separados seriam BARRADOS.
    UPDATE public.service_terms st
       SET term_text           = CASE WHEN st.accepted_at IS NULL THEN c_redacted ELSE st.term_text END,
           accepted_ip         = NULL,
           accepted_user_agent = NULL,
           anonymized_at       = v_now
     WHERE st.anonymized_at IS NULL
       AND (st.worker_id = p_user_id OR st.company_id = ANY (v_company_ids));
    GET DIAGNOSTICS v_n = ROW_COUNT;
    v_counts := v_counts || jsonb_build_object('service_terms', v_n);

    -- ---- certificações/treinamentos do freela: DELETE (ramo (c) do trigger F8 barra UPDATE) ----
    IF v_is_worker THEN
        DELETE FROM public.worker_certifications wc WHERE wc.worker_id = p_user_id;
        GET DIAGNOSTICS v_n = ROW_COUNT;
        v_counts := v_counts || jsonb_build_object('worker_certifications', v_n);

        DELETE FROM public.worker_trainings wt WHERE wt.worker_id = p_user_id;
        GET DIAGNOSTICS v_n = ROW_COUNT;
        v_counts := v_counts || jsonb_build_object('worker_trainings', v_n);

        DELETE FROM public.team_list_members tlm WHERE tlm.worker_id = p_user_id;
        GET DIAGNOSTICS v_n = ROW_COUNT;
        v_counts := v_counts || jsonb_build_object('team_list_members', v_n);
    END IF;

    -- ---- EMENDA 2026-08-21: ramo EMPRESA (era mais fino que o ramo freela — §2.1.0, item 4) ----
    IF cardinality(v_company_ids) > 0 THEN
        -- `team_lists` apaga `team_list_members` por cascata INTRA-DOMÍNIO (a FK aponta para
        -- team_lists(id), que é apagada de verdade — essa cascata continua disparando).
        DELETE FROM public.team_lists tl WHERE tl.company_id = ANY (v_company_ids);
        GET DIAGNOSTICS v_n = ROW_COUNT;
        v_counts := v_counts || jsonb_build_object('team_lists', v_n);

        -- financial_contact_email / financial_contact_phone = contato de pessoa natural.
        DELETE FROM public.company_spend_limits csl WHERE csl.company_id = ANY (v_company_ids);
        GET DIAGNOSTICS v_n = ROW_COUNT;
        v_counts := v_counts || jsonb_build_object('company_spend_limits', v_n);

        DELETE FROM public.company_monthly_revenue cmr WHERE cmr.company_id = ANY (v_company_ids);
        GET DIAGNOSTICS v_n = ROW_COUNT;
        v_counts := v_counts || jsonb_build_object('company_monthly_revenue', v_n);

        -- job_template carrega briefing (mesma classe de companies.default_briefing).
        -- Seguro: NÃO há FK de jobs para job_series — as ocorrências materializadas permanecem.
        DELETE FROM public.job_series js WHERE js.company_id = ANY (v_company_ids);
        GET DIAGNOSTICS v_n = ROW_COUNT;
        v_counts := v_counts || jsonb_build_object('job_series', v_n);

        -- anotação interna que a empresa escreveu sobre terceiros que CONTINUAM na plataforma.
        DELETE FROM public.worker_trainings wt WHERE wt.company_id = ANY (v_company_ids);
        GET DIAGNOSTICS v_n = ROW_COUNT;
        v_counts := v_counts || jsonb_build_object('worker_trainings_company', v_n);
    END IF;

    -- ---- vínculo de elenco: dos dois lados ----
    DELETE FROM public.team_connections tc
     WHERE tc.worker_id = p_user_id OR tc.company_id = ANY (v_company_ids);
    GET DIAGNOSTICS v_n = ROW_COUNT;
    v_counts := v_counts || jsonb_build_object('team_connections', v_n);

    -- ---- EMENDA 2026-08-21: indicação entre empresas (F10) — grafo sobre a pessoa ----
    -- TRÊS predicados: a indicação é um triângulo (freela, quem indica, para quem se indica).
    -- A proveniência do BI de aquisição NÃO se perde: vive em team_connections.source='referral'.
    DELETE FROM public.worker_referrals wr
     WHERE wr.worker_id = p_user_id
        OR wr.referring_company_id  = ANY (v_company_ids)
        OR wr.requesting_company_id = ANY (v_company_ids);
    GET DIAGNOSTICS v_n = ROW_COUNT;
    v_counts := v_counts || jsonb_build_object('worker_referrals', v_n);

    -- ---- EMENDA 2026-08-21: opt-out de badge por empresa (F12) ----
    -- ⚠️ Este DELETE só é seguro porque a lápide de `workers` seta badges_hidden = true logo
    --    abaixo. Sozinho, ele RESSUSCITARIA os badges que estas linhas suprimiam (o badge é
    --    derivado de applications/jobs/reviews, todos RETIDOS). Os dois andam juntos.
    DELETE FROM public.worker_company_badge_prefs bp
     WHERE bp.worker_id = p_user_id OR bp.company_id = ANY (v_company_ids);
    GET DIAGNOSTICS v_n = ROW_COUNT;
    v_counts := v_counts || jsonb_build_object('worker_company_badge_prefs', v_n);

    -- ---- notificações: texto com nome, valor e link ----
    DELETE FROM public.notifications n WHERE n.user_id = p_user_id;
    GET DIAGNOSTICS v_n = ROW_COUNT;
    v_counts := v_counts || jsonb_build_object('notifications', v_n);

    -- ---- token de cartão da empresa (revogar no Asaas é da Edge Function) ----
    IF cardinality(v_company_ids) > 0 THEN
        DELETE FROM public.payment_methods pm WHERE pm.company_id = ANY (v_company_ids);
        GET DIAGNOSTICS v_n = ROW_COUNT;
        v_counts := v_counts || jsonb_build_object('payment_methods', v_n);
    END IF;

    -- ---- LÁPIDE: workers ----
    IF v_is_worker THEN
        UPDATE public.workers w
           SET full_name         = c_worker_label,
               cpf               = NULL,
               phone             = NULL,
               birth_date        = NULL,
               pix_key           = NULL,
               bio               = NULL,
               city              = NULL,
               avatar_url        = NULL,
               cover_url         = NULL,
               primary_role      = NULL,
               roles             = NULL,
               tags              = NULL,
               availability      = NULL,
               availability_days = NULL,
               experience_years  = NULL,
               verified_identity = false,
               -- EMENDA 2026-08-21 — flags de alcance/exposição (F10/F11/F12).
               -- Não são "boolean sem conteúdo pessoal": governam quem alcança e quem enxerga
               -- o grafo desta pessoa. Ver §2.1 (workers) para o raciocínio de cada uma.
               badges_hidden        = true,   -- fecha "Já trabalhou com" (derivado de dado RETIDO)
               accepts_referrals    = false,  -- não é mais oferecível a outras empresas
               discoverable_for_sos = false,  -- sai do pool de SOS (o predicado de F11 não filtra lápide)
               anonymized_at     = coalesce(w.anonymized_at, v_now)
         WHERE w.id = p_user_id;
        GET DIAGNOSTICS v_n = ROW_COUNT;
        v_counts := v_counts || jsonb_build_object('workers', v_n);
    END IF;

    -- ---- LÁPIDE: companies ----
    IF cardinality(v_company_ids) > 0 THEN
        UPDATE public.companies c
           SET name             = c_company_label,
               cnpj             = NULL,
               city             = NULL,   -- EMENDA 2026-08-21: subconjunto de `address`, que já sai
               email            = NULL,
               address          = NULL,
               website          = NULL,
               description      = NULL,
               industry         = NULL,
               logo_url         = NULL,
               cover_url        = NULL,
               default_briefing = NULL,
               anonymized_at    = coalesce(c.anonymized_at, v_now)
         WHERE c.id = ANY (v_company_ids);
        GET DIAGNOSTICS v_n = ROW_COUNT;
        v_counts := v_counts || jsonb_build_object('companies', v_n);
    END IF;

    RETURN jsonb_build_object(
        'outcome',       'anonymized',
        'user_id',       p_user_id,
        'is_worker',     v_is_worker,
        'company_ids',   to_jsonb(v_company_ids),
        'anonymized_at', v_now,
        'counts',        v_counts
    );
END;
$$;

COMMENT ON FUNCTION public.anonymize_account(uuid) IS
    'LGPD art. 18 VI — remove o conteudo pessoal da conta e deixa uma LAPIDE PSEUDONIMA '
    '(workers/companies/wallets sobrevivem porque sao chave de shift_payments/service_terms, '
    'retidos por obrigacao legal — art. 16 I). NAO toca saldo nem razao (Article 8/9): recusa com '
    'outcome se houver saldo, escrow ativo ou pagamento agendado pendente. Chamada SO pela Edge '
    'Function delete-account (service_role). Devolve outcome, nunca excecao em caminho esperado. '
    'Idempotente: rodar de novo devolve counts zerados e outcome anonymized. ADR-20260821.';

REVOKE ALL ON FUNCTION public.anonymize_account(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.anonymize_account(uuid) TO service_role;
```

### 2.6 SQL — verificação obrigatória e DOWN

```sql
-- ============================================================================
-- COMO VERIFICAR (obrigatório após aplicar — sem isto, a migration NÃO está verificada)
-- ----------------------------------------------------------------------------
-- V1. Nenhuma FK CASCADE de identidade sobreviveu:
--     SELECT conrelid::regclass, conname, confdeltype FROM pg_constraint
--      WHERE contype='f' AND confrelid='auth.users'::regclass;
--     ⇒ workers, companies e wallets NÃO podem aparecer.
--
-- V2. Ensaio em conta de TESTE (nunca em conta real):
--     SELECT public.anonymize_account('<uuid-de-teste>');
--     ⇒ outcome='anonymized'; conferir counts.
--     SELECT full_name, cpf, phone, pix_key, anonymized_at FROM public.workers WHERE id='<uuid>';
--     ⇒ '[Conta Deletada]', NULL, NULL, NULL, timestamp.
--
-- V3. Termo ACEITO foi RETIDO e a telemetria saiu:
--     SELECT accepted_at IS NOT NULL AS aceito, length(term_text) > 0 AS texto_retido,
--            accepted_ip, accepted_user_agent, anonymized_at
--       FROM public.service_terms WHERE worker_id='<uuid>';
--     ⇒ aceito=t, texto_retido=t, ip/ua NULL, anonymized_at preenchido.
--
-- V4. Termo RASCUNHO foi redigido ⇒ term_text começa com '[TERMO REMOVIDO'.
--
-- V5. Saldo e razão intactos (Article 8/9):
--     SELECT count(*) FROM public.wallet_transactions wt
--       JOIN public.wallets w ON w.id=wt.wallet_id WHERE w.user_id='<uuid>';
--     ⇒ mesmo número de antes. E: SELECT balance FROM public.wallets WHERE user_id='<uuid>' ⇒ 0.
--
-- V6. Só então: auth.admin.deleteUser('<uuid>') ⇒ 200, e a linha de workers CONTINUA existindo.
--
-- V7. O recibo do turno pago continua abrindo para a EMPRESA (/recibo/:jobId), com '[Conta Deletada]'.
--
-- V8. Guardas: em conta com saldo > 0 ⇒ outcome='wallet_has_balance' e NENHUMA escrita.
--
-- --- EMENDA 2026-08-21 ---
-- V9.  Flags de alcance zeradas na lápide do freela:
--      SELECT badges_hidden, accepts_referrals, discoverable_for_sos FROM public.workers
--       WHERE id='<uuid>';   ⇒ t, f, f
--      E: rpc get_worker_company_badges('<uuid>') por uma EMPRESA que ainda tem applications
--         com esse freela ⇒ lista VAZIA (o grafo não ressuscitou com o DELETE das prefs).
-- V10. Nenhum dependente sobreviveu — rodar para conta de teste de FREELA e de EMPRESA:
--      SELECT 'referrals', count(*) FROM public.worker_referrals
--        WHERE worker_id='<uuid>' OR referring_company_id='<cid>' OR requesting_company_id='<cid>'
--      UNION ALL SELECT 'badge_prefs', count(*) FROM public.worker_company_badge_prefs
--        WHERE worker_id='<uuid>' OR company_id='<cid>'
--      UNION ALL SELECT 'lists',       count(*) FROM public.team_lists        WHERE company_id='<cid>'
--      UNION ALL SELECT 'spend',       count(*) FROM public.company_spend_limits WHERE company_id='<cid>'
--      UNION ALL SELECT 'revenue',     count(*) FROM public.company_monthly_revenue WHERE company_id='<cid>'
--      UNION ALL SELECT 'series',      count(*) FROM public.job_series        WHERE company_id='<cid>'
--      UNION ALL SELECT 'trainings',   count(*) FROM public.worker_trainings  WHERE company_id='<cid>';
--      ⇒ TODAS zero. (Antes da emenda, o ramo EMPRESA deixava as cinco últimas para trás.)
-- V11. `companies.city` saiu: SELECT city FROM public.companies WHERE id='<cid>' ⇒ NULL.
-- V12. Ocorrências de série SOBREVIVERAM ao DELETE de job_series (não há FK):
--      SELECT count(*) FROM public.jobs WHERE series_id='<serie-da-empresa>'; ⇒ igual a antes.
--
-- DOWN (rollback — copiar/colar). ATENÇÃO: NÃO desfaz dados já anonimizados. Irreversível por
-- natureza; por isso o backup do cabeçalho é obrigatório.
--   DROP FUNCTION IF EXISTS public.anonymize_account(uuid);
--   -- restaurar o corpo anterior de enforce_service_term_immutability (20260817001100 §7)
--   ALTER TABLE public.workers   DROP COLUMN IF EXISTS anonymized_at;
--   ALTER TABLE public.companies DROP COLUMN IF EXISTS anonymized_at;
--   -- re-adicionar as FKs exige que NÃO existam lápides órfãs:
--   ALTER TABLE public.workers   ADD CONSTRAINT workers_id_fkey
--       FOREIGN KEY (id) REFERENCES auth.users(id) ON DELETE CASCADE;
--   ALTER TABLE public.companies ADD CONSTRAINT companies_id_fkey
--       FOREIGN KEY (id) REFERENCES auth.users(id) ON DELETE CASCADE;
--   ALTER TABLE public.wallets   ADD CONSTRAINT wallets_user_id_fkey
--       FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;
-- ============================================================================
```

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

### 2.7.2 SQL — cabeçalho, asserção de ordem e o prazo num lugar só

```sql
-- Migration: LGPD — expurgo de conteudo pessoal apos o prazo de retencao (debito pre-piloto #5)
-- File: supabase/migrations/20260821000400_lgpd_retention_purge.sql
-- ADR: .harness/memory-bank/decisions/ADR-20260821-expurgo-de-conteudo-nao-de-linha.md
-- DDL aprovado (FONTE NORMATIVA): .harness/spec/lgpd-producao/ddl-aprovado.md §2.7
-- Gate: harness-architect (21/08/2026). H1 decidido pelo owner: 5 anos.
--
-- ============================================================================
-- O QUE ESTA MIGRATION FAZ
-- ----------------------------------------------------------------------------
--   Cumpre o prazo de retencao que a #1 promete. Decorridos 5 anos de `paid_at` / `accepted_at`,
--   o CONTEUDO PESSOAL de `service_terms` e `shift_payments` e eliminado por UPDATE. A LINHA
--   permanece: valor, data e partes (uuids pseudonimos) continuam no banco e no BI.
--
--   NAO HA DELETE. Nem aqui, nem em lugar nenhum, nessas duas tabelas. Razoes (ADR):
--     - `shift_payments` NAO TEM policy de DELETE por decisao explicita de 20260630000000
--       ("auditoria nao se apaga; correcao = voided"). Um cron que apaga contradiz o schema.
--     - `service_terms.shift_payment_id` e RESTRICT (+ FK composta service_terms_payment_identity)
--       => DELETE teria ordem obrigatoria e lote abortado por erro de ordem. Sem DELETE, o
--       problema inteiro deixa de existir.
--     - Os dois guardas de imutabilidade sao BEFORE UPDATE. Um DELETE ESCAPA de ambos: seria a
--       unica operacao destrutiva do sistema sem guarda nenhum.
--
-- ============================================================================
-- ORDEM DE APLICACAO — OBRIGATORIA: #1 (20260821000000) ANTES DESTA
-- ----------------------------------------------------------------------------
--   Esta migration reescreve `enforce_service_term_immutability` com o corpo-SUPERSET: emenda da
--   anonimizacao (ip/ua -> NULL sob anonymized_at) + emenda do expurgo. Aplicada ANTES da #1, a
--   #1 sobrescreveria a excecao do expurgo EM SILENCIO e o cron passaria a falhar todo dia.
--   A assercao abaixo torna isso impossivel: FALHA FECHADO.
--
-- ============================================================================
-- FRONTEIRA FINANCEIRA (Article 8/9) — INTACTA POR CONSTRUCAO
-- ----------------------------------------------------------------------------
--   Nenhuma tabela de saldo/razao e LIDA ou ESCRITA por esta migration. Nenhuma RPC de saldo e
--   tocada. `wallet_transactions`/`escrow_transactions` nao aparecem em nenhuma query daqui.
--
-- Risk: MEDIUM — rotina destrutiva de conteudo, agendada, que atinge tambem CONTAS VIVAS
--   (o prazo e do DADO, nao da conta — ddl-aprovado §2.7.0). Irreversivel por natureza.
-- Backup required before production deploy: SIM (pg_dump de service_terms e shift_payments).
--
-- PRIMEIRA EXECUCAO: rodar em DRY-RUN antes de deixar o cron ativo (V4 da secao COMO VERIFICAR).
--   Com 5 anos de prazo e a plataforma em piloto, o esperado hoje e ZERO linha elegivel — se o
--   dry-run devolver numero > 0, PARE: ou o relogio do banco esta errado, ou ha dado de teste com
--   data antiga. Nao "confirme" um expurgo que voce nao explica.
--
-- DOWN (rollback): ver rodape. O DOWN NAO restaura conteudo ja expurgado.
-- ============================================================================

-- =============================================
-- 1. ASSERCAO DE ORDEM — a #1 precisa estar aplicada
--    Marcadores da #1: `service_terms.anonymized_at` ja existia (20260817001100), mas
--    `workers.anonymized_at` e `public.anonymize_account` NASCEM na #1. Exigimos os dois.
-- =============================================
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
         WHERE table_schema = 'public' AND table_name = 'workers' AND column_name = 'anonymized_at'
    ) THEN
        RAISE EXCEPTION
          'ASSERCAO DE ORDEM: 20260821000000 (lgpd_account_anonymization) NAO esta aplicada. '
          'Esta migration reescreve enforce_service_term_immutability com o corpo-superset; '
          'aplicar fora de ordem faria a #1 apagar a excecao do expurgo em silencio. HALT.';
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
         WHERE n.nspname = 'public' AND p.proname = 'anonymize_account'
    ) THEN
        RAISE EXCEPTION
          'ASSERCAO DE ORDEM: public.anonymize_account nao existe — a #1 nao esta aplicada. HALT.';
    END IF;
END $$;

-- =============================================
-- 2. O PRAZO, NUM LUGAR SO
--    Consumida pela RPC de expurgo E pelos DOIS triggers de imutabilidade. Trocar 5 -> 6 anos
--    (recomendacao tecnica pendente de parecer juridico — ddl-aprovado §2.7.0) e um
--    CREATE OR REPLACE desta funcao, e mais nada. NAO inline o literal em lugar nenhum.
-- =============================================
CREATE OR REPLACE FUNCTION public.lgpd_retention_interval()
RETURNS interval
LANGUAGE sql
IMMUTABLE
SET search_path = ''
AS $$ SELECT interval '5 years' $$;

COMMENT ON FUNCTION public.lgpd_retention_interval() IS
    'Prazo de retencao do CONTEUDO PESSOAL de service_terms.term_text e shift_payments.note. '
    '5 anos = prescricao civil (CC art. 206 §5 I) — escolha do owner em 21/08/2026, PENDENTE de '
    'confirmacao juridica; recomendacao tecnica e 6 anos pelo vetor trabalhista (CF art. 7 XXIX + '
    'duracao do processo). Ponto UNICO de verdade: consumida pela RPC purge_expired_personal_data '
    'e pelos triggers enforce_service_term_immutability / enforce_shift_payment_immutability. '
    'ADR-20260821-expurgo-de-conteudo-nao-de-linha.';

-- Custo zero e evita a assimetria de risco de 20260816201457 (funcao de trigger sem EXECUTE):
-- esta funcao nao devolve dado nenhum, so o literal do prazo.
REVOKE ALL ON FUNCTION public.lgpd_retention_interval() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.lgpd_retention_interval() TO service_role, authenticated;
```

### 2.7.3 SQL — marcadores, trava de litígio e prova de conformidade

```sql
-- =============================================
-- 3. MARCADORES DO EXPURGO + TRAVA DE LITIGIO
--    ADD COLUMN nullable sem DEFAULT = sem reescrita de heap.
-- =============================================
ALTER TABLE public.service_terms   ADD COLUMN IF NOT EXISTS purged_at            timestamptz;
ALTER TABLE public.service_terms   ADD COLUMN IF NOT EXISTS retention_hold_reason text;
ALTER TABLE public.shift_payments  ADD COLUMN IF NOT EXISTS purged_at            timestamptz;

COMMENT ON COLUMN public.service_terms.purged_at IS
    'Expurgo de retencao (LGPD): venceu o prazo de lgpd_retention_interval() e o CONTEUDO PESSOAL '
    'desta linha foi eliminado (term_text -> marcador, accepted_ip/accepted_user_agent -> NULL). '
    'A LINHA permanece: amount, accepted_at, partes e vinculos sao RETIDOS. One-way, fechada ao '
    'client (service_terms so tem policy de SELECT). NAO confundir com anonymized_at, que marca '
    'exclusao de CONTA — o expurgo atinge conta viva tambem (o prazo e do DADO).';
COMMENT ON COLUMN public.shift_payments.purged_at IS
    'Expurgo de retencao (LGPD) — ver public.service_terms.purged_at. Nesta tabela o expurgo '
    'apaga APENAS `note` (unico texto livre). Valor, datas e partes sao RETIDOS: o BI de gasto '
    'historico sobrevive ao expurgo.';
COMMENT ON COLUMN public.service_terms.retention_hold_reason IS
    'TRAVA DE LITIGIO. Nao-NULL = esta linha (e o `note` do shift_payment correspondente) e '
    'PULADA pelo expurgo, indefinidamente, mesmo vencido o prazo. Preenchida por operacao '
    '(service_role) quando ha litigio/investigacao em curso. Inalcancavel pelo client por '
    'construcao: service_terms so tem policy de SELECT. Limpar a trava reabre a linha ao expurgo.';

-- Indices parciais: a varredura diaria pergunta "quem ainda NAO foi expurgado e ja venceu".
-- Expressao coalesce(...) e IMMUTABLE => indexavel. Sem CONCURRENTLY (migration roda em transacao).
CREATE INDEX IF NOT EXISTS idx_service_terms_retention_due
    ON public.service_terms ((coalesce(accepted_at, created_at)))
    WHERE purged_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_shift_payments_retention_due
    ON public.shift_payments ((coalesce(paid_at, created_at)))
    WHERE purged_at IS NULL;

-- =============================================
-- 4. PROVA DE CONFORMIDADE — registro das operacoes de tratamento (LGPD art. 37)
--    Sem isto, "expurgamos" e afirmacao sem lastro. Com isto, e consulta.
--    RLS habilitada e ZERO policy: nenhum client le (service_role ignora RLS).
-- =============================================
CREATE TABLE IF NOT EXISTS public.data_retention_purge_runs (
    id                    uuid        DEFAULT gen_random_uuid() PRIMARY KEY,
    ran_at                timestamptz NOT NULL DEFAULT now(),
    cutoff                timestamptz NOT NULL,
    retention_interval    interval    NOT NULL,
    batch_limit           integer     NOT NULL,
    service_terms_purged  integer     NOT NULL DEFAULT 0,
    shift_payments_purged integer     NOT NULL DEFAULT 0,
    service_terms_held    integer     NOT NULL DEFAULT 0,
    duration_ms           integer     NOT NULL DEFAULT 0
);

ALTER TABLE public.data_retention_purge_runs ENABLE ROW LEVEL SECURITY;

COMMENT ON TABLE public.data_retention_purge_runs IS
    'Registro das execucoes do expurgo de retencao (LGPD art. 37 — registro das operacoes de '
    'tratamento). Uma linha por execucao EFETIVA do cron/RPC. Dry-run NAO grava (diagnostico nao '
    'e operacao de tratamento). RLS habilitada sem policy: so service_role le. Nunca contem dado '
    'pessoal — so contagens.';
COMMENT ON COLUMN public.data_retention_purge_runs.service_terms_held IS
    'Quantas linhas VENCIDAS foram puladas por retention_hold_reason (trava de litigio). Numero '
    'alto e persistente = alguem esqueceu de limpar uma trava.';
```

### 2.7.4 SQL — os dois guardas de imutabilidade (corpos-superset)

> **Reproduzir as funções INTEIRAS.** São `CREATE OR REPLACE` sobre funções **aplicadas em
> produção**. `enforce_shift_payment_immutability` parte do corpo de `20260712000000` (§4);
> `enforce_service_term_immutability` parte do corpo **já emendado em §2.4** — este é o
> corpo-superset, e é o motivo da ordem `#1 → #3`. Não reordenar e **não reescrever mensagens de
> erro existentes** (há teste e log dependendo delas). Os triggers não são recriados:
> `CREATE OR REPLACE FUNCTION` mantém os existentes apontando para o novo corpo.

```sql
-- =============================================
-- 5. shift_payments — corpo vigente (20260712000000) + RAMO DE EXPURGO no topo
--    O ramo e AUTO-LIMITADO: so existe se as 5 condicoes de §0.3.1 valerem juntas. O gatilho
--    (purged_at NULL -> ts) e barato, entao UPDATE normal nao paga nada pelas checagens caras.
--    Se alguem entra no gatilho e NAO cumpre a forma, e RAISE — nunca fall-through silencioso.
-- =============================================
CREATE OR REPLACE FUNCTION public.enforce_shift_payment_immutability()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_is_company BOOLEAN;
    v_is_worker  BOOLEAN;
BEGIN
    -- === EMENDA 2026-08-21 (LGPD, expurgo de retencao) ==========================
    -- Gatilho barato: so o expurgo leva purged_at de NULL para timestamp.
    IF OLD.purged_at IS NULL AND NEW.purged_at IS NOT NULL THEN
        IF auth.uid() IS NULL
           -- (b) a linha PASSOU DO PRAZO. Nem service_role expurga registro de ontem.
           AND coalesce(OLD.paid_at, OLD.created_at) <= now() - public.lgpd_retention_interval()
           -- (c) forma do expurgo nesta tabela: `note` some, e so.
           AND NEW.note IS NULL
           -- (d) trava de litigio do termo correspondente
           AND NOT EXISTS (
                 SELECT 1 FROM public.service_terms st
                  WHERE st.shift_payment_id = OLD.id
                    AND st.retention_hold_reason IS NOT NULL
               )
           -- (e) NADA alem das colunas do expurgo mudou. E isto que autoriza o RETURN cedo:
           --     se todo o resto e identico, o corpo abaixo nao teria o que reprovar. Protege
           --     tambem colunas que ainda nao existem.
           AND (to_jsonb(NEW) - ARRAY['note','purged_at'])
               IS NOT DISTINCT FROM
               (to_jsonb(OLD) - ARRAY['note','purged_at'])
        THEN
            RETURN NEW;
        END IF;
        RAISE EXCEPTION 'shift_payments: expurgo fora da forma permitida (exige service_role, prazo de retencao vencido, ausencia de trava de litigio e nenhuma alteracao alem de note->NULL).';
    END IF;

    -- purged_at e ONE-WAY e so o expurgo o escreve. Qualquer outro caminho para.
    IF NEW.purged_at IS DISTINCT FROM OLD.purged_at THEN
        RAISE EXCEPTION 'shift_payments: purged_at so pode ser definido pelo expurgo de retencao e depois e imutavel.';
    END IF;
    -- === FIM DA EMENDA — abaixo, corpo vigente INALTERADO ======================

    -- === COLUNAS MATERIAIS SEMPRE IMUTÁVEIS (todos os papéis, inclusive service_role) ===
    -- scheduled_for entra aqui: a PROMESSA não se reescreve (reagendar = void + novo).
    IF NEW.id             IS DISTINCT FROM OLD.id
       OR NEW.job_id         IS DISTINCT FROM OLD.job_id
       OR NEW.company_id     IS DISTINCT FROM OLD.company_id
       OR NEW.worker_id      IS DISTINCT FROM OLD.worker_id
       OR NEW.application_id IS DISTINCT FROM OLD.application_id
       OR NEW.source         IS DISTINCT FROM OLD.source
       OR NEW.amount         IS DISTINCT FROM OLD.amount
       OR NEW.recorded_by    IS DISTINCT FROM OLD.recorded_by
       OR NEW.note           IS DISTINCT FROM OLD.note
       OR NEW.created_at     IS DISTINCT FROM OLD.created_at
       OR NEW.scheduled_for  IS DISTINCT FROM OLD.scheduled_for
    THEN
        RAISE EXCEPTION 'shift_payments: colunas materiais sao imutaveis (job_id, company_id, worker_id, application_id, source, amount, recorded_by, note, created_at, scheduled_for). Correcao = estorno logico (voided).';
    END IF;

    -- === paid_at: imutável, EXCETO a efetivacao (scheduled->recorded) que o define UMA vez ===
    IF NEW.paid_at IS DISTINCT FROM OLD.paid_at THEN
        IF NOT (OLD.status = 'scheduled' AND NEW.status = 'recorded'
                AND OLD.paid_at IS NULL AND NEW.paid_at IS NOT NULL) THEN
            RAISE EXCEPTION 'shift_payments: paid_at so pode ser definido na efetivacao (scheduled->recorded) e depois e imutavel.';
        END IF;
    END IF;

    -- === Registro estornado é IMUTÁVEL (não re-abre, não re-confirma) ===
    IF OLD.status = 'voided' THEN
        RAISE EXCEPTION 'shift_payments: registro estornado (voided) e imutavel.';
    END IF;

    -- === Transições de status permitidas ===
    IF NEW.status IS DISTINCT FROM OLD.status THEN
        IF NOT (
            (OLD.status = 'scheduled' AND NEW.status IN ('recorded', 'voided'))
            OR (OLD.status = 'recorded' AND NEW.status = 'voided')
        ) THEN
            RAISE EXCEPTION 'shift_payments: transicao de status invalida (% -> %).', OLD.status, NEW.status;
        END IF;
    END IF;

    -- === worker_confirmed_at é ONE-WAY (NULL → timestamp; nunca altera/limpa) ===
    IF OLD.worker_confirmed_at IS NOT NULL
       AND NEW.worker_confirmed_at IS DISTINCT FROM OLD.worker_confirmed_at
    THEN
        RAISE EXCEPTION 'shift_payments: worker_confirmed_at nao pode ser alterado apos a confirmacao.';
    END IF;

    -- === PARTIÇÃO POR PAPEL (só p/ chamadas autenticadas; service_role/trigger tem auth.uid() NULL) ===
    IF auth.uid() IS NOT NULL THEN
        v_is_company := EXISTS (
            SELECT 1 FROM public.companies WHERE id = NEW.company_id AND owner_id = auth.uid()
        );
        v_is_worker := (NEW.worker_id = auth.uid());

        IF v_is_worker AND NOT v_is_company THEN
            -- Freela: SÓ pode setar worker_confirmed_at (num registro já 'recorded'). Nada mais muda.
            IF NEW.status      IS DISTINCT FROM OLD.status
               OR NEW.voided_at   IS DISTINCT FROM OLD.voided_at
               OR NEW.void_reason IS DISTINCT FROM OLD.void_reason
               OR NEW.paid_at     IS DISTINCT FROM OLD.paid_at
            THEN
                RAISE EXCEPTION 'shift_payments: freela so pode confirmar recebimento (worker_confirmed_at).';
            END IF;
        ELSIF v_is_company THEN
            -- Empresa: efetiva (scheduled->recorded), cancela (->voided), estorna; NÃO toca a confirmacao do freela.
            IF NEW.worker_confirmed_at IS DISTINCT FROM OLD.worker_confirmed_at THEN
                RAISE EXCEPTION 'shift_payments: empresa nao pode alterar a confirmacao do freela.';
            END IF;
        ELSE
            RAISE EXCEPTION 'shift_payments: usuario nao autorizado a atualizar este registro.';
        END IF;
    END IF;

    RETURN NEW;
END;
$$;

COMMENT ON FUNCTION public.enforce_shift_payment_immutability() IS
    'BEFORE UPDATE em shift_payments. Colunas materiais imutaveis para TODOS os papeis; correcao = '
    'estorno logico (voided). UNICA excecao: o expurgo de retencao LGPD (purged_at NULL->ts por '
    'service_role, com prazo vencido e nada alem de note->NULL) — ver '
    'ADR-20260821-expurgo-de-conteudo-nao-de-linha. O prazo mora em lgpd_retention_interval(): '
    'a regra de retencao e verificada AQUI, nao so na RPC que a aplica.';
```

```sql
-- =============================================
-- 6. service_terms — CORPO-SUPERSET
--    = corpo de 20260817001100
--      + emenda da ANONIMIZACAO (ddl-aprovado §2.4: ip/ua -> NULL sob anonymized_at NULL->ts)
--      + emenda do EXPURGO (esta migration)
--    Aplicar esta migration ANTES da #1 apagaria a segunda emenda. A assercao de ordem (secao 1)
--    impede isso.
-- =============================================
CREATE OR REPLACE FUNCTION public.enforce_service_term_immutability()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    -- EMENDA 2026-08-21 (anonimizacao): a transicao de anonimizacao, calculada uma vez.
    v_anonymizing boolean := (OLD.anonymized_at IS NULL AND NEW.anonymized_at IS NOT NULL);
BEGIN
    -- === EMENDA 2026-08-21 (LGPD, expurgo de retencao) ==========================
    -- NAO reaproveita v_anonymizing: o expurgo atinge CONTA VIVA (o prazo e do DADO —
    -- ddl-aprovado §2.7.0), e em conta viva anonymized_at e e continua NULL.
    IF OLD.purged_at IS NULL AND NEW.purged_at IS NOT NULL THEN
        IF auth.uid() IS NULL
           AND OLD.retention_hold_reason IS NULL
           AND coalesce(OLD.accepted_at, OLD.created_at) <= now() - public.lgpd_retention_interval()
           -- forma do expurgo nesta tabela: telemetria some, term_text vira marcador.
           -- O VALOR do marcador e da RPC, nao do trigger (nao se duplica texto normativo).
           AND NEW.accepted_ip IS NULL
           AND NEW.accepted_user_agent IS NULL
           AND NEW.term_text IS NOT NULL
           AND (to_jsonb(NEW) - ARRAY['term_text','accepted_ip','accepted_user_agent','purged_at'])
               IS NOT DISTINCT FROM
               (to_jsonb(OLD) - ARRAY['term_text','accepted_ip','accepted_user_agent','purged_at'])
        THEN
            RETURN NEW;
        END IF;
        RAISE EXCEPTION 'service_terms: expurgo fora da forma permitida (exige service_role, prazo de retencao vencido, ausencia de retention_hold_reason e nenhuma alteracao alem de term_text/accepted_ip/accepted_user_agent).';
    END IF;

    IF NEW.purged_at IS DISTINCT FROM OLD.purged_at THEN
        RAISE EXCEPTION 'service_terms: purged_at so pode ser definido pelo expurgo de retencao e depois e imutavel.';
    END IF;

    -- Trava de litigio: so operacao (service_role) poe e tira. Client nem chega aqui
    -- (service_terms so tem policy de SELECT) — defesa em profundidade.
    IF auth.uid() IS NOT NULL
       AND NEW.retention_hold_reason IS DISTINCT FROM OLD.retention_hold_reason
    THEN
        RAISE EXCEPTION 'service_terms: retention_hold_reason e gerida por operacao (service_role).';
    END IF;
    -- === FIM DA EMENDA DO EXPURGO ==============================================

    -- === Vínculo e valor: imutáveis SEMPRE ===
    IF NEW.id               IS DISTINCT FROM OLD.id
       OR NEW.shift_payment_id IS DISTINCT FROM OLD.shift_payment_id
       OR NEW.job_id           IS DISTINCT FROM OLD.job_id
       OR NEW.worker_id        IS DISTINCT FROM OLD.worker_id
       OR NEW.company_id       IS DISTINCT FROM OLD.company_id
       OR NEW.amount           IS DISTINCT FROM OLD.amount
       OR NEW.created_at       IS DISTINCT FROM OLD.created_at
    THEN
        RAISE EXCEPTION 'service_terms: vinculo e valor sao imutaveis (shift_payment_id, job_id, worker_id, company_id, amount, created_at).';
    END IF;

    -- === accepted_at: ONE-WAY (NULL -> timestamp). Nunca altera, nunca limpa. ===
    IF OLD.accepted_at IS NOT NULL AND NEW.accepted_at IS DISTINCT FROM OLD.accepted_at THEN
        RAISE EXCEPTION 'service_terms: accepted_at e imutavel apos o aceite.';
    END IF;

    -- === IP/UA: só podem ser gravados NO aceite; nunca reescritos depois. ===
    -- EMENDA 2026-08-21 (LGPD): exceção única — a anonimização pode APAGÁ-LOS (levar a NULL).
    -- Levar a QUALQUER OUTRO VALOR continua proibido: não se falsifica trilha de aceite.
    IF OLD.accepted_at IS NOT NULL
       AND (NEW.accepted_ip         IS DISTINCT FROM OLD.accepted_ip
         OR NEW.accepted_user_agent IS DISTINCT FROM OLD.accepted_user_agent)
       AND NOT (v_anonymizing
                AND NEW.accepted_ip IS NULL
                AND NEW.accepted_user_agent IS NULL)
    THEN
        RAISE EXCEPTION 'service_terms: accepted_ip/accepted_user_agent sao imutaveis apos o aceite (unica excecao: anonimizacao LGPD, e apenas para NULL).';
    END IF;

    -- === anonymized_at: ONE-WAY (NULL -> timestamp). Nunca volta. ===
    IF OLD.anonymized_at IS NOT NULL AND NEW.anonymized_at IS DISTINCT FROM OLD.anonymized_at THEN
        RAISE EXCEPTION 'service_terms: anonymized_at e imutavel.';
    END IF;

    -- === term_text / term_version: livres ENQUANTO rascunho; congelados no aceite. ===
    -- Única exceção pós-aceite: a anonimização LGPD (NULL -> ts), que é o ato de
    -- reescrever o texto. Fora dela, um termo aceito não muda mais.
    IF OLD.accepted_at IS NOT NULL
       AND (NEW.term_text IS DISTINCT FROM OLD.term_text
         OR NEW.term_version IS DISTINCT FROM OLD.term_version)
       AND NOT v_anonymizing
    THEN
        RAISE EXCEPTION 'service_terms: term_text/term_version sao imutaveis apos o aceite (unica excecao: anonimizacao LGPD).';
    END IF;

    RETURN NEW;
END;
$$;

COMMENT ON FUNCTION public.enforce_service_term_immutability() IS
    'BEFORE UPDATE em service_terms. term_text e rascunho enquanto accepted_at IS NULL e CONGELA no '
    'aceite. Vale para TODOS os papeis (service_role e owner inclusive) — RLS nao cobriria. DUAS '
    'reescritas pos-aceite, e so elas: (1) anonimizacao LGPD (anonymized_at NULL->ts), que tambem '
    'apaga accepted_ip/accepted_user_agent; (2) EXPURGO de retencao (purged_at NULL->ts por '
    'service_role, com prazo de lgpd_retention_interval() vencido e sem retention_hold_reason). '
    'ADR-20260818 + ADR-20260821-anonimizacao-em-vez-de-exclusao + '
    'ADR-20260821-expurgo-de-conteudo-nao-de-linha.';
```

### 2.7.5 SQL — a RPC `purge_expired_personal_data`

```sql
-- =============================================
-- 7. RPC DO EXPURGO
--    SECURITY DEFINER + search_path='' + GRANT EXECUTE SOMENTE a service_role.
--    Idempotente (purged_at IS NULL filtra o que ja foi feito) e em LOTE: reexecutar drena o
--    backlog em dias, sem lock longo. Devolve `outcome` estruturado — nunca levanta excecao em
--    caminho esperado.
--    p_dry_run=true: MESMO predicado, ZERO escrita. E como se confere antes de deixar o cron
--    ativo, e como se responde "quanto tem para expurgar?" sem confiar em contagem no client.
-- =============================================
CREATE OR REPLACE FUNCTION public.purge_expired_personal_data(
    p_batch_limit integer DEFAULT 500,
    p_dry_run     boolean DEFAULT false
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_started  timestamptz := clock_timestamp();
    v_cutoff   timestamptz := now() - public.lgpd_retention_interval();
    v_limit    integer     := least(greatest(coalesce(p_batch_limit, 500), 1), 5000);
    v_terms    integer     := 0;
    v_payments integer     := 0;
    v_held     integer     := 0;
    c_purged_term constant text :=
        '[REGISTRO EXPURGADO — o prazo legal de retencao deste documento venceu e o conteudo '
        'pessoal (nomes, CPF/CNPJ e demais dados de identificacao) foi eliminado pela Worki, nos '
        'termos da LGPD (art. 15, I e art. 16). O registro da transacao — valor, data do aceite e '
        'as partes, em identificadores internos — foi mantido.]';
BEGIN
    -- Cinto e suspensorio: nao ha GRANT para authenticated, e o trigger exigiria auth.uid() NULL
    -- de qualquer forma. Falhar aqui e mais legivel do que falhar la dentro.
    IF auth.uid() IS NOT NULL THEN
        RETURN jsonb_build_object('outcome', 'forbidden');
    END IF;

    -- Quantas linhas VENCIDAS estao travadas por litigio (observabilidade, nao acao).
    SELECT count(*) INTO v_held
      FROM public.service_terms st
     WHERE st.purged_at IS NULL
       AND st.retention_hold_reason IS NOT NULL
       AND coalesce(st.accepted_at, st.created_at) <= v_cutoff;

    IF p_dry_run THEN
        SELECT count(*) INTO v_terms FROM (
            SELECT 1 FROM public.service_terms st
             WHERE st.purged_at IS NULL
               AND st.retention_hold_reason IS NULL
               AND coalesce(st.accepted_at, st.created_at) <= v_cutoff
             LIMIT v_limit
        ) q;

        SELECT count(*) INTO v_payments FROM (
            SELECT 1 FROM public.shift_payments sp
             WHERE sp.purged_at IS NULL
               AND coalesce(sp.paid_at, sp.created_at) <= v_cutoff
               AND NOT EXISTS (
                     SELECT 1 FROM public.service_terms st
                      WHERE st.shift_payment_id = sp.id
                        AND st.retention_hold_reason IS NOT NULL
                   )
             LIMIT v_limit
        ) q;

        -- Dry-run NAO grava em data_retention_purge_runs: diagnostico nao e operacao de
        -- tratamento (art. 37). O registro so existe para o que de fato aconteceu.
        RETURN jsonb_build_object(
            'outcome', 'dry_run',
            'cutoff', v_cutoff,
            'batch_limit', v_limit,
            'service_terms', v_terms,
            'shift_payments', v_payments,
            'service_terms_held', v_held
        );
    END IF;

    -- =========================================================
    -- A PARTIR DAQUI E DESTRUTIVO (de CONTEUDO; nenhuma linha e apagada).
    -- =========================================================

    -- ---- service_terms: term_text -> marcador; telemetria do aceite -> NULL ----
    -- SKIP LOCKED: se alguem estiver segurando a linha, ela fica para a proxima execucao.
    -- O expurgo nao tem pressa e nao pode virar fonte de lock em producao.
    WITH alvo AS (
        SELECT st.id
          FROM public.service_terms st
         WHERE st.purged_at IS NULL
           AND st.retention_hold_reason IS NULL
           AND coalesce(st.accepted_at, st.created_at) <= v_cutoff
         ORDER BY coalesce(st.accepted_at, st.created_at)
         LIMIT v_limit
           FOR UPDATE SKIP LOCKED
    )
    UPDATE public.service_terms st
       SET term_text           = c_purged_term,
           accepted_ip         = NULL,
           accepted_user_agent = NULL,
           purged_at           = now()
      FROM alvo
     WHERE st.id = alvo.id;
    GET DIAGNOSTICS v_terms = ROW_COUNT;

    -- ---- shift_payments: note -> NULL. Valor, datas e partes RETIDOS (BI sobrevive) ----
    -- Linhas cujo `note` ja e NULL tambem sao marcadas: purged_at e o marcador de conformidade,
    -- nao de "teve texto". Sem isso o backlog nunca drena e a contagem mente.
    WITH alvo AS (
        SELECT sp.id
          FROM public.shift_payments sp
         WHERE sp.purged_at IS NULL
           AND coalesce(sp.paid_at, sp.created_at) <= v_cutoff
           AND NOT EXISTS (
                 SELECT 1 FROM public.service_terms st
                  WHERE st.shift_payment_id = sp.id
                    AND st.retention_hold_reason IS NOT NULL
               )
         ORDER BY coalesce(sp.paid_at, sp.created_at)
         LIMIT v_limit
           FOR UPDATE SKIP LOCKED
    )
    UPDATE public.shift_payments sp
       SET note      = NULL,
           purged_at = now()
      FROM alvo
     WHERE sp.id = alvo.id;
    GET DIAGNOSTICS v_payments = ROW_COUNT;

    INSERT INTO public.data_retention_purge_runs (
        cutoff, retention_interval, batch_limit,
        service_terms_purged, shift_payments_purged, service_terms_held, duration_ms
    ) VALUES (
        v_cutoff, public.lgpd_retention_interval(), v_limit,
        v_terms, v_payments, v_held,
        (extract(epoch FROM clock_timestamp() - v_started) * 1000)::integer
    );

    RETURN jsonb_build_object(
        'outcome', 'purged',
        'cutoff', v_cutoff,
        'batch_limit', v_limit,
        'service_terms', v_terms,
        'shift_payments', v_payments,
        'service_terms_held', v_held,
        -- true = ainda ha backlog; a proxima execucao continua de onde esta.
        'has_more', (v_terms >= v_limit OR v_payments >= v_limit)
    );
END;
$$;

COMMENT ON FUNCTION public.purge_expired_personal_data(integer, boolean) IS
    'Expurgo de retencao LGPD. UPDATE, nunca DELETE: apaga o CONTEUDO PESSOAL (service_terms.'
    'term_text -> marcador, accepted_ip/accepted_user_agent -> NULL; shift_payments.note -> NULL) '
    'e PRESERVA a linha pseudonima (valor, datas, partes) — o BI historico sobrevive. Prazo do '
    'DADO (paid_at/accepted_at), nao da conta. Pula linhas com service_terms.retention_hold_reason. '
    'Idempotente e em lote (SKIP LOCKED). p_dry_run=true nao escreve nada. Article 8/9 intactos: '
    'nenhuma tabela de saldo/razao e lida ou escrita. ADR-20260821-expurgo-de-conteudo-nao-de-linha.';

REVOKE ALL ON FUNCTION public.purge_expired_personal_data(integer, boolean)
    FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.purge_expired_personal_data(integer, boolean) TO service_role;
```

### 2.7.6 SQL — agendamento (`pg_cron`)

```sql
-- =============================================
-- 8. AGENDAMENTO — molde de 20260817000800 (F4) e 20260817001300 (F8)
--    pg_cron interpreta o schedule em UTC. '30 3 * * *' = 03:30 UTC = 00:30 BRT — janela de menor
--    trafego. Brasil sem DST desde 2019: offset fixo, nada a manter.
--    cron.schedule(jobname, ...) faz upsert por nome (pg_cron >= 1.4) => reaplicar nao duplica.
--
--    DIFERENCA EM RELACAO A 20260817000800: naquela data pg_cron estava DISPONIVEL mas NAO
--    INSTALADO. Em 21/08/2026 a extensao esta INSTALADA e com job ativo em producao — o ramo
--    ELSE abaixo existe para CI / `supabase db reset`, nao como caminho esperado de producao.
--    Se ele disparar em producao, e incidente: a promessa de 5 anos deixa de ser cumprida por
--    qualquer codigo, em silencio.
-- =============================================
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
        PERFORM cron.schedule(
            'lgpd-retention-purge',
            '30 3 * * *',
            $cron$SELECT public.purge_expired_personal_data(500, false);$cron$
        );
    ELSE
        RAISE WARNING 'pg_cron ausente: o EXPURGO de retencao (LGPD) NAO sera executado. '
                      'O prazo de 5 anos prometido na Politica de Privacidade fica sem nenhum '
                      'codigo que o cumpra. Habilite a extensao e reaplique esta migration.';
    END IF;
END $$;
```

> ⚠️ **O canal de aplicação engole o `WARNING`.** `supabase/migrations/APLICACAO-2026-08-16.md`
> registra que as migrations deste projeto são aplicadas via **MCP do Supabase**, que não devolve
> `NOTICE`/`WARNING` do servidor. Silêncio **não** é sucesso: **V6** da seção abaixo é obrigatória,
> não opcional — é a única confirmação confiável de que o agendamento pegou.

### 2.7.7 SQL — verificação obrigatória e DOWN

```sql
-- ============================================================================
-- COMO VERIFICAR (obrigatorio apos aplicar)
-- ----------------------------------------------------------------------------
-- V1. Ordem respeitada: a assercao da secao 1 nao levantou excecao (a migration aplicou).
--
-- V2. O prazo esta num lugar so:
--     SELECT public.lgpd_retention_interval();            -- => 5 years
--     -- e nenhum literal '5 years' fora dela:
--     SELECT proname FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
--      WHERE n.nspname='public' AND pg_get_functiondef(p.oid) ILIKE '%interval ''5 years''%';
--     -- ESPERADO: exatamente 1 linha (lgpd_retention_interval).
--
-- V3. DRY-RUN ANTES DE QUALQUER COISA (o cron ja esta agendado; rode isto no mesmo dia):
--     SELECT public.purge_expired_personal_data(500, true);
--     -- ESPERADO HOJE (piloto, base nova): service_terms=0, shift_payments=0.
--     -- Numero > 0 => PARE e explique antes de deixar o cron rodar.
--
-- V4. O prazo e verificado pelo TRIGGER, nao so pela RPC — tentar expurgar registro NOVO falha
--     (rodar como service_role, DENTRO de transacao com ROLLBACK):
--     BEGIN;
--       UPDATE public.shift_payments SET note=NULL, purged_at=now()
--        WHERE id='<pagamento-recente>';
--     -- ESPERADO: EXCEPTION 'expurgo fora da forma permitida...'
--     ROLLBACK;
--
-- V5. A forma e auto-limitada — tentar carona (mudar `amount` junto) falha:
--     BEGIN;
--       UPDATE public.shift_payments SET note=NULL, purged_at=now(), amount=1
--        WHERE id='<pagamento-vencido>';
--     -- ESPERADO: EXCEPTION 'expurgo fora da forma permitida...'
--     ROLLBACK;
--
-- V6. Job agendado (PASSO DE RUNBOOK OBRIGATORIO — o MCP engole o RAISE WARNING do ELSE):
--     SELECT jobname, schedule, active FROM cron.job WHERE jobname='lgpd-retention-purge';
--     -- ESPERADO: 1 linha, schedule='30 3 * * *', active=t. Se 0 linhas: pg_cron nao estava
--     -- habilitado no momento da aplicacao; habilitar e reaplicar via CLI.
--
-- V7. Trava de litigio funciona (em linha VENCIDA de teste):
--     UPDATE public.service_terms SET retention_hold_reason='teste' WHERE id='<id>';
--     SELECT public.purge_expired_personal_data(500, true);
--     -- ESPERADO: a linha NAO conta em service_terms e conta em service_terms_held.
--
-- V8. Article 8/9: nenhuma tabela de saldo aparece no codigo desta migration:
--     SELECT pg_get_functiondef(p.oid) ILIKE ANY (ARRAY['%wallet%','%escrow%'])
--       FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
--      WHERE n.nspname='public' AND p.proname='purge_expired_personal_data';
--     -- ESPERADO: f
--
-- V9. Prova de conformidade gravada apos a primeira execucao efetiva:
--     SELECT * FROM public.data_retention_purge_runs ORDER BY ran_at DESC LIMIT 5;
--
-- ============================================================================
-- DOWN (rollback — copiar/colar). NAO restaura conteudo ja expurgado: e irreversivel por
-- natureza; por isso o backup do cabecalho e obrigatorio.
-- ----------------------------------------------------------------------------
--   SELECT cron.unschedule('lgpd-retention-purge');
--   DROP FUNCTION IF EXISTS public.purge_expired_personal_data(integer, boolean);
--   -- restaurar o corpo de enforce_shift_payment_immutability de 20260712000000 §4
--   -- restaurar o corpo de enforce_service_term_immutability do ddl-aprovado §2.4 (com a
--   --   emenda da anonimizacao — NAO o de 20260817001100 puro, ou a #1 quebra)
--   DROP TABLE IF EXISTS public.data_retention_purge_runs;
--   ALTER TABLE public.service_terms  DROP COLUMN IF EXISTS purged_at;
--   ALTER TABLE public.service_terms  DROP COLUMN IF EXISTS retention_hold_reason;
--   ALTER TABLE public.shift_payments DROP COLUMN IF EXISTS purged_at;
--   DROP FUNCTION IF EXISTS public.lgpd_retention_interval();  -- por ultimo: os triggers a usam
-- ============================================================================
```

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

### 3.3 SQL

```sql
-- Migration: `reviews` deixa de ser varrível por qualquer conta autenticada (débito pré-piloto #9)
-- File: supabase/migrations/20260821000100_reviews_select_by_relationship.sql
-- ADR: .harness/memory-bank/decisions/ADR-20260821-reviews-por-vinculo.md
-- DDL aprovado (FONTE NORMATIVA): .harness/spec/lgpd-producao/ddl-aprovado.md
-- Molde: 20260816120000 (workers por vínculo) + 20260816130000 (get_profile_reviews).
--
-- PROBLEMA (produção, pré-existente):
--   `reviews` é USING (true) desde 20260309000000:109. Qualquer conta autenticada, sem vínculo
--   nenhum, lê todas as avaliações de qualquer freela e resolve o nome da empresa avaliadora por
--   `reviewer_id` contra `companies` (também USING (true)). pages/company/WorkerPublicProfile.tsx
--   já renderiza exatamente isso.
--   E a RPC get_profile_reviews (SECURITY DEFINER) exige apenas auth.uid() IS NOT NULL — fechar
--   só a tabela deixaria a MESMA leitura aberta pela porta da RPC. As duas metades andam juntas.
--
-- NÃO TOCA SALDO/ESCROW (Article 8). Só leitura.
-- NÃO altera a policy de INSERT de `reviews` nem a de `companies` — ver débitos novos #10 e #11.
-- Risk: MEDIUM (muda leitura de tabela consumida por 4 telas). Reversível em 1 comando.
-- Backup required before production deploy: NO.

-- =============================================
-- 1. CAST SEGURO — reviews.reviewer_id / reviewed_id são TEXT (schema legado, 20260314000008)
--    `::uuid` puro em policy é bomba: uma linha com texto não-uuid derruba o SELECT inteiro com
--    22P02, e o conteúdo de reviewed_id é escolhido pelo atacante no INSERT.
-- =============================================
CREATE OR REPLACE FUNCTION public.try_uuid(p_text text)
RETURNS uuid
LANGUAGE sql
IMMUTABLE
SET search_path = ''
AS $$
    SELECT CASE
        WHEN p_text ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
        THEN p_text::uuid
    END;
$$;

COMMENT ON FUNCTION public.try_uuid(text) IS
    'Cast text->uuid que devolve NULL em vez de 22P02. Existe porque reviews.reviewer_id/reviewed_id '
    'sao TEXT (schema legado) e sao usados dentro de policy: um valor invalido derrubaria o SELECT '
    'inteiro da tabela.';

REVOKE EXECUTE ON FUNCTION public.try_uuid(text) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.try_uuid(text) TO authenticated, service_role;

-- =============================================
-- 2. ÍNDICE DE SUPORTE — a policy filtra por autor.
--    (reviewed_id, direction) já existe: idx_reviews_reviewed_direction (20260816130000).
--    Sem CONCURRENTLY: migration do Supabase roda em transação.
-- =============================================
CREATE INDEX IF NOT EXISTS idx_reviews_reviewer ON public.reviews (reviewer_id);

-- =============================================
-- 3. FUNÇÃO DE VISIBILIDADE
--    Retorna APENAS boolean; nunca devolve dado.
--    GRAFO DE POLICY (checagem de 42P17, que só aparece em RUNTIME):
--      reviews -> can_view_reviews_of (DEFINER: lê companies/workers como owner, sem RLS)
--                  -> can_view_worker_profile (DEFINER, 20260816120000)
--                       -> team_connections / applications / jobs / companies
--      Nenhuma dessas tabelas tem policy que referencie `reviews`. Grafo ACÍCLICO.
--      ⚠️ Se um dia alguma policy de team_connections/applications/jobs/companies passar a ler
--         `reviews`, ESTE é o ponto que fecha o ciclo. Registrar em ADR ao fazer.
-- =============================================
CREATE OR REPLACE FUNCTION public.can_view_reviews_of(p_reviewed_id text)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_uid uuid := (SELECT auth.uid());
    v_id  uuid := public.try_uuid(p_reviewed_id);
BEGIN
    IF v_uid IS NULL OR v_id IS NULL THEN
        RETURN false;
    END IF;

    -- (0) o dono do perfil avaliado (caso canônico: companies.id = workers.id = auth.uid()).
    IF v_id = v_uid THEN
        RETURN true;
    END IF;

    -- (1) perfil avaliado é uma EMPRESA que eu opero. Ancoragem DUPLA — mesma regra de
    --     is_company_owner / is_job_owner (ADR-20260817-seam-autorizacao-empresa).
    IF EXISTS (
        SELECT 1 FROM public.companies c
        WHERE c.id = v_id AND (c.id = v_uid OR c.owner_id = v_uid)
    ) THEN
        RETURN true;
    END IF;

    -- (2) perfil avaliado é um FREELA que eu já posso ver (elenco pending/accepted OU vínculo
    --     operacional via applications). Reusa a régua de 20260816120000 — uma decisão só, num
    --     lugar só. Quando a autorização de empresa mudar (F3 multi-unidade), muda lá e vale aqui.
    IF EXISTS (SELECT 1 FROM public.workers w WHERE w.id = v_id)
       AND public.can_view_worker_profile(v_id) THEN
        RETURN true;
    END IF;

    RETURN false;
END;
$$;

COMMENT ON FUNCTION public.can_view_reviews_of(text) IS
    'Decide se auth.uid() pode ler as avaliacoes RECEBIDAS por um perfil. Retorna so boolean. '
    'Empresa que eu opero (ancoragem dupla) OU freela que eu ja posso ver (can_view_worker_profile, '
    '20260816120000). NAO concede leitura de avaliacoes de EMPRESA a terceiros — esse caminho e a '
    'RPC get_profile_reviews, que serve a prova social do perfil publico /empresa/:id.';

REVOKE EXECUTE ON FUNCTION public.can_view_reviews_of(text) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.can_view_reviews_of(text) TO authenticated, service_role;

-- =============================================
-- 4. POLICY DE SELECT
--    Policies permissivas são OR'd: enquanto a `USING (true)` existir, nada muda. DROP primeiro.
-- =============================================
DROP POLICY IF EXISTS "Authenticated users can view reviews" ON public.reviews;
DROP POLICY IF EXISTS "Anyone authenticated can view reviews" ON public.reviews;
DROP POLICY IF EXISTS "reviews_select_related" ON public.reviews;

CREATE POLICY "reviews_select_related" ON public.reviews
    FOR SELECT TO authenticated
    USING (
        -- (1) sou o AUTOR (MyJobs: "quais turnos eu já avaliei")
        reviews.reviewer_id = ((SELECT auth.uid()))::text
        -- (2) sou o AVALIADO
        OR reviews.reviewed_id = ((SELECT auth.uid()))::text
        -- (3) tenho vínculo com o perfil avaliado
        OR public.can_view_reviews_of(reviews.reviewed_id)
    );

-- GRANTS: reafirmação defensiva. NUNCA `REVOKE ALL ... FROM PUBLIC` em TABELA
-- (lição de 20260318000000: derrubou o service_role). Revogar de anon é o padrão do projeto.
REVOKE ALL ON public.reviews FROM anon;
GRANT SELECT, INSERT ON public.reviews TO authenticated;
GRANT ALL ON public.reviews TO service_role;

-- =============================================
-- 5. FECHAR A OUTRA PORTA — gate de vínculo dentro de get_profile_reviews
--    Reproduz 20260816130000 na íntegra; delta ÚNICO marcado como EMENDA 2026-08-21.
--    Sem isto, a policy acima é teatro: a RPC é DEFINER e devolve o mesmo conteúdo.
-- =============================================
CREATE OR REPLACE FUNCTION public.get_profile_reviews(
    p_reviewed_id text,
    p_direction   text
)
RETURNS TABLE (
    review_id     text,
    rating        numeric,
    comment       text,
    created_at    text,
    reviewer_id   text,
    reviewer_name text
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
    SELECT
        r.id::text,
        r.rating::numeric,
        r.comment::text,
        -- ISO 8601 explícito em UTC (parser estrito do Safari rejeita o formato nativo).
        to_char(r.created_at::timestamptz AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
        r.reviewer_id::text,
        (CASE
            -- Avaliador é EMPRESA: nome comercial, sem mascaramento.
            WHEN p_direction = 'worker' THEN (
                SELECT c.name::text
                FROM public.companies c
                WHERE c.id::text = r.reviewer_id::text
            )
            -- Avaliador é FREELA (pessoa física): completo só para o dono do perfil avaliado.
            ELSE (
                SELECT CASE
                    WHEN (
                        p_reviewed_id = auth.uid()::text
                        OR EXISTS (
                            SELECT 1 FROM public.companies co
                            WHERE co.id::text = p_reviewed_id
                              AND co.owner_id = auth.uid()
                        )
                    ) THEN nullif(btrim(coalesce(w.full_name, '')), '')::text
                    ELSE public.mask_display_name(w.full_name)
                END
                FROM public.workers w
                WHERE w.id::text = r.reviewer_id::text
            )
        END)::text
    FROM public.reviews r
    WHERE auth.uid() IS NOT NULL
      AND p_reviewed_id IS NOT NULL
      AND p_direction IN ('worker', 'company')
      -- EMENDA 2026-08-21 (débito #9): a RPC é DEFINER e era a MESMA varredura que a policy
      -- USING(true) permitia. Gate por direção:
      --   'company' = perfil de EMPRESA avaliada -> ABERTO a qualquer autenticado. É a prova
      --               social do perfil público /empresa/:id (o freela decide antes de aceitar
      --               convite). Os avaliadores freelas já saem mascarados ("Carlos S.").
      --   'worker'  = perfil de FREELA avaliado -> exige vínculo, mesma régua de
      --               can_view_worker_profile (20260816120000). Sem vínculo: ZERO linhas,
      --               sem erro (degrada como lista vazia, não como falha).
      AND (
            p_direction = 'company'
         OR public.can_view_worker_profile(public.try_uuid(p_reviewed_id))
      )
      AND r.reviewed_id::text = p_reviewed_id
      AND r.direction::text = p_direction
    ORDER BY r.created_at DESC;
$$;

COMMENT ON FUNCTION public.get_profile_reviews(text, text) IS
    'Avaliacoes recebidas por um perfil, ja com o nome de exibicao do avaliador. Deriva os '
    'avaliadores da propria tabela reviews (nao aceita lista de ids do caller) — nao e oraculo de '
    'enumeracao de nomes. Freela avaliador aparece mascarado ("Carlos S.") para terceiros e '
    'completo so para o dono do perfil avaliado. GATE POR DIRECAO (2026-08-21): p_direction='
    '''company'' (perfil de empresa) e ABERTO a qualquer autenticado — prova social deliberada do '
    'perfil publico /empresa/:id; p_direction=''worker'' (perfil de freela) EXIGE '
    'can_view_worker_profile. Existe porque a policy workers_select_self_or_related impede o freela '
    'de ler a linha de outro freela.';

REVOKE EXECUTE ON FUNCTION public.get_profile_reviews(text, text) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.get_profile_reviews(text, text) TO authenticated, service_role;

-- ============================================================================
-- COMO VERIFICAR (obrigatório após aplicar)
-- ----------------------------------------------------------------------------
-- V1. Conta nova, sem vínculo nenhum (criar na hora):
--       GET /rest/v1/reviews?select=*                          ⇒ [] (antes: base inteira)
--       rpc get_profile_reviews(<freela alheio>, 'worker')     ⇒ []
--       rpc get_profile_reviews(<empresa qualquer>, 'company') ⇒ lista com nomes MASCARADOS
-- V2. Freela dono: rpc(<meu id>, 'worker') ⇒ minhas avaliações, nome da empresa inteiro.
-- V3. Empresa COM vínculo: /company/workers/:id continua mostrando avaliações e nome da empresa.
-- V4. Empresa SEM vínculo com aquele freela: mesma URL ⇒ lista vazia (não erro).
-- V5. /empresa/:id aberto por freela sem vínculo ⇒ avaliações continuam aparecendo (R2 preservada).
-- V6. MyJobs: o botão "Avaliar" continua sumindo nos turnos já avaliados.
-- V7. F12 (badges), quando existir: RPC própria, resultado idêntico antes e depois.
--
-- DOWN (rollback — copiar/colar):
--   DROP POLICY IF EXISTS "reviews_select_related" ON public.reviews;
--   CREATE POLICY "Authenticated users can view reviews" ON public.reviews
--       FOR SELECT TO authenticated USING (true);
--   -- e restaurar o corpo de get_profile_reviews de 20260816130000 (sem o bloco EMENDA).
--   DROP FUNCTION IF EXISTS public.can_view_reviews_of(text);
--   DROP FUNCTION IF EXISTS public.try_uuid(text);
--   DROP INDEX IF EXISTS public.idx_reviews_reviewer;
-- ============================================================================
```

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
tabela não existir), não com reescrita da função a partir de outra leva. Implementado assim:

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

| ~~Hh4~~ | ~~**Conferir o `CHECK` de `jobs.scope` e `applications.invitation_response`**~~ — **FECHADO em 22/08/2026.** | Conferido em `pg_constraint`, e o resultado foi mais amplo que a pergunta: `applications.invitation_response` **tem** `CHECK` fechado (`NULL|'accepted'|'declined'`) e foi **promovida** para `v_enum_text` — a asserção **(b3)** passa a vigiá-la. `jobs.scope` **não tem**, e mais **cinco** da mesma família também não (`jobs.status`, `type`, `category`, `budget_type`, `applications.status`). Reclassificadas com a justificativa correta — "constantes do cliente, sem enforcement no banco" — em §5.3. |
| Hh5 | **Propor `CHECK` de conjunto fechado para as seis colunas sem enforcement**, em leva própria. | Fora do escopo da LGPD: eliminaria a classe de evidência fraca inteira, mas adicionar `CHECK` em `jobs.status` **vivo** exige varrer os valores existentes antes — migration com risco próprio, e uma linha divergente aborta o `ALTER`. Subconjunto barato para começar: `scope`, `type` e `budget_type`, que **ninguém digita** (constantes literais no código). Quando os `CHECK`s existirem, as colunas promovem para `v_enum_text` e a `(b3)` passa a verificá-las sozinha. |
| ~~Hh6~~ | ~~**Varredura completa "toda coluna `text` de tabela retida × tem `CHECK` fechado?"**~~ — **FECHADO em 22/08/2026.** | 27 linhas para **25 colunas textuais distintas** nas cinco tabelas; **nenhuma ficou sem classificação possível**. Resultado: **8 promovidas** à classe forte (`applications.invitation_response`, `shift_calls.reason/status/origin`, `shift_call_targets.origin/response`, `shift_attendance_confirmations.source/response`) — inclusive as três de `shift_calls` que estavam rebaixadas por disciplina, e cujos `CHECK`s no catálogo vieram **idênticos** ao que o repositório declarava. **E um achado que quase inverteu uma decisão desta mesma leva:** `jobs.certification_requirement` **tem `check_def` não-nulo** — `CHECK (… char_length(certification_requirement) <= 200)`. Uma regra de promoção do tipo *"tem `CHECK` ⇒ classe forte"* a teria promovido e **tirado da redação**, em silêncio, justo a coluna de texto livre que esta rodada mandou redigir. **`CHECK` de comprimento não é evidência de conjunto fechado: limita o tamanho da prosa, não o fato de ser prosa.** A asserção **(b3)** foi apertada para exigir a forma `<coluna> = ANY (ARRAY[…])` **adjacente ao nome da coluna** — o que também impede carona em `CHECK` composto (`foo = 'x' AND bar = ANY(…)`) e resolve, via `EXISTS`, as colunas que participam de **mais de um** `CHECK` (as de coerência simplesmente não casam). Ensaio de regressão em **V22**. |

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
| **Toda a classe de evidência fraca vive em `jobs`/`applications`** — `jobs.scope`, `status`, `type`, `category`, `budget_type`, `work_start_time`, `work_end_time` e `applications.status` não têm `CHECK` nenhum (varredura completa de 22/08; `title` e `location` também não, mas essas são retidas por **decisão escrita**). *(revisão 2026-08-22)* | Chamá-las de "enum" era **impreciso**, e a imprecisão importa: o que as mantém com cara de enum é **código de frontend** — `CompanyCreateJob.tsx` grava `'on-site'`, `'freelance'` e `'daily'` como **constantes literais** e `category` vem de seleção validada. O **Article 4 da constitution** diz exatamente que filtro no client é só UX e que a defesa dura é o banco: a classificação dessas seis repousa na camada que a constitution declara **não ser garantia**. Um `PATCH` direto via PostgREST (a empresa dona do turno passa na policy de UPDATE) escreve texto livre nelas **hoje**, e esse texto sobreviveria à exclusão da conta. A frase honesta não é "são enums", é **"são constantes do cliente, sem enforcement no banco"** — que envelhece de outro jeito. **Não são redigidas:** `status` é máquina de estados (todo consumidor faz `.neq('status','deleted')`) e as outras sustentam filtro e BI; redigir quebraria o produto para fechar uma via de abuso auto-infligida. **Fecho correto:** `CHECK`s numa leva própria — §5.5 Hh5. **O contraste que fecha o argumento:** as **oito** colunas das tabelas-evento e de `shift_calls`/`applications.invitation_response` **têm** `CHECK` de conjunto fechado e por isso subiram para a classe forte; a fronteira entre as duas classes não é o nome nem o tamanho do valor, é **quem garante** — o banco ou o `CompanyCreateJob.tsx`. |
| Turno **futuro** de uma empresa excluída fica com `briefing`/`description` redigidos e a empresa como lápide. *(emenda 2026-08-22)* | Consequência esperada da lápide, não da redação: a empresa deixou de existir e o turno está morto de qualquer modo (ninguém opera lápide). O freela já contratado é avisado pelo caminho normal de cancelamento se a empresa cancelar antes; se não cancelar, o turno apenas não acontece. Fechar isso exigiria soft-delete em massa dos turnos futuros na exclusão — decisão de produto, não de LGPD, e fora do escopo desta leva. |

### 5.5 Vai ao humano (revisão 2026-08-22 — não bloqueia a aplicação, bloqueia o "está fechado")

| # | Item | Por que não foi resolvido aqui |
|---|---|---|
| Hh1 | **Ressincronizar os blocos SQL de §2.2 e §2.5** com o arquivo da migration. | Drift **pré-existente**: os blocos são o baseline de 21/08 e não têm as asserções (d)/(e), a GUARDA 4, o SOFT-REMOVE de membership, nem a correção D5 de `regclass::text` — que aqui ainda aparece **quebrada**. Copiar ~400 linhas de SQL para dentro do contrato cria duas fontes que voltam a divergir na próxima emenda. A escolha real é *"contrato normativo para classificação/decisão + arquivo normativo para corpo"* (o que está declarado agora) **ou** *"contrato normativo para tudo, e o arquivo é gerado dele"* — decisão de processo, não deste gate. |
| ~~Hh2~~ | ~~**Estender a asserção (b) a `jobs` e `applications`**~~ — **FECHADO em 22/08/2026.** | O catálogo de produção foi consultado e cada coluna textual de `jobs`/`applications`/`shift_calls` conferida contra o uso real no frontend. Resultado: **asserção (b2)** (classificação textual fechada, HALT em coluna nova) + duas colunas de texto livre que a lista original não cobria — `jobs.certification_requirement` e `applications.message` — agora redigidas. Dois falsos positivos descartados com evidência, não por palpite: `jobs.scope` (2 valores distintos, 7 chars) e `applications.invitation_response` (1 valor distinto, 8 chars) são **enums em coluna `text`**. **Fechado por completo na revisão do mesmo dia:** as duas tabelas-evento entraram no fecho (as quatro colunas textuais delas têm `CHECK` de conjunto fechado, verificado), e o `metadata jsonb` que constava como risco **não existe** — era descrição errada do `architecture.md`, que diverge da tabela real em seis pontos. Nenhuma coluna `jsonb`/`json` existe nas duas. |
| Hh3 | **`shift_payments.note` e `service_terms` só ficam honestos com a migration #3.** | Já registrado no cabeçalho da migration (bloqueio técnico (1)). Repetido aqui porque a redação de texto livre de §2.1 aumenta o contraste: `jobs.briefing` sai na hora, `shift_payments.note` só sai em 5 anos — e essa diferença **tem** de estar na Política de Privacidade (§6.1 / J4). |

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
