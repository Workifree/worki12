# ADR-20260821 — O uuid do freela não é credencial: PII de `workers` sai do regime "RLS por vínculo unilateral"

## Status
ACEITO

## Contexto

O achado `C-REFERRAL-WORKERID-PRE-ACEITE` (F10, indicação entre empresas) reportou que a vitrine
pré-aceite `get_worker_referral_card` omite `worker_id` mas devolve `avatar_url`, e que o path do
bucket embute o uuid do freela (`Profile.tsx:315` — `${profile.id}/${type}_${Date.now()}.${ext}`),
entregando o identificador que a projeção fechada tentava reter.

A cadeia de escalada verificada em disco:

1. `get_worker_referral_card` (`20260817001500:860`) e `list_worker_referral_cards` (`:951`)
   devolvem `avatar_url` com `status='awaiting_worker'`.
2. `workers.avatar_url` = `.../avatars/<WORKER_UUID>/avatar_<ts>.png` (`Profile.tsx:315` é o único
   ponto de upload de foto de freela do repositório — confirmado: só existem dois `.upload(` no
   projeto inteiro).
3. `CompanyReferrals.tsx:66` põe a URL no `src` do `<img>`. Ler o uuid é abrir o DevTools.
4. `tc_insert_company` (`20260622000000:103-108`) só exige ser dona da empresa e nascer `'pending'`.
5. `can_view_worker_profile` (`20260816120000`) concede leitura da linha inteira de `workers` para
   `team_connections` em `'pending'` **ou** `'accepted'` → `cpf`, `phone`, `pix_key`, `birth_date`.

**O achado está certo, e a causa que ele aponta está errada.** O path do bucket é *um* canal. A
causa é o passo 5: **`'pending'` é um estado que a empresa escreve sozinha**. Enquanto ele conceder
leitura de PII, *conhecer o uuid* é equivalente a *ter autorização* — o uuid vira credencial
portadora, e toda superfície do produto que deixe um uuid escapar, em qualquer formato, vira um
vazamento de CPF/PIX.

Isso não é hipótese. Levantando a classe, achamos **uma segunda instância, já aplicada em
produção**, que não passa por path de storage nenhum:

> `get_profile_reviews(reviewed_id, direction)` (`20260816130000:143`) devolve `r.reviewer_id::text`
> **cru** para qualquer sessão autenticada. Com `direction='company'`, os avaliadores são freelas —
> a função mascara o *nome* ("Carlos S.") e entrega o *uuid* ao lado. Uma empresa que chame a RPC
> para qualquer perfil de empresa colhe uuids de freelas em lote e roda os passos 4-5. O isolamento
> de papel do `ProtectedRoute` não protege: `.rpc()` é chamada direta, e o `GRANT` é a
> `authenticated`.

E o próprio código já documenta a manobra como caminho normal: o comentário em
`teamConnectionService.addToTeam` explica que, desde `20260816120000`, "não dá mais pra pré-checar a
existência do worker antes de ter conexão" — ou seja, **inserir a linha `pending` é o gesto que
destrava a leitura**. A regra ficou invertida: o vínculo não prova consentimento, ele o dispensa.

O §6.5 do contrato de F10 declara que `cpf/phone/pix_key/birth_date` "NUNCA saem". A declaração é
verdadeira sobre a projeção da RPC e falsa sobre o sistema.

## Decisão

**PII de `workers` passa a exigir consentimento do titular ou vínculo operacional real.** Conhecer o
uuid deixa de autorizar qualquer coisa.

Cinco mudanças. As três primeiras são condição de merge de F10 (`DS-PII-1..3`); a quarta é a emenda
do §6.5; a quinta é higiene de classe, fora do caminho crítico.

### DS-PII-1 — `can_view_worker_profile` perde o ramo `'pending'` (BLOQUEANTE)

