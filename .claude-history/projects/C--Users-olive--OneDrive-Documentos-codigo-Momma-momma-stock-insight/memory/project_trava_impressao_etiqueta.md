---
name: project_trava_impressao_etiqueta
description: Trava pendente na impressão de etiqueta — puxar qtd-padrão do produto e avisar se fora do padrão (evitar erro de saco de 250)
metadata: 
  node_type: memory
  type: project
  originSessionId: 6fafa3ef-bd1c-40f8-b34d-48d5fb60c539
---

Pós-contagem da fábrica (2026-05-28): etiquetas de vulcão foram impressas com 250 por saco (erro de digitação no LabelPrinting). O bip de entrada lança exatamente o que está na etiqueta. Isso inflou o estoque (1250 en vez de 6).

**Trava pendente (CTO confirmou: implementar após fechar a contagem da fábrica):**
- Cadastrar `quantidade_padrao_embalagem` por produto (ou por tipo de embalagem) no `produtos_master` ou na tabela de embalagens.
- `LabelPrinting.tsx` puxar esse valor como default no campo `quantidade_interna` ao selecionar a embalagem.
- Avisar (warning, não bloquear) se o usuário digitar um valor muito diferente do padrão (ex: >2× ou <0.5×).

**Raiz do problema:** `LabelPrinting.tsx` deixa digitar qualquer número livremente; não há vínculo com o padrão do produto.

**How to apply:** implementar quando o CTO solicitar, pós-contagem da fábrica. Relaciona-se com [[project_lote_duplicacao_setnull_landmine]].
