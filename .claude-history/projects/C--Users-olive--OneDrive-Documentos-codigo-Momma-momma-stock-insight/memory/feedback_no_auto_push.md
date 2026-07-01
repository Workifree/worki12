---
name: feedback-no-auto-push
description: "Nunca fazer commit + push automaticamente após fixes. Commitar sim, pushar só quando pedido explicitamente."
metadata: 
  node_type: memory
  type: feedback
  originSessionId: 5ec6f281-7d5e-49a3-adb3-0d9f357c0551
---

Nunca encadear commit + push sem pedido explícito do usuário.

**Why:** O usuário ficou bravo quando fiz push automático após um fix de import. A decisão de quando enviar para o servidor é dele, não minha.

**How to apply:** Após qualquer fix ou mudança de código:
- `git add` + `git commit` → OK fazer automaticamente
- `git push` → NUNCA sem o usuário pedir explicitamente naquela mensagem

Commits stg são livres. Push é decisão do CTO.
