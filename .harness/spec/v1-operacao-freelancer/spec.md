# Operação de Freelancer (v1, piloto) — spec

> Spec do piloto. Implementa a **Aposta 1** da `.harness/thesis.md`: centralizar a operação de freelancer
> da empresa pelo Worki. Tipo: feature (L). Papel: ambos (empresa + worker), com a empresa como wedge.
> Posicionamento: Worki é **conector/registro**, não empregador — a empresa cria vaga, chama e contrata.
> Sem gate jurídico para o MVP.

## Context

A MOMMA gasta ~25k/mês com freelancers. Hoje **contrata por boca-a-boca / WhatsApp** e depois **lança
o dinheiro à mão** numa ferramenta interna (só cadastro + registro financeiro — não contrata). Há trabalho
em dobro: hire informal → digitação manual.

O Worki v1 traz **o ato de contratar pra dentro da plataforma**, e com isso o controle, o BI, o pagamento e
o recibo **se geram sozinhos** — somem o lançamento manual e a informalidade. Sobre isso, oferece o que a
ferramenta interna não tem: trilho de pagamento (escrow, já construído), cartão/parcela e formalização
fiscal/trabalhista.

O wedge é **valor pra empresa** (cavalo de Troia). A reputação do freela acumula embaixo (carga/moat). O
freela é forçado pela empresa a criar conta e usar — e ganha valor mínimo real desde o dia 1.

> Reaproveita ~80% do que existe: `walletService` (reserve/release/refund/credit — RPCs atômicas),
> funções `asaas-*`, escrow, `RateModal`, notificações Realtime, `JobLifecycleStepper`. Build novo =
> roster/conexões, fluxo convite→aceite, camada financeira (teto/alertas/BI), entrega multicanal.

## Escopo em duas camadas

- **Camada 1 — o loop (gera o dado):** popular equipe → criar turno → convidar → aceite/recusa → trabalho →
  conclusão → pagamento (escrow) → avaliação bidirecional. SEM isso não há produto nem dado.
- **Camada 2 — inteligência financeira (o valor que a empresa vê):** teto de gasto + alertas, BI de
  gasto/horas, ratio de custo equilibrado, custo de no-show, flag de concentração→vínculo. Roda **em cima**
  do dado da Camada 1; nasce vazia e compõe com o tempo (exceção: migrar histórico da MOMMA → nasce cheia).

## Personas

| Persona | Faz | Vê |
|---|---|---|
| **Operador** (empresa) | cria turno, convida, confirma conclusão | equipe, escala (lista), status dos convites |
| **Contato financeiro** (empresa) | define teto, recebe alertas | BI de gasto/horas, ratio, alertas (WhatsApp + app) |
| **Freela** (worker) | aceita/recusa convite, trabalha, é avaliado | convites, "meu trabalho" (histórico/ganhos), briefing |

> v1: um admin da empresa pode acumular operador + financeiro. O alerta roteia para um "contato financeiro"
> designado (telefone/WhatsApp configurável).

## Requirements

### Camada 1 — loop
- [ ] **R1 — Conexões (minha equipe).** Empresa popula a equipe por 3 caminhos, todos **com aceite do freela**
  (handshake bilateral) e todos **fechados** (exige conhecer quem): (a) **QR scan** do perfil do freela;
  (b) **link de convite** (estilo grupo de WhatsApp); (c) **por telefone** (SMS → freela completa cadastro).
  Nenhuma busca/navegação de estranhos. "Minha equipe" é a lista derivada das conexões aceitas.
  - [x] _Camada de dados:_ tabela `team_connections` (status pending/accepted/blocked, source qr/link/phone,
    UNIQUE (company_id, worker_id)) + RLS por papel — `20260622000000_team_connections.sql`.
  - [x] _Service-layer (Slice 1):_ `TeamConnectionService.addToTeam(workerId, source)` (QR/link/phone, idempotente),
    `generateInviteToken`/`resolveInviteToken` (canal link), `listTeamMembers()` (empresa), `listAllConnections()`,
    `listMyStores()` (worker), `listPendingConnections()` (worker), `isWorkerInTeam()` (guard de convite de turno).
    Hooks: `useCompanyTeam`, `useWorkerStores`.
