# Plano: visual do celular (390 e 320)

Base: galerias `galeria-depois`, `pos2` e `fundacao` (scratchpad), `revisao-depois.md` e `guia-do-sistema.md`. Imagens citadas como `pasta/arquivo__390`.
Fora deste plano (outros donos): Sidebar, BottomNav, PwaPrompts, `layouts/*`, `components/copilot`, `components/guide`.

## 0. Referências externas (honestidade sobre a pesquisa)

A busca web trouxe pouca especificação concreta; as regras da seção 2 são julgamento de design, ancorado no que se confirmou:

- 7shifts: reforma do app do funcionário com hierarquia mais clara, cartões de onboarding focados e ação principal mais cedo (estudo de caso de portfólio, não revisão formal). https://www.7shifts.com/blog/mobile-app-redesign/ · https://www.designrush.com/best-designs/apps/7shifts-app-design
- Deputy: usuários elogiam a simplicidade de trocar turno e pedir folga; crítica de UI "datada" e carregamento lento (Trustpilot). https://www.capterra.com/p/167811/Deputy/reviews/
- Uber Driver: "clareza antes de esperteza" e telas simples porque o motorista tem a atenção dividida (Uber Design). https://medium.com/uber-design/designing-a-partner-centric-experience-d9900e6511dc
- Nubank: cartões menores com rolagem vertical e cartões com conteúdo e ação do momento (Tecnoblog, Nubank Building). https://tecnoblog.net/368511/nubank-simplifica-interface-do-app-e-adota-cards-na-vertical/ · https://building.nubank.com/building-the-new-mobile-app-header/
- Linear mobile (out/2025): sistema visual novo, foco em hierarquia, equilíbrio e densidade sem poluir. https://linear.app/changelog/2025-10-16-mobile-app-redesign
- Toque: 44 pt (iOS) / 48 dp (Android), 8 dp entre alvos; WCAG 2.2 mínimo 24 px. https://www.uxpin.com/studio/blog/what-is-mobile-ui/

Lição comum: uma ação principal por tela, lista densa em vez de pilha de caixas, cartão só para o que pede ação agora.

## 1. Diagnóstico por tela (o que ainda parece amador, quadrado ou pesado)

Causa raiz transversal: **toda** superfície tem borda preta de 2px e **todo** botão tem sombra offset de 3px (`buttonClasses.ts`, `Card` `default`). Quando tudo grita, nada é principal. A sombra do cartão destacado encosta na borda direita do aparelho (`galeria-depois/freela-telas-inicio__390`, cartão "Você está no turno agora").

### Freela
- **Início** (`freela-telas-inicio__390`): pilha de 7 cartões de mesmo peso, ~2.050px. "Minhas Empresas" e "Nível" gastam um cartão cada para um número (o botão "Ver Empresas" repete a aba da BottomNav). O cartão "Hoje" tem 3 botões de peso parecido (Registrar saída, Falar com a empresa, mais o recibo logo abaixo). Duas sombras (preta e verde) competem. "Histórico recente" é um cartão dentro da página com "Ver tudo" centralizado.
- **Meus Turnos** (`freela-turnos-agendados__390`, `__320`): "Hoje" + "Confirma 28/11" empurram as abas para ~1.000px (D3). Abas cortam "Históri" (D21). "Não vou poder" em 2 linhas. "Cancelar turno" vermelho de largura total com sombra, no mesmo peso de "Falar com a empresa".
- **Recebimentos / recibo** (`freela-telas-carteira__390`; recibo ~2.100px com duas caixas amarelas e IP cru): jurídico antes do dinheiro; ação de confirmar escondida.
- **Mensagens** (`freela-telas-mensagens__390`): um cartão gigante com sombra de 6px envolve uma lista de uma conversa e ~600px de vazio. Cabeçalho "CONVERSAS (1)" em caixa-alta. Avatar genérico cinza. Deveria ser lista de borda a borda.
- **Login / cadastro** (`acesso-login-freela__390`): botão "Voltar" com sombra flutuando acima do cartão; cartão com sombra de 6px num fundo cinza (moldura dentro de moldura); seletor de papel com dois pills pesados; rodapé de links minúsculo e sem área de toque de 44px.
- **Onboarding** (`onboarding-freela-passo1-preenchido__390`): formulário de 7 campos de 48px com borda preta de 2px cada, dentro de um cartão com sombra verde dentro da página (container duplo); "Próximo" pequeno, alinhado à direita, em vez de barra de ação; asterisco vermelho em todo rótulo; `<select>` nativo sem estilo do sistema.

