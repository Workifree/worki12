# Design System — Worki (neo-brutalista, extraído do código)

> Fonte da verdade visual do app. Extraído de telas/componentes canônicos: `JobCard`, modais em
> `CompanyJobCandidates.tsx`, `Sidebar`, `ProtectedRoute`. Config de tokens: `frontend/tailwind.config.js`. Globais: `frontend/src/index.css`.

## Identidade

Worki é **neo-brutalista**: bordas pretas grossas (2px), sombras "offset" sólidas (sem blur), tipografia
pesada em caixa-alta, cantos arredondados generosos. Limpo e branco, com cor de marca por papel.

- **Verde `#00A651`** (`primary`) — cor do **trabalhador (worker)**: CTAs primários, sucesso, destaque positivo.
  Escuras: `primary-dark #008840` (texto branco 4,57:1 — AA); clara: `primary-light #e6f6ec`.
- **Preto `#111111`** (`accent`) — linguagem estrutural brutalista: bordas, sombras, e CTAs do papel **empresa**.
- **Azul `#2563EB`** — cor de marca da **empresa (company)**; hoje aparece como acento (ex.: tags de
  localização). Os botões de empresa usam preto brutalista (`bg-black hover:bg-primary`) — ver regra 5.
- **Fundo:** branco; no mobile um off-white `#F4F4F0` com radial-gradients sutis (verde/azul a ~3% de opacidade).
- **Fonte:** Inter, sans-serif. Pesos pesados (`font-black` 900, `font-bold` 700), títulos em `uppercase`.

## Gramática visual (classes Tailwind exatas)

1. **Card padrão** — branco com borda preta grossa:
   `bg-white border-2 border-black rounded-2xl p-6`.
   Hover (interativo, ex.: `JobCard`): `hover:shadow-[6px_6px_0px_0px_rgba(0,166,81,1)] hover:-translate-y-1
   transition-all`. Estado "já aplicado/visitado": `opacity-80` + borda cinza.

2. **Sombra offset (assinatura brutalista)** — sólida, sem blur:
   - Verde (cards/hover): `shadow-[6px_6px_0px_0px_rgba(0,166,81,1)]`
   - Preta (modais/elementos fortes): `shadow-[8px_8px_0px_0px_rgba(0,0,0,1)]`
   - Tokens suaves auxiliares: `shadow-glass` (`0 4px 30px rgba(0,0,0,.03)`), `shadow-float` (`0 10px 40px -10px rgba(0,0,0,.08)`).

3. **Modal** — overlay + caixa brutalista:
   ```tsx
   <div className="fixed inset-0 z-50 bg-black/50 backdrop-blur-sm flex items-center justify-center p-4
                   animate-in fade-in duration-200">
     <div className="bg-white rounded-2xl border-2 border-black shadow-[8px_8px_0px_0px_rgba(0,0,0,1)]
                     w-full max-w-md p-6">
       {/* conteúdo */}
     </div>
   </div>
   ```
   Referência canônica: modal "Registrar Pagamento" em `pages/company/CompanyJobCandidates.tsx` (linhas ~1048-1190).

4. **Tipografia:**
   - Título de página: `text-4xl font-black` (ou `text-3xl`), frequentemente `uppercase`.
   - Subtítulo de seção: `text-xl font-black`.
   - Labels/CTAs: `font-black uppercase` + `tracking` levemente apertado.
   - Números (valores, saldo): `font-bold tabular-nums`.

5. **Botões** — pílula/retângulo arredondado, peso máximo, transição de cor por papel:
   ```tsx
   // Worker / primário (verde → preto no hover)
   className="bg-primary hover:bg-black text-white px-6 py-3 rounded-xl font-black uppercase transition-colors"

   // Empresa (preto → verde no hover)
   className="bg-black hover:bg-primary text-white px-6 py-3 rounded-xl font-black uppercase transition-colors"

   // Desabilitado
   className="opacity-50 cursor-not-allowed"
   ```