- [ ] **R2 — Handshake uma vez.** Aceitar a conexão acontece **uma vez**. Convites de turno seguintes daquela
  empresa **não** re-pedem handshake — o freela só aceita/recusa o turno. O freela pode **sair da equipe /
  bloquear** uma loja.
  - [x] _Camada de dados:_ estado `accepted` persistente em `team_connections` (handshake 1x); worker pode
    mover para `blocked` (sair/bloquear) via RLS de UPDATE do worker.
  - [x] _Service-layer (Slice 1):_ `TeamConnectionService.acceptConnection(id)` (pending→accepted, máquina de estados
    validada no service — ADR-001), `blockConnection(id)` (→blocked, idempotente). Hooks: `useWorkerStores`.
- [ ] **R3 — Criar turno.** Operador cria turno com: data, hora início-fim, função, **modelo de pagamento =
  FIXO por turno (v1)**, valor, local, **briefing** (texto/regras/cardápio). 
> ⚠️ **REVISADO por ADR-20260630-pagamento-opcional-piloto (2026-06-30).** R4/R7/R9 abaixo descrevem o
> postpago **obrigatório**; o owner tornou o pagamento pelo Worki **OPCIONAL** no piloto. Default do piloto =
> **pagamento externo registrado** (Worki registra que houve PIX/dinheiro fora + recibo, sem mover saldo).
> Postpago (cartão on-file, R4/R7/R9) vira **opt-in / evolução da expansão**; PIX-único→distribuição é
> conveniência opt-in. O texto histórico abaixo fica preservado como o caminho opt-in C. Ver o ADR.

- [ ] **R4 — Pagamento postpago (modelo Uber, sem valor antecipado).** _[opt-in — ver ADR-20260630]_ Sem depósito prévio. A empresa
  cadastra **um método uma vez** (cartão on-file ou PIX). Cria o turno e convida — nada mais. Na **conclusão**,
  o Worki cobra o método da empresa e paga o freela. Onde o Asaas suportar, fazer **pré-autorização (hold) no
  aceite + captura na conclusão** (como o Uber) — garante o freela sem depósito. Worki **não adianta dinheiro**
  (não é crédito). No piloto embedded/confiável, mesmo sem hold o calote é ~inexistente.
  - [x] _Camada de dados (Slice 2):_ tabela `payment_methods` (cartão on-file: token Asaas opaco +
    brand/last4/holder_name, `is_default` único por empresa, UNIQUE (company_id, token)) + RLS por dono +
    REVOKE anon/GRANT service_role — `20260622000600_payment_methods.sql`. Escrow estendido com estados
    postpago (`authorized`/`captured`, `kind`, `asaas_payment_id`) — `20260622000700_escrow_postpago_states.sql`.
    RPC atômica idempotente `authorize_escrow_postpago` (grava o hold, sem saldo) + GRANT EXECUTE —
    `20260622000800_postpago_escrow_rpcs.sql`. Tipos `PaymentMethod`/`EscrowKind`/`EscrowStatus` à mão
    (`types/index.ts`). Edge Functions `asaas-tokenize-card`/`asaas-authorize-payment` = builder (contrato no ADR).
    Architect + ADR: `.harness/memory-bank/decisions/ADR-20260622-pagamento-postpago.md`.
- [ ] **R5 — Convidar (3 portas, 1 primitiva).** Convite-pra-turno é UMA primitiva com 3 entradas: convidar da
  equipe; "recorrente" = convidar de novo (v1 manual, sem motor de recorrência); QR-na-hora = mesmo convite
  com identidade vinda do scan.
  - [x] _Service-layer (Slice 1):_ `ShiftInviteService.inviteWorkerToShift(jobId, workerId, opts)`: valida que
    o worker é conexão accepted, insere em `applications` com status='invited' + campos de convite, cria
    notificação in-app e invoca `send-notification` (e-mail). Idempotente (retorna `alreadyInvited` se já existe).
    Hook: `useCompanyInvites(jobId)`.
