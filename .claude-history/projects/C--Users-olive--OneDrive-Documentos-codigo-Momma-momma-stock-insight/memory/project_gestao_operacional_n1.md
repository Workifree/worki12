---
name: project-gestao-operacional-n1
description: "Camada N1 de dashboards gerenciais por setor — ADR aprovado 2026-06-05, event bus + motor de expectativas, implementação em 3 ondas"
metadata: 
  node_type: memory
  type: project
  originSessionId: 0c27516b-61c9-4047-8f1f-c55d0dc8d889
---

Decisão arquitetural (2026-06-05): nova camada **N1 — Gestão Operacional** por setor, entre operação (N0) e executivo (N2, futuro; `/tv` é embrião N2).

**Fontes de verdade no repo:** ADR em `.harness/memory-bank/decisions/ADR-20260605-gestao-operacional-n1.md` + spec em `.harness/spec/gestao-operacional/spec.md`.

**Decisões-chave (não reabrir):**
- 1ª onda: Logística, Produção, Estoque. Rotas `/gestao/<setor>` + categoria "Gestão" no sidebar. Permission `view_gestao_<setor>`, escopo por `default_store_id` (admin vê tudo).
- Event bus único `eventos_operacionais` (append-only, emissão por trigger Postgres, escrita só via `emitir_evento_operacional()` SECURITY DEFINER). `loja_id` = loja DONA do evento (expedição da fábrica → loja_id=1, destino no payload).
- Motor de "falta de acontecimento" genérico: `gestao_expectativas` (modos deadline/heartbeat/ocorrencia) + `avaliar_expectativas()` via pg_cron */5min; dedup por índice único parcial; auto-resolve.
- `gestao_alertas` com sino próprio (`GestaoAlertasBell`) — `notificacoes_master` do RH fica intocada. Torre de Controle e `/tv` preservados em paralelo.
- Ondas: 0 = fundação (migration única), 1 = `/gestao/logistica` referência, 2 = produção+estoque, 3+ = config UI/push/absorver Torre.

**Risco crítico:** trigger de `movimentacoes` precisa de WHEN excluindo marcas do reconciliador `sync_lote_auto` ([[project-estoque-lotes-reconcile-landmine]]) — validar com reconciliação real em stg antes da onda 1.

**IMPLEMENTADO 2026-06-05** (commit `4f526da8` em stg): Onda 0 (migration `20260605150000` aplicada no banco live + validada: ocorrencia/dedup/auto-resolve/engine 14ms) + Ondas 1-2 (feature `src/features/gestao/` completa, 3 painéis, sino, sidebar, rotas).

**LANDMINE (corrigido 2026-06-16, migration `20260616160000`):** o trigger `trg_emit_producao_lancada` (§8.4 da fundação, AFTER INSERT STATEMENT em `daily_production`) capturava o ator com `max(created_by)` — `created_by` é `uuid` e `max(uuid)` NÃO existe no Postgres, então TODO lançamento de produção novo abortava com "function max(uuid) does not exist" → "erro ao salvar produção" genérico no frontend. Ficou latente desde 06-05 porque a validação testou o motor de expectativas, não o INSERT real via `DailyProductionForm`. Fix: derivar `v_ator` com `SELECT created_by ... WHERE created_by IS NOT NULL LIMIT 1` (todas as linhas do statement compartilham o ator). Demais emit triggers usam `max(date)`/`max(timestamp)` (válidos) — só este tinha o bug. Ao escrever novos emit triggers statement-level que precisem do ator uuid, NUNCA usar `max(uuid)`. Helper RBAC novo = `user_has_rbac_permission(p_permission, p_user_id)` (o `user_has_permission` legado lê view com cast frágil — NÃO usar). Status reais de requisicoes: em_fila/em_progresso/finalizada (seed de viagem usa 'finalizada'). Crons: gestao-avaliar-expectativas (*/5min) + gestao-eventos-retencao (mensal 400d). Pendentes: atribuir permissions view_gestao_* aos roles (nenhum role tem ainda — só admin vê), UI de config de expectativas (onda 3), push/WhatsApp (v2), absorção da Torre (onda 3).
