---
name: team-structure-and-lovable-cleanup
description: "Equipe de 4 (tech lead + 3 estagiários), 3 áreas de propriedade, docs em /docs/equipe; e a remoção completa do código morto do template Lovable em 2026-05-25"
metadata: 
  node_type: memory
  type: project
  originSessionId: 842075a2-55ef-40d4-8626-639c6d85c451
---

**Equipe (a partir de 2026-05-25):** usuário vira tech lead/arquiteto/PM + 3 estagiários júniores (bolsistas de extensão, tempo parcial). Método: Kanban fino (Backlog→Semana→Fazendo→Review→Feito, WIP=1), sync semanal 45min, 1:1 quinzenal alternado, fatias verticais, sem Scrum/daily. Toda PR revisada pelo tech lead; base é a branch **main**.

**Branches consolidadas (2026-05-25):** `master` e `main` divergiam (main tinha 53 commits antigos da era Lovable; master tinha a reescrita limpa). Resolvido: `origin/main` foi force-pushed para o tip limpo de master — agora **main == master == 7a3e4ab**. Os 53 commits antigos de main estão preservados na tag remota **`archive/lovable-legacy-main`** (b48840b). Trabalho local agora na branch `main`.

**3 áreas de propriedade** (cada estagiário dono de uma):
- **A — Widget/Experiência:** `widget-src/` + `widget-loader/` (média; TS/Preact/DOM).
- **B — Cérebro/IA:** `supabase/functions/darcy-chat/` + `evals/` (a mais difícil; LLM/Deno).
- **C — Analytics/Dashboard:** `supabase/functions/analytics/` + `migrations/` + `src/` (média; React/TanStack/SQL).

Plano completo em **`docs/equipe/`**: README, como-trabalhamos, template-missao, backlog-inicial (9 missões escopadas do código real). Decisões pendentes ali: course Darcy (verde) fica parado; níveis dos estagiários não calibrados (1ª missão de cada um = calibragem).

**Limpeza Lovable (2026-05-25):** removida toda a ilha de código morto do template SaaS original — `src/components/{DarcyChat,ChatWidget,ModernChatWidget,SubscriptionPlans,GoogleAdBanner,Mermaid,MessageContent,Premium*,BackgroundRemover,SuggestionButtons,files/,tutoring/}`, `src/pages/{Index,Auth,NotFound}`, `src/hooks/useSubscription`, e 6 edge functions (`check-subscription`, `create-checkout`, `customer-portal`, `generate-image`, `generate-audio`, `darcy-chat-web`). Removidos `lovable-tagger` + libs órfãs (huggingface/transformers, mermaid, react-syntax-highlighter, react-markdown, remark-gfm). `package.json name` → `darcy-dashboard`. config.toml só lista widget-loader/darcy-chat/analytics. **O repo agora é Darcy-only — não recriar nada de subscription/ads/tutoria/geradores.** Builds validados (dashboard + widget). Commitado e pushado (commits `b545dd0` limpeza + `7a3e4ab` docs/equipe) em main e master.

Ver também: [[project-darcy-architecture]], [[darcy-pilot-blockers]].
