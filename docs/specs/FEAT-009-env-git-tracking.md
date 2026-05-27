# FEAT-009: Remover .env do Git Tracking

**Issue:** #124 | **Priority:** P2 | **Created:** 2026-03-16 | **Status:** Draft

---

## Problem Statement

O arquivo `frontend/.env` está rastreado no git (`git ls-files` mostra `frontend/.env`). Atualmente contém apenas chaves públicas (`VITE_SUPABASE_URL` e `VITE_SUPABASE_ANON_KEY`), mas o fato de estar no git cria risco de exposição acidental se alguém adicionar secrets ao arquivo no futuro. O `.gitignore` já lista `frontend/.env` mas o arquivo foi commitado antes.

---

## User Stories

| Persona | Ação desejada | Benefício concreto |
|---------|--------------|-------------------|
| Como desenvolvedor | quero que `.env` não seja rastreado pelo git | para que secrets adicionados acidentalmente não sejam expostos em commits |

---

## Acceptance Criteria

**AC-1 (removido do tracking):** Quando `git ls-files frontend/.env` é executado após a mudança, então retorna vazio.

**AC-2 (conteúdo preservado):** Quando o commit é feito, então o arquivo `.env` continua existindo localmente com o mesmo conteúdo.

**AC-3 (env.example existe):** Quando um novo desenvolvedor clona o repo, então encontra `frontend/.env.example` com as variáveis necessárias (sem valores sensíveis).

---

## Technical Design

### Data Access Tier
**Selected tier:** N/A — infraestrutura de repositório
**Rationale:** Mudança de configuração de git.

### Components

**New files to create:**
Nenhum (`.env.example` já deve existir).

**Existing files to modify:**
| File Path | Current Behavior | Change Required |
|-----------|-----------------|-----------------|
| `frontend/.env` | Rastreado pelo git | Executar `git rm --cached frontend/.env` |

### Edge Functions
None.

### Database Changes
Nenhuma.

### State & Data Flow
N/A.

### UI / Interaction Notes
N/A.

---

## Task Breakdown

| Task | Deliverable (what done looks like) | Estimate | Depends On |
|------|------------------------------------|----------|-----------|
| T1 | `git rm --cached frontend/.env` executado e commitado. `git ls-files frontend/.env` retorna vazio. `.env.example` verificado/criado se não existir. | 1h | — |

**Total estimate:** 1h

**Deployment note:** Sem deploy adicional necessário.

---

## Out of Scope (v1)

- Não inclui: Rotação das chaves expostas (são chaves públicas, sem risco)
- Não inclui: Setup de dotenv em CI/CD
