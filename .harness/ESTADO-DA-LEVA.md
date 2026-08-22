# Estado da leva pós-entrevista (F5–F13 + dívidas)

> Atualizado em 21/08/2026. Fonte única de verdade de onde cada coisa está.
> Regra: nada sai deste quadro sem estar **em produção** ou **explicitamente descartado**.

## Legenda
✅ pronto · 🔄 em andamento · ⏸️ parado esperando decisão do owner · ❌ reprovado, com correção em curso

---

## 1. Já em PRODUÇÃO (aplicado e verificado no catálogo)

| O quê | Quando | Verificação |
|---|---|---|
| **F1–F4** (chamado de turno, listas, escala recorrente, véspera) | leva anterior | migrations aplicadas |
| **F5** guarda de risco de vínculo | 21/08 | 2 colunas + 2 funções |
| **F6** termo de prestação | 21/08 | tabela + RLS + policy |
| **F7** disponibilidade declarada | 21/08 | coluna + CHECK |
| **F8** certificações e treinamentos | 21/08 | 2 tabelas + 7 policies + cron |
| **Dívida #9** `reviews` escopado por vínculo | 21/08 | policy única de SELECT (exigiu 2 tentativas — ver `patterns.md`) |
| Frontend F5–F8 | 21/08 | `worki-opal.vercel.app`, verificado por chunk |

## 2. ✅ F9–F12 — commitadas, mergeadas em `main`, migrations APLICADAS

PR #216 mergeado. Migrations `20260821000300` (DS-PII), `20260817001400` (F12), `001500` (F10) e
`001600` (F11) aplicadas e **verificadas no catálogo**.

**V8 do SOS (gate de não-subida) PASSOU:** `claim_shift_slot` preserva a checagem de
`jobs.status='deleted'` e o lock continua em `jobs`. O trigger de `origin` é **BEFORE** — se virasse
AFTER, as duas policies novas deixariam de valer em silêncio.

### ✅ DEPLOY FEITO (22/08) — F9–F12 no ar, verificadas no bundle publicado

Bundle `index-musdyRGh.js`. Chunks conferidos por download, não pelo relatório do deploy:
`CompanyOperationAnalytics`, `CompanyReferrals`, `QuemTeIndicou`, `CompanyBadges` — todos presentes,
com o texto esperado dentro (tempo de preenchimento, banner de erro, consentimento citando CPF,
"Sem avaliação" ≠ nota zero, e o vocabulário proibido de F10 ausente como deve ser).

**O que destravou: `--archive=tgz`.** O CLI falhava com `TypeError: fetch failed` na fase de upload
mesmo com a rede boa. Duas descobertas no caminho:
1. O Node preferia IPv6, que não resolve nesta máquina — `curl` funcionava por usar IPv4.
   `NODE_OPTIONS="--dns-result-order=ipv4first"` fez `vercel whoami` passar.
2. Mas o deploy seguia falhando: requisição pequena passava, upload de muitos arquivos não.
   **`--archive=tgz` sobe um tarball único** e contorna. Comando que funciona:

```
npx vercel --prod --yes --archive=tgz
```

Da **raiz** (nunca `--cwd frontend`, que publica num projeto avulso).

**Verificação pós-deploy obrigatória** — o hash do build local nunca bate com o da Vercel: baixar o
`index-*.js` do ar, extrair o nome do chunk por grep, baixar o chunk e procurar uma string que só
existe na versão nova. Foi assim que descobri que meu primeiro grep de "Tempo de preenchimento"
dava falso negativo (a string real é "Tempo médio de preenchimento do chamado").

## 3. ✅ DECISÕES TOMADAS (21/08/2026 — owner delegou: "tome a decisão recomendada")

Todas seguem a recomendação já produzida pelo `harness-architect` nos respectivos gates.
**Onde eu escolhi um número que o contrato deixou em aberto, está marcado — esses pontos merecem
confirmação de um advogado antes do piloto, e a implementação não depende disso para andar.**

### H1 — "Excluir conta" passa a significar perder o acesso + anonimizar, com retenção de 5 anos

