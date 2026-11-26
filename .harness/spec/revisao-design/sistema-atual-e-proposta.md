# Sistema de design do Worki: estado atual e proposta

> Auditoria estática de `frontend/src` (25/11/2026, branch `feat/equipe-encarregados`). Nenhum código foi alterado.
> Identidade mantida (Article 13): borda preta 2px, sombra offset sólida, cor por papel. O objetivo é acabamento.
>
> **Método:** 211 arquivos `.ts/.tsx`, sem testes e sem `components/ui/` (salvo quando citado). Parser de tags JSX e regex
> sobre classes literais. Classes guardadas em constantes não entram nos recortes por elemento (por isso os recortes de
> `<button>` não somam 104). Contagens são de ocorrências no código, não de telas renderizadas. Contraste calculado pela
> fórmula WCAG. A animação morta foi confirmada compilando o Tailwind. Não houve inspeção visual no navegador.
> Guias usados (modern-web-guidance): motion, physics-based-easing, animate-element-entry-exit,
> animate-to-from-top-layer, natural-interactions, spinner, progress, color, typography.

---

## 1. Diagnóstico

### 1.1 Resumo

A fundação existe e está bem adotada (87 arquivos importam `components/ui`; 346 `<Button>`). A inconsistência está em
três lugares: (a) o que não tem primitivo (selo, vazio, loading, card de aviso), (b) telas que ficaram de fora
(Admin e bônus), (c) movimento, que não tem regra e em parte não funciona.

### 1.2 Botões

| Medida | Número |
|---|---|
| `<Button>` | 346 em 77 arquivos |
| `<button>` com classes à mão | 104 em 45 arquivos, **79 assinaturas de `className` distintas** |
| `<IconButton>` | **2 usos** |
| `<Link>`/`<a>` estilizados como botão | 7 |
| Variantes em `Button` | secondary 115, dark 111, ghost 58, danger 19, primary 19 (+10 por padrão), dinâmica 14 |
| Tamanhos em `Button` | md 219, **lg 119 (34%)**, sm 8 |
| `Button` com `className` | 138 (40%) |
| Linhas com `!important` em primitivos | 19 (proibido pelo design-system); 13 são `w-11 !px-0`, um `IconButton` improvisado |

Nos `<button>` crus (só classes literais):
- Raio: `xl` 49, `full` 5, `lg` 4, `pill` 2, `2xl` 2.
- Altura: `min-h-11` 32, `h-11` 21, `min-h-[44px]` 3, `min-h-14` 2, `min-h-16` 2, `min-h-[36px]` 1, `h-8` 1. Cinco têm `py-2` ou menos sem altura de 44px.
- Peso: black 16, bold 12, semibold 9. Caixa-alta em 17.
- Fundo: 9 diferentes. 37 sem `type` explícito.
- Sombra: nenhum tem a sombra da moldura canônica. `hover:` em 78, `focus*` em 35, `active:` em **0**.

Concentração: `CompanyJobs` 12, `EnrollmentsPanel` 6, `CompanyJobDetails` 6, `PayoutList` 5, `Admin` 4, `LandingPage` 4.
Sem nenhum primitivo: `admin/bonus/*` (5 arquivos), `Admin.tsx`, `analytics/ErrorBanner`, `ToastContext`. Em
`admin/bonus` e `ErrorBanner` sobrevive o botão legado `font-black uppercase bg-black hover:bg-primary`.

Cor por papel: nas pastas e componentes de empresa não há `Button variant="primary"`. A regra está sendo cumprida.

Primário por tela: o código não garante "um por tela". Botões sólidos (`dark`/`primary`) por arquivo:
`CompanyJobCandidates` 18, `AcceptTeamInvite` 10, `CompanyTeamMembers` 10, `CompanyToday` 7, `MyJobs` 6. A contagem
é por arquivo e inclui modais e etapas excludentes, mas cards repetidos em lista multiplicam o sólido na tela.

### 1.3 Raio, borda, sombra

- **Raio:** 650 usos, 14 variantes. `xl` 333, `2xl` 111, `full` 89, `pill` 65, sem sufixo 28, `lg` 11. `rounded-full` e `rounded-pill` são redundantes.
- **Borda:** `border-2` 327 contra `border` (1px) 38, além de 4 e 8px pontuais. 33 cores: black 291, gray-200 77, gray-300 55, gray-100 22, e cerca de 20 tons de status.
- **Sombra:** 68 ocorrências arbitrárias em **12 combinações** (3, 4, 6 e 8px × preto, verde, azul, amarelo, vermelho). Mais usadas: 6px preta 16, 4px preta 15, 3px preta 8, 4px verde 8. Os tokens `shadow-glass` e `shadow-float` têm **0 usos**.

