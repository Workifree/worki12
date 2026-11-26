// Executa 20261128000100 (lote de turnos) no PGlite.
// Uso, da raiz: npx -y -p @electric-sql/pglite@0.6.0 node supabase/tests/pglite-lote/run.mjs
//
// O que e REAL aqui (extraido do texto das migrations aplicadas, nao reescrito): create_job_series,
// enforce_job_series_same_owner, check_job_series_cap (F3); session_can_operate_job e
// jobs_responsible_guard (E2); policies de INSERT/UPDATE de jobs e jobs_soft_delete_guard (E3).
// Limite: schema minimo e helpers de membership simplificados; nao e o catalogo de producao.
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
const read = (f) => readFileSync(join(root, 'migrations', f), 'utf8').replace(/\r\n/g, '\n');
const F3 = read('20260817000400_job_series.sql');
const E2 = read('20261123000300_equipe_e2_seam_job_operator.sql');
const E3 = read('20261123000400_equipe_e3_policies_e_triggers.sql');
const MIG = read('20261128000100_criacao_lote_turnos.sql');

/** Trecho real: do marcador inicial ate o fim do marcador final. */
function cut(sql, from, to) {
  const a = sql.indexOf(`
${from}`) + 1 || -1;
  const b = sql.indexOf(to, a);
  if (a < 0 || b < 0) throw new Error(`trecho nao encontrado: ${from} .. ${to}`);
  return sql.slice(a, b + to.length);
}
const fnBlock = (sql, name, end = '\n$$;') => cut(sql, `CREATE OR REPLACE FUNCTION public.${name}(`, end);

const id = (n) => `00000000-0000-0000-0000-0000000000${String(n).padStart(2, '0')}`;
const EMP_A = id(1), EMP_B = id(2), GER = id(3), ENC = id(4), ENC_NC = id(5), FREELA = id(6);
const TAG_A = id(21), TAG_ARQ = id(22), TAG_B = id(23);