- [ ] **R6 — Entrega multicanal.** O convite chega ao freela por **app (notificação) + e-mail + WhatsApp**.
  Conteúdo: empresa, turno, valor, briefing, e ação aceitar/recusar que cai na tela do Worki.
  - [x] _Service-layer (Slice 1, parcial):_ app + e-mail entregues por `inviteWorkerToShift`. WhatsApp = Slice 4.
- [ ] **R7 — Aceite/recusa.** Freela aceita ou recusa. **Aceite → escrow RESERVA** (RPC atômica) + turno
  confirmado nas duas agendas + no-show passa a contar. **Recusa → slot reabre, NEUTRO (zero punição).**
  > _[REVISADO por ADR-20260630]_ A **reserva/hold no aceite deixa de ser obrigatória**. O aceite confirma a
  > relação e a agenda; hold só no modo postpago opt-in (C). Recusa segue neutra.
  - [x] _Camada de dados (parcial):_ status `invited`/`declined` + colunas de resposta em `applications`
    (`invitation_response`, `invitation_responded_at`) — `20260622000100_invite_columns_applications.sql`.
    A reserva de escrow no aceite é **Slice 2** (postpago); aqui o aceite só muda status.
  - [x] _Service-layer (Slice 1):_ `ShiftInviteService.respondToInvite(applicationId, 'accepted'|'declined')`:
    máquina de estados validada no service (invited→hired ou →declined), verifica expiração (R8), recusa NEUTRA
    (zero punição), notificação in-app para empresa no aceite. Hook: `useWorkerInvites`.
- [ ] **R8 — Expiração.** Convite expira após janela configurável → slot reabre; operador vê "não respondeu".
  - [x] _Camada de dados:_ coluna `applications.invitation_expires_at` + índice parcial de convites.
  - [x] _Service-layer (Slice 1):_ `respondToInvite` verifica `invitation_expires_at` e rejeita com mensagem clara
    se expirado. `inviteWorkerToShift` aceita `expiresInHours` (default 48h). Limpeza de convites expirados = cron/Slice 2.
- [ ] **R9 — Conclusão → cobrança + pagamento.** Operador confirma conclusão → Worki **captura o cartão
  on-file (ou cobra o PIX) da empresa** e **paga o freela** (RPCs atômicas no ledger, idempotentes).
  **Auto-processamento** após janela de carência pós-conclusão protege o freela de inação da empresa.
  > _[REVISADO por ADR-20260630]_ A cobrança na conclusão **deixa de ser obrigatória**. Conclusão confirma o
  > turno e habilita o **registro de pagamento** (modo A externo, sem mover saldo) OU a captura/distribuição
  > (modos C/B opt-in). Auto-processamento de captura só se aplica ao modo postpago (C).
  - [x] _Camada de dados (Slice 2):_ RPC atômica idempotente `capture_escrow_postpago` (captura o hold:
    `authorized`→`released` + credita o worker via reuso de `escrow_release`, idempotência `(wallet_id,
    reference_id=job_id)`) e `release_hold_postpago` (cancel/no-show antes da captura: `authorized`→`refunded`,
    sem saldo, devolve `asaas_payment_id`) + GRANT EXECUTE — `20260622000800_postpago_escrow_rpcs.sql`.
    Trigger `auto_reserve_escrow_on_hire` confirmado SÓ pulando no aceite de convite (pagamento fora de
    trigger) — `20260622000900_postpago_no_escrow_in_trigger.sql`. Edge Functions `asaas-capture-payment`/
    `asaas-release-hold` + auto-processamento (cron de carência) = builder (contrato no ADR).
