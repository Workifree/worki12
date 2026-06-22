# ADR-001 — Conexões de equipe, convite push em applications e rating bidirecional (Slice 1)

## Status
ACEITO — 2026-06-22 (gate de arquitetura, Fase 3, Slice 1 do v1-operacao-freelancer)

## Contexto

O piloto (Aposta 1 da `thesis.md`) traz o **ato de contratar** para dentro do Worki num modelo
**relationship-first**: a empresa popula uma equipe fechada de freelas conhecidos, convida para turnos,
o freela aceita/recusa, o trabalho acontece e ambos se avaliam. Isso exige três peças de dados que **não
existem** hoje:

1. **Conexão consentida empresa↔freela** — hoje a relação é apenas transacional via `applications`
   (modelo pull: o worker se candidata). Não há conceito de "roster"/"minha equipe".
2. **Convite push** — hoje só o worker insere em `applications`. No modelo push, a **empresa** cria a
   application convidando um freela conhecido — o que muda quem pode inserir (área sensível: isolamento
   de papel, constitution Art. 1).
3. **Rating bidirecional** — `update_worker_rating_on_review` só atualiza `workers`. Não há espelho para
   `companies`, e a direção do review (worker→company vs. company→worker) é hoje implícita/ambígua (há um
   bug em `MyJobs.tsx:308-314` onde o worker grava `reviewed_id = company_id` e o trigger de worker tenta
   atualizar um worker inexistente).

Restrições de schema descobertas no recon do código (sem acesso à DB viva; inferidas das migrations):
- `companies.id = companies.owner_id = auth.uid()` do user `hire`; `workers.id = auth.uid()` do `work`
  (trigger `handle_new_user`). Um `auth.uid` é worker **XOR** company, nunca os dois.
- `jobs.company_id` e `applications.worker_id` são **UUID** (RLS `worker_id = auth.uid()` funciona sem cast).
- `reviews.reviewer_id`/`reviewed_id` são **TEXT** (migration `20260314000008` usa `reviewer_id::text`) —
  comparações com `*.id` (UUID) exigem cast explícito.

Slice 1 **não** toca saldo/escrow (pagamento postpago é Slice 2). Logo: zero RPC de saldo, zero
`GRANT EXECUTE` financeiro nesta entrega.

## Decisão

### 1. Conexão = nova tabela `team_connections` (aresta bilateral consentida)
`(company_id, worker_id, status[pending|accepted|blocked], source[qr|link|phone], created_at, accepted_at)`
com **UNIQUE (company_id, worker_id)**. Handshake 1x = a conexão fica `accepted` para sempre; convites de
turno seguintes não re-pedem aceite. RLS por papel:
- **empresa cria** (INSERT só `status='pending'` para uma company dela);
- **worker aceita** (UPDATE `pending→accepted`) ou **sai/bloqueia** (`→blocked`);
- empresa não pode forjar `accepted` (WITH CHECK restringe os estados que cada lado seta);
- cada lado só vê/gerencia conexões em que participa. `FORCE RLS` + `REVOKE anon` (padrão do projeto).

### 2. Convite push = ESTENDER `applications` (Opção A), não criar `job_invitations`
Adiciona colunas (`invited_by_company_at`, `invitation_responded_at`, `invitation_response`,
`invitation_expires_at`) e os status `invited`/`declined`. **Razão:** a application já É a aresta
worker↔job e carrega todo o lifecycle (check-in/out, confirmações). Um convite aceito **vira** a
application do turno — sem join nem migração de dados de uma tabela `job_invitations` para `applications`.

**Mudança de RLS de INSERT (o ponto sensível):** adiciona-se a policy
`applications_insert_company_invite` que permite a **empresa** inserir uma application, com 3 trincos:
(a) o `job_id` pertence a uma company do usuário; (b) o `worker_id` está na **equipe aceita**
(`team_connections` `accepted`) dessa company — espelha a lista fechada (R1/R2); (c) a linha nasce como
convite explícito (`status='invited' AND invited_by_company_at IS NOT NULL`), impedindo a empresa de usar
essa porta para forjar `hired`/`accepted`. A policy de INSERT do worker (pull) **permanece** — em RLS as
policies permissivas são OR-ed, então worker e empresa inserem por caminhos distintos sem conflito nem
furo de isolamento (a empresa nunca insere com `worker_id = auth.uid()`).

