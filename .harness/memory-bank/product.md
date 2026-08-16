# Product — Worki

## O que é

**Worki** é um marketplace de trabalho freelance/diária para o mercado brasileiro. Conecta dois lados:
**empresas** que publicam vagas/turnos e **trabalhadores** (workers) que se candidatam, executam e
recebem. O dinheiro pode circular por uma **carteira central Asaas** (opcional) com modelo de **escrow**
(Slice 2, opt-in), ou ser registrado como **pagamento externo** (Slice 3, default do piloto): empresa
paga direto (PIX/dinheiro) e o Worki emite recibo para auditoria/histórico, sem mover saldo.

SPA React 19 + Supabase (PostgreSQL + RLS + Auth + Edge Functions Deno) + Asaas (pagamentos PIX/Boleto/Cartão).
Mono-produto, multi-papel: a mesma base serve workers e empresas, com isolamento de papel reforçado
no roteamento (`ProtectedRoute`) e no banco (RLS).

## Personas

1. **Trabalhador (worker)** — Busca vagas no feed, candidata-se, faz check-in/checkout no turno, recebe
   pagamento na carteira, saca via PIX. Sistema de gamificação (XP/nível). Cor de marca: **verde #00A651**.
2. **Empresa (company)** — Publica vagas, avalia candidatos, contrata (dispara escrow), confirma a conclusão
   do turno (libera escrow), gerencia carteira e depósitos. Cor de marca: **azul #2563EB** (CTAs hoje usam
   preto brutalista — ver `design-system.md`).
3. **Admin** — Painel administrativo (`pages/Admin.tsx`) + edge function `admin-data` com auth própria.
   Visão de moderação/operação da plataforma.

## Jobs principais

1. **Descoberta & candidatura** — Feed de vagas (`Jobs`, `JobCard`), match score, candidatura
   (`useJobApplication`), acompanhamento (`MyJobs`).
2. **Ciclo de vida da vaga** — Empresa cria vaga (`CompanyCreateJob`), recebe candidatos
   (`CompanyJobCandidates`), contrata; turno acontece (check-in do worker, checkout confirmado pela empresa);
   **pagamento** (modo A default: registro de pagamento externo via `paymentRecordService` + recibo `ReceiptView`;
   modo B/C opt-in: escrow/cartão); avaliação mútua (`RateModal`).
3. **Carteira & pagamentos (modo A — pagamento externo default)** — Empresa registra pagamento PIX/dinheiro
   (`CompanyJobCandidates` → modal "Registrar Pagamento"), worker confirma recibo (`ReceiptView` → `/recibo/:jobId`).
   **Modo B/C (opt-in):** Depósito da empresa (`DepositModal` → `asaas-deposit`), reserva/liberação/estorno de
   escrow (atômico no DB via `walletService`), saque do worker (`asaas-withdraw`), reconciliação via webhook (`asaas-webhook`).
4. **Mensageria & notificações** — Chat worker↔empresa (`Messages`/`CompanyMessages`), notificações em
   tempo real (`NotificationContext`, Supabase Realtime), centro de notificações (`Notifications`).
5. **Onboarding & confiança** — Onboarding separado por papel (`WorkerOnboarding`/`CompanyOnboarding`),
   verificação de identidade, aceite de Termos (TOS gate em `ProtectedRoute`), perfis públicos.

## Anti-vision

- NÃO é rede social (sem feed de posts, curtidas, seguidores).
- NÃO é folha de pagamento/CLT — é trabalho por diária/freela com pagamento por escrow ou registro de pagamento externo.
- NÃO usa subcontas Asaas — **uma carteira central** detém os fundos (quando dinheiro passa pelo Worki); saldo por usuário vive no DB.
- NÃO expõe `service_role` no frontend — toda operação privilegiada passa por Edge Function.
- NÃO é multi-gateway — **Asaas é o único** provedor de pagamento (Stripe foi 100% removido).
- Modo A (pagamento externo registrado, default piloto) não move saldo — é auditoria/recibo. Escrow (modo B/C) é caminho opt-in.

## Direção atual (MVP — 2026)

Foco em **piloto com primeiro cliente real, 100% modo A** (Onda 1 — Revisão Piloto):
- **Modo A (ÚNICO no piloto):** Empresa monta **Elenco** (equipe permanente via `team_connections`), convida freela pro turno (push),
  **confere presença** via check-in/checkout, **paga por fora** (PIX/dinheiro) e **registra no Worki** (recibo bilateral via `shift_payments`).
  Nenhum dinheiro passa pela plataforma. Fluxo fechado, linear, sem escrow/depósito/cartão.
- **Modos B/C (depois do piloto):** Asaas carteira central + escrow atômico (RPCs) ou cartão on-file; reabríveis por gatilho de ADR-20260630.
- **Assimetria de confiança:** freela pode abrir perfil público da empresa (`/empresa/:id`) antes de aceitar convite — prova social
  (avaliações de outros freelas) equilibra o fluxo unidirecional (empresa convida, não freela se candidata).
- Check-in/checkout que cruza a meia-noite. **Check-in por QR foi removido inteiro** (scanner, parser, modal): nunca validou nada de fato
  (aceitava qualquer conteúdo QR; o rótulo "(GPS)" era falso — pedia localização e descartava o resultado). Confirmação de presença hoje: worker faz check-in + empresa confirma manualmente na tela do turno.
- Notificações, deploy (Vercel: `worki-opal.vercel.app`), Termos/Privacidade, SEO (`PageMeta`).
- Qualidade: subir cobertura de testes (Vitest + Playwright E2E), limpar warnings de lint, remover superfície de modelo antigo (páginas `/company/financeiro`, `/wallet`, `DepositModal`, etc.).

## Restrições estratégicas

- Mercado brasileiro: CPF/CNPJ, PIX, LGPD básico (dados pessoais de workers e empresas).
- Mobile-first: a maioria dos workers opera pelo celular (`BottomNav`, `use-mobile`).
- `backend_legacy/` e `frontend-angular-backup/` são DEPRECADOS — não tocar.
