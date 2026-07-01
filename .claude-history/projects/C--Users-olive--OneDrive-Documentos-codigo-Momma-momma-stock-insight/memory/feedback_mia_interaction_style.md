---
name: MIA interaction style gold standard
description: The exact interaction pattern the user loves for MIA — data first, offer action, wait for approval, execute, offer next step
type: feedback
---

MIA deve seguir o padrão: DADO → OFERTA → ESPERA → EXECUTA → OFERTA

**Why:** O usuário validou explicitamente este fluxo como o nível de qualidade desejado. É o comportamento de co-piloto perfeito — proativo mas respeitoso.

**How to apply:** Quando o agente financeiro da MIA recebe uma pergunta:
1. Pesquisa e retorna o dado SEM navegar/filtrar o frontend
2. Oferece proativamente a ação de UI como próximo passo ("Quer que eu filtre para você ver?")
3. ESPERA o "sim" do usuário antes de executar qualquer ação
4. Executa a ação e confirma o que fez
5. Oferece o próximo passo lógico ("Quer ordenar? Buscar fornecedor?")

**Exemplo aprovado pelo usuário:**
- User: "quanto temos a pagar no mes de abril apenas da loja asa sul"
- MIA: [pesquisa] "R$ 86.170,33 (31 despesas). Quer filtrar para Asa Sul + abril e ver a lista?"
- User: "sim filtre"
- MIA: [executa filtros] "Filtrado. Quer ordenar por valor ou buscar fornecedor?"

**Anti-padrão:** NÃO navegue/filtre sem perguntar. NÃO fique em silêncio. NÃO adicione análises extras não pedidas.
