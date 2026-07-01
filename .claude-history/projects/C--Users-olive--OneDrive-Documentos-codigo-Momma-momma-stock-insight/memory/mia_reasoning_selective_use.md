---
name: mia-reasoning-selective-use
description: "Reasoning models (Claude thinking, o3, Grok thinking) usados seletivamente em MIA — plan step glass-box, distillation Mirror, specialist analysis. Fast models pra execução frequente. Custo bounded (~30% extra), latência só onde vale."
metadata: 
  node_type: memory
  type: project
  originSessionId: e27996f5-78ef-495a-aac7-de467ac1af35
---

# Reasoning Models em MIA — uso seletivo

## Princípio central
**Reasoning pra pensar (raro), fast pra agir (frequente).**

Pattern Anthropic + OpenAI usam internamente. ERPs do mercado NÃO fazem. Vantagem competitiva real.

## Onde usar REASONING
| Etapa | Por quê | Cadência |
|---|---|---|
| **Plan step do glass-box** | 1× por execução. 5s extra vale pra acertar plano (erro cascateia). | Por execução glass-box |
| **Distillation Mirror** ([[mia-mirror-per-user-memory]]) | Async background. Qualidade vale tempo. | Cada 10 turns / 1h |
| **Specialist analysis** | Forecasting, anomaly, "explica esse padrão" — análise pesada | Quando chamado |
| **Workflow synthesis** | Detectar pattern, não-real-time | Background |

## Onde usar FAST (continuar como hoje)
- Resposta conversacional simples
- Execução de step individual (action) durante watch log
- Light updates Mirror (apenas classifica se vale enfileirar)
- Intent classifier (heurística + fast LLM fallback)

## Modelos candidatos
- **Reasoning**: Claude com extended thinking, o3-mini, Grok thinking, DeepSeek R1
- **Fast (existing chain)**: grok-4.1-fast → grok-4-fast → deepseek-v3.2 → llama-4-maverick

## Routing LLM (proposta)
```
Conversational simples       → grok-4.1-fast
Plan step (1× per glass-box) → Claude thinking / o3-mini
Action step (cada execução)  → grok-4-fast
Distillation (a cada 10 turns, async) → Claude thinking
Specialist (forecasting, anomaly)     → fine-tuned do parceiro OR reasoning
```

## Economia (custo)
Reasoning roda em ~5% dos casos → +30% custo total, não 5×.

Bounded porque:
- Plan step: ~1 chamada por glass-box session
- Distillation: ~1 chamada a cada 10 turns (async)
- Specialist: raro

## Latência
**Aceitável quando:**
- User espera resultado de qualidade (plan, análise)
- Async/background (distillation)

**NÃO aceitável quando:**
- Conversação real-time
- Execução de step individual durante watch log (user vendo MIA fazer)

## Quando NÃO usar reasoning (pegadinhas comuns)
- Quick reply ("oi", "tudo bem", "obrigado") — fast model basta
- Read simples ("me diz NFs maio") — L0 query, sem raciocínio
- Action atômica ("clica em X") — fast model decide
- Loop ReAct rapid-fire — fast model

**Why:** qualidade do plano cascateia em tudo (erro de plano = execução errada inteira). Distillation profunda = Mirror melhor. Specialist analysis pesada precisa raciocínio. Custo bounded torna viável.

**How to apply:** adicionar nível separado no LLM routing pra plan step e distillation. Implementar em `supabase/functions/_shared/noaa-core/llm.ts` (ou MIA equivalent). Default permanece fast chain; reasoning é opt-in por step type.
