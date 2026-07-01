---
name: project-dashboard-analitico-removido
description: Dashboard analítico do desktop foi removido; MIA é a entrada universal no desktop; /dashboard só existe como home mobile/tablet
metadata: 
  node_type: memory
  type: project
  originSessionId: 851f4ad9-4488-495e-a916-bf38b6f10774
---

Em 2026-06-03 (commit `a6a314b3` em stg) o dashboard analítico foi removido por completo — era a aba mais visitada porém ninguém usava, e dezenas de botões "voltar"/refresh despejavam todos nela.

**Regra de roteamento (NÃO reintroduzir):**
- **Desktop**: nunca cair em `/dashboard`. `Dashboard.page.tsx` redireciona desktop → `/mia` (`<Navigate to="/mia" replace />`). MIA é a entrada universal do desktop. `RootRedirect`/`Auth` já mandam desktop→/mia. Esse redirect resolve sozinho os 15+ `navigate('/dashboard')` espalhados (não editar call-sites).
- **Mobile/tablet**: `/dashboard` continua sendo a HOME (`MobileHome`/`TabletHome`, grade de atalhos) — é por onde o operador navega o app no celular. Intacta.
- `useIsMobile()` ≡ `useDeviceMode() !== 'desktop'` (true p/ mobile+tablet). Entrada de menu sidebar "Início" (`/dashboard`, antes "Dashboard Geral", ícone Home) fica oculta no desktop via `!isMobile`.

**Deletados**: `DashboardAnalytics.page.tsx` + ~25 componentes/charts/listas exclusivos do analítico + testes co-located + `src/app/router.tsx` (roteador morto; o vivo é `src/App.tsx`).

Alinha com [[mia_navigator_architecture]], [[mia_modo_ia_button_layout]] e [[mia_glass_box_architecture]] (MIA como entrada/navegadora do ERP).