### 1.4 Tipografia

- **Tamanhos:** sm 510, xs 432, lg 163, 2xl 61, base 61, xl 60, 3xl 17, 4xl 8, 5xl 4, 6xl 2, 7xl 1, `[13px]` 1.
- **Pesos:** bold 568, semibold 212, **black 162**, medium 25, normal 8.
- **Caixa-alta:** 123 ocorrências.
- **h1** (25 fora do `PageHeader`, que aparece 31 vezes): 8 combinações de tamanho, peso e caixa (19 assinaturas de classe).
- **h2** (130): 12 combinações. O canônico `text-lg font-bold` tem 72; `text-xl font-black` (com ou sem caixa-alta) soma 28.
- **h3** (76): 10 combinações. `text-lg font-bold` (36) é igual ao h2 canônico, então a hierarquia some.

### 1.5 Cor

- 1.738 usos da paleta crua do Tailwind, 99 classes distintas. Por família: gray 1.176, red 192, yellow 152, blue 97, green 66, amber 17, orange 15, purple 12, sky 2.
- Tokens `primary`/`accent`: 219 usos. **Não há token semântico de status.**
- `#F4F4F0` hardcoded 25 vezes; o `html` usa `#F5F7F5`. São dois fundos quase iguais.
- Contraste:

| Par | Razão | Situação |
|---|---|---|
| `#00A651` sobre branco (`text-primary`, 50 usos) | 3,19 | reprova para texto normal |
| `#00A651` sobre `primary-light` | 2,85 | reprova até para ícone (3:1) |
| `#008840` sobre `primary-light` | 4,08 | reprova para texto pequeno |
| `gray-400` sobre branco (18 usos de `text-gray-400`) | 2,54 | reprova |
| `gray-300` sobre branco (22 usos) | 1,47 | aceitável só se decorativo (não verificado um a um) |
| `yellow-600` sobre branco (5 usos) | 2,94 | reprova |

### 1.6 Ícones

- Só `lucide-react`: 116 ícones distintos, 483 importações. Nenhum emoji em componentes (3 ocorrências em services e types).
- **18 tamanhos** no atributo `size`: 16 (159), 18 (138), 20 (104), 14 (68), 12 (47), 28, 22, 32, 40, 24, 48, 10, 13, 30, 11, 36, 44, 200.
- Sinônimos: `Check` 17, `CheckCircle2` 13, `CheckCircle` 5.

### 1.7 Cards, selos, campos

**Cards:** 112 `<Card>` em 54 arquivos contra **109 caixas à mão em 32 combinações** de raio, borda, cor e sombra.
Maiores: `Admin` 14, `WorkerPublicProfile` 10, `ServiceTermSection`, `Login` e `ReceiptView` 4.

**Selos de status:** 93 pílulas inline em 35 arquivos, **87 assinaturas distintas** (pill 58, full 25, xl 5, sem sufixo 5;
29 com borda). A heurística (`px` + `py` + `text-xs`) pega também alguns chips não clicáveis que não são status.
Implementações locais paralelas: `StatusChip` (JobCandidates), `StatusLine` e `AwaitingBadge` (MyJobs), `StatusBadge`
(OrdersReport e Referrals, duas definições), `STATE_BADGE` (TeamMembers), `BusyWorkerBadge`, e `getStatusColor` +
`getStatusLabel` duplicados em `Messages` e `CompanyMessages`. Efeito concreto: "recusado" é **vermelho** no chat e
**cinza** nas Indicações.

**Campos:** dos campos textuais, 108 estão em `<Field>`, 6 usam `FIELD_CONTROL_CLASS` e **24 são à mão**
(`EnrollmentsPanel` 6, `Admin` 5, `VetosAndParams` 4, `Profile` 2 e 7 arquivos com 1). A base está boa.
Há dois padrões de foco: `focus:ring-*` (campos) e `focus-visible:ring-*` (botões).

### 1.8 Modais

- 27 `<Dialog>` e 21 `<ModalShell>`. Existem **três `ModalShell`**: `components/ModalShell.tsx`, `components/team/ModalShell.tsx` e um local em `CompanyJobCandidates.tsx`. Os três usam o `Dialog` por baixo.
- A casca (top layer, foco, Esc, rolagem, safe-area) é sólida.
- `worki-dialog-actions` aparece em 16 pontos de 12 arquivos; os demais modais não têm rodapé fixo garantido.
- Ordem dos botões: nos rodapés amostrados, secundário vem primeiro e o principal à direita. Só `RemoveMemberDialog` usa `flex-col-reverse` no celular.

