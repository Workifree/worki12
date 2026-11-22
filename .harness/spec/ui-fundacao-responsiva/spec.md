# Spec — UI: fundação responsiva e de movimento (PR 1 de 5)

Branch: `refactor/ui-fundacao-responsiva` · Pedido do dono (20/11/2026): revisar o app inteiro com a skill
**modern-web-guidance** no mais alto nível, responsivo para todos os dispositivos, alvos de toque, animações.
Plano aprovado: 5 PRs (1 fundação · 2 casca/navegação · 3 freela · 4 empresa · 5 públicas+Lighthouse).
Animações sutis APROVADAS. Sem prioridade de papel. Article 13 (neo-brutalista) INTACTO.

Guias consultados e que governam este PR (`npx modern-web-guidance@latest retrieve "<id>"`):
`responsive-design`, `form-factor-adaptation`, `motion`, `respect-os-text-scale`, `typography`, `accessibility`.

## Achados da auditoria (medidos no código em 20/11/2026)
- `frontend/src/App.css` é sobra do template Vite, NÃO importado em lugar nenhum (`#root{text-align:center;padding:2rem}`).
- `Button` `sm` = `h-9` (36px) e altura FIXA em todos os tamanhos; guia: alvo ≥44px em `pointer: coarse`,
  ≥24px sempre, e `min-block-size` (nunca `height`) em elemento com texto.
- Sem `<meta name="text-scale" content="scale">` e sem `:root`/`html` com font-size (não pode ter).
- Sem regra global de alvo de toque, sem `scroll-padding` (barras fixas cobrem o foco: WCAG 2.4.11).
- `animate-slide-in` e `animate-spin` sem tratamento de reduced-motion; 16 `animate-spin` sem `motion-reduce:`.
- `min-h-screen`/`100vh`/`h-screen` em Admin, ResetPassword, ForgotPassword, Onboardings, Terms, Privacy, Messages,
  CompanyMessages, App.tsx → usar `dvh` (barra de endereço mobile).
- 58 `text-[Npx]` (px fixo) e 59 `h-8|h-9|h-10`; 9 `outline-none` sem `focus-visible`.
- Sem `text-wrap: balance/pretty` em títulos/parágrafos.

## Requirements
- R1 `index.html`: adicionar `<meta name="text-scale" content="scale" />`. NÃO definir font-size em `:root`/`html`.
- R2 `index.css` (camada base): `--target-size: 24px` e `44px` em `@media (pointer: coarse)`; regra `:where(...)`
  de `min-block-size/min-inline-size` para button, select, textarea, input (exceto checkbox/radio), `[role=button]`, `nav a`,
  label com checkbox/radio (receita do guia `form-factor-adaptation`).
- R3 `index.css`: `scroll-padding-bottom` = altura do BottomNav + `env(safe-area-inset-bottom)`; `scroll-padding-top` p/ header fixo.
- R4 `index.css`: `text-wrap: balance` em `h1,h2,h3`; `text-wrap: pretty` em `p, li`; `overflow-wrap: break-word` no body e
  `anywhere` em `a, code`; `img, video { max-inline-size:100%; block-size:auto }`. Nunca em `*`.
- R5 `index.css`: `:focus-visible` global visível (contraste ≥3:1) como rede de segurança; remover dependência de `outline-none` solto.
- R6 Movimento: `animate-slide-in` só dentro de `@media (prefers-reduced-motion: no-preference)` (estado final preservado);
  spinner: sob `reduce` troca rotação por pulso de opacidade lento (continua comunicando "ocupado"); manter transições de cor.
  NUNCA `animation-duration: 0.01ms` global. Só `opacity`/`transform` (compositor).
- R7 `Button`: `sm` = `min-h-9` e em `pointer: coarse` sobe para `min-h-11`; `md`/`lg` usam `min-h-*` em vez de `h-*`;
  texto pode quebrar sem clipar; ícone-only (`IconButton`) com área de toque estendida por pseudo-elemento (`::after inset:-…`) ≥44px
  e `aria-label` obrigatório (tipo exige). Atualizar testes.
- R8 Remover `frontend/src/App.css`.
- R9 `dvh`: trocar `min-h-screen`→`min-h-dvh`, `100vh`→`100dvh`, `h-screen`→`h-dvh` nos arquivos listados (Tailwind ≥3.4 tem `h-dvh`;
  conferir versão, senão `min-h-[100dvh]`).
- R10 Tokens de movimento e espaçamento em `tailwind.config.js` (`transitionDuration`, `keyframes` fade-in/slide-up/scale-in com
  `animation` utilitárias) para o PR 2+ reutilizarem; todas protegidas por `motion-safe:`.
- R11 `design-system.md`: registrar alvo de toque, escala de movimento, regras de reduced-motion e de text-scale.

## Acceptance
- A1 `cd frontend && npm run build` e `npm run lint` verdes; `npm test` sem regressão.
- A2 Nenhuma rota/RLS/RPC/migration/lógica alterada. Só CSS, Tailwind config, `index.html`, primitivos `ui/*` e troca de classes de viewport.
- A3 Em `pointer: coarse` (emulação 390×844) todo controle de `ui/*` mede ≥44×44 CSS px; com mouse, ≥24.
- A4 Com `prefers-reduced-motion: reduce` nenhuma animação espacial roda e nenhum conteúdo fica em `opacity:0`.
- A5 Em 320px de largura e zoom de texto 200% nenhum texto é clipado e a página não rola na horizontal.
- A6 Article 13 respeitado: borda preta e sombra offset continuam.

## Fora do escopo (PRs 2–5)
Sidebar/BottomNav/layouts (PR 2), telas freela (3), telas empresa (4), públicas + Lighthouse (5).
