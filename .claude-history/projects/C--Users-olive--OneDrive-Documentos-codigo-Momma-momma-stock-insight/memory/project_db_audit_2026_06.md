---
name: project_db_audit_2026_06
description: Auditoria SOTA do banco Supabase em 2026-06-03 — o que foi corrigido e o que ficou pendente
metadata: 
  node_type: memory
  type: project
  originSessionId: 12ffc608-7d79-4597-bf81-37eef882f6a0
---

Auditoria world-class do DB Supabase (`jaumyfyeueayibbxunxc`) em **2026-06-03**. Banco: 219 tabelas, 280 funções, era 442 MB.

**Aplicado (migrations 20260603151200 → 20260603151905 em stg, commit 3af2006e):**
- **Onda 1 (segurança P0):** ~45 policies estavam `FOR ALL TO public USING(true)` = role anon (chave pública) tinha leitura+escrita em `estoque`, `movimentacoes`, `produtos`, `usuarios`, `user_admins` (escalonamento!), `cofre_transferencias`, leitura em `notas_fiscais`/`itens_nota_fiscal`, etc. Corrigido via `ALTER POLICY ... TO authenticated` (zero mudança pra usuário logado). 4 policies liam `auth.user_metadata` (auto-admin) → trocadas por `is_admin_user()`/`mia_get_user_role()`. RLS habilitada em `estoque_audit_log` + 3 backups. Revogado EXECUTE de anon/PUBLIC em todas SECURITY DEFINER (re-grant authenticated/service_role).
- **Onda 2 (bloat):** `VACUUM FULL net._http_response` recuperou 140 MB (banco 442→300 MB). `cron.job_run_details` tem 106k linhas REAIS (não bloat) — retenção opcional pendente.
- **Onda 3 (perf):** removidos 11 índices duplicados + 1 constraint UNIQUE dup em `lotes`; criados 16 índices de FK em tabelas ≥500 linhas.

**Verificado pós-fix:** anon_true_policies=0, anon_secdef_fns=0, rls_off_tables=0.

**Onda 4 CONCLUÍDA (2026-06-03, commits a37f93b7, 2998c302, 542eaa2d em stg):**
- 6 funções/procedures one-off dropadas (`DROP ROUTINE` — uma era procedure).
- 3 tabelas `backup_reset_fab_20260529_*` movidas pro schema privado `archive` (lossless, fora da API/types; `DROP SCHEMA archive CASCADE` pra apagar de vez).
- Módulo driver-tracking removido por completo: 7 tabelas dropadas + 4 arquivos deletados (`useRealTimeTracking`, `useTripTimer` + testes).
- `codigo_barras` removida: coluna de produtos/produtos_master/embalagens, 3 views recriadas sem ela, frontend limpo (7 arquivos), types.ts regenerado. (1 valor solto perdido — Momma não usa.)
- Verificado: `tsc --noEmit` + `npm run build` verdes.

**Onda 5 CONCLUÍDA (2026-06-03) — PLACAR FINAL: 0 ERROS nos 2 advisors** (começou com 13 ERRO segurança):
- Doc: **100% das 209 tabelas** + 228 colunas-chave (commit 3d1f019a).
- `auth_rls_initplan` zerado: 25 policies wrapped (3c0d559e).
- security_definer_view + matview_in_api resolvidos: 2 views→invoker, 3 views mortas dropadas, 3 matviews fora da API (5e65c876).
- ~77 policies redundantes de service_role removidas (b19f3203).
- function_search_path_mutable zerado: 12 funções fixadas + types.ts regenerado (80291c0c).

**WARN restantes = INTENCIONAIS/aceitos (NÃO bugs) — documentado pro futuro técnico:**
- `rls_policy_always_true` (102) + `authenticated_security_definer_function_executable` (167): DESIGN de ERP interno (funcionários logados operam o sistema via RPC). Já sem exposição anon. Tightening = projeto de RBAC futuro, não bug. EXCEÇÃO: gatear admin nas sensíveis (`get_all_users_with_roles`, `execute_readonly_query`, `set_config`) numa futura passada de segurança.
- `multiple_permissive_policies` (237→72 grupos): padrão "read amplo + write gated" intencional; consolidar = redesign de RLS com risco, baixo ganho (tabelas pequenas). Deixado como está.

**PENDENTE (opcional / decisão do user / painel):**
- **Push:** FEITO — todos os commits da auditoria pushados pra origin/stg (último 3f091466, 2026-06-03). DB já aplicado no Supabase remoto.
- **Revisão de regressão em produção: PASSOU** (app + edge lidos contra todas as mudanças). Verdito: nada quebra pra quem está usando. Provas: (A) tudo que toca tabelas endurecidas está atrás de login; (B) edge fns usam service_role/self-filter; (C) objetos dropados sem ref viva; (E) views recriadas compatíveis. Achado D corrigido (commit 3f091466): `/mia/outcomes` → adminOnly (era ProtectedRoute) + removido `codigo_barras` do select morto em `supabase/functions/mia/tools.ts`. Confirmado: `lotes` mantém UNIQUE(produto_id,codigo) via uq_lotes_produto_codigo (scanner ok); `is_admin_user` reconhece admins via profiles.role_id (NÃO dropar user_role_assignments).
- **~20 tabelas vazias SEM ref** (scaffolding) candidatas a drop — só com OK do user (podem ser features planejadas). 5 "vazias" são wired em funções e NÃO podem sair (employee_history, user_role_assignments→is_admin_user, user_stores, subscriptions, active_review_sessions).
- **Config painel (só user):** upgrade Postgres 17.4, OTP <1h, leaked-password ON, auth connection %.
- **public_bucket_allows_listing** (4 buckets storage) — avaliar tornar privado documentos/perdas.
- INFO aceitos: 237 unused_index (inclui 16 FK novos sem scan — NÃO dropar), 90 unindexed FK (tabelas pequenas), 3 archive sem PK (intencional), rls_enabled_no_policy (tabelas service-only fail-closed = correto).
- Alto risco/baixo valor: mover pg_trgm/unaccent do public; migration placeholder 99999999999999.

Reversão Onda 1: `ALTER POLICY ... TO public`.
