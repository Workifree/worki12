---
name: feedback-design-glassmorphism-verde
description: "Design system REAL do MommaERP é glassmorphism verde sage sobre branco — bege/marrom do index.css é legado ABANDONADO, nunca usar"
metadata: 
  node_type: memory
  type: feedback
  originSessionId: 447bd92b-13cc-46c2-a2aa-7ff035673a80
---

O design system de fato do MommaERP (confirmado pelo CTO em 2026-06-05) é **glassmorphism verde sobre fundo branco**, NÃO o bege/marrom Pantone declarado em `src/index.css` (`:root` com `--background` bege etc. é **legado abandonado** — não usar como referência de estilo).

**Why:** Um redesign do painel TV usou as variáveis bege/marrom do index.css e ficou "péssimo" — as telas reais (Notas Fiscais, Produção Diária, Financeiro, Encomendas) usam outra linguagem. O CTO foi explícito: "para com negócio de bege marrom, nosso sistema inteiro não tem marrom em quase lugar algum".

**How to apply:** Referências canônicas no código:
- `src/shared/ui/MommaPageLayout.tsx` — fundo `bg-white dark:bg-[#0A0A0A]`, awning stripe verde, folhas `text-[#57715B] opacity-[0.03]`, ambient glows `bg-[#57715B]/5` e `bg-[#C5A065]/5 blur-[80px]`
- `src/shared/ui/glass-card.tsx` — GlassCard: `bg-white/60 dark:bg-black/20 backdrop-blur-xl saturate-150 border-white/50 rounded-[2rem]`
- KPI card: `bg-white/60 dark:bg-[#1A1A1A]/60 rounded-[2rem] border border-[#57715B]/10 backdrop-blur-md shadow-sm hover:shadow-md`
- Verde dominante: `#57715B` (2300+ ocorrências); texto escuro `#2D362E` / dark `#E6DCCF`; hover botão `#465b49`; emerald-600 só p/ badges de sucesso; dourado `#C5A065` APENAS glow/acento sutil
- Fonte: Poppins (`font-momma`); headings `font-serif font-bold tracking-tight`; labels `text-xs uppercase tracking-wider`
- Doc canônico: `.harness/memory-bank/design-system.md`

Relacionado: [[mia-glass-box-architecture]]
