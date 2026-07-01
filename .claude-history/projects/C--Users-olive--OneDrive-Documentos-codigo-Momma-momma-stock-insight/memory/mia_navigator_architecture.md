---
name: MIA como Navegadora do ERP
description: Definição arquitetural da MIA — Intent Routing through System Topology, não IA educacional
type: project
originSessionId: c0ce04a1-71cd-4d89-9060-bfb83777fea9
---
## Definição do usuário (maio/2026)

"Ela é uma navegadora — conecta a incerteza humana aos caminhos definidos do sistema."

Exemplo dado: "quero ver produtos" → MIA pergunta [estoque | catálogo | perdas] → "estoque" → [qual setor? qual loja?] → "câmara fria, fábrica" → entrega dado real.

## Framework correto: Intent Routing through System Topology

NOT: Khanmigo/ZDP (educacional — objetivo é o usuário aprender)
YES: Moveworks, Copilot, Dust.tt, Glean (enterprise AI — objetivo é resolver/agir)

**Why:** O usuário já é especialista no negócio. A MIA preenche o gap de navegação nos dados/sistema, não de conhecimento.

## Dois usos de ask_clarification
1. NAVEGAÇÃO: query vaga → chips da topologia do sistema (lojas, setores, status, tipos)
2. DISAMBIGUATION: busca retornou múltiplos matches → chips dos dados encontrados

## Topologia do sistema (implementada em cada agent)
- STOCK: lojas × setores × dimensões de consulta
- CATALOG: setores × gaps × status
- FINANCE: visões × status × tipos × formas de pagamento
- LOGISTICS: módulos × tipos × status

## Princípio GPS
A MIA conhece todos os caminhos. O usuário não sabe onde está. A MIA guia até o destino oferecendo bifurcações reais do sistema — não mais de 2 perguntas até chegar no dado.
