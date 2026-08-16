# ADR-20260816 — RLS desligada em `jobs` e `Conversation`: ligar em fases, sem apertar SELECT

## Status
ACEITO (Fase 1 e 2 aprovadas para aplicação pré-piloto; Fase 3 e 4 são pós-piloto)

## Contexto

Gate de arquitetura aberto pelo owner no branch `feat/revisao-piloto`, **depois** de aplicar em produção
(`vrklakcbkcsonarmhqhp`) a leva documentada em `supabase/migrations/APLICACAO-2026-08-16.md` — entre
elas a `20260816120000_workers_select_by_relationship.sql`, que restringiu SELECT em `workers` por
vínculo (ADR-20260816-workers-select-por-vinculo).

O advisor de segurança do Supabase, rodado após a aplicação, expôs um buraco **pré-existente**
(anterior a toda a revisão pré-piloto) que anula parte daquela trava.

### Evidência de produção (consulta direta, `pg_class` + `has_table_privilege`)

| Tabela | `relrowsecurity` | policies | authenticated | anon |
|---|---|---|---|---|
| `public.jobs` | **false** | 2 | SELECT, **UPDATE, DELETE** | — |
| `public."Conversation"` | **false** | 1 | SELECT, UPDATE, DELETE | **SELECT** |
| `public."FreelancerReview"` | false | 0 | SELECT, UPDATE, DELETE | **SELECT** |
| `public."ClientReview"` | false | 0 | SELECT, UPDATE, DELETE | **SELECT** |
| `public."_FreelancerProfileToSkill"` | false | 0 | — | — |
| `public."_JobToSkill"` | false | 0 | — | — |

Corretas (contraste): `workers`, `companies`, `applications`, `team_connections`, `shift_payments`,
`reviews`, `notifications`. Advisor: `ERROR policy_exists_rls_disabled` (jobs, Conversation) e
`ERROR rls_disabled_in_public` (as seis).

### Causa raiz (reconstruída do repositório — resolve o "como isso passou")

`20260309000000_enable_rls_all_tables.sql` é o **único** lugar do repositório que executa
`ALTER TABLE ... ENABLE ROW LEVEL SECURITY` em `jobs`, `Conversation`, `reviews`, `job_categories` e
`analytics_events`. Ele **não produziu efeito em produção**. Prova por contagem de policies:

- Aquele arquivo cria **4** policies em `jobs` (`Authenticated users can view jobs`,
  `Companies can create/update/delete their own jobs`). Nenhum arquivo posterior dropa esses nomes —
  `20260317160000` dropa outros três (`Anyone can view open jobs`, `Authenticated can view jobs`,
  `Company owner can manage jobs`). Se ele tivesse rodado, produção teria **6** policies em `jobs`.
  Tem **2**, e são exatamente as de `20260317160000`.
- Mesma lógica em `Conversation`: aquele arquivo cria 2 policies (SELECT + INSERT). Produção tem **1**,
  que é a de `20260317012800` (UPDATE).

Depois disso, duas migrations passaram raspando sem corrigir:
- `20260317150000` rodou `ALTER TABLE jobs FORCE ROW LEVEL SECURITY` — **`FORCE` sem `ENABLE` é no-op**;
- `20260318000000` rodou `ALTER TABLE jobs NO FORCE ROW LEVEL SECURITY` — desfez o no-op.

`workers` e `reviews` estão com RLS ligada apesar de o `ENABLE` delas viver só naquele mesmo arquivo ⇒
alguém ligou **à mão pelo dashboard**, tabela por tabela, e esqueceu `jobs` e `Conversation`.

**Lição de processo (a mais cara desta ADR):** o repositório de migrations **não** é a fonte da verdade
do estado de produção. Só o catálogo é. Toda revisão de segurança daqui em diante começa pelo censo
(`pg_class` + `pg_policies` + `has_table_privilege`), nunca por `grep` nas migrations.

### Ponto 1 — CONFIRMADO: as 2 policies de `jobs` não valem nada

No PostgreSQL, policies só são consultadas quando a RLS está **habilitada** na relação
(`relrowsecurity`). `relforcerowsecurity` sozinho não habilita nada — ele só estende a RLS já
habilitada ao dono da tabela. Com `relrowsecurity = false` e `GRANT UPDATE, DELETE` para
`authenticated`, **qualquer conta autenticada pode `UPDATE` ou `DELETE` qualquer turno de qualquer
empresa**. As duas policies em `pg_policies` são decoração.

### Ponto 2 — CONFIRMADO, e é mais largo do que o relatado

O caminho descrito pelo owner existe: `can_view_worker_profile` (20260816120000, §2 branch 2) concede
leitura da linha de `workers` — que carrega `cpf`, `birth_date`, `phone`, `pix_key` — quando existe
`applications` do freela em um `jobs` cujo `company_id` é o requisitante. Quem escreve
`UPDATE jobs SET company_id = <meu uid>` se auto-concede essa leitura. **A trava de 16/08 tem porta
lateral.**

