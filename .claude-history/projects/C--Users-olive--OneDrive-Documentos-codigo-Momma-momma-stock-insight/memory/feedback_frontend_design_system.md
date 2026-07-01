---
name: feedback-frontend-design-system
description: "Padrão obrigatório de design frontend do MommaERP — glassmorphism verde, fundo branco, sem bege. Nunca cometer erro de fundo bege ou padding errado."
metadata: 
  node_type: memory
  type: feedback
  originSessionId: 5ec6f281-7d5e-49a3-adb3-0d9f357c0551
---

## REGRA: Toda página nova DEVE seguir este padrão

**Why:** O usuário (CTO) ficou extremamente frustrado com páginas mostrando fundo bege, cursor incorreto, layout quebrado em telas pequenas. O design canônico está definido e deve ser seguido sem exceções.

**How to apply:** Antes de qualquer commit de frontend, verificar TODOS os itens abaixo.

---

### 1. Layout wrapper obrigatório

Toda página dentro de `DashboardLayout` que é "full-bleed" (sem padding do layout) DEVE:

**a) Estar na lista `isFullBleedPage` em `DashboardLayout.tsx`:**
```tsx
location.pathname === '/minha-pagina' ||
location.pathname.startsWith('/minha-pagina/')
```

**b) Usar `MommaPageLayout` como wrapper do conteúdo:**
```tsx
import { MommaPageLayout } from '@/shared/ui/MommaPageLayout';

export default function MinhaPagina() {
  return (
    <MommaPageLayout>
      <div className="p-4 sm:p-6 ...">
        {/* conteúdo */}
      </div>
    </MommaPageLayout>
  );
}
```

**NUNCA usar `bg-background`** — resolve para bege `#F3ECD4` (legado CSS var em `index.css`).

### REGRA "NO BEIGE NOWHERE" (CTO, 2026-06-12 — 2ª rejeição do CMV)

TODAS as classes de token shadcn resolvem bege em light mode: `bg-background`, `bg-card`,
`bg-popover`, `bg-muted`, `bg-accent`, `bg-secondary`, `border-border`, `border-input`,
`ring-ring` — PROIBIDAS. Componentes shadcn (Input, Select, Dialog, Sheet, Dropdown,
Popover, AlertDialog) usam esses tokens por default → SEMPRE passar className explícito
de vidro branco (search bar: `bg-white/60 backdrop-blur-md border-[#57715B]/15 rounded-xl`).
Sem `rounded-md` default em superfície visível — só xl/2xl/[2rem]/full. Gate antes do OK:
`grep -E "bg-background|bg-card|bg-popover|bg-muted|bg-accent|border-border|border-input|bg-secondary"`
nos arquivos novos = zero hits. Regra codificada em `.harness/memory-bank/design-system.md`.

---

### 2. Fundo correto

- ✅ `bg-white` para containers de página
- ✅ `bg-white/60 backdrop-blur-xl saturate-150` para cards glass
- ❌ NUNCA `bg-background` (→ bege)
- ❌ NUNCA `bg-[var(--background)]`

---

### 3. Cards — usar GlassCard

```tsx
import { GlassCard } from '@/shared/ui/glass-card';

// Card padrão
<GlassCard className="p-4">...</GlassCard>

// Card premium (Apple-style, bordas arredondadas 2rem)
<GlassCard variant="premium" className="p-4">...</GlassCard>
```

Card premium = `bg-white/60 backdrop-blur-xl saturate-150 rounded-[2rem] shadow-[0_8px_32px_rgba(0,0,0,0.12)]`

---

### 4. Paleta de cores

- Verde sage: `#57715B` (primary)
- Dourado: `#C5A065` (accent)
- Texto escuro: `#2D362E`
- Texto secundário: `#7C887E`
- Texto label: `#5F6F63`
- Fundo cards glass: `bg-white/60` ou `bg-white/40`

---

### 5. Grid responsivo com muitas colunas

Quando o grid tem 4+ colunas que podem não caber em telas estreitas:
```tsx
<div className="overflow-x-auto -mx-4 px-4 sm:-mx-6 sm:px-6">
  <div
    className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6 gap-4"
    style={{ minWidth: `${numColunas * 230}px` }}
  >
    {/* colunas */}
  </div>
</div>
```

`minWidth` garante que cada coluna tenha espaço mínimo — scroll horizontal em vez de squeeze.

---

### 6. Páginas de referência corretas

- `src/features/notas-fiscais/ui/NotasFiscais.page.tsx` — padrão completo glassmorphism dentro de DashboardLayout
- `src/features/producao/ui/ProducaoDiaria.page.tsx` — padrão standalone (sem DashboardLayout)
- `src/shared/ui/MommaPageLayout.tsx` — wrapper canônico
- `src/shared/ui/glass-card.tsx` — componente GlassCard

---

### 6.1 Incidente CMV (2026-06-12) — reforço

A página CMV nova saiu com "design genérico quadrado" (cards retos, botões quadrados, padding/background errados, canvas escuro #0F1117) e o CTO rejeitou com força ("nunca mais faça esse design"). NÃO basta usar as cores certas: a página tem que ESPELHAR estruturalmente NotasFiscais.page.tsx e ProducaoDiaria.page.tsx — mesmos raios (rounded-2xl/[2rem]), mesmos paddings, mesmos botões arredondados, mesmas superfícies de vidro. Antes do OK: comparar lado a lado com as páginas canônicas e listar discrepâncias; prompt do Gemini deve incluir TRECHOS REAIS das páginas canônicas, não só as regras abstratas.

### 7. Checklist antes de commitar frontend

- [ ] Página está em `isFullBleedPage` se for full-bleed
- [ ] Usa `MommaPageLayout` como wrapper
- [ ] Não tem `bg-background` em nenhum lugar
- [ ] Grids com 4+ colunas têm `overflow-x-auto` + `minWidth`
- [ ] Testa em viewport 375px (mobile) e 1024px (desktop com sidebar)
- [ ] Botão "Voltar" visível no mobile
