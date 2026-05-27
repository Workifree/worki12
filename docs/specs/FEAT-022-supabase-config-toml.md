# FEAT-022: Supabase Config TOML

**Issue:** #180 | **Priority:** P2 | **Created:** 2026-03-17 | **Status:** Draft

---

## Problem Statement

O diretório `supabase/` contém `functions/` e `migrations/` mas não possui `config.toml`. Este arquivo define configurações do projeto como auth settings, storage, realtime e rate limits. Sem ele no repositório, recriar o ambiente é mais difícil e configurações ficam apenas no dashboard, com risco de drift entre ambientes.

---

## User Stories

| Persona | Ação desejada | Benefício concreto |
|---------|--------------|-------------------|
| Como desenvolvedor | quero que as configurações do Supabase estejam versionadas | para que eu possa recriar o ambiente facilmente |
| Como DevOps | quero documentação das configurações do projeto | para que não haja drift entre staging e produção |

---

## Acceptance Criteria

**AC-1 (arquivo existe):** Quando o arquivo `supabase/config.toml` existe no repositório, então contém as seções: `[project]`, `[auth]`, `[storage]`, `[realtime]`.

**AC-2 (documentação):** Dado que o config.toml está criado, quando lido, então documenta as configurações necessárias para replicar o ambiente (project ref, auth settings, etc).

**AC-3 (sem secrets):** Quando o config.toml é inspecionado, então NÃO contém passwords, API keys, service_role keys, ou qualquer segredo.

**AC-4 (build intacto):** Quando rodar `cd frontend && npm run build`, então o build passa com 0 erros.

---

## Technical Design

### Data Access Tier
**Selected tier:** N/A — arquivo de configuração.
**Rationale:** Nenhum acesso a dados envolvido.

### Components

**New files to create:**
| File Path | Type | Responsibility |
|-----------|------|---------------|
| `supabase/config.toml` | Config | Configuração versionada do projeto Supabase com seções para auth, storage, realtime |

**Existing files to modify:**
Nenhum.

### Edge Functions
None — arquivo de configuração.

### Database Changes
Nenhuma — usa schema existente.

### State & Data Flow
Sem mudança — arquivo de configuração estático.

### UI / Interaction Notes
- N/A — arquivo de infraestrutura

---

## Task Breakdown

| Task | Deliverable (what done looks like) | Estimate | Depends On |
|------|------------------------------------|----------|-----------|
| T1 | `supabase/config.toml` criado com configurações base do projeto. Sem secrets. Seções: project, auth, storage, realtime. | 1h | — |

**Total estimate:** 1h

**Deployment note:** Sem deploy adicional necessário.

---

## Out of Scope (v1)

- Não inclui: configuração de CI/CD com supabase CLI
- Não inclui: scripts de seed/reset de banco
- Não inclui: configuração de múltiplos ambientes (staging/production)