### Empresa
- **Início** (`galeria-depois/empresa-painel-inicio__390`; `fundacao/...-com-equipe__390` é a versão anterior): título de seção quebra ("Turnos em andamento (2)" mais "Ver todos" em 2 linhas); cartão por turno com avatar, nome, data, local, selo e botão de largura total (~190px cada, 4 repetidos); quatro botões idênticos "Registrar chegada" com sombra. KPIs em três caixas com borda preta pesada. A lista "Turnos recentes" (um cartão, `divide-y`, ~73px por linha) é o **padrão certo** e o resto da tela deveria imitá-la.
- **Hoje** (`pos2/equipe-gestor-hoje__390`, `__320`): faixa preta "Hoje | Visão geral" como laje; filtros em 3 linhas de pills; checkbox quadrado em todo cartão mesmo sem seleção; linha "Responsável: Gestor (criado por Você (dona))" repetida; botão com sombra + menu "..." por cartão; "Chamar freelas" muda de peso entre estados (preto cheio, contornado).
- **Turnos** (`fundacao/empresa-turnos-lista__390`): estrutura boa. Pesos: busca de 48px com borda preta de 2px, chips em 2 linhas, avatar quadrado preto "A" com letra branca, "Presença" em pílula verde ao lado do menu, "Encerrados" como texto solto (D17). Cartão ~170px; poderia ser linha de ~96px.
- **Detalhe / Presença e Pagamento** (`pos2/empresa-turnos-detalhe__390`, `empresa-presenca-pagamento-*`): cartão de freela com várias zonas; grade 2/3 + 1/3 vazia em 1440 (D2); modais de confirmação com três arranjos (D6).
- **Dados da empresa** (`pos2/empresa-perfil-editando__390`): Salvar e Cancelar no topo, ~3.200px antes dos campos (D8); e-mail cortado (D9).
- **Mensagens da empresa**: mesmo problema do freela (cartão envolvendo lista).

### Público
Landing/Sobre com cabeçalhos diferentes (D22); Esqueci/Nova senha com outra casca (D15); papel errado com dois botões fortes (D16). Aqui o "quadrado" vem da casca: cartão com sombra sobre fundo, Voltar solto.

## 2. Regras de design mobile (neo-brutalismo refinado)

Princípio: **o preto estrutural fica, mas vira acento e não moldura de tudo.** Hierarquia por peso e espaço; sombra só onde há ação.

