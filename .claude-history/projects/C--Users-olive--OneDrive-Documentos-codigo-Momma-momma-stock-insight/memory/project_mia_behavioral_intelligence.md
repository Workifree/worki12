---
name: project_mia_behavioral_intelligence
description: Sistema SOTA de captura comportamental + aprendizado contínuo + proativo da MIA (L1-L5)
metadata: 
  node_type: memory
  type: project
  originSessionId: 1caae7ba-bddb-499e-8cef-6c8d1e2b7b73
---

Sistema de inteligência comportamental da MIA — captura TODO uso da plataforma (não só chat), aprende continuamente, age proativamente. Branch `feat/mia-behavioral-intelligence`, PR #31.

**Captura (L1, frontend):** `src/shared/lib/analytics/` — `useMiaBehaviorTracker` + `useCounterfactualTracker` injetados global no `DashboardLayout` (roda pra todo user logado, mobile=desktop, independe de abrir chat). `analyticsQueue` batched + sendBeacon → tabela `gidape_events`. Captura page_enter/exit (dwell_ms, scroll_pct, next_page), feature_use, search_query, mia_opened, mia_suggestion_acted (link-click no MiaChatMessage usa `window.__mia_user_id` setado no useMia).

**Pipeline (L2/L3, SQL):** migration `20260531_mia_behavioral_intelligence.sql`. Trigger `fn_update_behavioral_profile()` AFTER INSERT em gidape_events atualiza `mia_user_patterns` em tempo real (peak_hours, top_pages, avg_dwell_ms, feature_usage_map, nav_graph, mia_suggestion_act_rate). Tabelas: `user_nav_graph`, `user_loops`, `mia_counterfactual_sessions`, `mia_distilled_patterns`, `mia_proactive_queue`. View `vw_user_behavioral_profile` + RPC `get_behavioral_profile`.

**Proativo (L4, crons pg_cron):** `mia-morning-digest` (30 10 * * *), `mia-anomaly-watcher` (*/15), `mia-pattern-analyzer` (0 2 * * *), `mia-distillation` (0 5 * * 0). Agendados via pg_cron+pg_net (migration `20260531_mia_behavioral_cron_schedules.sql`). Entregam em `mia_proactive_queue` + `notificacoes_master`.

**Padrão 1 — Distillation loop:** `mia-distillation` analisa conversas+ações+outcomes semanais via LLM, extrai skill_update/workflow_pattern/language_pattern/friction_insight → `mia_distilled_patterns` → injetado no prompt SEM deploy. É o auto-memory do Claude Code aplicado ao ERP.

**Padrão 2 — Counterfactual:** rastreia sessões SEM MIA como baseline pra medir impacto real (avg_dwell com/sem assistência).

**L5 — MIA adaptativa:** `user-context-loader.ts` carrega behavioral profile + distilled patterns. CRÍTICO: a injeção foi adicionada em `processMessage` E `processMessageStreaming` (index.ts ~linhas 3515 e 3810) — os 2 caminhos LEGACY reais. Glass-box NÃO foi tocado (protótipo pausado, ninguém usa). Consumer da fila proativa: `proactiveQueue.ts` + useMia surge com digest ao abrir (efêmero, isProactive flag, não persiste).

**Estado deploy (2026-05-31):** backend 100% live em prod (migration + 5 edge functions + 4 crons + smoke test HTTP 200). Frontend: código pronto, build OK, FALTA `npx vercel --prod` (Vercel não tem auto-deploy — `vercel.json` deploymentEnabled:false). Enquanto frontend não sobe, gidape_events fica vazia e crons retornam {users:0}.

**SHADOW LEARNING MODE (decisão 2026-06-01):** MIA captura e aprende em silêncio por ~15 dias; NADA proativo aparece a ninguém até ~2026-06-16. Kill-switch único: `mia_runtime_config.proactive_enabled` (default false). LIGAR em 16/06 com: `update mia_runtime_config set value='true'::jsonb where key='proactive_enabled';` (sem deploy, frontend e crons leem a flag). Gateado OFF: badge sidebar + toast realtime + greeting proativo no chat + crons morning-digest/anomaly-watcher (early-return skipped:proactive_disabled). Mantido ON: captura gidape_events + trigger + pattern-analyzer (aprende nav_graph/loops/counterfactual, só pula insert proativo) + distillation. Frontend gate: `src/features/mia/lib/proactiveConfig.ts`.

Já existem 3 crons MIA pré-existentes de sistema de aprendizado anterior: `mia-failure-learning-daily`, `mia-memory-distillation-weekly`, `mia-pattern-detector-daily`.

**QA forense (2026-06-01) — bugs encontrados e corrigidos contra prod real:**
- Trigger top_pages nunca acumulava (jsonb_agg sobre [] → NULL, NULL||obj=NULL). Corrigido + verificado.
- Crons programados contra colunas inexistentes (falhavam silenciosamente): profiles é `nome`/`user_id`/`default_store_id`/`role_id` (NÃO full_name/id/loja_id/role; role via RPC `mia_get_user_role`). estoque é `quantidade_atual` (NÃO quantidade), join via `produto_master_id`. daily_production é `quantity`/`product_name` (NÃO total_boxes/notes). NÃO existe tabela `roles`.
- `notificacoes_master` é tabela de RH (colunas tipo/titulo/descricao/lida, sem user_id), sino só pra isRhMaster, feed GLOBAL — NÃO usar como notificação per-user. Removido dos crons. Canal proativo correto = `mia_proactive_queue`.
- analyticsQueue beforeunload usava anon key → RLS rejeitava (auth.uid()=user_id). Corrigido: cacheia access token + flush em visibilitychange.
- user_loops faltava unique(user_id,loop_pages) → upsert do pattern-analyzer falhava. Adicionada.
- Entrega proativa push: `useMiaProactiveBadge` (badge no item MIA da sidebar, FAB foi removido) + toast realtime (mia_proactive_queue no publication supabase_realtime). anomaly-watcher detecta 11 anomalias reais hoje.

Relacionado: [[mia_architecture]] [[mia_memory_telemetry]] [[reference_supabase_cli_windows]]