Três agravantes que não estavam no diagnóstico original:

1. **Não é um freela por vez.** `jobs` é 100% legível hoje (`USING (true)`, e de todo modo sem RLS),
   então os ids são enumeráveis; e `PATCH /rest/v1/jobs` sem filtro atinge a base inteira. Um único
   request converte o atacante em "dono" de **todos** os turnos ⇒ leitura do CPF/PIX de **todo freela
   que tenha qualquer `application`**. O raio é a base inteira, não um turno.

2. **`jobs.company_id` é âncora de autorização de cinco caminhos, não um.** Auto-promover-se a dono do
   turno destrava, além do perfil do freela:
   - `applications` SELECT — `"Companies can view applications for their jobs"` (20260317160000:72);
   - `applications` UPDATE — `"Companies can update their job application fields"` (20260311100000:21)
     **e** `validate_application_update()` (20260311100000:45), que decide `v_is_company` por
     `EXISTS(SELECT 1 FROM jobs WHERE id = NEW.job_id AND company_id = auth.uid())` ⇒ o atacante
     confirma check-in/check-out e conclui turno alheio;
   - `"Conversation"` / `"Message"` — policies ancoradas em `jobs.company_id`
     (20260309000000:141, 20260317012423:28);
   - `reserve_escrow()` (20260311100000:218) valida a posse do turno pelo mesmo campo.

3. **Vandalismo direto.** `DELETE FROM jobs` sem filtro apaga a operação da plataforma. Mitigação
   parcial e acidental: `shift_payments.job_id → jobs(id) ON DELETE RESTRICT` (20260630000000:74)
   protege turnos com marcador de pagamento; todo o resto cai.

**Article 8 — veredito: INTACTO, mas com uma aresta.** Não há caminho para roubar dinheiro em escrow:
`release_escrow` e `refund_escrow` (20260311100000:169-178) validam o chamador contra
`escrow_transactions.company_wallet_id`, que é imutável e **não** derivado de `jobs`. Re-titular o
turno não move a carteira. A aresta real: `jobs.budget` é gravável por terceiros e é o **valor** que
`auto_reserve_escrow_on_hire()` (20260622000900:44-59) passa a `reserve_escrow` no fluxo **pull**
legado. Um atacante infla o `budget` de um turno alheio; a próxima contratação por candidatura debita
o valor inflado da carteira da empresa vítima para escrow. Não é furto (o dinheiro volta por refund ou
vai para o freela que a própria empresa contratou), mas é **movimento de saldo dirigido por input não
confiável** — exatamente o que o Article 8 existe para impedir. Exposição atenuada no piloto: o modo A
(default) não reserva, e o fluxo push pula a reserva por ADR-20260622.

### Ponto 3 — CONFIRMADO para `Conversation`; `Message` precisa de leitura antes de conclusão

`Conversation` com RLS off + `GRANT SELECT` para `anon` significa que **qualquer pessoa, sem conta**,
lista o índice de conversas com a anon key (que é pública por desenho). O dado exposto é metadata
(`id`, `application_uuid`, `createdat`, `islocked`) — não há nome nem texto na tabela — mas é
vazamento pré-autenticação e permite inferir volume de operação e ligar conversas a candidaturas.

A afirmação do `harness-security-reviewer` de que "a defesa real está no RLS" estava **factualmente
errada** para esta tabela, e o código depende dela: `pages/Messages.tsx:93` e
`pages/company/CompanyMessages.tsx:71` fazem `.from('Conversation').select(...)` **sem `.eq()`** —
buscam tudo e filtram em JS (`Messages.tsx:144`, `CompanyMessages.tsx:123`). Article 4 diz que filtro
no client é UX; aqui ele era a única barreira, e para `anon` nem isso.

**`Message`: não determinável pelo repositório.** O histórico é deliberadamente contraditório —
`20260314000001` ENABLE → `20260314000003` **DISABLE** ("temporarily") → `20260314000006` ENABLE →
`20260317012423` ENABLE. Como já sabemos que o repositório não reflete produção, o estado real precisa
ser lido no catálogo **antes** de fechar o parecer. Se `Message` estiver como `Conversation`, o
**conteúdo** das mensagens (coluna `content`) está aberto a `anon` e este vira o achado mais grave da
página. A query está no cabeçalho de `20260816210100`. A migration fecha os dois cenários de forma
idempotente.

Achado adicional independente do estado: **não existe policy de UPDATE para `Message` em lugar nenhum
do repositório**, e `Messages.tsx:56` / `CompanyMessages.tsx:183` fazem UPDATE de `read_at` (recibo de
leitura). Ligar RLS em `Message` sem criar essa policy quebraria o recibo de leitura **em silêncio**
(PostgREST devolve 0 linhas, sem erro).

