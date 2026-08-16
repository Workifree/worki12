# Design System — Worki (neo-brutalista, extraído do código)

> Fonte da verdade visual do app. Extraído de telas/componentes canônicos: `JobCard`, modais em
> `CompanyJobCandidates.tsx`, `Sidebar`, `ProtectedRoute`. Config de tokens: `frontend/tailwind.config.js`. Globais: `frontend/src/index.css`.

## Identidade

Worki é **neo-brutalista**: bordas pretas grossas (2px), sombras "offset" sólidas (sem blur), tipografia
pesada em caixa-alta, cantos arredondados generosos. Limpo e branco, com cor de marca por papel.

- **Verde `#00A651`** (`primary`) — cor do **trabalhador (worker)**: CTAs primários, sucesso, destaque positivo.
  Escuras: `primary-dark #008a42`; clara: `primary-light #e6f6ec`.
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

## Cor por papel — regra semântica

| Papel | Cor de marca | CTA real no código | Uso |
|---|---|---|---|
| Worker | Verde `#00A651` (`primary`) | `bg-primary hover:bg-black` | feed, candidatura, carteira do worker |
| Empresa | Azul `#2563EB` (acento) | `bg-black hover:bg-primary` | dashboard/empresa, criar vaga, candidatos |
| Estrutura | Preto `#111111` (`accent`) | bordas + sombras offset | toda a moldura brutalista |

> Ao implementar UI nova: tela de **worker** → verde primário; tela de **empresa** → seguir o padrão
> preto-brutalista existente das telas `pages/company/*` (e azul só como acento), salvo direção contrária.

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
| `JobCard` | `frontend/src/components/JobCard.tsx` | card brutalista (variantes feed/search), referência de hover/sombra |
| Modal "Registrar Pagamento" | `frontend/src/pages/company/CompanyJobCandidates.tsx` (linhas ~1048-1190) | padrão de modal neo-brutalista com formulário |
| `Sidebar` | `frontend/src/components/Sidebar.tsx` | navegação desktop + badge de verificação |
| `BottomNav` | `frontend/src/components/BottomNav.tsx` | navegação mobile |
| `EscrowStatusBadge` | `frontend/src/components/EscrowStatusBadge.tsx` | status de escrow padronizado |
| `ProtectedRoute` | `frontend/src/components/ProtectedRoute.tsx` | guard + TOS gate modal |
