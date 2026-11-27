-- =============================================================================
-- teardown-demo.sql — remove TUDO do demo e nada alem.
--
-- Rodar:  npx supabase db query --remote=vrklakcbkcsonarmhqhp --yes -f scripts/demo/teardown-demo.sql
--
-- Escopo: somente linhas ligadas a IDs deterministas do demo (md5('worki-demo:...')) ou a usuarios com
-- e-mail @demo.worki.test. Duas transacoes:
--   1) dados publicos (triggers desligados, so para nao gerar efeito externo ao apagar);
--   2) auth.users (com triggers/FKs NORMAIS, para o CASCADE limpar identities/sessoes/tokens;
--      o guard LGPD so deixa passar porque os perfis ja foram removidos na etapa 1).
-- =============================================================================
BEGIN;

-- Desliga TODOS os triggers de usuario nesta transacao (SET LOCAL: some no COMMIT/ROLLBACK).
-- Motivo: triggers do Worki emitem notificacoes, notice_outbox (e-mail/push), live signals e
-- stamps de bonus; handle_new_user criaria casca de empresa/freela vazia. Com replica, NADA disso
-- dispara e o seed grava exatamente o que escrevemos aqui. Efeito colateral: FKs tambem nao sao
-- checadas, entao toda ordem/limpeza abaixo e explicita.
SET LOCAL session_replication_role = replica;

DO $guard$
BEGIN
  IF current_setting('session_replication_role') <> 'replica' THEN
    RAISE EXCEPTION 'ABORTADO: triggers nao foram desligados (session_replication_role=%)',
      current_setting('session_replication_role');
  END IF;
END
$guard$;

-- Helpers temporarios (somem com a sessao).
-- d(k): uuid determinista do demo. Mesma chave => mesmo id em toda execucao (idempotencia).
CREATE FUNCTION pg_temp.d(k text) RETURNS uuid LANGUAGE sql IMMUTABLE AS
$f$ SELECT md5('worki-demo:' || k)::uuid $f$;

-- ---------------------------------------------------------------------------
-- LIMPEZA DOS DADOS PUBLICOS DO DEMO (identica em seed-demo.sql e teardown-demo.sql)
-- Tudo e filtrado por IDs deterministas do demo (pg_temp.d('...')) ou por e-mail
-- @demo.worki.test. Nenhuma linha que nao seja do demo e tocada.
-- ---------------------------------------------------------------------------
CREATE TEMP TABLE _du ON COMMIT DROP AS
  SELECT id FROM auth.users WHERE email LIKE '%@demo.worki.test'
  UNION SELECT pg_temp.d('company')
  UNION SELECT pg_temp.d('company-b')
  UNION SELECT pg_temp.d('u:' || x) FROM unnest(ARRAY['gestor2','enc.centro','enc.norte','enc.eventos','enc.aguardando','enc.removido']) x
  UNION SELECT pg_temp.d('w:' || g) FROM generate_series(1, 25) g;

CREATE TEMP TABLE _dc ON COMMIT DROP AS
  SELECT pg_temp.d('company') AS id UNION SELECT pg_temp.d('company-b');

CREATE TEMP TABLE _dj ON COMMIT DROP AS
  SELECT id FROM public.jobs WHERE company_id IN (SELECT id FROM _dc);

CREATE TEMP TABLE _da ON COMMIT DROP AS
  SELECT id FROM public.applications
   WHERE job_id IN (SELECT id FROM _dj) OR worker_id IN (SELECT id FROM _du);

DELETE FROM public."Message"
 WHERE conversationid IN (SELECT id FROM public."Conversation" WHERE application_uuid IN (SELECT id FROM _da));
DELETE FROM public."Conversation" WHERE application_uuid IN (SELECT id FROM _da);
DELETE FROM public.presence_checks
 WHERE application_id IN (SELECT id FROM _da) OR job_id IN (SELECT id FROM _dj) OR worker_id IN (SELECT id FROM _du);
DELETE FROM public.shift_attendance_confirmations
 WHERE application_id IN (SELECT id FROM _da) OR job_id IN (SELECT id FROM _dj) OR worker_id IN (SELECT id FROM _du);
DELETE FROM public.service_terms
 WHERE company_id IN (SELECT id FROM _dc) OR worker_id IN (SELECT id FROM _du) OR job_id IN (SELECT id FROM _dj);
DELETE FROM public.shift_payments
 WHERE company_id IN (SELECT id FROM _dc) OR worker_id IN (SELECT id FROM _du) OR job_id IN (SELECT id FROM _dj);
DELETE FROM public.payment_sheet_exports WHERE company_id IN (SELECT id FROM _dc);
DELETE FROM public.shift_call_targets
 WHERE call_id IN (SELECT id FROM public.shift_calls WHERE company_id IN (SELECT id FROM _dc) OR job_id IN (SELECT id FROM _dj))
    OR worker_id IN (SELECT id FROM _du);
DELETE FROM public.shift_calls WHERE company_id IN (SELECT id FROM _dc) OR job_id IN (SELECT id FROM _dj);
DELETE FROM public.job_cancellations WHERE company_id IN (SELECT id FROM _dc) OR job_id IN (SELECT id FROM _dj);
DELETE FROM public.job_live_signals WHERE company_id IN (SELECT id FROM _dc) OR job_id IN (SELECT id FROM _dj);
DELETE FROM public.reviews
 WHERE job_id IN (SELECT id FROM _dj) OR reviewer_id IN (SELECT id FROM _du) OR reviewed_id IN (SELECT id FROM _du);
