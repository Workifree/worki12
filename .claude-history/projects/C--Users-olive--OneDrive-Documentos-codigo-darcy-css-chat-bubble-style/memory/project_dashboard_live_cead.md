---
name: project_dashboard_live_cead
description: "Painel (dashboard) do Darcy no ar no cead — URL, login, como criar usuários, telemetria SOTA"
metadata: 
  node_type: memory
  type: reference
  originSessionId: cea28ead-5bc2-4a61-acab-afce678be95c
---

O **painel (dashboard React)** está NO AR, hospedado no próprio cead e conectado ao Supabase da VM (sem nuvem). Subido em 2026-06-11.

**Acesso:** `https://tutordarcy.cead.unb.br/` (SPA na raiz, mesmo domínio do widget). Login Supabase Auth (e-mail+senha). Conta de handover criada: `painel@cead.unb.br` (senha entregue ao usuário no chat, NÃO guardada aqui). Também existe `oliveira9138@gmail.com`.

**Como isso funciona (arquitetura):**
- O SPA é servido estático em `/var/www/darcy-painel` (build `npm run build` com `.env.production` → `VITE_SUPABASE_URL=https://tutordarcy.cead.unb.br` + anon key demo da VM). Como SPA e API ficam na MESMA origem, não há CORS.
- O vhost Apache `deploy/cead/darcy-public.conf` foi ampliado: além de widget/chat, agora libera `/auth/v1/*` (login) e `/functions/v1/dashboard-api` (dados). SPA fallback → index.html. Editado via docker-as-root (darcy não tem sudo); `apache2ctl configtest` ANTES do `graceful` (não derruba o widget).
- Dados via edge function `dashboard-api`: valida JWT do Supabase Auth + checa `public.dashboard_allowlist` (e-mail precisa estar lá) + lê com service_role. Expõe `telemetry_turns` **redigido** (`user_message_redacted`/`assistant_message_redacted`, nunca cru — LGPD), `v_telemetry_health`, etc.
- GoTrue: login por e-mail estava DESLIGADO (`GOTRUE_EXTERNAL_EMAIL_ENABLED=false`); liguei recriando só o container de auth e durei no config.toml (`[auth.email] enable_signup = true`, com `[auth] enable_signup = false` mantendo cadastro público OFF).

**Criar/gerir usuários do painel (na VM):**
1. GoTrue admin API (service_role do edge env): `POST localhost:54321/auth/v1/admin/users` `{email,password,email_confirm:true}`.
2. Allowlist: `insert into public.dashboard_allowlist(email) values('...')`.

**Telemetria = nível SOTA:** `telemetry_turns` captura tudo (conteúdo redigido, model_used, model_chain/fallback, tokens, cost_usd, latency_ms, quality_gate, tool_calls, agent_iterations, pii_types, is_error). `v_telemetry_health`: 100% de completude, 0 inválidos/erros. Ver [[project_telemetry_v3]].

Relacionado: [[reference_cead_vm_access]] (acesso/SSH/docker-as-root), [[project_moodle_knowledge_base]], [[project_text_repair_layer]].
