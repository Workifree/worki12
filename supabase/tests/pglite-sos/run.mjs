// D-7: executa 20261125000300 no PGlite sobre o corpo de 20260817001600 (secoes 6 e 7), nas duas
// ordens em relacao a E3 (secao 11b de 20261123000400, o unico trecho dela que edita o SOS).
// Uso, da raiz: npx -y -p @electric-sql/pglite@0.6.0 node supabase/tests/pglite-sos/run.mjs
// Limite: schema minimo (stub abaixo), sem RLS/triggers; is_job_owner/is_company_owner simplificadas.
import { readFileSync, existsSync } from 'node:fs';
import { delimiter, dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createHash } from 'node:crypto';

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
const dir = join(resolve(dirname(fileURLToPath(import.meta.url)), '..', '..'), 'migrations');
const read = (n) => readFileSync(join(dir, `${n}.sql`), 'utf8').replace(/\r\n/g, '\n');
const between = (s, a, b) => {
  const i = s.indexOf(a), j = s.indexOf(b, i);
  if (i < 0 || j < 0) throw new Error(`marcador ausente: ${a}`);
  return s.slice(i, j);
};
const f11 = read('20260817001600_sos_discovery');
const BASE = between(f11, 'CREATE OR REPLACE FUNCTION public.sos_call_eligibility', '-- 8.').replace(/\n-- =+\s*$/, '\n');
const e3 = read('20261123000400_equipe_e3_policies_e_triggers');
const E3 = between(e3, '-- 11b.', '-- 12.').replace(/^[^\n]*\n/, '-- E3 11b\n');
const FIX = read('20261125000300_sos_usa_horario_de_entrada');
const DOWN = between(FIX, '-- >>> DOWN\n', '-- <<< DOWN').split('\n').slice(1).map((l) => l.replace(/^-- ?/, '')).join('\n');

const U = '00000000-0000-0000-0000-000000000001';
const W = '00000000-0000-0000-0000-000000000002';
const STUB = `
CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON FUNCTIONS TO anon, authenticated, service_role;
CREATE SCHEMA auth;
CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT '${U}'::uuid $$;
CREATE TABLE public.companies (id uuid PRIMARY KEY, owner_id uuid, city text, name text);
CREATE TABLE public.jobs (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), company_id uuid, status text, start_date timestamptz, work_start_time text, slots int);
CREATE TABLE public.applications (job_id uuid, worker_id uuid, status text);
CREATE TABLE public.shift_calls (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), job_id uuid, company_id uuid, created_by uuid, slots int, reason text, message text, targets_count int, status text, origin text, expires_at timestamptz, created_at timestamptz DEFAULT now(), closed_at timestamptz);
CREATE TABLE public.shift_call_targets (call_id uuid, worker_id uuid, response text, responded_at timestamptz, origin text DEFAULT 'team', notified_at timestamptz DEFAULT now());
CREATE TABLE public.team_connections (company_id uuid, worker_id uuid, status text);
CREATE TABLE public.workers (id uuid, discoverable_for_sos bool, city text, completed_jobs_count int, reviews_count int, rating_average numeric);
CREATE TABLE public.notifications (user_id uuid, type text, title text, message text, link text);
CREATE FUNCTION public.is_job_owner(uuid) RETURNS bool LANGUAGE sql AS $$ SELECT true $$;
CREATE FUNCTION public.is_company_owner(uuid) RETURNS bool LANGUAGE sql AS $$ SELECT true $$;
CREATE FUNCTION public.normalize_city(t text) RETURNS text LANGUAGE sql AS $$ SELECT NULLIF(lower(trim(t)), '') $$;
INSERT INTO public.companies VALUES ('${U}', '${U}', 'Natal', 'Empresa');
INSERT INTO public.workers VALUES ('${W}', true, 'Natal', 5, 0, NULL);
`;