### Tabelas legadas

`FreelancerReview`, `ClientReview`, `_FreelancerProfileToSkill`, `_JobToSkill` (+ `User`, documentada
como vazia em 20260319000000) são resquício do schema Prisma. `grep -rni` em `frontend/src`,
`supabase/functions` e `supabase/migrations` → **zero ocorrências**. As avaliações vivas estão em
`public.reviews`. As duas de review têm `SELECT` para `anon`.

## Decisão

**Ligar RLS em fases, e na Fase 1 NÃO apertar o SELECT de `jobs`.**

### Fase 1 (pré-piloto) — `20260816210000_enable_rls_jobs.sql`
`ENABLE ROW LEVEL SECURITY` em `jobs`, com quatro policies explícitas, uma por comando:
`SELECT` permanece `USING (true) TO authenticated` (**idêntico bit a bit ao comportamento de hoje**);
`INSERT`/`UPDATE`/`DELETE` restritos à empresa dona com **ancoragem dupla**
(`company_id = auth.uid()` OR `company_id IN (SELECT id FROM companies WHERE owner_id = auth.uid())`).
As duas policies legadas são substituídas. Sem `FORCE`. Grants reafirmados; `anon` revogado.

### Fase 2 (pré-piloto) — `20260816210100` e `20260816210200`
- `Conversation` + `Message`: RLS ligada, `anon` revogado, policies via duas funções
  `SECURITY DEFINER` (`can_access_application`, `can_access_conversation`), policy de UPDATE de
  `read_at` para o destinatário + trigger `enforce_message_update_read_only` (RLS é row-level; sem o
  trigger o destinatário poderia reescrever `content`).
- Legadas: `ENABLE RLS` com **zero policy** (deny-all) + `REVOKE ALL` de `anon` e `authenticated`,
  `service_role` mantido. **Não dropar agora.**
- `20260816210300` (analytics/job_categories) é **condicional**: aplicar só se o censo mostrar RLS off.

### Fase 3 (pós-piloto) — apertar SELECT de `jobs`
Trocar `USING (true)` por "empresa dona OR freela com `application` no turno", provavelmente via
função `SECURITY DEFINER` `can_view_job(uuid)`.

### Fase 4 (pós-piloto) — dropar as legadas e reconciliar migrations ↔ produção

## Consequências

### Positivas
- Fecha o vetor real (escrita em `jobs`) com **zero mudança de leitura** — nenhuma tela pode quebrar
  por falta de linha na Fase 1.
- Fecha a porta lateral de `can_view_worker_profile`: a trava de 16/08 volta a valer integralmente.
- Fecha o vazamento pré-autenticação de `Conversation` (e de `Message`, se confirmado).
- Remove a dependência de `jobs.company_id` como campo gravável por terceiros — o que também protege
  `applications`, `Conversation`, `Message`, `validate_application_update` e `reserve_escrow`.
- Substitui o filtro em JS por defesa de banco na mensageria (Article 4 volta a ser verdade).
- Deixa o `budget` do turno fora do alcance de terceiros ⇒ fecha a aresta do Article 8.

### Negativas / Trade-offs
- **`jobs` continua legível por qualquer autenticado** após a Fase 1. É uma decisão consciente: o dano
  é baixo (título, local, data, `budget` — sem dado pessoal), e apertar agora mudaria em silêncio a
  semântica de **toda** policy que faz subquery em `jobs` (`applications`, `Conversation`, `Message`),
  porque subquery dentro de policy é avaliada **sob a RLS da tabela referenciada**. Trocar um buraco
  conhecido por quatro regressões desconhecidas a dias do piloto é mau negócio. Vai para a Fase 3.
- Duas funções `SECURITY DEFINER` novas para auditar (`can_access_application`,
  `can_access_conversation`). Mitigado: read-only, retornam só `boolean`, `search_path = ''`, sem
  `EXECUTE` para `anon`.
- Custo de plano: as policies de chat chamam função por linha. Irrelevante nos volumes do piloto
  (13 applications, 4 pagamentos, 8 avaliações em 16/08); vira item de observação se o chat crescer.
- Realtime da mensageria passa a **respeitar RLS** — o assinante precisa satisfazer a policy de SELECT.
  Participantes satisfazem, mas isso **não é provável por SQL**: exige teste manual do chat (P5 no
  cabeçalho da migration). É o único ponto do plano que depende de verificação humana.
- Um trigger novo em `Message` (BEFORE UPDATE) no caminho de recibo de leitura.
- Tabelas legadas continuam existindo (dado preservado, acesso zerado) até a Fase 4.

## Alternativas rejeitadas

