// Executa 20261126000400 no PGlite: reproduz a forja de saldo ANTES, nega DEPOIS e prova os fluxos
// legitimos, com os corpos REAIS das RPCs/gatilhos e RLS ligada.
// Uso, da raiz: npx -y -p @electric-sql/pglite@0.6.0 node supabase/tests/pglite-saldo/escrita.mjs
// Limite: schema minimo (stub). Policies de escrita do escrow com os nomes do catalogo real;
// a policy ALL e inventada, para exercitar a recriacao do SELECT.
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
const fn = (file, name) => {
  const src = read(file);
  const m = new RegExp(`CREATE OR REPLACE FUNCTION (public\\.)?${name}\\s*\\(`).exec(src);
  if (!m) throw new Error(`funcao ${name} ausente em ${file}`);
  const open = src.indexOf('$$', m.index);
  const close = src.indexOf('$$', open + 2);
  return src.slice(m.index, src.indexOf(';', close) + 1);
};
const HARD = '20260311100000_security_hardening_checkout_escrow';
const FUNCS = [
  fn(HARD, 'release_escrow'),
  fn(HARD, 'refund_escrow'),
  fn('20260318210000_move_fees_to_deposit', 'reserve_escrow'),
  fn('20260318220000_update_fee_labels', 'credit_deposit'),
  fn('20260622000900_postpago_no_escrow_in_trigger', 'auto_reserve_escrow_on_hire'),
  fn('20260311500000_auto_create_wallet_on_escrow_release', 'auto_release_escrow_on_completion'),
].join('\n');
const MIG = read('20261126000400_escrita_direta_de_saldo_fechada');

const uid = (s) => `00000000-0000-0000-0000-0000000000${s}`;
const COMPANY = uid('0c'), ATTACKER = uid('0d'), WORKER = uid('0a'), NEW1 = uid('11'), NEW2 = uid('12'), NEW3 = uid('13');
const CW = uid('c1'), AW = uid('d1');
const job = (n) => `00000000-0000-0000-0000-0000000001${String(n).padStart(2, '0')}`;

const STUB = `
CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role BYPASSRLS;
GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO anon, authenticated, service_role;
CREATE SCHEMA auth;
GRANT USAGE ON SCHEMA auth TO anon, authenticated, service_role;
CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT NULLIF(current_setting('test.uid', true), '')::uuid $$;
CREATE TABLE public.wallets (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid NOT NULL UNIQUE, user_type text NOT NULL, balance numeric(10,2) DEFAULT 0, asaas_customer_id text, asaas_account_status jsonb DEFAULT '{"general": "PENDING"}'::jsonb, created_at timestamptz DEFAULT now(), updated_at timestamptz DEFAULT now());
CREATE TABLE public.wallet_transactions (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), wallet_id uuid REFERENCES public.wallets(id), amount numeric, type text, description text, reference_id text);
CREATE UNIQUE INDEX ON public.wallet_transactions (wallet_id, reference_id) WHERE reference_id IS NOT NULL;
CREATE TABLE public.escrow_transactions (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), job_id uuid, application_id uuid, amount numeric, service_fee numeric, processing_fee numeric, company_wallet_id uuid REFERENCES public.wallets(id), worker_wallet_id uuid, status text DEFAULT 'reserved', kind text DEFAULT 'prepaid', released_at timestamptz);
CREATE TABLE public.jobs (id uuid PRIMARY KEY, company_id uuid, budget numeric);
CREATE TABLE public.applications (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), job_id uuid, worker_id uuid, status text, invited_by_company_at timestamptz, company_checkout_confirmed_at timestamptz, worker_checkout_at timestamptz);
ALTER TABLE public.wallets ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.escrow_transactions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.wallet_transactions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users can view their own wallet" ON public.wallets FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Users can insert their own wallet" ON public.wallets FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Company can view their escrow" ON public.escrow_transactions FOR SELECT USING (company_wallet_id IN (SELECT id FROM public.wallets WHERE user_id = auth.uid()));
CREATE POLICY "Worker can view their escrow" ON public.escrow_transactions FOR SELECT USING (worker_wallet_id IN (SELECT id FROM public.wallets WHERE user_id = auth.uid()));
CREATE POLICY "Users can view their transactions" ON public.wallet_transactions FOR SELECT USING (wallet_id IN (SELECT id FROM public.wallets WHERE user_id = auth.uid()));
CREATE POLICY "Users can insert their escrow" ON public.escrow_transactions FOR INSERT WITH CHECK (company_wallet_id IN (SELECT id FROM public.wallets WHERE user_id = auth.uid()));
CREATE POLICY "Users can update their escrow" ON public.escrow_transactions FOR UPDATE USING (company_wallet_id IN (SELECT id FROM public.wallets WHERE user_id = auth.uid()));
`;
const SETUP = `
CREATE TRIGGER trg_auto_reserve_escrow_on_hire AFTER UPDATE ON public.applications FOR EACH ROW EXECUTE FUNCTION auto_reserve_escrow_on_hire();
CREATE TRIGGER trg_auto_release_escrow AFTER UPDATE ON public.applications FOR EACH ROW EXECUTE FUNCTION auto_release_escrow_on_completion();
INSERT INTO public.wallets (id, user_id, user_type, balance) VALUES ('${CW}', '${COMPANY}', 'company', 1000), ('${AW}', '${ATTACKER}', 'company', 0);
INSERT INTO public.jobs SELECT ('00000000-0000-0000-0000-0000000001' || lpad(g::text, 2, '0'))::uuid, '${COMPANY}', 100 FROM generate_series(1, 9) g;
`;