### 1.9 Estados vazios, carregamento, progresso

- **Vazio:** 30 blocos `border-dashed` em 22 arquivos, com `py-8/10/12/16`, `rounded-xl` ou `2xl`, borda `gray-200` ou `gray-300`, com e sem fundo, ícone e ação. O único `EmptyState` é local, em `MyJobs`.
- **Erro:** `ErroDeCarga` existe e é bem adotado (28 usos em 24 arquivos). É o modelo a seguir.
- **Skeleton:** `animate-pulse` em 67 linhas de 48 arquivos, todos desenhados à mão. Não há `Skeleton`.
- **Spinner:** `animate-spin` em 16 linhas de 11 arquivos (`Admin` 5), além do spinner interno do `Button`. Não há `Spinner` exportado.
- **Progresso:** 0 `<progress>`. 5 barras com `div` + `width` inline (TrackingPanel, Roadmap, CallsBreakdown, Dashboard, Profile), mais as barras de força de senha. A semântica ARIA de cada uma não foi verificada.

### 1.10 Movimento

**Achado principal: parte da animação do app não existe.** `animate-in` (24) e os modificadores `fade-in`,
`slide-in-from-*`, `zoom-in-95` (41 tokens) dependem de `tailwindcss-animate`, que **não está instalado**
(`plugins: []`, ausente do `package.json`). O CSS compilado tem zero regras para eles. `duration-400` (6) também não
existe no Tailwind 3. Atinge as entradas de página (JobCandidates, CompanyJobs, Dashboard da empresa etc.) e a troca
de etapa nos onboardings. O `design-system.md` documenta essas classes como disponíveis.
**Não instalar o plugin:** isso ligaria 24 animações nunca vistas, sem guarda de movimento reduzido. Remover.

| Item | Número | Observação |
|---|---|---|
| `transition-colors` | 87 | correto |
| `transition-all` | 9 fora de `ui/`, mais `Button` e `Card` | anima qualquer propriedade, inclusive layout |
| `transition-opacity` / `-transform` / `-[width]` | 4 / 3 / 1 | |
| Duração explícita viva | 150 (6), 300 (4), 200 (1), parte dos 500 | o resto usa o padrão 150ms; os `duration-500/400` junto de `animate-in` não têm efeito visível |
| Easing explícito | **1** (`ease-in`) | não há token |
| `animate-pulse` | 68 | sem guarda de movimento reduzido |
| `animate-spin` | 16 | sem ajuste (o certo é desacelerar, não parar) |
| `animate-bounce` | 6 | "digitando" nos dois chats, sem guarda |
| `animate-slide-in` | 4 | keyframe usa `transform`; sem guarda |
| `animate-marquee` | 1 | `Onboarding.tsx`: **20s infinito, sem pausa e sem reduced-motion** (falha WCAG 2.2.2) |
| Confete | `CelebrationBanner`, 36 peças | só `transform`/`opacity`, **respeita reduced-motion** (lido só na montagem) |
| Guardas `motion-reduce`/`motion-safe` fora de `ui/` | 7 linhas em 6 arquivos (com o confete) | o `Button` tem a guarda; o `IconButton` também |
| Hover que desloca ou escala | 7 fora de `ui/`, mais `Button` e `Card` | `hoverOnlyWhenSupported` já evita hover preso no toque |
| Anima layout | `Roadmap` (`width`), barras de senha em `Login` e `ResetPassword` (`transition-all` + largura) | pouco impacto |
| `:active` | **só o `Button`** | faltam IconButton, Card clicável, BottomNav, SectionTabs, chips e os 104 crus. Fica só o realce padrão do navegador, que não foi customizado |
| Foco | 35 dos 104 crus declaram estilo de foco | os demais usam o anel padrão do navegador (não é removido). **Nenhum controle com `outline-none` sem substituto** |
| `Dialog` | sem entrada nem saída | desmonta na hora |
| Toast | sem entrada nem saída | aparece e some seco |
| Rolagem suave | 2, com `motion-safe` | correto |

### 1.11 Posição das ações

