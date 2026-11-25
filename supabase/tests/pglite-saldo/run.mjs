// Executa 20261126000200 no PGlite sobre os corpos REAIS das RPCs de saldo e dos dois gatilhos,
// extraidos das migrations vigentes.
// Uso, da raiz: npx -y -p @electric-sql/pglite@0.6.0 node supabase/tests/pglite-saldo/run.mjs
// Limite: schema minimo (stub abaixo), sem RLS; auth.uid() vem de uma GUC; grants antigos
// simulados por default privileges. increment_job_view nao existe no repo: usa corpo stub.
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
const dir = join(resolve(dirname(fileURLToPath(import.meta.url)), '..', '..'), 'migrations');
const read = (n) => readFileSync(join(dir, `${n}.sql`), 'utf8').replace(/\r\n/g, '\n');
// Recorta um CREATE FUNCTION completo (ate o $$; de fechamento).
const fn = (file, name) => {
  const src = read(file);
  const m = new RegExp(`CREATE OR REPLACE FUNCTION (public\\.)?${name}\\s*\\(`).exec(src);
  if (!m) throw new Error(`funcao ${name} ausente em ${file}`);
  const open = src.indexOf('$$', m.index);
  const close = src.indexOf('$$', open + 2);
  return src.slice(m.index, src.indexOf(';', close) + 1);
};

const HARD = '20260311100000_security_hardening_checkout_escrow';
const POST = '20260622000800_postpago_escrow_rpcs';
const FUNCS = [
  fn(HARD, 'update_wallet_balance'),
  fn(HARD, 'release_escrow'),
  fn(HARD, 'refund_escrow'),
  fn('20260318210000_move_fees_to_deposit', 'reserve_escrow'),
  fn('20260318220000_update_fee_labels', 'credit_deposit'),
  fn(POST, 'authorize_escrow_postpago'),
  fn(POST, 'capture_escrow_postpago'),
  fn(POST, 'release_hold_postpago'),
  fn('20260317140300_create_increment_worker_view_rpc', 'increment_worker_view'),
  fn('20260712000200_worker_xp_consolidate_and_secure', 'recompute_my_aggregates'),
  fn('20260622000900_postpago_no_escrow_in_trigger', 'auto_reserve_escrow_on_hire'),
  fn('20260311500000_auto_create_wallet_on_escrow_release', 'auto_release_escrow_on_completion'),
].join('\n');
const MIG = read('20261126000200_funcoes_de_saldo_sem_anon');

const COMPANY = '00000000-0000-0000-0000-00000000000c';
const OTHER = '00000000-0000-0000-0000-00000000000d';
const WORKER = '00000000-0000-0000-0000-00000000000a';
const CW = '00000000-0000-0000-0000-0000000000c1';
const WW = '00000000-0000-0000-0000-0000000000a1';
const job = (n) => `00000000-0000-0000-0000-0000000001${String(n).padStart(2, '0')}`;

const STUB = `
CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;
GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON FUNCTIONS TO anon, authenticated, service_role;
CREATE SCHEMA auth;
GRANT USAGE ON SCHEMA auth TO anon, authenticated, service_role;
CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT NULLIF(current_setting('test.uid', true), '')::uuid $$;
CREATE TABLE public.wallets (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid UNIQUE, user_type text, balance numeric NOT NULL DEFAULT 0, updated_at timestamptz);
CREATE TABLE public.wallet_transactions (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), wallet_id uuid, amount numeric, type text, description text, reference_id text);
CREATE UNIQUE INDEX ON public.wallet_transactions (wallet_id, reference_id) WHERE reference_id IS NOT NULL;
CREATE TABLE public.escrow_transactions (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), job_id uuid, application_id uuid, amount numeric, service_fee numeric, processing_fee numeric, company_wallet_id uuid, worker_wallet_id uuid, status text, kind text DEFAULT 'prepaid', asaas_payment_id text, authorized_at timestamptz, captured_at timestamptz, released_at timestamptz);
CREATE TABLE public.jobs (id uuid PRIMARY KEY, company_id uuid, budget numeric);
CREATE TABLE public.applications (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), job_id uuid, worker_id uuid, status text, invited_by_company_at timestamptz, company_checkout_confirmed_at timestamptz, worker_checkout_at timestamptz);
CREATE TABLE public.workers (id uuid PRIMARY KEY, profile_views int);
CREATE FUNCTION public.recompute_worker_aggregates(uuid) RETURNS void LANGUAGE sql SECURITY DEFINER AS $$ SELECT $$;
CREATE FUNCTION public.increment_job_view(job_id uuid) RETURNS void LANGUAGE sql SECURITY DEFINER AS $$ SELECT $$;
CREATE FUNCTION public.get_member_invite_preview(p text) RETURNS jsonb LANGUAGE sql SECURITY DEFINER AS $$ SELECT '{}'::jsonb $$;
GRANT SELECT, UPDATE ON public.applications TO authenticated;
`;
const TRIGGERS = `
CREATE TRIGGER trg_auto_reserve_escrow_on_hire AFTER UPDATE ON public.applications FOR EACH ROW EXECUTE FUNCTION auto_reserve_escrow_on_hire();
CREATE TRIGGER trg_auto_release_escrow AFTER UPDATE ON public.applications FOR EACH ROW EXECUTE FUNCTION auto_release_escrow_on_completion();
INSERT INTO public.wallets (id, user_id, user_type, balance) VALUES ('${CW}', '${COMPANY}', 'company', 1000), ('${WW}', '${WORKER}', 'worker', 0);
INSERT INTO public.workers VALUES ('${WORKER}', 0);
INSERT INTO public.jobs SELECT ('00000000-0000-0000-0000-0000000001' || lpad(g::text, 2, '0'))::uuid, '${COMPANY}', 100 FROM generate_series(1, 9) g;
`;

