# ADR-20260821 — Badges de empresas: histórico derivado, opt-out em dois níveis, sem score novo

## Status

ACEITO (gate de arquitetura da F12) — com **uma sinalização ao humano** que não bloqueia esta feature:
a exposição de `reviews` (`USING (true)`) é dívida pré-existente e maior que a F12, e pede spec própria
(ver "Achado colateral").

Contrato de implementação: `.harness/spec/badges-empresas/ddl-aprovado.md`
Migration: `supabase/migrations/20260817001400_worker_company_badges.sql`

## Contexto

Pedido do owner: *"o freela que já trabalhou em determinado restaurante ganha um badge no perfil dele...
outras empresas podem ver as empresas em que um freela já trabalhou e a nota delas sobre ele"*.

Isso põe três coisas em tensão de uma vez:

1. **Relação comercial de terceiros.** A empresa A passa a ver que o freela trabalha para a B — que pode
   ser concorrente na mesma rua. A spec da F11 (SOS) tinha o mesmo problema e o resolveu **não** expondo a
   lista; aqui a exposição **é** a feature.
2. **Reputação atribuída e permanente.** Nota por empresa não é o agregado `workers.rating_average`: é o
   julgamento individual de um empregador, com nome, acompanhando a pessoa em toda contratação futura.
   Tangencia LGPD art. 20, e `.harness/spec/analytics-operacao/prd.md` §D4 **recusou** deliberadamente
   criar score exposto de freela pelo mesmo motivo.
3. **Alcance de leitura.** `can_view_worker_profile` (`20260816120000`) restringe `workers` a self /
   vínculo de elenco / vínculo operacional. Badge no perfil mexe nesse teto?

Achado que reordenou a análise: **a nota atribuída já é pública hoje.** `reviews` é `USING (true)`
(`20260309000000`) e `companies` é `USING (true)` (`20260317160000`); qualquer conta autenticada lê todas
as avaliações de qualquer freela e resolve o nome da empresa avaliadora. `WorkerPublicProfile.tsx` já
renderiza isso na tela onde o badge vai entrar. O que a F12 **de fato** estreia não é a nota — é a lista de
empregadores que **nunca avaliaram** (esses hoje não deixam rastro cross-empresa, porque `applications` é
escopada por dono).

## Decisão

1. **Badge é derivado em query, nunca materializado.** Nenhuma tabela de badge, nenhum contador, nenhuma
   matview, nenhum trigger de invalidação. Fonte: `applications.status='completed'` + `jobs.company_id`
   (mesma régua de `completed_jobs_count`) e `reviews` com `direction='worker'`.
2. **Leitura por RPC `SECURITY DEFINER` `get_worker_company_badges(uuid)`**, no molde exato de
   `get_profile_reviews`. O teto de acesso continua sendo `can_view_worker_profile`, **consumida sem
   alteração de corpo**. Quem não passa recebe **conjunto vazio**, nunca exceção (sem oráculo de
   existência).
3. **Consentimento do freela em dois níveis, ambos opt-out:** `workers.badges_hidden` (chave-mestra, um
   gesto apaga a seção para terceiros) e `worker_company_badge_prefs (worker_id, company_id, hidden)`
   (bisturi por empresa, via RPC `set_worker_badge_visibility`). O dono **sempre** vê os ocultos, com a
   flag, senão não consegue reverter.
4. **Sem consentimento da empresa.** Nome e logo já são dado público (`companies` `USING (true)`; logo é
   URL do bucket público `avatars` via `getPublicUrl`). "Este freela trabalhou aqui" é histórico do
   trabalhador, não segredo comercial da empresa.
5. **A nota por empresa entra, atribuída e não combinada** — e junto entra a proibição, escrita no
   contrato: sem `ORDER BY` por nota, sem campo `score`, sem "média das médias", sem ranking. Isso mantém
   a F12 na Opção A de analytics D4 (métricas componentes lado a lado) e fora da Opção B (score composto,
   que exige ADR próprio + revisão LGPD).
6. **Corte mínimo = 1 turno concluído**, com `shifts_count` obrigatório na face do selo. O antídoto para
   inflação é o selo não mentir, não um threshold arbitrário.
7. **Esconder ≠ desfazer.** Nenhum dos controles toca `applications`, `reviews`, XP, `completed_jobs_count`
   ou qualquer tabela financeira (Article 8 intacto).

## Consequências

### Positivas

- A promessa do moat (`thesis.md`: "reputação profissional portátil") vira coisa visível sem inventar
  estado novo: uma tabela de preferência e uma coluna booleana são a **única** escrita da feature.
- Nada envelhece errado: turno estornado, conta anonimizada, logo trocada, review corrigida — tudo aparece
  no badge na hora seguinte, porque o badge não guarda cópia.
- O teto de privacidade do projeto continua num lugar só (`can_view_worker_profile`). A F12 não cria um
  segundo conceito de "quem pode ver o freela" para alguém ter que manter em sincronia depois.
- O freela ganha um controle que hoje ele **não tem** sobre um dado que hoje já está exposto (as reviews
  atribuídas): a chave-mestra cobre também a parte que a F12 não criou.
- Rollback é trivial: dropar duas funções, uma tabela, um índice e uma coluna. Nenhuma policy existente é
  alterada, nenhum dado existente é reescrito.

### Negativas / Trade-offs

- **Aceitamos expor a lista de empregadores para concorrentes.** Empresa A vê que o freela trabalha na B,
  inclusive quando B nunca avaliou. Mitigação é opt-out (não prevenção), e opt-out tem custo de descoberta:
  o freela só se protege se souber que o controle existe — daí a exigência de que o `mode='manage'` mostre
  o switch com copy explícita, não escondido num submenu.
