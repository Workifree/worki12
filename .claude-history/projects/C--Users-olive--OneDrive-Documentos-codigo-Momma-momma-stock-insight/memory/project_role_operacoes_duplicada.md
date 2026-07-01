---
name: Duas roles "operação" e "operações" — a plural tem permissions de admin por engano
description: Existem duas roles com nome quase idêntico no banco. "operações" (plural) tem acesso a TUDO (view_financeiro, view_notas_fiscais, view_torre_controle etc) — provavelmente erro de dados. "operação" (singular) é a correta/restrita.
type: project
originSessionId: 9f339aa2-0d65-4dd9-bea9-c7ace405d230
---
**Fato:** No banco (`user_roles` + `role_permissions` + `permissions`):
- `operação` (singular): permissões operacionais legítimas — view_mia, view_movimentacoes, view_producao_diaria, view_produtos, view_pronta_entrega, view_verificacao_perdas, view_visualizacao_estoque. Não tem financeiro.
- `operações` (plural): tem praticamente todas as permissões — view_financeiro, view_notas_fiscais, view_torre_controle, view_configuracoes, etc. Perfil de admin disfarçado.

**Why:** Quando o CTO reportou que "MIA responde financeiro pra não-admin", o código RBAC (`canAccessDomain` + `getAccessDeniedMessage` em `supabase/functions/mia/index.ts`) estava correto. A causa raiz é que usuários com role `operações` têm `view_financeiro` por configuração de permissions — não é bug de código. Reportado em 2026-04-14.

**How to apply:**
- Se reaparecer o sintoma "MIA mostrou finance a quem não devia", checar primeiro o role da pessoa + as permissions da role no banco. Não assumir que é bug de código.
- Decisão pendente do CTO: (a) limpar permissions da role `operações`, (b) deletar a role duplicada e migrar usuários para `operação`, ou (c) renomear `operações` para algo explícito tipo `supervisor`.
- Query pra auditar: `SELECT r.name, array_agg(p.name ORDER BY p.name) FROM user_roles r LEFT JOIN role_permissions rp ON rp.role_id=r.id LEFT JOIN permissions p ON p.id=rp.permission_id GROUP BY r.name;`