6. **Badges / tags** — pílulas coloridas por significado:
   - Marca/sucesso (worker): fundo `bg-primary-light text-primary` ou `bg-primary text-white`.
   - Localização/empresa: acento azul (`bg-blue-50 text-blue-700` / `#2563EB`).
   - Neutro/metadados: `bg-gray-100 text-gray-700`.
   - Status de escrow: usar `EscrowStatusBadge` (componente canônico).

7. **Cantos (border-radius):** `rounded-xl` (16px) para botões/inputs, `rounded-2xl` (24px) para cards/modais,
   `rounded-3xl` (32px) para superfícies grandes, `rounded-pill` (999px) para tags/pílulas. Evitar `rounded-md`
   (genérico) em superfícies visíveis.

8. **Inputs / formulários:** `border-2 border-black rounded-xl px-4 py-3` + `focus:ring-2 focus:ring-primary`.
   Sempre `<label>` associado (não usar só placeholder).

9. **Loading / skeleton:** `animate-pulse` com blocos `bg-gray-200 rounded-xl` (`space-y-4`). Páginas lazy
   usam um PageLoader skeleton via `Suspense`.

10. **Animações (em `index.css`):** `slideIn` (opacity 0→1, translateY 10px→0, 0.3s ease-out) via `animate-slide-in`;
    utilitários `animate-in fade-in slide-in-from-*` (tailwindcss-animate).

## Escala refinada (11/2026)

> Decisão do dono (11/11/2026, spec `ui-fundacao-botoes-copy`): **Article 13 intacto** — borda preta 2px e sombra
> offset sólida continuam —, mas com acabamento mais fino: mais respiro, tipografia contida, sombra menor,
> menos caixa-alta gritante. A gramática acima (seções 1-5) descreve o legado; **UI nova e telas migradas usam
> a escala abaixo via `components/ui/*`**.

**Regra:** não escreva `<button className="...">`, card, header de página ou input com classes soltas em tela
nova ou migrada. Importe de `components/ui` (`Button`, `Card`, `PageHeader`, `Field`). Tela legada migra na
auditoria tela a tela, sem pressa.

