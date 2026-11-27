-- =============================================================================
-- seed-demo.sql — conta de DEMONSTRACAO da EMPRESA (Restaurante Demo Sabor & Cia)
--
-- Rodar:    npx supabase db query --remote=vrklakcbkcsonarmhqhp --yes -f scripts/demo/seed-demo.sql
-- Desfazer: scripts/demo/teardown-demo.sql        Leia scripts/demo/README.md antes.
--
-- IDEMPOTENTE: a primeira parte remove (so por IDs/e-mails de demo) o que um seed anterior criou e
-- recria tudo; usuarios de auth sao upsert (senha e confirmacao reaplicadas, sessoes preservadas).
-- UMA transacao: se qualquer passo falhar, nada e gravado.
-- SEM EFEITO EXTERNO: session_replication_role=replica desliga todos os triggers (notificacoes,
-- notice_outbox/e-mail/push, live signals, bonus, handle_new_user). Veja "Riscos" no README.
-- NAO toca em wallets/escrow (pagamento pelo Worki esta pausado; so modo A: shift_payments).
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
  UNION SELECT pg_temp.d('w:' || g) FROM generate_series(1, 32) g;

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

-- ===========================================================================
-- SEED DA CONTA DE DEMONSTRACAO — Restaurante Demo Sabor & Cia
-- Tudo marcado como demo: e-mails @demo.worki.test, CPF/CNPJ invalidos, PIX e telefones ficticios.
-- Datas sempre relativas a now() / hoje em America/Sao_Paulo.
-- ===========================================================================

-- Helpers do seed ------------------------------------------------------------
-- CPF ficticio 000.000.0NN-XX com o 1o digito verificador CORROMPIDO de proposito: nunca valida.
CREATE FUNCTION pg_temp.cpf_demo(i int) RETURNS text LANGUAGE plpgsql IMMUTABLE AS
$f$
DECLARE b text := '000000' || lpad(i::text, 3, '0'); s int := 0; k int; d1 int; d2 int;
BEGIN
  FOR k IN 1..9 LOOP s := s + substr(b, k, 1)::int * (11 - k); END LOOP;
  d1 := (11 - s % 11) % 11; IF d1 >= 10 THEN d1 := 0; END IF;
  s := 0;
  FOR k IN 1..9 LOOP s := s + substr(b, k, 1)::int * (12 - k); END LOOP;
  s := s + d1 * 2;
  d2 := (11 - s % 11) % 11; IF d2 >= 10 THEN d2 := 0; END IF;
  d1 := (d1 + 1) % 10;
  RETURN '000.000.' || substr(b, 7, 3) || '-' || d1::text || d2::text;
END
$f$;

-- 1) USUARIOS (auth) ---------------------------------------------------------
-- 32 freelas: 1..25 ativos no Elenco, 26..27 pendentes, 28 bloqueou (veto), 29..32 fora do Elenco (SOS / indicacao).
CREATE TEMP TABLE _w ON COMMIT DROP AS
SELECT g AS idx,
       pg_temp.d('w:' || g) AS id,
       (ARRAY['Beatriz Almeida Souza','Rafael Monteiro Lima','Camila Ferreira Dias','Thiago Barbosa Nunes',
              'Juliana Castro Ribeiro','Lucas Pereira Gomes','Fernanda Martins Rocha','Gustavo Henrique Teixeira',
              'Larissa Oliveira Campos','Matheus Carvalho Pinto','Aline Santos Freitas','Bruno Cardoso Araújo',
              'Patrícia Lopes Moreira','Vinícius Azevedo Costa','Daniela Ramos Barros','Felipe Nascimento Duarte',
              'Tatiane Correia Mendes','Henrique Batista Vieira','Priscila Andrade Melo','Rodrigo Siqueira Neves',
              'Carolina Guimarães Leal','Eduardo Machado Pires','Vanessa Cunha Borges','Leandro Farias Cordeiro',
              'Isabela Torres Medeiros','Mônica Reis Falcão','Caio Brandão Lacerda','Sérgio Azambuja Lopes',
              'Natasha Prado Quintela','Jefferson Amaral Duarte','Bianca Torres Cavalcante','Marcelo Dias Pimentel'])[g] AS full_name,
       (ARRAY['Garçom','Cozinheiro','Barman','Garçom','Atendente de Bar','Auxiliar de Cozinha','Recepcionista',
              'Segurança','Garçom','Copeiro','Auxiliar de Limpeza','Barman','Cozinheiro','Garçom','Recepcionista',
              'Segurança','Copeiro','Atendente de Bar','Garçom','Auxiliar de Limpeza','Garçom','Barman',
              'Auxiliar de Cozinha','Garçom','Recepcionista','Garçom','Auxiliar de Cozinha','Garçom',
              'Garçom','Garçom','Garçom','Garçom'])[g] AS role1,
       (ARRAY['Atendente de Bar','Auxiliar de Cozinha','Atendente de Bar','Barman','Garçom','Copeiro','Caixa',
              'Recepcionista','Caixa','Auxiliar de Cozinha','Copeiro','Garçom','Auxiliar de Cozinha','Atendente de Bar',
              'Caixa','Recepcionista','Auxiliar de Cozinha','Garçom','Caixa','Copeiro','Atendente de Bar',
              'Garçom','Cozinheiro','Barman','Caixa','Atendente de Bar','Copeiro','Barman',
              'Atendente de Bar','Barman','Recepcionista','Atendente de Bar'])[g] AS role2,
       CASE g WHEN 7 THEN 'Guarulhos' WHEN 15 THEN 'Guarulhos' WHEN 9 THEN 'Osasco' WHEN 20 THEN 'Osasco'
              WHEN 14 THEN 'Santo André' ELSE 'São Paulo' END AS city,
       CASE WHEN g = 1 THEN 'freela@demo.worki.test'
            ELSE 'freela.' || lpad(g::text, 2, '0') || '@demo.worki.test' END AS email
  FROM generate_series(1, 32) g;

CREATE TEMP TABLE _u ON COMMIT DROP AS
          SELECT 'gestor'::text AS k, pg_temp.d('company') AS id, 'gestor@demo.worki.test'::text AS email, 'hire'::text AS ut, 'Marcos Vinícius Prado'::text AS fn
UNION ALL SELECT 'gestor2', pg_temp.d('u:gestor2'), 'gestor2@demo.worki.test', 'hire', 'Renata Cavalcanti'
UNION ALL SELECT 'enc.centro', pg_temp.d('u:enc.centro'), 'enc.centro@demo.worki.test', 'hire', 'Diego Fonseca'
UNION ALL SELECT 'enc.norte', pg_temp.d('u:enc.norte'), 'enc.norte@demo.worki.test', 'hire', 'Simone Tavares'
UNION ALL SELECT 'enc.eventos', pg_temp.d('u:enc.eventos'), 'enc.eventos@demo.worki.test', 'hire', 'Wagner Rezende'
UNION ALL SELECT 'enc.aguardando', pg_temp.d('u:enc.aguardando'), 'enc.aguardando@demo.worki.test', 'hire', 'Letícia Moura'
UNION ALL SELECT 'enc.removido', pg_temp.d('u:enc.removido'), 'enc.removido@demo.worki.test', 'hire', 'Anderson Pacheco'
UNION ALL SELECT 'parceira', pg_temp.d('company-b'), 'parceira@demo.worki.test', 'hire', 'Carlos Eduardo Nogueira'
UNION ALL SELECT 'w' || idx, id, email, 'work', full_name FROM _w;

-- Upsert: nao apaga usuario existente (preserva sessoes); so garante senha/confirmacao/metadados.
-- Colunas *_token = '' (e nao NULL): GoTrue quebra o login com NULL nelas.
INSERT INTO auth.users AS au (
  instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
  confirmation_token, recovery_token, email_change_token_new, email_change,
  email_change_token_current, phone_change, phone_change_token, reauthentication_token)
SELECT '00000000-0000-0000-0000-000000000000', u.id, 'authenticated', 'authenticated', u.email,
       extensions.crypt('Demo#Worki2026', extensions.gen_salt('bf')), now(),
       '{"provider":"email","providers":["email"]}'::jsonb,
       jsonb_build_object('user_type', u.ut, 'full_name', u.fn, 'email_verified', true, 'demo', true),
       now() - interval '95 days', now(),
       '', '', '', '', '', '', '', ''
  FROM _u u
ON CONFLICT (id) DO UPDATE
   SET email = EXCLUDED.email,
       encrypted_password = EXCLUDED.encrypted_password,
       email_confirmed_at = COALESCE(au.email_confirmed_at, EXCLUDED.email_confirmed_at),
       raw_user_meta_data = EXCLUDED.raw_user_meta_data,
       banned_until = NULL,
       updated_at = now();

INSERT INTO auth.identities (provider_id, user_id, identity_data, provider, last_sign_in_at, created_at, updated_at)
SELECT u.id::text, u.id,
       jsonb_build_object('sub', u.id::text, 'email', u.email, 'email_verified', true, 'phone_verified', false),
       'email', now(), now() - interval '95 days', now()
  FROM _u u
ON CONFLICT (provider_id, provider) DO UPDATE
   SET identity_data = EXCLUDED.identity_data, updated_at = now();

-- 2) ORGANIZACAO, EMPRESA, EQUIPE ---------------------------------------------
INSERT INTO public.organizations (id, name, created_by, created_at, updated_at) VALUES
  (pg_temp.d('org'),   'Restaurante Demo Sabor & Cia', pg_temp.d('company'),   now() - interval '95 days', now()),
  (pg_temp.d('org-b'), 'Pizzaria Demo Parceira',       pg_temp.d('company-b'), now() - interval '95 days', now());

INSERT INTO public.organization_members (organization_id, user_id, role, status, accepted_at, created_by) VALUES
  (pg_temp.d('org'),   pg_temp.d('company'),   'owner', 'active', now() - interval '95 days', pg_temp.d('company')),
  (pg_temp.d('org-b'), pg_temp.d('company-b'), 'owner', 'active', now() - interval '95 days', pg_temp.d('company-b'));

INSERT INTO public.companies (
  id, name, cnpj, address, industry, size, description, website, email, logo_url, cover_url,
  onboarding_completed, created_at, owner_id, rating_average, reviews_count, company_type,
  accepted_tos, tos_version, tos_accepted_at, city, default_briefing,
  link_risk_alert_enabled, link_risk_alert_threshold, organization_id,
  default_presence_mode, default_site_id, default_qr_mode)
VALUES
 (pg_temp.d('company'), 'Restaurante Demo Sabor & Cia', '00.000.000/0001-00',
  'Rua Demo das Flores, 100 — Centro, São Paulo — SP', 'Restaurante', '11-50',
  'Restaurante de comida brasileira com três operações: salão no Centro, unidade Norte e eventos corporativos e de casamento. Conta de demonstração do Worki: todos os dados são fictícios.',
  'https://demo.worki.test', 'gestor@demo.worki.test',
  'data:image/svg+xml;utf8,<svg xmlns=''http://www.w3.org/2000/svg'' viewBox=''0 0 120 120''><rect width=''120'' height=''120'' rx=''24'' fill=''%232563EB''/><text x=''60'' y=''76'' font-size=''44'' font-weight=''900'' text-anchor=''middle'' fill=''white'' font-family=''Arial''>S%26C</text></svg>',
  'data:image/svg+xml;utf8,<svg xmlns=''http://www.w3.org/2000/svg'' viewBox=''0 0 1200 400''><rect width=''1200'' height=''400'' fill=''%23DBEAFE''/><rect y=''260'' width=''1200'' height=''140'' fill=''%232563EB''/><text x=''600'' y=''200'' font-size=''72'' font-weight=''900'' text-anchor=''middle'' fill=''%231E3A8A'' font-family=''Arial''>Sabor %26 Cia</text></svg>',
  true, now() - interval '95 days', pg_temp.d('company'), 4.80, 0, 'LIMITED',
  true, 'v1', now() - interval '94 days', 'São Paulo',
  'Camisa preta lisa, calça preta, sapato fechado antiderrapante, cabelo preso e barba feita. Chegar 15 minutos antes e se apresentar ao responsável do turno.',
  true, 2, pg_temp.d('org'), 'dual', pg_temp.d('site:0'), 'rotating'),
 (pg_temp.d('company-b'), 'Pizzaria Demo Parceira', '00.000.000/0002-00',
  'Av. Demo Paulista, 900 — Bela Vista, São Paulo — SP', 'Restaurante', '6-10',
  'Empresa parceira fictícia da demonstração (origem das indicações de freelas).', NULL, 'parceira@demo.worki.test',
  NULL, NULL, true, now() - interval '95 days', pg_temp.d('company-b'), 5.00, 0, 'LIMITED',
  true, 'v1', now() - interval '94 days', 'São Paulo', NULL, true, 2, pg_temp.d('org-b'), 'dual', NULL, 'rotating');

