---
name: darcy-local-self-hosted-mirror
description: darcy-local foi reconstruído como espelho fiel do darcy-nuvem adaptado p/ Supabase local em Docker (self-hosted via túnel) — 2026-05-28
metadata: 
  node_type: memory
  type: project
  originSessionId: 66c95ba9-d202-4168-9a7a-c5293a041c9a
---

A pasta `darcy-local/` foi transformada em um espelho fiel do `darcy-nuvem` adaptado para rodar
**Supabase local em Docker no nosso próprio servidor**, exposto ao Moodle via **túnel** (cloudflared/ngrok).
Antes estava velha (Out/2025, ainda com código morto Lovable/Stripe).

**Estado de versionamento (2026-05-28):** darcy-local agora é versionada DENTRO do repo raiz
`Ochozn/css-chat-bubble-style` (PRIVADO), no branch `main`, LADO A LADO com darcy-nuvem (commit `c05260c`).
Antes era um repo git separado/gitignored; o `.git` aninhado foi MOVIDO para `../_darcy-local-git-backup`
(fora do repo, reversível). Há um `README.md` na RAIZ do repo descrevendo as duas variantes (nuvem x local).
Os segredos (chave SSH `darcy_vm_key`, OpenRouter key em `functions/.env`, `.env`) ficam FORA do git —
cobertos pelo `.gitignore` da raiz E do darcy-local (rede dupla). Verificado: real key/SSH NÃO commitados.

**Why:** vamos hospedar no nosso servidor mantendo a MESMA infra (Supabase), só que local. O nuvem é a
versão mais avançada/funcional; o objetivo foi portar tudo sem perder NENHUMA funcionalidade. Ver
[[project_team_and_cleanup]] (remoção do Lovable) e [[project_darcy_architecture]] (infra cloud original).

**How to apply:** ao mexer no darcy-local, lembre das decisões tomadas (2026-05-28):
- URLs browser-facing são **env-driven** (default `127.0.0.1:54321`): dashboard via `import.meta.env.VITE_SUPABASE_URL`
  (src/integrations/supabase/client.ts, src/lib/dashboardApi.ts); widget via esbuild `define` em widget-src/build.mjs
  (lê o .env da raiz) injetando `__DARCY_*__` em widget-src/src/services/config.ts; widget-loader usa `Deno.env SUPABASE_URL`.
- Em produção a URL do túnel vai no `.env` (VITE_SUPABASE_URL + SUPABASE_URL) → **rebuild do widget + reseed do Storage**.
- Keys = **demo do `supabase start`** (anon demo padrão hardcoded como default, override por .env).
- Storage **semeado via config.toml**: bucket `ativos` (./seed/ativos/widget.js) e `widget-assets` (./seed/widget-assets/darcy-avatar.png, baixado do bucket público cloud).
- Secrets das functions (OPENROUTER/MOODLE/XAI/TEACHER) chegam via `[edge_runtime.secrets]` no config.toml (`env(VAR)`), resolvidos das envs que o `start-local.sh/.ps1` faz `source supabase/functions/.env` ANTES do `supabase start` — runtime único, sem segundo `functions serve` (esse fica só como hot-reload opcional no dev). SUPABASE_* são injetadas pelo runtime. config.toml validado contra CLI 2.101.
- Scripts em `darcy-local/scripts/` (start-local, tunnel, build-widget .sh/.ps1 + upload-widget.mjs). Guia: `darcy-local/README-LOCAL.md`.
- Funções vivas = as 7 do nuvem (analytics, chat-sessions, darcy-chat, darcy-controls, darcy-voice, dashboard-api, widget-loader) + _shared. Removidas as mortas (check-subscription, create-checkout, customer-portal, generate-*, darcy-chat-web).

**Pendências no servidor real:** `.env` da raiz está TRACKED no repo darcy-local (versão antiga tinha a OpenRouter key
no histórico) → rotacionar a key e `git rm --cached .env`. O widget.js semeado ainda tem URL cloud embutida →
exige rebuild com a URL do túnel. Não rodamos Docker/supabase nesta máquina (só preparamos o código).
