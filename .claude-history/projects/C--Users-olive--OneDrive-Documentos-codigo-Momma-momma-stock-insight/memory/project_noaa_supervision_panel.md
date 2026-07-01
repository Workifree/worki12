---
name: Noaa Supervision Panel
description: Painel de supervisao de atendimento Noa — grid de mini-telas, takeover, audio, WhatsApp, metricas
type: project
originSessionId: 81681d5a-5dec-4bfb-8513-db61c4f059db
---
Painel de supervisao para o chatbot Noa implementado em 2026-04-10.

**Why:** Supervisor precisa ver todas as conversas da IA em tempo real, assumir chats quando necessario, e medir conversao/receita.

**How to apply:**
- Frontend: `src/features/noaa-supervisor/` — page, hooks, componentes
- Backend: `supabase/functions/noaa-supervisor/index.ts` (REST API), `noaa-whatsapp/index.ts` (WaSender)
- Shared Core: `supabase/functions/_shared/noaa-core/` (llm, session, order, types, system-prompt)
- DB: `noaa_messages` (Realtime per-message), `noaa_sessions` (mode ai/human, channel, tags)
- Storage: bucket `noaa-media` para audio/imagens
- Migration: `20260410000000_noaa_supervision_panel.sql`
- Acesso: tab "Conversas" dentro da pagina Encomendas, visivel apenas para isAdmin()
- Lazy loaded: `React.lazy()` para nao impactar bundle se nao admin
- WaSender API Key: secret `WASENDER_API_KEY` e `WASENDER_PERSONAL_TOKEN`
- Dual-write: msgs vao para conversation_history JSONB (legado) + noaa_messages (Realtime)
