# FEAT-003: Remover Edge Functions Legadas (Prisma)

> ✅ **CONCLUÍDA em 25/08/2026.** As três funções foram removidas de produção
> (`supabase functions delete`) e respondem `404` — conferido por requisição. Produção ficou com
> quatro funções: `admin-data`, `send-notification`, `delete-account`, `expire-invites`.
> Os fontes estão preservados em `supabase/functions/_orfaos-pre-pivo/` para tornar a remoção
> reversível. Achado durante a verificação, que o texto abaixo não previa: `applications-api`
> escrevia em `Conversation`, a tabela do **chat vivo** — não era só resquício inerte.


**Issue:** #118 | **Priority:** P1 | **Created:** 2026-03-16 | **Status:** Draft

---

## Problem Statement

Três edge functions legadas (`jobs-api`, `profiles-api`, `applications-api`) referenciam tabelas do schema Prisma antigo que não existem no banco atual. O frontend usa chamadas diretas ao Supabase client. Estas funções são resquícios da migração Prisma → Supabase direto, aumentam a superfície de ataque e confundem desenvolvedores.

---

## User Stories

| Persona | Ação desejada | Benefício concreto |
|---------|--------------|-------------------|
| Como desenvolvedor | quero que apenas edge functions ativas existam no repositório | para que não haja confusão sobre qual API usar |
| Como operador | quero reduzir a superfície de ataque removendo endpoints desnecessários | para que atacantes não possam explorar funções abandonadas |

---

## Acceptance Criteria

**AC-1 (não usadas):** Quando o código frontend é auditado via grep, então nenhuma página ou componente referencia `jobs-api`, `profiles-api` ou `applications-api`.

**AC-2 (removidas do repo):** Quando os diretórios são removidos, então `supabase/functions/jobs-api/`, `supabase/functions/profiles-api/`, e `supabase/functions/applications-api/` não existem mais no repositório.

**AC-3 (build passa):** Quando `npm run build` é executado após a remoção, então compila sem erros (confirmando que nenhum código depende dessas funções).

---

## Technical Design

### Data Access Tier
**Selected tier:** N/A — remoção de código morto
**Rationale:** Nenhuma nova funcionalidade, apenas limpeza.

### Components

**New files to create:**
Nenhum.

**Existing files to modify:**
| File Path | Current Behavior | Change Required |
|-----------|-----------------|-----------------|
| `supabase/functions/jobs-api/` | Diretório com edge function legada | Remover diretório inteiro |
| `supabase/functions/profiles-api/` | Diretório com edge function legada | Remover diretório inteiro |
| `supabase/functions/applications-api/` | Diretório com edge function legada | Remover diretório inteiro |

### Edge Functions
Nenhuma nova — apenas remoção.

### Database Changes
Nenhuma — usa schema existente.

### State & Data Flow
Sem mudança. As funções não são chamadas por nenhum código ativo.

### UI / Interaction Notes
N/A — sem mudanças de UI.

---

## Task Breakdown

| Task | Deliverable (what done looks like) | Estimate | Depends On |
|------|------------------------------------|----------|-----------|
| T1 | Diretórios `jobs-api/`, `profiles-api/`, `applications-api/` removidos de `supabase/functions/`. Grep confirma que frontend não referencia essas funções. Build passa. | 1h | — |

**Total estimate:** 1h

**Deployment note:** Após merge, executar `supabase functions delete jobs-api`, `supabase functions delete profiles-api`, `supabase functions delete applications-api` no projeto Supabase para undeploy.

---

## Out of Scope (v1)

- Não inclui: Migrar funcionalidades das funções legadas (já existem no frontend via Supabase client direto)
- Não inclui: Undeploy automático (deve ser feito manualmente via CLI)
