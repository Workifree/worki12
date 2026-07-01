---
name: project-compras-seletor-loja-local
description: "Compras (=Notas Fiscais, fábrica-only) tem seletor de loja LOCAL que não troca o StoreContext global"
metadata: 
  node_type: memory
  type: project
  originSessionId: cad2db00-546d-4b52-99e1-eac6fa16766e
---

Compras = feature **Notas Fiscais** (`src/features/notas-fiscais/ui/NotasFiscais.page.tsx`, página viva via `App.tsx`), agora **fábrica-only** no menu (`visibleFor:'fabrica'` em `menuItems.ts`). Como o setor de compras lança nota de cada loja separada sem poder trocar o contexto global (que fica Fábrica), foi adicionado um **seletor de loja LOCAL** à página (commit `e94ad8f7`, 2026-06-30, em stg):

- Estado `comprasLojaId: number | 'all'` persistido em `localStorage['compras:lojaId']` (com try/catch p/ WebView iOS/Safari privado). Default `'all'` na 1ª vez.
- Dirige **listagem** (`loadNotas` filtra por `effectiveLojaFilter`) **e lançamento** (loja default da Nova Nota OCR/Manual). **NUNCA chama `setSelectedStore`** — o contexto global permanece Fábrica. Não reintroduzir troca de contexto global pra lançar/ver nota aqui.
- `'Todas as lojas'` = visão consolidada (sem `.eq('loja_id')`); lançar em 'all' é bloqueado com toast (guard só no INSERT).
- Seletor visível só p/ `canSelectStoreNF()` (=`isAdmin() || profiles.can_select_store_nf`). **`isAdmin()` NÃO inclui `master`** → conta master sem a flag não vê o seletor. Sem permissão: usa `selectedStore?.id` global (comportamento antigo preservado).
- `effectiveLojaFilter = canSelectStoreNF() ? comprasLojaId : (selectedStore?.id ?? 'all')`. O primeiro fetch aguarda `usePermissions().loading` assentar (gate `if (permsLoading) return;` no effect de deps; o effect de mount `[]` redundante foi removido) — senão pisca notas da Fábrica.

**Landmine (corrigido):** no branch UPDATE de `saveNota`, quando o filtro é `'all'` o `lojaId` resolvia `undefined` e os writes `contas_pagar_receber` (`loja_id: lojaId || null`) / `credit_card_transactions` zeravam o vínculo de loja (RLS permite null → corrompe atribuição financeira). Fix: se `lojaId == null`, buscar `existingNota.loja_id` e preservar. Edições reais passam pelo `EditNotaModal` (que já preserva a loja da nota); o branch UPDATE de `saveNota` é praticamente dormente, mas correto se alcançado.

**Observação de segurança (pré-existente, não tratada):** `notas_fiscais` (SELECT `qual:true`, INSERT só checa `user_id`) e `contas_pagar_receber` (ALL authenticated) **não têm isolamento de loja no RLS** — isolamento multi-loja de financeiro é só client-side. Candidato a hardening separado. Ver [[project_role_operacoes_duplicada]].
