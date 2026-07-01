---
name: Não usar codigo_barras em fluxos novos
description: Momma não usa código de barras em produtos — ignorar o campo em criação, edição e busca. Coluna pode até ser removida da tabela
type: feedback
originSessionId: 9f339aa2-0d65-4dd9-bea9-c7ace405d230
---
Nunca incluir `codigo_barras` em tools, formulários ou RPCs novas.

**Why:** Usuário (CTO) confirmou em 2026-04-14 que Momma não usa código de barras. A coluna existe em `produtos_master.codigo_barras` mas está quase toda NULL e pode inclusive ser removida da tabela.

**How to apply:**
- Ao criar/editar produtos em `produtos_master`, não pedir nem tratar `codigo_barras`
- Identificador interno do produto = `codigo_interno` (auto-sequence) + `nome`
- Se o usuário pedir "SKU", ele está falando de `codigo_interno` (número) ou do próprio `nome`
- Em MIA, ao pedir configs de produto, não incluir código de barras na pergunta
