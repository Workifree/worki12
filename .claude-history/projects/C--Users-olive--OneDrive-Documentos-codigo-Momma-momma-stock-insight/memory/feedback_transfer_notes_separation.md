---
name: Notas de transferência NUNCA misturar com NF
description: Momma Doces Saudáveis = transferência interna, jamais salvar como nota fiscal, financeiro, analytics ou gráficos
type: feedback
---

Notas de "Momma Doces Saudáveis" (itens em cx.) são NOTAS DE TRANSFERÊNCIA e NUNCA devem ser tratadas como notas fiscais.

**Why:** Notas de transferência são conferência interna entre lojas. Misturá-las com NFs corrompe dados financeiros, analytics e gráficos. O usuário foi enfático: "NAO PERMITA QUE NOTAS DE TRANSFERENCIA SEJAM COMPUTADAS COMO NOTAS FISCAIS".

**How to apply:**
- Tabela `notas_transferencia` é separada de `notas_fiscais`
- Função `isTransferNote()` em NotasFiscais.page.tsx detecta pelo fornecedor (Momma Doces)
- `saveNota()` tem guard que bloqueia salvar transferências como NF
- `saveAsTransferNote()` salva diretamente em `notas_transferencia` sem criar registros financeiros
- Dados de transferência nunca vão para `contas_pagar_receber`, `credit_card_transactions`, analytics ou gráficos
- Na UI: banner vermelho + botão "Salvar como Transferência" substitui "Salvar Nota"
