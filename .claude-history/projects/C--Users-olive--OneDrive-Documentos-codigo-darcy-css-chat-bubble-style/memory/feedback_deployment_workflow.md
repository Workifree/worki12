---
name: deployment-workflow-and-gotchas
description: Critical deployment steps and common pitfalls when deploying Darcy widget and edge functions
metadata: 
  node_type: memory
  type: feedback
  originSessionId: 418b721f-cbbd-40a3-813e-840bd3d8b084
---

Deploy verificado em 2026-05-25 via **CLI do Supabase** (`npx supabase`, já autenticada na máquina do usuário — `projects list` funciona). NÃO use o `deploy-darcy.cjs` (tinha `verify_jwt:true`, que quebra o widget — o correto é `verify_jwt=false` do `supabase/config.toml`; e listava o `agent.ts` já deletado). NÃO há MCP do Supabase neste ambiente.

**Fluxo correto (project ref = bzkkonblfmdoqbumpsmo):**
1. `cd widget-src && npm run build` (gera dist/widget.js + copia p/ assets).
2. Bump `WIDGET_VERSION` em `widget-loader/index.ts` E `BUILD_TAG` em `widget-src/src/main.tsx` (cache-bust + boot log).
3. `npx supabase link --project-ref bzkkonblfmdoqbumpsmo` (senha em branco com `printf '\n' |` — pula prompt de DB).
4. Upload widget.js: **`storage cp` NÃO sobrescreve** (erro 409). Use REST com `x-upsert:true`: pegue a service_role via `npx supabase projects api-keys --project-ref ... -o json` (campo `api_key`, name `service_role`; NÃO imprimir o valor) e `curl -X PUT .../storage/v1/object/ativos/widget.js -H "Authorization: Bearer $KEY" -H "x-upsert: true" --data-binary @widget-src/dist/widget.js`.
5. `npx supabase functions deploy darcy-chat --project-ref bzkkonblfmdoqbumpsmo` (auto-empacota só arquivos importados; respeita config.toml). Idem `widget-loader`.
6. Smoke test ao vivo: GET `/functions/v1/widget-loader` (confere ETag/versão) e POST `/functions/v1/darcy-chat` com `{message,conversation,context}` (verify_jwt=false → sem auth).

**Gotchas:**
- Modelos `:free` do OpenRouter saem do catálogo sem aviso → IDs viram 400 e são pulados silenciosamente (harness cai pro próximo, e por fim `openrouter/free`). Valide IDs em `GET https://openrouter.ai/api/v1/models` (sem chave) e rode `node evals/run.mjs`.
- Free populares (llama-3.3) sofrem 429 → na prática cai pros fallbacks. Por isso a cauda da lista importa.
- Widget aparecer na prod depende do `<script>` do loader no additionalhtml do Moodle + CSP liberando supabase.co (`script-src`/`style-src`/`connect-src`). Boot log `[DARCY] boot <ver> @ host` confirma execução. Ver [[darcy-pilot-blockers]].

Ver também: [[project-darcy-architecture]].
