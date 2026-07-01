---
name: WhatsApp/Telegram Chatbot POC
description: POC de chatbot humanizado para vendas via mensagem — escopo, decisões técnicas e fluxo
type: project
---

## Chatbot de Vendas — POC via Telegram

**Objetivo:** IA humanizada que atende clientes, recebe pedidos e lança no sistema Momma (Encomendas).

### Decisões Confirmadas (2026-03-25)
- **Canal POC:** Telegram Bot (grátis). WhatsApp Business API depois de validar
- **Só texto** — sem áudio/Whisper por enquanto
- **Sem pagamento no bot** — sem Pix, sem Mercado Pago. Humano supervisor lida com cobrança
- **Sem Degust API** — não tem relação com PDV
- **Integração:** Pedido confirmado → lança em Encomendas no sistema Momma
- **Supervisão:** Atendente humano acompanha conversas e cuida de cobrança

### Fluxo
1. Cliente manda mensagem no Telegram
2. IA humanizada ("Nina") atende, conversa, apresenta cardápio
3. Cliente escolhe, customiza, confirma pedido
4. IA lança pedido na página Encomendas do sistema Momma (data, itens, cliente, loja/entrega)
5. Fábrica pega do sistema, produz
6. Delivery ou retirada na loja

**Why:** Validar conversão e experiência antes de investir em WhatsApp Business API pago.
**How to apply:** Manter escopo mínimo — texto, Telegram, sem pagamento, sem áudio. Foco em qualidade da conversa e integração com Encomendas.
