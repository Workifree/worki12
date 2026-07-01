---
name: MIA — disciplina de listas e integridade de dados
description: Regras duras para MIA quando user pede lista/período — sem truncar silencioso, sem inventar valores, sem scope creep
type: feedback
originSessionId: e9190229-fe56-4ea5-b02e-2aea4c62832d
---
Quando o usuário pede uma LISTA ou PERÍODO à MIA, aplicar rigorosamente:

1. **Lista completa = lista completa.** Palavras-gatilho: "todas", "todos", "lista completa", "cada uma", "me passe tudo", "detalhada". Obrigam subir `limit` do tool pro máximo (ex: `mia_encomendas` → 1000) e trazer todas as linhas. Resumo + "top N" NÃO substitui a lista pedida.

2. **Truncamento silencioso é proibido.** Se a tool retornou exatamente `limit` registros, pode ter mais — declarar explicitamente "retornei as primeiras N de M, quer que eu puxe o resto?". Nunca escrever "lista é extensa, copie o resumo" como substituto.

3. **Respeitar filtro de período literalmente.** Se user pediu "março", conferir `data_entrega` dos resultados antes de responder. Se qualquer linha está fora do range, a tool foi chamada errado — refazer. `mia_encomendas` tem `start_date`+`end_date` desde abr/2026; usar SEMPRE para mês/semana, NUNCA iterar por dia via `date` único.

4. **Nunca inventar valores.** `valor_total` NULL → escrever literalmente "sem valor preenchido". NÃO converter em "R$ 0,00" como se fosse valor real, NÃO estimar, NÃO calcular média, NÃO propor "some manualmente parse do pedido_descricao".

5. **Scope discipline.** Responder SÓ o que foi perguntado. Se pediram encomendas, NÃO trazer transferências/NFs/comparações/sugestões não solicitadas.

6. **"Quantas X?" = contagem + tabela resumida (padrão legacy).** Quando o user pedir "quantas encomendas hoje?", "quantas perdas na semana?", "quantas requisições?" e afins, NUNCA responder só o número. Sempre chamar o tool de LISTA (ex: `mia_encomendas`, não `mia_encomendas_resumo`) e devolver "Hoje temos **N** \[item]:" seguido de tabela resumida com as colunas chave (cliente/tipo/hora/status/valor para encomendas; similar para outros). Tools `_resumo` só para análises agregadas cross-período longas ("total histórico", "evolução mensal"), nunca para o padrão diário. Confirmado pelo CTO em 2026-04-14: legacy fazia contagem + lista, e a regressão saiu respondendo só número seco.

**Why:** caso real em abril/2026: Pedro pediu "todas encomendas de retirada de março, lista detalhada" para calcular custo de transferência. MIA: (1) trouxe só 11 finalizadas dos dias 1/3/31 interpretando mal, (2) inventou "R$ 0,00" total, (3) quando user insistiu trouxe "top 20 recentes DESC" e puxou ABRIL em vez de março, (4) anexou análise de transferências/NFs sem pedido, (5) ofereceu "soma manual do pedido_descricao" como se fosse método real. Root cause técnico: RPC `mia_encomendas` não aceitava range (só `p_date` único) e `ORDER BY DESC LIMIT 20` — corrigido. Root cause comportamental: prompt não proibia truncar/inventar/escopar — corrigido nas seções `<data_integrity>`, `<list_contract>`, `<scope_discipline>`, `<tool_discipline>` do GENERAL_SYSTEM em `supabase/functions/mia/index.ts`.

**How to apply:** sempre que trabalhar no system prompt ou tools da MIA, preservar essas seções. Ao revisar resposta da MIA em produção, verificar: (a) período bate com pedido, (b) NULLs ficaram NULL, (c) listas completas quando pedidas, (d) nada fora do escopo. Se falhar, a correção é no prompt ou no tool description, não no LLM.