- **Opt-out favorece a plataforma, não a pessoa.** É a escolha consciente: default oculto mata a feature.
  Assumido como decisão de produto, registrada aqui para não ser reinterpretada depois como acidente.
- Uma `SECURITY DEFINER` a mais lendo cross-empresa. Estreita (8 colunas fixas, 1 freela por chamada, sem
  lista de ids do caller), mas é superfície nova a ser reauditada se `can_view_worker_profile` mudar — em
  especial pelo F3/multi-unidade, que já é a costura anunciada em
  `ADR-20260817-seam-autorizacao-empresa.md`.
- O `LIMIT 100` é um teto silencioso. Aceitável no piloto; vira dívida se alguém cruzar 100 empresas.

## Alternativas rejeitadas

- **Tabela materializada `worker_company_badges` (contador + nota, mantida por trigger).** Rejeitada: cria
  reputação congelada com N caminhos de invalidação (estorno, anonimização LGPD do `delete-account`, troca
  de nome/logo, correção de review). Cada caminho esquecido vira badge mentindo no perfil de uma pessoa —
  e badge que mente é pior que badge que não existe. O ganho seria performance que o volume do piloto não
  justifica.
- **Badge sem nota (só logo + contagem).** Rejeitada: seria teatro de privacidade. A mesma tela já lista as
  reviews com o nome da empresa e a nota, porque `reviews` é `USING (true)`. Esconder a nota no selo não
  esconde nada — só piora o selo.
- **Opt-in por empresa (badge nasce oculto).** Rejeitada: mata a feature na prática (ninguém liga 12
  badges um a um) e contradiz a tese do produto. O opt-out em dois níveis dá o mesmo poder final ao freela
  com custo de fricção invertido.
- **Só chave-mestra global, sem bisturi por empresa.** Rejeitada: o caso real é granular ("não quero
  anunciar *aquele* cliente"), e tudo-ou-nada empurraria o freela a apagar o histórico inteiro para
  esconder uma linha.
- **Só bisturi, sem chave-mestra.** Rejeitada: esconder tudo viraria N chamadas de RPC, e falha parcial
  no meio deixa a pessoa exposta achando que se escondeu.
- **Abrir os badges para qualquer autenticado (perfil realmente público).** Rejeitada: alargaria o teto
  fechado em `20260816120000` (que existe porque a base de freelas era varrível com CPF e PIX). A F12 não
  paga esse preço.
- **`ALTER` na policy de `reviews` dentro desta migration.** Rejeitada aqui por escopo: quebraria
  `ProfileReviews`, `CompanyProfile`, `CompanyPublicProfile` e `WorkerPublicProfile` de uma vez. Vai para
  spec própria (abaixo).

## Achado colateral — para o humano decidir (não bloqueia a F12)

`reviews` é `SELECT USING (true)` desde `20260309000000`. Qualquer conta autenticada — inclusive uma
criada agora, sem vínculo nenhum — lê **todas** as avaliações de **qualquer** freela ou empresa, com
`reviewer_id`, e resolve o nome em `companies` (também `USING (true)`).

Isso é a mesma classe de problema que `20260816120000` fechou em `workers` (CPF/PIX varrível), e é
**maior que a F12**: existe hoje, em produção, sem esta feature. A F12 é coerente com a decisão de
D3 justamente porque não piora esse quadro — mas a decisão de manter `reviews` aberta deveria ser
explícita, não herdada.

**Recomendação:** spec própria escopando o SELECT de `reviews` por vínculo, reusando
`can_view_worker_profile` / `is_company_owner` e o `get_profile_reviews` que já existe como caminho de
leitura mascarada. Se essa spec acontecer, a F12 **não precisa mudar** — ela lê por DEFINER e continua
funcionando.

## Gatilhos de reabertura desta ADR

- Alguém propor **ordenar badges por nota**, campo `score`, "média das médias" ou ranking de freela →
  é a Opção B de `analytics-operacao/prd.md` D4: ADR próprio + revisão LGPD antes de qualquer código.
- **Reclamação real de freela** sobre a lista de empregadores exposta a concorrente → reavaliar o default
  (opt-out → opt-in) com dado de uso, não com opinião.
- **F3 / multi-unidade** alterar `can_view_worker_profile` ou a ancoragem de autorização de empresa →
  reauditar `get_worker_company_badges` na mesma migration (a DEFINER herda o teto).
- Freela cruzar **100 empresas distintas** → o `LIMIT 100` vira mentira silenciosa; paginação real.
- Pedido de **badge emitido pela plataforma** (medalha, categoria, cosmético) → é a fronteira com a
  anti-vision "NÃO é rede social" (`product.md`); exige decisão de produto, não de arquitetura.

## Referências

- Contrato: `.harness/spec/badges-empresas/ddl-aprovado.md`
- Spec: `.harness/spec/badges-empresas/spec.md`
- `supabase/migrations/20260816120000_workers_select_by_relationship.sql` (`can_view_worker_profile`)
- `supabase/migrations/20260816130000_profile_reviews_reader.sql` (`get_profile_reviews`, mascaramento)
- `supabase/migrations/20260309000000_enable_rls_all_tables.sql` (`reviews` / `workers` `USING (true)`)
- `supabase/migrations/20260317160000_fix_companies_rls_owner_select.sql` (`companies`/`applications`)
- `.harness/spec/analytics-operacao/prd.md` §D4 (score/ranking rejeitado)
- `.harness/memory-bank/decisions/ADR-20260817-seam-autorizacao-empresa.md`
- `.harness/constitution.md` Articles 1, 2, 3, 4, 5, 8, 10, 13
