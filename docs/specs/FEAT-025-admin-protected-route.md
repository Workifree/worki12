# FEAT-025: Move Admin Route Inside ProtectedRoute

**Issue:** #183 | **Priority:** P3 | **Created:** 2026-03-17 | **Status:** Draft

---

## Problem Statement

A rota `/admin` em `App.tsx:128` está fora do bloco `<ProtectedRoute>`, tornando-a acessível como rota pública. O componente Admin.tsx faz sua própria verificação de auth e email, o que funciona corretamente, mas expõe o formulário de login admin a todos os visitantes. Mover para dentro de ProtectedRoute esconderia o formulário de quem não está autenticado.

---

## User Stories

| Persona | Ação desejada | Benefício concreto |
|---------|--------------|-------------------|
| Como admin | quero que o formulário admin não seja visível para visitantes anônimos | para que a superfície de ataque seja reduzida |
| Como desenvolvedor | quero que a rota admin siga o mesmo padrão de autenticação | para que haja consistência no código |

---

## Acceptance Criteria

**AC-1 (não autenticado):** Quando um usuário não autenticado acessa `/admin`, então é redirecionado para `/login`.

**AC-2 (não admin):** Quando um usuário autenticado que NÃO é admin acessa `/admin`, então vê mensagem `"Acesso negado"` ou é redirecionado.

**AC-3 (admin funcional):** Quando um admin autenticado acessa `/admin`, então vê o painel normalmente.

---

## Technical Design

### Data Access Tier
**Selected tier:** Direct Supabase client
**Rationale:** Modificação de roteamento em App.tsx e verificação de auth no componente Admin.tsx.

### Components

**New files to create:**
Nenhum.

**Existing files to modify:**
| File Path | Current Behavior | Change Required |
|-----------|-----------------|-----------------|
| `frontend/src/App.tsx` | Linha 128: `<Route path="/admin" element={<Admin />} />` está fora de `<ProtectedRoute>` | Mover a rota para dentro do bloco `<ProtectedRoute>` |
| `frontend/src/pages/Admin.tsx` | Faz verificação própria de auth + email | Simplificar: remover auth check redundante (ProtectedRoute já garante autenticação). Manter apenas verificação de email admin para mostrar "Acesso negado" |

### Edge Functions
None — uses direct Supabase client.

### Database Changes
Nenhuma — usa schema existente.

### State & Data Flow
Sem mudança significativa. A rota `/admin` passa a ser protegida por `ProtectedRoute` que verifica autenticação. O componente `Admin.tsx` continua verificando se o email é admin — mas agora só precisa dessa verificação porque auth já está garantido.

### UI / Interaction Notes
- **Loading state:** ProtectedRoute já tem loading state
- **Empty state:** N/A
- **Error state:** Usuário não admin vê `"Acesso negado"` com botão para voltar
- **Responsive:** Sem mudança
- **Design pattern:** Segue padrão existente de ProtectedRoute

---

## Task Breakdown

| Task | Deliverable (what done looks like) | Estimate | Depends On |
|------|------------------------------------|----------|-----------|
| T1 | `App.tsx` modificado: rota `/admin` dentro de `<ProtectedRoute>`. `Admin.tsx` modificado: auth check simplificado. Usuário não autenticado redirecionado para login. Build passa. | 1h | — |

**Total estimate:** 1h

**Deployment note:** Sem deploy adicional necessário.

---

## Out of Scope (v1)

- Não inclui: AdminRoute component dedicado
- Não inclui: role-based routing middleware
- Não inclui: admin-specific layout