1. **Borda.** Dois níveis, não três. Controle interativo (botão, campo, chip ativo) e o cartão em foco: `1.5px` preto (token novo `border-ink`, definido em `tailwind.config.js`; sem `border-[..]` solto). Todo o resto: sem borda, ou `1px gray-200`; separação por `divide-y gray-200` e por espaço. `border-2` fica só no foco do campo.
2. **Sombra.** Só dois valores: `brutal-xs` (2px 2px, botão primário e cartão em foco) e nenhuma. Remover sombra de botão secundário, de cartão comum, de campo e de menu em repouso. Em foco o campo ganha anel, não sombra. No máximo **1 elemento com sombra por dobra**. Sombra nunca pode encostar na borda do aparelho (margem lateral de 16px, sombra de 2px cabe).
3. **Raio.** Cartão/diálogo `rounded-2xl` (16), controle e aviso `rounded-xl` (12), selo e chip `rounded-pill`. Avatar de pessoa redondo; avatar de empresa `rounded-xl`. Fim de cantos "caixa preta" de 8px.
4. **Espaçamento (grade de 4).** Gutter da página 16; entre seções 24; entre itens de uma seção 12; padding de cartão 16; linha de lista 64px (40px de avatar + 12 + texto); espaço entre alvos de toque ≥ 8.
5. **Tipografia.** Título de página 24/bold (só `PageHeader`); título de seção 16/semibold **sem ícone** (ícone só no estado vazio e em alerta); corpo 14; meta 13 `gray-600`; número de destaque 28 `tabular-nums`; sem caixa-alta e sem `font-black`. Nome longo `line-clamp-2` com `min-w-0`; nunca `block` junto de `line-clamp` (D1).
6. **Cor de ação.** Um primário por dobra: freela verde `primary-dark` com texto branco; empresa preto. Secundário: contornado, plano (sem sombra). Terciário: texto com área de 44px ("Ver todos", "Ver perfil"). Vermelho só no botão final do diálogo; abrir a ação destrutiva é `dangerOutline` pequeno ou item de `Menu`, nunca botão de largura total no cartão.
7. **Cartão x lista.** Cartão só para o que pede ação agora (no máximo 1 em foco + até 2 de aviso por tela). O resto vira **grupo de lista**: um contêiner, linhas com `divide-y`, chevron à direita. Número isolado (Nível, Empresas, Total) vira faixa de métricas de uma linha (3 colunas, sem borda individual) ou linha de lista, nunca um cartão por número.
8. **Linha de turno.** Esquerda: horário em negrito + título; abaixo: local ou pessoa (1 linha, truncado); direita: `StatusBadge` ou botão `sm` (36px visual, 44px de toque). Ação por item: no máximo 1 visível, o resto no `Menu`. Sem checkbox visível fora do modo seleção.
9. **Barra de ação inferior.** `ActionBar` para concluir formulário ou detalhe (1 primário + 1 secundário curto), com `env(safe-area-inset-bottom)`. Proibido "Salvar" no topo (D8) e `fixed bottom-*` próprio.
10. **Formulário.** Uma coluna, a página É o formulário (sem cartão dentro de cartão). Rótulo acima, 14 semibold `gray-900`; **marque o opcional**, não o obrigatório (sem asterisco). Campo 48px, `rounded-xl`, borda `1.5px gray-900`, foco com anel. Agrupe campos com título de grupo (16) e 24px entre grupos. Mensagem de erro sob o campo com ícone, não só cor. `Field` e `select` do sistema (estilizar o select).
11. **Chips e abas.** Uma linha só: rolagem horizontal com esmaecimento na borda (máscara de 24px), nunca quebra em 2 ou 3 linhas (D20, D21). Chip 36px visual, área de toque 44. Aba ativa por sublinhado de 2px + peso, não pílula preta de laje.
12. **Estado vazio e erro.** Sem caixa: ícone 40, título, uma frase, **uma** ação. Erro de carga com `ErrorState` e "Tentar de novo".
13. **Densidade de dobra.** Em 390x844, a primeira dobra mostra o título, a ação principal e ≥ 3 itens de conteúdo. Cartão "Hoje" do freela ≤ 260px; linha de turno ≤ 96px.
14. **Toque.** Todo alvo ≥ 44x44 (ícone de 20 dentro de 44); 320px sem rolagem horizontal; texto nunca quebra por letra (`min-w-0`, `[overflow-wrap:anywhere]` só em texto livre).

## 3. Plano de execução (4 agentes paralelos, nenhum arquivo repetido)