- **Anonimização com lápide pseudônima**, não exclusão física. Não existe caminho que cumpra o
  art. 18, VI **e** preserve a trilha fiscal; a alternativa seria destruir `shift_payments`, que é
  documento de auditoria.
- **Prazo de retenção: 6 anos** de `shift_payments` e `service_terms`, contados de `paid_at` /
  `accepted_at`. **Corrigido de 5 para 6 em 21/08**, por recomendação do architect, e ele estava
  certo: eu tinha raciocinado a partir da prescrição **civil** (CC art. 206, §5º, I — cobrança de
  dívidas), mas o risco que este produto corre é **reclamação trabalhista alegando vínculo**. Ela
  cabe até 2 anos após o fim da relação (CF art. 7º, XXIX) e o processo dura anos — a prova que
  interessa é exatamente o `term_text`, que declara ausência de vínculo, e o cenário realista é
  precisar dele **no ano 6 ou 7**. Cinco anos deixaria a prova expirar antes do risco.
  **Ainda assim é escolha de orquestração, não parecer jurídico — confirmar com advogado.**
  O prazo mora isolado em `lgpd_retention_interval()`: trocar é `CREATE OR REPLACE` de três linhas.
- **O expurgo apaga CONTEÚDO PESSOAL, não a LINHA** (ADR-20260821-expurgo-de-conteudo-nao-de-linha).
  O que a LGPD exige eliminar é o dado pessoal; o registro contábil pseudônimo não é dado pessoal
  depois que nome e CPF saem, e é ele que sustenta a trilha fiscal.
- **O prazo é do DADO, não da conta.** Conta excluída hoje com pagamento de 4 anos atrás: expurgo em
  2 anos. Contar da exclusão faria quem exerce o art. 18, VI **prolongar** a retenção dos próprios
  dados (6 anos para quem não pede, 10 para quem pede) — e deixaria todo registro de conta viva fora
  do expurgo para sempre.
- Decorrido o prazo, expurgo por cron — **não existe hoje**, é a migration `20260821000400`, e passa
  a ser parte da entrega.
- **A política e a tela precisam dizer, com todas as letras**, que o termo aceito é retido **com
  nome e CPF** por esse período. Sem isso a promessa continua falsa, só que na direção oposta.
- Nota de honestidade que fica no ADR: isto **não é anonimização** no sentido do art. 5º, XI — é
  eliminação parcial com retenção justificada sobre chave pseudônima. Não chamar de anonimização
  na política.

### H2 — Remover as FKs CASCADE para `auth.users`

Em `workers`, `companies` e `wallets`. **A cascata é o bug, não o RESTRICT:** trocar por CASCADE
destruiria o livro-caixa (Article 9). Aceita-se linhas órfãs por construção — é o que torna a
lápide possível.

### F13 — O gerente cria a própria credencial; a conta-mãe convida

Convite por **token de link** (`invite_company_manager` → `/convite-gerente/:token` →
`accept_manager_invite`), precedente `ADR-20260702-worker-join-by-invite-token`. **Criação direta
de credencial pela empresa é rejeitada:** a empresa criaria senha para outra pessoa, e exigiria uma
Edge Function nova com `service_role` chamando `auth.admin.createUser` para resolver o que o token
já resolve.

O custo aceito: a conta-mãe **não** pode resetar a senha do gerente. O ganho: vínculo consentido,
auditável, revogável em soft-delete, e a saída do gerente não leva o Elenco junto.

### SOS — o consentimento passa a nomear CPF e data de nascimento

Das duas saídas da dívida #13, escolhida a **(i) ampliar o texto**. A (ii) — restringir colunas no
ramo operacional de `can_view_worker_profile` — é decisão de arquitetura que atinge **todas** as
features que dependem daquele ramo, e não cabe às vésperas do piloto.

O texto hoje promete "telefone e chave PIX"; a empresa passa a ver a **linha inteira**. Um opt-in
que não diz o que expõe não é consentimento informado — e é essa defesa que sustenta a feature.