Cinco soluções fixas convivem: `BottomNav` (z-50), FAB "criar turno" no `CompanyLayout` (z-30), botão flutuante em
`CompanyToday` (z-40), barra de salvar em `Profile` (z-60, **cobre a BottomNav**) e o rodapé sticky do `Dialog`.
`PageHeader.action` é o padrão no topo, mas não há regra sobre quando usar topo, FAB ou barra fixa.
Há 10 valores de `z-index` (10 a 100).

### 1.12 Documentação e resíduos

- `design-system.md` mistura duas gramáticas (legado nas seções 1 a 10, "escala refinada" depois).
- Cita `EscrowStatusBadge` e `JobCard`, que não existem em `components/`.
- Ensina o modal em `div` com `animate-in`, já substituído pelo `Dialog`.
- `src/App.css` não é importado (resíduo do template Vite).
- `shadow-glass` e `shadow-float` não têm uso; de `glass.*` só resta `bg-glass-surface/90` no cabeçalho do `MainLayout`.

---

## 2. Proposta: regras fechadas

Princípios: a moldura brutalista marca **o que é interativo ou principal**; status e metadado são discretos. Primeiro o
primitivo, depois a tela. Tela migrada não escreve classe de botão, selo, vazio, card ou campo.

### 2.1 Tokens

`tailwind.config.js` (somar em `extend`; remover `shadow-glass` e `shadow-float` já; remover `glass` depois que o lote A trocar o cabeçalho do `MainLayout` por `bg-white/90`):

```js
colors: {
  canvas: '#F4F4F0',
  status: {
    neutral: { bg: '#f3f4f6', fg: '#374151', line: '#d1d5db' }, // 9,37:1
    info:    { bg: '#eff6ff', fg: '#1e40af', line: '#bfdbfe' }, // 8,01
    success: { bg: '#f0fdf4', fg: '#166534', line: '#bbf7d0' }, // 6,81
    warning: { bg: '#fefce8', fg: '#854d0e', line: '#fde047' }, // 6,62
    danger:  { bg: '#fef2f2', fg: '#991b1b', line: '#fecaca' }, // 7,60
  },
},
boxShadow: {
  'brutal-sm':    '3px 3px 0 0 #000',     // controles, toast
  'brutal':       '4px 4px 0 0 #000',     // hover de controle, card em destaque
  'brutal-lg':    '6px 6px 0 0 #000',     // dialog
  'brutal-brand': '4px 4px 0 0 #00A651',  // destaque do freela (convite)
},
transitionDuration: { press: '80ms', fast: '150ms', base: '200ms', exit: '150ms' },
transitionTimingFunction: {
  standard: 'cubic-bezier(.2,0,0,1)',
  enter:    'cubic-bezier(0,0,0,1)',
  exit:     'cubic-bezier(.3,0,1,1)',
},
```

| Token | Regra |
|---|---|
| Espaçamento | múltiplos de 4px. Dentro do controle `gap-2`; grupo `gap-3`; entre cards `gap-4`; entre seções `space-y-6` (`space-y-8` em tela longa). Padding de card só pela prop `padding`. Evitar meios passos (`1.5`, `2.5`) em layout |
| Raio | **3 valores:** `rounded-xl` (controle, aviso, card aninhado), `rounded-2xl` (card, dialog), `rounded-pill` (selo, chip, FAB). `rounded-full` só em avatar, ponto e barra. Proibidos `lg`, `3xl`, sem sufixo |
| Borda | `border-2 border-black`: controle, card de 1º nível, dialog, toast. `border-2 border-gray-200`: card aninhado e item de lista dentro de card. `border border-status-*-line`: selo e aviso. `border` 1px cinza: divisor |
| Sombra | **3 níveis** (`sm`, padrão, `lg`) mais `brutal-brand`. Card em repouso não tem sombra. Sem sombra azul, amarela, vermelha ou de 8px: status se comunica por selo ou aviso, não por sombra |
| Fundo | `bg-canvas` no app, branco no card. Trocar os 25 `#F4F4F0` e alinhar o `html` |
| z-index | conteúdo fixo da página 30; BottomNav e Sidebar 50; dialog 70; toast 80; skip link 90. Nada mais. A barra de ações fica **acima** da BottomNav no espaço, não por cima dela |
| Ícone | lucide, `size` **16** (texto, botão), **20** (navegação, IconButton), **24** (destaque), **40** (vazio, erro). Selo usa 14. Um só "sucesso": `CheckCircle2`; `Check` só para item marcado |

**Tipografia** (6 papéis):

