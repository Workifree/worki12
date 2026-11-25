-- Auditoria e testes de caracterizacao: Trilha de bonus do operador (S1..S4)
-- File: supabase/tests/trilha_bonus_auditoria.sql
-- NAO e migration. Esta suite e SOMENTE LEITURA: pode rodar em QA ou producao depois de aplicar
-- 20261124000100..000400. A caracterizacao (que escreve) vive em supabase/tests/pglite-trilha/:
--   npx -y -p @electric-sql/pglite@0.6.0 node supabase/tests/pglite-trilha/run.mjs
--
-- RESULTADO REAL (25/11/2026, PGlite 0.6.0): harness com 72 ok e 0 falhas (portao negativo, anonymize_account
-- real + edicao de E1, S1..S4, cenarios com ataques A1/A2/M1/M4, esta auditoria, reaplicacao de S1..S4 e um
-- segundo banco com os hardenings 20261125000100/000200 e a sequencia real de escritas do app).
-- Nunca executada contra o banco do Supabase: o stub do PGlite nao tem as RLS, FKs e gatilhos reais
-- das tabelas existentes; a rodada em QA continua pendente.

-- ============================================================================
-- PARTE 1 — ESTRUTURA (read-only)
-- ============================================================================

-- 1.1 12 tabelas, RLS ligada, zero policy. esperado: 12 linhas, rls=true, policies=0.
SELECT c.relname, c.relrowsecurity AS rls,
       (SELECT count(*) FROM pg_policies p WHERE p.schemaname = 'public' AND p.tablename = c.relname) AS policies
  FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
 WHERE n.nspname = 'public' AND c.relkind = 'r' AND left(c.relname, 6) = 'bonus_'
 ORDER BY 1;

-- 1.2 [A36] anon/authenticated sem privilegio; service_role so SELECT. esperado: 0 linhas.
SELECT g.table_name, g.grantee, g.privilege_type
  FROM information_schema.role_table_grants g
 WHERE g.table_schema = 'public' AND left(g.table_name, 6) = 'bonus_'
   AND (g.grantee IN ('anon', 'authenticated') OR (g.grantee = 'service_role' AND g.privilege_type <> 'SELECT'));

-- 1.3 [A33] funcoes da trilha: matriz de EXECUTE.
--     esperado: anon = false em TODAS; authenticated = true SO em bonus_accept_enrollment,
--     bonus_get_my_trail, bonus_set_pix_key, bonus_request_payout, bonus_cancel_payout,
--     bonus_mark_celebrated e nas 7 funcoes de trigger (capture_job, capture_briefing, on_shift_payment e as 4 bonus_stamp_*,
--     exceto bonus_put_stamp, que e interna);
--     admin_bonus_*: so service_role.
SELECT p.proname,
       p.prosecdef AS definer,
       has_function_privilege('anon', p.oid, 'EXECUTE')          AS anon_exec,
       has_function_privilege('authenticated', p.oid, 'EXECUTE') AS auth_exec,
       has_function_privilege('service_role', p.oid, 'EXECUTE')  AS svc_exec,
       p.proconfig
  FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
 WHERE n.nspname = 'public' AND p.proname ~ '^(admin_)?bonus_'
 ORDER BY 1;

-- 1.4 [A35 / Article 8] nenhum corpo da trilha cita objeto de saldo (limite de palavra). esperado: 0 linhas.
SELECT p.proname FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
 WHERE n.nspname = 'public' AND p.proname ~ '^(admin_)?bonus_'
   AND pg_get_functiondef(p.oid) ~ '[[:<:]](wallets|escrow_transactions|wallet_transactions|update_wallet_balance|reserve_escrow|release_escrow|refund_escrow|credit_deposit)[[:>:]]';

-- 1.5 [A40] limiares: sem constante de negocio nas funcoes (revisao: os numeros de antifraude so
--     aparecem nos seeds/params e nos limites de VALIDACAO de admin_bonus_track_params_update).
SELECT t.key, t.status, t.cap_cents, t.params FROM public.bonus_tracks t ORDER BY 1;

-- 1.6 [seeds] 19 marcos no contador por trilha, soma = teto. esperado: no_contador = 19, total = 30000.
SELECT t.key,
       count(*) FILTER (WHERE m.counts_in_total) AS no_contador,
       sum(m.amount_cents)
         + COALESCE(sum((SELECT sum((x->>'amount_cents')::integer) FROM jsonb_array_elements(m.params->'tiers') x
                          WHERE (x->>'tier')::integer > 1)), 0) AS total
  FROM public.bonus_tracks t JOIN public.bonus_milestones m ON m.track_id = t.id
 GROUP BY t.key ORDER BY 1;

-- 1.7 [C9] desligado e sem inscricao em producao. esperado: enabled=false, 0.
SELECT s.enabled, (SELECT count(*) FROM public.bonus_enrollments) AS inscricoes FROM public.bonus_program_settings s;

-- 1.8 ganchos presentes (6 linhas).
SELECT tg.tgname, tg.tgrelid::regclass FROM pg_trigger tg
 WHERE tg.tgname IN ('trg_bonus_capture_job','trg_bonus_capture_briefing',
   'trg_bonus_0_stamp_application','trg_bonus_0_stamp_payment','trg_bonus_0_stamp_connection','trg_bonus_0_stamp_call');

-- ============================================================================
-- PARTE 2 — FUNCOES PURAS (read-only; rodar como postgres/service_role)
-- ============================================================================
-- 2.1 [C10] corte unico. esperado: todas as colunas = true.
SELECT public.bonus_next_payout_monday('2026-11-25 12:00-03') = DATE '2026-11-30' AS quarta,
       public.bonus_next_payout_monday('2026-11-27 23:59-03') = DATE '2026-11-30' AS sexta_antes_corte,
       public.bonus_next_payout_monday('2026-11-28 00:00-03') = DATE '2026-12-07' AS sabado_no_corte,
       public.bonus_next_payout_monday('2026-11-29 23:59-03') = DATE '2026-12-07' AS domingo,
       public.bonus_next_payout_monday('2026-11-30 00:01-03') = DATE '2026-12-07' AS segunda;

-- 2.2 [A8b] normalizacao de PIX/telefone. esperado: todas true.
SELECT public.bonus_normalize_pix('+55 (11) 98888-7777') = public.bonus_normalize_pix('11988887777') AS telefone_ddi,
       public.bonus_normalize_pix('123.456.789-09') = public.bonus_normalize_pix('12345678909')       AS cpf_mascara,
       public.bonus_normalize_pix(' Ana@Exemplo.com ') = 'ana@exemplo.com'                            AS email,
       public.bonus_normalize_pix('   ') IS NULL                                                      AS vazio;

