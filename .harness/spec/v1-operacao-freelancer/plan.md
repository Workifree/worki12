# Plan — Operação de Freelancer (v1, MVP para MOMMA)

> Fase 2 do playbook. Baseado em 3 reconhecimentos do código (pagamento/escrow, ciclo de vaga,
> identidade/conexões/notif/rating). HALT de aprovação pendente antes de qualquer código.

## Síntese do recon — o que já existe vs. o que falta

### ✅ Reaproveitável (~80%)
| Peça | Onde | Reuso |
|---|---|---|
| RPCs atômicas de escrow | `reserve_escrow`, `release_escrow`, `refund_escrow`, `credit_deposit`, `update_wallet_balance` (migrations) | ledger + idempotência `(wallet_id, reference_id)` |
| Ciclo check-in/checkout | `applications` (worker_checkin_at, company_checkin_confirmed_at...), `JobLifecycleStepper`, `CompanyJobCandidates` | a etapa "turno acontece → conclusão" é igual |
| Rating | tabela `reviews` + trigger `update_worker_rating_on_review` | base; precisa fix bidirecional |
| Notificações | `notifications` + Realtime (`NotificationContext`) + e-mail (`send-notification`) | in-app + e-mail prontos; falta WhatsApp |
| Histórico "meu trabalho" | `MyJobs.tsx`, `Dashboard.tsx` | pronto |
| Papéis/auth/onboarding/TOS | `ProtectedRoute`, tabelas `workers`/`companies` | pronto |

### 🚀 Build novo
1. **Conexões / "minha equipe"** — NÃO existe nenhum conceito de roster. Relação hoje é só transacional via `applications`. Precisa tabela(s) de conexão consentida + RLS + QR/link/telefone.
2. **Convite push (empresa → freela conhecido)** — hoje é pull (worker se candidata). Mudança **média-pequena**: +colunas em `applications` (`invited_by_company_at`, `invitation_response`, status `invited`/`declined`), aba "Convites" no worker, seletor de freela na empresa, notificação no convite.
3. **Pagamento POSTPAGO** — a maior peça nova **e o único desconhecido crítico** (ver abaixo).
4. **Rating bidirecional** — fix: trigger pra `companies.rating_average` + corrigir bug de `reviewed_id` no `MyJobs.tsx`.
5. **Camada financeira** (teto/BI/ratio/no-show/concentração) — Slice 3.
6. **Canal WhatsApp** — Slice 4 (precisa provedor: Twilio/Meta). E-mail já existe.

### ✅ O DESCONHECIDO CRÍTICO — RESOLVIDO (spike Slice 0, 2026-06)
O Asaas **suporta nativamente** o postpago — sem segundo gateway, sem tocar o Article 6:
- **Tokenização:** `POST /v3/creditCard/tokenizeCreditCard` → `creditCardToken` por customer.
- **Pré-auth (hold):** flag `authorizeOnly: true` em `POST /v3/payments` → status `AUTHORIZED`. Hold **3 dias** (até 25 com elegibilidade de MCC).
- **Captura:** `POST /v3/payments/{id}/captureAuthorizedPayment`.
- **Cobrança programática** com token salvo (sem invoice manual).

Sequência do Slice 2: tokenizar no cadastro → `authorizeOnly` no aceite → capturar na conclusão. **Fallback** (se a habilitação de pré-auth for negada ou o hold de 3 dias não couber): charge-on-demand (tokeniza + captura direto na conclusão, sem hold) — ainda só Asaas, sem ADR.

**Ações externas (caminho crítico do Slice 2, não-código):**
1. Solicitar ao gerente de contas Asaas a **habilitação em produção** de tokenização + pré-autorização (análise de risco; funciona livre em sandbox).
2. Confirmar elegibilidade pra estender hold de 3 → 25 dias se for atender turnos agendados com antecedência.

## Slicing proposto (ordem para ficar usável na MOMMA o mais rápido)

| Slice | Conteúdo | Depende do Asaas? | Estimativa |
|---|---|---|---|
| **0 — Spike Asaas** | ✅ FEITO — Asaas suporta tokenização + pré-auth + captura nativamente | — | concluído |
| **1 — Loop relacional** | minha equipe/conexões + convite push + aceite/recusa + reuso do lifecycle + fix rating bidirecional + "meu trabalho" | ❌ NÃO | ~1 sem |
| **2 — Pagamento postpago** | cartão on-file + cobrança/captura na conclusão (conforme spike); `payment_methods`, novos status de escrow, edge functions; **architect + ADR** | ✅ SIM | ~5-7 dias |
| **3 — Inteligência financeira** | teto+alertas, BI gasto/horas, ratio custo-%-faturamento, custo de no-show, flag de concentração | ❌ | ~3-5 dias |
| **4 — WhatsApp** | entrega de convite multicanal (precisa provedor) | — | ~2-3 dias |

