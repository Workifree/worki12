---
name: project_tv_flash_stale_per_store
description: "Painel TV mostrando R$ 0 / \"travado\" para uma loja = checar flash-vendas por-loja (PDV dessincronizado), não bug nosso; agora sinalizado via staleLive"
metadata: 
  node_type: memory
  type: project
  originSessionId: 3308dc36-4d5e-463b-a4e2-1ce3ef3da85b
---

RCA 2026-06-19 (Asa Norte R$ 0 no painel TV `/tv`): a API `degust-pos-financial`, a edge e o token Degust estavam **saudáveis** (edge 200 a cada 60s). Causa real: o endpoint `flash-vendas` do Degust é **por-caixa/por-loja** e pode **CONGELAR para UMA loja** (PDV dessincronizado) enquanto as outras atualizam — Asa Norte com `caixaAberto=true` mas `ultimaAtualizacao` parada às 02:25 (8h velha), `ticket-medio` e `movimentacao-produtos` do dia VAZIOS. O painel exibia fielmente o zero da fonte. **É falha operacional do PDV da loja (lado-loja/infra), não bug do GIDAPE.** Asa Norte tem histórico recorrente disso (buraco também em 17/06). O "travado" da BSB Shopping no mesmo dia foi lag transitório de virada de caixa do Degust (auto-resolveu em ~3 min).

**Antes de re-investigar "painel TV zerado/travado":** bata o `flash-vendas` cru (`GET /api/financeiro/flash-vendas?codigoFranqueador=3489`, token em `degust_auth.id=1`) e compare `ultimaAtualizacao` por loja — loja com timestamp horas atrás = PDV dessincronizado, ação é na LOJA.

**Fix de UX entregue (stg, sem push):** flag de defasagem por loja — `detectStaleLiveFlash` + `TV_FLASH_STALE_MINUTES=90` em `src/features/tv-dashboard/model/tvMath.ts`; campo `TvStoreData.staleLive`; card (`TvStoreColumn.tsx`) mostra "⚠️ sem sincronia desde HH:mm" (âmbar, sem pulso "ao vivo") + exceção âmbar por loja, em vez de fingir "R$ 0 ao vivo". Spec: `.harness/spec/tv-flash-stale-por-loja/`. Lição no harness: [[reference_supabase_logs_management_api]] e learnings/runtime.md L-R008 (`dataUpdatedAt` do React Query NÃO prova frescor por-entidade). Relacionado: [[project_degust_sync_congelamento_landmine]].
