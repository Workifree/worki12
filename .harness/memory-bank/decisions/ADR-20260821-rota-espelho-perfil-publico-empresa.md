# ADR-20260821 — Rota-espelho para o perfil público da empresa em contexto de empresa

## Status
ACEITO

## Contexto

O achado `C-BADGE-CLICK-TARGET` (blocker do evaluator da F12) expôs um conflito estrutural, não um bug
pontual de UI:

- `components/CompanyBadges.tsx` navega para `/empresa/:company_id` ao clicar num selo.
- Em `mode='view'`, o componente só monta em `pages/company/WorkerPublicProfile.tsx` (rota
  `/company/worker/:id`) — quem clica é **sempre** `user_type === 'hire'`.
- `/empresa/:id` está registrada sob `MainLayout` (`App.tsx:162`) e `'/empresa'` consta de
  `workerOnlyPaths` em `components/ProtectedRoute.tsx:148`.

Resultado determinístico em 100% dos cliques: toast "Você não tem permissão para acessar esta página." e
`Navigate` para `/company/dashboard`, perdendo o perfil do freela que a empresa estava avaliando.

A raiz é conceitual: **`/empresa/:id` é um perfil público, mas está modelado como rota de papel.** O
`ProtectedRoute` só sabe dizer "esta rota é do worker" ou "esta rota é da empresa"; não existe categoria
"conteúdo público que os dois papéis podem ler". Como `companies` é `SELECT USING (true)` e a logo é URL
pública do bucket `avatars`, o conteúdo já é legível pelos dois papéis — o guard não protege dado, protege
**layout e navegação**.

O problema volta toda vez que uma tela precisar linkar conteúdo público a partir do outro papel (perfil
público da empresa a partir de tela de empresa; amanhã, perfil público do freela a partir de tela de
worker). Precisa de regra, não de remendo.

## Decisão

**Rota-espelho aditiva, sob o layout do papel que navega, reusando o mesmo componente de página.**

Para a F12: registrar `/company/empresa/:id` dentro do bloco `<Route path="/company" element={<CompanyLayout />}>`
em `App.tsx`, apontando para o **mesmo** `pages/CompanyPublicProfile` (sem fork, sem cópia, sem prop de
papel). `CompanyBadges` deriva o destino do prop `mode` (`view` → `/company/empresa`, `manage` →
`/empresa`). `ProtectedRoute.tsx` **não é alterado**.

Regra geral que este ADR institui: **conteúdo público linkado por dois papéis ganha uma rota por papel,
sob o layout daquele papel, com um único componente de página por trás. Não se abre exceção em
`workerOnlyPaths` (nem no espelho `/company/*`) para resolver navegação.**

Contrato normativo registrado como **DS11** em `.harness/spec/badges-empresas/ddl-aprovado.md` §2 e §2.1
(o arquivo que o builder lê). Nenhum SQL, migration, policy, RPC ou grant nesta decisão.

## Consequências

### Positivas
- Article 1 e Article 12 intactos: `ProtectedRoute` continua com regra binária, sem exceção por rota.
  `CompanyLayout` (que já exige `user_type === 'hire'`) vira segunda camada de guard, de graça.
- Zero superfície de dados nova: `companies` já é `USING (true)`; a query de `applications` do componente
  (`worker_id = user.id`) volta vazia para uma empresa, então o botão "Falar com a empresa" simplesmente
  não renderiza — sem `if (userType)` dentro do componente; `get_profile_reviews` já mascara nomes de
  freelas para terceiros, inclusive para empresa olhando outra empresa.
- Reversível em uma linha (remover a `<Route>`), ao contrário de mexer no guard.
- `mode='manage'` (freela em `/profile`) não muda: continua indo para `/empresa/:company_id`.
- Dá precedente nomeado para o próximo caso (o padrão some da cabeça de quem implementa se não estiver
  escrito).

### Negativas / Trade-offs
- Duas URLs para o mesmo conteúdo. Custo de SEO é nulo (ambas atrás de auth), mas link colado entre
  papéis não funciona: uma empresa que copie `/company/empresa/X` e mande a um freela gera um redirect
  por papel. Aceito — compartilhamento cross-papel de URL não é fluxo do produto hoje.
- `CompanyPublicProfile` roda uma query em `applications` que, para o caller empresa, sempre volta vazia.
  Leitura indexada, custo desprezível; o alternativo (ramificar por papel) contaminaria um componente hoje
  agnóstico.
- Sombras verdes `#00A651` (cor de worker, Article 13) renderizadas sob `CompanyLayout`. Inconsistência
  cosmética conhecida e **aceita**: é a mesma página, e parametrizar cor por papel introduziria a
  ramificação que a decisão evita. Se incomodar, resolve-se depois com token de tema no layout, não com
  `if` na página.
- O invariante "`mode='view'` ⇒ caller é `hire`" passa a ser carregado pelo prop `mode`, não pelo tipo do
  usuário. Se `CompanyBadges` for montado numa terceira tela, o invariante precisa ser revalidado — está
  comentado no código e em DS11.

## Alternativas rejeitadas

- **Liberar `/empresa` para `hire` no `ProtectedRoute`** (opção 1 do evaluator): `workerOnlyPaths` casa por
  **prefixo** (`pathname === p || startsWith(p + '/')`). Abrir `/empresa` hoje é seguro só porque a rota é
  folha; qualquer rota futura sob `/empresa/*` (ex.: `/empresa/:id/turnos`) nasceria acessível a empresas
  sem ninguém decidir isso. Além disso, cria o precedente "abre exceção quando dá trabalho" no único ponto
  do frontend que implementa o Article 1. Trocar guard de segurança por conveniência de navegação é câmbio
  ruim. **Seria esta a decisão que exigiria ADR de mudança de isolamento de papel — e é justamente a que
  não tomamos.**
- **Selo não-navegável em `mode='view'`** (opção 2): contradiz R9/A9 e §5 do DDL aprovado, e mata o valor
  do selo exatamente para o público que o justifica (a empresa conferindo o empregador anterior do freela).
  Um card que não navega também não deveria ser `role="button"` — a correção "barata" custaria a feature.
- **Rota pública sem `ProtectedRoute` (`/p/empresa/:id`)**: o conteúdo é legível por qualquer autenticado,
  mas não é anônimo-público por decisão de produto; tirar do guard mudaria a superfície para `anon` sem
  spec, e brigaria com Article 12.
- **Categoria "rota cross-papel" no `ProtectedRoute`** (ex.: `sharedPaths`): é a solução conceitualmente
  correta e continua na mesa, mas é refactor no arquivo mais sensível do frontend por causa de **um** link
  — desproporcional ao escopo. Reabrir quando houver o terceiro caso; `/recibo/:jobId` (hoje cross-papel
  por ficar fora dos dois layouts) seria o primeiro cliente dessa unificação.

## Referências
- Contrato do builder: `.harness/spec/badges-empresas/ddl-aprovado.md` §2 (DS11) e §2.1
- Spec: `.harness/spec/badges-empresas/spec.md` (R9, A9)
- ADR relacionado: `.harness/memory-bank/decisions/ADR-20260821-badges-historico-de-empresas.md`
- Código: `frontend/src/App.tsx`, `frontend/src/components/ProtectedRoute.tsx:148`,
  `frontend/src/pages/CompanyPublicProfile.tsx`, `frontend/src/components/CompanyBadges.tsx:230`,
  `frontend/src/layouts/CompanyLayout.tsx:25`
- Constitution: Article 1 (isolamento de papel), Article 12 (guard), Article 13 (cor de marca)
