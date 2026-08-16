# Spec — Revisão pré-piloto (modo A)

## Context

Primeiro teste piloto com cliente real. O produto roda **100% no modo A** (ADR-20260630):
a empresa monta o **Elenco**, convida o freela pro turno (push), confere presença
(check-in/check-out), **paga por fora (PIX/dinheiro)** e **registra** no Worki, que emite
o recibo bilateral. Nenhum dinheiro passa pela plataforma no piloto.

Auditoria de produto/QA/UX identificou 5 bloqueadores, 7 bugs e 9 remoções.
Este spec cobre a **Onda 1 (bloqueadores)** e a **Onda 2 (limpeza)**.

Gates atuais: `build` ✅ · `lint` ✅ (0 erros) · `vitest` ✅ 247 testes.

## Decisões já tomadas (não reabrir)

- Piloto é **modo A**. Escrow/carteira/cartão continuam no banco e nos services
  (`walletService`, migrations) — some apenas a **superfície de UI**. Reabertura é opt-in
  por gatilho do ADR-20260630.
- A página **Financeiro** (`/company/financeiro`) sai.
- Check-in por QR e rótulo "(GPS)" foram **REMOVIDOS** (decisão revisada durante a Onda 1 —
  ver R7 abaixo). A intenção original era validar o QR de verdade; optou-se por remover.

## Requirements

### R1 — Chave PIX no fluxo de pagamento (BLOQUEADOR)
A empresa paga por fora, mas hoje **não vê a chave PIX nem o telefone do freela** em
lugar nenhum, e o onboarding do freela nem pede a chave.
- R1.1 `WorkerOnboarding` passa a coletar **chave PIX + tipo** (CPF/CNPJ/e-mail/telefone/aleatória),
  com validação de dígito reusando `lib/validation` (`validateCPFOrCNPJ`, `EMAIL_REGEX`).
- R1.2 `WorkerPublicProfile` (`/company/worker/:id`) exibe **chave PIX e telefone** com botão de copiar.
- R1.3 `CompanyTeam` → `MemberCard` mostra a chave PIX com botão de copiar.
- R1.4 Modal "Registrar Pagamento" (`CompanyJobCandidates`) mostra a chave PIX do freela com copiar.
- Visibilidade: apenas para empresa com conexão `accepted` com aquele freela (RLS de `workers`
  deve ser verificada; se hoje for aberta a qualquer autenticado, registrar o achado — NÃO
  alterar RLS sem gate do architect).

### R2 — Perfil público da empresa (BLOQUEADOR)
Não existe. O freela aceita convite sem saber quem é a empresa.
- R2.1 Nova rota **`/empresa/:id`** com nome, logo, capa, setor, descrição, endereço,
  briefing padrão, nota + avaliações (reusar `components/ProfileReviews` com `reviewerRole="worker"`).
- R2.2 Linkada de: card da **Carteira de Clientes**, **convite pendente** em Meus Turnos,
  **InviteTakeover** (tela cheia) e cabeçalho do chat.
- R2.3 Rota sob `ProtectedRoute` + `MainLayout` (papel worker), fora de `/company/*`.

### R3 — Sino da empresa aponta para rota bloqueada (BLOQUEADOR)
`NotificationBell` sempre navega para `/notifications`, que `ProtectedRoute` trata como
worker-only → empresa recebe "sem permissão" e é expulsa. Ramificar por
`user_metadata.user_type` (`hire` → `/company/notifications`).

### R4 — Ajuda descreve o produto antigo (BLOQUEADOR)
`pages/Help.tsx` fala de escrow, depósito, taxa 8%+R$4, "cancelar candidatura" e liberação
automática em 48h. WhatsApp é placeholder `5511999999999`.
- R4.1 Reescrever os FAQs para o modo A.
- R4.2 Remover o número placeholder (deixar só e-mail até o número real existir).
- R4.3 Linkar `/ajuda` de dentro do app (rodapé do `Sidebar`).

### R5 — Elenco não abre o perfil do freela
`MemberCard` e `PendingCard` em `CompanyTeam` não navegam. Tornar o card clicável
(`/company/worker/:id`), sem engolir os cliques dos botões existentes (compartilhar/remover).