const { PGlite } = await loadPglite();
let passed = 0, failed = 0;
const check = (label, cond, extra = '') => {
  if (cond) { passed++; console.log('ok    ', label); } else { failed++; console.log('FALHOU', label, extra ?? ''); }
};
const fresh = async () => {
  const db = new PGlite();
  await db.exec(STUB);
  await db.exec(FUNCS);
  await db.exec(read('20260311300000_restrict_wallet_update_columns'));
  await db.exec(SETUP);
  return db;
};
const as = async (db, role, sql, who = '') => {
  await db.exec(`SELECT set_config('test.uid', '${who}', false); SET ROLE ${role};`);
  try { const r = await db.query(sql); return { rows: r.rows, n: r.affectedRows }; }
  catch (e) { return { error: e }; }
  finally { await db.exec(`RESET ROLE; SELECT set_config('test.uid', '', false);`); }
};
const one = async (db, sql) => (await db.query(sql)).rows[0];
const bal = async (db, user) => Number((await one(db, `SELECT balance FROM public.wallets WHERE user_id='${user}'`))?.balance);
const denied = (r) => r.error?.code === '42501';

const forge = (n, amount) => `INSERT INTO public.escrow_transactions (job_id, amount, company_wallet_id, status) VALUES ('${job(n)}', ${amount}, '${AW}', 'reserved')`;
const richWallet = (u) => `INSERT INTO public.wallets (user_id, balance, user_type) VALUES ('${u}', 999999, 'worker')`;
// Payload real de WalletService.getOrCreateWallet (.insert(...).select()).
const legit = (u, t) => `INSERT INTO public.wallets (user_id, balance, user_type) VALUES ('${u}', 0.00, '${t}') RETURNING *`;
// refund_escrow confere dono via jobs.company_id: o atacante forja sobre turno PROPRIO.
const OWN_JOB = `INSERT INTO public.jobs VALUES ('${job(20)}', '${ATTACKER}', 1)`;

// ------------------------------------------------------------------ ANTES
{
  const db = await fresh();
  await db.exec(OWN_JOB);
  let r = await as(db, 'authenticated', forge(20, 5000), ATTACKER);
  check('ANTES: forja de escrow reserved aceita', !r.error, r.error?.message);
  r = await as(db, 'authenticated', `SELECT * FROM public.refund_escrow('${job(20)}')`, ATTACKER);
  check('ANTES: refund_escrow credita saldo forjado', !r.error && (await bal(db, ATTACKER)) === 5000, r.error?.message);
  r = await as(db, 'authenticated', `UPDATE public.escrow_transactions SET status='reserved' WHERE company_wallet_id='${AW}'`, ATTACKER);
  check('ANTES: reabre escrow refunded', !r.error && r.n === 1, r.error?.message);
  r = await as(db, 'authenticated', richWallet(NEW1), NEW1);
  check('ANTES: carteira nasce com saldo arbitrario', !r.error && (await bal(db, NEW1)) === 999999, r.error?.message);
  await db.close();
}

