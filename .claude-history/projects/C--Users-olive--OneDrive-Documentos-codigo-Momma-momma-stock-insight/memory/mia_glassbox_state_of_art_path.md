---
name: mia-glassbox-state-of-art-path
description: "Plano de 12 alavancas pra MIA glass-box atingir nível \"Claude Chrome\" — sem vision, usando acesso à codebase. Implementado 19/maio/2026."
metadata: 
  node_type: memory
  type: project
  originSessionId: 3b91dd26-b895-4f8e-96ae-5847cfe259ce
---

CTO pediu MIA glass-box "world class nível Claude Chrome" sem usar vision (já temos codebase). Diagnosticamos 5 root causes do fluxo "criar NF Asa Norte R$100 não funcionava" + executamos 12 alavancas pra usabilidade 100% do sistema.

**Why:** Sem cobertura ampla, MIA só funciona em ilhas marcadas (notas-fiscais). Com healing + L0 tools + skills + observabilidade, dá pra crescer cobertura organicamente e ter telemetria pra priorizar.

**How to apply:** Quando user pedir extensão da MIA ou debug de "MIA não executou", verificar nesta ordem:
1. Page Model atualiza entre rounds? (refresh polling em [[mia_glass_box_architecture]])
2. data-mia-* existe no componente? (ver /mia/health)
3. Heal rate alto? (ver /mia/observability — adicionar data-mia-* exato)
4. Intent mapeia a tool L0? (`glass-box-tools.ts` + `intent-registry.ts`)
5. Skill da rota declarada? (`route-skills.ts`)

**Arquivos-chave criados/modificados:**
- Backend Deno: `supabase/functions/mia/glass-box-agent.ts` (refresh entre rounds + L0 fast path), `glass-box-tools.ts` (L0 tools), `route-skills.ts`, `intent-registry.ts`
- Frontend: `src/features/mia/lib/MiaDomController.ts` (Radix select + auto-healing cascade), `hooks/useMiaAutoDiscover.ts` (MutationObserver), `hooks/useMiaGlassBoxContextInjector.ts` (fields+filters+open_modals), `hooks/useMiaNavigationGraph.ts`
- Dashboards: `MiaHealthDashboard.tsx` (/mia/health), `MiaObservabilityDashboard.tsx` (/mia/observability)
- Marcação: `StoreSelector.tsx` (×2), `NotasFiscais.page.tsx`, `ManualInvoiceModal.tsx`
- Lint: `eslint-rules/mia-coverage.js` (3 rules WARN)
- Scripts: `scripts/codemod-mia-coverage.mjs`, `scripts/build-mia-codebase-index.mjs`
- Migration: `20260519140000_mia_route_transitions.sql`

**Roadmap restante pra "nível Claude Chrome":**
- Rodar codemod nas top 20 features pra elevar cobertura
- Popular natural_language_hints nas 30 rotas faltantes via useMiaPageContext
- Cron diário promovendo workflows com use_count >= 3 a "featured"
- LLM classifier substituir matchIntentToTool heurístico em production
- Hook DashboardLayout pra ler codebase-index.json via fetch (lazy)

**Evolução 2026-05-20 — 8 SOTA patterns (Reason→Act→Observe→Verify):**
- **#1 Micro-ReAct**: cada step do plan declara `expects` (modal_opens/closes, route_changes_to, store_changes_to, toast_contains, value_in_field, element_exists). Frontend `stepVerifier.ts` verifica automaticamente após executar. Log claro 🔍 Verify.
- **#2 Error classifier 7 categorias**: `errorClassifier.ts` classifica error raw em rate_limit/token_limit/element_not_found/action_noop/modal_not_opened/auth_permission/external_timeout. Cada categoria com retry strategy específica + exponential backoff jitter.
- **#3 Reflection step**: após executar plan, segundo LLM call CURTO revisa "objetivo cumprido? falta algo?" via `reflectOnObjective()`. Logs claros + atualiza reasoning com gap detectado.
- **#4 Action expectations declarativas**: `data-mia-expects-modal-open/close/toast/route/element-exists` nos componentes. `build-mia-action-catalog.mjs` lê e indexa. Backend cross-references.
- **#5 Knowledge graph**: `build-mia-codebase-index.mjs` cruza data-mia-action → handlers → tables → RPCs. Output codebase-index.json com `knowledge_graph`.
- **#6 Self-awareness**: `assessCapability(userMessage)` no início de runGlassBoxAgent verifica se sabe fazer. Se não, retorna sugestão clara em vez de tentar cego.
- **#7 Tree search**: plan schema aceita `alternatives[]`. `pickBestPlan` escolhe melhor via heurística (steps, destructive, has_save).
- **#8 Learning from failures**: migration `mia_failure_patterns` + RPC `mia_aggregate_failures` + edge function `mia-failure-learning` cron diário. Backend carrega top 5 patterns no prompt como negative few-shot.

**Evolução 2026-05-20 — GLOBAL KNOWLEDGE arquitetura:**
- 2 build scripts: `scripts/build-mia-sitemap.mjs` (68 rotas) + `scripts/build-mia-action-catalog.mjs` (177 actions, 25 fields, 6 filters, 4 modals)
- Gera `_generated/sitemap.ts` + `_generated/action-catalog.ts` que edge function importa direto (Deno)
- Agent prompt agora tem bloco "GLOBAL KNOWLEDGE" com rotas + actions filtradas pelo intent — MIA sabe TODO o sistema mesmo sem visitar
- REGRA #0 (skill da rota obrigatório) e REGRA #0.5 (troca de loja obrigatória) reforçadas no prompt
- Skills carregam cross-route via `extractRouteHintsFromMessage()` — user em /dashboard pedindo NF Asa Norte já vê skill notas-fiscais
- Bug "lastPlan ReferenceError" corrigido: const dentro do loop fazia shadow do let outer (TDZ)
- Singleton MiaDomController agora REFRESCA callbacks a cada chamada (cursor não movia por closure stale)
- watchLog + recordedActions persistem em localStorage entre reloads
- Glass-box NÃO faz fallback pro legacy router quando plan vazio (evita resposta texto "Confirmo para executar?")
