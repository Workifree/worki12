# Badges das empresas onde o freela já trabalhou (F12) — spec

## Context

`.harness/thesis.md` define o moat do Worki como a **reputação profissional portátil do freela** — "o freela
com 200 turnos e 4.9 não recomeça do zero em outro app". Hoje esse histórico existe no banco (`applications`,
`reviews`) mas é invisível: uma empresa que olha o perfil de um freela vê só um número (`rating_average`).
Esta feature (pedido direto do owner) materializa o histórico visualmente — um "selo" por empresa onde o
freela já completou pelo menos um turno, com a logo daquela empresa e a nota que ELA deu a ele (se preencheu).

Isso ataca diretamente a assimetria de confiança do fluxo push: a empresa convida antes de conhecer o freela
a fundo; "trabalhou no Divino Fogão, no Outback e no Madero" é prova social muito mais forte e específica que
"4.8 estrelas". O precedente técnico direto é `get_profile_reviews` (migration `20260816130000`) — a mesma
lógica de "RPC `SECURITY DEFINER` com mascaramento por cima de uma tabela com RLS restrita por vínculo"
(`can_view_worker_profile`, migration `20260816120000`) se aplica aqui: `applications`/`jobs` são legíveis
pela empresa só para os próprios turnos, então mostrar o histórico com OUTRAS empresas exige o mesmo padrão.

Este é dado sensível de duas pontas: histórico de trabalho de uma pessoa física (o freela) exibido para
terceiros (outras empresas). A spec resolve isso com минimização de campos, escopo por vínculo já existente
(nenhuma abertura nova de acesso a estranhos) e um mecanismo explícito de remoção pelo freela — sem inventar
tabela nova além do estritamente necessário para esse controle.

## O que já existe e é reaproveitado (não recriar)

- `can_view_worker_profile(p_worker_id uuid)` (migration `20260816120000`) — já decide quem pode ver dados de
  um worker (self, empresa com `team_connections` pending/accepted, ou empresa com `applications` do freela
  num turno seu). **Reaproveitado tal como está, sem alterar seu corpo.**
- `mask_display_name` / padrão de RPC `SECURITY DEFINER` com `search_path=''`, `REVOKE ... FROM PUBLIC/anon` +
  `GRANT ... TO authenticated, service_role` (migration `20260816130000`) — mesmo padrão aplicado aqui.
- `applications.status = 'completed'` como definição canônica de "turno concluído" — já é a fonte de verdade
  de `completed_jobs_count` em `recompute_worker_aggregates` (ver `architecture.md`). Reaproveitada como
  definição de "trabalhou lá" (decisão 1 abaixo).
- Rota pública `/empresa/:id` (`CompanyPublicProfile.tsx`) já existe — o badge navega para lá.
- `components/ProfileReviews.tsx` é o modelo de componente (fetch via RPC + loading skeleton + empty state)
  a seguir para o novo componente de badges.
- `companies.name`, `companies.logo_url` já são publicamente legíveis (`USING (true)` na policy de SELECT de
  `companies`) — não há necessidade de opt-out de empresa para expor nome/logo (decisão 3 abaixo).

## Decisões fixadas (Assumido — ver log de clarificações)

1. "Trabalhou lá" = existe ao menos 1 `applications` com `status = 'completed'` ligando o freela a um `jobs`
   daquela empresa. Convite aceito e depois cancelado (`cancelled`) NÃO conta. Mesma régua de
   `completed_jobs_count`.
2. **Consentimento do freela:** badges aparecem por padrão (esconder por padrão mata a feature — a própria
   tese do produto é tornar o histórico visível). O freela pode **ocultar um badge específico** a qualquer
   momento (tabela nova `worker_company_badge_prefs`, RPC de toggle) — ocultar não desfaz o vínculo em
   `team_connections`, é reversível e não afeta `applications`/`reviews`/agregados (Article 8 intacto, e
   `completed_jobs_count`/XP continuam contando o turno mesmo com o badge oculto).
3. **Consentimento da empresa:** não há opt-out de empresa. Nome e logo já são dado público (`companies`
   legível por `USING (true)`, e a própria empresa já tem perfil público em `/empresa/:id`). O fato de "esta
   empresa teve este freela em um turno concluído" é histórico operacional do freela, não segredo comercial
   da empresa.