const STUB = `
CREATE ROLE authenticated; CREATE ROLE anon; CREATE ROLE service_role BYPASSRLS;
CREATE SCHEMA auth;
CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('test.uid', true), '')::uuid $$;
CREATE TABLE public.companies (id uuid PRIMARY KEY, owner_id uuid);
CREATE TABLE public.company_members (company_id uuid, user_id uuid, role text, status text, confirmed_at timestamptz);
CREATE TABLE public.company_tags (id uuid PRIMARY KEY, company_id uuid, archived_at timestamptz);
CREATE TABLE public.responsibility_coverages (company_id uuid, from_user_id uuid, to_user_id uuid, starts_on date, ends_on date, revoked_at timestamptz);
CREATE TABLE public.job_series (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), company_id uuid NOT NULL, recurrence_type text,
  weekdays integer[], range_start_date date, range_end_date date, occurrences_generated int, status text, created_by uuid);
CREATE TABLE public.applications (id uuid, job_id uuid, status text);
CREATE TABLE public.shift_calls (id uuid, job_id uuid, status text);
CREATE TABLE public.jobs (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), company_id uuid NOT NULL, title text NOT NULL,
  category text, type text, description text, requirements text, briefing text, location text, budget numeric,
  budget_type text CHECK (budget_type IN ('hourly','daily','project')), start_date timestamptz, scope text,
  work_start_time text, work_end_time text, has_lunch boolean DEFAULT false, slots integer NOT NULL DEFAULT 1 CHECK (slots >= 1),
  status text, certification_requirement text CHECK (char_length(certification_requirement) <= 200),
  series_id uuid REFERENCES public.job_series(id), series_occurrence_date date, responsible_id uuid, tag_id uuid REFERENCES public.company_tags(id));
CREATE UNIQUE INDEX idx_jobs_series_occurrence_unique ON public.jobs (series_id, series_occurrence_date) WHERE series_id IS NOT NULL AND status <> 'deleted';

CREATE FUNCTION public.is_company_owner(c uuid) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER AS $$
  SELECT EXISTS (SELECT 1 FROM public.companies x WHERE x.id = c AND (x.owner_id = auth.uid() OR x.id = auth.uid()))
      OR EXISTS (SELECT 1 FROM public.company_members m WHERE m.company_id = c AND m.user_id = auth.uid() AND m.role = 'manager' AND m.status = 'active') $$;
CREATE FUNCTION public.session_company_member_role(c uuid) RETURNS text LANGUAGE sql STABLE SECURITY DEFINER AS
  $$ SELECT role FROM public.company_members WHERE company_id = c AND user_id = auth.uid() AND status = 'active' LIMIT 1 $$;
CREATE FUNCTION public.session_company_member_confirmed(c uuid) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER AS
  $$ SELECT EXISTS (SELECT 1 FROM public.company_members WHERE company_id = c AND user_id = auth.uid() AND status = 'active' AND confirmed_at IS NOT NULL) $$;
CREATE FUNCTION public.internal_company_confirmed_operator(c uuid, u uuid) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER AS $$
  SELECT EXISTS (SELECT 1 FROM public.companies x WHERE x.id = c AND (x.owner_id = u OR x.id = u))
      OR EXISTS (SELECT 1 FROM public.company_members m WHERE m.company_id = c AND m.user_id = u AND m.status = 'active'
                   AND (m.role = 'manager' OR m.confirmed_at IS NOT NULL)) $$;

INSERT INTO public.companies VALUES ('${EMP_A}', '${EMP_A}'), ('${EMP_B}', '${EMP_B}');
INSERT INTO public.company_members VALUES ('${EMP_A}', '${GER}', 'manager', 'active', now()),
  ('${EMP_A}', '${ENC}', 'encarregado', 'active', now()), ('${EMP_A}', '${ENC_NC}', 'encarregado', 'active', NULL);
INSERT INTO public.company_tags VALUES ('${TAG_A}', '${EMP_A}', NULL), ('${TAG_ARQ}', '${EMP_A}', now()), ('${TAG_B}', '${EMP_B}', NULL);

GRANT USAGE ON SCHEMA public, auth TO authenticated, anon, service_role;
GRANT ALL ON ALL TABLES IN SCHEMA public TO authenticated, service_role;
ALTER TABLE public.jobs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.job_series ENABLE ROW LEVEL SECURITY;
CREATE POLICY jobs_select_authenticated ON public.jobs FOR SELECT TO authenticated USING (true);
CREATE POLICY job_series_select ON public.job_series FOR SELECT TO authenticated USING (public.is_company_owner(company_id));
CREATE POLICY job_series_insert ON public.job_series FOR INSERT TO authenticated
  WITH CHECK (public.is_company_owner(company_id) AND created_by = auth.uid());
`;

const REAL = [
  fnBlock(E2, 'session_can_operate_job'),
  fnBlock(E2, 'jobs_responsible_guard'),
  cut(E2, 'DROP TRIGGER IF EXISTS trg_jobs_responsible_guard', 'EXECUTE FUNCTION public.jobs_responsible_guard();'),
  cut(E3, 'DROP POLICY IF EXISTS "jobs_insert_company_owner"', '-- jobs_delete_company_owner'),
  fnBlock(E3, 'jobs_soft_delete_guard'),
  cut(E3, 'DROP TRIGGER IF EXISTS trg_jobs_soft_delete_guard', 'EXECUTE FUNCTION public.jobs_soft_delete_guard();'),
  fnBlock(F3, 'enforce_job_series_same_owner'),
  cut(F3, 'DROP TRIGGER IF EXISTS trg_enforce_job_series_same_owner', 'EXECUTE FUNCTION public.enforce_job_series_same_owner();'),
  fnBlock(F3, 'check_job_series_cap'),
  cut(F3, 'DROP TRIGGER IF EXISTS trg_check_job_series_cap', 'EXECUTE FUNCTION public.check_job_series_cap();'),
  fnBlock(F3, 'create_job_series'),
];

