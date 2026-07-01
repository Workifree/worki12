---
name: darcy-pilot-blockers
description: Bloqueadores conhecidos e decisões pendentes pré-piloto Darcy (<100 alunos UnB) identificados em codereview de 2026-05-22
metadata: 
  node_type: memory
  type: project
  originSessionId: 55ea0ea2-76a4-48b8-ae7a-866cae737730
---

Codereview completo realizado em 2026-05-22 antes do piloto. Itens marcados como BLOQUEADORES que precisam ser verificados antes de qualquer deploy:

1. **MOODLE_TOKEN vazado** em texto plano em `test-moodle.mjs`, `test-moodle.ts`, e `docs/DARCY_WIDGET_DOCUMENTATION.md:704`. Token: `b20e214f4bbbac5c8ea96ce2e23ca0f9`. Precisa rotação no Moodle.

2. **RLS aberta** (`USING (true)`) em tabelas analytics (`analytics_question_frequency`, `analytics_link_clicks`, `analytics_abandonment_points`, `analytics_data_access_logs`, `widget_heartbeats`) — migrations `20251001010946` e `20251002154156`. Combinado com anon key pública = vazamento de dados de alunos.

3. **`darcy-voice` (untracked)** com botão visível pra todos. Decisão: feature flag desabilitada no piloto. Razão: sem consentimento LGPD (áudio vai pra xAI), sem rate limit (custo descontrolado), código nunca rodado em prod.

4. **`COURSE_DARCY_ENABLED = true`** em `widget-src/src/App.tsx:18` — habilita Darcy Tutor verde. Memory anterior dizia que era `false` em prod. Confirmar com usuário se essa mudança é intencional pro piloto.

5. **Branches `master` e `main` divergiram** — features distintas em cada. Trabalho real está em `master`.

**Why:** Piloto com alunos universitários reais; vazamento de PII ou abuso de cota teria custo reputacional alto pra UnB.

**How to apply:** Antes de qualquer `npm run build` + deploy, validar que (1) e (2) estão resolvidos. Sem isso, não deployar mesmo em homologação.

**Atualização 2026-05-25:** Item 4 resolvido — `COURSE_DARCY_ENABLED=false` nos DOIS lados (widget `App.tsx` + kill-switch no backend `index.ts` que anula courseId). Piloto é **suporte-only (Darcy azul)**; tutor de curso é feature futura. Deploy de produção feito (darcy-chat + widget-loader v21 + widget.js no Storage). LLM migrou de grok pago para **modelos :free do OpenRouter fixos** (lista em `config.ts`, validar com `node evals/run.mjs`). Itens 1 (MOODLE_TOKEN) e 2 (RLS) NÃO revalidados nesta sessão — assumidos resolvidos pelos commits de hardening, mas confirmar.

Ver também: [[project-darcy-architecture]], [[feedback-deployment-workflow]].