Migration nova (F10 não foi aplicada; esta é uma correção da política de `20260816120000`, que **foi**).
Ramos que ficam: (0) self, (1) `team_connections.status = 'accepted'`, (2) vínculo operacional via
`applications` em `jobs` da empresa. O ramo `'pending'` sai.

Efeito: a linha `pending` forjada do passo 4 passa a não render nada. O uuid deixa de escalar.

**Justificativa de produto, não só de segurança:** `'pending'` é a empresa dizendo "quero esta
pessoa". `'accepted'` é a pessoa dizendo "pode". CPF, PIX e data de nascimento pertencem ao segundo.
LGPD à parte, é a mesma assimetria de confiança que `product.md` já defende no fluxo push.

### DS-PII-2 — `list_team_connection_cards()` para renderizar o convite pendente (BLOQUEANTE)

DS-PII-1 quebraria o cartão de convite pendente: `teamConnectionService.listAllConnections`
(`:538`) embute `worker:workers(id, full_name, avatar_url, primary_role, rating_average, city)` sem
filtrar status, e sob PostgREST o embed de uma linha negada vem `null` — cartão sem nome.

RPC nova, `SECURITY DEFINER`, `search_path = ''`, **sem parâmetro** (precedente
`list_worker_referral_cards` / `is_shift_call_target`: função que aceita "por qual empresa listar" é
varredura com passo de uuid). Projeção fechada e exaustiva, campo a campo — exatamente os seis que a
tela consome, nenhum deles PII.

`listTeamMembers` (`:479`, filtra `'accepted'`) **não muda**: lá o consentimento existe e `phone`/
`pix_key` são o insumo do modo A.

### DS-PII-3 — `get_profile_reviews` para de devolver `reviewer_id` de pessoa natural (BLOQUEANTE)

Quando `p_direction = 'company'` (avaliador é freela) e o caller não é o dono do perfil avaliado,
`reviewer_id` sai `NULL`. Mesmo predicado que já governa o mascaramento do nome, aplicado ao campo
que ninguém olhou. Com `p_direction = 'worker'` o avaliador é empresa e `companies.id` é público
(`SELECT USING (true)`) — segue saindo.

Consumidor a verificar: `ProfileReviews.tsx` usa `reviewer_id` como `key` de lista; a chave passa a
ser `review_id`, que já vem e é único.

**Esta é a única das cinco que está viva em produção.** Vale como correção fora da fila de F10 —
sinalizada ao humano na seção de escalada.

### DS-PII-4 — §6.5 mantém `avatar_url` na vitrine, com a declaração corrigida

Das quatro opções mapeadas pelo evaluator (omitir o avatar / signed URL / proxy / trocar a
convenção de path), a vitrine **mantém `avatar_url` durante `awaiting_worker`**.

Com DS-PII-1 o uuid embutido deixa de escalar para PII, e o que sobra — uma empresa capaz de criar
um convite `pending` para alguém que ela viu num cartão — é justamente o que F10 existe para
produzir, com o consentimento no lugar certo (o freela aceita ou não, e o veto `blocked` continua
indelével). Tirar a foto custaria a prova social que faz a indicação funcionar, para comprar uma
proteção que DS-PII-1 dá de graça e melhor. Signed URL e proxy compram o mesmo, com um caminho de
expiração e um serviço novos.

O que muda no §6.5 é a **declaração**: ela passa a separar "`worker_id` não sai do campo `worker_id`"
de "o uuid não sai", registrar que hoje ele sai embutido em `avatar_url`, e ancorar em DS-PII-1 a
razão de isso ser aceitável. Um contrato que promete mais do que entrega é pior que um que não
promete.

### DS-PII-5 — convenção de path do bucket: chave aleatória (NÃO bloqueia F10)