const { PGlite } = await loadPglite();
let passed = 0, failed = 0;
const check = (label, cond, extra = '') => {
  if (cond) { passed++; console.log('ok    ', label); } else { failed++; console.log('FALHOU', label, extra); }
};

const db = new PGlite();
await db.exec(STUB);
for (const sql of REAL) await db.exec(sql);

// pre-condicao: sem o trigger de responsavel, a migration para
await db.exec('ALTER TABLE public.jobs DISABLE TRIGGER trg_jobs_responsible_guard');
let halted = '';
try { await db.exec(MIG); } catch (e) { halted = e.message; }
await db.exec('ROLLBACK').catch(() => {});
check('pre-condicao barra trigger desligado', halted.includes('HALT'), halted);
await db.exec('ALTER TABLE public.jobs ENABLE TRIGGER trg_jobs_responsible_guard');

await db.exec(MIG);
check('migration aplica', true);
await db.exec(MIG);
check('migration reaplica (idempotente)', true);

const day = async (offset) => (await db.query(
  `SELECT to_char((now() AT TIME ZONE 'America/Sao_Paulo')::date + ${offset}, 'YYYY-MM-DD') AS d`)).rows[0].d;
const TOMORROW = await day(1), YESTERDAY = await day(-1), TODAY = await day(0);
const DATES = [];
for (let i = 1; i <= 61; i++) DATES.push(await day(i));

const template = (extra = {}) => ({
  title: 'Garçom evento', category: 'garcom', description: 'Atender o salão.', requirements: '', briefing: '',
  certification_requirement: null, location: 'Rua A', budget_type: 'daily', has_lunch: false, tag_id: null,
  attendance_mode: null, ...extra,
});
const row = (i = 0, extra = {}) => ({ date: DATES[i], start_time: '18:00', end_time: '23:00', slots: 3, budget: 150, ...extra });
const rows = (n) => Array.from({ length: n }, (_, i) => row(i));
let seq = 0;
const batchId = () => `10000000-0000-0000-0000-${String(++seq).padStart(12, '0')}`;

/** Chama a RPC como `uid`, sob o papel authenticated, COMMITANDO. */
async function publish(uid, { batch = batchId(), company = EMP_A, tpl = template(), list = rows(10), series = null } = {}) {
  await db.exec('BEGIN');
  try {
    await db.exec(`SELECT set_config('test.uid', '${uid ?? ''}', true); SET LOCAL ROLE authenticated`);
    const res = await db.query('SELECT public.create_jobs_batch($1,$2,$3::jsonb,$4::jsonb,$5::jsonb) AS r',
      [batch, company, JSON.stringify(tpl), JSON.stringify(list), series ? JSON.stringify(series) : null]);
    await db.exec('COMMIT');
    return { ...res.rows[0].r, batch };
  } catch (e) {
    await db.exec('ROLLBACK');
    return { outcome: 'exception', error: `${e.code} ${e.message}`, batch };
  }
}
const countBatch = async (b) => Number((await db.query(`SELECT count(*) n FROM public.jobs WHERE creation_batch_id='${b}'`)).rows[0].n);
const total = async () => Number((await db.query('SELECT count(*) n FROM public.jobs')).rows[0].n);

// A2: 10 ou 0
const ok = await publish(EMP_A);
check('A2 dono publica 10', ok.outcome === 'created' && ok.created === 10 && (await countBatch(ok.batch)) === 10, JSON.stringify(ok));
const stored = (await db.query(`SELECT id, creation_row, responsible_id, status, type, scope,
  to_char(start_date AT TIME ZONE 'America/Sao_Paulo','YYYY-MM-DD HH24:MI') AS local, slots
  FROM public.jobs WHERE creation_batch_id='${ok.batch}' ORDER BY creation_row`)).rows;