// ------------------------------------------------------------------ DEPOIS
const db = await fresh();
await db.exec(OWN_JOB);
// ALL extra (da SELECT a um terceiro) para provar a recriacao da leitura; e linha previa para UPDATE.
await db.exec(`CREATE POLICY "all fora do repo" ON public.wallet_transactions FOR ALL TO authenticated USING (auth.uid() = '${NEW3}');
  INSERT INTO public.wallet_transactions (wallet_id, amount, type) VALUES ('${CW}', 1, 'credit');
  INSERT INTO public.escrow_transactions (job_id, amount, company_wallet_id, status) VALUES ('${job(20)}', 1, '${AW}', 'refunded');`);
await db.exec(MIG);
check('migration aplica', true);
await db.exec(MIG);
check('migration e idempotente', true);
const pols = (await db.query(`SELECT tablename, policyname, cmd FROM pg_policies WHERE tablename IN ('escrow_transactions','wallet_transactions')`)).rows;
check('razao so tem policies SELECT (4: 3 originais + a recriada do ALL)', pols.length === 4 && pols.every((p) => p.cmd === 'SELECT'), JSON.stringify(pols));
check('leitura concedida pela antiga ALL preservada', (await as(db, 'authenticated', 'SELECT * FROM public.wallet_transactions', NEW3)).rows?.length === 1);

for (const [label, sql] of [
  ['forja de escrow', forge(20, 5000)],
  ['reabrir refunded trocando job_id', `UPDATE public.escrow_transactions SET status='reserved', job_id='${job(1)}'`],
  ['apagar escrow', 'DELETE FROM public.escrow_transactions'],
  ['truncate escrow', 'TRUNCATE public.escrow_transactions'],
  ['inserir no razao', `INSERT INTO public.wallet_transactions (wallet_id, amount, type) VALUES ('${AW}', 1, 'credit')`],
  ['alterar razao', 'UPDATE public.wallet_transactions SET amount = 9'],
  ['apagar carteira', 'DELETE FROM public.wallets'],
  ['truncate carteira', 'TRUNCATE public.wallets CASCADE'],
  ['alterar saldo', 'UPDATE public.wallets SET balance = 9'],
]) {
  for (const role of ['anon', 'authenticated']) {
    const r = await as(db, role, sql, role === 'anon' ? '' : ATTACKER);
    check(`DEPOIS ${role}: nega ${label}`, denied(r), r.error?.message ?? 'passou');
  }
}
check('DEPOIS: carteira com saldo arbitrario negada', denied(await as(db, 'authenticated', richWallet(NEW1), NEW1)));
check('DEPOIS: balance NULL negado', denied(await as(db, 'authenticated', `INSERT INTO public.wallets (user_id, balance, user_type) VALUES ('${NEW1}', NULL, 'worker')`, NEW1)));
check('DEPOIS: balance negativo negado', denied(await as(db, 'authenticated', `INSERT INTO public.wallets (user_id, balance, user_type) VALUES ('${NEW1}', -1, 'worker')`, NEW1)));
check('DEPOIS: asaas_customer_id na criacao negado', denied(await as(db, 'authenticated', `INSERT INTO public.wallets (user_id, user_type, asaas_customer_id) VALUES ('${NEW1}', 'worker', 'cus_x')`, NEW1)));
check('DEPOIS: anon nao cria carteira', denied(await as(db, 'anon', legit(NEW1, 'worker'))));
check('saldo do atacante intacto', (await bal(db, ATTACKER)) === 0);