`Profile.tsx:315` passa a usar `crypto.randomUUID()` no lugar de `profile.id` para uploads **novos**.
Objetos existentes ficam: o backfill exige mover objeto no Storage *e* reescrever
`workers.avatar_url` — não cabe em migration SQL, é tarefa de ops pré-piloto, e com DS-PII-1 no ar
o dano residual é "a empresa descobre um uuid", não "a empresa lê um CPF".

## Resposta à pergunta de classe: a convenção vale para todo upload?

Levantei os pontos de upload do repositório inteiro. São **exatamente dois**:

| Ponto | Path | Vaza? |
|---|---|---|
| `frontend/src/pages/Profile.tsx:315` (freela, avatar+capa) | `${profile.id}/…` — `workers.id` = `auth.users.id` | **Sim.** É a instância reportada. |
| `frontend/src/pages/company/CompanyProfile.tsx:233` (empresa, logo+capa) | `${userId}/…` onde `userId` é usado como `companies.id` (`:151`, `:257`) | **Não hoje.** `companies` tem `SELECT USING (true)`: o id já é público, e não existe `can_view_company_profile`. |

**Mas o de empresa é uma mina armada, e o pino é o F3.** `CompanyProfile` funciona porque
`companies.id = auth.uid()` (trigger `handle_new_user`). A ancoragem dupla de `is_company_owner` /
`is_job_owner` existe *precisamente* porque esse caso vai deixar de ser o único — quando o
multi-unidade/gerente entrar por essa costura, `userId` vira o uid do gerente e o path passa a
embutir um `auth.users.id` de **pessoa natural** num campo lido por todo mundo. Trocar a convenção
agora (DS-PII-5) custa uma linha; depois, custa backfill com o furo aberto.

**A conclusão maior, que é o que importa levar adiante:** o path do bucket **não é** a classe. A
segunda instância que encontrei (`get_profile_reviews`) não tem path nenhum — entrega o uuid como
coluna. A classe é *"um identificador que autoriza"*. Enquanto `'pending'` conceder PII, cada campo
novo do produto precisa ser auditado como potencial canal de uuid, para sempre, e a auditoria falha
sozinha na primeira costura entre duas camadas (foi o que aconteceu aqui: SQL correto + React
correto = vazamento). DS-PII-1 tira a classe do jogo; DS-PII-4/5 são higiene depois disso.

## Consequências

### Positivas
- O uuid do freela deixa de ser credencial. Vazamentos futuros de identificador — em path, coluna,
  log, link de notificação — voltam a ser incômodo, não incidente de PII.
- Fecha duas instâncias com uma correção, sendo uma que ninguém tinha visto e está em produção.
- Alinha a policy ao que `product.md` já diz sobre consentimento e ao que o §6.5 já *afirmava*.
- F10 mantém a prova social (foto no cartão) que justifica a feature.

### Negativas / Trade-offs
- Mais uma RPC `SECURITY DEFINER` de projeção fechada (DS-PII-2) — superfície para auditar. Mitigado
  por ser sem parâmetro e por replicar padrão existente.
- Empresa com convite `pending` deixa de ver `phone` do freela antes do aceite. **É a decisão, não um
  efeito colateral** — mas quebra o canal "convidei e ligo para cobrar o aceite". O aviso por
  WhatsApp a partir de convite pendente precisa ser reavaliado quando existir.
- DS-PII-3 mexe em função aplicada em produção: exige verificação de consumidor e janela própria.
- DS-PII-5 deixa um rastro histórico de paths com uuid até o backfill.

## Alternativas rejeitadas

- **Omitir `avatar_url` enquanto `status <> 'accepted'`** (a mais simples): trata o canal, não a
  classe; `get_profile_reviews` continuaria vazando; e custa a prova social que é o mecanismo da
  feature.
- **Signed URL de curta duração / proxy:** compram o mesmo que DS-PII-1 já entrega, cada um com um
  caminho de expiração ou um serviço novo para manter. Vale reconsiderar se um dia a foto do freela
  virar dado restrito por si — não é o caso.