4. **Quem vê:** só quem já pode ver o perfil do freela hoje — `can_view_worker_profile(worker_id)` (empresa
   com vínculo de elenco OU vínculo operacional) OU o próprio freela. **Não** abre o histórico do freela a
   empresas totalmente estranhas — reaproveita o boundary já decidido em `20260816120000`, não cria um novo.
   Implementado como nova RPC `SECURITY DEFINER` (precedente `get_profile_reviews`), porque a RLS de
   `applications`/`jobs` de uma empresa A não deixa A ler `applications` cujo `jobs.company_id` é de outra
   empresa B — é exatamente essa leitura cruzada que a feature precisa.
5. **Nota junto do badge:** mostra a média das notas que **aquela empresa especificamente** deu ao freela
   (`reviews` com `reviewer_id = company_id AND reviewed_id = worker_id AND direction = 'worker'`), não a
   média geral. Se a empresa nunca avaliou, o badge aparece sem nota (nunca "0 estrelas" — ausência ≠ nota
   ruim).
6. **Ordenação e limite:** mais recente primeiro (`MAX` da data do turno concluído daquela empresa). RPC
   devolve no máximo 100 linhas (defensivo). UI mostra os primeiros 12 num grid; acima disso, "Ver todos" abre
   lista completa (mesmo padrão de modal/expansão já usado no projeto, sem paginação nova).
7. **Visual:** selo circular com a logo da empresa (`w-14 h-14 sm:w-16 sm:h-16 rounded-full border-2
   border-black shadow-[3px_3px_0px_0px_rgba(0,0,0,1)]`); sem `logo_url`, iniciais do nome em fundo preto
   (mesmo padrão do avatar do freela em `WorkerPublicProfile.tsx`). Toque no selo ≥44px e navega para
   `/empresa/:id`. Nome da empresa abaixo do selo, truncado; nota (se houver) como estrelinha pequena.

## Requirements

- [ ] R1: Nova tabela `worker_company_badge_prefs (worker_id uuid, company_id uuid, hidden boolean not null
      default false, updated_at timestamptz not null default now(), PRIMARY KEY (worker_id, company_id))` com
      RLS: o freela lê/escreve só as próprias linhas (`worker_id = auth.uid()`); nenhuma outra role lê esta
      tabela diretamente (o filtro de "oculto" acontece dentro da RPC de leitura, `SECURITY DEFINER`).
- [ ] R2: Nova RPC `get_worker_company_badges(p_worker_id uuid)` (`LANGUAGE sql`, `STABLE`, `SECURITY
      DEFINER`, `SET search_path = ''`) que devolve, por empresa distinta com ao menos um `applications.status
      = 'completed'` do freela: `company_id`, `company_name`, `company_logo_url`, `shifts_count`,
      `last_shift_at`, `avg_rating` (nullable), `reviews_count` (quantas avaliações daquela empresa sobre este
      freela). Exclui empresas com `worker_company_badge_prefs.hidden = true` para este par. Guarda:
      `auth.uid() IS NOT NULL AND (p_worker_id = auth.uid() OR public.can_view_worker_profile(p_worker_id))` —
      sem isso, devolve conjunto vazio (nunca erro que vaze existência do freela). `ORDER BY last_shift_at
      DESC LIMIT 100`.
- [ ] R3: Nova RPC `set_worker_badge_visibility(p_company_id uuid, p_hidden boolean) RETURNS void` (`SECURITY
      DEFINER`, `SET search_path = ''`) — upsert em `worker_company_badge_prefs` para `worker_id = auth.uid()`.
      Só o próprio freela chama (não recebe `worker_id` como parâmetro — sempre `auth.uid()`).
- [ ] R4: Grants: `REVOKE EXECUTE ... FROM PUBLIC, anon` + `GRANT EXECUTE ... TO authenticated, service_role`
      nas duas RPCs novas, seguindo o padrão de `20260816130000`. `REVOKE ALL ON worker_company_badge_prefs
      FROM anon` (nunca `REVOKE ALL ... FROM PUBLIC` na tabela — lição de `20260318000000`).