- [ ] **R10 — Avaliação bidirecional.** Após conclusão, empresa avalia freela e freela avalia empresa (forma
  mais simples: compareceu? + nota 1-5). Acumula calado (valor é Fase 2, coleta começa no dia 1).
  - [x] _Camada de dados:_ coluna `reviews.direction` (worker/company, auto-preenchida) + trigger
    `update_company_rating_on_review` (espelho do de worker) + backfill —
    `20260622000200_company_rating_trigger.sql`. Falta corrigir o `reviewed_id` no `MyJobs.tsx` (UI/builder).
  - [x] _Tipos (Slice 1):_ `ReviewDirection`, `Review.direction` (explícito), `Review.reviewed_id` (TEXT — cast correto).
    O builder DEVE passar `direction` explicitamente ao inserir review (ADR-001). Correção do insert em `MyJobs.tsx` = frontend-builder.
- [ ] **R11 — "Meu trabalho" (freela).** Freela vê próximos turnos, histórico (o registro que é dele) e ganhos.

### Camada 2 — inteligência financeira
- [ ] **R12 — Teto de gasto + alertas.** Contato financeiro define teto (por mês, por loja). Alertas em
  **80% / 90% / 100% / acima**, entregues por **WhatsApp + app**. **Alerta, nunca bloqueio** (bloquear deixa
  turno descoberto).
  - [x] _Camada de dados (Slice 3):_ tabela `company_spend_limits` (period='month', amount, alert_thresholds
    default {80,90,100}, scope=rótulo de loja NÃO-FK nullable, financial_contact_email/phone) + RLS por dono +
    REVOKE anon/GRANT service_role — `20260623000000_company_spend_limits.sql`. Alertas REUSAM `notifications`
    (sem tabela nova). Idempotência de threshold por convenção de `link` (contrato no rodapé). Gasto acumulado
    = derivado de escrow (não materializado). Avaliação/insert da notification = service/edge (builder).
- [ ] **R13 — BI de gasto/horas.** Gasto e horas por freela / loja / período, com tendência.
  - [x] _Camada de dados (Slice 3):_ SEM tabela/view nova — gasto/horas são QUERIES derivadas de
    `escrow_transactions` + `jobs` + `applications` (contrato BI-1/BI-2 no rodapé). Decisão: views REJEITADAS
    (RLS não propaga seguro por view; mantém padrão service Art. 5). Builder = `FinancialBIService`.
- [ ] **R14 — Ratio equilibrado.** Custo-por-hora de cobertura (dado interno). **Custo como % do faturamento**
  quando a empresa digita 1 número/mês (faturamento) — unlock barato da métrica de ouro do food service.
  - [x] _Camada de dados (Slice 3):_ tabela `company_monthly_revenue` (year_month DATE ancorada no dia 1,
    amount, UNIQUE (company_id, year_month)) + RLS por dono + REVOKE anon/GRANT service_role —
    `20260623000100_company_monthly_revenue.sql`. Custo-por-hora e custo-%-faturamento = derivados (contrato
    BI-3 no rodapé). Tipos `CompanySpendLimit`/`CompanyMonthlyRevenue` à mão (`types/index.ts`) = builder.
- [ ] **R15 — Custo de no-show.** Quantificar "pagou R$X / Y faltas" no período.
  - [x] _Camada de dados (Slice 3):_ SEM tabela nova — derivado de `applications` (contrato BI-4 no rodapé).
    GAP sinalizado: não há coluna explícita `no_show`; a heurística v1 usa expiração + aceite-sem-checkout.
    Se o piloto exigir precisão, builder/architect adicionam marcador de no-show (migration menor).
- [ ] **R16 — Flag de concentração → risco de vínculo.** Sinalizar freela com horas/dias concentrados
  ("freela X: 180h em 26 dias — parece emprego"). Une valor financeiro + alarme jurídico precoce.
  - [x] _Camada de dados (Slice 3):_ SEM tabela nova — derivado de `jobs`+`applications` por freela
    (contrato BI-5 no rodapé). Limiar (h/dias) é config de produto no service, não no banco.