### R6 — Guarda de consentimento no DELETE de `team_connections` (SEGURANÇA)
A policy `tc_update_company` impede a empresa de desfazer um `blocked`, mas `tc_delete_company`
não tem a mesma guarda: a empresa pode **deletar a linha bloqueada e reinserir 'pending'**,
anulando o veto do freela. Migration com `USING (... AND status <> 'blocked')`.
**Gate obrigatório do harness-architect.**

### R7 — Check-in QR/GPS não verifica nada
`parseCheckinQr` faz fallback para o próprio turno (qualquer QR confirma) e o "Check-in (GPS)"
pede a posição e **descarta** o resultado.
**RESOLVIDO POR REMOÇÃO, não por validação** (decisão revisada na Onda 1, pendente de
confirmação humana). O que foi feito:
- R7.1 ~~QR passa a validar por match exato~~ → **QR de check-in removido dos DOIS lados**:
  scanner/parser/modal em `MyJobs.tsx` (freela) e botão "QR Chegada" + `QRCodeSVG` em
  `CompanyJobCandidates.tsx` (empresa). Não existe mais leitor de check-in no app.
- R7.2 Rótulo "(GPS)" e a chamada de geolocalização removidos.
- Confirmação de presença hoje: check-in do freela + confirmação manual da empresa na tela do turno.
- O QR de **identidade do freela** (`Profile.tsx` → `CompanyTeam.tsx`, para adicionar ao elenco)
  é outro fluxo e **permanece**.

### R8 — Criar Turno sem validação
Passos 1 e 2 de `CompanyCreateJob` não validam: dá pra criar turno sem título, função, data
e horário. Replicar o padrão `canProceed()` do `WorkerOnboarding`. Data no passado barrada.

### R9 — Jargão interno na tela
"(Slice 2)" em `CompanyCreateJob`; "v1.1" (2×) em `CompanyTeam`. Reescrever para linguagem
de usuário e **factualmente correta no modo A** (não há cobrança automática).

### R10 — Botões mortos e número inventado
Botão "Mensagem" sem `onClick` em `WorkerPublicProfile`; lupa/funil decorativos em
`CompanyDashboard`; "Dica Pro" afirma "3x mais freelas qualificados" (dado inventado).

### R11 — Remover superfície do modelo antigo (Onda 2)
- `/company/financeiro` (`CompanyFinancial`, `useFinancialBI`, `financialBIService`, `spendLimitService`)
  — **5 amarrações**: rota, item do Sidebar, card em `CompanyWallet`, e o alerta de teto que
  **grava notificação com link para a página removida** (`evaluateSpendAlert` em
  `CompanyJobCandidates` e `walletService`).
- `/wallet` (worker) + card "Recebimento" no `Profile` → **substituir** por "Meus recebimentos"
  sobre `shift_payments` (não só remover).
- `/company/wallet` + `DepositModal`, `AddCardModal`, `PaymentMethodsSection`, `EscrowStatusBadge`.
- Código morto: `pages/Analytics.tsx`, `pages/CreateJob.tsx`, `pages/Placeholder.tsx`,
  `pages/worker/WorkerDashboard.tsx` (+ rota `/worker/dashboard`).
- `BottomNav` da empresa com Mensagens (hoje o chat não existe no celular).

## Acceptance

- `cd frontend && npm run build` e `npm run lint` verdes (0 erro).
- `npx vitest run` verde, com teste novo para: resolução de rota do sino por papel (R3),
  validação do QR de check-in (R7.1), `canProceed` de `CompanyCreateJob` (R8).
- Empresa consegue, do início ao fim, sem sair do app: adicionar freela ao elenco →
  abrir o perfil dele → ver a chave PIX → convidar pro turno → confirmar presença →
  registrar pagamento → ver recibo.
- Freela consegue abrir o perfil da empresa a partir do convite e da Carteira de Clientes.
- Nenhuma tela do piloto menciona escrow, depósito, saldo, taxa, "Slice" ou "v1.1".
- Nenhuma notificação nova aponta para rota removida.
- Article 8 intacto: nenhuma alteração em RPC de saldo.
