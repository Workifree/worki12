---
name: project-requisicao-manual-streaming-landmine
description: "Por que a requisição manual IA dava \"tela vazia sem erro\" e amarrava no produto errado — landmines de streaming SSE e match"
metadata: 
  node_type: memory
  type: project
  originSessionId: dec447be-d0a9-4350-8379-40cb7187cd6c
---

**Tela vazia "sem erro" ao Processar** = a edge `process-requisition-ai` é **streaming**: retorna HTTP 200 em ~110ms (só os headers) e a falha real vai DENTRO do SSE (`sendEvent('error', …)` + `controller.close()`). Logo `function_edge_logs` mostra tudo 200 — a verdade está em `function_logs` (ver [[reference_supabase_logs_management_api]]). O frontend (`Requisicao.page.tsx`) **ignorava o evento `error`** e o fim-de-stream-sem-`result`: seguia pra validação com lista vazia e ainda dava `toast.success`. 

**Match amarrava no produto errado** porque o loop usava só `similarity(item.name, …)` ignorando `item.category` (o título da seção). "chocolate" sob "Bolos no Pote" ancorava em qualquer produto com "chocolate" → "Mini de Chocolate". Causa upstream: deepseek-v4-flash é **inconsistente** em JSON estruturado (logs de 28/05 mostram ~metade das chamadas caindo pro fallback gpt-4.1-mini), às vezes dropando o prefixo da categoria. `response_format` é `json_object` (garante JSON parseável, NÃO o formato semântico).

**Why:** streaming 200 + erro-no-stream engana quem olha só status; e match sem contexto de cabeçalho é frágil quando o LLM falha.

**ATUALIZAÇÃO 2026-06-15 — a "tela vazia" PERSISTIA por dois bugs além do `4cf8609f` (corrigidos em stg, pendente deploy):**
1. O catch de `processWithAI` fazia `setActiveTab('manual')` — mas **'manual' NÃO é um value de TabsContent** (as abas são method/select/input/processing/result) → área de conteúdo 100% em branco em QUALQUER erro lançado. Era o pior offender; corrigido p/ `setActiveTab('input')`.
2. Resultado válido com **0 itens** (modelo devolve JSON vazio ou nada bate no catálogo) não lançava erro → auto-redirect caía na aba `result` vazia ("Aguardando Processamento"). Guard novo após o SSE: `allProcessedItems.length===0` → throw → volta pro input com banner.

**Modelo (2026-06-15):** `x-ai/grok-4.1-fast` (fallback #3) era **slug MORTO** → 404 na OpenRouter (só existem grok-4.20 / grok-4.20-multi-agent / grok-4.3). `deepseek/deepseek-v4-flash` existe mas é flaky (curto-circuita o fallback ao "ter sucesso" com saída vazia — o loop só avança em ERRO, não em resultado-vazio). Cadeia nova nos DOIS edges: **`openai/gpt-4.1-mini` primário** → `google/gemini-2.5-flash` → `deepseek/deepseek-v4-flash` → `qwen/qwen3-32b` (sem grok). Decisão do CTO: barato + comprovadamente bom p/ JSON estrito. Validar slugs em `/api/v1/models` antes de assumir (ver [[project_openrouter_model_slugs_deprecate]]).

**Robustez SOTA adicionada no frontend:** watchdog de inatividade visibility-aware (`aiAbortRef`, aborta 60s sem evento SÓ com aba visível — não mata aba em 2º plano; substitui o timer absoluto que tinham removido), botão **Cancelar** no processing, banner de erro **persistente** (`processingError`, não some em 4s como toast), placeholder vazio agora com botão "Voltar para edição". Nenhum caminho de erro/vazio/hang/cancel cai mais em tela branca.

**Ao deployar as edges:** preservar o `verify_jwt` atual da function (landmine STG abaixo: publishable key ≠ JWT). Arquivos tocados: `src/features/requisicoes/ui/Requisicao.page.tsx`, `supabase/functions/process-requisition-ai/index.ts`, `supabase/functions/review-requisition-matches/index.ts`.

**How to apply (fix original):** stg commit `4cf8609f` — frontend trata `error`/no-result + timeout + sucesso condicional; `src/shared/lib/productMatch.ts` faz match ciente da categoria (nome cru vs "categoria+sabor", maior score; incerto→revisão manual); edge `repairItemName` reconstrói prefixo canônico; revisor recebe a seção. **Edge (Partes C/D) só vale em prod após `supabase functions deploy` no ref mommabot; frontend só após Vercel.** Landmine adjacente: `?v=${Date.now()}` no fetch torna cada POST uma URL única (polui logs/cache). Latente em STG: `.env.staging` usa `sb_publishable_…` (NÃO é JWT) com edge `verify_jwt=True` → 401 (prod usa anon JWT `eyJ…`, ok). Ver [[project_requisicao_manual_ai]].

**ATUALIZAÇÃO 2026-06-25 — o `4cf8609f` era incompleto: o auto-lock IGNORAVA a categoria.** `processWithAI` chamava `bestCatalogMatch` (que computa `categoryConsistent`) mas decidia travar só com `bestScore >= 0.72` — **nunca chamava `shouldAutoLock`**. Pior: `bestCatalogMatch` devolvia o maior score GLOBAL, então um sabor cru casava 1.0 com um produto homônimo de OUTRA classe e travava errado em silêncio. Caso real (CTO): `milho` sob seção "Caseirinhos" travava no INSUMO `Milho` (id 1440, ativo) em vez de `MINI CASEIRINHO MILHO` (id 1065, score 0.714). Fix em stg: `bestCatalogMatch` dual-track preferindo o melhor produto coerente com a seção ao vencedor global de classe errada; `shouldAutoLock` sem o bypass cego `score>=0.92`; frontend usa `shouldAutoLock` e manda match não-travável-mas-coerente pra revisão com a sugestão pré-selecionada. Regra: **auto-lock de requisição DEVE respeitar coerência de categoria — nunca travar nome cru de classe errada por score alto** (guard: regressões em `productMatch.test.ts`; learning `.harness/learnings/data.md` L-D011).

**Fatos canônicos do catálogo `produtos_master` (vêm do banco, não do código — úteis pro `CATEGORY_PREFIX_MAP` do parser):** Gelato/"cuba" → prefixo canônico **`Cuba`** (NÃO "Gelato"; não existe "GELATO X", são "CUBA X" — 31 produtos); Caseirinhos → **`Mini Caseirinho`** (não "Caseirinho"); "Copa do Mundo" não tem prefixo canônico (deixar em revisão); `Milho` é INSUMO ativo (id 1440) que sequestra match cru de "milho". O exemplo antigo do system prompt ("Gelato Frutas Vermelhas") estava ERRADO — o produto é `CUBA FRUTAS VERMELHAS`.
