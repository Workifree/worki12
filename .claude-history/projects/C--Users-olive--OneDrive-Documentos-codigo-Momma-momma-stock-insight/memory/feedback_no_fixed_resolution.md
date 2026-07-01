---
name: feedback-no-fixed-resolution
description: "NUNCA criar tela com resolução fixa (nem \"página de TV\" 1920×1080) — tudo 100% responsivo em qualquer dispositivo"
metadata: 
  node_type: memory
  type: feedback
  originSessionId: 447bd92b-13cc-46c2-a2aa-7ff035673a80
---

NUNCA construir páginas com resolução fixa ou layout travado em um dispositivo-alvo — nem mesmo quando o pedido menciona "TV" ou "wallboard". O CTO foi explícito (2026-06-05, painel /tv): "não inventa uma resolução de TV fixa — torne o frontend adaptável a qualquer página, responsivo para tudo em todos os lugares; se abrirmos na TV veremos tranquilamente bem".

**Why:** O painel de crise /tv foi implementado com `fixed inset-0`, grid de linhas em px fixos (152/1fr/248) e tipografia em px absolutos para 1920×1080 — quebrava em qualquer outro viewport e violou o padrão do software.

**How to apply:**
- Layout fluido com breakpoints Tailwind padrão (base mobile → sm/md/lg/xl/2xl) e tipografia fluida (`clamp()`/variantes responsivas), nunca px fixos de viewport.
- "Funcionar bem na TV" = consequência de um layout responsivo bem feito em telas grandes, não um modo especial.
- Vale para TODA tela nova; complementa [[feedback-mobile-first]] (auditar viewport mobile antes de dar OK).
