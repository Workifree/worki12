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
> **Não libera aplicação:** H1/H2 seguem pendentes do owner.
>
> **Duas migrations independentes.** Nenhuma depende da outra; aplicar sempre a #1 antes da #2
> (a #1 contém asserções de schema que valem como diagnóstico geral do banco).

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
| `enforce_shift_payment_immutability` (20260630/20260712) | A partição por papel está dentro de `IF auth.uid() IS NOT NULL` — sem sessão não há partição. Mas as colunas materiais (`amount`, `note`, `source`, `paid_at`, …) são imutáveis **antes** disso, para todos os papéis. | **Não precisa mudar.** Nada em `shift_payments` é anonimizado (§2.1). O trigger fica intocado. |
| `enforce_service_term_immutability` (20260817001100) | Vale para **todos** os papéis, inclusive `service_role` e owner. Permite reescrever `term_text` **apenas** na transição `anonymized_at NULL→ts`. | **Precisa de uma emenda cirúrgica.** `accepted_ip` e `accepted_user_agent` são imutáveis após o aceite **sem exceção** — e IP é dado pessoal (art. 5º, I). Hoje a anonimização seria **barrada** ao tentar apagá-los. Emenda em §2.4: permitir `ip/ua → NULL` (só para NULL, nunca para outro valor) dentro da mesma transição. |
| `enforce_certification_update_scope` (F8, 20260817001300) | Ramo **(c)** (`v_uid IS NULL`): `RAISE EXCEPTION` se `v_content_changed`. | **Barra a anonimização por UPDATE.** O ramo (c) foi escrito para cron e FK SET NULL, não para apagar conteúdo. Conclusão: `worker_certifications` e `worker_trainings` **não** se anonimizam — **apagam-se** (`DELETE`), que nenhum trigger `BEFORE UPDATE` intercepta e que é o tratamento correto (certificação não tem valor fiscal). Ver §2.1. |

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
| `payment_methods` (empresa) | **DELETE** | Token de cartão. **Também revogar no Asaas** — §4.1(3b). |
| `applications`, `shift_calls`, `shift_call_targets`, `shift_attendance_confirmations`, `jobs` | **RETIDOS** | Chaves pseudônimas + timestamps. Nenhum conteúdo pessoal. Sustentam o BI e a integridade de `shift_payments`. Art. 7º, IX (legítimo interesse) sobre dado pseudônimo. |
| `reviews` | **RETIDAS** | O texto pertence ao autor e descreve a contraparte (reputação de terceiro). A autoria degrada sozinha: `get_profile_reviews` resolve o nome **ao vivo** em `workers`, e a lápide `'[Conta Deletada]'` faz `mask_display_name` devolver `NULL`. É por isso que `reviewer_name` nunca foi desnormalizado (20260816130000). |
| `wallets`, `wallet_transactions`, `escrow_transactions` | **INTOCADAS — Article 8/9** | Nenhum `UPDATE` de saldo, nenhum `DELETE` de linha de razão. A rotina **recusa** rodar se houver saldo > 0 ou escrow ativo. |
| `Message` / `Conversation` (legado) | fora da RPC | Continua na Edge Function (§4.1). Schema legado não auditado aqui — não entra numa RPC transacional sem verificação. |

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
   por userId) e os `payment_methods.asaas_credit_card_token` da empresa — o passo 3 apaga ambos.
3. supabaseAdmin.rpc('anonymize_account', { p_user_id: userId })
   ├─ 'wallet_has_balance'        → 400 "Saque seu saldo antes de excluir a conta."
   ├─ 'escrow_active'             → 400 "Você tem pagamentos em aberto. Conclua ou cancele antes."
   ├─ 'scheduled_payment_pending' → 400 "Há pagamento agendado pendente. Efetive ou estorne antes."
   ├─ 'not_found' / 'invalid_input' → 400
   └─ 'anonymized'                → segue
