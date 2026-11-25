// Presenca verificada (20261127000100-000400) no PGlite, por cima do codigo REAL de
// validate_application_update, applications_{insert,update}_guard, profile_trust_guard e
// create_job_series. Uso, da raiz:
//   npx -y -p @electric-sql/pglite@0.6.0 node supabase/tests/pglite-presenca/run.mjs
// Limite: schema minimo (stub); seam simplificado (Gestor, ou encarregado responsavel).
import { readFileSync, existsSync } from 'node:fs';
import { delimiter, dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

async function load(sub) {
  try { return await import(sub ? `@electric-sql/pglite/${sub}` : '@electric-sql/pglite'); } catch {
    const file = sub ? `${sub}.js` : 'index.js';
    for (const entry of (process.env.PATH ?? process.env.Path ?? '').split(delimiter)) {
      const c = join(entry, '..', '@electric-sql', 'pglite', 'dist', file);
      if (existsSync(c)) return import(pathToFileURL(c).href);
    }
    throw new Error('PGlite nao encontrado.');
  }
}
const dir = join(resolve(dirname(fileURLToPath(import.meta.url)), '..', '..'), 'migrations');
const read = (n) => readFileSync(join(dir, `${n}.sql`), 'utf8').replace(/\r\n/g, '\n');
const between = (s, a, b) => {
  const i = s.indexOf(a), j = s.indexOf(b, i);
  if (i < 0 || j < 0) throw new Error(`marcador ausente: ${a}`);
  return s.slice(i, j);
};
const VALIDATE = between(read('20260622000300_invite_accept_hired_transition'),
  'CREATE OR REPLACE FUNCTION public.validate_application_update()', '\n$$;') + '\n$$;';
const SEAM_FIX = read('20260824000200_trigger_de_application_conhece_gerente');
const INS = read('20261125000100_applications_insert_hardening');
const UPD = read('20261125000200_applications_update_hardening');
const TRUST = between(read('20261126000700_travas_de_integridade'),
  'CREATE OR REPLACE FUNCTION public.profile_trust_guard()', 'DROP TRIGGER IF EXISTS trg_zz_workers_trust_guard');
const SERIES = between(read('20260817000400_job_series'),
  'CREATE OR REPLACE FUNCTION public.create_job_series(', 'COMMENT ON FUNCTION public.create_job_series');
const P = ['20261127000100_presenca_p1_locais', '20261127000200_presenca_p2_politica_turno',
  '20261127000300_presenca_p3_verificacao'].map(read);
const IDX = read('20261127000400_presenca_indices');

const id = (n) => `00000000-0000-0000-0000-0000000000${String(n).padStart(2, '0')}`;
const GESTOR = id(1), OUTRA = id(2), W = id(3), W2 = id(4), ENC = id(5), ENC2 = id(6), NOVO = id(7);

const STUB = `
CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role BYPASSRLS;
GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO anon, authenticated, service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON FUNCTIONS TO anon, authenticated, service_role;
CREATE SCHEMA auth; GRANT USAGE ON SCHEMA auth TO anon, authenticated, service_role;
CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('test.uid', true), '')::uuid $$;

CREATE TABLE public.companies (id uuid PRIMARY KEY, owner_id uuid, organization_id uuid, name text,
  created_at timestamptz DEFAULT now(), anonymized_at timestamptz);
CREATE TABLE public.workers (id uuid PRIMARY KEY, anonymized_at timestamptz);
CREATE TABLE public.members (company_id uuid, user_id uuid);
CREATE TABLE public.job_series (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), company_id uuid, recurrence_type text,
  weekdays int[], range_start_date date, range_end_date date, occurrences_generated int, status text, created_by uuid);
CREATE TABLE public.jobs (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), company_id uuid, title text, category text,
  type text, description text, requirements text, briefing text, location text, budget numeric, budget_type text,
  start_date timestamptz, scope text, work_start_time time, work_end_time time, has_lunch bool, slots int,
  status text, series_id uuid, series_occurrence_date date, responsible_id uuid);
CREATE TABLE public.applications (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), job_id uuid, worker_id uuid,
  status text, cover_letter text, message text, created_at timestamptz DEFAULT now(),
  worker_checkin_at timestamptz, worker_checkout_at timestamptz, company_checkin_confirmed_at timestamptz,
  company_checkout_confirmed_at timestamptz, invited_by_company_at timestamptz, invitation_expires_at timestamptz,
  invitation_response text, invitation_responded_at timestamptz);
CREATE TABLE public.notifications (user_id uuid, type text, title text, message text, link text);

CREATE FUNCTION public.is_company_owner(c uuid) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER AS
 $$ SELECT EXISTS (SELECT 1 FROM public.companies x WHERE x.id = c AND (x.id = auth.uid() OR x.owner_id = auth.uid())) $$;
CREATE FUNCTION public.session_company_member_confirmed(c uuid) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER AS
 $$ SELECT EXISTS (SELECT 1 FROM public.members m WHERE m.company_id = c AND m.user_id = auth.uid()) $$;
CREATE FUNCTION public.is_job_owner(p uuid) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER AS
 $$ SELECT EXISTS (SELECT 1 FROM public.jobs j WHERE j.id = p AND (public.is_company_owner(j.company_id)
      OR (j.responsible_id = auth.uid() AND public.session_company_member_confirmed(j.company_id)))) $$;

ALTER TABLE public.applications ENABLE ROW LEVEL SECURITY;
CREATE POLICY a_sel ON public.applications FOR SELECT TO authenticated USING (worker_id = auth.uid() OR public.is_job_owner(job_id));
CREATE POLICY a_upd ON public.applications FOR UPDATE TO authenticated USING (worker_id = auth.uid() OR public.is_job_owner(job_id)) WITH CHECK (true);
CREATE POLICY "Workers can insert applications" ON public.applications FOR INSERT TO authenticated WITH CHECK (worker_id = auth.uid());
CREATE POLICY "applications_insert_company_invite" ON public.applications FOR INSERT TO authenticated WITH CHECK (public.is_job_owner(job_id));

INSERT INTO public.companies(id, owner_id, name) VALUES ('${GESTOR}','${GESTOR}','A'), ('${OUTRA}','${OUTRA}','B');
INSERT INTO public.workers VALUES ('${W}'), ('${W2}');
INSERT INTO public.members VALUES ('${GESTOR}','${ENC}'), ('${GESTOR}','${ENC2}');
`;

const { PGlite } = await load();
const { pgcrypto } = await load('contrib/pgcrypto');
const db = new PGlite({ extensions: { pgcrypto } });
let passed = 0, failed = 0;
const check = (label, cond, extra = '') => {
  if (cond) { passed++; console.log('ok    ', label); } else { failed++; console.log('FALHOU', label, extra ?? ''); }
};

// Executa como cliente e COMMITA (os cenarios sao encadeados).
async function as(uid, sql, params = [], role = 'authenticated') {
  await db.exec('BEGIN');
  try {
    await db.query(`SELECT set_config('test.uid', $1, true)`, [uid ?? '']);
    await db.exec(`SET LOCAL ROLE ${role}`);
    const r = await db.query(sql, params);
    await db.exec('COMMIT');
    return { rows: r.rows, n: r.affectedRows ?? 0 };
  } catch (e) {
    await db.exec('ROLLBACK');
    return { error: `${e.code} ${e.message}`, rows: [], n: 0 };
  }
}
const one = async (sql, params) => (await db.query(sql, params)).rows[0];
const rpc = async (uid, fn, args) => {
  const r = await as(uid, `SELECT public.${fn}(${args.map((_, i) => `$${i + 1}`).join(',')}) AS r`, args);
  return r.error ? { outcome: r.error } : r.rows[0].r;
};
const denied = (r) => !!r.error && r.error.startsWith('42501');

await db.exec(STUB);
await db.exec(VALIDATE);
await db.exec(`CREATE TRIGGER trg_validate_application_update BEFORE UPDATE ON public.applications
  FOR EACH ROW EXECUTE FUNCTION public.validate_application_update();`);
await db.exec(SEAM_FIX);
await db.exec(INS);
await db.exec(UPD);
await db.exec(TRUST);
await db.exec(`CREATE TRIGGER trg_zz_companies_trust_guard BEFORE INSERT OR UPDATE ON public.companies
  FOR EACH ROW EXECUTE FUNCTION public.profile_trust_guard('{id,owner_id,organization_id,name}', '{}');`);
await db.exec(SERIES);
await db.exec('GRANT ALL ON public.job_series TO authenticated');

for (const [i, m] of P.entries()) {
  try { await db.exec(m); await db.exec(m); check(`P${i + 1} aplica e reaplica`, true); }
  catch (e) { check(`P${i + 1} aplica e reaplica`, false, e.message); process.exit(1); }
}
for (const stmt of IDX.replace(/--.*$/gm, '').split(';').map((s) => s.trim()).filter(Boolean)) await db.exec(stmt);
check('indices concorrentes aplicam', true);

console.log('--- site publicado');
let r = await as(NOVO, `INSERT INTO public.companies(id, owner_id, name) VALUES ($1,$1,'nova') RETURNING id`, [NOVO]);
check('onboarding de empresa sem conhecer as colunas novas segue', !r.error, r.error);

console.log('--- locais (P3/P4)');
const mkSite = (uid, company, name, radius = 150) => as(uid,
  `INSERT INTO public.company_sites(company_id,name,lat,lng,radius_m) VALUES ($1,$2,-5.794500,-35.211000,$3) RETURNING id`,
  [company, name, radius]);
const SITE = (await mkSite(GESTOR, GESTOR, 'Loja')).rows[0]?.id;
const SITE2 = (await mkSite(GESTOR, GESTOR, 'Loja 2')).rows[0]?.id;
const SITE_B = (await mkSite(OUTRA, OUTRA, 'Outra')).rows[0]?.id;
check('P3 Gestor cria local', !!(SITE && SITE2 && SITE_B));
check('P3 encarregado nao cria local', denied(await mkSite(ENC, GESTOR, 'x')));
check('P3 outra empresa nao cria local alheio', denied(await mkSite(OUTRA, GESTOR, 'x')));
check('P3 raio fora de 50..500 recusado', (await mkSite(GESTOR, GESTOR, 'x', 5000)).error?.startsWith('23514'));
check('P3 encarregado le os locais da empresa', (await as(ENC, 'SELECT * FROM public.company_sites')).rows.length === 2);
check('P3 freela nao le local', (await as(W, 'SELECT * FROM public.company_sites')).rows.length === 0);
check('P3 encarregado nao edita local', (await as(ENC, 'UPDATE public.company_sites SET radius_m=500')).n === 0);
check('P3 ninguem apaga local', denied(await as(GESTOR, 'DELETE FROM public.company_sites')));
for (const [who, role] of [[GESTOR, 'authenticated'], [W, 'authenticated'], ['', 'anon']]) {
  check(`P4 segredo ilegivel (${role} ${who.slice(-2)})`, denied(await as(who, 'SELECT * FROM public.company_site_secrets', [], role)));
}
check('P4 cliente nao fabrica token', denied(await as(GESTOR, 'SELECT public.internal_presence_token($1,NULL,NULL)', [SITE])));

console.log('--- politica (P1/P2)');
const mkJob = async (extra = {}) => {
  const j = { company_id: GESTOR, status: 'open', presence_mode: 'qr_gps', site_id: SITE, qr_mode: 'rotating', offset: '-1 hour', ...extra };
  return (await one(`INSERT INTO public.jobs(company_id,status,start_date,work_start_time,presence_mode,site_id,qr_mode,responsible_id)
    VALUES ($1,$2,(now()+$3::interval),((now()+$3::interval) AT TIME ZONE 'America/Sao_Paulo')::time,$4,$5,$6,$7) RETURNING id`,
    [j.company_id, j.status, j.offset, j.presence_mode, j.site_id, j.qr_mode, j.responsible_id ?? null])).id;
};
const mkApp = async (job, worker = W, status = 'hired') => (await one(
  'INSERT INTO public.applications(job_id,worker_id,status) VALUES ($1,$2,$3) RETURNING id', [job, worker, status])).id;
const dualRow = await one(`INSERT INTO public.jobs(company_id,status) VALUES ($1,'open') RETURNING *`, [GESTOR]);
check('P1 turno sem configuracao nasce dual/rotating', dualRow.presence_mode === 'dual' && dualRow.qr_mode === 'rotating');
const tryJob = async (extra) => { try { await mkJob(extra); return ''; } catch (e) { return e.code; } };
check('P2 qr_gps sem local recusado', (await tryJob({ site_id: null })) === '23514');
check('P2 local de outra empresa recusado', (await tryJob({ site_id: SITE_B })) === '42501');
r = await as(GESTOR, `SELECT public.create_job_series($1,'daily',NULL,current_date,current_date+1,ARRAY[current_date,current_date+1],$2::jsonb)`,
  [GESTOR, JSON.stringify({ title: 's', presence_mode: 'qr_gps', site_id: SITE, qr_mode: 'static' })]);
check('serie materializa a politica em cada ocorrencia', (await one(
  `SELECT count(*)::int n FROM public.jobs WHERE title='s' AND presence_mode='qr_gps' AND site_id=$1 AND qr_mode='static'`, [SITE])).n === 2, r.error);
r = await as(GESTOR, `SELECT public.create_job_series($1,'daily',NULL,current_date,current_date,ARRAY[current_date],'{"title":"velha"}'::jsonb)`, [GESTOR]);
check('serie do site publicado nasce dual', (await one(`SELECT presence_mode m FROM public.jobs WHERE title='velha'`))?.m === 'dual', r.error);

console.log('--- forja direta (P5)');
const JOB = await mkJob({ responsible_id: ENC });
const APP = await mkApp(JOB);
for (const [label, uid, sql] of [
  ['freela grava chegada', W, `status='in_progress', worker_checkin_at=now()`],
  ['freela grava saida', W, 'worker_checkout_at=now()'],
  ['empresa confirma chegada direto', GESTOR, `status='in_progress', company_checkin_confirmed_at=now()`],
  ['empresa confirma saida direto', GESTOR, 'company_checkout_confirmed_at=now()'],
  ['encarregado confirma direto', ENC, 'company_checkin_confirmed_at=now()'],
]) check(`P5 ${label}: 42501`, denied(await as(uid, `UPDATE public.applications SET ${sql} WHERE id=$1`, [APP])));

// Com a GUC forjada o validador cede, mas o guard do cliente NAO.
await db.exec('BEGIN');
let forged = '';
try {
  await db.query(`SELECT set_config('test.uid',$1,true), set_config('app.presence_rpc',$2,true)`, [W, APP]);
  await db.exec('SET LOCAL ROLE authenticated');
  await db.query(`UPDATE public.applications SET status='in_progress', worker_checkin_at=now() WHERE id=$1`, [APP]);
} catch (e) { forged = `${e.code} ${e.message}`; }
await db.exec('ROLLBACK');
check('P5 GUC forjada pelo cliente nao vence o guard', forged.startsWith('42501') && forged.includes('applications_presence_guard'), forged);
check('P5 insert ja carimbado recusado', denied(await as(GESTOR,
  `INSERT INTO public.applications(job_id,worker_id,status,invited_by_company_at,company_checkin_confirmed_at) VALUES ($1,$2,'invited',now(),now())`, [JOB, W2])));
check('P5 cliente nao grava presence_checks', denied(await as(W,
  `INSERT INTO public.presence_checks(application_id,job_id,worker_id,kind,result) VALUES ($1,$2,$3,'arrival','verified')`, [APP, JOB, W])));

console.log('--- QR (P13)');
const step = async () => Number((await one('SELECT floor(extract(epoch FROM now())/30)::bigint s')).s);
const tok = async (site, job, offset = 0) => (await one('SELECT public.internal_presence_token($1,$2,$3) t',
  [site, job, offset === null ? null : (await step()) + offset])).t;
const qr = await rpc(GESTOR, 'get_presence_qr', [JOB]);
check('P13 Gestor recebe o QR', qr.outcome === 'ok' && qr.token.length === 51 && qr.expires_in_s > 0 && qr.expires_in_s <= 30, JSON.stringify(qr));
check('P13 encarregado responsavel recebe', (await rpc(ENC, 'get_presence_qr', [JOB])).outcome === 'ok');
for (const [l, u] of [['encarregado sem escopo', ENC2], ['freela do turno', W], ['outra empresa', OUTRA]]) {
  check(`P13 ${l}: forbidden`, (await rpc(u, 'get_presence_qr', [JOB])).outcome === 'forbidden');
}
check('P13 turno dual nao tem QR', (await rpc(GESTOR, 'get_presence_qr', [dualRow.id])).outcome === 'not_qr_gps');
check('anon nao executa RPC', denied(await as('', 'SELECT public.get_presence_qr($1)', [JOB], 'anon')));

console.log('--- verificacao (P6-P10)');
const NEAR = [-5.7945, -35.2110, 10];
const verify = (uid, app, kind, token, [lat, lng, acc] = NEAR) => rpc(uid, 'verify_presence', [app, kind, token, lat, lng, acc]);
const stamps = (app) => one('SELECT * FROM public.applications WHERE id=$1', [app]);
const OTHER_JOB = await mkJob();
const good = () => tok(SITE, JOB);
const cases = [
  ['P7 passo -2', 'qr_expired', await tok(SITE, JOB, -2)],
  ['P7 replay antigo', 'qr_expired', await tok(SITE, JOB, -500)],
  ['P7 passo futuro', 'qr_invalid', await tok(SITE, JOB, 3)],
  ['P7 outro local', 'qr_invalid', await tok(SITE2, JOB)],
  ['P7 outro turno', 'qr_invalid', await tok(SITE, OTHER_JOB)],
  ['P7 impresso em turno rotativo', 'qr_invalid', await tok(SITE, null, null)],
  ['P7 texto qualquer', 'qr_invalid', 'https://exemplo.invalid'],
  ['P7 nulo', 'qr_invalid', null],
  ['P7 assinatura adulterada', 'qr_invalid', (await good()).replace(/.{4}$/, (s) => (s === 'AAAA' ? 'BBBB' : 'AAAA'))],
];
for (const [label, want, token] of cases) {
  const res = await verify(W, APP, 'arrival', token);
  check(`${label}: ${want}`, res.outcome === want, JSON.stringify(res));
}
const positions = [
  ['P8 precisao 151', 'gps_low_accuracy', [-5.7945, -35.211, 151]],
  ['P8 precisao 2 km nao aprova de longe', 'gps_low_accuracy', [-5.81, -35.211, 2000]],
  ['P8 a 220 m com precisao 10', 'gps_out_of_range', [-5.79648, -35.211, 10]],
  ['P8 a 220 m com precisao 150 (folga trava em 50)', 'gps_out_of_range', [-5.79648, -35.211, 150]],
  ['P8 latitude 91', 'invalid_input', [91, -35.211, 10]],
  ['P8 precisao zero', 'invalid_input', [-5.7945, -35.211, 0]],
  ['P8 NaN', 'invalid_input', [NaN, -35.211, 10]],
  ['P8 sem coordenada', 'invalid_input', [null, null, null]],
];
for (const [label, want, pos] of positions) {
  const res = await verify(W, APP, 'arrival', await good(), pos);
  check(`${label}: ${want}`, res.outcome === want, JSON.stringify(res));
}
let a = await stamps(APP);
check('falhas nao carimbam', !a.worker_checkin_at && !a.company_checkin_confirmed_at && a.status === 'hired');
check('cada falha vira uma tentativa', (await one('SELECT count(*)::int n FROM public.presence_checks WHERE application_id=$1', [APP])).n
  === cases.length + positions.length);
check('P9 outro freela: not_owner', (await verify(W2, APP, 'arrival', await good())).outcome === 'not_owner');
check('P9 empresa nao verifica pelo freela', (await verify(GESTOR, APP, 'arrival', await good())).outcome === 'not_owner');
const LATE = await mkJob({ offset: '48 hours' });
const LATE_APP = await mkApp(LATE);
check('P9 fora da janela', (await verify(W, LATE_APP, 'arrival', await tok(SITE, LATE))).outcome === 'outside_window');
check('excecao tambem respeita a janela', (await rpc(GESTOR, 'record_presence_exception', [LATE_APP, 'arrival', 'outro', null])).outcome === 'outside_window');
check('saida antes da chegada recusada', (await verify(W, APP, 'departure', await good())).outcome === 'invalid_status');

let res = await verify(W, APP, 'arrival', await tok(SITE, JOB, -1), [-5.79600, -35.211, 40]);
a = await stamps(APP);
check('P6 passo anterior + dentro do raio com folga: verified', res.outcome === 'verified', JSON.stringify(res));
check('P6 carimba chegada E confirmacao', a.status === 'in_progress' && !!a.worker_checkin_at && !!a.company_checkin_confirmed_at);
check('P10 segunda verificacao idempotente', (await verify(W, APP, 'arrival', await good())).outcome === 'already_verified'
  && String((await stamps(APP)).worker_checkin_at) === String(a.worker_checkin_at));
check('freela segue sem confirmar pela empresa', !!(await as(W,
  'UPDATE public.applications SET company_checkout_confirmed_at=now() WHERE id=$1', [APP])).error);
check('saida verificada', (await verify(W, APP, 'departure', await good())).outcome === 'verified');
a = await stamps(APP);
check('saida verificada vale como confirmacao', !!a.worker_checkout_at && !!a.company_checkout_confirmed_at);
r = await as(GESTOR, `UPDATE public.applications SET status='completed' WHERE id=$1`, [APP]);
check('empresa conclui o turno pelo fluxo atual', r.n === 1, r.error);

console.log('--- QR estatico e versao');
const SJOB = await mkJob({ qr_mode: 'static' });
const SAPP = await mkApp(SJOB);
const printed = await rpc(GESTOR, 'get_site_static_qr', [SITE]);
check('Gestor obtem o impresso', printed.outcome === 'ok' && printed.token.length === 40, JSON.stringify(printed));
check('encarregado nao obtem o impresso', (await rpc(ENC, 'get_site_static_qr', [SITE])).outcome === 'forbidden');
check('turno estatico nao tem rotativo', (await rpc(GESTOR, 'get_presence_qr', [SJOB])).outcome === 'static_mode');
check('encarregado nao rotaciona', (await rpc(ENC, 'rotate_site_secret', [SITE])).outcome === 'forbidden');
check('Gestor rotaciona', (await rpc(GESTOR, 'rotate_site_secret', [SITE])).version === 2);
check('P7 versao antiga: qr_invalid', (await verify(W, SAPP, 'arrival', printed.token)).outcome === 'qr_invalid');
check('impresso novo verifica', (await verify(W, SAPP, 'arrival', (await rpc(GESTOR, 'get_site_static_qr', [SITE])).token)).outcome === 'verified');

console.log('--- limite de tentativas');
const FLOOD = await mkApp(await mkJob());
for (let i = 0; i < 20; i++) await verify(W, FLOOD, 'arrival', 'x');
check('21a tentativa em 10 min nao grava', (await verify(W, FLOOD, 'arrival', 'x')).outcome === 'too_many_attempts'
  && (await one('SELECT count(*)::int n FROM public.presence_checks WHERE application_id=$1', [FLOOD])).n === 20);

console.log('--- excecao (P11)');
const EJOB = await mkJob({ responsible_id: ENC });
const EAPP = await mkApp(EJOB);
check('pedido do freela', (await rpc(W, 'request_presence_exception', [EAPP, 'arrival', 'gps_negado'])).outcome === 'requested');
check('pedido repetido nao spamma', (await rpc(W, 'request_presence_exception', [EAPP, 'arrival', 'gps_negado'])).outcome === 'already_requested'
  && (await one('SELECT count(*)::int n FROM public.notifications WHERE link LIKE $1', [`%${EJOB}%`])).n === 1);
check('outro freela nao pede', (await rpc(W2, 'request_presence_exception', [EAPP, 'arrival', 'outro'])).outcome === 'not_owner');
for (const [l, u] of [['freela', W], ['encarregado sem escopo', ENC2], ['outra empresa', OUTRA]]) {
  check(`P11 ${l} nao aprova`, (await rpc(u, 'record_presence_exception', [EAPP, 'arrival', 'outro', null])).outcome === 'forbidden');
}
check('P11 motivo fora da lista', (await rpc(ENC, 'record_presence_exception', [EAPP, 'arrival', 'porque sim', null])).outcome === 'invalid_input');
check('P11 nota > 200', (await rpc(ENC, 'record_presence_exception', [EAPP, 'arrival', 'outro', 'x'.repeat(201)])).outcome === 'invalid_input');
res = await rpc(ENC, 'record_presence_exception', [EAPP, 'arrival', 'gps_negado', ' ok ']);
check('P11 encarregado do turno aprova', res.outcome === 'recorded', res.outcome);
a = await stamps(EAPP);
check('P11 carimba so a coluna da empresa', a.status === 'in_progress' && !!a.company_checkin_confirmed_at && !a.worker_checkin_at);
check('P11 grava autor', (await one(`SELECT decided_by d FROM public.presence_checks WHERE application_id=$1 AND result='manual_exception'`, [EAPP]))?.d === ENC);
check('freela nao verifica por cima da excecao', (await verify(W, EAPP, 'arrival', await tok(SITE, EJOB))).outcome === 'already_verified');

console.log('--- saida sem verificacao');
check('estranho nao registra saida', (await rpc(W2, 'register_departure_unverified', [EAPP])).outcome === 'forbidden');
res = await rpc(W, 'register_departure_unverified', [EAPP]);
// Chegada por excecao: o freela nao tem ponto proprio, mas a empresa confirmou.
check('freela registra saida sem verificar', res.outcome === 'registered', res.outcome);
a = await stamps(EAPP);
check('nao confirma pela empresa', !!a.worker_checkout_at && !a.company_checkout_confirmed_at);
check('saida marcada nao vira verificada depois', (await verify(W, EAPP, 'departure', await tok(SITE, EJOB))).outcome === 'already_registered');
check('responsavel confirma a saida sem verificacao', (await rpc(ENC, 'register_departure_unverified', [EAPP])).outcome === 'registered');
check('turno conclui sem bloqueio', (await as(GESTOR, `UPDATE public.applications SET status='completed' WHERE id=$1`, [EAPP])).n === 1);

console.log('--- leitura');
check('outro freela nao ve linhas alheias', (await as(W2, 'SELECT * FROM public.presence_checks')).rows.length === 0);
check('encarregado sem escopo nao ve', (await as(ENC2, 'SELECT * FROM public.presence_checks')).rows.length === 0);
check('encarregado ve as dos seus turnos', (await as(ENC, 'SELECT DISTINCT job_id FROM public.presence_checks')).rows.length === 2);

console.log('--- modo dual intacto (P1)');
const DAPP = await mkApp(dualRow.id);
r = await as(W, `UPDATE public.applications SET status='in_progress', worker_checkin_at=now() WHERE id=$1`, [DAPP]);
check('P1 dual: freela registra chegada direto', r.n === 1, r.error);
check('P1 dual: empresa confirma direto', (await as(GESTOR, 'UPDATE public.applications SET company_checkin_confirmed_at=now() WHERE id=$1', [DAPP])).n === 1);
check('P1 dual: validador segue barrando o freela', !!(await as(W, 'UPDATE public.applications SET company_checkout_confirmed_at=now() WHERE id=$1', [DAPP])).error);
check('verify em turno dual', (await verify(W, DAPP, 'arrival', 'x')).outcome === 'not_qr_gps');

console.log('--- congelamento (P14)');
const frozen = async (sql, p) => { try { await db.query(sql, p); return false; } catch (e) { return e.code === '42501'; } };
check('P14 modo congela', await frozen(`UPDATE public.jobs SET presence_mode='dual' WHERE id=$1`, [EJOB]));
check('P14 local congela', await frozen('UPDATE public.jobs SET site_id=$2 WHERE id=$1', [EJOB, SITE2]));
check('P14 dual com carimbo nao vira qr_gps', await frozen(`UPDATE public.jobs SET presence_mode='qr_gps', site_id=$2 WHERE id=$1`, [dualRow.id, SITE]));
check('P14 outras colunas seguem editaveis', !(await frozen(`UPDATE public.jobs SET title='n' WHERE id=$1`, [EJOB])));
check('P14 sem carimbo muda', !(await frozen(`UPDATE public.jobs SET presence_mode='dual' WHERE id=$1`, [OTHER_JOB])));

console.log('--- sem coordenada (P12), purga (P15), LGPD');
check('P12 nenhuma coluna de coordenada fora do local', (await db.query(`SELECT 1 FROM information_schema.columns
  WHERE table_schema='public' AND column_name ~* '(^|_)(lat|lng|lon|latitude|longitude)($|_)' AND table_name <> 'company_sites'`)).rows.length === 0);
check('P15 cliente nao purga', denied(await as(GESTOR, 'SELECT public.purge_presence_checks()')));
await db.exec(`UPDATE public.presence_checks SET created_at = now() - interval '91 days'`);
const kept = (await one(`SELECT count(*)::int n FROM public.presence_checks WHERE result IN ('verified','manual_exception','unverified')`)).n;
await db.exec('SELECT public.purge_presence_checks()');
check('P15 purga so falhas e pedidos', (await one('SELECT count(*)::int n FROM public.presence_checks')).n === kept && kept >= 5);
await db.exec(`UPDATE public.workers SET anonymized_at=now() WHERE id='${W}'`);
check('LGPD: anonimizar freela apaga nota e medidas', (await one(`SELECT count(*)::int n FROM public.presence_checks
  WHERE worker_id=$1 AND (note IS NOT NULL OR distance_m IS NOT NULL OR accuracy_m IS NOT NULL)`, [W])).n === 0);
await db.exec(`UPDATE public.companies SET anonymized_at=now() WHERE id='${OUTRA}'`);
const gone = await one('SELECT lat::float8 l, archived_at a FROM public.company_sites WHERE id=$1', [SITE_B]);
check('LGPD: local da empresa anonimizada perde o conteudo', gone.l === 0 && !!gone.a);

for (const [i, m] of P.entries()) {
  try { await db.exec(m); check(`P${i + 1} reaplica com dados`, true); }
  catch (e) { await db.exec('ROLLBACK'); check(`P${i + 1} reaplica com dados`, false, e.message); }
}

console.log(`\n${passed} ok, ${failed} falhas`);
process.exit(failed ? 1 : 0);
