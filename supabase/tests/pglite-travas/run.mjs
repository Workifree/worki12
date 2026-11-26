// Executa 20261126000700 no PGlite: cada falha passa ANTES, e barrada DEPOIS, e os fluxos legitimos seguem.
// Uso, da raiz: npx -y -p @electric-sql/pglite@0.6.0 node supabase/tests/pglite-travas/run.mjs
// Limite: schema minimo (stub das colunas, policies relevantes e helpers), nao e o catalogo de producao.
import { readFileSync, existsSync } from 'node:fs';
import { delimiter, dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

async function loadPglite() {
  try { return await import('@electric-sql/pglite'); } catch {
    for (const entry of (process.env.PATH ?? process.env.Path ?? '').split(delimiter)) {
      const c = join(entry, '..', '@electric-sql', 'pglite', 'dist', 'index.js');
      if (existsSync(c)) return import(pathToFileURL(c).href);
    }
    if (process.env.PGLITE_DIST) return import(pathToFileURL(process.env.PGLITE_DIST).href);
    throw new Error('PGlite nao encontrado.');
  }
}
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const MIG = readFileSync(join(root, 'migrations', '20261126000700_travas_de_integridade.sql'), 'utf8').replace(/\r\n/g, '\n');

const id = (n) => `00000000-0000-0000-0000-0000000000${String(n).padStart(2, '0')}`;
const EMP_A = id(1), EMP_B = id(2), W = id(3), W2 = id(4), GER = id(5), NOVO = id(6);
const JOB_A = id(11), JOB_B = id(12), APP_A = id(13), APP_B = id(14), TC = id(15);

const STUB = `
CREATE ROLE authenticated; CREATE ROLE service_role BYPASSRLS;
CREATE SCHEMA auth; CREATE SCHEMA storage;
CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('test.uid', true), '')::uuid $$;
CREATE TABLE public.workers (id uuid PRIMARY KEY, full_name text, phone text, city text, primary_role text, experience_years text,
  bio text, availability jsonb, availability_days jsonb, goal text, roles jsonb, avatar_url text, cover_url text, pix_key text,
  cpf text, birth_date date, onboarding_completed boolean DEFAULT false, accepted_tos boolean DEFAULT false, tos_version text,
  tos_accepted_at timestamptz, badges_hidden boolean DEFAULT false, accepts_referrals boolean DEFAULT true,
  discoverable_for_sos boolean DEFAULT false, updated_at timestamptz DEFAULT now(), created_at timestamptz DEFAULT now(),
  level int DEFAULT 1, xp int DEFAULT 0, earnings_total numeric(10,2) DEFAULT 0.00, completed_jobs_count int DEFAULT 0,
  reviews_count int DEFAULT 0, rating_average numeric, recommendation_score numeric DEFAULT 0, views int DEFAULT 0,
  profile_views int DEFAULT 0, verified_identity boolean DEFAULT false, tags text[] DEFAULT '{}', anonymized_at timestamptz);
CREATE TABLE public.companies (id uuid PRIMARY KEY, owner_id uuid, organization_id uuid, name text, cnpj text, address text,
  industry text, size text, description text, website text, email text, logo_url text, cover_url text, company_type text,
  city text, default_briefing text, link_risk_alert_enabled boolean DEFAULT true, link_risk_alert_threshold int DEFAULT 2,
  onboarding_completed boolean DEFAULT false, accepted_tos boolean DEFAULT false, tos_version text, tos_accepted_at timestamptz,
  rating_average numeric(3,2) DEFAULT 5.00, reviews_count int DEFAULT 0, created_at timestamptz DEFAULT now(), anonymized_at timestamptz);
CREATE TABLE public.team_connections (id uuid PRIMARY KEY, company_id uuid, worker_id uuid, status text, source text,
  blocked_by uuid, created_at timestamptz DEFAULT now(), accepted_at timestamptz, updated_at timestamptz, invited_by uuid);
CREATE TABLE public.notifications (id serial PRIMARY KEY, user_id uuid, type text, title text, message text, link text, read_at timestamptz);
CREATE TABLE public.jobs (id uuid PRIMARY KEY, company_id uuid);
CREATE TABLE public.applications (id uuid PRIMARY KEY, job_id uuid, worker_id uuid);
CREATE TABLE public.shift_payments (id serial PRIMARY KEY, job_id uuid, company_id uuid, worker_id uuid, application_id uuid, amount numeric);
CREATE TABLE public.service_terms (payment_id int, company_id uuid, term_text text);
CREATE TABLE public."Conversation" (id text PRIMARY KEY, application_uuid uuid, islocked boolean);
CREATE TABLE storage.objects (id serial PRIMARY KEY, bucket_id text, name text, owner uuid);

-- GER = gerente (nao dono) da empresa A
CREATE FUNCTION public.is_company_owner(c uuid) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER AS
  $$ SELECT c = auth.uid() OR (c = '${EMP_A}' AND auth.uid() = '${GER}') $$;
CREATE FUNCTION public.can_access_application(a text) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER AS
  $$ SELECT EXISTS (SELECT 1 FROM public.applications x JOIN public.jobs j ON j.id = x.job_id
       WHERE x.id::text = a AND (x.worker_id = auth.uid() OR public.is_company_owner(j.company_id))) $$;
CREATE FUNCTION public.generate_term() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER AS
  $$ BEGIN INSERT INTO public.service_terms SELECT NEW.id, NEW.company_id, w.cpf FROM public.workers w WHERE w.id = NEW.worker_id; RETURN NEW; END $$;
CREATE TRIGGER trg_term AFTER INSERT ON public.shift_payments FOR EACH ROW EXECUTE FUNCTION public.generate_term();
CREATE FUNCTION public.award_xp() RETURNS trigger LANGUAGE plpgsql AS
  $$ BEGIN IF OLD.avatar_url IS NULL AND NEW.avatar_url IS NOT NULL THEN NEW.xp := NEW.xp + 50; END IF; RETURN NEW; END $$;
CREATE TRIGGER trigger_award_xp_on_photo BEFORE UPDATE OF avatar_url ON public.workers FOR EACH ROW EXECUTE FUNCTION public.award_xp();
-- escrita legitima do servidor (RPC DEFINER)
CREATE FUNCTION public.srv_recompute(p uuid) RETURNS void LANGUAGE sql SECURITY DEFINER AS
  $$ UPDATE public.workers SET xp = 300, level = 4, rating_average = 4.5, reviews_count = 2 WHERE id = p $$;
CREATE FUNCTION public.srv_notify(p uuid) RETURNS void LANGUAGE sql SECURITY DEFINER AS
  $$ INSERT INTO public.notifications(user_id, link) VALUES (p, '/recibo/x') $$;

GRANT USAGE ON SCHEMA public, auth, storage TO authenticated, service_role;
GRANT ALL ON ALL TABLES IN SCHEMA public, storage TO authenticated, service_role;
GRANT ALL ON ALL SEQUENCES IN SCHEMA public, storage TO authenticated, service_role;

ALTER TABLE public.team_connections ENABLE ROW LEVEL SECURITY;
CREATE POLICY s ON public.team_connections FOR SELECT USING (worker_id = auth.uid() OR public.is_company_owner(company_id));
CREATE POLICY tc_update_worker ON public.team_connections FOR UPDATE USING (worker_id = auth.uid())
  WITH CHECK (worker_id = auth.uid() AND status IN ('accepted','blocked'));
CREATE POLICY tc_update_company ON public.team_connections FOR UPDATE USING (public.is_company_owner(company_id) AND status <> 'blocked')
  WITH CHECK (public.is_company_owner(company_id) AND status IN ('pending','blocked'));

ALTER TABLE public."Conversation" ENABLE ROW LEVEL SECURITY;
CREATE POLICY conversation_select ON public."Conversation" FOR SELECT USING (public.can_access_application(application_uuid::text));
CREATE POLICY "conversation_insert_participants" ON public."Conversation" FOR INSERT WITH CHECK (public.can_access_application(application_uuid::text));
CREATE POLICY "conversation_update_participants" ON public."Conversation" FOR UPDATE
  USING (public.can_access_application(application_uuid::text)) WITH CHECK (public.can_access_application(application_uuid::text));

ALTER TABLE storage.objects ENABLE ROW LEVEL SECURITY;
CREATE POLICY sel ON storage.objects FOR SELECT USING (bucket_id = 'avatars');
CREATE POLICY "Authenticated users can upload avatars" ON storage.objects FOR INSERT WITH CHECK (bucket_id = 'avatars');
CREATE POLICY "Users can update own avatars" ON storage.objects FOR UPDATE USING (bucket_id = 'avatars' AND auth.uid() = owner);

INSERT INTO public.workers(id, cpf) VALUES ('${W}', '00000000191'), ('${W2}', NULL);
INSERT INTO public.companies(id, owner_id, name) VALUES ('${EMP_A}', '${EMP_A}', 'A'), ('${EMP_B}', '${EMP_B}', 'B');
INSERT INTO public.jobs VALUES ('${JOB_A}', '${EMP_A}'), ('${JOB_B}', '${EMP_B}');
INSERT INTO public.applications VALUES ('${APP_A}', '${JOB_A}', '${W}'), ('${APP_B}', '${JOB_B}', '${W}');
INSERT INTO public.team_connections(id, company_id, worker_id, status, source) VALUES ('${TC}', '${EMP_A}', '${W}', 'accepted', 'link');
INSERT INTO public."Conversation" VALUES ('conv', '${APP_A}', false);
`;

const { PGlite } = await loadPglite();
let passed = 0, failed = 0;
const check = (label, cond, extra = '') => {
  if (cond) { passed++; console.log('ok    ', label); } else { failed++; console.log('FALHOU', label, extra); }
};

// Roda `sql` como cliente `uid`, em transacao desfeita. `setup` roda antes, como dono.
async function as(db, uid, sql, setup = '', role = 'authenticated') {
  await db.exec('BEGIN');
  try {
    if (setup) await db.exec(setup);
    await db.exec(`SELECT set_config('test.uid', '${uid}', true); SET LOCAL ROLE ${role}`);
    const res = await db.query(sql);
    return { ok: (res.affectedRows ?? 0) > 0 || res.rows.length > 0, n: res.affectedRows, rows: res.rows };
  } catch (e) {
    return { ok: false, error: `${e.code} ${e.message}` };
  } finally {
    await db.exec('ROLLBACK');
  }
}

const blockedByCompany = `UPDATE public.team_connections SET status='blocked', blocked_by='${EMP_A}'`;
const pending = `UPDATE public.team_connections SET status='pending'`;
const pay = (company, job, app, worker = W) =>
  `INSERT INTO public.shift_payments(job_id, company_id, worker_id, application_id, amount) VALUES ('${job}','${company}','${worker}',${app ? `'${app}'` : 'NULL'},10) RETURNING id`;
const notif = (to, link) => `INSERT INTO public.notifications(user_id, link) VALUES ('${to}', ${link ? `'${link}'` : 'NULL'})`;
const upload = (folder, owner) => `INSERT INTO storage.objects(bucket_id, name, owner) VALUES ('avatars', '${folder}/x.png', '${owner}')`;
const wset = (set) => `UPDATE public.workers SET ${set} WHERE id='${W}'`;
const cset = (set) => `UPDATE public.companies SET ${set} WHERE id='${EMP_A}'`;

const attacks = [
  ['freela reaponta vinculo para outra empresa', W, `UPDATE public.team_connections SET company_id='${EMP_B}', status='accepted'`],
  ['freela desfaz bloqueio da empresa', W, `UPDATE public.team_connections SET status='accepted', blocked_by=NULL`, blockedByCompany],
  ['freela toma para si o bloqueio da empresa', W, `UPDATE public.team_connections SET status='blocked', blocked_by='${W}'`, blockedByCompany],
  ['freela forja origem do vinculo', W, `UPDATE public.team_connections SET source='qr', status='accepted'`],
  ['empresa troca o freela do vinculo', EMP_A, `UPDATE public.team_connections SET worker_id='${W2}'`, pending],
  ...['rating_average=5', 'reviews_count=999', 'verified_identity=true', 'xp=9999', 'level=99', 'earnings_total=9999',
    'completed_jobs_count=99', 'recommendation_score=99', "tags=ARRAY['top']", 'views=99', 'profile_views=99',
    "created_at='2000-01-01'", 'anonymized_at=now()'].map((s) => [`freela grava workers.${s}`, W, wset(s)]),
  ['conta nova cria perfil de freela com reputacao', NOVO, `INSERT INTO public.workers(id, rating_average, reviews_count, verified_identity) VALUES ('${NOVO}',5,500,true)`],
  ...['rating_average=1', 'reviews_count=999', "created_at='2000-01-01'", 'anonymized_at=now()'].map((s) => [`gerente grava companies.${s}`, GER, cset(s)]),
  ['conta nova cria empresa com reputacao', NOVO, `INSERT INTO public.companies(id, owner_id, reviews_count) VALUES ('${NOVO}','${NOVO}',500)`],
  ['aviso a terceiro com link /convite', W, notif(EMP_A, '/convite/abc')],
  ['aviso a terceiro com link externo', EMP_A, notif(W, 'https://exemplo.invalid/')],
  ['aviso a terceiro com rota valida + sufixo', EMP_A, notif(W, '/my-jobs/../convite/x')],
  ['pagamento sem candidatura (CPF de estranho no termo)', EMP_B, pay(EMP_B, JOB_B, null, W2)],
  ['pagamento com candidatura de outro turno', EMP_B, pay(EMP_B, JOB_B, APP_A)],
  ['pagamento com candidatura de outro freela', EMP_A, pay(EMP_A, JOB_A, APP_A, W2)],
  ['participante reaponta conversa', W, `UPDATE public."Conversation" SET application_uuid='${APP_B}'`],
  ['upload na pasta de outra conta', W, upload(EMP_A, W)],
  ['upload na raiz do bucket', W, `INSERT INTO storage.objects(bucket_id, name, owner) VALUES ('avatars','x.png','${W}')`],
  ['mover arquivo proprio para pasta alheia', W, `UPDATE storage.objects SET name='${EMP_A}/y.png'`, upload(W, W)],
];

const legit = [
  ['freela aceita vinculo pendente', W, `UPDATE public.team_connections SET status='accepted', accepted_at=now()`, pending],
  ['freela bloqueia a empresa', W, `UPDATE public.team_connections SET status='blocked', blocked_by='${W}'`],
  ['freela desfaz o PROPRIO bloqueio', W, `UPDATE public.team_connections SET status='accepted', blocked_by=NULL`, `UPDATE public.team_connections SET status='blocked', blocked_by='${W}'`],
  ['Gestor bloqueia', GER, `UPDATE public.team_connections SET status='blocked', blocked_by='${GER}'`],
  ['freela edita perfil', W, wset("full_name='n', city='c', phone='1', bio='b', pix_key='k', cpf='1', primary_role='r', roles='[\"r\"]', availability_days='{}', updated_at=now()")],
  ['freela aceita Termos', W, wset("accepted_tos=true, tos_version='v1', tos_accepted_at=now()")],
  ['freela troca flags de consentimento', W, wset('badges_hidden=true, accepts_referrals=false, discoverable_for_sos=true')],
  ['upload de foto (trigger de XP segue)', W, wset("avatar_url='u'") + ' RETURNING xp'],
  ['onboarding do freela (insert)', NOVO, `INSERT INTO public.workers(id, full_name, cpf, birth_date, pix_key, roles, primary_role, experience_years, bio, availability, availability_days, goal, onboarding_completed, accepted_tos, tos_version, tos_accepted_at, phone, city) VALUES ('${NOVO}','n','1','2000-01-01','k','[]','r','1','b','[]','{}','g',true,true,'v1',now(),'1','c')`],
  ['onboarding do freela (upsert sobre linha com XP)', W, `INSERT INTO public.workers(id, full_name, onboarding_completed) VALUES ('${W}','n',true) ON CONFLICT (id) DO UPDATE SET full_name=excluded.full_name`, `UPDATE public.workers SET xp=500, level=6, rating_average=4`],
  ['onboarding da empresa (insert)', NOVO, `INSERT INTO public.companies(id, owner_id, name, cnpj, company_type, industry, city, size, onboarding_completed, accepted_tos, tos_version, tos_accepted_at) VALUES ('${NOVO}','${NOVO}','n','1','t','i','c','s',true,true,'v1',now())`],
  ['gerente edita perfil e logo', GER, cset("name='n', industry='i', description='d', website='w', email='e', address='a', default_briefing='b', link_risk_alert_enabled=false, link_risk_alert_threshold=3, logo_url='l', cover_url='c'")],
  ['aviso do chamado ao freela', EMP_A, notif(W, '/my-jobs')],
  ['aviso de aceite a empresa', W, notif(EMP_A, `/company/jobs/${JOB_A}/candidates`)],
  ['aviso sem link', W, notif(EMP_A, null)],
  ['aviso para si mesmo com qualquer rota', W, notif(W, '/recebimentos')],
  ['marcar aviso como lido (link do sistema)', W, 'UPDATE public.notifications SET read_at=now()', notif(W, '/recibo/abc')],
  ['pagamento com a candidatura certa', EMP_A, pay(EMP_A, JOB_A, APP_A)],
  ['participante cria conversa', W, `INSERT INTO public."Conversation" VALUES ('c2','${APP_B}',false)`],
  ['freela envia foto na propria pasta', W, upload(W, W)],
  ['gerente envia logo na pasta da empresa', GER, upload(EMP_A, GER)],
  ['freela sobrescreve a propria foto', W, `UPDATE storage.objects SET owner='${W}'`, upload(W, W)],
];

const db = new PGlite();
await db.exec(STUB);

console.log('--- antes (a falha reproduz)');
for (const [label, uid, sql, setup] of attacks) {
  const r = await as(db, uid, sql, setup);
  check(`antes: ${label}`, r.ok, r.error);
}

await db.exec(MIG);
await db.exec(MIG);
check('migration aplica e reaplica', true);

console.log('--- depois (barrado)');
for (const [label, uid, sql, setup] of attacks) {
  const r = await as(db, uid, sql, setup);
  // barrado = erro 42501 (trigger ou RLS) ou 0 linhas (policy removida)
  check(`barrado: ${label}`, !r.ok && (!r.error || r.error.startsWith('42501')), r.error ?? `linhas=${r.n}`);
}

console.log('--- depois (fluxos legitimos)');
for (const [label, uid, sql, setup] of legit) {
  const r = await as(db, uid, sql, setup);
  check(`legitimo: ${label}`, r.ok, r.error ?? '0 linhas');
}
const xp = await as(db, W, wset("avatar_url='u'") + ' RETURNING xp');
check('foto continua somando 50 XP', xp.rows?.[0]?.xp === 50);

console.log('--- servidor');
for (const [label, sql, role] of [
  ['RPC DEFINER recalcula reputacao', `SELECT srv_recompute('${W}')`, 'authenticated'],
  ['RPC DEFINER avisa com outra rota', `SELECT srv_notify('${EMP_A}')`, 'authenticated'],
  ['service_role grava campo de confianca', wset('verified_identity=true'), 'service_role'],
  ['service_role grava pagamento sem candidatura', pay(EMP_B, JOB_B, null), 'service_role'],
]) {
  const r = await as(db, W, sql, '', role);
  check(`servidor: ${label}`, r.ok, r.error);
}

console.log(`\n${passed} ok, ${failed} falhas`);
process.exit(failed ? 1 : 0);
