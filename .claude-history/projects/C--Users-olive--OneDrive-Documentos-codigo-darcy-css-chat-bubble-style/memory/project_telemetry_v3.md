---
name: telemetry-v3-training-grade
description: Telemetria training-grade v3 do Darcy (telemetry_turns) — captura de conteúdo de conversa + observabilidade de LLM sob governança LGPD; implementada 2026-05-26
metadata: 
  node_type: memory
  type: project
  originSessionId: 2ffe8ba5-66ec-473d-86d2-7f9199cf0fba
---

Em 2026-05-26 implementei a **telemetria training-grade v3** do Darcy (schema_version `3.0.0`).

**REVERSÃO DE POSTURA:** antes o conteúdo das conversas era *deliberadamente NÃO armazenado* (ver [[darcy-pilot-blockers]] — privacidade/LGPD). O usuário (tech lead/PM) decidiu o oposto: **capturar conteúdo completo (pergunta + resposta + system prompt + janela de contexto) para treino**, com **base legal aprovada** + governança. Se futuramente isso for questionado, a justificativa é a decisão de 2026-05-26 com base legal declarada aprovada.

**Arquitetura (ver `docs/telemetria/README.md`):**
- Tabela canônica `telemetry_turns` (1 linha = 1 turno usuário→assistente). RLS = **service_role apenas** (tem conteúdo+PII; anon key do widget não toca).
- **Ponto de captura autoritativo = `darcy-chat/index.ts`** (tem system prompt, usage do OpenRouter, cadeia de fallback, gate). Grava em background (`EdgeRuntime.waitUntil`) — nunca bloqueia/quebra o chat. Devolve `turn_id`.
- Widget (`App.tsx`) só faz *linking*: manda `telemetry:{conversation_id,turn_index,session_id,browser_id}`, recebe `turn_id`, anexa em `interaction` e `feedback` (→ colunas `turn_id` novas em `analytics_interactions`/`analytics_feedback_detailed`) = preference data.
- `callLLMDirect`/`agentLoop` agora retornam `LLMResult` rico (chain de tentativas, usage, gate, best-effort). `openrouter.ts` pede `usage:{include:true}` (tokens+custo reais).
- Módulo novo `darcy-chat/services/telemetry.ts`: contrato `TurnRecord`, `redactPII()`, `buildTurnRecord()`, `recordTurn()`, validação dead-letter (valid=false em vez de dropar).

**Governança LGPD:** `has_training_consent(user_id)` (opt-out sobre base legal), retenção 540d via `cleanup_expired_telemetry()`, esquecimento `erase_user_telemetry(moodle_id)` (art. 18), redação de PII (export usa colunas `*_redacted`).

**Views:** `v_telemetry_health` (completude — "capturamos tudo certo?"), `v_model_performance` (custo/tokens/latência/gate por modelo — base p/ reordenar MODEL_IDS), `v_training_export` (pares prompt→completion redigidos + reward do feedback).

**Verificação:** `node evals/verify-telemetry.mjs` (precisa `SUPABASE_SERVICE_ROLE_KEY`).

**Status:** código pronto, widget rebuildado, `WIDGET_VERSION=20260526-v23-telemetry`. **NÃO deployado** — deploy é gated pelo usuário. **Ordem obrigatória: migração `20260526_telemetry_v3_training_grade.sql` PRIMEIRO** (cria colunas turn_id), depois `darcy-chat`+`analytics`+`widget-loader`+upload widget.js. Ver [[deployment-workflow-and-gotchas]].
