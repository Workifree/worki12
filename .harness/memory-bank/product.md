# Product — Worki

## O que é

**Worki** é um marketplace de trabalho freelance/diária para o mercado brasileiro. Conecta dois lados:
**empresas** que publicam vagas/turnos e **trabalhadores** (workers) que se candidatam, executam e
recebem. O dinheiro circula por uma **carteira central Asaas** com modelo de **escrow** (garantia):
a empresa deposita, o valor fica reservado, e é liberado ao trabalhador quando o trabalho é confirmado.

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
   (`CompanyJobCandidates`), contrata → **escrow reservado**; turno acontece (check-in do worker,
   checkout confirmado pela empresa) → **escrow liberado**; avaliação mútua (`RateModal`).
3. **Carteira & pagamentos (Asaas, escrow)** — Depósito da empresa (`DepositModal` → `asaas-deposit`),
   reserva/liberação/estorno de escrow (atômico no DB via `walletService`), saque do worker
   (`asaas-withdraw`), reconciliação via webhook (`asaas-webhook`).
4. **Mensageria & notificações** — Chat worker↔empresa (`Messages`/`CompanyMessages`), notificações em
   tempo real (`NotificationContext`, Supabase Realtime), centro de notificações (`Notifications`).
5. **Onboarding & confiança** — Onboarding separado por papel (`WorkerOnboarding`/`CompanyOnboarding`),
   verificação de identidade, aceite de Termos (TOS gate em `ProtectedRoute`), perfis públicos.

## Anti-vision

- NÃO é rede social (sem feed de posts, curtidas, seguidores).
- NÃO é folha de pagamento/CLT — é trabalho por diária/freela com pagamento por escrow.
- NÃO usa subcontas Asaas — **uma carteira central** detém os fundos; saldo por usuário vive no DB.
- NÃO expõe `service_role` no frontend — toda operação privilegiada passa por Edge Function.
- NÃO é multi-gateway — **Asaas é o único** provedor de pagamento (Stripe foi 100% removido).
- NÃO replica fluxos manuais de pagamento — escrow e auditoria são parte do produto, não opcionais.

## Direção atual (MVP — 2026)

Foco em **lançar o MVP com fluxo de pagamento confiável**:
- Asaas-only (Stripe removido por decisão do owner).
- Carteira central + escrow atômico (RPCs `reserve_escrow`, `release_escrow`, `refund_escrow`,
  `credit_deposit`, `update_wallet_balance`).
- Check-in/checkout que cruza a meia-noite, CORS das funções Asaas para origens locais.
- Notificações, deploy (Vercel: `worki-opal.vercel.app`), Termos/Privacidade, SEO (`PageMeta`).
- Qualidade: subir cobertura de testes (Vitest + Playwright E2E), limpar warnings de lint.

## Restrições estratégicas

- Mercado brasileiro: CPF/CNPJ, PIX, LGPD básico (dados pessoais de workers e empresas).
- Mobile-first: a maioria dos workers opera pelo celular (`BottomNav`, `use-mobile`).
- `backend_legacy/` e `frontend-angular-backup/` são DEPRECADOS — não tocar.