| Papel | Classe |
|---|---|
| Título de página | só `PageHeader`: `text-2xl sm:text-3xl font-bold tracking-tight` |
| Título de seção (h2) | `text-lg font-bold` |
| Título de card (h3) | `text-base font-bold` |
| Corpo | `text-sm` (`text-base` em leitura longa) |
| Meta | `text-xs text-gray-600` |
| Número de destaque | `text-2xl font-bold tabular-nums` |

Pesos: 400, 600, 700. `font-black` só na marca e nos heróis da LandingPage e do Onboarding. Caixa-alta só em rótulo
curtíssimo de eyebrow (`text-xs font-semibold uppercase tracking-wide`), nunca em botão, título ou frase. Pela guia de
typography: fonte em `rem` (eliminar `text-[13px]`), altura mínima (`min-h`) e nunca fixa em contêiner com texto,
`text-balance` em título sem caixa visível, parágrafo longo com `max-w-prose`.

**Cor:** verde de marca `#00A651` é preenchimento decorativo, barra e borda. **Texto e ícone verdes usam um tom novo
`primary.ink: '#006b33'`** (6,66:1 no branco; 5,95:1 sobre `primary-light`) ou `status-success-fg`. Texto mínimo é
`gray-600`; `gray-500` só em placeholder; `gray-300/400` só em ícone decorativo com `aria-hidden`.

### 2.2 Status semântico

Fonte única em `lib/statusTone.ts`: `(domínio, status) -> { tone, label, icon }`, para `application`, `shiftCall`,
`payment`, `invite`, `member`, `certification`, `referral`, `job`.

| Tom | Significado | Exemplos |
|---|---|---|
| neutral | encerrado sem problema | recusado, cancelado, expirado, estornado, arquivado |
| info | agendado ou informativo | convite enviado, pagamento agendado |
| warning | **alguém precisa agir** | aguardando confirmação, confirmar recebimento, venceu convite pendente de reenvio, conflito de horário |
| success | resolvido ou confirmado | contratado, concluído, pago e confirmado |
| danger | falha ou bloqueio | não vai comparecer, bloqueado, certificação vencida |

Recusa é **neutral** (é neutra no produto, R6/R7). Selo sempre tem texto; cor nunca é o único sinal.

### 2.3 Hierarquia de botões

| Nível | Variante | Regra |
|---|---|---|
| Primário | `primary` (freela) ou `dark` (empresa) | **no máximo 1 visível por contexto** (tela ou dialog). Em lista repetida, o botão do card é `secondary`; só o item que exige ação agora (o primeiro pendente ou o bloco "Agora") pode usar sólido |
| Secundário | `secondary` | alternativas, ação por item, "Voltar" |
| Terciário | `ghost` | baixa prioridade, "ver mais", cancelar fora de dialog |
| Destrutivo | `danger` sólido | **somente na confirmação final** |
| Destrutivo que abre confirmação | novo `dangerOutline` | na lista ou no card |
| Só ícone | `IconButton` | `aria-label`; proibido `Button className="w-11 !px-0"` |
| Navegação | `ButtonLink` (novo) | `<Link>` com a aparência do botão; navegação nunca é `<button>` |

Tamanhos: `md` (44px) é o padrão; `lg` (48px) **só** para o CTA único de rodapé, onboarding e autenticação; `sm` só em
tabela densa no desktop. Ícone 16px à esquerda, um por botão; ícone à direita só em avanço (seta). Rótulo com verbo e
objeto ("Confirmar presença"), sem caixa-alta. Carregando: `loading` mantém o rótulo (não trocar por texto só).
Botão em `className` aceita **apenas layout** (largura, flex, margem, ordem).

Exceções que continuam `<button>` próprio, todas dentro de um primitivo: aba (`Tabs`), chip de filtro (`FilterChip`),
linha clicável (`ListRow`), nav.

### 2.4 Posição das ações

| Contexto | Celular (< 640px) | Desktop |
|---|---|---|
| Ação principal de lista ("Criar turno") | FAB (`Fab`), acima da BottomNav | `PageHeader.action`, topo à direita. Nunca os dois visíveis |
| Concluir formulário ou detalhe longo | `ActionBar` fixa **acima** da BottomNav, principal ocupa a largura | `ActionBar` estática no fim do conteúdo, alinhada à direita |
| Dialog, 2 ações curtas | lado a lado, `flex-1`, secundário à esquerda | alinhadas à direita, secundário e depois principal |
| Dialog, rótulos longos ou 3 ações | empilhadas, principal no topo (`flex-col-reverse`) | linha à direita |
| Ação por item | rodapé do card, no máximo 2 visíveis; o resto em "Mais" | à direita da linha |
| Destrutiva de página | no fim, separada por divisor | igual; nunca ao lado da principal sem separação |