check('ids na ordem das linhas', JSON.stringify(stored.map((r) => r.id)) === JSON.stringify(ok.job_ids));
check('data local ao meio-dia de Sao Paulo', stored[0].local === `${DATES[0]} 12:00`, stored[0].local);
check('turno nasce aberto, presencial, com vagas e responsavel = quem publicou',
  stored.every((r) => r.status === 'open' && r.type === 'freelance' && r.scope === 'on-site' && r.slots === 3 && r.responsible_id === EMP_A));

for (const [label, bad] of [
  ['valor zero', { budget: 0 }], ['51 vagas', { slots: 51 }], ['0 vagas', { slots: 0 }], ['vagas fracionadas', { slots: 1.5 }],
  ['vagas em texto', { slots: '3' }], ['data passada', { date: YESTERDAY }], ['31 de fevereiro', { date: '2031-02-31' }],
  ['hora invalida', { start_time: '25:00' }], ['entrada igual a saida', { end_time: '18:00' }],
  ['tipo de valor invalido', { overrides: { budget_type: 'x' } }], ['sem titulo', { overrides: { title: '  ' } }],
]) {
  const list = rows(10); list[6] = { ...list[6], ...bad };
  const before = await total();
  const r = await publish(EMP_A, { list });
  check(`A2 linha 7 com ${label}: 0 turnos e aponta a linha 7`,
    r.outcome === 'invalid' && r.errors.length >= 1 && r.errors.every((e) => e.row === 7) && (await total()) === before, JSON.stringify(r));
}
for (const [label, tag] of [['arquivada', TAG_ARQ], ['de outra empresa', TAG_B]]) {
  const list = rows(10); list[6] = { ...list[6], overrides: { tag_id: tag } };
  const before = await total();
  const r = await publish(EMP_A, { list });
  check(`falha NO INSERT da linha 7 (etiqueta ${label}) desfaz as 6 anteriores`,
    r.outcome === 'invalid_tag' && r.errors[0].row === 7 && (await total()) === before, JSON.stringify(r));
}
const tagged = await publish(EMP_A, { tpl: template({ tag_id: TAG_A }), list: [row(0), row(1, { overrides: { tag_id: null } })] });
const tags = (await db.query(`SELECT tag_id FROM public.jobs WHERE creation_batch_id='${tagged.batch}' ORDER BY creation_row`)).rows;
check('etiqueta na mesma transacao; override null limpa so a linha', tags[0]?.tag_id === TAG_A && tags[1]?.tag_id === null, JSON.stringify(tagged));

// A3: idempotencia
const again = await publish(EMP_A, { batch: ok.batch });
check('A3 mesmo client_batch_id: already_created, mesmos ids, sem 20 turnos',
  again.outcome === 'already_created' && again.created === 0 && JSON.stringify(again.job_ids) === JSON.stringify(ok.job_ids) && (await countBatch(ok.batch)) === 10,
  JSON.stringify(again));
const lateRetry = await publish(EMP_A, { batch: ok.batch, list: [row(0, { date: YESTERDAY })] });
check('retry depois da data passar continua sendo sucesso', lateRetry.outcome === 'already_created');
const conflict = await publish(EMP_B, { batch: ok.batch, company: EMP_B });
check('mesmo id em outra empresa: batch_conflict sem ids', conflict.outcome === 'batch_conflict' && !conflict.job_ids);
const spy = await publish(FREELA, { batch: ok.batch });
check('quem nao opera nao recebe os ids do lote alheio', spy.outcome === 'forbidden' && !spy.job_ids, JSON.stringify(spy));
let dup = '';
try { await db.exec(`INSERT INTO public.jobs(company_id,title,creation_batch_id,creation_row) VALUES ('${EMP_A}','x','${ok.batch}',1)`); } catch (e) { dup = e.code; }
check('indice unico barra 2a linha com mesmo lote/posicao', dup === '23505', dup);
let pair = '';
try { await db.exec(`INSERT INTO public.jobs(company_id,title,creation_batch_id) VALUES ('${EMP_A}','x','${batchId()}')`); } catch (e) { pair = e.code; }
check('lote sem posicao e recusado pelo CHECK', pair === '23514', pair);

