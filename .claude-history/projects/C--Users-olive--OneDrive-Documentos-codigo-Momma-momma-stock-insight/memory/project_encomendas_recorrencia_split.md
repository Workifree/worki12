---
name: project_encomendas_recorrencia_split
description: Recorrência de encomendas é split em 2 páginas; ambas usam projeção virtual (não materializar linhas)
metadata: 
  node_type: memory
  type: project
  originSessionId: 59b1b436-50e8-45a1-8a77-c88bfa1adc26
---

Recorrência de `encomendas` (tabela Supabase) vive em DUAS páginas com código separado:
- **PJ** (`tipo='pj'`) → `src/features/eventos/ui/EventosTimeline.tsx` (`expandRecurringItems`, já fazia projeção virtual).
- **delivery/retirada** → `src/features/encomendas/ui/Encomendas.page.tsx` (kanban). `EncomendaTipo = 'delivery' | 'retirada'` — NÃO inclui pj.

**Modelo correto = projeção virtual (NÃO materializar linhas).** A encomenda-mãe `recorrente=true` é só template; as ocorrências futuras (toda segunda etc.) são projetadas em memória pela regra (`recorrencia_tipo`/`recorrencia_dia_semana` em convenção JS `getDay()`: 0=Dom..6=Sáb, 1=segunda). Cards virtuais usam id `${id}_recurrence_${dateISO}` + `__isVirtual/__originalId/__recurrenceDate`. Exclusão de uma ocorrência = append em `recurrence_excluded_dates` (text[]). Materializar = inserir linha `recorrente=false`, `recorrencia_grupo_id`=id da mãe, e excluir a data.

**Bug histórico (corrigido 2026-05-25):** Encomendas.page materializava 12 linhas no `handleCreate` com `grupoId = crypto.randomUUID() ?? null`. No webview mobile `crypto.randomUUID` retornava undefined → grupoId null → inseria só 1 linha, série sem futuro. Por isso "marcadas como recorrente não apareciam no futuro". Trocado por projeção virtual (espelha Eventos).

Decisões: recorrentes **não reservam kit** (evita corromper estoque a cada projeção — ver [[project_estoque_lotes_reconcile_landmine]]); cards virtuais não são arrastáveis; janela do kanban = 30d passado + 60d futuro. Backfill de legados NÃO feito: recorrentes delivery/retirada legadas eram todas finalizadas (projeção herda status → ficam ocultas, sem fantasmas).

Busca da página Encomendas = busca global debounced direto no Supabase (ilike em cliente_nome/telefone/endereco/pedido_descricao), padrão visual de [[feedback_mobile_first]] espelhando EventosTimeline.
