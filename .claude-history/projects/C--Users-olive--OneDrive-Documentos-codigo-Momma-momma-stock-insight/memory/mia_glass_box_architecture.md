---
name: mia-glass-box-architecture
description: "Arquitetura central MIA pós-2026-05-18 — intent classifier (chat/data/act) + 4 camadas de execução (L0 sub-agent tools / L1 React Actions / L2 DOM / L3 vision), glass-box pane só abre quando necessário, sub-agents continuam vivos como tool bundles (routing layer REMOVIDO), smart routing com fallback automático \"sem L0 → glass-box\"."
metadata: 
  node_type: memory
  type: project
  originSessionId: e27996f5-78ef-495a-aac7-de467ac1af35
---

# MIA Glass-Box Architecture (decidida 2026-05-18)

## Núcleo
- **MIA Core**: orchestrator único, chama tools direto
- **Sub-agents legacy**: continuam vivos como **bundles de tools** (L0) — NÃO deprecate
- **Routing layer "router→specialist→coordinator" REMOVIDO** — overhead inútil
- Multi-agent parallel: NÃO faremos (over-engineering pra ERP — single agent + batch L0 cobre)

## 4 camadas de execução (preferência decrescente)
| Camada | O que é | Pane abre? | Latência |
|---|---|---|---|
| **L0 (default)** | Sub-agent tools — Supabase queries/RPCs tipadas, resposta no chat | ❌ NÃO | ~100-300ms |
| **L1** | React Actions registradas (40+ atuais) | ✅ SIM se intent=act | ~500ms |
| **L2** | DOM control (computer use no app próprio com `data-mia-*`) | ✅ SIM | ~1-2s/passo |
| **L3 (fallback)** | Vision + screenshot (raro) | ✅ SIM | ~3-5s/passo |

## Intent classifier
- **Modos**: conversational | data | act
- **Heurística rápida (verbos)** → LLM fast fallback se ambíguo
- Verbos visuais ("mostra", "vê", "olha") inferem glass-box
- **Prefixos override**:
  - `/falar` força L0/chat
  - `/agir` força glass-box
  - `/mostra` força glass-box visual

## Regra de fallback (crítica)
> "Se não está nas tools que poderia fazer via texto, MIA atua via UI"

Sem L0 disponível → glass-box automático. Sem precisar pré-registrar action pra cada tela nova (auto-discovery via [[mia-5-layer-memory]] L3 Page Models resolve).

## Quando pane abre
- intent=act multi-step
- Operação envolve dinheiro/alta-stake (default ON, user pode desligar)
- User pediu `/agir` ou `/mostra`
- Sem L0 disponível → fallback auto

## Quando pane NÃO abre
- intent=conversational
- intent=data (read simples, write atômico via L0)
- Resposta cabe em chat

## Reasoning models seletivos ([[mia-reasoning-selective-use]])
- Plan step glass-box: reasoning (Claude thinking/o3) — 1× por execução vale 5s extra
- Distillation Mirror (async): reasoning
- Specialist analysis (forecasting, anomaly): reasoning
- Execução de step: fast (grok-4.1-fast)

## Tool synthesis read-only Mês 4-5 ([[mia-tool-synthesis-readonly]])
MIA gera SELECT pra demanda nova → sandbox → user revisa → opcional salvar como tool. Writes NUNCA auto-gerados.

## Confidence-graded autonomy
- Page Model validado + alta confiança → executa direto
- Page nova (auto-discovered) → narra cada step, autonomia "cuidadoso"
- Page com histórico de erro → pergunta antes de cada step

## UX glass-box ([[mia-modo-ia-button-layout]])
- Split layout (ERP esquerda funcional, MIA direita chat+watch log)
- Watch log: scrolling micro-ops, confidence badge, pausar/assumir
- DOM highlights: elementos sendo tocados destacados
- Modos autonomia: cuidadoso | assistido (default) | live | off

**Why:** AI-native real no nível usuário sem over-engineer. Sub-agents L0 cobrem ~70% via chat direto (sem pane), glass-box pega o resto. Auto-adaptação a telas novas via [[mia-5-layer-memory]] L3.

**How to apply:** qualquer feature MIA nova passa por L0 first → L1 → L2 → L3. Glass-box pane segue regra. Telas novas precisam `data-mia-*` no design system (hygiene obrigatória).
