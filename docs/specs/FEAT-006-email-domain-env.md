# FEAT-006: Domínio Configurável em Templates de Email

**Issue:** #121 | **Priority:** P1 | **Created:** 2026-03-16 | **Status:** Draft

---

## Problem Statement

Os templates de email em `supabase/functions/_shared/email.ts` usam domínio hardcoded `https://worki.com.br` em 4 links CTA. Se o domínio de produção for diferente ou se houver ambiente de staging, todos os CTAs nos emails estarão quebrados, causando frustração e perda de conversões.

---

## User Stories

| Persona | Ação desejada | Benefício concreto |
|---------|--------------|-------------------|
| Como operador | quero que os links de email funcionem em qualquer ambiente (staging, produção) | para que CTAs nunca apontem para URL incorreta |
| Como desenvolvedor | quero configurar o domínio via variável de ambiente | para que deploys em ambientes diferentes funcionem automaticamente |

---

## Acceptance Criteria

**AC-1 (variável de ambiente):** Quando o template de email é gerado, então o domínio base é lido de `Deno.env.get('APP_URL')`.

**AC-2 (fallback):** Quando `APP_URL` não está configurada, então usa `https://worki.com.br` como fallback.

**AC-3 (links corretos):** Quando os 4 links CTA são gerados (hired → `/my-jobs`, payment_received → `/wallet`, deposit_confirmed → `/company/wallet`, new_application → `/company/jobs`), então usam o domínio da variável `APP_URL`.

---

## Technical Design

### Data Access Tier
**Selected tier:** Edge Function (`supabase/functions/_shared/email.ts`)
**Rationale:** Mudança em shared utility usado por edge functions.

### Components

**New files to create:**
Nenhum.

**Existing files to modify:**
| File Path | Current Behavior | Change Required |
|-----------|-----------------|-----------------|
| `supabase/functions/_shared/email.ts` | Links hardcoded `https://worki.com.br` em 4 templates | Substituir por variável `APP_URL` com fallback |

### Edge Functions
| Function Name | Deploy Flags | Auth | Request Body | Response |
|--------------|-------------|------|-------------|----------|
| Todas as funções que usam `_shared/email.ts` | Sem mudança | Sem mudança | Sem mudança | Links agora usam `APP_URL` |

### Database Changes
Nenhuma — usa schema existente.

### State & Data Flow
1. Ao gerar template de email, ler `Deno.env.get('APP_URL')` ou usar `'https://worki.com.br'` como fallback
2. Construir URLs concatenando `APP_URL` + path (e.g., `/my-jobs`)
3. Usar no atributo `href` dos links CTA

### UI / Interaction Notes
N/A — mudança em edge function, sem UI.

---

## Task Breakdown

| Task | Deliverable (what done looks like) | Estimate | Depends On |
|------|------------------------------------|----------|-----------|
| T1 | `supabase/functions/_shared/email.ts` modificado: constante `APP_URL` criada com `Deno.env.get('APP_URL') ?? 'https://worki.com.br'`. 4 links hardcoded substituídos por template string com `APP_URL`. | 1h | — |

**Total estimate:** 1h

**Deployment note:** Configurar `APP_URL` nos secrets do Supabase: `supabase secrets set APP_URL=https://worki.com.br`. Re-deploy todas as funções que usam `_shared/email.ts`.

---

## Out of Scope (v1)

- Não inclui: Templates de email adicionais
- Não inclui: Testes automatizados para templates de email (issue #130 separado)
- Não inclui: Configuração automática de APP_URL no deploy