Ordem de impacto: o Agente 1 muda o peso de **todas** as telas de uma vez e deve começar primeiro; 2 e 3 (telas mais usadas) rodam em paralelo com ele e só consomem tokens e classes. Ninguém edita arquivo de outro lote; testes compartilhados (`pages/__tests__`, `testerRodada*`) vão como relato ao orquestrador. Sem mudança de regra, query ou texto jurídico.

### Agente 1: fundação mobile (alavanca máxima)
**Arquivos:** `tailwind.config.js` (tokens `border-ink`, `brutal-xs`), `index.css`, `components/ui/{Button,buttonClasses,Card,ListRow,Tabs,FilterChip,StatusBadge,ActionBar,Field,EmptyState,ErrorState,PageHeader,Alert,Dialog,DialogParts,ChoiceCard,Menu}.tsx` (+ testes ao lado), `lib/statusLabels.ts` (só se faltar tom).
**Faz:** regras 1 a 6, 9, 11, 12: borda 1.5px, sombra só em `primary`/`dark`/`highlight` (`xs`), secundário plano, raios, `Tabs` e `FilterChip` com rolagem + máscara, `ActionBar` com safe area, `DialogActions` único (D6), `Card` ganha `tone="flat"` (sem borda) e `ListRow` 64px com chevron; `Field` sem asterisco (prop `optional`). Avisar o orquestrador de qualquer teste que dependa de classe.
**Critérios (galeria 390/320):** a sombra aparece em no máximo 1 botão por dobra; nenhum elemento com sombra a < 12px da borda; nenhum `border-2` fora de foco de campo (grep); 0 chips/abas quebrando em 2+ linhas; alvos ≥ 44px; build, lint e vitest verdes.

### Agente 2: empresa, operação (Início, Hoje, Turnos)
**Arquivos:** `pages/company/{CompanyDashboard,CompanyToday,CompanyJobs,CompanyJobDetails,CompanyCreateJob,CompanyJobCandidates,CompanyMessages}.tsx`; `components/company/{CancelJobModal,CancelSeriesModal,CoverageModal,EditSeriesModal,InviteSeriesModal,PassJobsModal,TagsPanel,CreateShiftLink,TrailShortcutCard}.tsx`; `components/team/{ShiftCallModal,ShiftCallsPanel,SosCallButton,InviteToShiftModal}.tsx`; `components/JobLifecycleStepper.tsx`.
**Faz:** prioridade 1 **Início** (regra 7/8: KPIs em faixa de 3 colunas sem borda individual; "Turnos em andamento" e "Contratados" viram **um grupo de lista** com linha de ~80px, um botão `sm` por linha; "Ver todos" com 44px e sem quebra; recentes já no padrão); 2 **Hoje** (chips em 1 linha rolável, "Responsável" só quando diferente do usuário, checkbox só no modo seleção, 1 ação visível + `Menu`, tira "Hoje | Visão geral" vira `Tabs` sublinhadas); 3 **Turnos** (linha de ~96px, busca 44px 1.5px, "Encerrados" igual a "Anteriores"); 4 detalhe, criar turno (`ActionBar`), D2, D5, D7, D17, D18, D20; Mensagens da empresa em lista de borda a borda.
**Critérios:** Início 390 ≤ 1.300px de altura (hoje ~1.980); ≤ 1 botão com sombra por dobra; linha de turno ≤ 96px; Hoje 320: primeiro turno começa < 520px (hoje ~650); nenhum título de seção quebra; 0 `font-black`, 0 `shadow-[`, 0 `<button>` cru.

