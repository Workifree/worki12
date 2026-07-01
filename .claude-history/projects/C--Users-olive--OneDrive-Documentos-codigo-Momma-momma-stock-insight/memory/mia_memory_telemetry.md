---
name: MIA memory cross-session + telemetria industry-grade
description: Arquitetura de memória persistente por usuário e captura de padrões/satisfação/intent em mia_query_logs
type: project
originSessionId: e9190229-fe56-4ea5-b02e-2aea4c62832d
---
## Cross-device history (Fase 1 — abr/2026)
Até abril/2026, MIA guardava conversas em **localStorage** (`useMia.ts`) — por isso histórico mobile ≠ desktop. Fix: DB é source-of-truth, localStorage vira cache.

- **Repo:** `src/features/mia/api/conversationRepo.ts` — `listUserConversations`, `loadConversationMessagesFromDB`, `deleteConversationInDB`, `setConversationTitle`.
- **Sync no useMia.ts:** useEffect que dispara uma vez por `user.id`, puxa lista do DB + merge com localStorage (DB vence em colisão). Optimistic load no `switchConversation` (cache local imediato, depois substitui pelo DB).
- **Schema:** `mia_sessions.title`, `mia_sessions.archived_at` (novos); RLS por `user_id = auth.uid()`; service_role bypass p/ edge functions; índices `idx_mia_sessions_user_last_activity`, `idx_chat_messages_session_created`, `idx_chat_messages_user_created`.

## Memória cross-session da MIA (Fase 2)
Tabela `mia_user_memory(user_id, type, fact, description, confidence, scope, source_session_id, use_count, superseded_by, archived_at)`. Types: `user`, `feedback`, `project`, `reference`, `pattern`.

- **Recall** (`supabase/functions/mia/core/user_memory.ts` → `recallUserMemories`): 2 camadas — core `user`+`feedback` (sempre, confidence ≥ 0.7) + contextual `project`/`pattern`/`reference` filtrado por ILIKE nos termos >3 chars da query atual. Max 8 mems por turn.
- **Injeção no prompt**: `formatMemoriesForPrompt` retorna bloco `<user_memory>` que vai em `page_context._userMemoryBlock` → `buildDynamicContext` concatena no system prompt dinâmico.
- **Extração**: fire-and-forget após a resposta (non-streaming + streaming paths). Só a partir do 4º turn, com rate-limit de 10 min por session (evita duplicata). LLM grok-4.1-fast classifica em JSON array estruturado.

## Telemetria industry-grade (Fase 3)
Campos novos em `mia_query_logs`: `user_intent`, `intent_confidence`, `conversation_thread_id`, `satisfaction_signal` (-1/0/1), `output_format`, `input_tokens`, `output_tokens`, `cached_tokens`, `model_used`, `selected_loja_id`.

- **Intent detection** (`core/telemetry.ts` → `detectIntent`): regex-only (O(1)), 12 categorias (list/count/create/update/delete/analytics/navigate/help/compare/search/report/unknown).
- **Feedback signals** (`mia_feedback_signals` table): 8 signal_types — reformulation (overlap >45% com pergunta anterior), complaint, thanks, correction, repeat_ask, abandon, followup_same, followup_switch. Detecção regex (complaint/thanks/correction/repeat) + heurística (reformulation). Polarity -1/0/1.
- **User patterns** (`mia_user_patterns` + função `compute_mia_user_patterns(user_id?)`): agrega top_tools/intents/modules/lojas/active_hours + preferred_format + expertise_level + reformulation_rate + error_rate + avg_latency_ms. Cron diário 05:00 UTC (02:00 BRT).
- **View** `vw_mia_user_profile`: consolidado p/ dashboard de perfil.

## Como se encaixa
No início de cada turn no edge function `mia`:
1. Fetch user role/permissions (existente)
2. **Fetch memórias + profile** → injeta no `page_context._userMemoryBlock` (novo)
3. `resolveActions` + `processMessage` (existente)
4. **Log enriquecido** em mia_query_logs + signals em mia_feedback_signals (novo)
5. Save assistant response
6. **Fire-and-forget `extractAndSaveMemories`** (novo)

## Source files
- Migrations: `mia_sessions_title_and_indexes`, `mia_user_memory_and_patterns`, `mia_user_patterns_compute_fn`
- Backend: `supabase/functions/mia/core/user_memory.ts`, `supabase/functions/mia/core/telemetry.ts`, `index.ts` (integração nos 2 paths: stream + regular)
- Frontend: `src/features/mia/api/conversationRepo.ts`, `src/features/mia/model/useMia.ts` (sync + repo calls)