// A4: papeis
const ger = await publish(GER, { list: rows(2) });
check('gerente publica e fica responsavel', ger.outcome === 'created' &&
  Number((await db.query(`SELECT count(*) n FROM public.jobs WHERE creation_batch_id='${ger.batch}' AND responsible_id='${GER}'`)).rows[0].n) === 2, JSON.stringify(ger));
const enc = await publish(ENC, { list: rows(3) });
check('A4 encarregado confirmado: todos com responsible_id = ele', enc.outcome === 'created' &&
  Number((await db.query(`SELECT count(*) n FROM public.jobs WHERE creation_batch_id='${enc.batch}' AND responsible_id='${ENC}'`)).rows[0].n) === 3, JSON.stringify(enc));
const encRetry = await publish(ENC, { batch: enc.batch, list: rows(3) });
check('encarregado: retry devolve already_created', encRetry.outcome === 'already_created', JSON.stringify(encRetry));
const forged = await publish(ENC, { tpl: template({ responsible_id: GER }), list: [row(0, { overrides: { responsible_id: GER, company_id: EMP_B } })] });
const forgedRow = (await db.query(`SELECT responsible_id, company_id FROM public.jobs WHERE creation_batch_id='${forged.batch}'`)).rows[0];
check('responsible_id/company_id forjados no payload sao ignorados', forgedRow?.responsible_id === ENC && forgedRow?.company_id === EMP_A, JSON.stringify(forged));
for (const [label, uid, company] of [
  ['A4 encarregado NAO confirmado', ENC_NC, EMP_A], ['A4 empresa B em A', EMP_B, EMP_A], ['freela', FREELA, EMP_A],
  ['encarregado de A em B', ENC, EMP_B], ['gerente de A em B', GER, EMP_B],
]) {
  const before = await total();
  const r = await publish(uid, { company, list: rows(3) });
  check(`${label}: RPC falha inteira`, r.outcome === 'forbidden' && (await total()) === before, JSON.stringify(r));
}
const noSession = await publish(null);
check('sem sessao: unauthenticated', noSession.outcome === 'unauthenticated');
const anonExec = (await db.query(`SELECT has_function_privilege('anon','public.create_jobs_batch(uuid,uuid,jsonb,jsonb,jsonb)','EXECUTE') a`)).rows[0].a;
check('anon sem EXECUTE', anonExec === false);

// A12 / limites
const over = await publish(EMP_A, { list: rows(61) });
check('A12 61 linhas recusadas com a mensagem do client', over.outcome === 'invalid' && over.errors[0].message === 'Um lote pode ter no máximo 60 turnos.' && (await countBatch(over.batch)) === 0);
const max = await publish(EMP_A, { list: rows(60) });
check('60 linhas passam', max.outcome === 'created' && max.created === 60, JSON.stringify(max).slice(0, 300));
const empty = await publish(EMP_A, { list: [] });
check('lote vazio recusado', empty.outcome === 'invalid');
const midnight = await publish(EMP_A, { list: [row(0, { date: TODAY, start_time: '22:00', end_time: '02:00' })] });
const m = (await db.query(`SELECT to_char(start_date AT TIME ZONE 'America/Sao_Paulo','YYYY-MM-DD') d, work_end_time e FROM public.jobs WHERE creation_batch_id='${midnight.batch}'`)).rows[0];
check('A5 22:00-02:00 hoje: turno na data de inicio', midnight.outcome === 'created' && m.d === TODAY && m.e === '02:00', JSON.stringify(midnight));
const presence = await publish(EMP_A, { tpl: template({ attendance_mode: 'qr_gps' }) });
check('politica de presenca pedida e recusada, nao ignorada', presence.outcome === 'invalid' && presence.errors[0].code === 'presence_unsupported');