- **Ligar RLS em `jobs` mantendo as 2 policies legadas.** Rejeitada: `"Company owner can manage jobs"`
  é `FOR ALL` ancorada **só** em `companies.owner_id = auth.uid()`. Se algum registro tiver `owner_id`
  NULL — bug histórico real, corrigido por `20260318100000`, cujo backfill pode não ter rodado em
  produção **pelo mesmo motivo da 20260309000000** — a empresa perderia o controle dos próprios
  turnos no instante em que a RLS ligasse. Exatamente o cenário "ligar RLS quebra o produto". A
  ancoragem dupla é superconjunto estrito e imune a esse estado.
- **Ligar RLS e apertar SELECT de `jobs` no mesmo passo.** Rejeitada: ver trade-off acima. Um passo,
  uma variável.
- **Só revogar `UPDATE`/`DELETE` de `authenticated` em `jobs` (sem ligar RLS).** Tentador: fecha o
  vetor em uma linha e não pode quebrar leitura. Rejeitada porque **quebra o produto na hora** —
  `CompanyCreateJob.tsx`, `CompanyJobDetails.tsx` e `CompanyJobs.tsx` editam, pausam e arquivam turnos
  por `.update()` direto; sem `GRANT UPDATE` a empresa perde a gestão dos próprios turnos. Migraria a
  gestão de turnos para Edge Function — refactor grande, fora do escopo pré-piloto.
- **Dropar agora as tabelas legadas.** Rejeitada: `DROP` é irreversível e o risco de leitura já é
  zerado pelo `REVOKE` + deny-all. Não se troca risco de exposição (resolvido) por risco de perda de
  dado a dias do piloto. Fase 4, depois de conferir contagem e exportar.
- **Policy inline em `Conversation`/`Message` (sem função DEFINER).** Rejeitada: a policy legada de
  `Message` faz `FROM "Conversation" JOIN applications JOIN jobs` inline. Ao ligar RLS em
  `Conversation`, essa policy passaria a depender da policy de `Conversation` → da de `applications` →
  da de `jobs`: três níveis de acoplamento silencioso, e uma bomba-relógio para a Fase 3. A função
  DEFINER corta a cadeia.
- **Não aplicar nada antes do piloto.** Rejeitada — ver "Ir / não ir" abaixo.

## Ir / não ir antes do piloto

**IR**, nesta ordem, uma por vez, com verificação entre cada uma:
`20260816210000` (jobs) → `20260816210100` (chat) → `20260816210200` (legadas) →
`20260816210300` **só se o censo pedir**.

Razão: o risco de **aplicar** a Fase 1 é estruturalmente baixo (leitura inalterada; escrita restrita
ao dono com ancoragem dupla; rollback em um comando: `ALTER TABLE public.jobs DISABLE ROW LEVEL
SECURITY`). O risco de **não aplicar** é um piloto com cliente real rodando sobre um banco onde
qualquer conta criada em 30 segundos apaga a operação da plataforma e lê o CPF e a chave PIX da base
de freelas — anulando a correção aplicada horas antes e o argumento de LGPD que a sustentava.

A migration de chat (`210100`) é a de maior risco operacional das três, porque é a única que muda
**leitura** de uma tela de uso diário e a única cujo Realtime não é verificável por SQL. Se o teste
manual do chat não couber na janela, ela é a única candidata legítima a adiamento — e nesse caso o
mínimo inegociável é `REVOKE ALL ON public."Conversation", public."Message" FROM anon`, que fecha o
vazamento pré-autenticação sem tocar em RLS nem em nenhum caminho autenticado.

## Referências
- Migrations: `supabase/migrations/20260816210000_enable_rls_jobs.sql`,
  `20260816210100_enable_rls_conversation_message.sql`,
  `20260816210200_lockdown_legacy_prisma_tables.sql`,
  `20260816210300_enable_rls_analytics_job_categories.sql` (condicional)
- Origem do buraco: `20260309000000_enable_rls_all_tables.sql` (sem efeito em prod),
  `20260317150000_fix_applications_companies_rls.sql` (FORCE sem ENABLE),
  `20260318000000_fix_force_rls_service_role.sql` (NO FORCE)
- Porta lateral fechada: `20260816120000_workers_select_by_relationship.sql`
- Âncoras de `jobs.company_id`: `20260317160000:72`, `20260311100000:21,45,218`,
  `20260317012423:28`, `20260622000900:44-59`
- Aplicação da leva anterior: `supabase/migrations/APLICACAO-2026-08-16.md`
- Spec: `.harness/spec/revisao-piloto/spec.md`
- ADRs relacionados: `ADR-20260816-workers-select-por-vinculo.md`,
  `ADR-20260816-veto-freela-imutavel-delete.md`, `ADR-20260622-pagamento-postpago.md`
- Constitution: Article 4 (RLS é a primeira linha de defesa), Article 8 (saldo — aresta do `budget`),
  Article 10, Article 12
