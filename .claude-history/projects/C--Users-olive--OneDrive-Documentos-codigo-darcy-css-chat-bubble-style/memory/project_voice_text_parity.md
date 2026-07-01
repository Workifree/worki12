---
name: voice-text-harness-parity
description: Nucleo compartilhado supabase/functions/_shared/ — darcy-chat (texto) e darcy-voice usam o MESMO conhecimento/dados/tools/telemetria; voz deixou de duplicar inline
metadata: 
  node_type: memory
  type: project
  originSessionId: fb336e30-cde9-48ef-af9b-b01d5562754f
---

Em 2026-05-26 (branch `ralph/voice-parity`, plano aprovado, 13 stories Ralph) o harness de VOZ (`darcy-voice`, xAI Realtime) foi levado à paridade com o de TEXTO (`darcy-chat`, OpenRouter) via **núcleo compartilhado** `supabase/functions/_shared/`.

**Antes:** `darcy-voice` era um proxy WebSocket auto-contido de 1564 linhas que DUPLICAVA inline o prompt (FAQ 18/22), o prefetch do Moodle e as tools (6 read-only) — não importava nada de `darcy-chat`. Divergia.

**Agora — `_shared/` consumido pelos DOIS:**
- `_shared/config.ts` — `COURSE_DARCY_ENABLED` (kill-switch único) + `MODEL_IDS`/`LLM` + CORS.
- `_shared/security.ts` — `sanitizeForPrompt` + `createRateLimiter`.
- `_shared/telemetry.ts` — `recordTurn`/`buildTurnRecord`/`redactPII` (movido de darcy-chat/services).
- `_shared/moodle.ts` — `resolveMoodleInstance`, `fetchMoodleUser`, `verifyMoodleRole`, `fetchFullCourseContext`, `getAcademicContextString` (unifica moodle-course.ts + utils/helpers.ts + prefetch inline da voz).
- `_shared/tools.ts` — `TOOL_REGISTRY` canônico + `toOpenAITools` (texto, wrapper function:{}) + `toRealtimeTools` (voz, flat) + `executeTool` com guards (STUDENT_BLOCKED_TOOLS, enforce courseId, SSRF).
- `_shared/knowledge.ts` — FAQ CEAD (22), persona, `<moodle_interface>`, `resolvePlatform` (Aprender 2/3), triagem, contatos, constraints, SECURITY_PREAMBLE + `buildTextSystemPrompt` (texto) + `buildVoiceInstructions` (fala).

Os `darcy-chat/services/{prompts,tools,moodle-course,telemetry}.ts` e `config.ts` viraram **re-exports** de `_shared/` (imports antigos + evals/harness-entry.ts continuam funcionando). Princípio: compartilhar CONTEÚDO+LÓGICA, adaptar só o FRAME do canal (texto=markdown+messages[]+cascata de modelos+quality gate; voz=fala+session.update+tool flat+xAI realtime single model).

**Voz ganhou (paridade):** FAQ completa, UI guide, plataforma dinâmica, `verifyMoodleRole` server-side, learningProfile, registry COMPLETO de tools (read+write+professor, gated por role+curso), guards, kill-switch (suporte-only no piloto), telemetria por turno de fala (transcripts xAI → telemetry_turns sob consentimento), rate-limit (20 sessões/usuário/hora) e consentimento LGPD antes do `getUserMedia` (widget).

**Verificação:** Fase 0 (extração do texto) provada byte-idêntica (US-006 comparou getSystemPrompt em 8 contextos) + smoke ao vivo. Release: darcy-chat E darcy-voice empacotaram os imports de `_shared/` no deploy do Supabase sem erro; smoke texto OK + voz handshake `darcy.ready` OK. Widget `20260526-v26-voice-parity`. NÃO mergeado em main ainda (branch ralph/voice-parity).

Pendente p/ alunos reais: validar voz em conversa de áudio real no browser + revisar custo xAI Realtime. Ver [[mvp-hardening-ralph-branch]], [[project-darcy-architecture]], [[project_telemetry_v3]].