Ordem no DOM sempre secundário e depois principal. `DialogActions` encapsula isso e aplica `worki-dialog-actions`.
Uma tela tem FAB **ou** ActionBar, nunca os dois; `html:has(...)` ajusta o `scroll-padding-bottom` (já feito para o FAB).

### 2.5 Componentes

**Já existem** em `components/ui`: `Button`, `IconButton`, `Card`, `PageHeader`, `Field` (e classes), `Dialog`, `cx`.
Fora de `ui/`: `ErroDeCarga`, `SectionTabs`, `ToastContext`, 3 `ModalShell`.

| Criar ou ajustar | API mínima | Substitui |
|---|---|---|
| `Button` ajuste | `dangerOutline`; `transition-[transform,box-shadow,background-color,color]` no lugar de `transition-all`; exportar `buttonClasses()` | |
| `ButtonLink` | props do `Link` + `variant`, `size`, `fullWidth` | 7 links estilizados |
| `IconButton` ajuste | `active:scale-95` | `w-11 !px-0` |
| `Card` ajuste | `tone="default"/"nested"/"highlight"`; `active:` quando clicável | 109 caixas, `!border-*` |
| `StatusBadge` | `tone`, `icon?`, `children`; ou `domain` + `status`. `rounded-pill border text-xs font-semibold px-2.5 py-1`, sem sombra e sem borda preta (não parece botão) | 93 pílulas e as definições locais |
| `Alert` (aviso inline) | `tone`, `title?`, `action?`, `role` | caixas amarelas, azuis e vermelhas à mão |
| `EmptyState` | `icon`, `title`, `description?`, `action?`, `size="inline"/"page"`. `border-2 border-dashed border-gray-300 rounded-2xl`; `py-8` ou `py-12` | 30 tracejados |
| `ErrorState` | mover `ErroDeCarga` para `ui/`, mantendo reexport | `ErrorBanner` |
| `Spinner` | `size`, `label` (`role="status"`). `motion-reduce` **desacelera** | 16 `animate-spin` |
| `Skeleton`, `SkeletonList` | `className`, um `role="status"` por bloco; `motion-safe:animate-pulse` | 67 `animate-pulse` |
| `ProgressBar` | `<progress>` nativo estilizado, `value`, `max`, `label` | 5 barras |
| `DialogHeader`, `DialogActions` | título + fechar; layout do 2.4 | 3 `ModalShell` |
| `ActionBar`, `Fab` | `primary`, `secondary?` | 3 soluções fixas |
| `ListRow` | `leading`, `title`, `meta`, `trailing`, `onActivate`/`to` | linhas clicáveis cruas |
| `FilterChip`, `Tabs` | `pressed`/`selected`, teclado (`lib/tabsKeyboard`) | chips e abas de 4+ telas |
| `ChoiceCard` / `ToggleChip` | `pressed`, `disabled` | seleção em modais, grade de disponibilidade |

Não criar agora: tabela genérica (4 arquivos) e biblioteca de animação.

### 2.6 Movimento

| Uso | Duração | Easing | Propriedades |
|---|---|---|---|
| Press | 80ms | standard | `transform`, `box-shadow` |
| Hover, cor, foco | 150ms | standard | cores, `box-shadow`, `transform` |
| Entrada de dialog e toast | 200ms | enter | `opacity`, `translate`/`scale` |
| Saída | 150ms | exit | idem |
| Barra de progresso | 200ms | standard | preenchimento |

Regras:
1. Proibido `transition-all`. Preferir `transform` e `opacity`; não animar `width`, `height`, `top` (exceção: preenchimento do `<progress>`).
2. **Sem mola nem bounce** em ação operacional. Se um dia a comemoração pedir mola, `linear()` inline, com `ease-out` declarado antes como fallback, e nunca em `opacity`.
3. Sem animação de entrada de página. Remover todos os `animate-in` e modificadores.
4. **Press:** moldura afunda (`active:translate-[3px] shadow-none`, já no Button); sem moldura usa `active:scale-[.97]`; linha, aba e nav usam `active:bg-gray-100`. Sempre `motion-safe:` no transform; a troca de fundo vale para todos.
5. **Foco:** regra global em `index.css`, depois os primitivos podem especializar:
   `:where(a,button,input,select,textarea,summary,[tabindex]:not([tabindex="-1"])):focus-visible { outline: 2px solid #111; outline-offset: 2px }`.
   Um anel só: preto nos controles; campos mantêm o anel verde somado à borda preta. Em área com `overflow:hidden`, usar anel `inset`.