const { PGlite } = await loadPglite();
let passed = 0, failed = 0;
const check = (label, cond, extra = '') => {
  if (cond) { passed++; console.log('ok    ', label); } else { failed++; console.log('FALHOU', label, extra); }
};
const fresh = async () => {
  const db = new PGlite();
  await db.exec(STUB);
  await db.exec(FUNCS);
  await db.exec(TRIGGERS);
  return db;
};
// Roda sql como a role dada (uid = claim do JWT; vazio = anon/service_role).
const as = async (db, role, sql, uid = '') => {
  await db.exec(`SELECT set_config('test.uid', '${uid}', false); SET ROLE ${role};`);
  try { return { rows: (await db.query(sql)).rows }; }
  catch (e) { return { error: e }; }
  finally { await db.exec(`RESET ROLE; SELECT set_config('test.uid', '', false);`); }
};
const one = async (db, sql) => (await db.query(sql)).rows[0];
const balance = async (db, id) => Number((await one(db, `SELECT balance FROM public.wallets WHERE id='${id}'`)).balance);
const denied = (r) => r.error?.code === '42501';

const N = 'NULL::uuid';
const SERVER = {
  update_wallet_balance: `SELECT public.update_wallet_balance(${N}, 1)`,
  credit_deposit: `SELECT public.credit_deposit(${N}, 1, 'x')`,
  release_escrow: `SELECT * FROM public.release_escrow(${N}, ${N})`,
  reserve_escrow: `SELECT public.reserve_escrow(${N}, 1, ${N})`,
  authorize_escrow_postpago: `SELECT public.authorize_escrow_postpago(${N}, ${N}, 1, 'p', ${N})`,
  capture_escrow_postpago: `SELECT * FROM public.capture_escrow_postpago(${N}, ${N})`,
  release_hold_postpago: `SELECT * FROM public.release_hold_postpago(${N})`,
};
const USER = {
  refund_escrow: `SELECT * FROM public.refund_escrow(${N})`,
  increment_worker_view: `SELECT public.increment_worker_view(${N})`,
  increment_job_view: `SELECT public.increment_job_view(${N})`,
  recompute_my_aggregates: `SELECT public.recompute_my_aggregates()`,
};

// ------------------------------------------------------------------ controle negativo
const db = await fresh();
{
  const r = await as(db, 'anon', `SELECT public.update_wallet_balance('${WW}', 50)`);
  check('ANTES: anon move saldo (falha reproduzida)', !r.error && (await balance(db, WW)) === 50, r.error?.message);
  await db.exec(`UPDATE public.wallets SET balance = 0 WHERE id='${WW}'`);
}
// sobrecarga criada "fora do repositorio"
await db.exec(`CREATE FUNCTION public.update_wallet_balance(p_wallet_id uuid, p_amount numeric, p_extra text) RETURNS numeric LANGUAGE sql SECURITY DEFINER AS $$ SELECT 0::numeric $$;`);
const bodies = `SELECT string_agg(md5(prosrc) || prosecdef::text, ',' ORDER BY oid) h FROM pg_proc WHERE pronamespace='public'::regnamespace`;
const before = (await one(db, bodies)).h;

await db.exec(MIG);
check('migration aplica', true);
await db.exec(MIG);
check('migration e idempotente (2a aplicacao)', true);
check('nenhum corpo de funcao mudou', (await one(db, bodies)).h === before);

// ------------------------------------------------------------------ matriz de permissao
for (const [name, sql] of Object.entries({ ...SERVER, ...USER })) {
  check(`anon negado: ${name}`, denied(await as(db, 'anon', sql)));
  const s = await as(db, 'service_role', sql);
  check(`service_role executa: ${name}`, !denied(s), s.error?.message);
  const a = await as(db, 'authenticated', sql, COMPANY);
  if (name in SERVER) check(`authenticated negado: ${name}`, denied(a), a.error?.message);
  else check(`authenticated mantem: ${name}`, !denied(a), a.error?.message);
}
check('anon negado na sobrecarga extra', denied(await as(db, 'anon', `SELECT public.update_wallet_balance(${N}, 1, 'x')`)));
check('authenticated negado na sobrecarga extra', denied(await as(db, 'authenticated', `SELECT public.update_wallet_balance(${N}, 1, 'x')`, COMPANY)));
check('get_member_invite_preview segue publica', !(await as(db, 'anon', `SELECT public.get_member_invite_preview('t')`)).error);