> **O parecer jurídico do ADR do SOS continua pendente** e não é substituído por esta decisão. O que
> foi decidido é qual correção implementar agora; a revisão jurídica segue como gate de pré-piloto.

## 4. ✅ Correção de segurança — APLICADA EM PRODUÇÃO (21/08)

**Dívida #15 — o uuid do freela é credencial de PII.** `get_profile_reviews` entrega uuids de
freelas a qualquer conta autenticada; com o uuid, insere-se `team_connections` em `'pending'`
(gesto unilateral da empresa) e lê-se CPF/telefone/PIX/nascimento.

**Aplicada e verificada no catálogo** (`20260821000300`), não no `{"success":true}`:
`can_view_worker_profile` não menciona mais `'pending'` e só concede por `accepted`;
`list_team_connection_cards` existe, é DEFINER e **sem parâmetro**; `get_profile_reviews` anula
`reviewer_id` para terceiro; **`anon` não tem EXECUTE em nenhuma das três**.

Raio medido antes de aplicar: **0 conexões pendentes** (nada quebrou), **2 uuids expostos**.

Pendente: `V1–V5` da própria migration contra dado real, e o **frontend correspondente ainda não
foi deployado** — `listAllConnections` já chama a RPC nova no código, mas o que está no ar ainda
usa o embed. Não quebra (o embed só perde o `worker` de linhas pending, e não há nenhuma), mas o
deploy fecha o par.

## 5. Dívidas registradas (`debitos-pre-piloto.md`)

| # | Gravidade | Resumo |
|---|---|---|
| 1 | Alta | Política de Privacidade não declara `service_terms` nem `availability_days` |
| 2 | Média | CHECK aceita `{}` em `availability_days` (garantia mora no client) |
| 3 | Média | `/profile` sem campo de CPF — `missing_cpf` do F6 não tem saída |
| 4 | Baixa | `GRANT UPDATE` amplo em `service_terms` |
| 5 | 🔴 Alta | `delete-account` quebrado (CASCADE × RESTRICT) — **pré-existente** |
| 6 | Média | Aceite do termo garantido só pela UI |
| 7 | Baixa | Resíduos do aceite (gate no `disabled`, banner p/ empresa) |
| 8 | — | Reversão do A3 depende do item 3 |
| 9 | ✅ | **PAGA** — `reviews` escopado |
| 10 | Alta | `companies` é `USING (true)` — expõe CNPJ/e-mail/endereço. **Consumidor acoplado:** a busca do F10 quebra em silêncio quando fechar |
| 11 | Alta | INSERT de `reviews` não exige turno concluído — qualquer conta inventa avaliação |
| 12 | Média | F9 × F11: painel conta SOS diferente de chamado de elenco |
| 13 | 🔴 Alta | Consentimento do SOS subdeclara — não menciona **CPF** |
| 14 | Média | Painel de aceitação enviesado a favor do SOS |
| 15 | 🔴🔴 | **uuid é credencial de PII** — em correção |

## 6. Especificações prontas, sem implementação

- **F13** multi-unidade — DDL aprovado, 2 blockers da spec corrigidos no gate. ⏸️ decisão H.

## 7. Pendências de deploy (não de commit)

- **V1–V7 + V8 do SOS** contra o banco, **depois** de aplicar. V4 (empresa vê 0 alvos não aceitos)
  e V6 (forjar `origin='sos'` → 42501) são gate de não-subida.
- `pg_cron` do F8 exercitado.
- Ordem obrigatória: **migration antes do frontend** (coluna ausente = `42703` derruba a query inteira).

---

## F13 (multi-unidade) — portão de pré-voo RODADO em produção (22/08)

**Q0 (BLOQUEANTE) = 0 em todas as cinco linhas.** Nenhum `jobs`/`team_connections`/`shift_payments`/
`team_lists`/`job_series` ancorado em empresa inexistente. O narrowing da D3 não tira acesso de ninguém.

**Q1 = 0.** Nenhuma das 7 empresas tem `owner_id` diferente de `id`. A Fase 2 é no-op **verificado**,
não presumido — que é justamente o que a V6 do contrato mandava conferir em vez de assumir.

