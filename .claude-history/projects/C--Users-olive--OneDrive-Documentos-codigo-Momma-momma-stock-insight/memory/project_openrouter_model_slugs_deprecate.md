---
name: project-openrouter-model-slugs-deprecate
description: OpenRouter aposenta slugs de modelo sem aviso → HTTP 404 quebra edge functions de IA silenciosamente
metadata: 
  node_type: memory
  type: project
  originSessionId: 5e9748aa-679b-4d97-b519-f48e5d53d7fd
---

O OpenRouter **remove slugs de modelo sem aviso**. Em 2026-06 as famílias `google/gemini-2.0-*` e `google/gemini-flash-1.5*` saíram e passaram a retornar **HTTP 404 "No endpoints found"**. Isso quebrou **100% do OCR de NF** (`process-invoice-ocr`): todo modelo do chain dava 404 e a edge retornava 200 com `{error: "Nenhuma IA conseguiu ler"}`. O sintoma ("nenhuma IA leu a nota") foi confundido com qualidade de imagem, mas a causa era o slug morto — `gemini-2.5-flash` lê perfeitamente até as fotos antigas degradadas.

**Validar IDs sempre em** `https://openrouter.ai/api/v1/models` (público, sem auth). Modelos Gemini vivos hoje: `gemini-2.5-flash`, `gemini-2.5-flash-lite`, `gemini-2.5-pro`, `gemini-3-flash-preview`, `gemini-3.1-*`, `gemini-3.5-flash`.

**Edge functions que REFERENCIAM o slug morto `google/gemini-2.0-flash-001`** (só
`process-invoice-ocr` foi testado/corrigido; as demais NÃO foram verificadas nem
mexidas — são features distintas, sem relação funcional com OCR, só compartilham
a dependência do mesmo slug):
- `process-invoice-ocr` — ✅ CORRIGIDO E TESTADO (chain → 2.5-flash/pro/flash-lite, deploy v45, commit `b8169c0b`)
- `process-transfer-ocr` (`index.ts:127`) — referencia o slug; não testado
- `ai-reconciliation` (`llm.ts:5` + `index.ts`) — referencia o slug; não testado
- `requisicao-automatica-ia` (`telemetry.ts:386`, mapa de custo — verificar se há chamada real)
- `mia/ai.ts` (`gemini-2.0-flash-exp:free`) — MIA tem fallback grok/deepseek, provável OK

Nova arquitetura do OCR de NF (sem OOM no Android): a foto sobe pro bucket público `notas-fiscais` e a edge **baixa e faz o base64 no servidor** (aceita `imageUrl`); o cliente nunca monta base64 grande em memória. Captura em 3200px/0.95, recovery leve em localStorage. PDF segue por base64. Ver [[project-nf-ocr-image-pipeline]] se existir. Relaciona com [[feedback_thorough_forensics]].
