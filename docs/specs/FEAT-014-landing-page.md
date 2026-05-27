# FEAT-014: Landing Page Pública para SEO

**Issue:** #129 | **Priority:** P3 | **Created:** 2026-03-16 | **Status:** Draft

---

## Problem Statement

A rota `/` para usuários não autenticados renderiza o componente `Onboarding` — um seletor de tipo de usuário com botões de CTA. Não existe uma landing page com conteúdo SEO (hero section, features, social proof, FAQ, etc.). Sem conteúdo indexável, o Worki não aparecerá em buscas orgânicas.

---

## User Stories

| Persona | Ação desejada | Benefício concreto |
|---------|--------------|-------------------|
| Como visitante | quero ver uma landing page informativa ao acessar o Worki | para que eu entenda o que a plataforma oferece antes de me cadastrar |
| Como operador | quero conteúdo indexável pelo Google | para que o Worki apareça em buscas orgânicas |

---

## Acceptance Criteria

**AC-1 (landing page renderizada):** Quando um usuário não autenticado acessa `/`, então vê uma landing page com: hero section, lista de features, seção "Como funciona", e CTAs de cadastro.

**AC-2 (conteúdo SEO):** Quando a landing page é analisada, então contém 500+ palavras de conteúdo relevante para SEO (termos como "freelancer", "marketplace", "trabalho", "PIX", "plataforma").

**AC-3 (CTAs preservados):** Quando o usuário clica em "Cadastrar como Profissional" ou "Cadastrar como Empresa", então é direcionado para o fluxo de registro existente.

**AC-4 (design neo-brutalist):** Quando a landing page é exibida, então segue o padrão neo-brutalist do app (border-2 border-black, shadows, verde para workers, azul para companies).

---

## Technical Design

### Data Access Tier
**Selected tier:** N/A — componente estático
**Rationale:** Landing page é conteúdo estático, sem data fetching.

### Components

**New files to create:**
| File Path | Type | Responsibility |
|-----------|------|---------------|
| `frontend/src/pages/LandingPage.tsx` | Page | Landing page com hero, features, como funciona, CTAs |

**Existing files to modify:**
| File Path | Current Behavior | Change Required |
|-----------|-----------------|-----------------|
| `frontend/src/App.tsx` | Rota `/` renderiza `Onboarding` para não autenticados | Mudar para renderizar `LandingPage` para não autenticados |

### Edge Functions
None.

### Database Changes
Nenhuma.

### State & Data Flow
Componente estático, sem state management. Links de CTA usam `useNavigate()` para direcionar ao fluxo de login/signup.

### UI / Interaction Notes
- **Loading state:** N/A — conteúdo estático
- **Empty state:** N/A
- **Error state:** N/A
- **Responsive:** Layout responsivo com hero full-width, grid de features 1-col no mobile / 3-cols no desktop
- **Design pattern:** Neo-brutalist com verde (#00A651) e azul (#2563EB), `border-2 border-black`, shadows

---

## Task Breakdown

| Task | Deliverable (what done looks like) | Estimate | Depends On |
|------|------------------------------------|----------|-----------|
| T1 | `LandingPage.tsx` criada com hero section, features grid, seção "Como funciona", CTAs. 500+ palavras de conteúdo em português. Design neo-brutalist. | 3h | — |
| T2 | `App.tsx` modificado para renderizar `LandingPage` na rota `/` para não autenticados. Build e lint passam. | 1h | T1 |

**Total estimate:** 4h

**Deployment note:** Sem deploy adicional necessário.

---

## Out of Scope (v1)

- Não inclui: FAQ section
- Não inclui: Social proof / depoimentos
- Não inclui: Animações de scroll
- Não inclui: Blog / conteúdo dinâmico
- Não inclui: Onboarding page refactor (mantida como rota separada se necessário)