### ⚠️ Achado que mudou o lote: `20260821001100` NÃO entra

O plano dizia "Fases 0/1/2 + as irmãs". Mas `20260821001100_accept_manager_invite_dep_guard.sql` faz
`CREATE OR REPLACE FUNCTION public.accept_manager_invite` — função que **nasce na Fase 3**
(`20260818100300`). Aplicá-la agora não daria erro: **criaria** a RPC de aceite num banco sem Fase 3.
Resultado seria um gerente conseguindo aceitar convite sem nenhuma tela para operar depois — o estado
exato que a decisão de parar antes da Fase 3 existe para impedir. `CREATE OR REPLACE` não avisa que
está criando em vez de substituir; a dependência só aparece lendo o corpo.

Lote real: `20260818100000` → `20260818100100` → `20260818100200` → `20260821001000`. Só.

### Correção antes de aplicar

`20260821001000` citava `is_company_owner (20260818100400)` em 9 comentários — número morto desde o
rename para `20260821001000`. A função vem de `20260818100200`. Corrigido.

## LGPD — três varreduras rodadas contra produção ANTES de aplicar

Extraí as asserções (c)/(d)/(e) e rodei em modo leitura. (d) e (e) limpas. **A (c) acusou
`public.applications` e `public.jobs`.**

Não era tabela sem decisão: §2.1 "Demais tabelas" já as declara RETIDAS. Faltava o **nome** na
`v_classified_deps`. Adicionado com a justificativa.

**O que isso prova:** o bug do `regclass::text` (que o architect achou) estava **mascarando** estas
duas omissões — a asserção acusaria *todas* as tabelas, então ninguém olharia a lista. Consertar o
mecanismo fez ele achar defeito real no mesmo dia. Asserção que nunca rodou não é asserção.

## LGPD — a classe GERENTE/SÓCIO deixou de ser recusada

O ADR-20260822 propunha tratar `not_found` como falha e abortar antes do `deleteUser`. Isso fecha o
furo de **segurança** (credencial some com o vínculo ativo) abrindo um furo de **direito**: o gerente
da F13 não tem linha em `workers` nem em `companies` (a casca é apagada no aceite), então ficaria
**permanentemente impedido de excluir a própria conta** — art. 18, VI violado dentro da rotina criada
para cumpri-lo.

`anonymize_account` agora reconhece a classe (consulta `company_members`/`organization_members` por
`user_id`, guardada por `to_regclass`). `not_found` volta a significar "não há titular" e segue sendo
falha para a Edge Function. Em avaliação pelo evaluator — eu escrevi, não me aprovo.

## F13 — Fases 0/1/2 APLICADAS em produção (22/08), Fase 3 fora

Verificado no catálogo entre cada passo: 3 tabelas, 5 funções, **7 organizações para 7 empresas**
(1:1, marcador de reversibilidade íntegro), `is_company_owner` reescrita com corpo `BEGIN ATOMIC`
delegando para `session_operates_company_membership` e sem a branch nua `p_company_id = auth.uid()`.

Aplicadas: `20260818100000`, `20260818100100`, `20260818100200`, `20260821001000`, `20260822000000`.
**Fora:** `20260818100300` (Fase 3) e `20260821001100` — sem frontend de gerente, não sobem.

### Achado do Q3: duas policies autorizavam empresa por fora do seam

A Fase 2 criou `jobs_insert/update/delete_company_owner` mas **não removeu** a legada
`"Company owner can manage jobs"` (`FOR ALL`, ancoragem inline), nem
`"Company owner can view own company"`. Não vazavam — subconjunto estrito. Mas eram uma **segunda
porta** de autorização que não passa pelo seam: no dia em que alguém apertasse `is_company_owner`
(movimento previsto — foi o que a DS-PII fez com `can_view_worker_profile`), a legada continuaria
concedendo pelo critério antigo e o aperto viraria teatro.

Removidas em `20260822000000`, com asserção fail-closed e depois do APROVADO do security-reviewer.
**Fica** `"Users can create their company"` (INSERT, `owner_id = auth.uid()`): não é subconjunto da
irmã `id = auth.uid()`, e errar aqui significa "ninguém cria empresa". Dívida de limpeza registrada.