| Item | Escala refinada |
|---|---|
| Botão — tamanhos | `sm` h-9 (só densidade, ex.: linha de tabela) · **`md` h-11 (padrão, alvo de toque 44px)** · `lg` h-12 (CTA de tela/rodapé de modal) |
| Botão — tipografia | `font-bold text-sm`, **sem uppercase** (prop `uppercase` é opt-in raro). Não usar `font-black` em botões |
| Botão — raio / moldura | `rounded-xl`, `border-2 border-black`, sombra `shadow-[3px_3px_0px_0px_rgba(0,0,0,1)]` |
| Botão — interação | hover: `-translate-x-px -translate-y-px` + sombra 4px · active: desloca 3px e some a sombra · foco: `focus-visible:ring-2 ring-black ring-offset-2` |
| Botão — variantes | `primary` verde (worker) · `dark` preto (empresa) · `secondary` branco com borda · `ghost` sem moldura · `danger` vermelho (destrutivo) |
| Botão — contraste do `primary` | fundo **`bg-primary-dark`** (`#008840`, hover `bg-black`), NÃO `bg-primary`: branco sobre `#00A651` dá só 3,19:1 (reprova AA para `text-sm`); sobre `primary-dark` dá 4,57:1. O verde de marca puro segue valendo como cor de destaque/badge/ícone, não como fundo de texto branco pequeno |
| Botão — movimento | `motion-reduce:transition-none motion-reduce:transform-none` (respeita `prefers-reduced-motion`). Tailwind com `future.hoverOnlyWhenSupported`: `hover:` só em dispositivo com hover real (sem hover "grudado" no toque) |
| `IconButton` | botão **só de ícone**: quadrado 44px (`h-11 w-11`), `aria-label` **obrigatório na tipagem**, `type="button"`, foco `ring-2 ring-black`; variantes `ghost` (padrão) · `secondary` (borda preta) · `danger` (borda/ícone vermelhos). Use no lugar de `Button` com `px-0`/`w-11` improvisado (fechar modal, editar, remover) |
| Botão — estados | `disabled`: `opacity-50 cursor-not-allowed`, sem sombra · `loading`: spinner, `disabled` + `aria-busy`, clique bloqueado |
| Card | `bg-white border-2 border-black rounded-2xl`; padding `sm` p-4 · `md` p-5 sm:p-6 (padrão) · `lg` p-6 sm:p-8; `interactive` = `hover:-translate-y-0.5` + sombra preta 4px (a sombra verde 6px do `JobCard` segue válida para o feed); **`onActivate`** = card clicável acessível (`role="button"`, `tabIndex=0`, Enter/Espaço, foco visível; não dispara quando o evento vem de botão/link interno) e já implica `interactive` |
| Título de página | `PageHeader` (prop `flush` = sem margem inferior, no lugar de `!mb-0`): `text-2xl sm:text-3xl font-bold tracking-tight`, sem uppercase; subtítulo `text-sm sm:text-base text-gray-600`; **uma** ação primária à direita no desktop, empilhada e full-width no mobile |
| Título de seção | `text-lg font-bold` (no lugar de `text-xl font-black uppercase`) |
| Corpo / meta | corpo `text-sm` (`text-base` a partir de md quando for leitura longa) · meta `text-xs text-gray-600` |
| Input (`Field`) | `border-2 border-black rounded-xl h-11 px-4 text-sm focus:ring-2 focus:ring-primary`; label `text-sm font-bold` sempre associado; `placeholder:text-gray-500` (gray-400 reprova contraste); **hint e erro aparecem JUNTOS** — o hint `text-xs text-gray-600` nunca some quando há erro; erro `text-xs font-bold text-red-600` com `role="alert"` e `aria-invalid`. `<textarea>` não usa `h-11`: ganha `min-h-24 py-3` (`FIELD_TEXTAREA_CLASS`) |
| Sobrescrever classe dos primitivos | `className` do chamador **vence** o padrão: `cx` usa `tailwind-merge` (`h-24` troca `h-11`, `px-0` troca `px-5`). **Não usar `!` (important)** para vencer o primitivo |
| Espaçamento | ritmo de 4px: gap interno de grupo `gap-2`/`gap-3`, entre cards `gap-4`, entre seções `space-y-6`/`space-y-8`; margem do header `mb-6 sm:mb-8` |
| Alvo de toque | todo elemento clicável ≥ 44px no mobile (390px) — `md`/`lg` cumprem; `sm` só fora de áreas de polegar |

**Cor por papel continua valendo:** tela worker usa `variant="primary"`; tela empresa usa `variant="dark"`.
CTA único por tela/bloco — o resto é `secondary`/`ghost`.

## Cor por papel — regra semântica

| Papel | Cor de marca | CTA real no código | Uso |
|---|---|---|---|
| Worker | Verde `#00A651` (`primary`) | `bg-primary hover:bg-black` | feed, candidatura, carteira do worker |
| Empresa | Azul `#2563EB` (acento) | `bg-black hover:bg-primary` | dashboard/empresa, criar vaga, candidatos |
| Estrutura | Preto `#111111` (`accent`) | bordas + sombras offset | toda a moldura brutalista |

> Ao implementar UI nova: tela de **worker** → verde primário; tela de **empresa** → seguir o padrão
> preto-brutalista existente das telas `pages/company/*` (e azul só como acento), salvo direção contrária.

## Camadas (z-index)

