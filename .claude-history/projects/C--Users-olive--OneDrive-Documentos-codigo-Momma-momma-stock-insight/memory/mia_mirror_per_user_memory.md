---
name: mia-mirror-per-user-memory
description: "Sistema Mirror per-user — profile vivo no Supabase atualizado real-time, espelha linguagem e padrões do usuário ao longo do tempo (padrão Claude Code auto-memory aplicado multi-tenant). Camada L4 do [[mia-5-layer-memory]]."
metadata: 
  node_type: memory
  type: project
  originSessionId: e27996f5-78ef-495a-aac7-de467ac1af35
---

# MIA Mirror — memória per-user real-time

## Conceito
Cada usuário tem profile vivo no Supabase, atualizado autonomamente pela MIA (estilo Claude Code auto-memory). Profile espelha linguagem, padrões, preferências, vocabulário.

**Análogo direto**: o `memory/` que Claude Code mantém pro CTO da Momma (essa pasta mesma). Mesma filosofia, escalada pra multi-tenant.

## Tabela: `mia_user_profile_v2`
Estrutura por user_id:
- `profile.md` — compilado, carregado em todo prompt (~1.5k tok)
- `style.md` — linguistic mirror
- `workflows.md` — macros aprendidos
- `preferences.md` — defaults
- `observations.jsonl` — raw events, alimenta distillation

## Ciclo de update (2 níveis)

**Nível 1 — Light updates (cada turn, async, barato):**
1. Save raw event em observations.jsonl
2. Small classifier (1 chamada barata): contém fato/preferência/correção?
3. Se sim → enfileira pra distillation
4. NÃO bloqueia próxima resposta (fire-and-forget)

**Nível 2 — Distillation (a cada 10 turns OU 1h, async, reasoning model):**
1. LLM lê fila eventos + profile atual
2. Atualiza profile.md (insere/atualiza/remove)
3. Re-distila style.md
4. Detecta workflows novos (3+ repetições mesmo padrão)
5. Marca fatos contraditórios pra revisão

## Style mirror (linguagem)
- A cada 50 mensagens user → sample + distila padrões linguísticos
- Output: tom, vocabulário, estrutura, abreviações, o que evita/enfatiza
- Injeta no system prompt: "Adapta resposta a esse estilo"
- **Mínimo 30 mensagens antes de ativar** (amostra fraca = mirror ruim)

## Pattern mirror (comportamento)
- Observa sequências (workflow + time-of-day + entities)
- 3+ repetições em janela curta → propõe macro
- Proativa: "Sextas 17h você faz X — quer que eu prepare automático?"
- Conecta com workflow synthesis (vertical 6) e [[mia-tool-synthesis-readonly]]

## Hierarquia conflito
L5 Session > L4 User Mirror > L2 Role > L1 Global

User sempre sobrescreve role e global. Session imediata sobrescreve user.

## Limites (anti-bloat)
- Profile cap ~2k tokens (top fatos por confidence + recency)
- Decay: fatos não-usados 90d → confidence drop, eventualmente removidos
- Contradiction detector: nova evidência contradiz antiga → reavalia, baixa confidence

## Privacy / Controle
- Página `/perfil/mia` (LGPD-friendly): user vê profile, edita, remove fatos, reseta, exporta
- L4 isolado por user (RLS Supabase)
- Workflows aprendidos: default per-user, opt-in pra "compartilhar com role"

## Como user atualiza (3 caminhos)
1. **Explícito**: "MIA, lembra que sempre pago pelo Inter" → confidence=1.0
2. **Inferido**: 5/5 ações iguais → MIA pergunta "quer que eu lembre?" → confidence=0.9
3. **Correção**: MIA errou → user corrigiu → MIA atualiza + boost confidence

**Why:** viabiliza "MIA imita/espelha usuário" sem precisar fine-tuning de modelo. Real-time = sensação de mágica. Cada user fica único.

**How to apply:** feature que adiciona contexto user vai aqui (L4), não em [[mia-glass-box-architecture]] global. Distillation usa reasoning model ([[mia-reasoning-selective-use]]).
