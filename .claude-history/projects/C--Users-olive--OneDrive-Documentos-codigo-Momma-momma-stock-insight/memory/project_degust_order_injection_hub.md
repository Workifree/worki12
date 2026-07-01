---
name: project-degust-order-injection-hub
description: "Para LANÇAR pedido no PDV Degust use a Hub Delivery API (outro host/token), NÃO a integration API que renovamos"
metadata: 
  node_type: memory
  type: project
  originSessionId: b9ec1dbc-07ab-4bfc-b65a-0800ad63beb0
---

A API Degust que o Gidape usa hoje (`lx-degust-api-integracao-prd.azurewebsites.net`, swagger V1 **e** V2) é **read/master-data only** — vendas, estoque, produtos, fichas, NF de entrada, contagens. **NÃO existe endpoint de criar pedido/venda/comanda/pré-venda no PDV** em nenhuma das versões. Auth = Bearer JWT de `/api/usuario/autenticar` (V1) / `/api/v2/usuario/autenticar` (V2), validade ~4h — é esse token que o script `degust-auth-refresh` + `_shared/degust-token.ts` renovam.

**Injeção de pedido no PDV Degust é OUTRA API: Linx Hub Delivery.**
- Host diferente: `degust.com.br/api/Delivery2/` (NÃO o azurewebsites)
- Criar pedido: `POST /api/delivery2/api/v1/Pedido/IncluirPedido`
- Token próprio: `/api/Delivery2/token` (token-based, TTL não confirmado)
- Endpoints de status: aceitar, produzir, separar, expedir, entregar, receber, cancelar
- Pré-requisito de config no Degust One: habilitar "hub 2.0", Parceiro + código de integração = ID da Loja, finalizadores/impressoras/comandas/SAT/cardápio configurados

**Implicação crítica para o projeto "gateway pro app do Thiago/Six":** o token que nosso script mantém fresco NÃO é o token que o lançamento de pedido precisa. São credenciais e hosts diferentes. Para oferecer o gateway resiliente ao parceiro precisamos das credenciais Hub Delivery da Momma (ID da Loja + senha p/ `/api/Delivery2/token`), o TTL desse token, e o schema do payload de `IncluirPedido` — tudo pendente de confirmação com a Linx. Decisões do CTO: gateway-proxy nosso (não encomenda no Gidape), escopo = só lançar pedido, loja fixa, single API key (só Thiago por agora). Relacionado: [[feedback_thorough_forensics]].
