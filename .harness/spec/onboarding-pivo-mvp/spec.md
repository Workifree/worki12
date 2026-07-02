# Onboarding + logout — alinhar ao pivô empresa-primeiro (MVP) — spec

## Context

O usuário relatou, em linguagem direta: (1) ao tentar entrar/cadastrar como freela, o app está
jogando a pessoa como empresa; (2) o botão "Sair" não funciona; (3) a tela de onboarding/landing e a
separação worker/empresa estão "amadoras" e precisam ficar usáveis, funcionais e alinhadas ao pivô
empresa-primeiro (ver `.harness/thesis.md`, [[pivot-company-first-2026]]), cortando tudo que não serve
ao MVP reduzido.

Investigação (Explore agent + leitura direta) confirmou causa-raiz dos dois bugs:

**Bug 1 — papel trocado:** não existe tela de escolha de papel no cadastro em si; o papel vem só da
query string `?type=work|hire` (`Onboarding.tsx` → `/login?type=...`). No signup, isso é gravado
**uma única vez e para sempre** em `user_metadata.user_type` (`Login.tsx:37-45`). No **login** (conta já
existente), `Login.tsx:70-79` **ignora completamente** o `type` da URL e redireciona só pelo metadata
salvo. Como o Supabase Auth exige e-mail único, qualquer pessoa que já tenha uma conta com aquele e-mail
cadastrada com o papel oposto (teste anterior, clique errado, reuso de e-mail) sempre volta pro papel
antigo, **sem nenhum aviso** — bate exatamente com o relato "quero entrar de freela, entra de empresa
direto". Não há UI de troca de papel nem checagem de conflito no onboarding (`WorkerOnboarding.tsx`,
`CompanyOnboarding.tsx` fazem upsert sem validar `user_type`).

**Bug 2 — logout não funciona:** existe **um único** botão "Sair" em toda a base autenticada —
`Sidebar.tsx:143-148` — dentro de `<aside className="hidden md:flex ...">` (`Sidebar.tsx:82`), ou seja,
**invisível em mobile**. `BottomNav.tsx` (usado no celular, canal primário do worker — ver
`product.md`) **não tem nenhum item de logout**. As páginas de perfil (`Profile.tsx`,
`CompanyProfile.tsx`) só chamam `signOut` dentro do fluxo de exclusão de conta, não como logout
avulso. Em desktop, `handleLogout` (`Sidebar.tsx:25-28`) chama `supabase.auth.signOut()` direto
(sem passar por `AuthContext.signOut`), sem try/catch, sem loading/disabled — falha de rede trava o
clique sem feedback algum.

**Desalinhamento de onboarding/landing com o pivô:** `Onboarding.tsx` ainda vende "marketplace" puro —
"+5.000 vagas disponíveis agora", "10k+ Profissionais", grid de categorias, busca de vagas, seção "Como
funciona" com "candidate-se com um clique". A tese (`.harness/thesis.md`) é explícita: **não somos
marketplace de estranhos nessa fase** ("Não-objetivos do piloto"), o wedge é a empresa centralizando
equipe+pagamento+confiança, o freela ganha "carteira de trabalho portátil". A landing hoje comunica o
produto errado e usa métricas fictícias que não existem no piloto real.

## Requirements

- [ ] R1: Sign-in **respeita a conta real**, nunca mistura papel. Se a conta autenticada é `hire` mas o
  usuário chegou via `/login?type=work` (ou vice-versa), mostrar mensagem clara explicando que aquele
  e-mail já está cadastrado com o outro papel, com ação para ir ao dashboard correto ou usar outro
  e-mail — nunca redirecionar silenciosamente sem explicação.
- [ ] R2: Sign-up bloqueia e avisa (mensagem específica, não o genérico "Erro ao fazer login") quando o
  e-mail já existe com o papel oposto, em vez de deixar o erro genérico do Supabase (`User already
  registered`) confundir o usuário sobre por que ele "virou" o outro papel.
- [ ] R3: Botão de logout funcional e acessível em **mobile** (canal primário do worker) — não pode
  existir só no sidebar desktop.
- [ ] R4: `handleLogout` usa `AuthContext.signOut` (fonte única de verdade do estado de auth), tem
  tratamento de erro (toast) e estado de loading — nunca falha em silêncio.
- [ ] R5: Copy da tela de escolha inicial (`Onboarding.tsx`, hero + 2 cards) alinhada ao pivô: sem
  métricas fictícias de marketplace ("10k+", "+5.000 vagas"), mensagem que reflete "empresa centraliza
  sua equipe de freelas de confiança" (lado empresa) e "sua carteira de trabalho portátil" (lado
  freela) — linguagem da tese, nunca "CLT".

## Out-of-scope (deliberado — MVP menor, não maior)

- Reescrever as seções abaixo da dobra da landing (stats de vaidade, grade de categorias, busca de
  vagas, depoimentos, seção "como funciona" com passos genéricos de marketplace). Ficam como estão
  nesta rodada — são follow-up de marketing, não bloqueiam uso real do produto.
- Permitir múltiplos papéis no mesmo e-mail (worker E empresa) — decisão de produto maior, fora do
  escopo deste fix.
- Redesenho completo de `WorkerOnboarding.tsx`/`CompanyOnboarding.tsx` (os formulários em si já
  funcionam e coletam dados corretos); só ajustar se algo colidir com R1/R2.
- QR check-in, grade drag-drop, gamificação nova — já são não-objetivos da tese.

## Acceptance criteria

- [ ] A1: DADO um e-mail já cadastrado como empresa, QUANDO o usuário tenta logar via
  `/login?type=work`, ENTÃO o app mostra aviso claro (não redireciona silenciosamente pro dashboard
  empresa) e oferece ir para `/company/dashboard` ou usar outro e-mail.
- [ ] A2: DADO um cadastro novo com e-mail já existente no papel oposto, QUANDO o submit falha com
  `User already registered`, ENTÃO a mensagem de erro menciona que o e-mail já é usado pelo outro papel.
- [ ] A3: DADO um worker logado no celular, QUANDO ele procura sair da conta, ENTÃO existe uma ação de
  logout visível e funcional na navegação mobile.
- [ ] A4: DADO qualquer usuário (desktop ou mobile) clicando em "Sair", QUANDO `signOut` falha (rede
  instável simulada), ENTÃO o app mostra um toast de erro em vez de travar sem feedback.
- [ ] A5: DADO um visitante não autenticado, QUANDO ele vê a tela inicial de escolha (worker vs
  empresa), ENTÃO a copy não usa números fictícios de marketplace e comunica a proposta do pivô
  (equipe de confiança / carteira de trabalho portátil).

## Clarifications log

- Contexto dado diretamente pelo usuário (sem rodada de perguntas — pedido explícito para usar
  julgamento com base na tese/pesquisa de campo já registradas em memória): fix dos 2 bugs é
  prioridade, onboarding deve refletir o pivô empresa-primeiro, e o MVP deve ficar **menor**, não
  ganhar escopo novo.
