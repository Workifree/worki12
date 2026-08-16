# ADR-20260816 — SELECT em `workers` restrito por vínculo (fecha varredura de CPF/PIX)

## Status
ACEITO

## Contexto

Gate de arquitetura aberto pelo `harness-builder` na Onda 1 do spec `.harness/spec/revisao-piloto/spec.md`
(branch `feat/revisao-piloto`), dias antes do piloto com cliente real.

**Achado confirmado.** A policy de SELECT de `workers` é permissiva total:

```sql
-- 20260309000000_enable_rls_all_tables.sql (e reafirmada em 20260317140100)
CREATE POLICY "Authenticated users can view worker profiles" ON workers
    FOR SELECT TO authenticated USING (true);
```

RLS no Postgres é **row-level, não column-level**: `USING (true)` libera **todas as colunas** da linha.
Colunas sensíveis confirmadas em `workers` (evidência: `WorkerOnboarding.tsx:191-193` grava `cpf` e
`birth_date`; `delete-account/index.ts:133-142` anonimiza `full_name, phone, cpf, bio, pix_key, avatar_url,
city`; `DepositModal.tsx:51` lê `cpf`):

| Coluna | Natureza | Quem lê hoje |
|---|---|---|
| `cpf` | Dado pessoal (identificador nacional) | só o próprio freela (`DepositModal`) |
| `birth_date` | Dado pessoal | ninguém lê (só grava no onboarding) |
| `phone` | Dado pessoal / contato | empresa (R1: `WorkerPublicProfile`, `CompanyTeam`) |
| `pix_key` | **Dado de pagamento** | empresa (R1: `WorkerPublicProfile`, `CompanyTeam`, modais de `CompanyJobCandidates`) |

**Exposição exata (antes desta ADR):** qualquer sessão `authenticated` — worker OU company, com ou sem
qualquer vínculo, incluindo uma conta criada em 30 segundos — podia executar
`GET /rest/v1/workers?select=*` e **paginar a base inteira de freelas com CPF, data de nascimento,
telefone e chave PIX**. Não havia rate limit nem filtro de relação. Nenhum grant a `anon`, então o
raio é "qualquer conta", não "internet aberta" — o que reduz de catastrófico para grave, não elimina.

O problema é **anterior** à Onda 1, mas a R1 **agravou o impacto prático**: `pix_key` deixou de ser um
campo dormente e virou o dado central do modo A (pagamento externo registrado) — coletado no onboarding
do freela e exibido/copiado na UI da empresa. Piloto com cliente real + LGPD (dado pessoal e dado de
pagamento) torna isso bloqueante.

## Decisão

**Opção (a): escopo por relação na policy de SELECT**, implementada via função `SECURITY DEFINER`.

Migration `supabase/migrations/20260816120000_workers_select_by_relationship.sql`:

