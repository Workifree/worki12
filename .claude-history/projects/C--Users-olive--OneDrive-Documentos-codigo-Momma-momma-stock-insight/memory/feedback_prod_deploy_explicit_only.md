---
name: prod-deploy-explicit-only
description: NUNCA deployar pra prod sem ordem explícita do usuário no momento — nem com resposta anterior aprovando
metadata: 
  node_type: memory
  type: feedback
  originSessionId: 23498de2-200e-4343-a910-4aa5b33c4d17
---

Deploy pra produção (`npm run deploy:prod`, `vercel build --prod`, deploy de edge functions em prod) só acontece quando o usuário manda explicitamente naquele momento. Em 2026-06-05, mesmo após escolher "Deploy limpo" num AskUserQuestion, ele barrou o `vercel build --prod` com "não é pra mandar nada pra prod ainda".

**Why:** o CTO controla o timing de prod — commits em stg são livres, mas prod é decisão dele na hora, não derivada de uma aprovação anterior na conversa.

**How to apply:** fluxo padrão = corrigir, testar, commitar e pushar em stg ([[stg-only-branch]]); parar aí e avisar que o deploy está pronto pra quando ele quiser. Não rodar nenhum comando que builde/envie pra prod sem ordem direta no turno atual.