6. **Reduced motion, caso a caso** (sem reset global de `animation-duration`): deslocamento e escala só dentro de `no-preference`; fade fica, com 100ms; spinner e progresso indeterminado desaceleram (6s ou 10s); pulse, bounce e confete desligam; o estado final continua visível; mudanças de cor permanecem.
7. Movimento automático acima de 5s precisa de controle de pausa. O marquee do Onboarding deve virar **faixa estática** (mais simples) ou ganhar botão de pausa e `motion-safe`.

**Dialog** (só CSS em `index.css`, sobre o `<dialog>` atual):

```css
dialog.worki-dialog { opacity: 0; transition: opacity 150ms cubic-bezier(.3,0,1,1), display 150ms, overlay 150ms;
  transition-behavior: allow-discrete; }
dialog.worki-dialog[open] { opacity: 1; transition-duration: 200ms; }
@starting-style { dialog.worki-dialog[open] { opacity: 0; } }
@media (prefers-reduced-motion: no-preference) {
  .worki-dialog-panel { translate: 0 0; transition: translate 200ms cubic-bezier(0,0,0,1); }
  @starting-style { dialog.worki-dialog[open] .worki-dialog-panel { translate: 0 12px; } }
}
@media (prefers-reduced-motion: reduce) { dialog.worki-dialog { transition-duration: 100ms; } }
```

- `transition-behavior` em declaração separada, e `overlay` na lista (exigência das guias).
- **Entrada funciona só com CSS.** A saída hoje não toca, porque o `Dialog` desmonta junto com `close()`. Na primeira etapa entregar **apenas a entrada**. Saída exige `data-closing`, aguardar `getAnimations()` com teto de tempo e adiar o `onClose` (Firefox e Safari não animam `overlay`). Isso mexe em foco, pilha de modais e testes: lote próprio, opcional.
- `@starting-style` é Baseline Newly: navegador antigo mostra o dialog sem animação.

**Toast:** entrada com `@starting-style` (`opacity 0`, `translate 0 -8px` no celular, `0 8px` no desktop), 200ms.
Saída: `data-closing`, esperar `getAnimations()` (seguir na hora se vier vazio, com teto de 2s) e remover do estado.
Reduced motion: só fade de 100ms. `animate-slide-in` passa a `motion-safe:`.

**Carregamento:** ação do usuário usa `Button loading`; carga de tela ou lista usa `Skeleton` com o formato do
conteúdo; espera pontual sem formato usa `Spinner`. Progresso com valor usa `ProgressBar`. O `Spinner` pode continuar
como `span` com `animate-spin` (visual atual) desde que tenha nome acessível; o `<progress>` indeterminado com
`conic-gradient` da guia é opcional.

**Confete:** manter como está. É o único momento celebratório.

---

## 3. Plano de migração

Regra de paralelismo: **cada arquivo pertence a um único lote**. Os lotes A a H só **consomem** `components/ui`,
`tailwind.config.js`, `index.css` e `lib/statusTone.ts`; se faltar algo, reportam ao orquestrador e não editam.
Teste ao lado do arquivo acompanha o lote. Testes compartilhados (`pages/__tests__`, `components/__tests__`,
`testerRodada*`) não são editados em paralelo: reportar. Cada lote em worktree próprio, via
`harness-frontend-builder`, com frontend-reviewer e evaluator.

### Lote 0: fundação (sozinho, antes de todos)

Arquivos: `tailwind.config.js`, `src/index.css`, `src/App.css` (apagar), `components/ui/**`,
`components/ErroDeCarga.tsx` (vira reexport), `contexts/ToastContext.tsx`, `lib/statusTone.ts` (novo),
`.harness/memory-bank/design-system.md` (reescrito com uma gramática só).
Entrega: tokens, componentes do 2.5, foco global, press, entrada de dialog e toast, com testes dos componentes.
`components/ui/index.ts` fica fechado ao fim deste lote.

### Lotes paralelos