1. `DROP` da policy `USING (true)` (e dos nomes históricos alternativos — policies permissivas são
   OR'd, deixar a antiga viva anularia a nova).
2. Nova policy: `USING (public.can_view_worker_profile(id))`.
3. `can_view_worker_profile(uuid) → boolean`, `STABLE`, `SECURITY DEFINER`, `SET search_path = ''`,
   `GRANT EXECUTE TO authenticated, service_role`. Concede leitura quando:
   - **(0)** `p_worker_id = auth.uid()` — o próprio freela lê a própria linha;
   - **(1)** existe `team_connections` entre o caller-empresa e o freela com
     `status IN ('pending','accepted')`;
   - **(2)** existe `applications` do freela em um `jobs` da empresa caller (cobre pull *e* push, sem
     filtro de status, para preservar recibo/relatório/BI de turnos passados).
4. Índices de suporte `idx_applications_worker_job` e `idx_jobs_company`.
5. `REVOKE ALL ... FROM anon` + reafirmação de `GRANT ALL ... TO service_role`.

**`blocked` não concede leitura.** `team_connections.status = 'blocked'` é o veto explícito do freela
(ADR-20260816-veto-freela-imutavel-delete): quem saiu da loja para de expor `phone`/`pix_key` para ela.
A UI não quebra — `useTeamConnections` só renderiza `accepted` (`listTeamMembers`) e `pending`
(filtro explícito em `useTeamConnections.ts:69`).

**Função em vez de subquery inline:** subquery dentro de policy é avaliada sob a RLS das tabelas
referenciadas, o que acopla esta policy às policies de `team_connections`/`applications`/`jobs`/
`companies`, cria risco de recursão futura e é mais lenta. A função DEFINER isola a decisão e devolve
apenas um boolean. Mesmo padrão de `accept_company_invite_by_token` (ADR-20260702).

**Article 8 intacto:** nenhuma tabela ou RPC financeira tocada.

### Não-objetivo declarado (fica para a Fase 2)

Uma empresa **com vínculo** continua tecnicamente capaz de ler `cpf` e `birth_date` do freela, embora
nenhuma tela leia esses campos. Isso é minimização de dados pendente, **não** é a varredura em massa.
Ver "Gatilhos de reabertura".

## Consequências

### Positivas
- Fecha o vetor real e catastrófico: **não existe mais superfície de varredura em massa**. Sem relação,
  não há linha. Para ler um freela é preciso um vínculo que deixa rastro auditável no banco.
- Fluxo central do piloto preservado: empresa lê `pix_key` do freela do elenco dela (branch 1) e do
  freela do turno dela (branch 2). Modo A não muda.
- Custo de frontend quase zero: `id = auth.uid()` mantém todos os `select('*')` do próprio freela
  funcionando (`Dashboard.tsx:50`, `Profile`, `Sidebar`, `MainLayout`, `ProtectedRoute`,
  `DepositModal`, `WorkerOnboarding`). Só **um** ponto quebra (ver abaixo).
- Reversível em 1 comando (`DROP POLICY` + recriar `USING (true)`), sem migração de dados, sem backup.
- Fecha também o vazamento worker→worker: um freela deixa de ler o perfil de outro freela.

### Negativas / Trade-offs
- **Quebra 1 caminho:** `teamConnectionService.addWorkerToTeamByToken` (empresa abre o link `w_<id>` do
  freela) faz um pré-check `from('workers').select('id').eq('id', workerId)` **antes** de existir
  vínculo → passa a devolver `null` → erro "Freela do link não encontrado.". Remédio no frontend
  (abaixo): remover o pré-check e deixar a FK `team_connections.worker_id → workers.id` validar a
  existência no INSERT. **Sem esse ajuste, o canal 'link' empresa→freela fica quebrado.**
- **`pending` é auto-concedível pela empresa.** `tc_insert_company` permite a uma empresa inserir
  conexão `pending` para qualquer `worker_id` que ela **já conheça**. Logo, quem conhece o UUID de um
  freela pode se auto-conceder leitura. Aceito porque: (i) não existe endpoint que liste UUIDs de
  freelas depois desta migration — o ataque exige o UUID de cada alvo, um a um, sem enumeração;
  (ii) `pending` é necessário pelo produto (empresa adiciona por Worki ID e precisa ver o nome antes
  do aceite); (iii) deixa rastro em `team_connections`. É um downgrade de "varredura total" para
  "acesso pontual a alvo já conhecido".
- Custo de plano: a policy chama uma função por linha candidata. Irrelevante nos volumes do piloto,
  mitigado pelos índices; vira item de observação se `workers` crescer com queries `.in('id', [...])`
  largas.
- `cpf`/`birth_date` seguem legíveis por empresa vinculada (minimização pendente).

## Alternativas rejeitadas

- **(b) Column-level GRANT (`REVOKE SELECT (cpf, pix_key, birth_date)` + `GRANT SELECT (cols)`).**
  Rejeitada: privilégio de coluna é **por papel, não por linha** — revogar de `authenticated` bloquearia
  também **o próprio freela** lendo o próprio CPF/PIX (`DepositModal.tsx:51`, `Profile.tsx:179`,
  `Dashboard.tsx:50`). Além disso, `SELECT *` sob coluna revogada **falha com permission denied** em vez
  de omitir a coluna, quebrando `Dashboard.tsx:50` (`select('*')`) e
  `CompanyJobCandidates.tsx:140` (`worker:workers(*)`). Exigiria RPCs de auto-leitura + refactor de
  call sites. Custo alto, e **não resolve** o problema principal (a varredura), só a coluna.
- **(b') View `workers_public` + renomear a tabela base.** Permitiria mascarar coluna por linha
  (`CASE WHEN ... THEN cpf END`), mas é cirurgia na tabela central: quebra os embeds PostgREST
  (`worker:workers(...)` em 6 services/páginas), os writes de onboarding, os alvos de FK
  (`team_connections`, `applications`) e os triggers. Risco desproporcional a dias do piloto.
- **(b'') Tabela `worker_private_data` (cpf/birth_date) com RLS `id = auth.uid()`.** É o desenho
  **correto** de longo prazo e resolve a minimização — mas exige migração de dados + backfill + drop de
  colunas + alterações em `WorkerOnboarding`, `DepositModal` e `delete-account`. Fora do escopo
  pré-piloto; promovido a gatilho de reabertura.
- **Manter `USING (true)` e mascarar na UI.** Rejeitada: viola Article 4 ("RLS é a primeira linha de
  defesa; filtro no client é só UX"). O dado sai do banco pela rede de qualquer forma.
- **Exigir `status = 'accepted'` (sem `pending`).** Mais restritiva, mas quebra o card "Aguardando
  Aceite" de `CompanyTeam` e o fluxo de adicionar-por-Worki-ID. Ganho marginal (ver trade-off acima).

## Gatilhos de reabertura

1. **Minimização de `cpf`/`birth_date`** — abrir logo após o piloto estabilizar (ou imediatamente se o
   cliente/jurídico questionar): mover para `worker_private_data` com RLS `id = auth.uid()` +
   `service_role`, e dropar as colunas de `workers`. Nova ADR.
2. **Se o auto-concedimento via `pending` for explorado** (spam de `team_connections` para ler perfis):
   restringir a branch 1 a `accepted` e mover o "adicionar por Worki ID" para uma RPC `SECURITY DEFINER`
   que devolve só `{id, full_name, avatar_url}` do alvo.
3. **Se `workers` crescer e a policy pesar** (queries `.in('id', [...])` largas em BI/relatório):
   trocar a função por uma tabela materializada de visibilidade ou mover essas leituras para Edge
   Function com `service_role`.
4. **Se surgir descoberta/marketplace de freelas** (contradiz o pivô empresa-primeiro): a policy passa a
   bloquear o produto → exigirá separar perfil público (nome/avatar/rating) de perfil privado
   (phone/pix/cpf) de verdade, provavelmente via gatilho 1 + view pública.

---

## Adendo 2026-08-16 — autoria de avaliações (segundo ponto de quebra)

**Status do adendo:** ACEITO. Não reabre a decisão da policy — complementa o caminho de leitura.

### O que o evaluator achou

A ADR original previu **um** ponto de quebra no frontend (`addWorkerToTeamByToken`). Existe um **segundo**,
criado pela própria Onda 1: `components/ProfileReviews.tsx:66-69` resolve o nome do avaliador com uma
segunda query direta (`from('workers').select('id, full_name').in('id', reviewerIds)`). Na página nova
`pages/CompanyPublicProfile.tsx:198` (R2), `reviewerRole="worker"` + espectador freela ⇒ sob
`workers_select_self_or_related` o `.in(...)` volta vazio e o componente cai no fallback de
`ProfileReviews.tsx:78`: **toda avaliação passa a ser assinada "Freela"**. Nota e comentário continuam
visíveis (`reviews` é `USING (true)`), então **degrada em silêncio** — sem erro, sem log, e os testes
seguem verdes porque mockam o supabase. Confirmado. A R2 existe para dar prova social ao freela antes do
aceite; uma lista de "Freela, Freela, Freela" não é prova social.

**Escopo verificado (não é mais amplo do que isso):**

| Call site | reviewerRole | Tabela de nome | Espectador | Veredito |
|---|---|---|---|---|
| `pages/Profile.tsx:797` | `company` | `companies` (`USING (true)`) | freela (dono) | OK |
| `pages/company/CompanyProfile.tsx:649` | `worker` | `workers` | empresa (dona) | OK — todo review de freela nasce de um turno ⇒ existe `applications` ⇒ branch (2) de `can_view_worker_profile` concede |
| `pages/CompanyPublicProfile.tsx:198` | `worker` | `workers` | **freela terceiro** | **QUEBRADO** |
| `pages/company/WorkerPublicProfile.tsx:125` | — (query própria) | `companies` | empresa | OK — policy de `companies` segue `USING (true)` (`20260317160000:23`) |
| `services/orderReportService.ts:290`, `services/financialBIService.ts:372` | — | `workers` `.in('id',…)` | empresa | OK — só workers com `applications` em turnos da própria empresa |

### Decisão do adendo

**Opção (a) refinada — RPC `SECURITY DEFINER` de leitura**, em
`supabase/migrations/20260816130000_profile_reviews_reader.sql`:

`get_profile_reviews(p_reviewed_id text, p_direction text)` devolve as avaliações **já com o nome de
exibição do avaliador**. Duas propriedades desenhadas de propósito:

1. **Não é oráculo de enumeração.** A RPC **não recebe lista de ids**. Recebe o *perfil avaliado* e deriva
   os avaliadores da própria `reviews` — tabela que já é legível por qualquer autenticado
   (`20260309000000:109`). O único dado novo que sai é o nome de quem, comprovadamente, avaliou aquele
   perfil. Não há como alimentar UUIDs escolhidos pelo atacante.
2. **Minimização do nome de pessoa física.** Avaliador empresa → `companies.name` inteiro (nome comercial).
   Avaliador freela → **mascarado** (`"Carlos S."`, via `mask_display_name`) para terceiros; **completo**
   apenas quando quem chama é o dono do perfil avaliado — o que preserva 1:1 o que `Profile.tsx` e
   `CompanyProfile.tsx` já mostravam. Conta anonimizada (`full_name = '[Conta Deletada]'`) → `NULL` →
   rótulo genérico na UI.

`REVOKE EXECUTE … FROM PUBLIC, anon` + `GRANT EXECUTE … TO authenticated, service_role`. `search_path = ''`.
Índice `idx_reviews_reviewed_direction`. Nenhuma policy alterada. **Article 8 intacto** (nenhuma tabela ou
RPC financeira; a RPC é read-only).

### Consequências do adendo

**Positivas**
- R2 volta a entregar prova social real, com autoria.
- `ProfileReviews` passa de 2 queries para 1 chamada, e deixa de depender da RLS de `workers`/`companies`
  para renderizar autoria — some a classe inteira de "degrada em silêncio quando a policy aperta".
- Nome lido **ao vivo** de `workers`: troca de nome e anonimização LGPD propagam retroativamente.
- Prova social fica mais defensável do que era: mesmo antes desta ADR, o perfil público exibiria o nome
  completo do freela; agora exibe `"Carlos S."`.

**Negativas / Trade-offs**
- Vaza, para qualquer autenticado que conheça o id de uma empresa, a lista de **nomes mascarados** dos
  freelas que a avaliaram. Aceito: `reviews` já expõe a existência e o teor dessas avaliações; o delta é o
  nome mascarado, que é exatamente o produto pedido pela R2.
- `CompanyProfile.tsx` (self-view) continua com nome completo — mas agora por decisão explícita da RPC, não
  por acidente da policy.
- Mais uma função `SECURITY DEFINER` para auditar. Mitigado: read-only, colunas de saída fixas e estreitas
  (sem `phone`/`pix_key`/`cpf`/`birth_date`/`avatar`).
- `reviews` continua `USING (true)` — não é objetivo deste adendo apertá-la (ver gatilho 6).

### Alternativas rejeitadas no adendo

- **(a-ingênua) RPC que recebe `reviewer_id[]` e devolve `{id, display_name}`.** É literalmente um oráculo:
  quem chamar com UUIDs arbitrários descobre nomes, reabrindo a enumeração que a ADR fechou. A única
  mitigação séria seria exigir que os ids fossem de fato reviewers de um `reviewed_id` informado — que é
  o desenho escolhido, só que sem a lista de ids (redundante e mais fácil de errar).
- **(b) Desnormalizar `reviewer_name` em `reviews` no INSERT + backfill.** Rejeitada por **LGPD**: o nome
  ficaria congelado numa tabela que o `delete-account` **não limpa**
  (`supabase/functions/delete-account/index.ts:130-143` anonimiza `workers.full_name` para
  `'[Conta Deletada]'`, e nada mais). O direito à anonimização passaria a ser derrotado por uma cópia
  imutável e mundialmente legível — regressão de privacidade pior que o bug que resolve. Além disso:
  troca de nome não propaga; exigiria backfill + trigger + uma nova varredura no `delete-account`; e a
  coluna herdaria `USING (true)`, expondo nome completo a qualquer autenticado (pior que a RPC mascarada).
- **(c) Esconder a seção de avaliações em `CompanyPublicProfile`.** É a mitigação honesta de contingência
  (melhor esconder do que mentir "Freela, Freela, Freela"), e continua sendo o plano B se a migration não
  puder ser aplicada antes do piloto. Rejeitada como solução porque a prova social **é** a R2.
- **(d) Afrouxar `can_view_worker_profile` para "quem tem review em comum".** Rejeitada: devolveria a
  linha inteira de `workers` (com `phone`, `pix_key`, `cpf`) para um caso que só precisa de um nome.
  Trocaria um bug de UI por um buraco de dado.

### Gatilho de reabertura adicional

6. **Se `reviews` precisar deixar de ser `USING (true)`** (ex.: moderação, review privada, ou se o teor de
   avaliações virar dado sensível): a RPC já é o ponto único de leitura de `ProfileReviews`, então basta
   apertar a policy e ajustar a `WHERE` da RPC — sem tocar em frontend.

---

## Referências
- Migration (adendo): `supabase/migrations/20260816130000_profile_reviews_reader.sql`
- Migration: `supabase/migrations/20260816120000_workers_select_by_relationship.sql`
- Policy original: `supabase/migrations/20260309000000_enable_rls_all_tables.sql`,
  `supabase/migrations/20260317140100_ensure_workers_select_policy.sql`
- Lição de `service_role`/FORCE RLS: `supabase/migrations/20260318000000_fix_force_rls_service_role.sql`
- Spec: `.harness/spec/revisao-piloto/spec.md` (R1 — chave PIX no fluxo do piloto)
- ADRs relacionados: `ADR-20260702-worker-join-by-invite-token.md` (padrão RPC SECURITY DEFINER),
  `ADR-20260816-veto-freela-imutavel-delete.md` (semântica de `blocked`),
  `ADR-20260630-pagamento-opcional-piloto.md` (modo A / por que `pix_key` virou central)
- Constitution: Article 4 (RLS primeira linha), Article 8 (saldo intacto — não tocado), Article 10