| Camada | z-index | Observação |
|---|---|---|
| Navegação (`BottomNav`, `Sidebar`, headers fixos) | `z-50` | |
| Modal / overlay (`ModalShell`) | `z-[70]` | antes empatava com a BottomNav (z-50) e perdia na ordem do DOM |
| Toast (`ToastContext`) | `z-[80]` | acima do modal; no mobile sobe acima da BottomNav (`bottom-[calc(5rem+env(safe-area-inset-bottom))] md:bottom-4`) |

Toast: borda preta 2px + sombra offset sólida `shadow-[3px_3px_0px_0px_rgba(0,0,0,1)]` (sem `shadow-lg`); container `role="status" aria-live="polite"`, toast de erro `role="alert"`; botão fechar com área de 44px.

## Mobile-first (obrigatório)

```tsx
// ✅ começa no menor e escala
<div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
<p className="text-sm md:text-base">
// ✅ navegação mobile = BottomNav; desktop = Sidebar
// ✅ touch targets generosos (px-6 py-3 / min-h ~44px)
```

## Proibições

- ❌ Card "flat" sem borda preta onde o padrão é `border-2 border-black` (quebra a identidade brutalista).
- ❌ Sombra com blur onde a assinatura é sombra offset sólida (`shadow-[Npx_Npx_0px_0px_...]`).
- ❌ Cores fora da paleta (verde/azul/preto + neutros gray) como dominantes.
- ❌ `bg-primary` (verde de worker) como CTA principal em tela de **empresa** sem intenção.
- ❌ Input só com placeholder, sem `<label>` (acessibilidade).
- ❌ Reintroduzir qualquer estilo herdado do Angular legado (`frontend-angular-backup/`).

## Componentes canônicos

| Componente | Path | Para quê |
|---|---|---|
| `IconButton` | `frontend/src/components/ui/IconButton.tsx` | **botão só de ícone** 44px (`aria-label` obrigatório; ghost/secondary/danger) |
| `Button` | `frontend/src/components/ui/Button.tsx` | **botão canônico** (variantes primary/dark/secondary/ghost/danger; sm/md/lg; loading, fullWidth, iconLeft/Right) |
| `Card` | `frontend/src/components/ui/Card.tsx` | **card canônico** (padding sm/md/lg, `interactive`, `as`) |
| `PageHeader` | `frontend/src/components/ui/PageHeader.tsx` | **cabeçalho de página** (título + subtítulo + `action` única) |
| `Field` | `frontend/src/components/ui/Field.tsx` | **campo de formulário** (label associado + hint + erro acessíveis; `FIELD_CONTROL_CLASS`) |
| `JobCard` | `frontend/src/components/JobCard.tsx` | card brutalista (variantes feed/search), referência de hover/sombra |
| Modal "Registrar Pagamento" | `frontend/src/pages/company/CompanyJobCandidates.tsx` (linhas ~1048-1190) | padrão de modal neo-brutalista com formulário |
| `Sidebar` | `frontend/src/components/Sidebar.tsx` | navegação desktop + badge de verificação |
| `BottomNav` | `frontend/src/components/BottomNav.tsx` | navegação mobile |
| `EscrowStatusBadge` | `frontend/src/components/EscrowStatusBadge.tsx` | status de escrow padronizado |
| `ProtectedRoute` | `frontend/src/components/ProtectedRoute.tsx` | guard + TOS gate modal |
| `ServiceTermSection` | `frontend/src/components/ServiceTermSection.tsx` | renderização de termo + checkbox de concordância (F6) |
| `MyCertificationsSection` | `frontend/src/components/MyCertificationsSection.tsx` | grid de certificações do freela (F8) |
| `WorkerCertificationsPanel` | `frontend/src/components/company/WorkerCertificationsPanel.tsx` | painel da empresa com certificações da equipe (F8) |
| `ProfileReviews` | `frontend/src/components/ProfileReviews.tsx` | lista de avaliações recebidas (estrelas + comentário, reutilizável) |
| `CompanyBadges` | `frontend/src/components/CompanyBadges.tsx` | cards "Já trabalhou com" com toggle ocultar/reexibir (F12) |
