---
name: feedback_verify_runtime_before_commit
description: "Após implementar feature, sempre grep completo por symbols removidos + npm run dev antes de commitar — build/tsc não pegam ReferenceError de variáveis JS"
metadata: 
  node_type: memory
  type: feedback
  originSessionId: 980036f2-7e43-4972-9406-e6c27587dd11
---

Nunca commitar código após apenas `tsc --noEmit`. Quando renomear/remover estado (ex: `isFornecedoresView` → `activeTab`), fazer `grep -rn` pelo nome antigo no arquivo inteiro antes de qualquer commit. Build Vite passou sem erro mas o app explodia em runtime com `ReferenceError` porque variáveis JS removidas não são checadas pelo compilador TypeScript em modo `noEmit` quando há loose config.

**Why:** A página Compras foi commitada com 6 referências órfãs a `isFornecedoresView` — causou crash imediato em produção/dev.

**How to apply:** Após qualquer rename/remoção de estado:
1. `grep -n "NomeAntigo" arquivo.tsx` — deve retornar vazio
2. `npm run dev` + abrir a rota no browser antes de commitar
3. `npm run build` como smoke check final

Ver também [[feedback_thorough_forensics]].