-- rotated_at DEPOIS da remocao do encarregado: some o aviso "gire o link do Elenco"
INSERT INTO public.company_invite_links (company_id, token, rotated_at) VALUES
  (pg_temp.d('company'), md5('worki-demo-link-1') || substr(md5('worki-demo-link-2'), 1, 16), now() - interval '10 days');

-- Lojas (etiquetas)
INSERT INTO public.company_tags (id, company_id, name, created_by, created_at) VALUES
  (pg_temp.d('tag:0'), pg_temp.d('company'), 'Loja Centro', pg_temp.d('company'), now() - interval '90 days'),
  (pg_temp.d('tag:1'), pg_temp.d('company'), 'Loja Norte',  pg_temp.d('company'), now() - interval '90 days'),
  (pg_temp.d('tag:2'), pg_temp.d('company'), 'Eventos',     pg_temp.d('company'), now() - interval '90 days');

-- Locais com GPS (company_sites) + segredo do QR
INSERT INTO public.company_sites (id, company_id, name, address_text, lat, lng, radius_m, created_by, created_at, updated_at) VALUES
  (pg_temp.d('site:0'), pg_temp.d('company'), 'Salão Centro',  'Rua Demo das Flores, 100 — Centro',        -23.550520, -46.633308, 150, pg_temp.d('company'), now() - interval '88 days', now()),
  (pg_temp.d('site:1'), pg_temp.d('company'), 'Unidade Norte', 'Av. Demo do Norte, 2500 — Santana',        -23.502100, -46.625900, 120, pg_temp.d('company'), now() - interval '88 days', now()),
  (pg_temp.d('site:2'), pg_temp.d('company'), 'Espaço Jardins (eventos)', 'Al. Fictícia, 450 — Jardins',   -23.561400, -46.655900, 200, pg_temp.d('company'), now() - interval '88 days', now());
INSERT INTO public.company_site_secrets (site_id) SELECT id FROM public.company_sites WHERE company_id = pg_temp.d('company');

-- Equipe: Gestor 2, 3 encarregados ativos (1 por loja), 1 aguardando confirmacao, 1 convite pendente, 1 removido.
INSERT INTO public.company_members (
  company_id, user_id, role, status, invited_email, invite_token, invited_at, expires_at, accepted_at,
  created_by, display_name, accepted_tos_at, confirmed_at, confirmed_by, accepted_email, removed_at,
  invite_token_hash, removed_by, default_tag_id)
VALUES
 (pg_temp.d('company'), pg_temp.d('u:gestor2'), 'manager', 'active', 'gestor2@demo.worki.test', NULL,
  now() - interval '60 days', now() - interval '46 days', now() - interval '59 days',
  pg_temp.d('company'), 'Renata Cavalcanti', now() - interval '59 days', now() - interval '59 days', pg_temp.d('company'),
  'gestor2@demo.worki.test', NULL, encode(extensions.digest('demo-gestor2', 'sha256'), 'hex'), NULL, NULL),
 (pg_temp.d('company'), pg_temp.d('u:enc.centro'), 'encarregado', 'active', 'enc.centro@demo.worki.test', NULL,
  now() - interval '58 days', now() - interval '44 days', now() - interval '57 days',
  pg_temp.d('company'), 'Diego Fonseca', now() - interval '57 days', now() - interval '57 days', pg_temp.d('company'),
  'enc.centro@demo.worki.test', NULL, encode(extensions.digest('demo-enc-centro', 'sha256'), 'hex'), NULL, pg_temp.d('tag:0')),
 (pg_temp.d('company'), pg_temp.d('u:enc.norte'), 'encarregado', 'active', 'enc.norte@demo.worki.test', NULL,
  now() - interval '56 days', now() - interval '42 days', now() - interval '55 days',
  pg_temp.d('company'), 'Simone Tavares', now() - interval '55 days', now() - interval '55 days', pg_temp.d('company'),
  'enc.norte@demo.worki.test', NULL, encode(extensions.digest('demo-enc-norte', 'sha256'), 'hex'), NULL, pg_temp.d('tag:1')),
 (pg_temp.d('company'), pg_temp.d('u:enc.eventos'), 'encarregado', 'active', 'enc.eventos@demo.worki.test', NULL,
  now() - interval '50 days', now() - interval '36 days', now() - interval '49 days',
  pg_temp.d('company'), 'Wagner Rezende', now() - interval '49 days', now() - interval '49 days', pg_temp.d('company'),
  'enc.eventos@demo.worki.test', NULL, encode(extensions.digest('demo-enc-eventos', 'sha256'), 'hex'), NULL, pg_temp.d('tag:2')),
 -- entrou pelo link, ainda nao confirmado pelo Gestor ("E ele?")
 (pg_temp.d('company'), pg_temp.d('u:enc.aguardando'), 'encarregado', 'active', 'enc.aguardando@demo.worki.test', NULL,
  now() - interval '2 hours', now() + interval '14 days', now() - interval '1 hour',
  pg_temp.d('company'), 'Letícia Moura', now() - interval '1 hour', NULL, NULL,
  'enc.aguardando@demo.worki.test', NULL, encode(extensions.digest('demo-enc-aguardando', 'sha256'), 'hex'), NULL, pg_temp.d('tag:1')),
 -- convite pendente com link valido (token de 64 hex; hash SHA-256 guardado ao lado)
 (pg_temp.d('company'), NULL, 'encarregado', 'invited', 'enc.convidada@demo.worki.test',
  md5('worki-demo-invite-1') || md5('worki-demo-invite-2'),
  now() - interval '2 days', now() + interval '12 days', NULL,
  pg_temp.d('company'), 'Natália Siqueira', NULL, NULL, NULL,
  NULL, NULL, encode(extensions.digest(md5('worki-demo-invite-1') || md5('worki-demo-invite-2'), 'sha256'), 'hex'), NULL, pg_temp.d('tag:2')),
 -- removido (so cortou o acesso; turnos antigos seguem no historico)
 (pg_temp.d('company'), pg_temp.d('u:enc.removido'), 'encarregado', 'removed', 'enc.removido@demo.worki.test', NULL,
  now() - interval '80 days', now() - interval '66 days', now() - interval '79 days',
  pg_temp.d('company'), 'Anderson Pacheco', now() - interval '79 days', now() - interval '79 days', pg_temp.d('company'),
  'enc.removido@demo.worki.test', now() - interval '12 days', encode(extensions.digest('demo-enc-removido', 'sha256'), 'hex'), pg_temp.d('company'), pg_temp.d('tag:0'));

-- Coberturas de responsavel (Cobrir): ativa, encerrada e revogada
INSERT INTO public.responsibility_coverages (id, company_id, from_user_id, to_user_id, starts_on, ends_on, created_by, created_at, revoked_at)
SELECT pg_temp.d('cov:1'), pg_temp.d('company'), pg_temp.d('u:enc.norte'), pg_temp.d('u:enc.centro'),
       t.today - 2, t.today + 5, pg_temp.d('company'), now() - interval '3 days', NULL::timestamptz
  FROM (SELECT (now() AT TIME ZONE 'America/Sao_Paulo')::date AS today) t
UNION ALL
SELECT pg_temp.d('cov:2'), pg_temp.d('company'), pg_temp.d('u:enc.eventos'), pg_temp.d('u:gestor2'),
       t.today - 30, t.today - 20, pg_temp.d('company'), now() - interval '33 days', NULL
  FROM (SELECT (now() AT TIME ZONE 'America/Sao_Paulo')::date AS today) t
UNION ALL
SELECT pg_temp.d('cov:3'), pg_temp.d('company'), pg_temp.d('u:enc.centro'), pg_temp.d('u:enc.norte'),
       t.today + 8, t.today + 12, pg_temp.d('company'), now() - interval '1 day', now() - interval '20 hours'
  FROM (SELECT (now() AT TIME ZONE 'America/Sao_Paulo')::date AS today) t;

-- Orcamento, faturamento (BI), modelos de turno, exportacoes de planilha
INSERT INTO public.company_spend_limits (id, company_id, period, amount, alert_thresholds, scope, financial_contact_email, financial_contact_phone) VALUES
  (pg_temp.d('lim:0'), pg_temp.d('company'), 'month', 24000.00, ARRAY[70, 90, 100], '',        'financeiro@demo.worki.test', '5511999990000'),
  (pg_temp.d('lim:1'), pg_temp.d('company'), 'month', 6000.00,  ARRAY[80, 100],     'Eventos',  NULL, NULL);

INSERT INTO public.company_monthly_revenue (id, company_id, year_month, amount)
SELECT pg_temp.d('rev:' || m), pg_temp.d('company'),
       (date_trunc('month', now() AT TIME ZONE 'America/Sao_Paulo') - (m || ' months')::interval)::date,
       (ARRAY[212000.00, 198500.00, 184300.00, 176900.00])[m + 1]
  FROM generate_series(0, 3) m;

INSERT INTO public.shift_templates (id, company_id, name, template, defaults, created_by) VALUES
  (pg_temp.d('tpl:0'), pg_temp.d('company'), 'Garçom — almoço de domingo',
   jsonb_build_object('title', 'Garçom — Salão Centro', 'category', 'garcom', 'budget_type', 'daily', 'has_lunch', true,
                      'location', 'Rua Demo das Flores, 100 — Centro, São Paulo', 'tag_id', pg_temp.d('tag:0')),
   '{"start_time":"11:00","end_time":"17:00","slots":4,"budget":150}'::jsonb, pg_temp.d('company')),
  (pg_temp.d('tpl:1'), pg_temp.d('company'), 'Cozinha — jantar de sexta',
   jsonb_build_object('title', 'Auxiliar de Cozinha — Norte', 'category', 'cozinha', 'budget_type', 'daily', 'has_lunch', false,
                      'certification_requirement', 'Manipulação de Alimentos', 'tag_id', pg_temp.d('tag:1')),
   '{"start_time":"17:00","end_time":"23:30","slots":2,"budget":170}'::jsonb, pg_temp.d('company'));

INSERT INTO public.payment_sheet_exports (id, company_id, generated_by, generated_at, period_from, period_to, filters, workers_count)
SELECT pg_temp.d('xls:' || m), pg_temp.d('company'), pg_temp.d('company'),
       now() - (m * 14 || ' days')::interval,
       ((now() AT TIME ZONE 'America/Sao_Paulo')::date - (m * 14 + 14)), ((now() AT TIME ZONE 'America/Sao_Paulo')::date - (m * 14 + 1)),
       '{}'::jsonb, 12 + m
  FROM generate_series(0, 3) m;

