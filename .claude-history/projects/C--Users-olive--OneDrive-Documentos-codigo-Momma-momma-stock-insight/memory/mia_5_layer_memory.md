---
name: mia-5-layer-memory
description: 5 camadas de memória MIA (L1 mia.md global git / L2 skills/<role>.md git / L3 page_models Supabase shared / L4 user Mirror Supabase per-user / L5 session RAM). Análogo CLAUDE.md + skills + auto-memory aplicado multi-tenant.
metadata: 
  node_type: memory
  type: project
  originSessionId: e27996f5-78ef-495a-aac7-de467ac1af35
---

# 5 Camadas de Memória MIA

## Estrutura
| Camada | Storage | Atualizado por | Cadência | Análogo Claude Code |
|---|---|---|---|---|
| **L1 Global** (mia.md) | Git `docs/mia/mia.md` | CTO/admin | Commit PR | `CLAUDE.md` |
| **L2 Role** (skills/<role>.md) | Git `docs/mia/skills/` | CTO/admin | Commit PR | Skills/subagents |
| **L3 Page Models** | Supabase `mia_page_models` | Auto-discovery | Real-time bg | Codebase index |
| **L4 User Mirror** | Supabase `mia_user_profile_v2` | MIA + user | Real-time | Auto-memory (`memory/*.md`) |
| **L5 Session** | RAM (React state) | MIA | Instant | Conversation history |

## Por que git + Supabase
- **Git** (L1, L2): coisas **estáveis, deliberadas, auditáveis**. Regra de negócio, jargão, workflows de role. Mudar exige PR + review.
- **Supabase** (L3, L4): coisas **dinâmicas, observadas, voláteis**. MIA aprendeu sozinha ou user ensinou. Muda toda hora.

## L1 — `docs/mia/mia.md` (~2-3k tokens, todo prompt)
- Empresa Momma (doces saudáveis, shelf-life 3-5d)
- Lojas (loja_id 1-6 com nomes)
- Jargão (BT = brigadeiro tradicional, AC = Águas Claras, etc.)
- Regras invioláveis (apenas produtos ativos, pagamento >R$5k confirma, transferência ≠ NF)
- Tom desejado (direto, pt-BR, profissional)
- **BASE: adaptado do system prompt do Claude Code** (proven patterns: tone, doing tasks, executing actions with care, memory rules)

## L2 — `docs/mia/skills/<role>.md` (~1-2k tokens cada, carregado por role)
- 1 arquivo por role: financeiro, operador, gerente, admin, master
- Workflows típicos, preferências de role, telas principais, ações destrutivas comuns

## L3 — `mia_page_models` (Supabase, compartilhado org-wide)
Schema:
```json
{
  "page_id": "/financeiro/contas-pagar",
  "domain": "financeiro",
  "entities": ["conta_pagar"],
  "primary_actions": ["criar", "pagar-lote", "filtrar"],
  "destructive_actions": ["cancelar", "pagar-lote"],
  "form_fields": [...],
  "table_columns": [...],
  "confidence": 0.94,
  "last_validated": "..."
}
```
- Auto-descoberto via DOM scan + `data-mia-*` semantics
- Compartilhado entre todos users (quanto mais uso, mais MIA aprende pra TODOS)

## L4 — User Mirror (per-user)
Detalhe em [[mia-mirror-per-user-memory]].

## L5 — Session
Página atual, seleções, contexto da conversa, últimas msg. RAM only. Some ao sair.

## Prompt assembly (todo turn)
```
[SYSTEM]
├─ L1: mia.md                    ~2k tok    ← CACHED
├─ L2: skills/<role>.md          ~1.5k      ← CACHED
├─ Action catalog (4 layers)     ~3k        ← CACHED
├─ L4: user_memory top 20 facts  ~500
├─ L3: current page_model        ~500
├─ L5: session context           ~300
└─ Recent history (N msgs)

[USER MESSAGE]
```
Prompt cache hit ~85-90% (3 primeiras camadas mudam só em deploy/role-switch). Custo real por turn baixo apesar do contexto rico.

## Hierarquia conflito
L5 > L4 > L2 > L1 (específico → geral). User memory sobrescreve role; role sobrescreve global; session imediata sobrescreve user.

## Convenção semântica obrigatória
Pra L3 auto-discovery funcionar, componentes precisam `data-mia-*`:
```tsx
<main data-mia-page="contas-pagar" data-mia-domain="financeiro">
  <DataTable data-mia-entity="conta_pagar" ...>
  <Button data-mia-action="pagar-lote" data-mia-confirm="true">Pagar</Button>
</main>
```
"MIA-friendliness" vira check de code review (igual a11y).

**Why:** separação clara entre estável (git) e dinâmico (Supabase). Escala bem multi-tenant. L3 compartilhado = MIA fica mais esperta com escala.

**How to apply:** feature nova: pergunta "isso é regra inviolável org?" (L1) / "específico do role?" (L2) / "descoberto da página?" (L3) / "do user?" (L4) / "da sessão?" (L5).