// ------------------------------------------------------------------ fluxos legitimos
for (const [u, t] of [[NEW1, 'worker'], [NEW2, 'company']]) {
  const r = await as(db, 'authenticated', legit(u, t), u);
  check(`getOrCreateWallet (${t}) cria e devolve a linha`, r.rows?.length === 1 && Number(r.rows[0].balance) === 0, r.error?.message);
}
check('RLS: nao cria carteira em nome de outro', denied(await as(db, 'authenticated', legit(uid('99'), 'worker'), NEW3)));
const status = async (u) => JSON.stringify((await one(db, `SELECT asaas_account_status s FROM public.wallets WHERE user_id='${u}'`))?.s);
check('payload legitimo grava o status default', (await status(NEW1)) === '{"general":"PENDING"}', await status(NEW1));
for (const [u, v] of [[uid('31'), `'{"general": "APPROVED"}'`], [uid('32'), 'NULL']]) {
  const r = await as(db, 'authenticated', `INSERT INTO public.wallets (user_id, balance, user_type, asaas_account_status) VALUES ('${u}', 0, 'worker', ${v})`, u);
  check(`status forjado (${v}) e normalizado`, !r.error && (await status(u)) === '{"general":"PENDING"}', r.error?.message ?? await status(u));
}
check('carteira omitindo balance (default 0) aceita', !(await as(db, 'authenticated', `INSERT INTO public.wallets (user_id, user_type) VALUES ('${NEW3}', 'worker')`, NEW3)).error);
check('dono segue lendo o proprio escrow', (await as(db, 'authenticated', 'SELECT * FROM public.escrow_transactions', ATTACKER)).rows?.length === 1);
check('dono segue lendo o proprio razao', (await as(db, 'authenticated', 'SELECT * FROM public.wallet_transactions', COMPANY)).rows?.length === 1);
{
  let r = await as(db, 'service_role', `INSERT INTO public.wallets (user_id, balance, user_type, asaas_customer_id) VALUES ('${uid('21')}', 5, 'worker', 'cus_1')`);
  check('service_role cria carteira sem restricao', !r.error, r.error?.message);
  r = await as(db, 'service_role', `UPDATE public.wallets SET asaas_customer_id='cus_2' WHERE user_id='${uid('21')}'`);
  check('service_role atualiza carteira', !r.error && r.n === 1, r.error?.message);
  r = await as(db, 'service_role', `INSERT INTO public.wallet_transactions (wallet_id, amount, type, reference_id) VALUES ('${AW}', -1, 'debit', 'w1')`);
  check('service_role insere no razao (asaas-withdraw)', !r.error, r.error?.message);
  r = await as(db, 'service_role', `UPDATE public.wallet_transactions SET reference_id='w2' WHERE reference_id='w1'`);
  check('service_role atualiza o razao', !r.error && r.n === 1, r.error?.message);
  r = await as(db, 'service_role', `SELECT public.credit_deposit('${NEW1}', 10, 'pay_1')`);
  check('credit_deposit (DEFINER) credita', !r.error && (await bal(db, NEW1)) === 10, r.error?.message);
}
const app = async (n, worker) => (await one(db,
  `INSERT INTO public.applications (job_id, worker_id, status) VALUES ('${job(n)}', '${worker}', 'pending') RETURNING id`)).id;
const hire = (id) => as(db, 'authenticated', `UPDATE public.applications SET status='hired' WHERE id='${id}'`, COMPANY);
{
  const id = await app(1, WORKER); // WORKER ainda sem carteira
  let r = await hire(id);
  check('gatilho de contratacao reserva escrow (reserve_escrow)', !r.error && (await bal(db, COMPANY)) === 900, r.error?.message);
  r = await as(db, 'authenticated', `UPDATE public.applications SET status='completed', company_checkout_confirmed_at=now(), worker_checkout_at=now() WHERE id='${id}'`, COMPANY);
  check('gatilho de conclusao cria carteira e libera (release_escrow)', !r.error && (await bal(db, WORKER)) === 100, r.error?.message);
  await hire(await app(2, WORKER));
  r = await as(db, 'authenticated', `SELECT * FROM public.refund_escrow('${job(2)}')`, COMPANY);
  check('refund_escrow legitimo estorna', !r.error && (await bal(db, COMPANY)) === 900, r.error?.message);
}
await db.close();

// ------------------------------------------------------------------ pre-condicoes abortam sem efeito parcial
for (const [label, setup, pattern] of [
  ['aborta com funcao INVOKER escrevendo no razao',
    `CREATE FUNCTION public.intrusa() RETURNS void LANGUAGE sql AS $$ DELETE FROM public.escrow_transactions $$;`, /INVOKER escreve/],
  ['aborta com FORCE RLS', 'ALTER TABLE public.escrow_transactions FORCE ROW LEVEL SECURITY;', /FORCE RLS/],
  ['aborta com view gravavel sobre wallets', 'CREATE VIEW public.v_w AS SELECT * FROM public.wallets;', /view gravavel/],
]) {
  const d = await fresh();
  await d.exec(setup);
  let msg = '';
  try { await d.exec(MIG); } catch (e) { msg = e.message; }
  check(label, pattern.test(msg), msg);
  const x = await one(d, `SELECT has_table_privilege('authenticated','public.escrow_transactions','INSERT') g, (SELECT count(*)::int FROM pg_policies WHERE tablename='escrow_transactions' AND cmd<>'SELECT') p`);
  check(`${label}: nada aplicado pela metade`, x.g === true && x.p === 2);
  await d.close();
}

console.log(`\n${passed} ok, ${failed} falha(s)`);
process.exit(failed ? 1 : 0);