- [ ] R5: Novo componente `components/CompanyBadges.tsx` — recebe `workerId: string` e `mode: 'view' |
      'manage'`. `mode='view'` (usado em `pages/company/WorkerPublicProfile.tsx`): grid de selos, sem controle
      de ocultar. `mode='manage'` (usado em `pages/Profile.tsx`, self-view do freela): mesmo grid + ícone de
      olho/olho-cortado por badge para ocultar/reexibir (chama `set_worker_badge_visibility`, otimista +
      rollback em erro). Fetch via `useState`/`useEffect` chamando `get_worker_company_badges` (Article 5).
- [ ] R6: `pages/company/WorkerPublicProfile.tsx` renderiza `<CompanyBadges workerId={id} mode="view" />` numa
      seção nova ("Já trabalhou com", entre o header e Histórico/Comentários).
- [ ] R7: `pages/Profile.tsx` (self-view do freela) renderiza `<CompanyBadges workerId={<próprio id>}
      mode="manage" />` numa seção equivalente, com copy própria ("Empresas onde você já trabalhou").
- [ ] R8: Empty state explícito (nenhuma empresa completou turno ainda) — não esconde a seção, mostra
      mensagem neutra (mesmo padrão de `ProfileReviews`: "Ainda sem histórico. Aparece aqui após turnos
      concluídos.").
- [ ] R9: Clique em um selo (mode='view' ou 'manage') navega para `/empresa/:id` (rota já existente,
      `CompanyPublicProfile.tsx`) — exceto quando o clique for no controle de ocultar (`stopPropagation`).
- [ ] R10: `types/index.ts` ganha `CompanyBadge` (shape do retorno da RPC) e `WorkerCompanyBadgePref` (shape da
      tabela nova), à mão (Article 2 — sem codegen).
- [ ] R11: Nenhuma escrita em `wallets`, `escrow_transactions`, `wallet_transactions` — feature é 100%
      leitura + uma preferência booleana (Article 8 intacto).
- [ ] R12: Migration desta feature é a próxima disponível após `20260817000800` (ex.:
      `20260818000000_worker_company_badges.sql`) — tabela nova antes das funções que a leem (regra do
      harness: `LANGUAGE sql` valida corpo no `CREATE`); policies criadas antes de assumir RLS habilitada.

## Acceptance criteria

- [ ] A1: Dado um freela com 1 `applications.status='completed'` num turno da Empresa X, quando a Empresa Y
      (que tem `team_connections` accepted com este freela, mas NUNCA teve turno com ele) abre
      `/company/workers/:id` dele, então o badge da Empresa X aparece no grid "Já trabalhou com" — com logo (ou
      iniciais), nome, e nota (se X avaliou) ou sem nota (se X não avaliou).
- [ ] A2: Dado um freela com um `applications` `status='invited'` (convite pendente, nunca `completed`) numa
      Empresa Z, quando qualquer empresa olha o perfil dele, então NENHUM badge da Empresa Z aparece.
- [ ] A3: Dado que a Empresa W nunca teve `team_connections` nem `applications` com o freela (sem vínculo
      nenhum), quando W tenta chamar `get_worker_company_badges(worker_id)` (via console/devtools, não pela
      UI — a UI nem chega a renderizar a página), então a RPC devolve conjunto vazio (não erro, não vaza
      quantidade de empresas do freela).
- [ ] A4: Dado que o freela está em `/perfil` (self-view, `mode='manage'`) e vê o badge da Empresa X, quando
      clica no ícone de ocultar, então `worker_company_badge_prefs (worker_id=freela, company_id=X,
      hidden=true)` é gravado, o badge some da própria tela imediatamente (otimista), e some também da visão
      de qualquer empresa que olhar o perfil dele depois.
- [ ] A5: Dado o badge oculto do A4, quando o freela clica em "reexibir", então `hidden` volta a `false` e o
      badge reaparece — SEM recriar `applications`/`reviews`/agregados (XP e `completed_jobs_count` nunca
      mudam por causa de ocultar/reexibir badge).
- [ ] A6: Dado que o freela trabalhou 3 vezes concluídas com a mesma Empresa X (3 `applications` completed),
      quando qualquer visão consulta os badges, então aparece **1 selo** para a Empresa X com `shifts_count=3`
      e `last_shift_at` = data do turno concluído mais recente.
- [ ] A7: Dado que a Empresa X avaliou o freela em 2 dos 3 turnos concluídos (2 `reviews` com
      `direction='worker'`, `reviewer_id=X`), quando o badge de X é exibido, então a nota mostrada é a MÉDIA
      dessas 2 notas (não a `rating_average` geral do freela, que pode incluir outras empresas).
- [ ] A8: Dado um freela sem nenhum turno `completed` em nenhuma empresa, quando qualquer visão (própria ou de
      empresa com vínculo) abre a seção de badges, então aparece o empty state ("Ainda sem histórico...") em
      vez de grid vazio silencioso.
- [ ] A9: Dado o grid de badges em `mode='view'`, quando a empresa clica num selo (fora do controle de
      ocultar, que não existe nesse modo), então navega para `/empresa/:company_id` (perfil público daquela
      empresa).
- [ ] A10: `cd frontend && npm run build` e `npm run lint` passam sem erro após a implementação (Article 3).

## Out-of-scope

- Badge/patch customizável pela empresa (design próprio, "medalhas" por categoria) — só a logo da empresa como
  selo, v1.
- Ranking/gamificação cruzando badges com XP — fora do escopo desta spec (existe `freelancer-engagement`
  separado).
- Opt-out por parte da empresa (empresa pedir para não aparecer como badge de ninguém) — não pedido pelo
  owner; nome/logo já são dado público hoje.
- Exibir CNPJ, endereço, telefone ou qualquer outro campo de `companies` além de nome/logo no selo.
- Notificar a empresa quando um freela oculta o badge dela — silencioso, é decisão unilateral do freela sobre
  o PRÓPRIO perfil.
- Abrir o histórico do freela para empresas SEM nenhum vínculo (`can_view_worker_profile` continua sendo o
  único portão — não é alterado nem contornado por esta feature).
- Paginação real dos badges (cursor/infinite scroll) — o cap de 100 na RPC + "Ver todos" client-side resolve o
  v1; se algum freela cruzar 100 empresas distintas, é problema para outra spec.
- Qualquer mudança em `wallets`, `escrow_transactions`, saldo ou taxa — feature é puramente de reputação/UI.

## Clarifications log

- Q: O que conta como "trabalhou lá"? → A (Assumido): `applications.status='completed'`, mesma régua de
  `completed_jobs_count`/XP já existente. Convite aceito e depois cancelado não conta.
- Q: Freela pode ocultar uma empresa específica? Default mostrar ou esconder? → A (Assumido): default mostrar
  (é a tese do produto); ocultar é opt-out explícito por badge, reversível, via tabela nova
  `worker_company_badge_prefs` + RPC dedicada — não mexe em `applications`/`reviews`/agregados.
- Q: Empresa pode se opor a virar badge? → A (Assumido): não — nome/logo de `companies` já são dado público
  (policy `USING (true)`) e a própria empresa já tem perfil público em `/empresa/:id`; o fato "trabalhou aqui"
  é histórico do freela, não segredo da empresa.
- Q: Quem consegue ver os badges — precisa abrir acesso a empresas sem vínculo? → A (Assumido): não abre nada
  novo. Reaproveita exatamente o boundary de `can_view_worker_profile` (empresa com vínculo de elenco ou
  operacional, ou o próprio freela). A leitura cross-empresa (ver histórico com OUTRAS empresas) é resolvida
  por RPC `SECURITY DEFINER` nova, no molde de `get_profile_reviews` — não por afrouxar RLS de
  `applications`/`workers`.
- Q: Mostra a nota por empresa? O que aparece se a empresa não avaliou? → A (Assumido): mostra a MÉDIA das
  notas daquela empresa específica sobre o freela (não a média geral); sem nota visível quando a empresa nunca
  avaliou (nunca renderizar "0 estrelas" por ausência de dado).
- Q: Ordenação e limite quando o freela tem muitas empresas? → A (Assumido): mais recente primeiro
  (`last_shift_at DESC`); RPC cap de 100; UI mostra 12 + "Ver todos".
- Q: Visual do selo quando a empresa não tem logo? → A (Assumido): mesmo padrão já usado no projeto para
  avatar sem foto — iniciais do nome em círculo preto, borda neo-brutalista, toque ≥44px, navega para
  `/empresa/:id`.
