---
name: Botão Exportar do Cofre fica em LivroCaixa.tsx, NÃO no FinanceReportsModal
description: Quando pedirem para mexer no "botão Exportar" do Cofre/Livro Caixa, editar LivroCaixa.tsx (botão direto na página), não FinanceReportsModal.tsx (relatórios analíticos)
type: feedback
---

Quando o usuário pede para alterar o "botão Exportar" do Cofre, ele se refere ao botão na **página LivroCaixa.tsx** (`src/features/financeiro/ui/LivroCaixa.tsx`), próximo aos botões "Relatórios" e "Transferência" — chama `handleExportExcel` que gera `caixa_fisico_*.xlsx`.

NÃO confundir com o botão "Exportar Excel" dentro do `FinanceReportsModal.tsx` (relatórios analíticos / aba Tabela), que gera `livro_caixa_*.xlsx` — esse é outro fluxo, dispara só após abrir o modal de Relatórios.

**Why:** Errei isso uma vez — adicionei o botão PDF dentro do FinanceReportsModal achando que era o relatório do Cofre, mas o usuário estava olhando o botão direto na página LivroCaixa. Ele ficou irritado: "ainda estamos vendo so xlsx, coloque la a opção kraio".

**How to apply:** Quando a tarefa mencionar "botão Exportar do Cofre" ou similar, sempre mexer primeiro em `LivroCaixa.tsx` (linha do dropdown DropdownMenu PDF/XLSX). Se for "Relatórios analíticos do Cofre", aí sim FinanceReportsModal.tsx. Em dúvida, perguntar "qual botão? o da página ou o do modal de Relatórios?".
