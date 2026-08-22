# DDL aprovado — F12 Badges das empresas onde o freela já trabalhou (gate de arquitetura)

> **Este arquivo é o contrato.** O builder copia o SQL da §3 **byte a byte** para
> `supabase/migrations/20260817001400_worker_company_badges.sql`.
> Onde este documento diverge de `.harness/spec/badges-empresas/spec.md`, **este documento manda**
> (a spec foi escrita antes do gate). Os desvios estão na §2 e são normativos: implementar a spec
> nesses pontos é rejeição no evaluator.
>
> ADR: `.harness/memory-bank/decisions/ADR-20260821-badges-historico-de-empresas.md`

STATUS: **APPROVED_WITH_CHANGES** — 11 desvios normativos da spec (DS1–DS11), §2.

> **Adendo de 2026-08-21 (gate de arquitetura sobre o achado `C-BADGE-CLICK-TARGET`):** **DS11** é
> normativo e corrige um destino de navegação que, como escrito na spec (R9/A9), **nunca funciona** em
> `mode='view'`. Nenhum SQL novo, nenhuma migration nova — o desvio é 100% de rota/UI.
> ADR: `.harness/memory-bank/decisions/ADR-20260821-rota-espelho-perfil-publico-empresa.md`

> **SINALIZAÇÃO AO HUMANO (não bloqueia esta feature, mas é maior que ela):** a policy de SELECT de
> `reviews` é `USING (true)` desde `20260309000000` — **qualquer conta autenticada** (worker ou empresa,
> criada em 30 segundos, sem vínculo nenhum) já consegue hoje ler TODAS as avaliações de qualquer freela,
> com `reviewer_id`, e resolver o nome da empresa avaliadora em `companies` (também `USING (true)`).
> `pages/company/WorkerPublicProfile.tsx:120-140` já renderiza exatamente isso na tela.
> Ou seja: **"a nota que a empresa X deu ao freela" já é dado exposto e atribuído hoje**, sem esta
> feature e sem portão de vínculo. Isso muda o veredito da F12 (ver §1/D3), e é uma dívida de LGPD
> independente — merece spec própria (`reviews` escopado por vínculo, no molde de
> `20260816120000`). **Não** é corrigido aqui: mexer em `reviews` fora de spec quebraria
> `ProfileReviews`, `CompanyProfile`, `CompanyPublicProfile` e `WorkerPublicProfile` de uma vez.

---

## 1. Decisões do gate (respostas diretas)

### D1 — Tabela de badge: **NÃO existe.** O badge é derivado em query, sempre.

Nenhuma tabela `worker_company_badges`, nenhuma coluna `badge_count`, nenhum materialized view, nenhum
trigger de invalidação. A verdade já está no banco em duas tabelas que são fonte canônica de outra coisa:

- **onde trabalhou** = `applications.status = 'completed'` + `jobs.company_id` — a mesmíssima régua de
  `completed_jobs_count` em `recompute_worker_aggregates` (`architecture.md`, Slice 4).
- **a nota daquela empresa** = `reviews` com `direction = 'worker'` — fonte de `workers.rating_average`.

Materializar reputação cria estado que envelhece errado: turno estornado, conta anonimizada pelo
`delete-account`, empresa que muda de nome/logo, review corrigida — cada um vira um caminho de invalidação
novo, e cada caminho esquecido vira badge mentindo no perfil de uma pessoa. Derivado, o badge não pode
divergir da fonte porque **é** a fonte.

A única escrita nova desta feature é **preferência do freela** (o que ele quer esconder) — que não é
derivável de nada e por isso, e só por isso, ganha tabela.

### D2 — Consentimento do freela: **opt-out, em dois níveis, e o gesto é dele.**

A spec fixou opt-out por empresa. Está certo — esconder por padrão mata a feature (a tese do produto é
tornar o histórico visível, e nenhum freela vai catar 12 badges para ligar um por um). Mas o pedido do
humano ("o freela pode ter razões legítimas para não anunciar onde trabalha") exige **um gesto único** que
apaga a seção inteira, e não N gestos que apagam N badges com falha parcial no meio.

Logo, dois controles:

1. **`workers.badges_hidden`** (coluna nova, boolean, default `false`) — chave-mestra. Ligada, terceiros
   recebem **zero linhas**; o próprio freela continua vendo tudo (senão não consegue voltar atrás).
   Toggle por `UPDATE` normal (a policy `Workers can update their own profile`, `USING (id = auth.uid())`,
   já cobre) — sem RPC nova, Article 5 respeitado.
2. **`worker_company_badge_prefs (worker_id, company_id, hidden)`** — bisturi por empresa, via RPC.

Nenhum dos dois toca `applications`, `reviews`, `wallets`, XP ou `completed_jobs_count`: esconder é
**exibição**, não desfazimento de história (A5 da spec).

### D3 — A nota por empresa: **aprovada, porque não é exposição nova** — e o motivo importa.

