---
name: MIA no chat NUNCA navega frontend
description: Chat /mia jamais deve navegar pelo frontend — apenas o FAB pode disparar navegação. MIA executa ações via tools, nunca sugere caminho de UI.
type: feedback
originSessionId: 9f339aa2-0d65-4dd9-bea9-c7ace405d230
---
**Regra:** o chat /mia NUNCA navega pelo frontend. Só o FAB (botão flutuante) tem permissão de navegar. Qualquer ação que o usuário peça, MIA executa via tool/RPC direta no banco — jamais sugere "abra a página X, clique no lápis, salve".

**Why:** Usuário (CTO) explicitou em 2026-04-14 após MIA tentar navegar para /produtos durante uma renomeação. MIA é agente de execução direta — tem acesso a banco, tools e RPCs. Navegar + sugerir passo-a-passo de UI quebra a proposta do ERP AI-first.

**How to apply:**
- Nunca emita actions de navegação (`navigate_to`, `open_page`, etc) a partir dos agentes domain (stock, catalog, finance, logistics).
- Se faltar tool para uma operação, CRIAR a tool — não caçar alternativa de UI.
- Se a operação realmente só é possível por UI, diga explicitamente "não consigo fazer isso pelo chat ainda" — não empurre o usuário para o caminho manual.
- FAB (`MiaFab.tsx`) pode continuar oferecendo navegação via actions registradas por `useMiaActions`.