- [ ] **R17 — (concierge) Importar histórico da MOMMA** da ferramenta interna → BI nasce cheio no dia 1.

## Workflow canônico (máquina de estados) — decisões A–G resolvidas

> ⚠️ **REVISADO por ADR-20260630 (2026-06-30):** o passo [0.5] (cadastrar método) e a cobrança nos passos
> [2]/[5] passam a ser **opcionais** (postpago = opt-in C). No default do piloto o ciclo avança por
> confirmação da relação (aceite → check-in/checkout → conclusão → avaliação) e o **pagamento é um passo
> paralelo**: registrar pagamento externo (modo A, sem saldo) OU pagar via Worki (B/C). Diagrama abaixo
> descreve o caminho postpago histórico.

```
[0] Popular equipe ── QR scan │ link │ telefone ──► conexão ACEITA (handshake 1x) ──► freela na equipe
        │
[0.5] Empresa cadastra método 1x (cartão on-file ou PIX) — pré-requisito, sem depósito
        │
[1] Operador cria turno  (◆A: pagamento = FIXO por turno na v1; "por hora" é v1.5, exige check-in/out)
        │                (◆C: SEM valor antecipado — basta o método cadastrado; cobra no fim)
        ▼
[2] Convite dispara ──► app + e-mail + WhatsApp   (◆B: pré-auth/hold no ACEITE onde o Asaas suportar)
        │                                          (◆D: convite expira → slot reabre)
        ▼
[3] Freela ACEITA ───────────────► ou RECUSA
     │ hold (se houver) + confirmado │ slot reabre — NEUTRO
     │ nas 2 agendas                (◆E: recusar = 0 punição; faltar DEPOIS de aceitar = penaliza)
     ▼
[4] Turno acontece ── (◆G: piloto = confirmação manual do operador; QR check-in/out = v1.5)
        ▼
[5] Operador confirma conclusão ──► captura cartão / cobra PIX da empresa ──► paga freela ──► avaliação
        (◆F: se operador não confirma, AUTO-PROCESSA após carência — protege o freela)
```

## Acceptance criteria

- [ ] **A1.** DADO uma empresa, QUANDO ela escaneia o QR / envia link / digita o telefone de um freela E o
  freela aceita, ENTÃO o freela aparece em "minha equipe" e a empresa em "minhas lojas" do freela.
- [ ] **A2.** DADO um freela já na equipe, QUANDO a empresa o convida para um novo turno, ENTÃO o freela
  recebe direto o convite do turno (sem novo handshake) por app + e-mail + WhatsApp.
- [ ] **A3.** DADO uma empresa com método de pagamento cadastrado, QUANDO ela cria o turno e convida, ENTÃO
  nenhum depósito é exigido; na conclusão o método é cobrado e o freela é pago. (Onde houver pré-auth, o
  freela só vê convite com hold válido.)
- [ ] **A4.** DADO um convite aceito, QUANDO o aceite ocorre, ENTÃO o escrow reserva atomicamente (RPC) e o
  turno aparece confirmado para os dois lados; QUANDO recusado, o slot reabre e a reputação do freela **não**
  muda.
- [ ] **A5.** DADO um turno concluído, QUANDO o operador confirma (ou expira a carência), ENTÃO o escrow
  libera ao freela atomicamente e ambos são convidados a avaliar.
- [ ] **A6.** DADO um teto definido, QUANDO o gasto acumulado cruza 80/90/100%, ENTÃO o contato financeiro
  recebe alerta por WhatsApp e no app — sem bloquear novas contratações.
- [ ] **A7.** DADO turnos transacionados, QUANDO o financeiro abre o BI, ENTÃO vê gasto e horas por
  freela/loja/período, custo de no-show, e (se faturamento informado) custo como % do faturamento.
