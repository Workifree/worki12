# FEAT-013: Adicionar og:image para Preview Social

**Issue:** #128 | **Priority:** P3 | **Created:** 2026-03-16 | **Status:** Draft

---

## Problem Statement

O `index.html` tem tags `og:title`, `og:description`, `og:type` e `og:locale`, mas não possui `og:image`. Quando o link do Worki é compartilhado no WhatsApp, Instagram, LinkedIn ou Twitter, o preview mostra texto sem imagem. No mercado brasileiro, WhatsApp é o principal canal de distribuição — um link sem preview visual tem taxa de clique significativamente menor.

---

## User Stories

| Persona | Ação desejada | Benefício concreto |
|---------|--------------|-------------------|
| Como operador | quero que compartilhamentos no WhatsApp tenham imagem de preview | para que a taxa de clique em links compartilhados aumente |

---

## Acceptance Criteria

**AC-1 (meta tag):** Quando o `index.html` é inspecionado, então contém `<meta property="og:image" content="{URL_DA_IMAGEM}" />`.

**AC-2 (dimensões):** Quando a imagem OG é verificada, então tem dimensões 1200x630px (padrão Open Graph).

**AC-3 (PageMeta override):** Quando o componente `PageMeta` é usado em uma página específica, então permite override da `og:image` via prop.

**AC-4 (imagem existe):** Quando a URL da imagem OG é acessada, então a imagem carrega corretamente (arquivo presente em `frontend/public/`).

---

## Technical Design

### Data Access Tier
**Selected tier:** N/A — assets estáticos e meta tags
**Rationale:** Apenas HTML e imagem estática.

### Components

**New files to create:**
| File Path | Type | Responsibility |
|-----------|------|---------------|
| `frontend/public/og-image.png` | Asset | Imagem 1200x630px para preview social |

**Existing files to modify:**
| File Path | Current Behavior | Change Required |
|-----------|-----------------|-----------------|
| `frontend/index.html` | Sem `og:image` | Adicionar `<meta property="og:image" content="/og-image.png" />` |
| `frontend/src/components/PageMeta.tsx` | Não suporta `og:image` override | Adicionar prop `ogImage?: string` e renderizar meta tag correspondente |

### Edge Functions
None.

### Database Changes
Nenhuma.

### State & Data Flow
N/A — meta tags estáticas e componente PageMeta.

### UI / Interaction Notes
- **Loading state:** N/A
- **Empty state:** N/A
- **Error state:** N/A
- **Responsive:** N/A

---

## Task Breakdown

| Task | Deliverable (what done looks like) | Estimate | Depends On |
|------|------------------------------------|----------|-----------|
| T1 | Imagem OG (1200x630px) criada em `frontend/public/og-image.png`. Meta tag `og:image` adicionada ao `index.html`. Prop `ogImage` adicionada ao `PageMeta.tsx`. Build passa. | 2h | — |

**Total estimate:** 2h

**Deployment note:** Sem deploy adicional necessário. Imagem servida estaticamente pelo Vite.

---

## Out of Scope (v1)

- Não inclui: og:image dinâmica por página (ex: imagem do perfil do worker)
- Não inclui: Twitter Card meta tags
- Não inclui: og:image para cada página individual