### ⚠️ O Q3 automatizado com `LIKE` estava errado — acusava o estado CORRETO

`... LIKE '%owner_id%'` casava com `is_company_owner(id)`, porque **`_` é curinga de um caractere no
LIKE**. A mesma linha devolvia `LIKE = true` e `position('owner_id' in qual) = 0`.

Consequência: o guarda acusava exatamente as policies **já migradas para o seam** — todas chamam
`is_company_owner(...)`. Guarda que grita no estado bom some no ruído ou faz alguém "consertar" o que
está certo. Mesma família do `regclass::text` sem schema, achado no mesmo dia.

Corrigido para `strpos(...) > 0` na migration e no §6 do contrato. Q3 real: **limpo**.

### ✅ Cadastro de empresa TESTADO em produção (não deduzido)

A Fase 1 pôs `companies.organization_id` **NOT NULL**, e `handle_new_user` insere em `companies`
**sem** essa coluna. Toda criação de empresa passou a depender do trigger BEFORE INSERT
`trg_company_autoprovision_organization` funcionar. Se ele falhasse, o sintoma seria "ninguém
consegue mais cadastrar empresa" — regressão de produção introduzida por nós.

Isso não dá para deduzir do código: o caminho crítico é `name = ''` (o valor que `handle_new_user`
grava), e `organizations.name` tem `CHECK (length(trim(name)) > 0)`. Um `NULLIF` ingênuo devolveria
NULL e violaria o NOT NULL **no primeiro signup real**.

Testado de verdade, com rollback forçado (`DO $$ ... RAISE EXCEPTION` — bloco atômico, aborta
inteiro): criei um `auth.users` + `companies (id, name='', owner_id)` e li o resultado antes de
abortar.

```
organization_id = 2f68ebdb-…        (preenchido pelo trigger)
org.name        = [Organizacao 926bf402]   (fallback pegou o name = '')
owner_ativo     = 1                 (organization_members owner/active criado)
```

Depois: `organizations=7, organization_members=7, companies=7`, zero resíduo de teste. O rollback
levou tudo.

**Padrão reutilizável:** para exercer caminho destrutivo em produção sem sujar, embrulhar em
`DO $$ … RAISE EXCEPTION 'resultado: %' … END $$`. A exceção carrega o resultado da leitura e
desfaz a escrita no mesmo gesto — um teste que não pode vazar por esquecimento de limpar.

## Auditoria do memory-bank contra o catálogo (22/08) — 14 divergências

Terceira vez que o `architecture.md` afirma schema inexistente, então varri o arquivo inteiro contra
`pg_attribute`/`pg_constraint`/`pg_proc`/`pg_trigger`/`pg_policies`/`pg_indexes`/`cron.job`.

**A pior, e na direção contrária da esperada:** a seção "Estado do banco de produção" declarava
`20260817001400` (F12), `001500` (F10) e `001600` (F11) como **NÃO aplicadas**, com a frase
"confirmado: os objetos não existem no banco" — e as três **estão em produção**. Errar dizendo
"aplicado" faz alguém deixar de aplicar; errar dizendo "não aplicado" convida a **reaplicar migration
sobre objeto vivo** (`DROP POLICY`/`CREATE OR REPLACE` em cima de coisa em uso). O texto ainda
carregava o selo "✅ VERIFICADO CONTRA O CATÁLOGO" de 21/08.

**A de maior risco funcional:** `workers.availability_days` documentada como array de inteiros
(`[1,2,3,4,5]`) quando é **objeto** `{"0":["manha","tarde"],…}`. Conferi o código publicado antes de
concluir: `types/index.ts` e `lib/availability.ts` implementam a forma **correta**. Não houve bug em
produção — o erro era só da documentação.

**A que já tinha custado decisão:** `shift_attendance_confirmations.metadata jsonb` não existe. O
architect registrou risco residual de LGPD sobre essa coluna, lendo o memory-bank. Risco vazio.