DELETE FROM public.applications WHERE id IN (SELECT id FROM _da);
DELETE FROM public.jobs WHERE id IN (SELECT id FROM _dj);
DELETE FROM public.job_series WHERE company_id IN (SELECT id FROM _dc);
DELETE FROM public.shift_templates WHERE company_id IN (SELECT id FROM _dc);
DELETE FROM public.team_list_members
 WHERE list_id IN (SELECT id FROM public.team_lists WHERE company_id IN (SELECT id FROM _dc));
DELETE FROM public.team_lists WHERE company_id IN (SELECT id FROM _dc);
DELETE FROM public.worker_referrals
 WHERE worker_id IN (SELECT id FROM _du)
    OR referring_company_id IN (SELECT id FROM _dc) OR requesting_company_id IN (SELECT id FROM _dc);
DELETE FROM public.team_connections WHERE company_id IN (SELECT id FROM _dc) OR worker_id IN (SELECT id FROM _du);
DELETE FROM public.worker_certifications
 WHERE worker_id IN (SELECT id FROM _du) OR verified_by_company_id IN (SELECT id FROM _dc);
DELETE FROM public.worker_trainings WHERE worker_id IN (SELECT id FROM _du) OR company_id IN (SELECT id FROM _dc);
DELETE FROM public.worker_company_badge_prefs
 WHERE worker_id IN (SELECT id FROM _du) OR company_id IN (SELECT id FROM _dc);
DELETE FROM public.responsibility_coverages WHERE company_id IN (SELECT id FROM _dc);
DELETE FROM public.company_members WHERE company_id IN (SELECT id FROM _dc);
DELETE FROM public.company_tags WHERE company_id IN (SELECT id FROM _dc);
DELETE FROM public.company_site_secrets
 WHERE site_id IN (SELECT id FROM public.company_sites WHERE company_id IN (SELECT id FROM _dc));
DELETE FROM public.company_sites WHERE company_id IN (SELECT id FROM _dc);
DELETE FROM public.company_spend_limits WHERE company_id IN (SELECT id FROM _dc);
DELETE FROM public.company_monthly_revenue WHERE company_id IN (SELECT id FROM _dc);
DELETE FROM public.company_invite_links WHERE company_id IN (SELECT id FROM _dc);

-- Linhas por usuario que o uso do demo (login, push, copiloto) pode ter criado.
DELETE FROM public.notifications WHERE user_id IN (SELECT id FROM _du);
DELETE FROM public.notice_deliveries
 WHERE outbox_id IN (SELECT id FROM public.notice_outbox WHERE recipient_id IN (SELECT id FROM _du));
DELETE FROM public.notice_outbox WHERE recipient_id IN (SELECT id FROM _du);
DELETE FROM public.notice_consents WHERE user_id IN (SELECT id FROM _du);
DELETE FROM public.notice_preferences WHERE user_id IN (SELECT id FROM _du);
DELETE FROM public.push_subscriptions WHERE user_id IN (SELECT id FROM _du);
DELETE FROM public.copilot_usage_daily WHERE user_id IN (SELECT id FROM _du);
DELETE FROM public.analytics_events WHERE user_id IN (SELECT id FROM _du);
DELETE FROM public.wallet_transactions
 WHERE wallet_id IN (SELECT id FROM public.wallets WHERE user_id IN (SELECT id FROM _du));
DELETE FROM public.wallets WHERE user_id IN (SELECT id FROM _du);

-- Organizacao e perfis.
DELETE FROM public.organization_members WHERE organization_id IN (pg_temp.d('org'), pg_temp.d('org-b'));
DELETE FROM public.companies WHERE id IN (SELECT id FROM _dc);
DELETE FROM public.organizations WHERE id IN (pg_temp.d('org'), pg_temp.d('org-b'));
DELETE FROM public.workers WHERE id IN (SELECT id FROM _du);

COMMIT;

-- Etapa 2: credenciais (sem replica: o CASCADE das FKs de auth precisa rodar).
BEGIN;
DELETE FROM auth.users
 WHERE email LIKE '%@demo.worki.test'
    OR id IN (
      SELECT pg_temp.d('company')
      UNION SELECT pg_temp.d('company-b')
      UNION SELECT pg_temp.d('u:' || x) FROM unnest(ARRAY['gestor2','enc.centro','enc.norte','enc.eventos','enc.aguardando','enc.removido']) x
      UNION SELECT pg_temp.d('w:' || g) FROM generate_series(1, 25) g);
COMMIT;

-- Conferencia: tudo deve ser 0.
SELECT
  (SELECT count(*) FROM auth.users WHERE email LIKE '%@demo.worki.test') AS usuarios_demo,
  (SELECT count(*) FROM public.companies WHERE id IN (pg_temp.d('company'), pg_temp.d('company-b'))) AS empresas_demo,
  (SELECT count(*) FROM public.jobs WHERE company_id = pg_temp.d('company')) AS turnos_demo;
