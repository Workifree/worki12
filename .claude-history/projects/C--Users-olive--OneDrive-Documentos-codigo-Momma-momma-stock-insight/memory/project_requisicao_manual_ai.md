---
name: project_requisicao_manual_ai
description: Pipeline de IA da requisição MANUAL (parse + match + revisor) — separado da automática
metadata: 
  node_type: memory
  type: project
  originSessionId: cc92b44e-1160-462c-b81b-3866af03d817
---

Requisição **manual** (aba Requisições, texto livre) tem pipeline de IA próprio, **NÃO confundir** com a automática (`requisicao-automatica-ia` + `stockCalculator.ts`).

Pipeline manual:
1. **Parse**: edge function `process-requisition-ai` (OpenRouter). Devolve por item `name` (nome canônico/catálogo) + `source_text` (trecho **verbatim** que o operador digitou — adicionado em 2026-05-28 pra conferência de match). Streaming SSE (`?stream=1`); grok tem branch não-stream dedicado, demais modelos passam no branch genérico OpenAI-compat.
2. **Match**: no frontend (`Requisicao.page.tsx`), fuzzy `similarity()` threshold **0.72** + alias aprendido. `<0.72` cai no modal de revisão; `>=0.72` entra na lista (enriquecido).
3. **Aprendizado**: `useProductAliases` (tabela `produto_aliases`); `handleChangeMatch` chama `addAlias(termo→produto)` quando humano corrige — fica "cada vez mais direto" (alias = confiança 1.0 na próxima).
4. **Revisor (2ª opinião)**: edge function `review-requisition-matches` roda automático em background após o match; se pelo nome outro produto do catálogo combina melhor, anexa `reviewSuggestion` ao item (aviso não-bloqueante no card: [Usar sugestão]/[Manter]). Best-effort.

Cadeia de fallback dos DOIS (parse + revisor), modelos baratos OpenRouter (pagos, não `:free`), com `response_format: json_object`. Ordem (2026-05-28): `deepseek/deepseek-v4-flash` (PRIMÁRIO, $0.10/$0.20, verificado respondendo como primário) → `openai/gpt-4.1-mini` → `x-ai/grok-4.1-fast` → `google/gemini-2.5-flash` → `qwen/qwen3-32b`. Secret `OPENROUTER_API_KEY`. **grok-4.1-fast NÃO funciona como primário** nessa tarefa de JSON (falha/retorna vazio e cai pro fallback toda vez) — deixar como fallback. Revisor tem telemetria OTel (EdgeTracer/EdgeMetrics) e **revisa TODOS os matches, inclusive confiança 1.0** (alias envenenado / match exato espúrio também pode estar errado; é a rede de segurança pós-match). Eval versionado: `npm run eval:requisicao-ai` (`scripts/eval-requisicao-ai.mjs`, casos live contra as functions deployadas).

**Aprendizado de alias — regra crítica:** o termo aprendido em `handleChangeMatch` NUNCA pode ser o produto matcheado atual (`item.name`) — é o que se está corrigindo; aprender "produto-errado → produto-certo" ENVENENA o catálogo (bug real corrigido em 2026-05-28: aprendia "Bombom de Uva = Morango"). Aprende só `sourceText` (texto digitado) + `originalName` (nome interpretado pela IA, que é o que `findProductByAlias` recebe). `addAlias(id, termo, silent?)` tem flag silent.

UI da lista (`SortableItem.tsx`): mostra SEMPRE "Texto enviado" (verbatim) acima do "Produto matcheado", pra pegar match errado mesmo quando o sistema "achou que sabia". Ver [[feedback_only_active_products]] (match só contra produtos ativos) e [[feedback_no_codigo_barras]].

Deploy das edge functions: `supabase functions deploy <nome> --project-ref jaumyfyeueayibbxunxc` (CLI já autenticado na máquina do CTO; sem Docker — usa bundler via API).