| Lote | Arquivos (exclusivos) | Foco |
|---|---|---|
| **A. Freela: operação** | `pages/{MyJobs,Dashboard}.tsx`; `components/{InviteTakeover,RateModal,JobLifecycleStepper,LocalDoTurno}.tsx`; `layouts/MainLayout.tsx` | StatusBadge, EmptyState, `!`, ProgressBar |
| **B. Freela: perfil e dinheiro** | `pages/{Profile,MeusRecebimentos,ReceiptView,CarteiraClientes,CompanyPublicProfile,QuemTeIndicou}.tsx`; `components/{ServiceTermSection,MyCertificationsSection,SosDiscoverySection,ReferralOptOutSection,CompanyBadges,ProfileReviews}.tsx` | ActionBar (corrige a barra do Profile), vazios, cards |
| **C1. Candidatos** | `pages/company/CompanyJobCandidates.tsx` | sozinho pelo tamanho (2.448 linhas, 51 botões): 1 primário por contexto, StatusChip e ModalShell locais |
| **C2. Turnos** | `pages/company/{CompanyJobs,CompanyJobDetails,CompanyCreateJob,CompanyToday}.tsx`; `components/company/{CancelJobModal,CancelSeriesModal,EditSeriesModal,InviteSeriesModal,CoverageModal,PassJobsModal,TagsPanel}.tsx` | 22 botões crus, DialogActions, Fab |
| **D. Elenco e equipe** | `pages/company/{CompanyTeam,CompanyTeamMembers,CompanyReferrals,WorkerPublicProfile}.tsx`; `components/team/**`; `components/company/{CreateReferralModal,WorkerCertificationsPanel}.tsx` | IconButton, StatusBadge, ChoiceCard |
| **E. Gestão e relatórios** | `pages/company/{CompanyDashboard,CompanyGestao,CompanyProfile,Organization,CompanyOrdersReport,CompanyOperationAnalytics}.tsx`; `components/company/analytics/**`; `components/company/{CompanySwitcher,BackToGestao,TrailShortcutCard,GestorRouteGuard}.tsx`; `layouts/CompanyLayout.tsx` | ErrorBanner, selos, barras, FAB |
| **F. Casca, chat e avisos** | `pages/{Messages,Notifications}.tsx`; `pages/company/CompanyMessages.tsx`; `components/{NotificationBell,Sidebar,BottomNav,SectionTabs,ProfileAvatarLink,SkipLink,HomeRedirect,ProtectedRoute,TosGateModal,PwaPrompts,ErrorBoundary,ErroDeVerificacao,SemAcesso,AcessoEncerrado,AguardandoConfirmacao}.tsx`; `App.tsx` | press na navegação, status do chat, "digitando", Skeleton |
| **G. Público e entrada** | `pages/{LandingPage,Onboarding,Login,ForgotPassword,ResetPassword,InviteAccept,AcceptTeamInvite,AcceptManagerInvite,Help,Terms,Privacy,BonusRules,NotFound}.tsx`; `pages/worker/WorkerOnboarding.tsx`; `pages/company/CompanyOnboarding.tsx` | marquee, `animate-in` de etapas, barras de senha |
| **H. Admin e bônus** | `pages/Admin.tsx`; `pages/company/BonusTrail.tsx`; `components/admin/**`; `components/bonus/**` | maior dívida legada; campos em `Field` |

Prioridade, se não couber tudo: 0, depois A, C1, C2, D (fluxo do piloto), depois F, B, E, G, e H por último.
Urgências que cabem antes da migração: marquee (G), remoção dos `animate-in` mortos (cada lote nos seus arquivos) e
contraste do verde em texto (token no Lote 0).

### Lote Z: fechamento (sozinho, ao final)

- Apagar `components/ModalShell.tsx` e `components/team/ModalShell.tsx` quando não houver importador.
- Guarda automática (script ou teste) que falha com: `<button` fora de `components/ui` sem exceção listada, `transition-all`, `animate-in`, `shadow-[`, `rounded-lg`, `#F4F4F0`, `!` em `className`. Começar com lista de exceções que só diminui.
- Comparar antes e depois com `scripts/galeria-telas` em 390px e desktop. Passada com `prefers-reduced-motion` e teclado.
- Atualizar `design-system.md` e `patterns.md`.

### Aceite por lote

- `npm run build`, `lint` e testes verdes.
- Nos arquivos do lote: zero `<button>` cru fora das exceções; zero `!` em primitivo; zero `shadow-[`, `transition-all`, `animate-in`.
- No máximo um primário visível por contexto, conferido em tela.
- Alvo de toque de 44px a 390px; sem rolagem horizontal a 320px.
- Nenhuma mudança de regra de negócio, de query ou de texto jurídico.