### 3. Rating bidirecional = coluna `reviews.direction` + trigger de company espelhado
Adiciona `reviews.direction ('worker'|'company')` indicando **quem é o avaliado**, tornando a direção
explícita e consultável (em vez de depender da coincidência "id só existe numa tabela"). Um trigger
`BEFORE INSERT` (`set_review_direction`) auto-preenche `direction` se o client omitir (self-healing →
sem footgun para o builder). O trigger de worker passa a filtrar `direction <> 'company'`; um novo trigger
`update_company_rating_on_review` (espelho) atualiza `companies.rating_average/reviews_count` quando
`direction='company'`. Backfill resolve reviews e agregados legados. A constraint existente
`reviews_unique_per_job (job_id, reviewer_id, reviewed_id)` já suporta os dois sentidos (reviewer/reviewed
invertidos não colidem).

## Consequências

### Positivas
- Roster fechado e consentido nasce com isolamento de papel forte no DB (RLS), espelhável no `ProtectedRoute`.
- Convite reaproveita 100% do lifecycle de `applications` — payout do Slice 2 só preenche o ponto de integração.
- Direção de review deixa de ser ambígua; rating de empresa passa a existir e é idempotente por agregação.
- Tudo idempotente (`IF [NOT] EXISTS`, `DROP ... IF EXISTS`) e com rollback explícito em cada migration.

### Negativas / Trade-offs
- `applications` ganha responsabilidade dupla (pull + push) — status set cresce (`invited`/`declined`).
  Mitigação: colunas nullable; linhas antigas seguem como pull sem migração.
- Transição de status do convite (só `invited→accepted/declined`) **não** é forçada por RLS (WITH CHECK de
  UPDATE não compara valor antigo de forma confiável aqui) — fica na camada de service. Risco baixo: a
  policy de UPDATE já restringe ao dono; a validação de máquina de estados é responsabilidade do builder.
- `reviews.direction` depende do trigger BEFORE INSERT para legado-free; se um insert vier por
  service_role com `direction` já setada errada, o valor é respeitado (não sobrescreve). Aceitável.

## Alternativas rejeitadas
- **Tabela `job_invitations` separada:** dado duplicado e migração convite→application no aceite; mais
  joins e mais superfície de bug. A application já é a aresta certa.
- **Tabela `reviews` separada por direção (worker_reviews / company_reviews):** duplica schema, trigger e
  RLS; a coluna `direction` resolve com uma tabela só.
- **Inferir direção só pela presença do id em workers/companies (sem coluna):** funciona "por acidente"
  (id é XOR), mas é frágil e não consultável; uma coluna explícita custa pouco e elimina ambiguidade.
- **Permitir worker inserir a própria conexão:** quebraria a regra "empresa convida" (R1) e abriria
  caminho para auto-adicionar a equipes alheias.

## Referências
- Spec: `.harness/spec/v1-operacao-freelancer/spec.md` (R1, R2, R7, R8, R10; A1, A2, A4)
- Plan: `.harness/spec/v1-operacao-freelancer/plan.md` (Slice 1)
- Constitution: Art. 1 (isolamento de papel), Art. 4 (RLS primeira linha), Art. 8 (não toca saldo aqui),
  Art. 12 (auth/onboarding/TOS — gate no `ProtectedRoute`, fora do escopo desta camada de dados).
- Migrations:
  - `supabase/migrations/20260622000000_team_connections.sql`
  - `supabase/migrations/20260622000100_invite_columns_applications.sql`
  - `supabase/migrations/20260622000200_company_rating_trigger.sql`
