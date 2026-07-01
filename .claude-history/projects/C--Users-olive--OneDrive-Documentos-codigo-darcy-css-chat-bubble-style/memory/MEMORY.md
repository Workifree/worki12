# Darcy Project Memory Index

- [project_darcy_architecture.md](project_darcy_architecture.md) — Complete architecture overview, key decisions, and current state
- [feedback_deployment_workflow.md](feedback_deployment_workflow.md) — Critical deployment steps and pitfalls (WIDGET_VERSION bump, cache busting)
- [feedback_no_coauthor.md](feedback_no_coauthor.md) — Never add Co-Authored-By to git commits
- [project_darcy_pilot_blockers.md](project_darcy_pilot_blockers.md) — Bloqueadores e decisões pré-piloto (codereview 2026-05-22)
- [project_team_and_cleanup.md](project_team_and_cleanup.md) — Equipe de 4 + 3 áreas (docs/equipe) e remoção total do código Lovable (2026-05-25)
- [project_telemetry_v3.md](project_telemetry_v3.md) — Telemetria training-grade v3 (telemetry_turns): captura de conteúdo + observabilidade LLM sob governança LGPD; reverte a postura de "não guardar conteúdo" (2026-05-26)
- [project_mvp_hardening_ralph.md](project_mvp_hardening_ralph.md) — Branch ralph/mvp-hardening: review world-class + 20 fixes Ralph dos bloqueadores de MVP; NÃO deployado, depende do MANUAL-DEPLOY-CHECKLIST (2026-05-26)
- [project_voice_text_parity.md](project_voice_text_parity.md) — Núcleo compartilhado supabase/functions/_shared/: darcy-voice agora usa o mesmo conhecimento/dados/tools/telemetria do darcy-chat (fim da duplicação inline) — branch ralph/voice-parity, deployado (2026-05-26)
- [project_darcy_local_selfhosted.md](project_darcy_local_selfhosted.md) — darcy-local reconstruído como espelho fiel do nuvem p/ Supabase local em Docker (self-hosted via túnel); decisões env-driven/demo-keys/seed (2026-05-28)
- [reference_cead_vm_access.md](reference_cead_vm_access.md) — Como acessar o VM cead (SSH porta 13508, user darcy, chave darcy_vm_key) e layout do stack/Tailscale Funnel (2026-05-29)
- [project_text_repair_layer.md](project_text_repair_layer.md) — Camada de correção de texto PT-BR (anti palavras-grudadas) no darcy-chat: determinístico (léxico 30k) + revisor IA gated; só darcy-local (2026-06-09)
- [project_moodle_knowledge_base.md](project_moodle_knowledge_base.md) — Base de conhecimento do Moodle (25 seções da doc oficial) no darcy-chat: núcleo fixo + roteador por palavra-chave, SEM RAG; só darcy-local (2026-06-10)
- [project_dashboard_live_cead.md](project_dashboard_live_cead.md) — Painel no ar em https://tutordarcy.cead.unb.br (SPA na raiz, login Supabase, dashboard-api+auth abertos no Apache); como criar usuários; telemetria SOTA (2026-06-11)