### Agente 3: freela (Início, Meus Turnos, Recebimentos, Mensagens)
**Arquivos:** `pages/{Dashboard,MyJobs,MeusRecebimentos,ReceiptView,Messages,Notifications,CarteiraClientes,CompanyPublicProfile,Profile}.tsx`; `components/{TodayShiftCard,InviteTakeover,JobCard,RateModal,LocalDoTurno,ServiceTermSection,MyCertificationsSection,CompanyBadges,ProfileReviews}.tsx`.
**Faz:** 1 **Início** (cartão "Hoje" é o único em foco, com 1 primário verde e "Falar com a empresa" como terciário; "Pagamento para confirmar" como aviso de 1 linha + botão; Ganhos, Empresas e Nível numa faixa de métricas de 3; Histórico como grupo de lista; ~900px); 2 **Meus Turnos** (D3: cartão Hoje compacto ≤ 260px, véspera numa linha com 2 botões lado a lado sem ícone, convite disputado acima das abas, abas rolantes, "Cancelar turno" em `Menu`, D1, D11); 3 **Recebimentos** e recibo (dinheiro e ação primeiro, jurídico recolhido em `<details>`, IP/UA fora da vista); 4 **Mensagens** (lista de borda a borda, avatar com inicial, hora e prévia, sem caixa-alta); Notificações (D13), D4, D12, D10 no modal de certificação.
**Critérios:** Início 390 ≤ 1.000px; abas visíveis < 700px em `freela-turnos-*__390` e < 800px em `__320`; "Sim, vou"/"Não vou poder" em 1 linha a 320; nenhum cartão que embrulhe uma lista; recibo com valor + botão de confirmar acima da dobra; sem rolagem horizontal a 320.

### Agente 4: entrada, formulários e pessoas da empresa
**Arquivos:** `pages/{Login,ForgotPassword,ResetPassword,Onboarding,InviteAccept,AcceptTeamInvite,AcceptManagerInvite,LandingPage,Help,NotFound}.tsx`; `pages/worker/WorkerOnboarding.tsx`; `pages/company/{CompanyOnboarding,CompanyProfile,CompanyTeam,CompanyTeamMembers,CompanyReferrals,WorkerPublicProfile}.tsx`; `components/{TosGateModal,AuthShell}.tsx` (novo, local); `components/team/{AddWorkerModal,MemberCard,PendingCard,RemoveMemberDialog,TeamListModal}.tsx`.
**Faz:** 1 **Login/cadastro/senha** numa só casca `AuthShell` (sem moldura dupla: página branca no celular, sem sombra de cartão; "Voltar" como link de ícone no topo; seletor de papel como controle segmentado; rodapé com alvos de 44px; D15, D16); 2 **Onboarding freela e empresa** (a página é o formulário; título de grupo; sem asterisco, "opcional" marcado; `select` do sistema; `ActionBar` com "Próximo" em largura total; passo com barra); 3 **Dados da empresa** com `ActionBar` (D8, D9); 4 Elenco e Equipe (linha de 64–72px, PIX fora da vista no celular, `Menu` por pessoa, D4/D20 de perfil do freela), Landing (D22).
**Critérios:** login 390 sem cartão com sombra e com "Entrar" visível sem rolar; onboarding passo 1 ≤ 1.000px com `ActionBar` ao fim; 0 asterisco vermelho; 0 campo com altura < 44; Dados da empresa: "Salvar" só na `ActionBar`; Elenco ≤ 72px por pessoa (hoje ~190); sem rolagem horizontal a 320 (D10).

### Verificação de todos
`npm run build`, `lint`, `vitest run`; refotografar com `scripts/galeria-telas` (`dobra: true` e `verificar`) em 390 e 320 e conferir os critérios numéricos acima por script (altura da página, contagem de elementos com `box-shadow` não nulo por dobra, menor alvo de toque, `scrollWidth <= innerWidth`). Revisor independente compara com `galeria-depois`.

### Ordem e risco
1. Agente 1 primeiro (ou em paralelo, mas os outros só validam a foto depois dele). 2. Agentes 2 e 3 (telas mais usadas). 3. Agente 4. Risco: testes que checam classe de `Button`/`Card` quebram com o Agente 1 (ele corrige os de `components/ui`; os de página vão ao orquestrador). Itens de texto, jurídico e dados novos seguem marcados **[spec]** nos documentos anteriores e ficam fora.