const { PGlite } = await loadPglite();
let passed = 0, failed = 0;
const check = (label, cond, extra = '') => {
  if (cond) { passed++; console.log('ok    ', label); } else { failed++; console.log('FALHOU', label, extra); }
};
async function fresh() {
  const db = new PGlite();
  await db.exec(STUB);
  await db.exec(BASE); // traz os REVOKE/GRANT originais de F11
  return db;
}
const apply = async (db, label, sql) => {
  try { await db.exec(`BEGIN;\n${sql}\nCOMMIT;`); check(label, true); }
  catch (e) { await db.exec('ROLLBACK'); check(label, false, e.message); }
};
async function tried(db, id) { // turno com um chamado ao Elenco ja esgotado
  await db.query(`INSERT INTO public.shift_calls (job_id, company_id, status, origin, expires_at) VALUES ($1, '${U}', 'expired', 'team', now())`, [id]);
  return id;
}
// `offset` = ENTRADA relativa a agora; o dia vai em start_date a 00:00:01 local, para a hora de
// start_date nunca se confundir com a de entrada.
async function job(db, offset) {
  const { rows } = await db.query(`
    WITH t AS (SELECT (now() + $1::interval) AT TIME ZONE 'America/Sao_Paulo' AS l)
    INSERT INTO public.jobs (company_id, status, start_date, work_start_time, slots)
    SELECT '${U}', 'open', (l::date + time '00:00:01') AT TIME ZONE 'America/Sao_Paulo', to_char(l, 'HH24:MI:SS'), 1 FROM t
    RETURNING id`, [offset]);
  return tried(db, rows[0].id);
}
async function jobNoTime(db, offset, wst) { // sem horario: start_date = agora + offset
  const { rows } = await db.query(`INSERT INTO public.jobs (company_id, status, start_date, work_start_time, slots)
    VALUES ('${U}', 'open', now() + $1::interval, $2, 1) RETURNING id`, [offset, wst]);
  return tried(db, rows[0].id);
}
const reason = async (db, id) => (await db.query('SELECT public.sos_call_eligibility($1) r', [id])).rows[0].r.reason;
async function create(db, id) {
  await db.exec('BEGIN');
  const r = (await db.query('SELECT public.create_sos_call($1) r', [id])).rows[0].r;
  let exp = null;
  if (r.call_id) exp = (await db.query(`SELECT s.expires_at > now() AS futuro,
      s.expires_at = LEAST(now() + interval '45 minutes', public.sos_shift_starts_at(j.start_date, j.work_start_time)) AS teto
      FROM public.shift_calls s JOIN public.jobs j ON j.id = s.job_id WHERE s.id = $1`, [r.call_id])).rows[0];
  await db.exec('ROLLBACK');
  return { outcome: r.outcome, exp };
}
async function behavior(db, tag) {
  for (const [offset, el, cr] of [['17 minutes', 'ok', 'created'], ['3 hours 50 minutes', 'ok', 'created'],
    ['4 hours 10 minutes', 'not_urgent', 'not_urgent'], ['-1 hour', 'job_started', 'job_started']]) {
    const id = await job(db, offset);
    const a = await reason(db, id), b = await create(db, id);
    check(`${tag}: entrada ${offset} -> ${el}/${cr}`,
      a === el && b.outcome === cr && (cr !== 'created' || (b.exp?.futuro && b.exp?.teto)), JSON.stringify({ a, b }));
  }
  for (const wst of [null, '', 'abc', '25:00', '8h']) {
    const got = [];
    for (const off of ['2 hours', '-1 hour', '5 hours']) {
      const id = await jobNoTime(db, off, wst);
      got.push(await reason(db, id), (await create(db, id)).outcome);
    }
    check(`${tag}: sem horario ${JSON.stringify(wst)} vale start_date`,
      got.join() === 'ok,created,job_started,job_started,not_urgent,not_urgent', got.join());
  }
}