Foi a decisão mais examinada deste gate, porque a leitura ingênua ("badge com nota vira reputação portátil
atribuída, LGPD art. 20") bate de frente com `.harness/spec/analytics-operacao/prd.md` §D4, que **recusou**
criar score exposto de freela. Verificado no código, o quadro é outro:

- `reviews` é `USING (true)` e `companies` é `USING (true)`. A dupla `(qual empresa, que nota deu)` é
  legível hoje por qualquer autenticado, sem vínculo nenhum.
- `pages/company/WorkerPublicProfile.tsx` **já mostra** essas reviews com o nome da empresa avaliadora e a
  nota, uma a uma, na mesma tela onde o badge vai entrar.

O badge substitui N linhas "Divino Fogão — 4 estrelas" por um selo "Divino Fogão · 3 turnos · 4,0". É
**agregação do que já está na tela**, não abertura de dado novo. Recusar a nota no badge enquanto a lista
de reviews logo abaixo mostra a mesma nota com o mesmo nome seria teatro de privacidade.

**Coerência com analytics D4 — mantida, e virou restrição de código (DS5):** o que D4 proibiu foi **score
composto e ranking** ("sem score único, sem ranking nem interno", ordenação alfabética). A F12 não cria
nenhum dos dois: cada nota fica **atribuída à empresa que a deu** (não combinada), a ordenação é
**cronológica** (`last_shift_at DESC`), e não existe campo `score` nem ordenação por nota. Se alguém
propuser depois "ordenar badges pela nota" ou "média das médias", é a Opção B de D4 e exige ADR próprio.

**A exposição genuinamente nova da F12 não é a nota — é a lista de empregadores.** A empresa A passa a ver
que o freela trabalhou na B (concorrente da mesma rua) mesmo quando B **nunca avaliou** — hoje esse caso é
invisível, porque sem review não há rastro cross-empresa (`applications` é escopada por dono, verificado em
`20260317160000`). É exatamente por isso que D2 dá ao freela a chave-mestra e o bisturi, e é isso que o ADR
registra como o trade aceito.

### D4 — Quem vê: **o portão existente, sem um milímetro a mais.**

`can_view_worker_profile(p_worker_id)` (`20260816120000`) é reaproveitada **sem alterar o corpo**: self,
empresa com `team_connections` pending/accepted, empresa com `applications` do freela em turno dela. Quem
não passa recebe **conjunto vazio** — não erro, não contagem, não "existe mas está oculto". Sem oráculo de
existência (A3).

A RPC é `SECURITY DEFINER` pelo mesmo motivo de `get_profile_reviews`: a empresa A precisa ler
`applications`/`jobs` da empresa B, e a RLS de `applications` (`20260317160000`) proíbe isso corretamente.
A DEFINER é o furo **estreito e auditável** — devolve 8 colunas fixas de 1 freela por chamada, nunca aceita
lista de ids do caller, nunca devolve `cpf`, `phone`, `pix_key`, `birth_date`, valor de turno, título de
vaga, endereço ou CNPJ.

### D5 — A logo: **já é pública na internet, e esta feature não amplia nada.**

`companies.logo_url` é uma URL do bucket `avatars`, obtida com `getPublicUrl`
(`pages/company/CompanyProfile.tsx:243-246`) — bucket público criado pelo dashboard, sem policy de
`storage.objects` em migration alguma. A mesma URL já é servida hoje no `JobCard`, no feed e em
`/empresa/:id`. Somado a `companies` ser `USING (true)` para nome, o selo **não estreia exposição
nenhuma**: renderiza um arquivo que já é anônimo-público e um nome que já é legível por qualquer
autenticado. Nenhum bucket novo, nenhuma signed URL, nenhuma policy de storage nesta feature.

### D6 — Corte mínimo: **1 turno concluído gera badge — e o badge diz "1 turno".**

Sem threshold de N. Threshold é um número arbitrário que some do produto e reaparece como reclamação
("trabalhei lá e não apareceu"). O antídoto para inflação não é esconder o badge de 1 turno, é **não deixar
ele mentir**: `shifts_count` é campo obrigatório na face do selo (DS4). "Divino Fogão · 1 turno" e
"Divino Fogão · 30 turnos" são selos visualmente iguais e informativamente diferentes, que é o correto —
quem lê decide o peso. `status='completed'` já é uma régua dura por si: convite recusado, cancelado ou
expirado não vira badge (A2).

### D7 — Anti-vision "NÃO é rede social": **respeitada, e o teste é este.**

Badge aqui não é troféu emitido pela plataforma (gamificação), não é curtível, não é comentável, não tem
contagem social e não é ordenável por popularidade. É **prova de histórico de trabalho, com origem
verificável e escopo de leitura restrito por vínculo comercial** — mais perto de uma linha de currículo do
que de um selo de perfil social. O que separaria a F12 da anti-vision seria badge cosmético desconectado de
turno concluído, ou badge visível ao público geral: nenhum dos dois está aqui.

---

## 2. Desvios normativos da spec (implementar o desvio, não a spec)

| # | Onde | Desvio | Por quê |
|---|---|---|---|
| **DS1** | R2, A4/A5 | A RPC **NÃO** filtra `hidden = true` para o **dono do perfil**. Ela devolve todas as empresas e uma coluna nova **`hidden boolean`**. O filtro só se aplica a terceiros. | Como escrita, a spec torna A5 (reexibir) **impossível**: escondido o badge, ele some da própria tela de gerência do freela e não há como voltar. Bug de contrato, não de UI. |
| **DS2** | (novo) | Coluna nova **`workers.badges_hidden boolean NOT NULL DEFAULT false`** — chave-mestra. Ligada ⇒ terceiros recebem 0 linhas; self continua vendo tudo. Toggle por `UPDATE` direto (policy self já existe), **sem RPC nova**. | D2. Opt-out global tem que ser **um** gesto atômico; N chamadas com falha parcial deixam o freela parcialmente exposto achando que se escondeu. |
| **DS3** | R3 | `set_worker_badge_visibility` **RETURNS boolean** (não `void`) e só grava se existir de fato turno concluído entre `auth.uid()` e `p_company_id`. Devolve `false` quando não aplicável. | Sem a guarda, qualquer freela grava linhas ilimitadas para `company_id` arbitrário (lixo/abuso de escrita). Com `void`, o client não distingue "gravado" de "ignorado" e a UI otimista mente. |
| **DS4** | R5 / §7 visual | **`shifts_count` é obrigatório na face do selo** (ex.: "3 turnos"), não é opcional nem decorativo. | D6 — é o que impede o selo de 1 turno virar inflação. |
| **DS5** | R5, geral | **Proibido** ordenar badges por `avg_rating`, **proibido** criar campo `score`, **proibido** combinar as notas de empresas diferentes num número novo. Ordem única: `last_shift_at DESC`. | Coerência com `analytics-operacao/prd.md` §D4 (Opção B rejeitada: score/ranking exige ADR próprio + revisão LGPD). |
| **DS6** | R2 | `last_shift_at` sai como **texto ISO-8601 UTC** via `to_char(...)`, não como `timestamptz` cru. | Lição já paga em `20260816130000`: o formato nativo do Postgres (`2026-03-12 10:00:00+00`) é rejeitado pelo parser de `Date` do Safari. |
| **DS7** | R2 | O casamento review↔empresa usa **ancoragem dupla**: `reviews.reviewer_id` bate com `companies.id` **ou** com `companies.owner_id`. | Mesmo motivo de `is_job_owner`/`is_company_owner`: a policy de INSERT de `reviews` grava `reviewer_id = auth.uid()`, que é `companies.id` no caso canônico mas `owner_id` em registros com dono separado. Sem a dupla, a nota **some em silêncio** para essas empresas. |
| **DS8** | R1 | A tabela nova tem **FK para `workers` e `companies` com `ON DELETE CASCADE`**, e RLS **só de SELECT** (self). INSERT/UPDATE/DELETE **não têm policy** — toda escrita passa pela RPC. | Preferência de exibição não é dado financeiro nem de auditoria (o veto do checklist a CASCADE vale para tabela financeira); apagar o freela deve apagar a preferência dele. Estado só muda por RPC = máquina de estados num lugar (padrão `shift_calls`). |
| **DS9** | R11 | Arquivo da migration: **`20260817001400_worker_company_badges.sql`** (a spec chutou `20260818000000`). | `20260817001300` é o último timestamp ocupado no repo. |
| **DS10** | R2 | A guarda de acesso mora **dentro** da cláusula `WHERE` da RPC e retorna conjunto vazio; **nunca** `RAISE EXCEPTION`. | Exceção distinguiria "freela não existe" de "existe mas você não pode" = oráculo de existência (A3). |
| **DS11** | R9, A9, §5 | O destino do clique no selo **depende do `mode`**: `mode='manage'` → `/empresa/:company_id` (como hoje); `mode='view'` → **`/company/empresa/:company_id`**, rota **nova** sob `CompanyLayout` que renderiza o **mesmo** `CompanyPublicProfile`. Proibido: liberar `/empresa` para `user_type='hire'` no `ProtectedRoute`, e proibido tornar o selo não-navegável. | `/empresa` está em `workerOnlyPaths` (`ProtectedRoute.tsx:148`) e `mode='view'` só monta em `/company/worker/:id` — quem clica é **sempre** `hire`. Como escrito, R9/A9 produz toast de "sem permissão" + redirect para `/company/dashboard` em 100% dos cliques, perdendo o perfil que a empresa estava lendo. Ver §2.1. |

---

## 2.1 DS11 em detalhe — rota-espelho, não furo no isolamento de papel

**O bug (determinístico, não intermitente).** `CompanyBadges.tsx:230` navega para `/empresa/:company_id`.
Em `mode='view'` o componente só monta em `pages/company/WorkerPublicProfile.tsx` (rota
`/company/worker/:id`, sob `CompanyLayout`, que já exige `user_type === 'hire'`). Logo, quem clica é
sempre `hire`. Mas `/empresa/:id` está registrada sob `MainLayout` (`App.tsx:162`) e `'/empresa'` está em
`workerOnlyPaths` (`ProtectedRoute.tsx:148`). O guard casa por `pathname === p || pathname.startsWith(p + '/')`,
então **todo** clique vira `addToast('Você não tem permissão para acessar esta página.')` + `Navigate` para
`/company/dashboard`. O card é `role="button"` com `tabIndex={0}` e hover — promete uma navegação que não
existe para o único público daquele modo.

**Decisão: rota-espelho (opção 3 do evaluator). As outras duas foram recusadas:**

- **Liberar `/empresa` para `hire` no `ProtectedRoute`** — recusada. O isolamento worker⇎empresa é o
  Article 1 da constitution e um "ponto sensível" declarado em `architecture.md`. `workerOnlyPaths` é uma
  **lista de prefixos**, e `/empresa` só seria seguro de abrir porque hoje é folha; abrir o prefixo cria
  precedente de exceção por rota e faz qualquer rota futura sob `/empresa/*` (ex.: `/empresa/:id/turnos`)
  nascer acessível a `hire` sem ninguém decidir isso. Trocar um guard de segurança por um problema de
  navegação é câmbio ruim.
- **Selo não-navegável em `mode='view'`** — recusada. Contradiz R9/A9 e mata o valor do selo justamente
  para quem ele existe: a empresa que está avaliando o freela e quer conferir quem foi o empregador
  anterior. Um card que não leva a lugar nenhum também não deveria ser `role="button"`.

**Contrato da rota nova**

| Item | Valor |
|---|---|
| Path | `/company/empresa/:id` |
| Layout | `CompanyLayout` (dentro do bloco `<Route path="/company" ...>` de `App.tsx`) |
| Element | `CompanyPublicProfile` — **o mesmo componente**, sem cópia, sem fork, sem prop nova |
| Guard | `ProtectedRoute` (não muda) + `CompanyLayout`, que já rejeita `user_type !== 'hire'` |
| SQL | **nenhum** — sem migration, sem policy, sem RPC, sem grant |

**Por que `CompanyPublicProfile` pode ser reusado sem tocar nele (verificado linha a linha):**

1. `select` em `companies` — policy `USING (true)` (`20260317160000`). Nenhuma dependência de papel. Nada
   novo é exposto: `/empresa/:id` já é o perfil público, e a empresa que olha já vê nome+logo no
   `JobCard`/feed.
2. Query de `applications` (`.eq('worker_id', user.id)`) — para um usuário `hire`, `user.id` é um
   `companies.id`, que nunca aparece em `applications.worker_id`. Resultado: array vazio ⇒
   `applicationId === null` ⇒ o botão **"Falar com a empresa" não renderiza**. Comportamento correto por
   construção (empresa não abre chat com empresa), **sem nenhum `if (userType)` dentro do componente**.
   Custo: uma query que sempre volta vazia — aceito; o alternativo seria ramificar por papel um componente
   hoje agnóstico.
3. `ProfileReviews reviewerRole="worker"` → `get_profile_reviews(id, 'company')` (`20260816130000`).
   O ramo de mascaramento devolve nome completo **só** se `p_reviewed_id = auth.uid()` ou se `auth.uid()`
   é `companies.owner_id` do perfil. Uma empresa olhando **outra** empresa recebe nomes mascarados
   ("Carlos S.") — igual ao freela. Uma empresa que clique no selo de **si mesma** vê nomes completos,
   exatamente o que `/company/profile` já mostra a ela. Zero exposição nova.

**Impacto em `mode='manage'` (freela em `/profile`): nenhum.** O destino continua `/empresa/:company_id`,
que é worker-only e funciona hoje. DS11 **adiciona** um destino, não substitui o existente.

**Como o componente escolhe o destino.** Derivar do prop `mode`, não de leitura de sessão (Article 5 —
sem `await` novo no clique):

```tsx
// DS11: /empresa/:id e worker-only (ProtectedRoute.workerOnlyPaths). Em mode='view' quem clica e
// SEMPRE uma empresa (o componente so monta em /company/worker/:id), entao o destino e a rota-espelho
// sob CompanyLayout. INVARIANTE: mode='view' => caller e 'hire'; mode='manage' => caller e 'work'.
// Montar CompanyBadges em qualquer tela nova exige revalidar esta invariante.
const profileBase = mode === 'view' ? '/company/empresa' : '/empresa';
```

**Teste obrigatório (é o que faltou):** `CompanyBadges.test.tsx` monta em `MemoryRouter` **sem**
`ProtectedRoute` — ambiente de teste fabricando uma condição que produção não tem. O caso novo deve
asserir os **dois** destinos (`mode='view'` → `/company/empresa/:id`; `mode='manage'` → `/empresa/:id`) e,
no caso `view`, montar também uma `<Route path="/empresa/:id">` que **reprova** o teste se for atingida.

---

## 3. SQL aprovado — copiar byte a byte

```sql
-- Migration: Badges das empresas onde o freela ja trabalhou (F12)
-- File: supabase/migrations/20260817001400_worker_company_badges.sql
-- Spec: .harness/spec/badges-empresas/spec.md
-- DDL aprovado: .harness/spec/badges-empresas/ddl-aprovado.md
-- ADR: .harness/memory-bank/decisions/ADR-20260821-badges-historico-de-empresas.md
--
-- O QUE ESTA MIGRATION FAZ
--   1. `workers.badges_hidden`             — chave-mestra do freela (esconde a secao inteira).
--   2. `worker_company_badge_prefs`        — opt-out por empresa (bisturi).
--   3. `get_worker_company_badges(uuid)`   — leitura DERIVADA dos badges (nenhum badge e armazenado).
--   4. `set_worker_badge_visibility(...)`  — o unico caminho de escrita da preferencia.
--
-- O QUE ELA NAO FAZ (e por que)
--   - NAO cria tabela de badge: badge e derivado de `applications.status='completed'` + `jobs` +
--     `reviews`. Reputacao materializada envelhece errado e exige invalidacao em cada canto
--     (estorno, anonimizacao LGPD, troca de logo). Derivado nao pode divergir da fonte: ele E a fonte.
--   - NAO altera `can_view_worker_profile` (20260816120000). O portao de quem ve o perfil do freela
--     continua exatamente o mesmo; esta feature so o CONSOME.
--   - NAO altera a policy de `reviews` (`USING (true)`, 20260309000000) nem a de `companies`
--     (`USING (true)`, 20260317160000). Ver a sinalizacao no topo do ddl-aprovado: a exposicao de
--     "que nota a empresa X deu" JA EXISTE hoje e e divida propria, com spec propria.
--   - NAO toca `wallets`, `escrow_transactions`, `wallet_transactions`, `shift_payments`, XP nem
--     `completed_jobs_count` (Article 8 intacto). Esconder badge nao desfaz historico.
--   - NAO cria bucket, policy de storage ou signed URL: `companies.logo_url` ja e URL publica do
--     bucket `avatars` (getPublicUrl em CompanyProfile.tsx), servida hoje no feed e em /empresa/:id.
--
-- ORDEM DOS BLOCOS: coluna e tabela ANTES das funcoes. `LANGUAGE sql` valida o corpo no CREATE —
--   funcao antes da tabela quebra a migration inteira (regra do harness, ja paga em e1d7ae8c).
--
-- RECURSAO DE POLICY (42P17): a policy de `worker_company_badge_prefs` referencia APENAS
--   `auth.uid()` — nenhuma subquery em outra tabela. Grafo aciclico por construcao; nenhuma outra
--   policy do schema referencia esta tabela. Nao ha o problema de `shift_calls <-> shift_call_targets`.
--
-- Risk: LOW (uma coluna aditiva com default nao-volatil, uma tabela nova, duas funcoes novas;
--            nenhuma policy existente alterada, nenhuma escrita em dado existente).
-- Backup required before production deploy: NO.
--
-- DOWN (rollback): bloco no fim do arquivo.

-- =============================================
-- 1. CHAVE-MESTRA DO FREELA (DS2)
--    Default `false` = comportamento da tese do produto (historico visivel). O freela desliga com
--    um UPDATE normal — a policy "Workers can update their own profile" (20260309000000:17,
--    USING/WITH CHECK `id = auth.uid()`) ja cobre, sem RPC nova (Article 5).
--    ADD COLUMN com DEFAULT nao-volatil e metadado no PG11+ (sem rewrite da tabela); `workers` e
--    pequena no pre-piloto. Por isso NOT NULL direto e seguro aqui.
-- =============================================
ALTER TABLE public.workers
    ADD COLUMN IF NOT EXISTS badges_hidden boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN public.workers.badges_hidden IS
    'Chave-mestra do freela sobre a secao "Ja trabalhou com" (F12). true = terceiros recebem ZERO '
    'badges em get_worker_company_badges; o proprio freela continua vendo tudo (senao nao consegue '
    'reverter). NAO apaga applications/reviews/XP — e visibilidade, nao desfazimento de historico.';

-- =============================================
-- 2. OPT-OUT POR EMPRESA (bisturi)
--    Linha existe = o freela ja se manifestou sobre AQUELA empresa. `hidden=false` explicito e
--    reexibicao (mantem a trilha em updated_at em vez de apagar a linha).
--    CASCADE: preferencia de exibicao nao e dado financeiro nem de auditoria — o veto do checklist
--    a ON DELETE CASCADE vale para tabela financeira. Apagar o freela deve apagar a preferencia.
-- =============================================
CREATE TABLE IF NOT EXISTS public.worker_company_badge_prefs (
    worker_id  uuid        NOT NULL REFERENCES public.workers(id)   ON DELETE CASCADE,
    company_id uuid        NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
    hidden     boolean     NOT NULL DEFAULT false,
    updated_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (worker_id, company_id)
);

COMMENT ON TABLE public.worker_company_badge_prefs IS
    'Preferencia do freela sobre exibir o badge de UMA empresa especifica (F12). Unica escrita nova '
    'da feature — o badge em si e derivado de applications/jobs/reviews, nunca armazenado. Escrita '
    'SOMENTE via set_worker_badge_visibility (nao ha policy de INSERT/UPDATE/DELETE nesta tabela).';

ALTER TABLE public.worker_company_badge_prefs ENABLE ROW LEVEL SECURITY;

-- SELECT: so o dono da preferencia. Terceiro NUNCA le esta tabela direto — o filtro de "oculto"
-- acontece dentro da RPC SECURITY DEFINER, para nao vazar "existe um badge escondido aqui".
DROP POLICY IF EXISTS "wcbp_select_self" ON public.worker_company_badge_prefs;
CREATE POLICY "wcbp_select_self" ON public.worker_company_badge_prefs
    FOR SELECT TO authenticated
    USING (worker_id = auth.uid());

-- Sem policy de INSERT/UPDATE/DELETE de proposito (padrao de `shift_calls`, 20260817000100):
-- toda transicao de estado passa pela RPC, num lugar auditavel.

-- Grants de TABELA. NAO usar `REVOKE ALL ... FROM PUBLIC` aqui: 20260318000000 documenta que isso
-- derrubou o service_role. Revogamos so de `anon`.
REVOKE ALL ON public.worker_company_badge_prefs FROM anon;
GRANT SELECT ON public.worker_company_badge_prefs TO authenticated;
GRANT ALL    ON public.worker_company_badge_prefs TO service_role;

-- =============================================
-- 3. INDICE DE SUPORTE
--    A RPC varre `applications` por (worker_id, status='completed'). Existe
--    idx_applications_worker_job (worker_id, job_id) desde 20260816120000, mas o predicado parcial
--    e bem mais seletivo (a maioria das applications nunca chega a 'completed').
--    Sem CONCURRENTLY: migrations do Supabase rodam dentro de transacao (CONCURRENTLY e proibido em
--    bloco transacional) e as tabelas sao pequenas no pre-piloto.
--    `reviews` ja tem idx_reviews_reviewed_direction (reviewed_id, direction) — 20260816130000.
--    `jobs` ja tem idx_jobs_company (company_id) — 20260816120000.
-- =============================================
CREATE INDEX IF NOT EXISTS idx_applications_worker_completed
    ON public.applications (worker_id, job_id)
    WHERE status = 'completed';

-- =============================================
-- 4. LEITURA DOS BADGES (derivada)
--
--    SECURITY DEFINER porque a feature EXIGE leitura cruzada: a empresa A precisa saber que o freela
--    concluiu turno na empresa B, e a RLS de `applications` (20260317160000) — corretamente — so
--    deixa cada empresa ver as applications dos PROPRIOS turnos. A DEFINER e o furo estreito:
--      - recebe UM worker_id (nunca lista de ids do caller) => nao e oraculo de enumeracao;
--      - devolve 8 colunas fixas: id/nome/logo da empresa, contagem, data, nota, n de notas, hidden;
--      - NUNCA devolve cpf, phone, pix_key, birth_date, e-mail, valor de turno, titulo de vaga,
--        endereco, CNPJ ou qualquer coluna de `jobs`/`applications` alem da agregacao.
--
--    GUARDA (DS10): mora na WHERE e devolve CONJUNTO VAZIO para quem nao pode ver. Nunca
--    RAISE EXCEPTION — excecao distinguiria "freela nao existe" de "existe mas voce nao pode",
--    que e oraculo de existencia (A3).
--
--    auth.uid() dentro de SECURITY DEFINER funciona: o DEFINER troca o ROLE de execucao, nao as
--    claims do JWT (que vivem em request.jwt.claims). Precedentes: get_profile_reviews,
--    validate_application_update, enforce_shift_payment_immutability.
--
--    Tipos: reviews.reviewer_id / reviewed_id sao TEXT no schema legado (20260314000008) enquanto
--    workers.id / companies.id sao UUID — toda comparacao usa cast explicito para text.
-- =============================================
CREATE OR REPLACE FUNCTION public.get_worker_company_badges(p_worker_id uuid)
RETURNS TABLE (
    company_id       uuid,
    company_name     text,
    company_logo_url text,
    shifts_count     integer,
    last_shift_at    text,
    avg_rating       numeric,
    reviews_count    integer,
    hidden           boolean
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
    WITH allowed AS (
        SELECT
            (p_worker_id = auth.uid()) AS is_self,
            (
                auth.uid() IS NOT NULL
                AND p_worker_id IS NOT NULL
                AND (
                    p_worker_id = auth.uid()
                    OR (
                        public.can_view_worker_profile(p_worker_id)
                        -- Chave-mestra (DS2): ligada, terceiro nao ve nada. O dono ignora.
                        AND NOT EXISTS (
                            SELECT 1 FROM public.workers w
                            WHERE w.id = p_worker_id AND w.badges_hidden
                        )
                    )
                )
            ) AS can_see
    ),
    shifts AS (
        SELECT
            j.company_id      AS cid,
            count(*)::integer AS shifts_count,
            max(j.start_date) AS last_shift_at
        FROM public.applications a
        JOIN public.jobs j ON j.id = a.job_id
        WHERE a.worker_id = p_worker_id
          AND a.status = 'completed'
          AND j.company_id IS NOT NULL
          AND (SELECT al.can_see FROM allowed al)
        GROUP BY j.company_id
    )
    SELECT
        c.id,
        c.name::text,
        c.logo_url::text,
        s.shifts_count,
        -- DS6: ISO 8601 explicito em UTC. `::text` cru devolve "2026-03-12 10:00:00+00",
        -- que o parser de Date do Safari rejeita.
        to_char(s.last_shift_at::timestamptz AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
        rv.avg_rating,
        coalesce(rv.reviews_count, 0)::integer,
        coalesce(p.hidden, false)
    FROM shifts s
    JOIN public.companies c ON c.id = s.cid
    LEFT JOIN LATERAL (
        SELECT
            round(avg(r.rating)::numeric, 1) AS avg_rating,
            count(*)::integer                AS reviews_count
        FROM public.reviews r
        WHERE r.reviewed_id::text = p_worker_id::text
          AND r.direction::text = 'worker'
          -- DS7: ancoragem dupla. A policy de INSERT de reviews grava reviewer_id = auth.uid(),
          -- que e companies.id no caso canonico e owner_id quando o dono e separado. Sem os dois
          -- ramos, a nota some em silencio para as empresas com owner_id distinto.
          AND (
                r.reviewer_id::text = c.id::text
             OR (c.owner_id IS NOT NULL AND r.reviewer_id::text = c.owner_id::text)
          )
    ) rv ON true
    LEFT JOIN public.worker_company_badge_prefs p
           ON p.worker_id = p_worker_id
          AND p.company_id = s.cid
    -- Terceiro nunca recebe linha oculta; o dono recebe TUDO com a flag (DS1 — sem isso, A5
    -- "reexibir" e impossivel: o badge escondido sumiria da propria tela de gerencia).
    WHERE ((SELECT al.is_self FROM allowed al) OR coalesce(p.hidden, false) = false)
    -- DS5: ordem CRONOLOGICA. Proibido ORDER BY avg_rating — ordenar gente por nota e a Opcao B
    -- rejeitada em analytics-operacao/prd.md D4 (score/ranking exige ADR proprio).
    ORDER BY s.last_shift_at DESC NULLS LAST
    LIMIT 100;
$$;

COMMENT ON FUNCTION public.get_worker_company_badges(uuid) IS
    'Badges "ja trabalhou com" de um freela, DERIVADOS de applications.status=completed + jobs + '
    'reviews (nada e materializado). Visivel para o proprio freela ou para quem passa em '
    'can_view_worker_profile (20260816120000) — o portao NAO e alargado por esta funcao. Fora disso '
    'devolve conjunto vazio (nunca excecao: seria oraculo de existencia). Respeita '
    'workers.badges_hidden (global) e worker_company_badge_prefs.hidden (por empresa); o dono ve os '
    'ocultos com hidden=true para poder reexibir. Ordem cronologica — nunca por nota (ver '
    'analytics-operacao/prd.md D4).';

-- =============================================
-- 5. ESCRITA DA PREFERENCIA (unico caminho)
--
--    Nao recebe worker_id: e SEMPRE auth.uid(). Nao ha como um freela escrever a preferencia de
--    outro, nem uma empresa esconder/exibir o badge de alguem.
--
--    DS3 — guarda de elegibilidade: so grava se existir de fato turno concluido entre o chamador e
--    aquela empresa. Sem isso, qualquer freela grava linhas ilimitadas para company_id arbitrario
--    (lixo/abuso de escrita). Retorna boolean para a UI otimista distinguir "gravado" de "ignorado".
-- =============================================
CREATE OR REPLACE FUNCTION public.set_worker_badge_visibility(
    p_company_id uuid,
    p_hidden     boolean
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_uid uuid := auth.uid();
BEGIN
    IF v_uid IS NULL OR p_company_id IS NULL OR p_hidden IS NULL THEN
        RETURN false;
    END IF;

    -- Elegibilidade: existe turno CONCLUIDO deste freela nesta empresa?
    IF NOT EXISTS (
        SELECT 1
        FROM public.applications a
        JOIN public.jobs j ON j.id = a.job_id
        WHERE a.worker_id = v_uid
          AND a.status = 'completed'
          AND j.company_id = p_company_id
    ) THEN
        RETURN false;
    END IF;

    INSERT INTO public.worker_company_badge_prefs (worker_id, company_id, hidden, updated_at)
    VALUES (v_uid, p_company_id, p_hidden, now())
    ON CONFLICT (worker_id, company_id)
    DO UPDATE SET hidden = EXCLUDED.hidden, updated_at = now();

    RETURN true;
END;
$$;

COMMENT ON FUNCTION public.set_worker_badge_visibility(uuid, boolean) IS
    'Liga/desliga o badge de UMA empresa no perfil de quem chama (sempre auth.uid(); nao aceita '
    'worker_id). Devolve false sem gravar quando nao ha turno concluido com aquela empresa. NAO '
    'toca applications/reviews/XP/completed_jobs_count — esconder e exibicao, nao desfazimento.';

-- =============================================
-- 6. GRANTS DE FUNCAO
--    EXECUTE e concedido a PUBLIC por padrao no Postgres — o que exporia as RPCs ao papel `anon`
--    via PostgREST. Revogamos e concedemos explicitamente.
--    NOTA: REVOKE em FUNCAO, nao em TABELA — a licao de 20260318000000 (REVOKE ALL em tabela
--    derrubou o service_role) nao se aplica aqui.
--    Sem GRANT, `.rpc()` do supabase-js falha (PostgREST precisa do privilegio no schema cache).
-- =============================================
REVOKE EXECUTE ON FUNCTION public.get_worker_company_badges(uuid) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.get_worker_company_badges(uuid) FROM anon;
GRANT  EXECUTE ON FUNCTION public.get_worker_company_badges(uuid) TO authenticated, service_role;

REVOKE EXECUTE ON FUNCTION public.set_worker_badge_visibility(uuid, boolean) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.set_worker_badge_visibility(uuid, boolean) FROM anon;
GRANT  EXECUTE ON FUNCTION public.set_worker_badge_visibility(uuid, boolean) TO authenticated, service_role;

-- =============================================
-- DOWN (rollback manual — copiar/colar, nesta ordem):
--   DROP FUNCTION IF EXISTS public.set_worker_badge_visibility(uuid, boolean);
--   DROP FUNCTION IF EXISTS public.get_worker_company_badges(uuid);
--   DROP TABLE    IF EXISTS public.worker_company_badge_prefs;
--   DROP INDEX    IF EXISTS public.idx_applications_worker_completed;
--   ALTER TABLE   public.workers DROP COLUMN IF EXISTS badges_hidden;
--   -- e remover <CompanyBadges> de WorkerPublicProfile.tsx e Profile.tsx.
--   -- Nada a restaurar: a migration nao altera policy existente nem escreve em dado existente.
-- =============================================
```

---

## 4. Como verificar depois de aplicar (obrigatório, read-only)

```sql
-- V1. As duas funcoes existem, sao DEFINER e tem search_path travado.
SELECT p.proname, p.prosecdef, p.proconfig
FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public'
  AND p.proname IN ('get_worker_company_badges', 'set_worker_badge_visibility');
-- Esperado: prosecdef = true e proconfig = {"search_path="} nas DUAS.

-- V2. Grants: authenticated e service_role podem executar; anon NAO.
SELECT p.proname,
       has_function_privilege('authenticated', p.oid, 'EXECUTE') AS auth_ok,
       has_function_privilege('service_role',  p.oid, 'EXECUTE') AS svc_ok,
       has_function_privilege('anon',          p.oid, 'EXECUTE') AS anon_ok
FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public'
  AND p.proname IN ('get_worker_company_badges', 'set_worker_badge_visibility');
-- Esperado: auth_ok = t, svc_ok = t, anon_ok = f.

-- V3. RLS ligada na tabela nova e SO a policy de SELECT existe.
SELECT c.relrowsecurity, pol.polname, pol.polcmd
FROM pg_class c LEFT JOIN pg_policy pol ON pol.polrelid = c.oid
WHERE c.relname = 'worker_company_badge_prefs';
-- Esperado: relrowsecurity = t; exatamente UMA linha de policy, polcmd = 'r' (SELECT).

-- V4. can_view_worker_profile NAO foi alterada (o portao e o mesmo de 20260816120000).
SELECT md5(pg_get_functiondef(p.oid))
FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public' AND p.proname = 'can_view_worker_profile';
-- Esperado: mesmo hash de antes da migration (registrar o valor no PR).

-- V5. Article 8: nenhuma tabela financeira citada nas funcoes novas.
SELECT p.proname
FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public'
  AND p.proname IN ('get_worker_company_badges', 'set_worker_badge_visibility')
  AND pg_get_functiondef(p.oid) ~* '(wallets|escrow_transactions|wallet_transactions|shift_payments)';
-- Esperado: ZERO linhas.

-- V6. Smoke com dado real (rodar como service_role; auth.uid() sera NULL => deve vir vazio).
SELECT count(*) FROM public.get_worker_company_badges(
    (SELECT worker_id FROM public.applications WHERE status = 'completed' LIMIT 1)
);
-- Esperado: 0 — sem sessao, a guarda derruba tudo. Confirma que a DEFINER nao vaza sem JWT.
```

**Teste manual obrigatório no PR (não automatizável sem 2 contas):**
- **A3** — empresa **sem nenhum vínculo** chama a RPC pelo devtools ⇒ `[]`, sem erro.
- **A4/A5** — ocultar e reexibir um badge; confirmar que `completed_jobs_count` e `xp` do freela **não
  mudam** (`SELECT xp, completed_jobs_count FROM workers WHERE id = ...` antes e depois).
- **DS2** — ligar `badges_hidden`: a empresa **com** vínculo passa a receber `[]`; o próprio freela
  continua vendo o grid inteiro.

---

## 5. Entregáveis fora do SQL (parte do mesmo PR)

- **`types/index.ts`** (à mão, Article 2):
  ```ts
  export interface CompanyBadge {
    company_id: string;
    company_name: string;
    company_logo_url?: string | null;
    shifts_count: number;
    /** ISO-8601 UTC (a RPC já formata — ver DS6). */
    last_shift_at: string;
    /** null = a empresa nunca avaliou. NUNCA renderizar como "0 estrelas". */
    avg_rating: number | null;
    reviews_count: number;
    /** Só vem `true` na visão do próprio freela (mode='manage'). */
    hidden: boolean;
  }

  export interface WorkerCompanyBadgePref {
    worker_id: string;
    company_id: string;
    hidden: boolean;
    updated_at: string;
  }
  ```
  E `badges_hidden?: boolean` em `WorkerProfile` (DS2).
- **`components/CompanyBadges.tsx`** — `{ workerId: string; mode: 'view' | 'manage' }`, fetch
  `useState`/`useEffect` (Article 5), modelo em `ProfileReviews.tsx`. Selo neo-brutalista (Article 13),
  `shifts_count` **sempre** na face (DS4), sem nota quando `avg_rating === null`, iniciais em círculo preto
  quando não há logo, alvo de toque ≥44px, clique navega para a rota do perfil público da empresa
  **conforme DS11** (`mode='manage'` → `/empresa/:company_id`; `mode='view'` →
  `/company/empresa/:company_id`) — `stopPropagation` no controle de ocultar.
- **`mode='manage'`** — além do olho por badge, um **switch único "Não exibir onde já trabalhei"**
  (`update workers set badges_hidden` direto, DS2). Ligado, o grid continua visível para o dono, com aviso
  explícito de que ninguém mais o vê.
- **Telas:** `pages/company/WorkerPublicProfile.tsx` (`mode='view'`) e `pages/Profile.tsx` (`mode='manage'`).
- **`App.tsx`** — uma linha nova dentro do bloco `<Route path="/company" element={<CompanyLayout />}>`
  (DS11), reusando o `lazy` de `CompanyPublicProfile` que já existe:
  ```tsx
  <Route path="empresa/:id" element={<CompanyPublicProfile />} />
  ```
- **`ProtectedRoute.tsx`** — **nenhuma** alteração. `workerOnlyPaths` fica intacto.
- **Gate:** `cd frontend && npm run build` + `npm run lint` verdes (Article 3).

---

## 6. O que este gate NÃO autorizou

- **Qualquer alteração em `can_view_worker_profile`, `reviews`, `companies`, `applications` ou `jobs`** —
  policy, corpo de função ou grant. A F12 só consome o que existe.
- **Ordenar badges por nota, campo `score`, "média das médias", ranking de freela** — Opção B de
  `analytics-operacao/prd.md` D4; exige ADR próprio + revisão LGPD (DS5).
- **Materializar badge** em tabela/coluna/matview, ou trigger que mantenha contador (D1).
- **Abrir badges para `anon`** ou para empresa sem vínculo (o teto é `can_view_worker_profile`).
- **Bucket, policy de `storage.objects` ou signed URL** para a logo — a URL já é pública (D5).
- **Badge customizável pela empresa, medalha por categoria, cruzamento com XP/gamificação** — out-of-scope
  da spec, e é a fronteira com a anti-vision "NÃO é rede social" (D7).
- **Notificar a empresa** quando um freela oculta o badge dela — decisão unilateral do freela sobre o
  próprio perfil, silenciosa por desenho.
- **Alterar `workerOnlyPaths` em `ProtectedRoute.tsx`, abrir `/empresa` para `user_type='hire'` ou
  mexer no isolamento worker⇎empresa de qualquer forma** — recusado no adendo DS11 (§2.1); o caminho
  autorizado é a rota-espelho `/company/empresa/:id`, aditiva.
- **Fork/cópia de `CompanyPublicProfile`** para uma versão company-side, ou prop nova de papel dentro
  dele — a rota-espelho reusa o componente **como está** (DS11).
- **Corrigir a exposição de `reviews` (`USING (true)`)** — dívida real, sinalizada no topo, spec própria.