// Serie
const series = { recurrence_type: 'daily', weekdays: null, range_start: DATES[0], range_end: DATES[3] };
const s = await publish(EMP_A, { tpl: template({ tag_id: TAG_A, certification_requirement: 'CREF' }), list: rows(4), series });
const sRows = (await db.query(`SELECT id, series_id, creation_row, tag_id, certification_requirement c, responsible_id,
  series_occurrence_date::text d FROM public.jobs WHERE creation_batch_id='${s.batch}' ORDER BY creation_row`)).rows;
check('serie: 4 turnos, mesma job_series, lote, etiqueta e certificacao',
  s.outcome === 'created' && sRows.length === 4 && new Set(sRows.map((r) => r.series_id)).size === 1 && sRows[0].series_id !== null &&
  sRows.every((r, i) => r.d === DATES[i] && r.tag_id === TAG_A && r.c === 'CREF' && r.responsible_id === EMP_A && r.id === s.job_ids[i]), JSON.stringify(s));
const sAgain = await publish(EMP_A, { batch: s.batch, list: rows(4), series });
const nSeries = Number((await db.query('SELECT count(*) n FROM public.job_series')).rows[0].n);
check('serie idempotente: nao nasce 2a job_series', sAgain.outcome === 'already_created' && nSeries === 1, `${sAgain.outcome} ${nSeries}`);
const weekly = await publish(GER, { list: [row(0), row(7)], series: { recurrence_type: 'weekly', weekdays: [new Date(`${DATES[0]}T12:00:00Z`).getUTCDay()], range_start: DATES[0], range_end: DATES[7] } });
check('serie semanal pelo gerente', weekly.outcome === 'created', JSON.stringify(weekly));
const uneven = await publish(EMP_A, { list: [row(0), row(1, { slots: 2 })], series });
check('serie com linhas diferentes e recusada', uneven.outcome === 'invalid' && uneven.errors[0].code === 'invalid_series');
const beforeEnc = Number((await db.query('SELECT count(*) n FROM public.job_series')).rows[0].n);
const encSeries = await publish(ENC, { list: rows(4), series });
check('encarregado nao publica serie (nada gravado)', encSeries.outcome === 'forbidden' && (await countBatch(encSeries.batch)) === 0 &&
  Number((await db.query('SELECT count(*) n FROM public.job_series')).rows[0].n) === beforeEnc, JSON.stringify(encSeries));
const badTagSeries = await publish(EMP_A, { tpl: template({ tag_id: TAG_ARQ }), list: rows(4), series });
check('serie com etiqueta arquivada: nem serie nem turno', badTagSeries.outcome === 'invalid_tag' && (await countBatch(badTagSeries.batch)) === 0 &&
  Number((await db.query('SELECT count(*) n FROM public.job_series')).rows[0].n) === beforeEnc, JSON.stringify(badTagSeries));

// DOWN do cabecalho
const down = MIG.split('\n').filter((l) => /^--   (DROP|ALTER) /.test(l)).map((l) => l.slice(5)).join('\n');
await db.exec(down);
const cols = Number((await db.query(`SELECT count(*) n FROM information_schema.columns WHERE table_name='jobs' AND column_name LIKE 'creation_%'`)).rows[0].n);
check('DOWN remove colunas e funcao', cols === 0 &&
  (await db.query(`SELECT to_regprocedure('public.create_jobs_batch(uuid,uuid,jsonb,jsonb,jsonb)') f`)).rows[0].f === null);
await db.exec(MIG);
check('reaplica depois do DOWN', true);

console.log(`\n${passed} ok, ${failed} falhas`);
process.exit(failed ? 1 : 0);