- [ ] **A8.** DADO um freela com horas concentradas, QUANDO o limiar é cruzado, ENTÃO o sistema sinaliza o
  risco de vínculo daquele freela.
- [ ] **A9 (gate técnico).** `cd frontend && npm run build` e `npm run lint` verdes. Toda mudança de saldo
  via RPC atômica com idempotência `(wallet_id, reference_id)`. Edge functions com CORS preflight. Sem
  `service_role` no frontend. Sem Stripe.

## Out-of-scope (Musk — cortes explícitos)

| Item | Quando | Por quê |
|---|---|---|
| Grade visual drag-drop de escala | **v1.1** | piloto usa **lista**; não muda a hipótese central; candidato #1 a voltar |
| Pagamento **por hora** | **v1.5** | exige check-in/out; FIXO por turno prova o loop sem disputa de minutos |
| QR check-in/checkout | **v1.5** | piloto = confirmação manual; todos se conhecem |
| **Parcelamento** no cartão | **v1.5** | semente de receita; banco da empresa floata (Asaas), **não é empréstimo**. (Cartão on-file p/ cobrança simples na conclusão é **v1** — R4) |
| @-diretório / busca de estranhos / feed marketplace | **Fase 2** | é o marketplace; precisa de densidade de reputação |
| Crédito / "rolar dívida" / antecipação / folha | **Fase 3** | regulado, exige capital — Worki vira credor |
| Benchmark de preço, forecast | **v2** | precisa densidade de dados |
| Gamificação arcade | — | reaproveitar como "standing profissional", não construir novo |
| Geofence anti-fraude de check-in | **v2** | confiança basta no piloto fechado |

## Riscos & mitigações (técnicos)

| Risco | Prob | Impacto | Mitigação |
|---|---|---|---|
| RPC de saldo sem GRANT / idempotência → crédito duplo | B | A | `GRANT EXECUTE` a service_role+authenticated; UNIQUE `(wallet_id, reference_id)`; reference_id estável por turno; architect revisa |
| Auto-liberação libera indevidamente | B | A | janela de carência + estado de disputa simples; logar tudo |
| Convite multicanal duplica notificação/ação | M | M | idempotência por convite; a ação resolve no app (canal único de verdade) |
| Entrega WhatsApp (provedor/custo/opt-in) | M | M | confirmar provedor e consentimento; app+e-mail como fallback |
| RLS quebra isolamento empresa/worker | M | A | testar como empresa E worker; espelhar RLS no `ProtectedRoute` |
| **Vínculo trabalhista** (já é risco da empresa, não do Worki) | B | M | Worki = conector/registro, nunca empregador; **não bloqueia o MVP**, revisitar só ao escalar; R16 é hedge opcional |

## Gates antes de construir

1. **Pagamento/escrow** — `harness-architect` revisa qualquer migration/RPC nova de saldo (constitution Art. 8).
2. **Provedor WhatsApp** — definir canal de entrada e custo/opt-in (R6, R12).

> Vínculo trabalhista **não é gate.** Worki é conector/registro; a empresa é a contratante. O risco já existe
> na operação atual (WhatsApp+PIX) e não bloqueia o MVP — revisitar só ao escalar.

## Clarifications log (da discussão de pivô)

