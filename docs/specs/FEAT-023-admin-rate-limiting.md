# FEAT-023: Admin Login Rate Limiting

**Issue:** #181 | **Priority:** P2 | **Created:** 2026-03-17 | **Status:** Draft

---

## Problem Statement

A página `/admin` está como rota pública. O componente Admin.tsx faz sua própria verificação de email, mas o formulário de login é exposto a todos os visitantes. Emails de admin estão hardcoded no frontend (`Admin.tsx:9` - DEFAULT_ADMIN_EMAILS) e na edge function (`admin-data/index.ts:5`). O login vai direto para `supabase.auth.signInWithPassword()` sem rate limiting da aplicação, permitindo brute-force.

---

## User Stories

| Persona | Ação desejada | Benefício concreto |
|---------|--------------|-------------------|
| Como admin | quero que tentativas de brute-force sejam bloqueadas | para que minha conta admin esteja protegida |
| Como admin | quero que emails de admin não sejam expostos no frontend | para que atacantes não saibam quais contas atacar |

---

## Acceptance Criteria

**AC-1 (rate limiting):** Quando um usuário faz mais de 5 tentativas de login admin em 1 minuto, então o botão de login fica desabilitado e exibe toast `"Muitas tentativas. Aguarde 1 minuto antes de tentar novamente."`.

**AC-2 (sem emails hardcoded):** Dado que `Admin.tsx` é inspecionado, quando verificado, então os emails de admin NÃO estão hardcoded como fallback — apenas `VITE_ADMIN_EMAILS` env var é usada. Se a env var não está definida, nenhum email é permitido.

**AC-3 (delay exponencial):** Quando um usuário faz tentativas consecutivas de login admin que falham, então cada tentativa subsequente tem delay progressivo (1s, 2s, 4s, 8s...) antes de permitir nova tentativa.

**AC-4 (admin funcional):** Dado que um admin tem credenciais corretas, quando faz login com email válido (presente na env var), então acessa o painel normalmente.

---

## Technical Design

### Data Access Tier
**Selected tier:** Direct Supabase client
**Rationale:** A verificação de rate limiting é client-side (localStorage ou state). O login usa `supabase.auth.signInWithPassword()` que já existe.

### Components

**New files to create:**
Nenhum.

**Existing files to modify:**
| File Path | Current Behavior | Change Required |
|-----------|-----------------|-----------------|
| `frontend/src/pages/Admin.tsx` | `DEFAULT_ADMIN_EMAILS` hardcoded como fallback. Login sem rate limiting. | Remover fallback de emails. Adicionar state para tracking de tentativas com timestamp. Implementar delay exponencial e bloqueio após 5 tentativas. |
| `supabase/functions/admin-data/index.ts` | `DEFAULT_ADMIN_EMAILS` hardcoded como fallback na linha 5. | Remover fallback — usar apenas `ADMIN_EMAILS` env var. Se env var não definida, negar todos os acessos. |

### Edge Functions
| Function Name | Deploy Flags | Auth | Request Body | Response |
|--------------|-------------|------|-------------|----------|
| `supabase/functions/admin-data/` | `--no-verify-jwt` | Own auth check (env var email list) | vários | vários |

### Database Changes
Nenhuma — usa schema existente.

### State & Data Flow
No `Admin.tsx`: novo state `loginAttempts: number` e `lastAttemptTime: number`. Cada login que falha incrementa o contador e armazena o timestamp. Se `loginAttempts >= 5` e `Date.now() - lastAttemptTime < 60000`, o botão fica disabled. O delay exponencial é implementado com `disabled` + timer: `Math.min(2 ** loginAttempts * 1000, 60000)`.

### UI / Interaction Notes
- **Loading state:** Botão mostra "Aguarde..." durante delay
- **Empty state:** N/A
- **Error state:** Toast `"Muitas tentativas. Aguarde 1 minuto antes de tentar novamente."` quando rate limit atingido
- **Responsive:** Sem mudança
- **Design pattern:** Segue padrão neo-brutalist existente do Admin.tsx

---

## Task Breakdown

| Task | Deliverable (what done looks like) | Estimate | Depends On |
|------|------------------------------------|----------|-----------|
| T1 | `Admin.tsx` modificado: sem fallback de emails, rate limiting com delay exponencial, bloqueio após 5 tentativas. `admin-data/index.ts` modificado: sem fallback de emails. | 2h | — |

**Total estimate:** 2h

**Deployment note:** Deploy `admin-data` com `--no-verify-jwt` após merge. Garantir que `ADMIN_EMAILS` env var está configurada no Supabase dashboard ANTES do deploy.

---

## Out of Scope (v1)

- Não inclui: rate limiting server-side (na edge function)
- Não inclui: CAPTCHA
- Não inclui: notificação por email de tentativas de login falhadas
- Não inclui: bloqueio por IP