// ------------------------------------------------------------------ service_role de ponta a ponta
{
  let r = await as(db, 'service_role', `SELECT public.credit_deposit('${WORKER}', 10, 'pay_1')`);
  check('service_role: credit_deposit credita', !r.error && (await balance(db, WW)) === 10, r.error?.message);
  await as(db, 'service_role', `SELECT public.credit_deposit('${WORKER}', 10, 'pay_1')`);
  check('credit_deposit segue idempotente por reference_id', (await balance(db, WW)) === 10);
  r = await as(db, 'service_role', `SELECT public.update_wallet_balance('${WW}', -10)`);
  check('service_role: update_wallet_balance debita', !r.error && (await balance(db, WW)) === 0, r.error?.message);
  await as(db, 'service_role', `SELECT public.authorize_escrow_postpago('${job(9)}', ${N}, 30, 'pay_hold', '${COMPANY}')`);
  r = await as(db, 'service_role', `SELECT * FROM public.capture_escrow_postpago('${job(9)}', '${WW}')`);
  check('service_role: authorize + capture credita', !r.error && (await balance(db, WW)) === 30, r.error?.message);
  await db.exec(`UPDATE public.wallets SET balance = 0 WHERE id='${WW}'`);
}

// ------------------------------------------------------------------ gatilhos DEFINER disparados por usuario
const app = async (n, status) => (await one(db,
  `INSERT INTO public.applications (job_id, worker_id, status) VALUES ('${job(n)}', '${WORKER}', '${status}') RETURNING id`)).id;
{
  const id = await app(1, 'pending');
  let r = await as(db, 'authenticated', `UPDATE public.applications SET status='hired' WHERE id='${id}'`, COMPANY);
  check('gatilho de contratacao (authenticated) ainda chama reserve_escrow', !r.error && (await balance(db, CW)) === 900, r.error?.message);
  r = await as(db, 'authenticated',
    `UPDATE public.applications SET status='completed', company_checkout_confirmed_at=now(), worker_checkout_at=now() WHERE id='${id}'`, COMPANY);
  check('gatilho de conclusao (authenticated) ainda chama release_escrow', !r.error && (await balance(db, WW)) === 100, r.error?.message);
}
{
  await as(db, 'authenticated', `UPDATE public.applications SET status='hired' WHERE id='${await app(2, 'pending')}'`, COMPANY);
  const foreign = await as(db, 'authenticated', `SELECT * FROM public.refund_escrow('${job(2)}')`, OTHER);
  check('refund_escrow: authenticated que nao e dono e recusado', /Nao autorizado/.test(foreign.error?.message ?? ''), foreign.error?.message);
  const own = await as(db, 'authenticated', `SELECT * FROM public.refund_escrow('${job(2)}')`, COMPANY);
  check('refund_escrow: empresa dona estorna (fluxo do frontend)', !own.error && (await balance(db, CW)) === 900, own.error?.message);
}

// ------------------------------------------------------------------ pre-condicoes abortam sem efeito parcial
const aborts = async (label, setup, pattern) => {
  const d = await fresh();
  await d.exec(setup);
  let msg = '';
  try { await d.exec(MIG); } catch (e) { msg = e.message; }
  check(label, pattern.test(msg), msg);
  const still = (await one(d, `SELECT has_function_privilege('anon','public.update_wallet_balance(uuid,numeric)','EXECUTE') x`)).x;
  check(`${label}: nada aplicado pela metade`, still === true);
  await d.close();
};
await aborts('aborta se gatilho de escrow for INVOKER',
  `ALTER FUNCTION public.auto_reserve_escrow_on_hire() SECURITY INVOKER;`, /SECURITY INVOKER/);
await aborts('aborta se houver outra funcao INVOKER chamando RPC de saldo',
  `CREATE FUNCTION public.intrusa() RETURNS void LANGUAGE plpgsql AS $$ BEGIN PERFORM public.release_escrow(NULL, NULL); END $$;`, /INVOKER .*intrusa/);
await aborts('aborta se dono de chamador DEFINER perder EXECUTE',
  `CREATE ROLE outro_dono; GRANT CREATE ON SCHEMA public TO outro_dono;
   CREATE FUNCTION public.de_outro_dono() RETURNS void LANGUAGE plpgsql SECURITY DEFINER AS $$ BEGIN PERFORM public.release_escrow(NULL, NULL); END $$;
   ALTER FUNCTION public.de_outro_dono() OWNER TO outro_dono;`, /dono de .*de_outro_dono/);

console.log(`\n${passed} ok, ${failed} falha(s)`);
process.exit(failed ? 1 : 0);
