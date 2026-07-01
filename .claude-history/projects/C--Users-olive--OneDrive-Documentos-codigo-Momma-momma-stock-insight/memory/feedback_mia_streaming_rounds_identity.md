---
name: MIA — streaming real, 3 rounds, identidade do usuário no prompt
description: Três regras que quebraram no overhaul 63dd949 e precisam permanecer — token-by-token real, ReAct ≤ 3 rounds, nome+email+role do usuário sempre no system prompt
type: feedback
originSessionId: 9f339aa2-0d65-4dd9-bea9-c7ace405d230
---
**Três invariantes da MIA que vieram da legacy e não podem quebrar de novo:**

1. **Streaming token-a-token REAL** — `query_engine.ts` tem que chamar `callLLMStream` na rodada final. Nunca "yield como um chunk só pra economizar LLM call". O custo de +1 call vale a UX. Usuário percebe imediatamente quando tokens chegam batch no final.

2. **ReAct max 3 rounds** — em todos os agents (query_engine, finance, logistics, stock, catalog). Legacy era 3. O overhaul de 10/Abr dobrou pra 6 em todos os lugares — dobrou latência e custo sem ganho. Se precisar mais iterações, investigar prompt/tool-desc antes de subir.

3. **Identidade do usuário no prompt** — `index.ts` precisa buscar e injetar:
   - `_userName` (profiles.nome → username → null)
   - `_userEmail` (auth.users.email via `supabase.auth.admin.getUserById`)
   - `_userRole` (user_roles.name via profile)
   - `_userLojaId` / `_userLojaName`
   - `_userPermissions`
   Todos devem ser consumidos em `buildDynamicContext` no bloco IDENTIDADE DO USUÁRIO. Regra no prompt: "quando o user perguntar 'meu X', usar o nome acima, NÃO perguntar de novo".

**Why:** Usuário (CTO) em 2026-04-14 reportou regressões grandes — MIA não sabia o nome do usuário pra buscar salário, tokens chegavam todos no final, 6 rounds deixavam tudo lento. Legacy não tinha nenhum desses problemas.

**How to apply:**
- Ao mexer em `query_engine.ts`, nunca trocar `callLLMStream` por `yield { type: 'token', content }` do content inteiro.
- Ao adicionar rounds em qualquer agent, confirmar com user antes — default é 3.
- Ao mexer em context injection, manter o bloco IDENTIDADE DO USUÁRIO com nome+email+role+loja.
- Verificar sempre com `grep "MAX_ROUNDS = 6" supabase/functions/mia/` antes de fechar PR.
