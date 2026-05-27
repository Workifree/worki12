# FEAT-010: Security Headers (CSP, X-Frame-Options, HSTS)

**Issue:** #125 | **Priority:** P2 | **Created:** 2026-03-16 | **Status:** Draft

---

## Problem Statement

Não existe configuração de security headers para o frontend. O app é vulnerável a clickjacking (iframes maliciosos) e browsers modernos não aplicam proteções adicionais contra XSS sem Content-Security-Policy e outros headers de segurança.

---

## User Stories

| Persona | Ação desejada | Benefício concreto |
|---------|--------------|-------------------|
| Como operador | quero que o frontend retorne security headers padrão | para que o app esteja protegido contra clickjacking e MIME sniffing |

---

## Acceptance Criteria

**AC-1 (headers básicos):** Quando o frontend é servido, então retorna `X-Frame-Options: DENY`, `X-Content-Type-Options: nosniff`, `Referrer-Policy: strict-origin-when-cross-origin`.

**AC-2 (HSTS):** Quando servido via HTTPS, então retorna `Strict-Transport-Security: max-age=63072000; includeSubDomains`.

**AC-3 (configuração criada):** A configuração é criada em formato compatível com Netlify (`_headers` ou `netlify.toml`) ou Vercel (`vercel.json`), conforme a plataforma de hosting do projeto.

---

## Technical Design

### Data Access Tier
**Selected tier:** N/A — configuração de hosting
**Rationale:** Headers de segurança são configurados na camada de hosting/CDN.

### Components

**New files to create:**
| File Path | Type | Responsibility |
|-----------|------|---------------|
| `frontend/public/_headers` | Config | Security headers para Netlify/hosting |

**Existing files to modify:**
Nenhum.

### Edge Functions
None.

### Database Changes
Nenhuma.

### State & Data Flow
N/A — headers são adicionados pelo servidor de hosting.

### UI / Interaction Notes
N/A — sem mudanças visuais.

---

## Task Breakdown

| Task | Deliverable (what done looks like) | Estimate | Depends On |
|------|------------------------------------|----------|-----------|
| T1 | Arquivo `frontend/public/_headers` criado com security headers. Se projeto usar Vercel, criar `vercel.json` com headers. Build passa. | 1h | — |

**Total estimate:** 1h

**Deployment note:** Headers são aplicados automaticamente pelo hosting provider após deploy.

---

## Out of Scope (v1)

- Não inclui: Content-Security-Policy completo (requer auditoria de todos os scripts/styles inline)
- Não inclui: Report-URI para CSP violations
- Não inclui: Permissions-Policy header
