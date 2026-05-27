# FEAT-021: Fix npm undici Vulnerabilities

**Issue:** #179 | **Priority:** P2 | **Created:** 2026-03-17 | **Status:** Draft

---

## Problem Statement

`npm audit` reporta 5 vulnerabilidades high no pacote `undici` (7.0.0 - 7.23.0): WebSocket 64-bit length overflow, HTTP Request/Response Smuggling, Unbounded Memory in WebSocket, Unhandled Exception in WebSocket, e CRLF Injection via upgrade option. Fix disponível via `npm audit fix`.

---

## User Stories

| Persona | Ação desejada | Benefício concreto |
|---------|--------------|-------------------|
| Como desenvolvedor | quero que `npm audit` não reporte vulnerabilidades high | para que ferramentas de segurança não flagueiem o projeto |

---

## Acceptance Criteria

**AC-1 (audit limpo):** Quando rodar `cd frontend && npm audit --audit-level=high`, então 0 vulnerabilidades high são reportadas.

**AC-2 (build intacto):** Quando rodar `cd frontend && npm run build`, então o build passa com 0 erros.

**AC-3 (testes intactos):** Quando rodar `cd frontend && npm run test -- --run`, então todos os testes existentes passam.

---

## Technical Design

### Data Access Tier
**Selected tier:** N/A — alteração em dependências npm.
**Rationale:** Nenhum acesso a dados envolvido.

### Components

**New files to create:**
Nenhum.

**Existing files to modify:**
| File Path | Current Behavior | Change Required |
|-----------|-----------------|-----------------|
| `frontend/package-lock.json` | undici em versão vulnerável | Atualizar via `npm audit fix` |
| `frontend/package.json` | Possivelmente atualizar versão de dependência direta | Verificar se `npm audit fix` modifica |

### Edge Functions
None — dependências npm frontend.

### Database Changes
Nenhuma — usa schema existente.

### State & Data Flow
Sem mudança — apenas atualização de dependência transitiva.

### UI / Interaction Notes
- N/A — dependências npm

---

## Task Breakdown

| Task | Deliverable (what done looks like) | Estimate | Depends On |
|------|------------------------------------|----------|-----------|
| T1 | `npm audit fix` executado. `npm audit --audit-level=high` retorna 0 vulnerabilidades. Build e testes passam. | 1h | — |

**Total estimate:** 1h

**Deployment note:** Sem deploy adicional necessário.

---

## Out of Scope (v1)

- Não inclui: auditoria de dependências com vulnerabilidades moderate ou low
- Não inclui: migração para versão major de dependências
- Não inclui: adição de dependabot ou renovate
