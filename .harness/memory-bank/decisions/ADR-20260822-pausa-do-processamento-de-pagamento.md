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
outra tem R$ 4.130 contra um razão de −R$ 670. Os dois únicos créditos são de R$ 0,00. Os saldos
foram gravados direto na coluna, fora das RPCs — o que contraria a premissa do Article 8 e nunca foi
detectado porque **nada, em lugar nenhum, reconciliava saldo com razão**.

Minha primeira leitura destes números foi que "nunca entrou dinheiro real". **Estava errada, e quem
corrigiu foi o owner:** entrou dinheiro real em algum momento — alguns reais de teste do Asaas — e
**já foi sacado**. O que sobrou na coluna não corresponde a valor devido a ninguém. Registro o erro
porque ele mostra o limite do método: o razão prova que o saldo não tem lastro, mas **não prova o que
aconteceu no mundo**. Para isso é preciso perguntar a quem estava lá.

De todo modo a conclusão prática se mantém: não há dinheiro de terceiro para devolver, e a pausa é
barata.

## Decisão

**Pausar, não apagar.** O código do Asaas e das carteiras permanece no repositório e as tabelas
permanecem no banco. Nenhum fluxo novo de dinheiro é oferecido ao usuário.

A superfície visível **já estava limpa antes desta decisão** (conferido): não existe rota `/wallet`,
nem `/company/financeiro`, nem componente de depósito ou saque. `/carteira` é a **Carteira de
Clientes** (lista de empresas — relacional, não dinheiro) e `/recebimentos` é o recibo do **modo A**.
Ou seja, do ponto de vista do usuário o produto já era só modo A; esta decisão torna isso oficial em
vez de circunstancial.

O que estava de pé e foi decidido pelo owner remover (feito — ver "Execução"): **sete Edge Functions
Asaas, à época ATIVAS**
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
2. ~~**Duas guardas da rotina de exclusão de conta passam a barrar por dado que não representa
   nada.**~~ ✅ **RESOLVIDO na execução** (`20260822000500`): saldos e escrows encerrados, as guardas
   continuam intactas e agora não barram ninguém. O texto original fica abaixo como registro do
   raciocínio.
   **Duas guardas da rotina de exclusão de conta passam a barrar por dado que não representa nada.**
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
- **Zerar os saldos como "faxina", com `UPDATE` solto.** Rejeitada — e o encerramento foi feito
  (ver "Execução"), mas do jeito oposto: operação **declarada**, em migration, com um lançamento em
  `wallet_transactions` por carteira carregando o valor exato e o motivo. A diferença não é
  cerimônia: é ela que preserva o saldo original no `amount` e torna a operação reversível.
- **Deixar tudo exatamente como está.** Rejeitada em parte: as sete funções ativas são superfície
  sem propósito de negócio. Não é urgente (a webhook falha fechado), mas é dívida declarada.

---

## Execução (22/08/2026) — o que foi feito, e o defeito que a execução revelou

**1. Sete Edge Functions Asaas REMOVIDAS de produção** (`asaas-webhook`, `-onboard`, `-deposit`,
`-checkout`, `-withdraw`, `-sync`, `-account-status`), via CLI. O código continua no repositório e
volta com um deploy se o processamento for retomado. Restaram só as sete de negócio (`jobs-api`,
`applications-api`, `profiles-api`, `admin-data`, `send-notification`, `delete-account`,
`expire-invites`) — nenhuma delas toca Asaas.

**2. Saldos e escrows residuais ENCERRADOS** (`20260822000500`), por operação declarada: cada
carteira recebeu um lançamento em `wallet_transactions` com o valor exato do movimento, o motivo, e
`reference_id` estável; os 4 escrows `reserved` foram para `refunded`. Verificado: soma dos saldos
= 0, escrow ativo = 0, e os quatro valores originais (4700,00 / 4130,00 / 3,02 / 1,02) conferidos um
a um contra o estado capturado antes. **Idempotente na prática** — a migration foi reaplicada e não
duplicou lançamento. É o que torna a operação reversível: o saldo original vive no `amount`.
Correção do que este ADR dizia antes: segundo o owner, **entrou dinheiro real** em algum momento
(alguns reais de teste do Asaas) e **já foi sacado**. O saldo encerrado não era devido a ninguém.

**3. 🐞 DEFEITO ENCONTRADO PELA REMOÇÃO — concluir turno estava atado ao escrow.**
`CompanyJobCandidates.handleConfirmDelivery` chama `WalletService.releaseOrCaptureEscrow` **antes**
de marcar o turno como `completed`, e **aborta** se ela devolver `success: false`. A função, sem
encontrar escrow, caía no default `'prepaid'` e chamava `asaas-checkout`. Com a função removida isso
viraria 404 — e, pior, **em modo A turno NUNCA tem escrow**, então o sintoma seria "Erro ao liberar
pagamento" numa operação que não envolve pagamento nenhum, com a empresa sem conseguir concluir
turno algum.

Consertado com uma guarda que é sobre o **estado**, não sobre a pausa: se não há escrow em
`reserved`/`authorized`, a função devolve `success: true` — *não havia nada a liberar* é resposta
correta, e tratá-la como erro era o defeito. Por ser sobre o estado, a guarda **continua válida se o
processamento voltar**: quem tiver escrow ativo segue pelo fluxo normal, sem flag para alguém lembrar
de virar. Três testes novos, **verificados por mutante** (desligar a guarda mata dois deles; o
terceiro, que exercita o caminho com `escrowKind` explícito, corretamente sobrevive).

**Vale registrar como a remoção virou achado.** A pausa não criou este bug — ela o tornou
inevitável em vez de intermitente. O `asaas-checkout` estava publicado, então o erro dependia do
estado do escrow e do humor da chamada. Remover a função transformou "às vezes falha" em "sempre
falha", que é o que fez a análise de alcançabilidade ser feita. **Desligar coisa morta é uma forma
barata de descobrir quem ainda dependia dela** — desde que se rastreie quem chamava antes de desligar.