- **Trocar só a convenção de path, com backfill:** a opção "conserta a classe inteira" segundo o
  evaluator. Não conserta: `get_profile_reviews` é a prova. Vira DS-PII-5, defesa em profundidade.
- **Privilégio de coluna (`REVOKE SELECT (cpf, phone, pix_key, birth_date) ... FROM authenticated`)
  + RPC de contato:** o corte tecnicamente mais correto — separa PII do regime de RLS por linha. Mas
  privilégio de coluna vale por papel, não por linha: o próprio freela perderia `select('*')` na
  própria linha e `Profile`/`Dashboard`/onboarding precisariam de uma RPC para ler o próprio CPF.
  Escopo maior que o defeito, às vésperas do piloto. **Fica registrado como a evolução natural** se
  aparecer um terceiro caminho de leitura de PII de `workers`.
- **Manter `'pending'` e detectar linha "forjada":** não há como distinguir um convite legítimo de um
  forjado — os dois são um INSERT da empresa. Não existe predicado.

## Referências
- Spec/contrato: `.harness/spec/troca-freelas/ddl-aprovado.md` §6.5, §6.6
- Achado: `C-REFERRAL-WORKERID-PRE-ACEITE` (evaluator, F10)
- `supabase/migrations/20260816120000_workers_select_by_relationship.sql` — `can_view_worker_profile`
- `supabase/migrations/20260816130000_*.sql:143` — `get_profile_reviews` (2ª instância, em produção)
- `supabase/migrations/20260622000000_*.sql:103-108` — `tc_insert_company`
- `supabase/migrations/20260817001500_worker_referrals.sql:860`, `:951`
- `frontend/src/pages/Profile.tsx:315` · `frontend/src/pages/company/CompanyProfile.tsx:233`
- Padrão: `.harness/memory-bank/patterns.md` — "Projeção fechada não retém o identificador…"
- Costura relacionada: `ADR-20260817-seam-autorizacao-empresa.md` (par `is_job_owner` /
  `is_company_owner` — ponto de entrada do F3 e gatilho de DS-PII-5)

---

## Residual conhecido e ACEITO (registrado em 21/08/2026, achado do evaluator da F10)

`list_team_connection_cards()` (DS-PII-2) roda como **owner** e projeta o bloco `worker` também
para linhas `'pending'`. Como `tc_insert_company` permite criar `'pending'` unilateralmente e
`tc_delete_company` permite apagá-la, sobra um **lookup repetível**:

```
uuid conhecido → { full_name, avatar_url, primary_role, rating_average, city }
```

**Por que é aceito, e não um furo reaberto:**

1. **Não é enumerável.** uuid v4 não se varre; é preciso já conhecer o identificador.
2. **É detectável.** Criar a conexão `pending` dispara notificação ao freela — a manobra deixa
   rastro do lado da pessoa, não é leitura silenciosa.
3. **O delta é `city`.** Os outros cinco campos são exatamente o que o cartão da F10 já mostra
   **de propósito** à empresa destino, para ela decidir se quer indicar.
4. **Não escala para PII.** DS-PII-1 fechou o caminho para cpf/phone/pix_key/birth_date. É esse o
   ponto que importava.
5. **A ação que o uuid habilita** (criar convite `pending`) é o **objetivo declarado** da F10, com
   o consentimento no lugar certo: o freela recebe, decide, e pode vetar de forma indelével.

**NÃO alterar a RPC para restringir a projeção em `'pending'`.** Isso reabriria exatamente a
regressão que a DS-PII-2 existe para evitar: o cartão de convite pendente perde o nome, **sem erro
nenhum** (embed negado no PostgREST devolve `null`). Trocar um residual medido por uma falha
silenciosa é péssimo negócio.

**Reavaliar se:** aparecer um canal que torne uuids de freela colhíveis em lote de novo (o
`get_profile_reviews` era um; foi fechado), ou se a projeção crescer além dos seis campos.
