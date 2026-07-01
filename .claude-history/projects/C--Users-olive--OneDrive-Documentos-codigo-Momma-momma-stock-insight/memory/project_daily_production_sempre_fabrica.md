---
name: project_daily_production_sempre_fabrica
description: "daily_production tem loja_id sempre NULL — produção é centralizada na fábrica, não quebrar por loja"
metadata: 
  node_type: memory
  type: project
  originSessionId: 0707f543-5fd1-4738-b155-69ce37c90a79
---

A tabela `daily_production` tem `loja_id = NULL` em 100% dos registros (verificado em prod 2026-05-27: 4856/4856 nulos, 0 lojas distintas). O `DailyProductionForm` nunca grava loja — a produção da Momma é centralizada na fábrica (CTO confirmou: "sempre fábrica mesmo").

**Why:** qualquer feature que tente quebrar/agrupar produção por loja (relatório, dashboard, forecast, DRP) sai com uma única linha "Geral / Fábrica" = ruído. Relacionado a [[project_momma_business_validade]] (doces saudáveis, produção central + distribuição pras lojas).

**How to apply:** não oferecer "produção por loja" como dimensão de análise sobre `daily_production` enquanto `loja_id` não for populado na origem. Se precisar de produção por loja no futuro, é trabalho separado: alterar o formulário de lançamento + migration. No relatório PDF de produção diária a seção por loja foi removida por isso.
