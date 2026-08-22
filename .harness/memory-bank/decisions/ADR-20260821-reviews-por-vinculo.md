# ADR-20260821 — `reviews` escopado por vínculo, com prova social da empresa preservada

## Status

ACEITO (decisão técnica; não depende de aceite jurídico). Implementação gated pelo DDL aprovado.

## Contexto

`reviews` é `SELECT USING (true)` desde `20260309000000:109`. `companies` também é `USING (true)`.
Consequência em produção: **qualquer conta autenticada, criada em 30 segundos, sem vínculo nenhum**,
lê todas as avaliações de qualquer freela e resolve o nome da empresa avaliadora a partir de
`reviewer_id`. `pages/company/WorkerPublicProfile.tsx:122` já renderiza exatamente essa dupla
(nota + comentário + qual empresa deu).

É a mesma classe do problema que `20260816120000` fechou em `workers` (CPF, telefone e PIX varríveis
por qualquer autenticado) e que ficou de fora naquela passagem. O gate da F12 (badges) registrou o
achado e explicitamente **não** o corrigiu, por exigir spec própria.

O achado novo deste gate: **fechar a policy sozinha não fecha nada.**
`get_profile_reviews` (`SECURITY DEFINER`, `20260816130000`) exige apenas `auth.uid() IS NOT NULL` e
devolve o mesmo conteúdo — nota, comentário, data e nome do avaliador. É a mesma porta com outra placa.
A tabela e a RPC precisam ser fechadas **juntas** ou o trabalho é teatro de privacidade.

Restrição de produto que não pode ser sacrificada: `/empresa/:id` existe para o freela ver o que
outros freelas disseram sobre a empresa **antes de aceitar o convite**. Essa assimetria de confiança é
deliberada — o fluxo é push (a empresa convida), e a prova social é o que equilibra.

## Decisão

Fecho em duas metades, na mesma migration.

**1. Policy de `reviews` escopada por vínculo** (substitui `USING (true)`), com três ramos:
   - sou o **autor** (`reviewer_id = auth.uid()`) — sustenta `MyJobs` ("quais turnos já avaliei");
   - sou o **avaliado** (`reviewed_id = auth.uid()`);
   - `can_view_reviews_of(reviewed_id)` — função nova, `SECURITY DEFINER`, `search_path=''`, que
     devolve **só boolean**: empresa que eu opero (ancoragem dupla `id`/`owner_id`, mesma regra de
     `is_company_owner`/`is_job_owner`) **ou** freela que eu já posso ver via
     `can_view_worker_profile` (`20260816120000`).

   Reusar `can_view_worker_profile` é intencional: a régua de "quem pode ver este freela" foi decidida
   uma vez; quando ela mudar (F3 multi-unidade/gerente), muda num lugar só.

**2. Gate por direção dentro de `get_profile_reviews`** (emenda mínima ao `WHERE`):
   - `p_direction = 'company'` (perfil de **empresa** avaliada) → **aberto** a qualquer autenticado.
     É a prova social do perfil público. Os avaliadores freelas já saem mascarados ("Carlos S.").
   - `p_direction = 'worker'` (perfil de **freela** avaliado) → exige `can_view_worker_profile`.
     Sem vínculo: **zero linhas, sem erro** — degrada como lista vazia, não como falha.

Auxiliar: `try_uuid(text)` — `reviews.reviewer_id`/`reviewed_id` são `TEXT` no schema legado. `::uuid`
puro dentro de policy é bomba: uma linha com texto não-uuid derruba o `SELECT` inteiro com `22P02`, e
o conteúdo é escolhido pelo autor do `INSERT`.

Grafo de policy verificado (42P17 só aparece em **runtime**):
`reviews → can_view_reviews_of (DEFINER) → can_view_worker_profile (DEFINER) → team_connections /
applications / jobs / companies`. Nenhuma dessas tabelas tem policy que leia `reviews`. **Acíclico.**
O ponto que fecharia o ciclo está anotado no SQL.

Não são tocadas: a policy de **INSERT** de `reviews`, a policy de `companies`, e nenhuma RPC
financeira (Article 8 intacto — isto é só leitura).

## Consequências

### Positivas

- Some a varredura de reputação de pessoa física por conta sem vínculo — o dado cresce com o piloto,
  e agora para de crescer exposto.
- O perfil público da empresa (`/empresa/:id`) e a `CompanyPublicProfile` continuam idênticos: a
  assimetria de confiança do modelo push é preservada por decisão, não por acidente.
- **Nenhum consumidor precisa mudar.** `ProfileReviews` já usa a RPC; `WorkerPublicProfile` (empresa)
  passa pelo ramo (3) porque tem vínculo; `MyJobs` passa pelo ramo (1).
- **F12 (badges) não muda uma linha** — lê por `SECURITY DEFINER` própria e devolve média e contagem,
  não conteúdo. Confirmado contra `.harness/spec/badges-empresas/ddl-aprovado.md`.
- A régua de visibilidade de freela continua num lugar só.

### Negativas / Trade-offs

- Um `SELECT` em `reviews` passa a executar uma função `plpgsql` por linha candidata. Mitigado por
  `idx_reviews_reviewer` (novo) e `idx_reviews_reviewed_direction` (já existia), mas é custo real.
- A leitura direta da tabela por um freela sobre **outra empresa** deixa de funcionar: quem quiser
  isso precisa passar pela RPC. É intencional (a RPC mascara nomes), mas é uma armadilha para quem
  escrever tela nova sem ler isto.
- Avaliações de **empresa** seguem legíveis por qualquer autenticado. É produto, não descuido — mas
  significa que a reputação da empresa é pública para a base inteira.
- `companies` continua `USING (true)`, com `cnpj`, `email` e `address` legíveis por qualquer
  autenticado. Mesma classe de problema, **não resolvido aqui** — vira débito #10 (exige policy
  column-scoped + RPC de perfil público, spec própria).

## Alternativas rejeitadas

- **Só apertar a policy da tabela.** `get_profile_reviews` é DEFINER e continuaria devolvendo tudo.
  Daria a sensação de correção sem corrigir.
- **Só apertar a RPC.** `WorkerPublicProfile` lê a tabela direto; a varredura continuaria pelo
  PostgREST.
- **Fechar também `direction='company'` (exigir vínculo para ver reputação de empresa).** Mataria a
  prova social do perfil público — que existe justamente para quem **ainda não** tem vínculo.
- **Subquery inline na policy em vez de função DEFINER.** Acopla a policy de `reviews` às policies de
  `team_connections`/`applications`/`jobs`/`companies` e abre porta para `42P17` futuro. Mesmo
  raciocínio de `20260816120000`.
- **Desnormalizar `reviewer_name` em `reviews`** (resolveria a autoria sem ler `workers`). Congelaria
  o nome: a anonimização LGPD deixaria de valer retroativamente. Já rejeitado em `20260816130000` e
  continua rejeitado.

## Referências

- DDL aprovado (normativo): `.harness/spec/lgpd-producao/ddl-aprovado.md` §3
- Débitos: `.harness/memory-bank/debitos-pre-piloto.md` §9
- Molde: `supabase/migrations/20260816120000_workers_select_by_relationship.sql`
  e `20260816130000_profile_reviews_reader.sql`
- ADR-20260816 — workers select por vínculo (+ adendo de autoria de avaliações)
- ADR-20260817 — seam de autorização de empresa (ancoragem dupla)
- F12: `.harness/spec/badges-empresas/ddl-aprovado.md`
