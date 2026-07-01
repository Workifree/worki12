---
name: mia-tool-synthesis-readonly
description: "Tool synthesis read-only com human-in-loop (Mês 4-5 post-MVP) — MIA gera query SELECT pra demanda nova, executa em sandbox, user revisa e pode salvar como tool persistente. Writes NUNCA auto-gerados. Vocês pioneiros — ERP do mercado não faz isso."
metadata: 
  node_type: memory
  type: project
  originSessionId: e27996f5-78ef-495a-aac7-de467ac1af35
---

# Tool Synthesis Read-Only

## Phase
**Mês 4-5 (post-MVP).** Fundação precisa estar estável. NÃO implementar antes (over-engineer).

Multi-agent parallel foi DESCARTADO (2026-05-18) — over-engineering. Mas tool synthesis foi MANTIDO porque tem ROI direto: MIA cobre infinitos casos sem pre-registro manual.

## Conceito
Quando L0 ([[mia-glass-box-architecture]]) não cobre um pedido específico, MIA gera query proposta. Executa sandbox. User revisa resultado. Opcionalmente salva como tool persistente.

## Fluxo
```
1. User: "Quanto vendemos de BT nas últimas 4 sextas-feiras?"
2. MIA verifica: tem L0 tool específica? NÃO.
3. MIA gera query proposta (sem executar ainda):
   SELECT SUM(qtd) FROM vendas_diarias 
   WHERE produto_id = ? AND EXTRACT(DOW FROM data) = 5
   AND data >= now() - interval '28 days'
4. Executa em sandbox (SELECT only, dry-run-ish, RLS herdada, timeout)
5. Mostra resultado pro user
6. Opcional: "Salvar como tool 'vendas_dia_semana_produto'?"
7. Se sim: salva em mia_user_tools (per-user OU per-org via aprovação CTO)
```

## Restrições segurança (críticas)
- **SELECT only** — writes NUNCA auto-gerados
- **Sandbox com timeout** (3s max)
- **RLS herdada** do user (não escapa permissões)
- **User REVISA** antes de persistir como tool
- **Org-wide tool** requer aprovação CTO
- **Audit log** de cada synthesis
- Sem `pg_*`, sem `current_setting`, sem funções perigosas

## Evolução futura (fora do MVP)
- **Mês 6+**: synthesis pra writes simples (UPDATE 1 campo) com confirmação dupla
- **Mês 8+**: synthesis complexa via PR pro repo (review humano antes de virar L0 oficial)

## Conexão com Mirror
Tools synthesized podem virar parte do Mirror per-user — MIA aprende quais queries user pede mais → vira "tool dele". Combinado com pattern detection ([[mia-mirror-per-user-memory]]), MIA propõe macros.

## Custo
LLM call extra por synthesis. Bounded porque só roda quando L0 falha + query é "nova". Maioria dos casos usa L0 existente.

## Por que vale (estratégico)
- Cobre **infinitos casos novos** sem pre-registro manual
- Combinado com Mirror, MIA fica progressivamente "mais sua"
- ERP do mercado **não faz isso** — vocês seriam pioneiros real (Voyager Minecraft research, Cursor pra código fazem similar)

**Why:** lugar de pesquisa aplicada onde vocês entram em território frontier produtizado. Risco bounded (read-only + human-in-loop).

**How to apply:** NÃO implementar antes Mês 4-5. Tabelas necessárias: `mia_user_tools` (synthesized, per-user), `mia_synthesis_audit_log`. Função sandbox no Supabase. Reasoning model ([[mia-reasoning-selective-use]]) pra gerar query (qualidade > velocidade).
