# Design System — Worki (neo-brutalista, acabamento profissional)

> Fonte da verdade visual. **Uma gramática só.** Como usar cada componente, glossário e lotes de migração:
> `.harness/spec/revisao-design/guia-do-sistema.md`. Tokens: `frontend/tailwind.config.js`. Globais e movimento:
> `frontend/src/index.css`. Telas ainda não migradas carregam o estilo antigo; não o copie.

## Identidade (Article 13)

Borda preta 2px, sombra offset sólida (sem blur), cantos arredondados, cor por papel. A moldura marca o que é
**interativo ou principal**; status e metadado são discretos. Mobile-first. Fonte Inter.

| Papel | Marca | CTA | Observação |
|---|---|---|---|
| Freela | verde `#00A651` (`primary`) | `Button variant="primary"` (fundo `primary-dark`) | texto verde usa o tom AA `#006b33` |
| Empresa | azul `#2563EB` (só acento) | `Button variant="dark"` | verde não é cor estrutural na empresa; significa apenas "ok" |
| Estrutura | preto `#111111` | bordas e sombras | |

## Tokens

- **Raio (3):** `rounded-xl` controle e aviso · `rounded-2xl` card e dialog · `rounded-pill` selo e chip.
- **Sombra (3 + destaque):** `shadow-brutal-sm` · `shadow-brutal` · `shadow-brutal-lg` · `shadow-brutal-brand`. Card em repouso não tem sombra.
- **Fundo:** `bg-canvas` (`#F4F4F0`) no app, branco no card.
- **Status:** `status-{neutral,info,success,warning,danger}-{bg,fg,line}` (contraste 6,6:1 a 9,4:1).
- **Verde:** `bg-primary` `#00A651` (decorativo) · `bg-primary-dark` `#008840` (texto branco 4,57:1) · `text-primary`, `text-primary-dark` e `text-primary-ink` = `#006b33` (6,66:1; sobrescrito em `theme.extend.textColor`). Sobre preto, `text-green-400`.
- **Texto:** mínimo `gray-600`.
- **z-index:** conteúdo fixo 30 · BottomNav/Sidebar 50 · menu 60 (top layer) · dialog 70 · toast 80 · gate/skip link 90.

## Tipografia

Título de página só `PageHeader` · h2 `text-lg font-bold` · h3 `text-base font-bold` · corpo `text-sm` · meta
`text-xs text-gray-600` · número `text-2xl font-bold tabular-nums`. Pesos 400/600/700. `font-black` só em marca e
heróis públicos. Caixa-alta só em eyebrow curtíssimo.

## Componentes (`components/ui`)

`Button` (primary, dark, secondary, ghost, danger, dangerOutline; sm/md/lg; loading) · `ButtonLink` · `IconButton` ·
`Card` (tone default/nested/highlight) · `PageHeader` (`inlineAction`) · `Field` · `StatusBadge` · `Alert` ·
`EmptyState` · `ErrorState` · `Spinner`/`Skeleton`/`SkeletonList` · `ProgressBar` · `ActionBar` · `Menu` ·
`Dialog`/`DialogHeader`/`DialogActions` · `ListRow` · `FilterChip` · `Tabs` · `ChoiceCard`.

Regras: não escreva classe solta de botão, selo, vazio, card, menu ou campo; `className` em primitivo é só layout;
sem `!important`. Um primário visível por contexto.

## Posição das ações

Ação principal de lista fica no `PageHeader` (**não há botão flutuante**: ele cobria ações dos cards e o menu).
Conclusão de formulário/detalhe usa `ActionBar` (sticky acima da BottomNav no celular, à direita no desktop).
Dialog usa `DialogActions` (DOM: secundário e depois principal). Menu "..." usa `Menu` (popover, vira para cima).
Destrutiva separada. Os `<main>` dos layouts não têm `overflow` (a `ActionBar` depende disso).

## Texto e dados

- Status e função só via `lib/statusLabels.ts`: nenhum enum ou slug na tela; uma palavra por estado (Concluído,
  Cancelado, Recusado, Expirado, Contratado, Em andamento, Aguardando resposta).
- Dinheiro `formatBRL`; horas `formatWorkedTime` (`lib/currency.ts`). Nunca "N/A" nem "0h" como medida.

## Movimento

Press 80ms · hover/foco 150ms · entrada de dialog/toast 200ms · saída de toast 150ms. Sem `transition-all`, sem
`animate-in` (o plugin não está instalado e não deve ser), sem animação de entrada de página, sem bounce em ação.
`prefers-reduced-motion` caso a caso (spinner desacelera; pulse, bounce e letreiro param; fade curto fica).
Movimento automático acima de 5s precisa de pausa.

## Acessibilidade e mobile

Alvo de toque ≥ 44px; foco visível (anel global + especialização nos primitivos); botão de ícone com `aria-label`;
input com `<label>` (use `Field`); `<img>` com `alt`; testar 320px e 390px; grid começa em `grid-cols-1`.
Ícones só `lucide-react`: 16 (texto), 20 (navegação), 24 (destaque), 40 (vazio/erro); selo 14.

## Toast e modal

Casca única de modal: `components/ui/Dialog` (`<dialog>` + `showModal`). Toast: borda preta + `shadow-brutal-sm`,
`role="status"` (erro `role="alert"`), fechar 44px, no topo no celular e no canto inferior direito no desktop.
