# FEAT-024: CompanyJobDetails Empty State for Candidates

**Issue:** #182 | **Priority:** P3 | **Created:** 2026-03-17 | **Status:** Draft

---

## Problem Statement

O componente `CompanyJobDetails.tsx` não possui tratamento explícito de empty state para quando uma vaga não tem candidatos. O usuário vê uma seção vazia sem mensagem orientadora, podendo pensar que a página não carregou. Outras páginas (Jobs, MyJobs, Wallet) já implementam empty states.

---

## User Stories

| Persona | Ação desejada | Benefício concreto |
|---------|--------------|-------------------|
| Como empresa | quero ver uma mensagem clara quando minha vaga não tem candidatos | para que eu saiba que a página carregou e ainda não há candidatos |

---

## Acceptance Criteria

**AC-1 (empty state):** Quando uma vaga não tem candidatos (candidates_count === 0), então a seção de candidatos exibe mensagem `"Nenhum candidato para esta vaga ainda."`.

**AC-2 (design neo-brutalist):** Dado que a mensagem de empty state é exibida, quando visualizada, então segue o padrão visual neo-brutalist com text-gray-500, padding adequado, e ícone Users.

**AC-3 (com candidatos):** Dado que uma vaga tem candidatos (candidates_count > 0), quando visualizada, então o botão de candidatos funciona normalmente sem a mensagem de empty state.

---

## Technical Design

### Data Access Tier
**Selected tier:** Direct Supabase client
**Rationale:** O componente já faz fetch de candidates_count via `supabase.from('applications')`.

### Components

**New files to create:**
Nenhum.

**Existing files to modify:**
| File Path | Current Behavior | Change Required |
|-----------|-----------------|-----------------|
| `frontend/src/pages/company/CompanyJobDetails.tsx` | Mostra count de candidatos mas não tem empty state quando count é 0 | Adicionar texto de empty state `"Nenhum candidato para esta vaga ainda."` quando `candidates_count === 0` na seção de Performance |

### Edge Functions
None — uses direct Supabase client.

### Database Changes
Nenhuma — usa schema existente.

### State & Data Flow
Sem mudança no data flow. Apenas adição de renderização condicional quando `job.candidates_count === 0`.

### UI / Interaction Notes
- **Loading state:** Sem mudança — já tem skeleton
- **Empty state:** `"Nenhum candidato para esta vaga ainda."` com text-gray-500, ícone Users, padding adequado
- **Error state:** Sem mudança
- **Responsive:** Sem mudança
- **Design pattern:** Segue padrão neo-brutalist — text-gray-500, font-medium

---

## Task Breakdown

| Task | Deliverable (what done looks like) | Estimate | Depends On |
|------|------------------------------------|----------|-----------|
| T1 | `CompanyJobDetails.tsx` modificado com empty state para candidatos. Mensagem em português visível quando candidates_count = 0. Build passa. | 1h | — |

**Total estimate:** 1h

**Deployment note:** Sem deploy adicional necessário.

---

## Out of Scope (v1)

- Não inclui: CTA para compartilhar vaga quando não tem candidatos
- Não inclui: sugestões de como atrair candidatos
- Não inclui: empty state para outras seções da página