> Slices 0 e 1 rodam **em paralelo** (o loop não tem o desconhecido de pagamento). Quando o loop fica
> pronto, o spike já resolveu o caminho do pagamento → Slice 2 entra. O tool fica **plenamente usável**
> (com pagamento automático) ao fim do Slice 2. Slice 1 sozinho entrega a coordenação (convite→aceite→
> turno→conclusão→avaliação); o payout do freela é o ponto de integração que o Slice 2 preenche.

## Slice 1 — detalhe (primeiro build, sem desconhecido)

### Branch
`feat/v1-loop-relacional`

### Files to touch
| Path | Razão | Camada |
|---|---|---|
| `supabase/migrations/<ts>_team_connections.sql` | tabela de conexão consentida empresa↔freela + RLS | data |
| `supabase/migrations/<ts>_invite_columns.sql` | +colunas/status de convite em `applications` + RLS | data |
| `supabase/migrations/<ts>_company_rating_trigger.sql` | trigger `companies.rating_average` (rating bidirecional) | data |
| `frontend/src/types/index.ts` | tipos: Connection/TeamMember, Application estendida (à mão) | types |
| `frontend/src/services/*` ou `hooks/useInviteWorker.ts` | criar conexão + enviar convite + notificação | services |
| `frontend/src/pages/company/CompanyTeam.tsx` (novo) | "minha equipe" (roster) + adicionar via QR/link/telefone | pages |
| `frontend/src/pages/company/CompanyCreateJob.tsx` | criar turno SEM reservar escrow (postpago) + escolher freela da equipe | pages |
| `frontend/src/pages/MyJobs.tsx` | aba "Convites" (aceitar/recusar) | pages |
| `frontend/src/pages/Profile.tsx` / perfil freela | gerar QR do perfil (identidade) | pages |
| `frontend/src/components/RateModal.tsx` + `MyJobs.tsx` | corrigir direção do review (bug `reviewed_id`) | components |
| `frontend/src/App.tsx` | rota de CompanyTeam sob ProtectedRoute | routing |

### Steps ordenados
1. Migrations: conexões + RLS; colunas de convite em `applications` + RLS; trigger de rating de empresa. (`harness-architect` revisa — toca schema/RLS.)
2. Tipos em `types/index.ts` (à mão).
3. Service/hook: criar conexão (QR/link/telefone, com aceite), enviar convite (cria `applications` status `invited` + notificação in-app/e-mail).
4. UI empresa: `CompanyTeam` (roster + adicionar) e ajuste do criar-turno (push, sem escrow). (`harness-frontend-builder` / Gemini.)
5. UI worker: aba "Convites" (aceitar→`accepted`/recusar→`declined`, recusa NEUTRA). QR do perfil.
6. Fix rating bidirecional (trigger + correção do `reviewed_id`).
7. Revisão paralela (3.5): `harness-frontend-reviewer` + `harness-security-reviewer` (toca migrations/RLS) → `harness-evaluator`.

### Pontos de atenção
- Criar-turno **não** chama `reserve_escrow` (postpago — sem depósito). O payout fica como ponto de integração do Slice 2.
- Recusa de convite = **neutro** (não mexe em reputação). Só no-show pós-aceite penaliza (futuro).
- Isolamento de papel worker/empresa no RLS das novas tabelas (constitution Art. 1, 4).

## Riscos
| Risco | Prob | Impacto | Mitigação |
|---|---|---|---|
| ~~Asaas não suporta tokenização/pré-auth~~ RESOLVIDO: suporta nativamente | — | — | Risco residual: habilitação em produção pode ser negada → fallback charge-on-demand (sem ADR) |
| Mudança pré-pago→postpago quebra fluxo existente | M | A | manter fluxo antigo coexistindo; novo turno é caminho novo; architect + ADR |
| RLS das conexões fura isolamento de papel | M | A | testar como empresa E worker; security-reviewer |
| Rating bidirecional duplica/confunde direção | M | M | constraint por direção; trigger separado p/ empresa |
| WhatsApp depende de provedor externo | M | M | Slice 4 isolado; e-mail+app como fallback |

## Gates
1. **Spike Asaas (Slice 0)** antes de fechar o design do Slice 2.
2. **`harness-architect`** revisa toda migration/RPC nova de saldo + a troca pré-pago→postpago (ADR).
3. **Provedor WhatsApp** definido antes do Slice 4.

## Estimate
MVP usável (Slices 0+1+2): **~2-3 semanas** de build. +Slice 3 (financeiro) e +Slice 4 (WhatsApp) depois.