// helper: formatos e fuso, com datas fixas
{
  const db = await fresh();
  await apply(db, 'UP (base)', FIX);
  for (const [sd, wst, want] of [
    ['2026-11-25T15:00:00Z', '8:05', '2026-11-25T11:05:00.000Z'],
    ['2026-11-25T15:00:00Z', '23:30:00', '2026-11-26T02:30:00.000Z'],
    ['2026-11-26T02:00:00Z', '18:00', '2026-11-25T21:00:00.000Z'],
    ['2026-11-25T15:00:00Z', '24:00', '2026-11-25T15:00:00.000Z'],
    ['2026-11-25T00:00:00Z', '18:00', '2026-11-25T21:00:00.000Z'], // legado 00:00 UTC: dia 25, nao 24
    ['2026-11-25T00:00:00Z', '', '2026-11-25T00:00:00.000Z'],
    ['2026-11-25T00:00:01Z', '18:00', '2026-11-24T21:00:00.000Z'], // so a meia-noite exata e legado
    [null, '18:00', null]]) {
    const v = (await db.query('SELECT public.sos_shift_starts_at($1, $2) v', [sd, wst])).rows[0].v;
    check(`helper ${sd} ${wst}`, (v ? v.toISOString() : null) === want, String(v));
  }
  await db.close();
}
// antes da correcao
{
  const db = await fresh();
  // impressao do corpo base sem comentarios/espacos, para comparar com o catalogo de producao
  for (const r of (await db.query(`SELECT proname, prosrc FROM pg_proc WHERE proname IN ('sos_call_eligibility','create_sos_call') ORDER BY 1`)).rows) {
    console.log('md5   ', r.proname, createHash('md5').update(r.prosrc.replace(/--[^\n]*/g, '').replace(/\s+/g, '')).digest('hex'));
  }
  // pulado na virada do dia (quando o dia da entrada e amanha, o codigo antigo pode aceitar por acaso)
  const same = (await db.query(`SELECT ((now() + interval '17 minutes') AT TIME ZONE 'America/Sao_Paulo')::date = (now() AT TIME ZONE 'America/Sao_Paulo')::date s`)).rows[0].s;
  if (same) {
    const r = await reason(db, await job(db, '17 minutes'));
    check(`ANTES: turno em 17 min negado (D-7 reproduzido: ${r})`, r !== 'ok');
  }
  await db.close();
}
for (const [tag, steps] of [['[fix->E3]', [['UP', FIX], ['E3', E3]]], ['[E3->fix]', [['E3', E3], ['UP', FIX]]]]) {
  const db = await fresh();
  let fixed = false;
  for (const [n, sql] of steps) {
    await apply(db, `${tag} aplica ${n}`, sql);
    fixed ||= n === 'UP';
    if (fixed) await behavior(db, `${tag} apos ${n}`);
  }
  await apply(db, `${tag} reaplica UP`, FIX);
  await apply(db, `${tag} reaplica E3`, E3);
  const e3ok = async () => (await db.query(`SELECT bool_and(prosrc ~ '\\mj0[.]company_id\\M' AND prosrc !~ '\\mowner_id = v_uid\\M') ok FROM pg_proc WHERE proname IN ('sos_call_eligibility','create_sos_call')`)).rows[0].ok;
  check(`${tag} edicoes da E3 presentes`, await e3ok());
  await apply(db, `${tag} DOWN`, DOWN);
  check(`${tag} DOWN preserva E3`, await e3ok());
  const left = (await db.query(`SELECT count(*)::int n FROM pg_proc WHERE proname = 'sos_shift_starts_at' OR prosrc ~ '\\msos_shift_starts_at\\M'`)).rows[0].n;
  check(`${tag} DOWN remove helper e chamadas`, left === 0);
  await apply(db, `${tag} UP depois do DOWN`, FIX);
  await db.close();
}
console.log(`\nRESULTADO: ${passed} ok, ${failed} falha(s)`);
process.exit(failed ? 1 : 0);
