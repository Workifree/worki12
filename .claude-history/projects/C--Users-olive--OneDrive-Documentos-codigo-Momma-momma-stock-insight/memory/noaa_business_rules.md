---
name: Noaa Business Rules and Templates
description: Regras de negócio + templates exatos para chatbot Noa: cardápios distintos (encomendas vs loja), PDF ao invés de listar, 48h delivery, mensagens pré-prontas
type: project
---

Noaa chatbot rules updated 2026-04-23: distinguish encomendas (tortas/nakeds/dressed para datas específicas, sob demanda) vs loja (pronta entrega delivery/retirada: bombons/gelato/minis). Mix encomenda+loja allowed.

**Why:** Usuário quer "infinidade de regras" começando por cardápios; templates pré-prontos obrigatórios para tom/fluxo humanizado; evitar recitar cardápio — enviar PDF.

**How to apply:** 
- Integrate in system-prompt.ts: <cardapios_distintos>, <templates_pre_prontos> verbatim.
- Encomendas delivery: 48h min; <48h → Uber Flash (cliente paga, sai loja) ou retirada.
- Sempre oferecer PDF/link (loja: https://app.cardapioweb.com/momma_doces_saudaveis; naked/dressed via template).
- Use templates exatos como base para saudação, vegano, pagamento, APLV, etc. (full list in user message 2026-04-23).
- When editing Noaa files, prioritize these rules over generic prompts.