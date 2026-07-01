---
name: Sub-features são abas, não itens de menu duplicados
description: Quando feature vive como aba dentro de outra página, NÃO adicionar item de menu separado — só polui o sidebar
type: feedback
originSessionId: 3244567b-5f09-4631-b3aa-8f25baf0b353
---
Quando uma nova feature é uma **aba/view dentro de uma página existente** (ex: DRP dentro de Torre de Controle), **NUNCA adicionar item de menu lateral separado** apontando pra ela. Apenas o item da página pai deve aparecer no menu.

**Why:** num PR de DRP, adicionei `{ title: 'Plano de Reposição (DRP)', url: '/logistica/control-tower?view=drp' }` em paralelo ao item "Torre de Controle". Resultado: dois itens no sidebar apontando essencialmente pra mesma página. Usuário ("está feio errado") confirmou que a intenção sempre foi DRP ficar **só dentro** da Torre de Controle.

**How to apply:**
- Sub-features dentro de outra página = só aba/tab dentro dela; sidebar mantém só o item-pai
- Subtitle do item-pai mencionando a sub-feature também é poluição visual — não usar pra "anunciar" abas internas
- Discoverability vem das abas dentro da página, não do sidebar
- Se o usuário pedir explicitamente "adicione um atalho no menu", aí sim — mas só com pedido direto
