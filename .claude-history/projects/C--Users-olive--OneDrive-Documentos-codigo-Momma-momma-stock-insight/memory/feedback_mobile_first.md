---
name: Mobile-first é obrigatório
description: Maioria dos usuários da Momma opera em mobile. Toda feature precisa estar perfeita em telas pequenas, não só funcional. Auditar viewport mobile antes de dar OK.
type: feedback
originSessionId: c8b1fac3-0347-4b22-b83b-3a0f5d6339c4
---
Toda UI nova ou alterada precisa ser **perfeita em mobile**, não apenas "funcional". A maioria dos usuários da Momma (operadores de loja, separadores, conferentes) usa o sistema no celular.

**Why:** O CTO reforçou em 2026-05-04 após PR4/PR5: "tudo deve estar perfeito em mobile. lembre-se disso. maioria usará em mobile". Operadores não ficam em desktop — bipam caixas com o celular na mão, conferem em depósito, separam em corredor.

**How to apply:**
- Pensar mobile-first ao escrever UI nova: layout começa em coluna, depois `md:flex-row` pra desktop. Não o contrário.
- Modais grandes: `h-[95vh]` + `max-w-[98vw]` + scroll interno. Nunca conteúdo cortado.
- Kanban com várias colunas: em mobile vira coluna única scrollável OU tabs. Nunca 3+ colunas estreitas.
- FAB / botões fixos: respeitar `pb-[env(safe-area-inset-bottom)]` ou `bottom-[calc(env(safe-area-inset-bottom)+24px)]` pra não ficar atrás de barra de navegação iOS/Android.
- Toggle/segmented controls: tamanho mínimo do alvo de toque 44×44px (Apple HIG).
- Texto em badges/labels: nunca usar `whitespace-nowrap` sem `truncate` ou `max-w` — overflow horizontal quebra mobile.
- Câmera QR: `qrbox` em proporção do viewport, não 250px fixo (telas <320px viram cropped).
- Toast: usar sonner (já é o padrão), evitar Dialogs aninhados.
- Testar em chrome devtools com viewport iPhone SE (375×667) — se passa nesse, passa em quase tudo.
- Antes de marcar feature como pronta: rodar checklist mobile (FAB conflita? overflow horizontal? texto cortado? botão pequeno demais?).
