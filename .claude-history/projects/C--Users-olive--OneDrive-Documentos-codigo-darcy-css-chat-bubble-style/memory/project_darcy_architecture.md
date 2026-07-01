---
name: Darcy Architecture & Current State
description: Complete architecture overview of the Darcy AI chatbot for UnB Moodle - widget delivery, analytics, edge functions, database schema
type: project
---

Darcy is an AI assistant embedded in Moodle (UnB - Universidade de Brasilia) as an HTML widget.

**Why:** UnB's distance learning program (EaD/UAB) has 50%+ dropout rates. Darcy serves as both technical support (blue Darcy) and pedagogical tutor (green Darcy, inside courses).

**How to apply:** All changes affect the `darcy-nuvem` subdirectory. Widget is Preact (widget-src/), backend is Supabase Edge Functions (supabase/functions/), database is Supabase PostgreSQL.

Key architecture decisions as of 2026-03-19:
- Widget delivered via widget-loader edge function → Supabase Storage → browser cache (2min TTL)
- WIDGET_VERSION string in widget-loader controls cache busting — MUST be bumped on every widget change
- Analytics uses REST API with service_role_key (edge function) and anon_key (widget heartbeats)
- Heartbeat system: widget POSTs to widget_heartbeats table every 10s via REST, view v_active_widgets shows real-time users
- User identification: get_or_create_user_from_moodle function (12 params) resolves by moodle_user_id then browser_id
- FK constraints REMOVED from analytics tables to prevent cascading failures
- GoTrueClient warning fixed by removing unused Supabase JS client from widget
- visibilitychange no longer kills heartbeat (only beforeunload and widget close do)
- Supabase project: bzkkonblfmdoqbumpsmo
- Primary LLM: x-ai/grok-4.1-fast via OpenRouter
- COURSE_DARCY_ENABLED = false in production (only support mode currently)