4. Efeitos colaterais FORA do Postgres (idempotentes):
   4a. Storage: remover os objetos de avatar/cover lidos em (2).
   4b. Asaas: revogar os cartões tokenizados lidos em (2).
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

---

## 5. Itens que vão ao humano (destaque)

### H1 — "Excluir a conta" passa a significar "perder o acesso + anonimizar", não "apagar tudo"

Não existe caminho em que o direito do art. 18, VI seja cumprido **e** a trilha fiscal sobreviva.
Recomendação técnica: **anonimização com retenção** (este documento). O que o humano precisa aprovar,
porque é jurídico e não técnico:

1. **Prazo de retenção** de `shift_payments` e `service_terms`. O desenho assume "indefinido até
   decisão em contrário"; o padrão de mercado é **5 anos** (prescrição — CC art. 206, §5º, I). Se
   houver prazo, ele vira um cron de expurgo, que **não existe hoje**.
2. **Texto da Política de Privacidade e da tela de exclusão.** Hoje a UI implica apagamento total.
   Precisa dizer, com todas as letras, que **o termo de prestação aceito é retido com nome e CPF**
   como prova da transação. Sem isso a promessa continua falsa — só que na direção oposta. Isto é o
   débito #1 e **bloqueia** a ida a público desta rotina.

### H2 — Remover as FKs `CASCADE` para `auth.users`

É o coração da solução (§1). Consequência aceita: passam a existir linhas de `workers`/`companies`/
`wallets` sem `auth.users` correspondente — **por construção**. Alternativa rejeitada: manter a conta
`auth.users` viva, banida e com e-mail trocado por placeholder (preserva integridade referencial, mas
deixa uma casca de conta reativável e um registro de identidade que o titular pediu para eliminar).
Se o humano preferir a alternativa, **volte ao architect**: o desenho muda inteiro.

### 5.3 Riscos residuais aceitos (registrar, não corrigir agora)

| Risco | Por que fica |
|---|---|
| `shift_payments.note` é texto livre da empresa e pode conter o nome do freela. | É coluna material imutável do documento fiscal. Mexer nela exigiria reescrever `enforce_shift_payment_immutability` — troca ruim. Mitigação: hint na UI de registro de pagamento ("não escreva dado pessoal aqui"). |
| `reviews.comment` escrito **pelo** titular excluído sobrevive. | Texto opinativo sobre terceiro; a autoria já degrada para o rótulo genérico. Remoção específica = atendimento manual. |
| `worker_certifications.verified_note` escrito pela **empresa** excluída sobre um freela que continua na plataforma. *(emenda 2026-08-21)* | O `ON DELETE SET NULL` da FK não dispara mais (§2.1.0) e o par `verified_by_company_id`/`verified_at` é travado por CHECK — "conferência anônima" é estado inexpressável. Um `UPDATE` seria barrado pelo ramo (c) de `enforce_certification_update_scope` (§0.3). Mitigação existente: o uuid é pseudônimo e resolve para `'[Empresa Deletada]'`. Mesma classe de `reviews.comment`: remoção específica = atendimento manual. |
| A contraparte mantém o histórico da conversa (`Message` recebidas). | Mensagem tem dois titulares. Apagar o lado do outro é destruir dado alheio. |
| `companies` continua `USING (true)` com `cnpj`, `email` e `address` legíveis por qualquer autenticado. | **Débito NOVO (#10)** — mesma classe do #9, descoberto neste gate. Não entra aqui porque `/empresa/:id` e `CompanyProfile` dependem dessa policy e o fecho correto é column-scoped (RPC `get_company_public_profile` + policy restrita), o que é spec própria. |
| A policy de INSERT de `reviews` é `WITH CHECK (reviewer_id = auth.uid())` — não exige turno concluído. | Qualquer conta pode inventar avaliação sobre qualquer id. Fora do escopo deste débito: **#11**. |