-- 3) FREELAS -------------------------------------------------------------------
INSERT INTO public.workers (
  id, full_name, phone, city, primary_role, experience_years, bio, availability, goal, onboarding_completed,
  created_at, updated_at, roles, level, xp, earnings_total, completed_jobs_count, rating_average, avatar_url,
  verified_identity, pix_key, recommendation_score, tags, reviews_count, views, cpf, birth_date,
  accepted_tos, tos_version, tos_accepted_at, profile_views, availability_days, badges_hidden,
  accepts_referrals, discoverable_for_sos)
SELECT w.id, w.full_name, '55119' || '9999' || lpad(w.idx::text, 4, '0'), w.city, w.role1,
       (ARRAY['0-1 ano','1-3 anos','3-5 anos','5+ anos'])[(w.idx % 4) + 1],
       w.role1 || ' com experiência em salão, bar e eventos. Perfil fictício da demonstração.',
       to_jsonb(CASE WHEN w.idx % 3 = 0 THEN ARRAY['Fim de Semana'] WHEN w.idx % 3 = 1 THEN ARRAY['Manhãs','Noites'] ELSE ARRAY['Tardes','Noites','Fim de Semana'] END),
       (ARRAY['Renda extra com quem já confio','Montar uma agenda fixa de turnos','Juntar para um curso técnico'])[(w.idx % 3) + 1],
       true, now() - interval '120 days', now() - interval '2 days',
       jsonb_build_array(w.role1, w.role2), 1, 0, 0, 0, NULL,
       'data:image/svg+xml;utf8,<svg xmlns=''http://www.w3.org/2000/svg'' viewBox=''0 0 100 100''><rect width=''100'' height=''100'' fill=''%23'
         || (ARRAY['BFE9D0','CFE0FF','FFE3B8','F6C9D8','E1D4F7','FFF1A8'])[(w.idx % 6) + 1]
         || '''/><text x=''50'' y=''63'' font-size=''40'' font-weight=''700'' text-anchor=''middle'' fill=''%23111'' font-family=''Arial''>'
         || upper(substr(w.full_name, 1, 1) || substr(split_part(w.full_name, ' ', 2), 1, 1)) || '</text></svg>',
       (w.idx % 3 <> 0), 'pix.demo' || lpad(w.idx::text, 2, '0') || '@demo.worki.test', 0, string_to_array((ARRAY['Pontual,Experiência em eventos','Bilíngue,Pontual','Atendimento ao cliente,Fim de semana','Experiência em eventos,CNH B'])[(w.idx % 4) + 1], ','), 0,
       (w.idx * 17) % 90, pg_temp.cpf_demo(w.idx), (date '1988-03-10' + (w.idx * 311)),
       true, 'v1', now() - interval '119 days', (w.idx * 23) % 120,
       (ARRAY[
         '{"0":["manha","tarde","noite"],"6":["manha","tarde","noite"]}',
         '{"2":["tarde","noite"],"3":["tarde","noite"],"4":["tarde","noite"],"5":["tarde","noite"],"6":["tarde","noite"]}',
         '{"1":["manha","tarde"],"2":["manha","tarde"],"3":["manha","tarde"],"4":["manha","tarde"],"5":["manha","tarde"]}',
         NULL,
         '{"5":["noite"],"6":["noite"],"0":["tarde","noite"]}',
         '{"2":["manha","tarde","noite"],"3":["manha","tarde","noite"],"4":["manha","tarde","noite"],"5":["manha","tarde","noite"]}'
       ])[(w.idx % 6) + 1]::jsonb,
       false, (w.idx <> 19), (w.idx >= 29)
  FROM _w w;

-- Elenco: 1..25 ATIVOS (accepted), 26..27 pendentes, 28 bloqueou (veto do freela), 29..32 fora do Elenco (SOS / indicacao)
INSERT INTO public.team_connections (id, company_id, worker_id, status, source, blocked_by, created_at, accepted_at, updated_at, invited_by)
SELECT pg_temp.d('tc:' || w.idx), pg_temp.d('company'), w.id,
       CASE WHEN w.idx <= 25 THEN 'accepted' WHEN w.idx <= 27 THEN 'pending' ELSE 'blocked' END,
       CASE WHEN w.idx = 17 THEN 'referral' ELSE (ARRAY['link','phone','qr'])[(w.idx % 3) + 1] END,
       CASE WHEN w.idx = 28 THEN w.id END,
       now() - ((110 - w.idx * 3) || ' days')::interval,
       CASE WHEN w.idx <= 25 THEN now() - ((108 - w.idx * 3) || ' days')::interval END,
       now() - interval '1 day',
       CASE WHEN w.idx % 3 = 0 THEN pg_temp.d('u:enc.centro') WHEN w.idx % 3 = 1 THEN pg_temp.d('company') ELSE pg_temp.d('u:enc.norte') END
  FROM _w w WHERE w.idx <= 28;

-- Listas do Elenco
INSERT INTO public.team_lists (id, company_id, name, created_by, created_at, updated_at) VALUES
  (pg_temp.d('list:0'), pg_temp.d('company'), 'Garçons de confiança', pg_temp.d('company'), now() - interval '70 days', now()),
  (pg_temp.d('list:1'), pg_temp.d('company'), 'Cozinha e copa',       pg_temp.d('company'), now() - interval '70 days', now()),
  (pg_temp.d('list:2'), pg_temp.d('company'), 'Bar e eventos',        pg_temp.d('company'), now() - interval '65 days', now());
INSERT INTO public.team_list_members (id, list_id, worker_id, added_at)
SELECT pg_temp.d('lm:' || l.i || ':' || w.idx), pg_temp.d('list:' || l.i), w.id, now() - interval '60 days'
  FROM (VALUES (0, ARRAY[1,4,9,14,19,21,24]), (1, ARRAY[2,6,10,13,17,23]), (2, ARRAY[3,5,12,18,22])) AS l(i, members)
  JOIN _w w ON w.idx = ANY (l.members) AND w.idx <= 25;

-- Certificacoes por funcao (vencendo, vencidas, conferidas pelo Gestor ou nao). notified_* ja preenchidos
-- para o cron de vencimento nao gerar avisos novos. Perecivel: manipulacao de alimentos, vigilante, NR-6.
INSERT INTO public.worker_certifications (
  id, worker_id, title, issuer, registration_number, issued_at, expires_at,
  verified_by_company_id, verified_at, verified_note, notified_30d_at, notified_expired_at, created_at, updated_at)
SELECT pg_temp.d('cert:' || c.k || ':' || c.idx), c.worker_id, c.title, c.issuer, c.reg,
       t.today + c.issued_off, CASE WHEN c.exp_off IS NULL THEN NULL ELSE t.today + c.exp_off END,
       CASE WHEN c.ver THEN pg_temp.d('company') END,
       CASE WHEN c.ver THEN now() - interval '20 days' END,
       CASE WHEN c.ver THEN 'Documento original conferido pelo Gestor' END,
       CASE WHEN c.exp_off IS NOT NULL AND c.exp_off <= 30 THEN now() END,
       CASE WHEN c.exp_off IS NOT NULL AND c.exp_off <= 0 THEN now() END,
       now() - interval '100 days', now() - interval '20 days'
  FROM (SELECT (now() AT TIME ZONE 'America/Sao_Paulo')::date AS today) t
 CROSS JOIN (
  SELECT 'a' AS k, w.idx, w.id AS worker_id, w.ta AS title,
         CASE w.ta WHEN 'Manipulação de Alimentos' THEN 'Senac SP (demo)' WHEN 'Vigilante / Segurança Privada' THEN 'Escola Demo de Vigilantes'
                   WHEN 'Segurança do Trabalho (NR-6)' THEN 'Instituto Demo de Segurança' WHEN 'Coquetelaria Básica' THEN 'Instituto Demo do Bar'
                   ELSE 'Instituto Demo de Hospitalidade' END AS issuer,
         CASE WHEN w.ta IN ('Manipulação de Alimentos', 'Vigilante / Segurança Privada', 'Segurança do Trabalho (NR-6)')
              THEN 'DEMO-' || lpad(w.idx::text, 4, '0') END AS reg,
         CASE WHEN w.ta IN ('Manipulação de Alimentos', 'Vigilante / Segurança Privada', 'Segurança do Trabalho (NR-6)')
              THEN (CASE WHEN w.idx IN (6, 20) THEN -25 - w.idx % 5 WHEN w.idx IN (2, 13, 16) THEN 9 + w.idx % 12
                         WHEN w.idx = 17 THEN 24 ELSE 120 + w.idx * 7 END) - 365
              ELSE -300 - w.idx * 5 END AS issued_off,
         CASE WHEN w.ta IN ('Manipulação de Alimentos', 'Vigilante / Segurança Privada', 'Segurança do Trabalho (NR-6)')
              THEN (CASE WHEN w.idx IN (6, 20) THEN -25 - w.idx % 5 WHEN w.idx IN (2, 13, 16) THEN 9 + w.idx % 12
                         WHEN w.idx = 17 THEN 24 ELSE 120 + w.idx * 7 END) END AS exp_off,
         (w.idx % 2 = 0) AS ver
    FROM (SELECT w0.*, CASE w0.role1
            WHEN 'Cozinheiro' THEN 'Manipulação de Alimentos' WHEN 'Auxiliar de Cozinha' THEN 'Manipulação de Alimentos'
            WHEN 'Copeiro' THEN 'Manipulação de Alimentos' WHEN 'Segurança' THEN 'Vigilante / Segurança Privada'
            WHEN 'Auxiliar de Limpeza' THEN 'Segurança do Trabalho (NR-6)'
            WHEN 'Barman' THEN 'Coquetelaria Básica' WHEN 'Atendente de Bar' THEN 'Coquetelaria Básica'
            WHEN 'Recepcionista' THEN 'Atendimento ao Cliente'
            ELSE 'Atendimento ao Cliente em Salão' END AS ta
            FROM _w w0 WHERE w0.idx <= 25) w
  UNION ALL
  SELECT 'b', w.idx, w.id, 'Primeiros Socorros', 'Cruz Demo', 'DEMO-P' || lpad(w.idx::text, 3, '0'), -165, 200 + w.idx, false
    FROM _w w WHERE w.idx <= 25 AND w.idx % 3 = 0
  UNION ALL
  SELECT 'c', w.idx, w.id, 'Inglês para Atendimento', 'Escola Demo de Idiomas', NULL, -420, NULL, true
    FROM _w w WHERE w.idx IN (4, 9, 21)
 ) AS c(k, idx, worker_id, title, issuer, reg, issued_off, exp_off, ver);

-- Treinamentos internos da empresa por funcao (20 freelas; um revogado)
INSERT INTO public.worker_trainings (id, company_id, worker_id, title, completed_at, note, created_by, created_at, revoked_at, revoked_reason)
SELECT pg_temp.d('tr:' || w.idx), pg_temp.d('company'), w.id,
       CASE w.role1 WHEN 'Barman' THEN 'Cardápio de drinks da casa'
                    WHEN 'Cozinheiro' THEN 'Higiene e boas práticas de cozinha' WHEN 'Auxiliar de Cozinha' THEN 'Higiene e boas práticas de cozinha'
                    WHEN 'Copeiro' THEN 'Higiene e boas práticas de cozinha'
                    WHEN 'Segurança' THEN 'Segurança do trabalho no salão' WHEN 'Auxiliar de Limpeza' THEN 'Segurança do trabalho no salão'
                    ELSE 'Atendimento padrão Sabor & Cia' END,
       t.today - (20 + (w.idx * 3) % 70), CASE WHEN w.idx % 2 = 0 THEN 'Treinado pelo Gestor' ELSE 'Turma interna' END,
       pg_temp.d('company'), now() - ((20 + (w.idx * 3) % 70) || ' days')::interval,
       CASE WHEN w.idx = 12 THEN now() - interval '5 days' END,
       CASE WHEN w.idx = 12 THEN 'Treinamento refeito por mudança de cardápio' END
  FROM (SELECT (now() AT TIME ZONE 'America/Sao_Paulo')::date AS today) t
  CROSS JOIN _w w WHERE w.idx <= 25 AND w.idx % 5 <> 4;

-- Indicacoes entre empresas: a empresa parceira apresenta freelas a Sabor & Cia
INSERT INTO public.worker_referrals (id, worker_id, referring_company_id, requesting_company_id, status, message, created_by, created_at, expires_at, responded_at) VALUES
  (pg_temp.d('ref:1'), pg_temp.d('w:31'), pg_temp.d('company-b'), pg_temp.d('company'), 'awaiting_worker',
   'Trabalhou 8 meses com a gente, sempre pontual. Indico para o salão.', pg_temp.d('company-b'), now() - interval '2 days', now() + interval '12 days', NULL),
  (pg_temp.d('ref:2'), pg_temp.d('w:32'), pg_temp.d('company-b'), pg_temp.d('company'), 'declined',
   'Ótima recepcionista de eventos.', pg_temp.d('company-b'), now() - interval '9 days', now() + interval '5 days', now() - interval '7 days'),
  (pg_temp.d('ref:3'), pg_temp.d('w:17'), pg_temp.d('company-b'), pg_temp.d('company'), 'accepted',
   'Copeira de confiança.', pg_temp.d('company-b'), now() - interval '40 days', now() - interval '26 days', now() - interval '39 days');

-- 4) TURNOS (jobs) -------------------------------------------------------------
-- _j: um registro por turno com todos os atributos derivados. n=1..34 passado (ate ~87 dias),
-- 35..38 hoje, 39..52 futuro, 53 SOS, 54..59 lote, 60+ serie semanal (sabados, 4 semanas p/ cada lado).
CREATE TEMP TABLE _j ON COMMIT DROP AS
WITH t AS (SELECT (now() AT TIME ZONE 'America/Sao_Paulo')::date AS today),
ser AS (
  SELECT 59 + (row_number() OVER (ORDER BY dd))::int AS n, dd AS sday
    FROM (SELECT (t.today - 28 + g) AS dd FROM t, generate_series(0, 56) g) s
   WHERE extract(dow FROM dd) = 6
),
nums AS (
  SELECT g AS n, NULL::date AS sday FROM generate_series(1, 59) g
  UNION ALL SELECT n, sday FROM ser
),
k1 AS (
  SELECT nums.n, nums.sday, t.today,
         CASE
           WHEN n <= 34 THEN CASE WHEN n % 9 = 0 THEN 'past_cancelled'
                                  WHEN n IN (5, 16, 31) THEN 'past_nopresence' ELSE 'past_done' END
           WHEN n = 35 THEN 'today_inprog' WHEN n = 36 THEN 'today_done'
           WHEN n = 37 THEN 'today_upcoming' WHEN n = 38 THEN 'today_invited'
           WHEN n = 44 THEN 'future_cancelled' WHEN n = 45 THEN 'future_paused'
           WHEN n IN (41, 48) THEN 'future_unfilled'
           WHEN n <= 52 THEN 'future'
           WHEN n = 53 THEN 'sos'
           WHEN n <= 59 THEN 'batch'
           WHEN sday < t.today THEN 'series_past' ELSE 'series_future'
         END AS kind
    FROM nums CROSS JOIN t
),
k2 AS (
  SELECT k1.*,
         CASE WHEN kind LIKE 'series%' THEN 0 WHEN kind = 'batch' THEN 2 WHEN kind = 'sos' THEN 0 ELSE n % 3 END AS tag,
         -- 3, 36, 38 e 39 sao sempre "Garcom" (a Beatriz, freela@demo, e Garcom e precisa de historico/convite/turno amanha)
         CASE WHEN n IN (3, 36, 38, 39) THEN 0 ELSE (n / 3) % 5 END AS ti,
         CASE
           WHEN n <= 34 THEN today - (1 + round((n - 1) * 2.6))::int
           WHEN n BETWEEN 35 AND 38 THEN today
           WHEN n BETWEEN 39 AND 52 THEN today + (n - 38)
           WHEN n = 53 THEN today
           WHEN n BETWEEN 54 AND 59 THEN today + (n - 54) + 15
           ELSE sday
         END AS day_raw,
         (CASE WHEN kind LIKE 'series%' THEN '18:00' WHEN kind = 'batch' THEN '17:00'
               ELSE (ARRAY['11:00','18:00','08:00','19:00'])[n % 4 + 1] END)::time AS st_time,
         CASE WHEN kind IN ('today_inprog', 'today_done') THEN 6
              WHEN kind IN ('today_upcoming', 'today_invited', 'sos') THEN 5
              WHEN kind LIKE 'series%' THEN 5 WHEN kind = 'batch' THEN 8
              ELSE (ARRAY[5, 5.5, 6, 8])[n % 4 + 1] END::numeric AS hours
    FROM k1
),
k3 AS (
  SELECT k2.*,
         CASE kind
           WHEN 'today_inprog'   THEN date_trunc('minute', now() - interval '150 minutes')
           WHEN 'today_done'     THEN date_trunc('minute', now() - interval '9 hours')
           WHEN 'today_upcoming' THEN date_trunc('minute', now() + interval '2 hours')
           WHEN 'today_invited'  THEN date_trunc('minute', now() + interval '5 hours')
           WHEN 'sos'            THEN date_trunc('minute', now() + interval '210 minutes')
           ELSE ((day_raw + st_time) AT TIME ZONE 'America/Sao_Paulo')
         END AS start_ts
    FROM k2
),
k4 AS (
  SELECT k3.*,
         (start_ts + hours * interval '1 hour') AS end_ts,
         (start_ts AT TIME ZONE 'America/Sao_Paulo')::date AS day,
         CASE WHEN kind LIKE 'series%' THEN 3 WHEN kind = 'batch' THEN 4 WHEN kind = 'sos' THEN 2
              WHEN kind = 'today_inprog' THEN GREATEST(1 + (n * 3) % 5, 2)
              WHEN kind = 'future_unfilled' THEN GREATEST(1 + (n * 3) % 5, 3)
              ELSE 1 + (n * 3) % 5 END AS slots_raw,
         CASE WHEN kind LIKE 'series%' THEN 'Reforço de Fim de Semana — Salão'
              WHEN kind = 'batch' THEN 'Casamento Silva — Equipe de Salão (dia ' || (n - 53) || ')'
              WHEN kind = 'sos' THEN 'SOS — Garçom para hoje (falta de última hora)'
              ELSE (ARRAY[
                ARRAY['Garçom — Salão Centro','Auxiliar de Cozinha — Centro','Caixa — Centro','Atendente de Bar — Centro','Recepcionista — Centro'],
                ARRAY['Garçom — Salão Norte','Cozinheiro — Norte','Copeiro — Norte','Auxiliar de Limpeza — Norte','Segurança — Norte'],
                ARRAY['Garçom de Evento','Barman — Evento','Segurança — Evento','Recepção de Evento','Cozinha de Evento']
              ])[tag + 1][ti + 1] END AS title,
         -- funcao exigida (casa com workers.role1/role2: so entra no turno quem tem a funcao)
         CASE WHEN kind LIKE 'series%' OR kind IN ('batch', 'sos') THEN 'Garçom'
              ELSE (ARRAY[
                ARRAY['Garçom','Auxiliar de Cozinha','Caixa','Atendente de Bar','Recepcionista'],
                ARRAY['Garçom','Cozinheiro','Copeiro','Auxiliar de Limpeza','Segurança'],
                ARRAY['Garçom','Barman','Segurança','Recepcionista','Cozinheiro']
              ])[tag + 1][ti + 1] END AS role,
         CASE WHEN kind LIKE 'series%' OR kind IN ('batch', 'sos') THEN 'garcom'
              ELSE (ARRAY[
                ARRAY['garcom','cozinha','caixa','atendente','recepcao'],
                ARRAY['garcom','cozinha','atendente','atendente','promotor'],
                ARRAY['garcom','atendente','promotor','recepcao','cozinha']
              ])[tag + 1][ti + 1] END AS category
    FROM k3
),
k5 AS (
  SELECT k4.*,
         (SELECT count(*)::int FROM _w w WHERE w.idx <= 25 AND (w.role1 = k4.role OR w.role2 = k4.role)) AS cap,
         CASE WHEN n % 13 = 0 THEN pg_temp.d('u:enc.removido')
              WHEN n % 11 = 0 THEN pg_temp.d('u:gestor2')
              WHEN n % 7 = 0 THEN pg_temp.d('company')
              ELSE CASE tag WHEN 0 THEN pg_temp.d('u:enc.centro') WHEN 1 THEN pg_temp.d('u:enc.norte') ELSE pg_temp.d('u:enc.eventos') END
         END AS responsible_id
    FROM k4
),
k6 AS (
  -- vagas nunca passam de quem tem a funcao no Elenco
  SELECT k5.*, LEAST(slots_raw, cap) AS slots FROM k5
)
SELECT pg_temp.d('j:' || n) AS id, n, kind, tag, day, start_ts, end_ts, hours, slots, title, role, cap, category,
       'daily'::text AS budget_type,
       ((CASE category WHEN 'garcom' THEN 140 WHEN 'cozinha' THEN 160 WHEN 'caixa' THEN 130
                       WHEN 'atendente' THEN 130 WHEN 'recepcao' THEN 120 ELSE 150 END) + (n % 3) * 10)::numeric AS budget,
       -- diaria fixa: o valor pago por freela e igual a jobs.budget (o relatorio de Pagamentos usa budget no "a pagar")
       ((CASE category WHEN 'garcom' THEN 140 WHEN 'cozinha' THEN 160 WHEN 'caixa' THEN 130
                       WHEN 'atendente' THEN 130 WHEN 'recepcao' THEN 120 ELSE 150 END) + (n % 3) * 10)::numeric AS amount,
       CASE kind WHEN 'past_cancelled' THEN 'deleted' WHEN 'future_cancelled' THEN 'deleted'
                 WHEN 'future_paused' THEN 'paused' ELSE 'open' END AS status,
       CASE kind WHEN 'future_unfilled' THEN 1 WHEN 'past_cancelled' THEN LEAST(slots, 2) WHEN 'future_cancelled' THEN LEAST(slots, 2)
                 WHEN 'future_paused' THEN 0 WHEN 'sos' THEN 1
                 WHEN 'batch' THEN CASE WHEN n - 53 > 3 THEN slots - 1 ELSE slots END
                 ELSE slots END AS fill,
       -- rotacao na lista de elegiveis: fixa onde a freela@demo (1o Garcom da lista) precisa cair em k=0/1
       CASE n WHEN 36 THEN 0 WHEN 38 THEN 0 WHEN 3 THEN 10 WHEN 39 THEN 10 ELSE n * 3 END AS rot,
       responsible_id,
       (CASE WHEN tag = 0 AND n % 2 = 0 OR n IN (35, 36) THEN 'qr_gps' ELSE 'dual' END) AS presence_mode,
       CASE WHEN kind LIKE 'series%' THEN pg_temp.d('series:1') END AS series_id,
       CASE WHEN kind LIKE 'series%' THEN day END AS series_occurrence_date,
       CASE WHEN kind = 'batch' THEN pg_temp.d('batch:1') END AS batch_id,
       CASE WHEN kind = 'batch' THEN (n - 53)::smallint END AS batch_row
  FROM k6;

INSERT INTO public.jobs (
  id, company_id, title, description, requirements, category, type, location, budget, budget_type,
  start_date, estimated_hours, scope, status, candidates_count, created_at, views, work_start_time, work_end_time,
  has_lunch, briefing, slots, series_id, series_occurrence_date, certification_requirement, responsible_id, tag_id,
  creation_batch_id, creation_row, presence_mode, site_id, qr_mode)
SELECT j.id, pg_temp.d('company'), j.title,
       'Turno de ' || j.title || '. Equipe de apoio no local e responsável presente durante todo o horário.',
       'Experiência na função, pontualidade e uniforme completo.',
       j.category, 'freelance',
       (ARRAY['Rua Demo das Flores, 100 — Centro, São Paulo','Av. Demo do Norte, 2500 — Santana, São Paulo',
              'Espaço Jardins, Al. Fictícia, 450 — Jardins, São Paulo'])[j.tag + 1],
       j.budget, j.budget_type, j.start_ts, round(j.hours)::int, 'on-site', j.status, 0,
       LEAST(j.start_ts - interval '6 days', now() - (2 + j.n) * interval '1 hour'),
       (j.n * 7) % 45 + 3,
       to_char(j.start_ts AT TIME ZONE 'America/Sao_Paulo', 'HH24:MI'),
       to_char(j.end_ts AT TIME ZONE 'America/Sao_Paulo', 'HH24:MI'),
       (j.hours >= 6 AND j.n % 2 = 0),
       'Camisa preta lisa, calça preta, sapato fechado antiderrapante. Chegar 15 minutos antes.',
       j.slots, j.series_id, j.series_occurrence_date,
       CASE WHEN j.category = 'cozinha' AND j.n % 2 = 0 THEN 'Manipulação de Alimentos' END,
       j.responsible_id, pg_temp.d('tag:' || j.tag), j.batch_id, j.batch_row,
       j.presence_mode, pg_temp.d('site:' || j.tag), 'rotating'
  FROM _j j;

INSERT INTO public.job_series (id, company_id, recurrence_type, weekdays, range_start_date, range_end_date, occurrences_generated, status, created_by, created_at)
SELECT pg_temp.d('series:1'), pg_temp.d('company'), 'weekly', ARRAY[6],
       (now() AT TIME ZONE 'America/Sao_Paulo')::date - 28, (now() AT TIME ZONE 'America/Sao_Paulo')::date + 28,
       (SELECT count(*) FROM _j WHERE series_id IS NOT NULL)::int, 'active', pg_temp.d('company'), now() - interval '30 days';

-- 5) CANDIDATURAS / CONVITES (applications) -----------------------------------
CREATE TEMP TABLE _a (
  id uuid, job_id uuid, n int, k int, kind text, widx int, worker_id uuid, status text,
  created_at timestamptz, responded_at timestamptz, response text, expires_at timestamptz,
  checkin timestamptz, checkout timestamptz, cc_in timestamptz, cc_out timestamptz
) ON COMMIT DROP;

-- Quem entra em cada vaga: so freela com a FUNCAO do turno (role1/role2) e do Elenco ativo (1..25).
-- Nunca mais contratados do que jobs.slots (a conferencia no fim do script aborta se isso for violado).
INSERT INTO _a
SELECT pg_temp.d('a:' || b.n || ':' || b.k), b.job_id, b.n, b.k, b.kind, b.widx, pg_temp.d('w:' || b.widx), b.status,
       b.created_at,
       CASE WHEN b.status = 'invited' THEN NULL
            ELSE LEAST(b.created_at + interval '2 hours' + b.k * interval '15 minutes', now() - interval '20 minutes') END,
       CASE WHEN b.status = 'invited' THEN NULL ELSE 'accepted' END,
       CASE WHEN b.status = 'invited' THEN now() + interval '20 hours' ELSE b.created_at + interval '48 hours' END,
       b.checkin,
       CASE WHEN b.status = 'completed' AND b.checkin IS NOT NULL
            THEN b.end_ts + ((b.n * (b.k + 1)) % 11 - 2) * interval '1 minute' END,
       CASE WHEN b.checkin IS NOT NULL AND (b.status = 'completed' OR b.k % 2 = 0)
            THEN b.checkin + interval '4 minutes' END,
       CASE WHEN b.status = 'completed' AND b.checkin IS NOT NULL
            THEN b.end_ts + ((b.n * (b.k + 1)) % 11 - 2) * interval '1 minute' + interval '10 minutes' END
  FROM (
    SELECT j.id AS job_id, j.n, k, j.kind, j.end_ts,
           CASE WHEN j.kind = 'sos' THEN 29
                ELSE el.e[(j.rot + k) % cardinality(el.e) + 1] END AS widx,
           CASE
             WHEN j.kind IN ('past_done', 'series_past', 'past_nopresence', 'today_done') THEN 'completed'
             WHEN j.kind IN ('past_cancelled', 'future_cancelled') THEN 'cancelled'
             WHEN j.kind = 'today_inprog' THEN CASE WHEN k = j.fill - 1 THEN 'hired' ELSE 'in_progress' END
             WHEN j.kind = 'today_invited' THEN CASE WHEN k = 0 THEN 'invited' ELSE 'hired' END
             WHEN j.kind IN ('future', 'series_future', 'batch') AND k = j.fill - 1 AND j.n % 3 = 0 THEN 'invited'
             ELSE 'hired'
           END AS status,
           CASE WHEN j.kind = 'sos' THEN now() - interval '35 minutes'
                ELSE LEAST(j.start_ts - interval '4 days' + k * interval '3 hours', now() - interval '40 minutes') END AS created_at,
           CASE WHEN j.kind IN ('past_done', 'series_past', 'today_done', 'today_inprog')
                THEN j.start_ts + ((j.n + 2 * k) % 9 - 3) * interval '1 minute' END AS checkin
      FROM _j j
      CROSS JOIN LATERAL (SELECT array_agg(w.idx ORDER BY w.idx) AS e FROM _w w
                           WHERE w.idx <= 25 AND (w.role1 = j.role OR w.role2 = j.role)) el
      CROSS JOIN LATERAL generate_series(0, j.fill - 1) k
  ) b;

-- checkin so vale para quem de fato trabalhou (cancelado/hired/invited nao tem presenca)
UPDATE _a SET checkin = NULL, checkout = NULL, cc_in = NULL, cc_out = NULL WHERE status NOT IN ('completed', 'in_progress');

-- Extras (nao ocupam vaga): quem RECUSOU o convite (n%6=1) e quem foi DISPENSADO/desistiu (n%4=0, status cancelled).
-- So entram quando ha outro freela elegivel livre na funcao.
INSERT INTO _a
SELECT pg_temp.d('ax:' || j.n), j.id, j.n, 99, j.kind, el.e[(j.rot + j.fill + 1) % cardinality(el.e) + 1],
       pg_temp.d('w:' || el.e[(j.rot + j.fill + 1) % cardinality(el.e) + 1]), 'declined',
       LEAST(j.start_ts - interval '4 days', now() - interval '3 hours'),
       LEAST(j.start_ts - interval '4 days' + interval '5 hours', now() - interval '2 hours'),
       'declined', LEAST(j.start_ts - interval '4 days', now() - interval '3 hours') + interval '48 hours',
       NULL, NULL, NULL, NULL
  FROM _j j
  CROSS JOIN LATERAL (SELECT array_agg(w.idx ORDER BY w.idx) AS e FROM _w w
                       WHERE w.idx <= 25 AND (w.role1 = j.role OR w.role2 = j.role)) el
 WHERE j.n % 6 = 1 AND j.kind IN ('past_done', 'future', 'future_unfilled', 'series_future', 'series_past')
   AND cardinality(el.e) > j.fill + 1;

INSERT INTO _a
SELECT pg_temp.d('ac:' || j.n), j.id, j.n, 98, j.kind, el.e[(j.rot + j.fill) % cardinality(el.e) + 1],
       pg_temp.d('w:' || el.e[(j.rot + j.fill) % cardinality(el.e) + 1]), 'cancelled',
       LEAST(j.start_ts - interval '5 days', now() - interval '4 hours'),
       LEAST(j.start_ts - interval '5 days' + interval '3 hours', now() - interval '3 hours'),
       'accepted', LEAST(j.start_ts - interval '5 days', now() - interval '4 hours') + interval '48 hours',
       NULL, NULL, NULL, NULL
  FROM _j j
  CROSS JOIN LATERAL (SELECT array_agg(w.idx ORDER BY w.idx) AS e FROM _w w
                       WHERE w.idx <= 25 AND (w.role1 = j.role OR w.role2 = j.role)) el
 WHERE j.n % 4 = 0 AND j.kind IN ('past_done', 'future', 'series_past', 'series_future')
   AND cardinality(el.e) > j.fill
   AND NOT (j.n % 6 = 1);

INSERT INTO public.applications (
  id, job_id, worker_id, status, message, created_at, cover_letter, worker_checkin_at, worker_checkout_at,
  company_checkin_confirmed_at, company_checkout_confirmed_at, invited_by_company_at,
  invitation_responded_at, invitation_response, invitation_expires_at)
SELECT a.id, a.job_id, a.worker_id, a.status, NULL, a.created_at, NULL, a.checkin, a.checkout, a.cc_in, a.cc_out,
       a.created_at, a.responded_at, a.response, a.expires_at
  FROM _a a;

-- O trigger de "criar conversa" esta desligado: cria a conversa de cada candidatura aqui.
INSERT INTO public."Conversation" (id, createdat, islocked, application_uuid)
SELECT pg_temp.d('c:' || a.id::text)::text, a.created_at, false, a.id FROM _a a;

UPDATE public.jobs j SET candidates_count = c.cnt
  FROM (SELECT job_id, count(*)::int AS cnt FROM _a GROUP BY job_id) c WHERE c.job_id = j.id;

-- Cancelamentos de turno (historico)
INSERT INTO public.job_cancellations (id, job_id, company_id, cancelled_by, reason, cancelled_applications, cancelled_calls, closed_candidates, cancelled_at)
SELECT pg_temp.d('jc:' || j.n), j.id, pg_temp.d('company'), j.responsible_id,
       CASE WHEN j.kind = 'past_cancelled' THEN 'Casa fechada por feriado local' ELSE 'Evento adiado pelo cliente' END,
       (SELECT count(*) FROM _a a WHERE a.job_id = j.id)::int, 0, 0,
       LEAST(j.start_ts - interval '2 days', now() - interval '1 hour')
  FROM _j j WHERE j.kind IN ('past_cancelled', 'future_cancelled');

-- 6) PRESENCA (GPS + QR) -------------------------------------------------------
INSERT INTO public.presence_checks (id, application_id, job_id, worker_id, kind, result, distance_m, accuracy_m, qr_ok, qr_kind, reason, decided_by, created_at)
SELECT pg_temp.d('pci:' || a.id::text), a.id, a.job_id, a.worker_id, 'arrival',
       CASE WHEN (a.n + a.k) % 13 = 0 THEN 'manual_exception' ELSE 'verified' END,
       CASE WHEN (a.n + a.k) % 13 = 0 THEN NULL ELSE (a.n + a.k) % 60 + 10 END,
       CASE WHEN (a.n + a.k) % 13 = 0 THEN NULL ELSE (a.n * (a.k + 1)) % 15 + 6 END,
       CASE WHEN (a.n + a.k) % 13 = 0 THEN NULL ELSE true END,
       CASE WHEN (a.n + a.k) % 13 = 0 THEN NULL ELSE 'rotating' END,
       CASE WHEN (a.n + a.k) % 13 = 0 THEN 'sem_sinal_gps' END,
       CASE WHEN (a.n + a.k) % 13 = 0 THEN pg_temp.d('company') END,
       a.checkin
  FROM _a a JOIN _j j ON j.id = a.job_id
 WHERE j.presence_mode = 'qr_gps' AND a.checkin IS NOT NULL
UNION ALL
SELECT pg_temp.d('pco:' || a.id::text), a.id, a.job_id, a.worker_id, 'departure', 'verified',
       (a.n + a.k) % 50 + 8, (a.n * (a.k + 2)) % 15 + 6, true, 'rotating', NULL, NULL, a.checkout
  FROM _a a JOIN _j j ON j.id = a.job_id
 WHERE j.presence_mode = 'qr_gps' AND a.checkout IS NOT NULL
UNION ALL
-- excecao pedida e ainda sem decisao (freela chegou sem bateria)
SELECT pg_temp.d('pce:' || a.id::text), a.id, a.job_id, a.worker_id, 'arrival', 'exception_requested',
       NULL, NULL, NULL, NULL, 'celular_sem_bateria', NULL, now() - interval '15 minutes'
  FROM _a a WHERE a.kind = 'today_inprog' AND a.status = 'hired';

-- 7) CHAMADOS DE TURNO (1 -> N) e SOS -------------------------------------------
-- 6 preenchidos (aceite + first_claim_at: alimentam "tempo medio" e "aceite por freela"), 3 expirados,
-- 1 cancelado, 1 aberto (41), mais o SOS (53). Tempo ate o 1o aceite varia de 4 a 22 minutos por chamado.
CREATE TEMP TABLE _sc ON COMMIT DROP AS
SELECT pg_temp.d('call:' || s.n) AS id, s.n, j.id AS job_id, j.start_ts, j.slots AS jslots, j.role, s.status, s.reason,
       s.nacc, s.nothers, 'team'::text AS origin,
       CASE s.n WHEN 41 THEN now() - interval '3 hours' WHEN 48 THEN now() - interval '30 hours'
                ELSE j.start_ts - interval '1 day' END AS created_at,
       4 + (s.n * 7) % 19 AS claim_min
  FROM (VALUES
    (3,  'filled',    'falta',         1, 4),
    (6,  'filled',    'evento',        1, 3),
    (8,  'filled',    'pico_previsto', 1, 1),
    (10, 'filled',    'falta',         1, 1),
    (12, 'filled',    'falta',         1, 3),
    (26, 'filled',    'evento',        2, 2),
    (7,  'expired',   'folga',         0, 4),
    (20, 'expired',   'pico_previsto', 0, 4),
    (24, 'cancelled', 'folga',         0, 3),
    (41, 'open',      'falta',         0, 3),
    (48, 'expired',   'reforco',       0, 3)
  ) AS s(n, status, reason, nacc, nothers)
  JOIN _j j ON j.n = s.n;

INSERT INTO public.shift_calls (id, job_id, company_id, created_by, slots, reason, message, targets_count, status, expires_at, created_at, closed_at, first_claim_at, origin)
SELECT c.id, c.job_id, pg_temp.d('company'), pg_temp.d('company'),
       CASE c.n WHEN 26 THEN 2 WHEN 41 THEN GREATEST(c.jslots - 1, 1) WHEN 48 THEN GREATEST(c.jslots - 1, 1) ELSE 1 END,
       c.reason, 'Quem puder cobrir, é só aceitar. Primeiro que aceitar fica com a vaga.',
       c.nacc + c.nothers,           -- ajustado para a contagem real de alvos logo abaixo
       c.status,
       CASE c.n WHEN 41 THEN now() + interval '30 hours' WHEN 48 THEN now() - interval '6 hours' ELSE c.start_ts - interval '2 hours' END,
       c.created_at,
       CASE c.status WHEN 'filled' THEN c.created_at + c.claim_min * interval '1 minute'
                     WHEN 'cancelled' THEN c.start_ts - interval '20 hours'
                     WHEN 'expired' THEN CASE c.n WHEN 48 THEN now() - interval '6 hours' ELSE c.start_ts - interval '2 hours' END END,
       CASE WHEN c.status = 'filled' THEN c.created_at + c.claim_min * interval '1 minute' END,
       c.origin
  FROM _sc c
UNION ALL
-- SOS aberto (alvos so fora do Elenco), 1 aceite
SELECT pg_temp.d('call:53'), j.id, pg_temp.d('company'), pg_temp.d('company'), 2, 'falta',
       'Preciso de garçom hoje, saída em 3h. Quem puder, aceita aí!', 4, 'open',
       now() + interval '3 hours', now() - interval '40 minutes', NULL, now() - interval '20 minutes', 'sos'
  FROM _j j WHERE j.n = 53;

-- alvos: aceitantes (apps k < nacc) + outros freelas ELEGIVEIS da funcao que ficaram de fora do turno
INSERT INTO public.shift_call_targets (id, call_id, worker_id, notified_at, responded_at, response, origin)
SELECT pg_temp.d('tgt:' || c.n || ':' || x.widx), c.id, pg_temp.d('w:' || x.widx), c.created_at, x.responded_at, x.response, c.origin
  FROM _sc c
  CROSS JOIN LATERAL (
    SELECT a.widx, c.created_at + c.claim_min * interval '1 minute' + a.k * interval '3 minutes' AS responded_at, 'accepted'::text AS response
      FROM _a a WHERE c.status = 'filled' AND a.job_id = c.job_id AND a.k < c.nacc
    UNION ALL
    SELECT r.idx, CASE WHEN c.status = 'filled' THEN c.created_at + c.claim_min * interval '1 minute' + interval '1 minute'
                       WHEN r.rn = 1 THEN c.created_at + interval '1 hour' END,
           CASE WHEN c.status = 'filled' THEN 'closed' WHEN r.rn = 1 THEN 'declined' END
      FROM (SELECT w.idx, row_number() OVER (ORDER BY (w.idx + c.n) % 25) AS rn
              FROM _w w
             WHERE w.idx <= 25 AND (w.role1 = c.role OR w.role2 = c.role)
               AND NOT EXISTS (SELECT 1 FROM _a a2 WHERE a2.job_id = c.job_id AND a2.widx = w.idx)) r
     WHERE r.rn <= c.nothers
  ) x
UNION ALL
SELECT pg_temp.d('tgt:53:' || s.widx), pg_temp.d('call:53'), pg_temp.d('w:' || s.widx), now() - interval '40 minutes',
       CASE WHEN s.widx = 29 THEN now() - interval '20 minutes' END, CASE WHEN s.widx = 29 THEN 'accepted' END, 'sos'
  FROM unnest(ARRAY[29, 30, 31, 32]) AS s(widx);

UPDATE public.shift_calls sc SET targets_count = t.cnt
  FROM (SELECT call_id, count(*)::int AS cnt FROM public.shift_call_targets
         WHERE call_id IN (SELECT id FROM _sc UNION SELECT pg_temp.d('call:53')) GROUP BY call_id) t
 WHERE t.call_id = sc.id;

-- Confirmacao de vespera: ja gravada para todo hired futuro, para o cron das 18h nao disparar
-- notificacoes reais para usuarios demo (uq_sac_auto_once: uma auto por candidatura).
INSERT INTO public.shift_attendance_confirmations (id, application_id, job_id, worker_id, source, requested_by, requested_at, response, responded_at)
SELECT pg_temp.d('sac:' || a.id::text), a.id, a.job_id, a.worker_id, 'auto', NULL,
       LEAST(j.start_ts - interval '1 day' - interval '6 hours', now() - interval '30 minutes'),
       CASE WHEN (a.n + a.k) % 4 = 0 THEN NULL WHEN (a.n + a.k) % 9 = 0 THEN 'cannot_attend' ELSE 'confirmed' END,
       CASE WHEN (a.n + a.k) % 4 = 0 THEN NULL
            ELSE LEAST(j.start_ts - interval '1 day' - interval '4 hours', now() - interval '10 minutes') END
  FROM _a a JOIN _j j ON j.id = a.job_id
 WHERE (a.status = 'hired' AND j.start_ts > now() - interval '12 hours')
    OR (j.n BETWEEN 28 AND 36 AND a.status IN ('completed', 'in_progress'));
-- um pedido MANUAL pendente (o Gestor cobrou resposta de quem ainda nao respondeu)
INSERT INTO public.shift_attendance_confirmations (id, application_id, job_id, worker_id, source, requested_by, requested_at, response, responded_at)
SELECT pg_temp.d('sacm:' || s.application_id::text), s.application_id, s.job_id, s.worker_id, 'manual',
       pg_temp.d('company'), now() - interval '1 hour', NULL, NULL
  FROM public.shift_attendance_confirmations s
 WHERE s.source = 'auto' AND s.response IS NULL
   AND s.job_id IN (pg_temp.d('j:39'), pg_temp.d('j:40'), pg_temp.d('j:42'));

-- 8) PAGAMENTOS (modo A: pagamento externo registrado) + TERMOS DE SERVICO ----------
-- Classes: recorded_ok (registrado e confirmado pelo freela), recorded_pending (registrado, falta o freela
-- confirmar), scheduled (agendado), scheduled_overdue (agendado e vencido), voided (estornado),
-- voided_then_ok (estornado e refeito), recorded_ok_cash (dinheiro). Turnos recentes ficam abertos de proposito.
CREATE TEMP TABLE _p ON COMMIT DROP AS
WITH t AS (SELECT (now() AT TIME ZONE 'America/Sao_Paulo')::date AS today),
base AS (
  SELECT a.id AS app_id, a.job_id, a.worker_id, a.n, a.k, j.kind, j.day, j.end_ts, j.amount, j.responsible_id,
         (t.today - j.day) AS days_ago, ((a.n * 3 + a.k) % 10) AS pc, t.today,
         CASE WHEN (j.end_ts AT TIME ZONE 'America/Sao_Paulo')::date = j.day
              THEN (j.day + time '23:59') AT TIME ZONE 'America/Sao_Paulo' ELSE 'infinity'::timestamptz END AS cap_ts
    FROM _a a JOIN _j j ON j.id = a.job_id CROSS JOIN t
   WHERE a.status = 'completed'
),
c1 AS (
  SELECT base.*,
         CASE
           WHEN kind = 'today_done' THEN CASE WHEN k = 0 THEN 'scheduled' ELSE 'none' END
           WHEN n = 31 THEN 'scheduled_overdue'
           WHEN days_ago <= 8 THEN CASE WHEN pc <= 3 THEN 'recorded_pending' WHEN pc <= 6 THEN 'scheduled' ELSE 'none' END
           ELSE CASE WHEN pc <= 5 THEN 'recorded_ok' WHEN pc = 6 THEN 'recorded_pending' WHEN pc = 7 THEN 'voided'
                     WHEN pc = 8 THEN 'voided_then_ok' ELSE 'recorded_ok_cash' END
         END AS cls,
         LEAST(end_ts + interval '45 minutes', cap_ts, now() - interval '5 minutes') AS paid_ts
    FROM base
)
SELECT c1.*,
       paid_ts AS paid_main
  FROM c1 WHERE cls <> 'none';

CREATE TEMP TABLE _pay ON COMMIT DROP AS
SELECT pg_temp.d('p:' || p.app_id::text) AS id, p.app_id, p.job_id, p.worker_id, p.n, p.k, p.day, p.responsible_id, p.amount,
       CASE WHEN p.cls LIKE 'scheduled%' THEN 'scheduled' ELSE 'recorded' END AS status,
       CASE WHEN p.cls = 'recorded_ok_cash' THEN 'cash' ELSE 'external_pix' END AS source,
       CASE WHEN p.cls LIKE 'scheduled%' THEN NULL ELSE p.paid_main END AS paid_at,
       CASE p.cls WHEN 'scheduled' THEN p.today + 1 + (p.pc % 3)
                  WHEN 'scheduled_overdue' THEN p.day + 2
                  WHEN 'recorded_ok' THEN CASE WHEN p.pc % 2 = 0 THEN p.day + 1 END END AS scheduled_for,
       CASE WHEN p.cls IN ('recorded_ok', 'recorded_ok_cash', 'voided_then_ok')
            THEN LEAST(p.paid_main + interval '3 hours' + (p.pc % 3) * interval '5 hours', now() - interval '1 minute') END AS worker_confirmed_at,
       NULL::timestamptz AS voided_at, NULL::text AS void_reason,
       CASE p.cls WHEN 'recorded_ok_cash' THEN 'Pago em dinheiro no fechamento do turno'
                  WHEN 'voided_then_ok' THEN 'Refeito após estorno'
                  WHEN 'scheduled' THEN 'Pagamento programado para o fechamento da semana'
                  WHEN 'scheduled_overdue' THEN 'Aguardando o repasse do caixa'
                  WHEN 'recorded_pending' THEN CASE WHEN p.pc = 2 THEN 'PIX feito pelo encarregado do turno' END
                  END AS note,
       CASE WHEN p.cls LIKE 'scheduled%' THEN LEAST(p.end_ts + interval '1 hour', now() - interval '5 minutes') ELSE p.paid_main END AS created_at
  FROM _p p WHERE p.cls <> 'voided'
UNION ALL
SELECT pg_temp.d('pv:' || p.app_id::text), p.app_id, p.job_id, p.worker_id, p.n, p.k, p.day, p.responsible_id, p.amount,
       'voided', 'external_pix', p.paid_ts - interval '30 minutes', NULL, NULL,
       p.paid_ts - interval '10 minutes',
       CASE p.cls WHEN 'voided' THEN 'Valor lançado errado — estornado; novo pagamento combinado por fora'
                  ELSE 'Pagamento lançado em duplicidade' END,
       NULL, p.paid_ts - interval '30 minutes'
  FROM _p p WHERE p.cls IN ('voided', 'voided_then_ok');

INSERT INTO public.shift_payments (
  id, job_id, company_id, worker_id, application_id, source, amount, paid_at, recorded_by, worker_confirmed_at,
  note, status, voided_at, void_reason, created_at, scheduled_for)
SELECT p.id, p.job_id, pg_temp.d('company'), p.worker_id, p.app_id, p.source, p.amount, p.paid_at, p.responsible_id,
       p.worker_confirmed_at, p.note, p.status, p.voided_at, p.void_reason, p.created_at, p.scheduled_for
  FROM _pay p;

-- O trigger que gera o termo esta desligado: gera aqui (texto oficial via render_service_term_text).
-- Aceite (accepted_*) so existe onde o freela ja confirmou o recebimento (confirmar exige termo aceito).
INSERT INTO public.service_terms (
  id, shift_payment_id, job_id, worker_id, company_id, term_version, term_text, amount, created_at,
  accepted_at, accepted_ip, accepted_user_agent)
SELECT pg_temp.d('st:' || p.id::text), p.id, p.job_id, p.worker_id, pg_temp.d('company'), 'modelo-worki-v1',
       public.render_service_term_text(w.full_name, pg_temp.cpf_demo(w.idx), 'Restaurante Demo Sabor & Cia',
                                       '00.000.000/0001-00', j.title, p.day, p.amount, 'modelo-worki-v1'),
       p.amount, p.created_at,
       CASE WHEN p.worker_confirmed_at IS NOT NULL THEN p.worker_confirmed_at - interval '2 minutes' END,
       CASE WHEN p.worker_confirmed_at IS NOT NULL THEN '203.0.113.' || (p.n % 200 + 1) END,
       CASE WHEN p.worker_confirmed_at IS NOT NULL THEN 'Mozilla/5.0 (Linux; Android 14; Demo) AppleWebKit/537.36 Chrome/126 Mobile Safari/537.36' END
  FROM _pay p JOIN _w w ON w.id = p.worker_id JOIN _j j ON j.id = p.job_id;

-- 9) AVALIACOES BILATERAIS ------------------------------------------------------
INSERT INTO public.reviews (id, job_id, reviewer_id, reviewed_id, rating, comment, created_at, direction)
SELECT pg_temp.d('rv-w:' || a.id::text), a.job_id, pg_temp.d('company'), a.worker_id, r.rating,
       (CASE r.rating
          WHEN 5 THEN (ARRAY['Pontual e muito educado com os clientes.','Excelente ritmo no salão, vamos chamar de novo.','Atendimento acima da média. Já pode ser da casa.'])[(a.n + a.k) % 3 + 1]
          WHEN 4 THEN (ARRAY['Bom profissional, atencioso com os detalhes.','Cumpriu tudo que combinamos.'])[(a.n + a.k) % 2 + 1]
          ELSE 'Chegou um pouco atrasado, mas compensou no serviço.' END),
       LEAST(j.end_ts + interval '1 day', now() - interval '1 hour'), 'worker'
  FROM _a a JOIN _j j ON j.id = a.job_id
  CROSS JOIN LATERAL (SELECT (ARRAY[5,5,4,5,4,3,5,4])[(a.n * 2 + a.k) % 8 + 1] AS rating) r
 WHERE a.status = 'completed' AND (a.n + a.k) % 4 <> 3
UNION ALL
SELECT pg_temp.d('rv-c:' || a.id::text), a.job_id, a.worker_id, pg_temp.d('company'), r.rating,
       (CASE r.rating
          WHEN 5 THEN (ARRAY['Briefing claro e turno bem conduzido.','Equipe organizada e ambiente respeitoso.','Ótima comunicação antes do turno e pagamento em dia.'])[(a.n + a.k) % 3 + 1]
          WHEN 4 THEN (ARRAY['Tudo conforme combinado, recomendo.','Encarregado atencioso, tudo certo.'])[(a.n + a.k) % 2 + 1]
          ELSE 'Turno puxado, mas bem organizado.' END),
       LEAST(j.end_ts + interval '1 day' + interval '3 hours', now() - interval '1 hour'), 'company'
  FROM _a a JOIN _j j ON j.id = a.job_id
  CROSS JOIN LATERAL (SELECT (ARRAY[5,4,5,5,4,5,3,5])[(a.n + a.k * 3) % 8 + 1] AS rating) r
 WHERE a.status = 'completed' AND (a.n + a.k) % 2 = 0;

-- 10) CONVERSAS (as conversas ja existem, uma por candidatura; aqui entram as mensagens de 15) -----
CREATE TEMP TABLE _chat ON COMMIT DROP AS
SELECT * FROM (
  SELECT x.*, row_number() OVER (ORDER BY (x.widx = 1) DESC, x.dist) AS r
    FROM (
      SELECT DISTINCT ON (a.worker_id) a.id AS app_id, a.worker_id, a.widx, j.n, j.title, a.created_at AS app_created,
             abs(extract(epoch FROM (j.start_ts - now()))) AS dist
        FROM _a a JOIN _j j ON j.id = a.job_id
       WHERE a.status IN ('hired', 'in_progress', 'completed', 'invited')
       ORDER BY a.worker_id, abs(extract(epoch FROM (j.start_ts - now())))
    ) x
) y WHERE r <= 15;

INSERT INTO public."Message" (id, content, createdat, conversationid, senderid, read_at)
SELECT md5('worki-demo-msg:' || c.app_id::text || ':' || m)::text,
       CASE m
         WHEN 1 THEN 'Oi, ' || split_part(w.full_name, ' ', 1) || '! Tudo certo para o turno "' || c.title || '"? Chegue 15 minutos antes, por favor.'
         WHEN 2 THEN (ARRAY['Oi! Confirmado, vou de uniforme preto.','Bom dia! Confirmado, chego 15 min antes.',
                            'Oi, posso levar um colega para ajudar?','Confirmado! Qual a entrada do restaurante?'])[c.r % 4 + 1]
         WHEN 3 THEN (ARRAY['Perfeito. Qualquer coisa me chama por aqui.','A entrada é pela lateral, o responsável vai te receber.',
                            'Pode levar sim, só me avise o nome dele.'])[c.r % 3 + 1]
         ELSE 'Combinado, obrigado!' END,
       now() - c.r * interval '95 minutes' - (4 - m) * interval '9 minutes',
       pg_temp.d('c:' || c.app_id::text)::text,
       CASE WHEN m IN (1, 3) THEN pg_temp.d('company')::text ELSE c.worker_id::text END,
       -- a ultima mensagem fica NAO lida (par: empresa vai ver; impar: freela vai ver); as demais, lidas
       CASE WHEN m = (CASE WHEN c.r % 2 = 0 THEN 4 ELSE 3 END) AND c.r % 3 <> 2 THEN NULL
            ELSE now() - c.r * interval '95 minutes' - (4 - m) * interval '9 minutes' + interval '4 minutes' END
  FROM _chat c JOIN _w w ON w.id = c.worker_id
  CROSS JOIN generate_series(1, 4) m
 WHERE m <= (CASE WHEN c.r % 2 = 0 THEN 4 ELSE 3 END);

-- 11) NOTIFICACOES --------------------------------------------------------------
CREATE FUNCTION pg_temp.jt(p_n int) RETURNS text LANGUAGE sql STABLE AS
$f$ SELECT title FROM _j WHERE n = p_n $f$;
CREATE FUNCTION pg_temp.wname(p_n int, p_k int) RETURNS text LANGUAGE sql STABLE AS
$f$ SELECT w.full_name FROM _a a JOIN _w w ON w.id = a.worker_id WHERE a.job_id = pg_temp.d('j:' || p_n) AND a.k = p_k $f$;

INSERT INTO public.notifications (user_id, type, title, message, link, read_at, created_at)
-- Gestor (empresa)
SELECT pg_temp.d('company'), 'status_change', 'Freela aceitou o convite',
       pg_temp.wname(39, 0) || ' aceitou o turno "' || pg_temp.jt(39) || '".',
       '/company/jobs/' || pg_temp.d('j:39') || '/candidates', NULL::timestamptz, now() - interval '20 minutes'
UNION ALL SELECT pg_temp.d('company'), 'status_change', 'Chamado ainda aberto',
       'Seu chamado para "' || pg_temp.jt(41) || '" segue aberto: ainda faltam vagas e ninguém aceitou.',
       '/company/jobs/' || pg_temp.d('j:41') || '/candidates', NULL, now() - interval '2 hours'
UNION ALL SELECT pg_temp.d('company'), 'message', 'Nova mensagem',
       (SELECT w.full_name FROM _chat c JOIN _w w ON w.id = c.worker_id WHERE c.r = 2) || ' enviou uma mensagem.',
       '/company/messages', NULL, now() - interval '3 hours'
UNION ALL SELECT pg_temp.d('company'), 'system', 'Exceção de presença aguardando decisão',
       'Um freela pediu exceção de presença no turno "' || pg_temp.jt(35) || '" (celular sem bateria).',
       '/company/jobs/' || pg_temp.d('j:35') || '/candidates', NULL, now() - interval '14 minutes'
UNION ALL SELECT pg_temp.d('company'), 'payment', 'Freela confirmou o recebimento',
       (SELECT w.full_name FROM _pay p JOIN _w w ON w.id = p.worker_id WHERE p.worker_confirmed_at IS NOT NULL ORDER BY p.worker_confirmed_at DESC LIMIT 1)
         || ' confirmou que recebeu o pagamento do turno.',
       '/company/jobs/' || (SELECT p.job_id FROM _pay p WHERE p.worker_confirmed_at IS NOT NULL ORDER BY p.worker_confirmed_at DESC LIMIT 1) || '/candidates',
       now() - interval '4 hours', now() - interval '5 hours'
UNION ALL SELECT pg_temp.d('company'), 'status_change', 'Freela recusou o convite',
       (SELECT w.full_name FROM _a a JOIN _w w ON w.id = a.worker_id WHERE a.status = 'declined' ORDER BY a.created_at DESC LIMIT 1)
         || ' recusou um convite de turno. Sem problema, a vaga segue aberta.',
       '/company/jobs', now() - interval '20 hours', now() - interval '1 day'
UNION ALL SELECT pg_temp.d('company'), 'system', 'Certificação vence em breve',
       (SELECT w.full_name || ' — ' || c.title || ' vence em ' || (c.expires_at - (now() AT TIME ZONE 'America/Sao_Paulo')::date) || ' dias.'
          FROM public.worker_certifications c JOIN _w w ON w.id = c.worker_id
         WHERE c.expires_at > (now() AT TIME ZONE 'America/Sao_Paulo')::date ORDER BY c.expires_at LIMIT 1),
       '/company/team', now() - interval '40 hours', now() - interval '2 days'
UNION ALL SELECT pg_temp.d('company'), 'system', 'Encarregada aguardando confirmação',
       'Letícia Moura entrou na equipe pelo link. É ela?', '/company/configuracoes/equipe', NULL, now() - interval '1 day'
UNION ALL SELECT pg_temp.d('company'), 'payment', 'Pagamentos a registrar',
       'Há turnos concluídos nesta semana sem pagamento registrado.', '/company/gestao', NULL, now() - interval '4 hours'
UNION ALL SELECT pg_temp.d('company'), 'status_change', 'Vaga do SOS preenchida em minutos',
       pg_temp.wname(53, 0) || ' aceitou o SOS de hoje. Ainda resta 1 vaga.',
       '/company/jobs/' || pg_temp.d('j:53') || '/candidates', NULL::timestamptz, now() - interval '20 minutes'
-- Gestor 2 / Encarregados
UNION ALL SELECT pg_temp.d('u:gestor2'), 'system', 'Bem-vinda à equipe', 'Você foi confirmada como Gestora de Sabor & Cia.', '/company/dashboard', now() - interval '58 days', now() - interval '59 days'
UNION ALL SELECT pg_temp.d('u:enc.centro'), 'status_change', 'Turno de hoje em andamento',
       'O turno "' || pg_temp.jt(36) || '" tem presença registrada.', '/company/hoje', NULL, now() - interval '3 hours'
UNION ALL SELECT pg_temp.d('u:enc.centro'), 'system', 'Você cobre a Loja Norte',
       'Você cobre a Simone Tavares (Loja Norte) nos próximos dias.', '/company/hoje', now() - interval '2 days', now() - interval '3 days'
UNION ALL SELECT pg_temp.d('u:enc.norte'), 'status_change', 'Freela confirmou presença', 'Confirmações de véspera chegando para amanhã.', '/company/hoje', NULL, now() - interval '1 hour'
-- Freela demo (freela@demo.worki.test)
UNION ALL SELECT pg_temp.d('w:1'), 'payment', 'Pagamento registrado — confirme',
       'Restaurante Demo Sabor & Cia registrou o pagamento de R$ ' || to_char(p.amount, 'FM999G990D00') || '. Abra o recibo e confirme.',
       '/recibo/' || p.job_id, NULL, now() - interval '3 hours'
  FROM (SELECT job_id, amount FROM _pay WHERE worker_id = pg_temp.d('w:1') AND status = 'recorded' AND worker_confirmed_at IS NULL ORDER BY created_at DESC LIMIT 1) p
UNION ALL SELECT pg_temp.d('w:1'), 'payment', 'Pagamento agendado',
       'Restaurante Demo Sabor & Cia agendou o pagamento de R$ ' || to_char(p.amount, 'FM999G990D00') || '. Você não precisa fazer nada agora.',
       '/recibo/' || p.job_id, NULL, now() - interval '1 hour'
  FROM (SELECT job_id, amount FROM _pay WHERE worker_id = pg_temp.d('w:1') AND status = 'scheduled' ORDER BY created_at DESC LIMIT 1) p
UNION ALL SELECT pg_temp.d('w:1'), 'status_change', 'Convite de turno',
       'Restaurante Demo Sabor & Cia convidou você para "' || pg_temp.jt(38) || '". Responda no app.', '/my-jobs', NULL, now() - interval '30 minutes'
UNION ALL SELECT pg_temp.d('w:1'), 'status_change', 'Confirme sua presença',
       'Você confirma presença amanhã em "' || pg_temp.jt(39) || '"?', '/my-jobs', NULL, now() - interval '2 hours'
UNION ALL SELECT pg_temp.d('w:1'), 'message', 'Nova mensagem da empresa', 'Restaurante Demo Sabor & Cia enviou uma mensagem.', '/messages', NULL, now() - interval '95 minutes'
UNION ALL SELECT pg_temp.d('w:1'), 'status_change', 'Você recebeu uma avaliação', 'A empresa avaliou seu último turno com 5 estrelas.', '/my-jobs', now() - interval '2 days', now() - interval '3 days'
-- Outros freelas
UNION ALL SELECT c.worker_id, 'system', 'Certificacao vence em breve',
       'Sua certificacao "' || c.title || '" vence em ' || to_char(c.expires_at, 'DD/MM/YYYY') || '. Renove e atualize no seu perfil.',
       '/profile', NULL, now() - interval '1 day'
  FROM public.worker_certifications c
 WHERE c.worker_id IN (SELECT id FROM _w) AND c.expires_at > (now() AT TIME ZONE 'America/Sao_Paulo')::date
   AND c.expires_at <= (now() AT TIME ZONE 'America/Sao_Paulo')::date + 30
UNION ALL SELECT c.worker_id, 'system', 'Certificacao vencida',
       'Sua certificacao "' || c.title || '" venceu em ' || to_char(c.expires_at, 'DD/MM/YYYY') || '. Atualize no seu perfil.',
       '/profile', NULL, now() - interval '3 days'
  FROM public.worker_certifications c
 WHERE c.worker_id IN (SELECT id FROM _w) AND c.expires_at <= (now() AT TIME ZONE 'America/Sao_Paulo')::date
   AND c.expires_at >= (now() AT TIME ZONE 'America/Sao_Paulo')::date - 30
UNION ALL SELECT pg_temp.d('w:29'), 'status_change', 'Chamado SOS aceito', 'Você garantiu uma vaga de garçom hoje. A empresa foi avisada.', '/my-jobs', NULL, now() - interval '20 minutes'
UNION ALL SELECT pg_temp.d('w:31'), 'system', 'Indicação de empresa', 'Pizzaria Demo Parceira indicou você para Restaurante Demo Sabor & Cia. Responda quando quiser.', '/recebimentos', NULL, now() - interval '2 days';

-- 12) AGREGADOS (os triggers que recalculam XP/nota estao desligados; recalcula aqui) -----
UPDATE public.workers SET xp = 75, level = public.worker_level_for_xp(75), completed_jobs_count = 0, earnings_total = 0
 WHERE id IN (SELECT id FROM _w);
UPDATE public.workers w
   SET completed_jobs_count = s.cnt, earnings_total = s.earn,
       xp = s.cnt * 100 + 75, level = public.worker_level_for_xp(s.cnt * 100 + 75)
  FROM (SELECT a.worker_id, count(*)::int AS cnt, sum(j.amount) AS earn
          FROM _a a JOIN _j j ON j.id = a.job_id WHERE a.status = 'completed' GROUP BY a.worker_id) s
 WHERE w.id = s.worker_id;
UPDATE public.workers w SET rating_average = r.av, reviews_count = r.cnt
  FROM (SELECT reviewed_id, round(avg(rating)::numeric, 2) AS av, count(*)::int AS cnt
          FROM public.reviews WHERE direction = 'worker' AND job_id IN (SELECT id FROM _j) GROUP BY reviewed_id) r
 WHERE w.id = r.reviewed_id;
UPDATE public.companies c SET rating_average = r.av, reviews_count = r.cnt
  FROM (SELECT reviewed_id, round(avg(rating)::numeric, 2) AS av, count(*)::int AS cnt
          FROM public.reviews WHERE direction = 'company' AND job_id IN (SELECT id FROM _j) GROUP BY reviewed_id) r
 WHERE c.id = r.reviewed_id;

-- Conferencia rapida (aparece no resultado do comando)
SELECT
  (SELECT count(*) FROM public.jobs WHERE company_id = pg_temp.d('company')) AS turnos,
  (SELECT count(*) FROM public.applications WHERE job_id IN (SELECT id FROM _j)) AS candidaturas,
  (SELECT count(*) FROM public.shift_payments WHERE company_id = pg_temp.d('company')) AS pagamentos,
  (SELECT count(*) FROM public.reviews WHERE job_id IN (SELECT id FROM _j)) AS avaliacoes,
  (SELECT count(*) FROM public."Message" WHERE conversationid IN (SELECT id FROM public."Conversation" WHERE application_uuid IN (SELECT id FROM _a))) AS mensagens,
  (SELECT count(*) FROM public.workers WHERE id IN (SELECT id FROM _w)) AS freelas;

-- Conferencias de coerencia: abortam (ROLLBACK de tudo) se algo estiver inconsistente.
DO $chk$
DECLARE v_bad int;
BEGIN
  -- nunca mais gente ocupando/aguardando a vaga do que jobs.slots
  SELECT count(*) INTO v_bad FROM public.jobs j
   WHERE j.company_id = pg_temp.d('company')
     AND (SELECT count(*) FROM public.applications a WHERE a.job_id = j.id
           AND a.status IN ('hired', 'in_progress', 'completed', 'invited')) > j.slots
     AND j.status <> 'deleted';
  IF v_bad > 0 THEN RAISE EXCEPTION 'seed incoerente: % turno(s) com mais candidaturas ativas do que vagas', v_bad; END IF;

  -- historico so na funcao do freela
  SELECT count(*) INTO v_bad FROM _a a JOIN _j j ON j.id = a.job_id JOIN _w w ON w.id = a.worker_id
   WHERE a.kind <> 'sos' AND NOT (w.role1 = j.role OR w.role2 = j.role);
  IF v_bad > 0 THEN RAISE EXCEPTION 'seed incoerente: % candidatura(s) fora da funcao do freela', v_bad; END IF;

  -- Gasto (Operacao, soma shift_payments recorded por paid_at) == Pago (Pagamentos): so diverge se o pagamento
  -- cair em dia diferente do turno; confere que todo recorded foi no mesmo dia local do turno
  SELECT count(*) INTO v_bad FROM public.shift_payments sp JOIN public.jobs j ON j.id = sp.job_id
   WHERE sp.company_id = pg_temp.d('company') AND sp.status = 'recorded'
     AND (sp.paid_at AT TIME ZONE 'America/Sao_Paulo')::date <> (j.start_date AT TIME ZONE 'America/Sao_Paulo')::date
     AND j.work_end_time > j.work_start_time;
  IF v_bad > 0 THEN RAISE EXCEPTION 'seed incoerente: % pagamento(s) em dia diferente do turno', v_bad; END IF;

  -- chamados preenchidos precisam de first_claim_at e de aceite
  SELECT count(*) INTO v_bad FROM public.shift_calls c
   WHERE c.company_id = pg_temp.d('company') AND c.status = 'filled'
     AND (c.first_claim_at IS NULL OR NOT EXISTS (SELECT 1 FROM public.shift_call_targets t WHERE t.call_id = c.id AND t.response = 'accepted'));
  IF v_bad > 0 THEN RAISE EXCEPTION 'seed incoerente: chamado preenchido sem aceite'; END IF;
END
$chk$;

COMMIT;
