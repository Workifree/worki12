# ADR-20260822 — Pausa do processamento de pagamento (Asaas abandonado por enquanto)

## Status

ACEITO (22/08/2026), por decisão do owner. **É pausa, não remoção** — a palavra usada foi "por
enquanto". Afeta os Articles 6 e 7 da constitution, que nomeiam o Asaas; ver "Efeito constitucional".

## Contexto

O owner comunicou: o Asaas foi abandonado, **não processamos mais pagamento por enquanto**, e a
funcionalidade de a empresa depositar a folha inteira no Worki para o Worki repassar aos freelas
está **pausada**.

Levantamento do estado real em produção no dia da decisão, para separar o que é mudança de rumo do
que é resíduo:

| Fato | Valor | Leitura |
|---|---|---|
| `payment_methods` (tokens de cartão) | **0** | Nunca houve cartão tokenizado |
| `wallets` com saldo ≠ 0 | 4 | R$ 8.834,04 somados |
| **Lastro desses saldos no razão** | **nenhum** | ver abaixo |
| `wallet_transactions` | 8 lançamentos | somam **−R$ 680,64** |
| Lançamentos de `credit` | 2 | ambos de **R$ 0,00** |
| `escrow_transactions` ativos | 4 | `reserved` |
| `wallets.asaas_customer_id` preenchidos | 3 | clientes criados no Asaas |
| `shift_payments` (modo A) | 4 `recorded` | **não usa Asaas** |

**Nenhum dos quatro saldos tem lastro no razão:** uma carteira tem R$ 4.700 e **zero** lançamentos;
outra tem R$ 4.130 contra um razão de −R$ 670. Os dois únicos créditos são de R$ 0,00. Conclusão de
fato: **nunca entrou dinheiro real**; os saldos foram gravados direto na coluna, fora das RPCs — o
que contraria a premissa do Article 8 e nunca foi detectado porque nada reconciliava as duas coisas.

Isso torna a pausa barata: não há dinheiro de terceiro para devolver.

## Decisão

**Pausar, não apagar.** O código do Asaas e das carteiras permanece no repositório e as tabelas
permanecem no banco. Nenhum fluxo novo de dinheiro é oferecido ao usuário.

A superfície visível **já estava limpa antes desta decisão** (conferido): não existe rota `/wallet`,
nem `/company/financeiro`, nem componente de depósito ou saque. `/carteira` é a **Carteira de
Clientes** (lista de empresas — relacional, não dinheiro) e `/recebimentos` é o recibo do **modo A**.
Ou seja, do ponto de vista do usuário o produto já era só modo A; esta decisão torna isso oficial em
vez de circunstancial.

O que continua de pé e é decisão de ops, não de produto: **sete Edge Functions Asaas ATIVAS**
(`asaas-webhook`, `-onboard`, `-deposit`, `-checkout`, `-withdraw`, `-sync`, `-account-status`).
A `asaas-webhook` roda com `verify_jwt: false` **por desenho** (o Asaas não manda JWT do Supabase),
mas **não é porta aberta**: exige o header `asaas-access-token` contra `ASAAS_WEBHOOK_TOKEN` e falha
FECHADO — sem env configurada devolve 500, token errado devolve 401. Mesmo assim, é superfície viva
de um gateway que não usamos.

## Efeito constitucional

- **Article 6 ("Asaas é o ÚNICO gateway")** — continua verdadeiro por vacuidade: não há gateway
  nenhum em uso. A proibição que ele realmente carrega (não reintroduzir Stripe ou outro provedor
  por conta própria) **segue valendo integralmente**.
- **Article 7 ("Carteira central, sem subcontas")** — descreve um mecanismo que está dormente.
  Nenhuma mudança: quando/se voltar, volta assim.
- **Article 8 ("Saldo só muda por RPC atômica")** — segue valendo, e ganha um caso concreto de
  violação histórica registrado acima. Se o processamento voltar, **os saldos atuais não podem ser
  tratados como saldo**: são resíduo de teste sem lastro.

Nenhum Article é revogado. Se a pausa virar abandono definitivo, aí sim é emenda constitucional
própria, com data e justificativa, como manda o histórico do arquivo.

## Consequências

1. **A pendência do token de cartão no Asaas (J5 do contrato de LGPD) DEIXA DE EXISTIR.** Ela
   supunha tokens retidos no processador; há **zero**. A pergunta técnica ao suporte do Asaas e a
   decisão de owner/jurídico que dependia dela saem da lista. Ver
   `ADR-20260822-token-de-cartao-permanece-no-asaas.md`, que fica **superado neste ponto**.
2. **Duas guardas da rotina de exclusão de conta passam a barrar por dado que não representa nada.**
   `anonymize_account` recusa exclusão com `wallet_has_balance` (4 carteiras) e `escrow_active`
   (4 escrows). Com pagamento pausado e saldo sem lastro, essas guardas deixam de proteger dinheiro
   e passam a **impedir o exercício do art. 18, VI** por causa de resíduo de teste. Precisa de
   decisão — está registrado como pendência, não resolvido aqui.
3. **O BI de gasto passa a ser 100% modo A.** A união "escrow (B/C) + marcador (A)" descrita em
   `architecture.md` fica sendo só o segundo termo.
4. **`asaas_customer_id` em `wallets`** continua sendo o ponteiro que o
   `ADR-20260822-token-de-cartao-permanece-no-asaas` mandou preservar. Com zero tokens, ele perde a
   função de remediação — mas **não custa nada** e o `COMMENT` da coluna explica a origem. Não mexer.

## Alternativas rejeitadas

- **Apagar tabelas e código de carteira/escrow agora.** Rejeitada: "por enquanto" é reversível, e
  apagar `wallet_transactions`/`escrow_transactions` destrói a trilha que o Article 9 protege — pelo
  mesmo argumento que já rejeitou trocar aqueles FKs por CASCADE (§0.1 do contrato de LGPD). Pausa
  não justifica destruição.
- **Zerar os saldos "para limpar".** Rejeitada por ora: é escrita de saldo, e escrita de saldo passa
  por RPC atômica (Article 8). Se for feito, é operação declarada, com razão, não faxina.
- **Deixar tudo exatamente como está.** Rejeitada em parte: as sete funções ativas são superfície
  sem propósito de negócio. Não é urgente (a webhook falha fechado), mas é dívida declarada.
