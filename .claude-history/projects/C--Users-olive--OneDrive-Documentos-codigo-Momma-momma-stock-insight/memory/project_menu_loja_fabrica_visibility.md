---
name: project-menu-loja-fabrica-visibility
description: Menu por tipo de loja — fábrica-only em sidebar+mobile+tablet; Movimentações virou aba em Produtos
metadata: 
  node_type: memory
  type: project
  originSessionId: 23eb1759-e312-4e2d-9243-210e3830dbd6
---

Menu lateral + MobileHome + TabletHome filtram por tipo de loja via `visibleFor: 'fabrica' | 'loja'` em `src/features/dashboard/ui/menuItems.ts` (gate `isFabricaStore = selectedStore?.tipo === 'Fabrica' || selectedStore?.id === 1`). Fábrica-only: grupos **Financeiro, Produção, DP/RH** e **Sistema exceto "Início"** (`/dashboard`) — ou seja Configurações/Painel TV/Admin/Usuários só aparecem na Fábrica. Grupo cujos itens estão todos ocultos para a loja atual NÃO renderiza o cabeçalho (`groupHasVisible` no AppSidebar; `visibleCategories` no mobile/tablet). É **visibilidade de navegação, não acesso** — RLS/permissões continuam gateando o destino.

**Movimentações** deixou de ser item de menu (grupo Inventário) e virou **aba dentro de `/produtos`** (`MovimentacoesContent` com prop `isEmbedded`, mesmo padrão de Scanner/Etiquetas embutidos no hub Produtos). `/movimentacoes` **redireciona** para `/produtos?tab=movimentacoes`. NÃO reintroduzir Movimentações como item de menu nem como página standalone no router — se "sumiu do menu", é por design. Commit stg `effc2264` (2026-06-19). Reforça [[feedback_no_duplicate_menu_entries]].
