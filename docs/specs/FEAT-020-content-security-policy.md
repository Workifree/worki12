# FEAT-020: Content Security Policy Header

**Issue:** #178 | **Priority:** P2 | **Created:** 2026-03-17 | **Status:** Draft

---

## Problem Statement

O arquivo `frontend/public/_headers` define X-Frame-Options, X-Content-Type-Options, HSTS e Referrer-Policy, mas não inclui Content-Security-Policy (CSP). CSP é a defesa mais eficaz contra XSS e é recomendado pelo OWASP para aplicações web em produção. Sem CSP, scripts injetados executam livremente.

---

## User Stories

| Persona | Ação desejada | Benefício concreto |
|---------|--------------|-------------------|
| Como usuário | quero que o app tenha CSP ativo | para que scripts maliciosos não possam roubar meus dados |
| Como admin | quero que auditorias de segurança aprovem o app | para que o app tenha classificação de segurança adequada |

---

## Acceptance Criteria

**AC-1 (CSP presente):** Quando o arquivo `_headers` é implantado, então Content-Security-Policy header está presente.

**AC-2 (origens permitidas):** Dado que o CSP está configurado, quando a aplicação carrega, então permite scripts do próprio domínio, Supabase (`vrklakcbkcsonarmhqhp.supabase.co`), e Sentry.

**AC-3 (inline bloqueado):** Dado que o CSP está configurado, quando verificado, então `unsafe-inline` para scripts NÃO está presente (ou usa hash/nonce). `unsafe-eval` NÃO está presente.

**AC-4 (app funcional):** Dado que o CSP está ativo, quando a aplicação é usada normalmente (login, dashboard, wallet, messages), então nenhum recurso legítimo é bloqueado pelo CSP.

---

## Technical Design

### Data Access Tier
**Selected tier:** N/A — alteração em arquivo de configuração estático.
**Rationale:** Nenhum acesso a dados envolvido.

### Components

**New files to create:**
Nenhum.

**Existing files to modify:**
| File Path | Current Behavior | Change Required |
|-----------|-----------------|-----------------|
| `frontend/public/_headers` | Tem X-Frame-Options, X-Content-Type-Options, HSTS, Referrer-Policy | Adicionar Content-Security-Policy com diretivas para default-src, script-src, connect-src, img-src, style-src, font-src |

### Edge Functions
None — arquivo de configuração estático.

### Database Changes
Nenhuma — usa schema existente.

### State & Data Flow
Sem mudança — o _headers é servido pelo hosting provider (Vercel/Netlify) e aplicado automaticamente em todas as respostas HTTP.

### UI / Interaction Notes
- **Loading state:** N/A
- **Empty state:** N/A
- **Error state:** Se CSP for muito restritivo, recursos legítimos serão bloqueados (verificar com console do browser)
- **Responsive:** N/A
- **Design pattern:** N/A — arquivo de configuração

---

## Task Breakdown

| Task | Deliverable (what done looks like) | Estimate | Depends On |
|------|------------------------------------|----------|-----------|
| T1 | `frontend/public/_headers` atualizado com CSP header. CSP permite: self, Supabase, Sentry. Bloqueia unsafe-inline/eval para scripts. `npm run build` passa. | 2h | — |

**Total estimate:** 2h

**Deployment note:** Sem deploy adicional necessário — _headers é incluído no build estático.

---

## Out of Scope (v1)

- Não inclui: CSP report-uri ou report-to (monitoramento de violações)
- Não inclui: nonce-based CSP (requer server-side rendering)
- Não inclui: meta tag CSP fallback
- Não inclui: Permissions-Policy header