- Forma do produto = **relationship-first**, não feed-first (a).
- Empresas do piloto **não compartilham freelas** → piloto prova o loop, **não** a portabilidade da reputação
  (planejar #2/#3 com overlap).
- **Take 0** nos primeiros 90 dias aceito.
- "Estilo Instagram (@buscar)" = **destino** (Fase 2), não o piloto. Piloto = lista fechada.
- Handshake **uma vez**; convites de turno seguintes só aceita/recusa o turno.
- Ferramenta interna da MOMMA = cadastro + lançamento, **não** contratação → wedge = trazer a contratação
  pra dentro e gerar dado/pagamento/recibo sozinho.
- "Stripe" mencionado coloquialmente → gateway é **Asaas** (Art. 6). Reabrir = ADR.
- Tese confirmada pelo owner em 2026-06: empresa-primeiro como **entrada**, destino marketplace +
  financeirização.
- **Gate trabalhista REMOVIDO** (decisão do owner, 2026-06): Worki é conector/registro, não empregador; o
  risco é da empresa e já existe na operação atual. Não bloqueia o MVP. R16 fica como feature/hedge opcional.
- **Pagamento POSTPAGO (modelo Uber)** decidido pelo owner (2026-06): sem valor antecipado/depósito. Cartão
  on-file cobrado na conclusão, ou PIX. Justificativa: operação embedded em empresas confiáveis → fricção é o
  inimigo, não o calote. Garantia upfront (hold/escrow) retorna ao expandir além de relações confiáveis.
  Troca pré-pago→postpago mexe no contrato de pagamento → `harness-architect` + ADR no build.

## Contratos de dados/BI — Slice 3 (architect → builder)

> Camada de dados do Slice 3 = 2 tabelas de config (`company_spend_limits`, `company_monthly_revenue`) +
> queries derivadas. **Nenhuma view criada** (decisão registrada abaixo). **Nenhuma RPC de saldo.** O builder
> implementa estas queries no service (`FinancialBIService` + `SpendLimitService`), padrão `supabase.from(...)`
> (Art. 5). RLS já isola por empresa — toda query roda autenticada como a empresa (não precisa filtrar
> company_id no client por segurança, só por UX; o RLS garante).

### Decisão: views REJEITADAS (sem ADR — reversível, sem artefato de schema)
- Views planas sobre `escrow_transactions`/`jobs`/`applications` **não propagam RLS com segurança** (uma view
  dona de `postgres` bypassaria o isolamento de empresa → vazaria gasto cross-company). `security_invoker`
  resolveria mas adiciona risco/superfície sem ganho. As agregações são parametrizadas (período/escopo) e
  read-heavy no dashboard → pertencem ao service (consistente com o resto do projeto). **Builder NÃO cria view.**

### Fonte da verdade do GASTO (usada por R12, R13, R14, R15)
> ⚠️ **REVISADO por ADR-20260630.** Com pagamento OPCIONAL, o gasto tem **duas fontes** unidas por `job_id`
> disjunto: (1) trilho Worki = `escrow_transactions` (abaixo); (2) **pagamento externo** = novo marcador de
> pagamento por turno (modo A default do piloto), carimbo = data do pagamento declarado / conclusão. Dedupe
> por `job_id` (um turno é pago por uma fonte; se ambos, escrow tem precedência). Enquanto o marcador não
> existir (trabalho subsequente com gate), o BI reflete só o trilho Worki — limitação conhecida. Ver o ADR.
- Gasto = `escrow_transactions` com `status IN ('released','captured')` (dinheiro efetivamente comprometido/pago
  ao freela). `amount` é o valor. **NÃO** somar `reserved`/`authorized` (ainda não virou gasto) nem `refunded`.
- Carimbo de período: `COALESCE(captured_at, released_at, created_at)` (postpago usa captured_at; prepaid legado
  usa released_at; fallback created_at). Filtrar o mês por este carimbo.
- A empresa da linha = `company_wallet_id → wallets.user_id`. O freela = `worker_wallet_id → wallets.user_id`.
  A loja/turno = via `job_id → jobs`. O freela também alcançável por `application_id → applications.worker_id`.

### BI-1 — Gasto acumulado do período (input do teto R12)
- `SELECT COALESCE(SUM(amount),0) FROM escrow_transactions e JOIN wallets w ON w.id = e.company_wallet_id
   WHERE w.user_id = :companyId AND e.status IN ('released','captured')
   AND COALESCE(e.captured_at, e.released_at, e.created_at) >= :monthStart
   AND COALESCE(e.captured_at, e.released_at, e.created_at) < :nextMonthStart`
  (filtrar por `scope` quando o teto for por loja — ver nota de scope: v1 single-store, normalmente NULL).

### BI-2 — Gasto e horas por freela / período (R13)
- Gasto por freela: agrupar BI-1 por `worker_wallet_id`/`applications.worker_id`.
- HORAS: preferir REAL quando houver checkout — `EXTRACT(EPOCH FROM (worker_checkout_at - worker_checkin_at))/3600`
  de `applications` (com check-in/out preenchidos). Fallback v1 (sem QR check-in, R3 = FIXO por turno): usar
  `jobs.estimated_hours` do turno concluído. Documentar no service qual fonte foi usada (real vs estimada).

### BI-3 — Ratio (R14)
- Custo-por-hora = BI-2.gasto / BI-2.horas (no período). Guardar contra divisão por zero (horas=0 → null/“—”).
- Custo-%-faturamento = BI-1.gasto / `company_monthly_revenue.amount` do mesmo `year_month`. Se não houver
  faturamento informado naquele mês → métrica fica oculta/CTA “informe seu faturamento” (não inventar número).

### BI-4 — Custo de no-show (R15) — heurística v1 + GAP sinalizado
- **GAP:** não há coluna explícita `no_show`. Heurística v1: convite `invitation_response='accepted'`
  (ou status `hired`) cujo turno já passou (`jobs.start_date < now()`) E sem `worker_checkout_at`/sem conclusão
  → candidato a falta. “Pagou R$X / Y faltas” = contagem dessas + soma do que ainda foi pago (raro no postpago,
  pois no-show antes da captura libera o hold sem gasto via `release_hold_postpago`). O builder deve ser
  conservador e rotular como estimativa. Se o piloto exigir precisão, escalar p/ architect → marcador explícito
  de no-show em `applications` (migration menor, fora deste slice).

### BI-5 — Concentração → vínculo (R16)
- Por freela na empresa, no período: somar HORAS (BI-2) e contar DIAS DISTINTOS trabalhados
  (`COUNT(DISTINCT date(jobs.start_date))` em turnos concluídos). Flag quando horas/dias cruzam um limiar de
  **produto** (ex.: ≥150h em ≤30 dias) — limiar é constante no service, **não** no banco (fácil calibrar).

### Contrato de ALERTA de teto (R12) — reusa `notifications`, idempotência sem tabela nova
- Alerta = INSERT em `public.notifications` (`type='payment'`, `user_id` = owner da empresa / contato financeiro;
  título/mensagem com %, valor gasto, teto; `link` = rota do BI). **Não criar tabela de alertas.**
- **Quando avaliar:** (a) a cada captura/liberação de pagamento (no `capture_escrow_postpago`/release path, no
  service que orquestra a conclusão — NÃO dentro da RPC de saldo) e (b) on-demand quando o dashboard de BI abre.
- **Idempotência (não duplicar o alerta do mesmo threshold no mesmo período):** `notifications` NÃO tem
  constraint de idempotência e o architect **não** adiciona uma agora (evitar tocar tabela quente). Convenção
  pro builder: derivar uma chave estável e checar antes do insert —
  `link = '/company/financeiro?alert=' || :companyId || ':' || to_char(:monthStart,'YYYYMM') || ':' || :threshold`
  e fazer `SELECT 1 FROM notifications WHERE user_id=:owner AND link=:thatLink LIMIT 1` (índice `notifications_user_id_idx`
  cobre o user_id). Se já existe → não reinsere. Dispara só o MAIOR threshold cruzado ainda não alertado
  naquele período (ex.: cruzou direto 92% → manda só o de 90, não 80+90). O threshold `>100` (“acima”) usa
  chave `:threshold='OVER'`. Avaliar contra `company_spend_limits.alert_thresholds` (default {80,90,100}).
- WhatsApp do alerta = Slice 4 (usa `financial_contact_phone`); v1 entrega app (`notifications`) + e-mail
  (`send-notification`).
