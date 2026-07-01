---
name: feedback_full_page_bg_pattern
description: "Páginas full-screen devem inlinar o fundo branco+decorações (padrão ProduçãoDiária), nunca MommaPageLayout dentro de DashboardLayout"
metadata: 
  node_type: memory
  type: feedback
  originSessionId: e483bf75-4418-4604-b227-116127ca89d0
---

Páginas de conteúdo que rodam dentro de `<DashboardLayout>` (rotas normais do app) devem **inlinar** a própria estrutura de fundo, espelhando `src/pages/ProducaoDiaria.tsx` / `src/features/producao/ui/ProducaoDiaria.page.tsx`:

- root `min-h-screen w-full bg-white dark:bg-[#0A0A0A] relative overflow-x-hidden`
- faixa de toldo (`repeating-linear-gradient` `#57715B`), 2 folhas `fixed` `opacity-[0.03]`, 2 glows (`#57715B/5` e `#C5A065/5`, `blur-[80px]`)
- conteúdo em `relative z-10 max-w-... mx-auto px-4 sm:px-6 py-6`

**Por quê:** usar `MommaPageLayout` DENTRO do `DashboardLayout` faz o **bege** do DashboardLayout vazar e as decorações de fundo somem/saem do lugar — exatamente o que o CTO reprovou na 1ª versão da página Conferência & Recebimento (2026-06-18: "fundo bege aparecendo sendo que era regra nunca ter isso, ícones de fundo sumindo, padding errado"). Regra absoluta NUNCA-bege em [[feedback_design_glassmorphism_verde]].

**DUAS causas raiz do bege (corrigidas 2026-06-18):** (1) `DashboardLayout` raiz usa `bg-background` e o `<main>` ganha padding `p-3 sm:p-4 md:p-6` quando a rota NÃO está em `isFullBleedPage` (lista em `src/features/dashboard/ui/DashboardLayout.tsx`) → moldura bege em volta da página. SEMPRE registrar a rota nova nessa lista. (2) Os tokens do `index.css` (`:root`/`.dark`/`--pantone-*`/`--company-*`) eram bege/marrom → MIGRADOS para branco/sage nesta data: `--background`/`--card`/`--popover`/`--sidebar-background`=branco, `--primary`/`--ring`=sage `#57715B`, `--border`/`--input`=sage suave, `--muted`/`--accent`=sage claríssimo. **Agora `bg-card`/`bg-background`/`border-border` NÃO são mais bege** — são branco/sage. Doc: `.harness/memory-bank/design-system.md`.

**Como aplicar:** página full-screen = casca de fundo da ProduçãoDiária + conteúdo em `relative z-10` + rota em `isFullBleedPage`. Vidro (`bg-white/60 dark:bg-black/20 backdrop-blur-md rounded-2xl/3xl`) é o padrão premium para cards/Dialog, mas um token shadcn solto já não produz bege.

**Nota de processo (mesma data):** o `harness-frontend-builder` (Gemini 3.1-pro-preview) caiu com erro de licença `#3501` ("valid license of this product"/Enterprise) — o caminho "Gemini escreve a UI" está quebrado no ambiente; os subagents caem para Claude. Verificar a key/licença em `scripts/gemini-dispatch.sh` antes de confiar nesse fluxo.
