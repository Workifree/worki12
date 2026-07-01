---
name: Cofre entries via Contas modal
description: Cash register (cofre) entries are created from the "Nova Conta" modal in Contas & Faturas, NOT from LivroCaixa directly
type: feedback
---

Lançamentos no cofre (movimentacoes_financeiras) são feitos SOMENTE pelo modal "Lançar Nova Conta" na aba Contas & Faturas (Financeiro.tsx), selecionando tipo "Cofre".

O LivroCaixa é somente visualização + transferência entre lojas. Não deve ter botão "Nova Movimentação" nem formulário de entrada direta.

**Why:** O fluxo unificado garante que todas as contas (despesa, receita, investimento, cofre) passem pelo mesmo modal, mantendo consistência de UX e validações.

**How to apply:** Nunca adicionar formulários de criação de movimentação no LivroCaixa. Manter apenas: filtros, visualização, exportação, e botão de transferência (azul) entre lojas.
