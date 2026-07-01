---
name: Pipeline de análise científica de conversas WhatsApp para Noa
description: Pipeline reproduzível em docs/noaa/analise-flows-clientes que destila conversas reais do WhatsApp atendimento em padrões para context engineering da Noa AI
type: project
originSessionId: 86a9b845-c78c-4040-8f0f-b412588d1631
---
Pipeline em `docs/noaa/analise-flows-clientes/` puxa conversas via Evolution API (instance `cs-cst-evolution-api-b40bf447`, conta `556194605682`), classifica via Claude Haiku 4.5 (OpenRouter), clusteriza, extrai padrões e gera doc world-class.

**Why:** O atendimento WhatsApp Momma é feito por humano (mode='observer' em 99% das sessões — Noa só observa, não responde). Análise serve pra destilar o playbook humano em context engineering para Noa replicar — sem fine-tuning, alinhado a Anthropic. Não confundir com auditoria da Noa atual (ela não respondeu ainda).

**How to apply:**
- Para refresh do corpus: `python docs/noaa/analise-flows-clientes/scripts/02_analyze_corpus.py all --days 30 && python .../03_synthesize.py all`
- Para puxar histórico anterior à conexão WA atual: edge function `noaa-supervisor` action `evolution_bulk_sync_chain` aceita `cutoff_override_ts` (epoch sec) — passa `now - N*86400` para últimos N dias
- Action `evolution_owner_info` retorna ownerJid atual + registered (validar mesma conta antes de bulk-sync com cutoff expandido)
- Outputs em `raw/`: corpus.json, stats.json, classifications.jsonl (idempotente por chat_id), clusters.json, flow_patterns.jsonl
- Doc final: `README.md` + `flows/<intent>.md` (11 flows densos identificados)
- Prompt de classify trata `assistant`=ATENDENTE (humano), `user`=CLIENTE — NUNCA dizer "Noa errou X" baseado nesse corpus, pois Noa não respondeu
- Custo total ~$1-2 (Haiku 4.5 OpenRouter)