**Erro que sobreviveu à própria correção:** o rótulo dizia "0–6 (segunda–domingo, convenção ISO
`getDay()`)" — errado duas vezes (`getDay()` não é ISO; ISO-8601 é 1=segunda…7=domingo, e `getDay()`
começa no domingo). O texto **se contradizia sozinho**: o exemplo ao lado tratava `1` como segunda,
o que só fecha com `0` = domingo. A correção automática preservou a metade errada. Peguei conferindo
`lib/availability.ts:94`, `types/index.ts:10` e o teste canônico. Varri o repo: nenhum outro arquivo
carrega a convenção errada.

Outras: cron da F4 (nome, horário e função todos errados — o real é
`shift-attendance-confirmations-d1 @ '0 21 * * *'` chamando `request_attendance_confirmations_due()`;
a função `batch_*` documentada não existe, e 21h UTC é 18h BRT, não madrugada); as três RPCs da F4
recebem `p_application_id`, não `job_id`/`worker_id`; o trigger é AFTER e **não** é bilateral;
`job_local_date` não lê `settings.app_timezone` (tabela inexistente), o fuso vem do GUC da função;
`job_series` não tem `job_template jsonb` nem `updated_at`; **existe** FK `jobs.series_id →
job_series` com `ON DELETE SET NULL` (a doc afirmava que não havia); o índice de
`shift_attendance_confirmations` é `uq_sac_auto_once UNIQUE (application_id) WHERE source='auto'`,
então "várias tentativas permitidas" é falso para o caminho do cron; `render_service_term_text` não
recebe e-mail; e o UNIQUE de idempotência do Article 9 é **índice parcial**
(`WHERE reference_id IS NOT NULL`), não constraint.

**Causa raiz:** este arquivo descreve a **intenção** das migrations; nada no build, lint ou teste
cruza isso com o banco. Ficou registrada nota no topo do arquivo: schema ali vale o que o catálogo
disser.

## ⚠️ GATE DE DEPLOY: a Edge Function `delete-account` NÃO pode subir antes da migration

Achado A-2 do evaluator. A função reescrita chama `anonymize_account`, que **não existe** em produção
(`20260821000000` não aplicada — conferido: a função não está no catálogo).

Deployá-la agora **troca um bug por outro pior**: hoje a exclusão falha no `deleteUser` por FK; com a
função nova e sem a migration, a chamada `.rpc()` devolve `PGRST202` e **100% das tentativas de
exclusão retornam 500**. O comportamento é fail-closed (ninguém perde credencial), mas ninguém
consegue excluir conta nenhuma.

**Ordem obrigatória:** `20260821000000` (anonimização) → `20260821000400` (expurgo) → deploy da Edge
Function. Mesma família da regra já registrada "migration antes do frontend".

**E antes de qualquer um dos três**, o que continua faltando e não é técnico:
- **Política de Privacidade** (J4/§6.1) — bloqueia publicar a rotina ao usuário.
- **Prazo de retenção de 6 anos** — confirmação jurídica.
- **Texto de consentimento do SOS** — revisão jurídica.
- **Retenção do token de cartão no Asaas** — sem endpoint de revogação confirmado; ou se confirma
  com o Asaas, ou se remove o cliente lá, ou se declara a retenção na Política de Privacidade.

### ⚠️ Cópia velha da migration de LGPD no worktree

`../worki12-multi-unidade/supabase/migrations/20260821000000_lgpd_account_anonymization.sql` é a
versão de quando a branch `feat/multi-unidade` nasceu — **diverge** da do repositório principal e
ainda tem o `regclass::text` quebrado em 5 pontos.

Não há risco vigente: as migrations de LGPD são aplicadas a partir do repositório principal, e do
worktree só saem arquivos de F13. Mas o arquivo existe nos dois lugares com conteúdo diferente, e
"aplicar do worktree" foi exatamente o que fiz hoje para a F13 — o hábito é o risco.

**Ao fechar a branch:** trazer `main` para dentro dela antes de qualquer aplicação futura a partir
do worktree, e conferir que o arquivo de LGPD ficou igual ao do principal.
