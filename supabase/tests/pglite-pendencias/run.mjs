// Executa 20261126000500 no PGlite com os gatilhos de rating REAIS (20260622000200).
// Uso, da raiz: npx -y -p @electric-sql/pglite@0.6.0 node supabase/tests/pglite-pendencias/run.mjs
// Limite: schema minimo (stub). increment_job_view e update_average_rating sao inventadas
// (nao existem no repositorio).
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
const MIG = read('20261126000500_pendencias_wallet_views_avaliacoes');
const RATING = '20260622000200_company_rating_trigger';

const uid = (s) => `00000000-0000-0000-0000-0000000000${s}`;
const W1 = uid('a1'), W2 = uid('a2'), WSEM = uid('a3'), WOK = uid('a4'), WDIV = uid('a5');
const C1 = uid('c1'), C2 = uid('c2'), CSEM = uid('c3'), USER = uid('01');

const STUB = `
CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role BYPASSRLS;
GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO anon, authenticated, service_role;
CREATE SCHEMA auth; GRANT USAGE ON SCHEMA auth TO anon, authenticated, service_role;
CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT NULLIF(current_setting('test.uid', true), '')::uuid $$;
CREATE TABLE public.wallets (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid NOT NULL UNIQUE, balance numeric DEFAULT 0, asaas_customer_id text);
ALTER TABLE public.wallets ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users can view their own wallet" ON public.wallets FOR SELECT USING (auth.uid() = user_id);
CREATE TABLE public.workers (id uuid PRIMARY KEY, rating_average numeric DEFAULT 5.0, reviews_count integer NOT NULL DEFAULT 0, profile_views integer DEFAULT 0);
CREATE TABLE public.companies (id uuid PRIMARY KEY, rating_average numeric, reviews_count integer NOT NULL DEFAULT 0);
CREATE TABLE public.jobs (id uuid PRIMARY KEY, views integer DEFAULT 0);
CREATE TABLE public.reviews (id serial PRIMARY KEY, reviewed_id uuid NOT NULL, rating integer NOT NULL, comment text, direction text);
`;
const VIEWS = `
CREATE FUNCTION public.increment_worker_view(worker_id uuid) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN UPDATE workers SET profile_views = COALESCE(profile_views, 0) + 1 WHERE id = worker_id; END; $$;
CREATE FUNCTION public.increment_job_view(job_id uuid) RETURNS void LANGUAGE sql SECURITY DEFINER AS $$
UPDATE public.jobs SET views = views + 1 WHERE id = job_id $$;
`;
const REDUNDANT = `
CREATE FUNCTION public.update_average_rating() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN UPDATE public.workers SET rating_average = (SELECT avg(rating) FROM public.reviews WHERE reviewed_id = NEW.reviewed_id)
  WHERE id = NEW.reviewed_id; RETURN NEW; END; $$;
CREATE TRIGGER on_review_created AFTER INSERT ON public.reviews FOR EACH ROW EXECUTE FUNCTION public.update_average_rating();
`;
// Agregados incoerentes e coerentes anteriores a migration (inseridos sem gatilho).
const SEED = `
INSERT INTO public.wallets (user_id, asaas_customer_id) VALUES ('${USER}', 'cus_1');
INSERT INTO public.jobs (id) VALUES ('${uid('f1')}');
INSERT INTO public.reviews (reviewed_id, rating, direction) VALUES ('${WOK}', 4, 'worker'), ('${WDIV}', 2, NULL), ('${WDIV}', 3, 'worker'), ('${C2}', 5, 'company');
INSERT INTO public.workers (id, rating_average, reviews_count) VALUES ('${W1}', 5.0, 0), ('${W2}', 5.0, 0), ('${WSEM}', 4.7, 12), ('${WOK}', 1.1, 1), ('${WDIV}', 4.9, 7);
INSERT INTO public.companies (id, rating_average, reviews_count) VALUES ('${C1}', NULL, 0), ('${C2}', NULL, 0), ('${CSEM}', 4.5, 3);
`;
const TRIGGERS = `
CREATE TRIGGER trg_update_worker_rating AFTER INSERT ON public.reviews FOR EACH ROW EXECUTE FUNCTION public.update_worker_rating_on_review();
CREATE TRIGGER trg_update_company_rating AFTER INSERT ON public.reviews FOR EACH ROW EXECUTE FUNCTION public.update_company_rating_on_review();
`;

const { PGlite } = await loadPglite();
let passed = 0, failed = 0;
const check = (label, cond, extra = '') => {
  if (cond) { passed++; console.log('ok    ', label); } else { failed++; console.log('FALHOU', label, extra ?? ''); }
};
const fresh = async (extra = '') => {
  const db = new PGlite();
  await db.exec(STUB);
  await db.exec(read('20260311300000_restrict_wallet_update_columns'));
  await db.exec(VIEWS);
  await db.exec(SEED);
  await db.exec(fn(RATING, 'update_worker_rating_on_review'));
  await db.exec(fn(RATING, 'update_company_rating_on_review'));
  await db.exec(TRIGGERS);
  if (extra) await db.exec(extra);
  return db;
};
const as = async (db, role, sql, who = '') => {
  await db.exec(`SELECT set_config('test.uid', '${who}', false); SET ROLE ${role};`);
  try { const r = await db.query(sql); return { rows: r.rows, n: r.affectedRows }; }
  catch (e) { return { error: e }; }
  finally { await db.exec(`RESET ROLE; SELECT set_config('test.uid', '', false);`); }
};
const tryExec = async (db, sql) => { try { await db.exec(sql); return null; } catch (e) { await db.exec('ROLLBACK').catch(() => {}); return e; } };
const agg = async (db, table, id) => {
  const r = (await db.query(`SELECT rating_average m, reviews_count n FROM public.${table} WHERE id='${id}'`)).rows[0];
  return `${r.n}/${r.m === null ? 'null' : Number(r.m)}`;
};
const eq = async (db, label, table, id, want) => { const got = await agg(db, table, id); check(label, got === want, got); };
const cfg = async (db, name) => JSON.stringify((await db.query(`SELECT proconfig c FROM pg_proc WHERE proname='${name}'`)).rows[0].c);
const walletUpdate = `UPDATE public.wallets SET asaas_customer_id='cus_x' WHERE user_id='${USER}'`;
const untouched = async (db) =>
  !(await as(db, 'authenticated', walletUpdate, USER)).error
  && (await agg(db, 'workers', WSEM)) === '12/4.7'
  && (await cfg(db, 'increment_job_view')) === 'null'
  && (await db.query(`SELECT 1 FROM pg_trigger WHERE tgname='trg_zz_reviews_rating_recalc'`)).rows.length === 0;

// ------------------------------------------------------------------ aplicacao
{
  const db = await fresh(REDUNDANT);
  let r = await as(db, 'authenticated', walletUpdate, USER);
  check('ANTES: dono altera asaas_customer_id', !r.error && r.n === 1, r.error?.message);
  let e = await tryExec(db, MIG);
  check('migration aplica (com update_average_rating redundante)', !e, e?.message);
  e = await tryExec(db, MIG);
  check('migration e idempotente', !e, e?.message);

  for (const role of ['anon', 'authenticated']) {
    r = await as(db, role, walletUpdate, USER);
    check(`DEPOIS ${role}: nega UPDATE em wallets`, r.error?.code === '42501', r.error?.message ?? 'passou');
  }
  r = await as(db, 'service_role', walletUpdate);
  check('service_role segue atualizando wallets', !r.error && r.n === 1, r.error?.message);
  check('policy removida', (await db.query(`SELECT 1 FROM pg_policies WHERE policyname='Users can update own wallet safe fields'`)).rows.length === 0);
  check('dono segue lendo a carteira', (await as(db, 'authenticated', 'SELECT * FROM public.wallets', USER)).rows?.length === 1);

  for (const f of ['increment_worker_view', 'increment_job_view']) {
    check(`${f}: search_path fixo`, (await cfg(db, f)) === '["search_path=public, pg_temp"]', await cfg(db, f));
  }
  await db.exec(`SELECT public.increment_worker_view('${W1}'); SELECT public.increment_job_view('${uid('f1')}');`);
  check('contadores seguem funcionando',
    (await db.query(`SELECT (SELECT profile_views FROM public.workers WHERE id='${W1}') a, (SELECT views FROM public.jobs) b`)).rows
      .every((x) => x.a === 1 && x.b === 1));

  await eq(db, 'reconciliacao: count sem avaliacao volta ao default', 'workers', WSEM, '0/5');
  await eq(db, 'reconciliacao: empresa sem avaliacao volta a NULL', 'companies', CSEM, '0/null');
  await eq(db, 'reconciliacao: contagem divergente (inclui direction NULL)', 'workers', WDIV, '2/2.5');
  await eq(db, 'reconciliacao: empresa divergente', 'companies', C2, '1/5');
  await eq(db, 'reconciliacao: linha com contagem coerente intocada', 'workers', WOK, '1/1.1');
  await eq(db, 'reconciliacao: sem avaliacao e count 0 intocada', 'workers', W1, '0/5');

  // ---------------------------------------------------------------- INSERT / UPDATE / DELETE
  await db.exec('DROP TRIGGER on_review_created ON public.reviews');
  const add = async (id, rating, direction) => (await db.query(
    `INSERT INTO public.reviews (reviewed_id, rating, direction) VALUES ('${id}', ${rating}, ${direction ? `'${direction}'` : 'NULL'}) RETURNING id`)).rows[0].id;
  const a = await add(W1, 5, 'worker');
  const b = await add(W1, 4, null);
  const c = await add(W1, 4, 'worker');
  await eq(db, 'INSERT (funcao vigente)', 'workers', W1, '3/4.3');
  r = await as(db, 'service_role', `UPDATE public.reviews SET rating=1 WHERE id=${a}`);
  check('UPDATE aceito', !r.error, r.error?.message);
  await eq(db, 'UPDATE de nota recalcula (1 casa)', 'workers', W1, '3/3');
  await db.exec(`UPDATE public.reviews SET reviewed_id='${W2}' WHERE id=${b}`);
  await eq(db, 'troca de reviewed_id: antigo', 'workers', W1, '2/2.5');
  await eq(db, 'troca de reviewed_id: novo', 'workers', W2, '1/4');
  await db.exec(`UPDATE public.reviews SET reviewed_id='${C1}', direction='company' WHERE id=${c}`);
  await eq(db, 'troca de direction: worker antigo', 'workers', W1, '1/1');
  await eq(db, 'troca de direction: company nova', 'companies', C1, '1/4');
  await db.exec(`UPDATE public.workers SET rating_average=9 WHERE id='${W2}'; UPDATE public.reviews SET comment='x' WHERE id=${b}`);
  await eq(db, 'UPDATE so de comentario nao recalcula', 'workers', W2, '1/9');
  await db.exec(`DELETE FROM public.reviews WHERE id=${b}`);
  await eq(db, 'DELETE da ultima: worker volta ao default', 'workers', W2, '0/5');
  await db.exec(`DELETE FROM public.reviews WHERE id=${c}`);
  await eq(db, 'DELETE da ultima: company volta a NULL', 'companies', C1, '0/null');
  await db.exec(`DELETE FROM public.reviews`);
  await eq(db, 'DELETE em lote', 'workers', WDIV, '0/5');
  await db.close();
}

// ------------------------------------------------------------------ abortos sem efeito parcial
for (const [label, extra] of [
  ['funcao INVOKER que atualiza wallets', `CREATE FUNCTION public.x() RETURNS void LANGUAGE sql AS $$ UPDATE public.wallets SET asaas_customer_id = 'a' $$;`],
  ['formula vigente divergente', fn(RATING, 'update_company_rating_on_review').replaceAll("AND direction = 'company'", "AND direction = 'company' AND rating > 0")],
  ['trigger de agregado depois do recalculo', `${REDUNDANT} CREATE TRIGGER zzz_tardio AFTER DELETE ON public.reviews FOR EACH ROW EXECUTE FUNCTION public.update_average_rating();`],
  ['UPDATE concedido por heranca de role (assercao pos-escrita)', `CREATE ROLE herdado; GRANT UPDATE ON public.wallets TO herdado; GRANT herdado TO authenticated;`],
]) {
  const db = await fresh(extra);
  const e = await tryExec(db, MIG);
  check(`aborta: ${label}`, !!e && /pre-condicao|assercao/.test(e.message), e?.message ?? 'aplicou');
  check(`sem efeito parcial: ${label}`, await untouched(db));
  await db.close();
}

// ------------------------------------------------------------------ corpo sem schema e sem config
{
  const db = await fresh(`DROP FUNCTION public.increment_job_view(uuid);
    CREATE FUNCTION public.increment_job_view(job_id uuid) RETURNS void LANGUAGE sql AS $$ UPDATE jobs SET views = 1 WHERE id = job_id $$;`);
  const e = await tryExec(db, MIG);
  check('corpo sem schema: aplica sem alterar a funcao', !e && (await cfg(db, 'increment_job_view')) === 'null', e?.message);
  await db.close();
}
{
  const db = await fresh('DROP FUNCTION public.increment_job_view(uuid);');
  const e = await tryExec(db, MIG);
  check('sem increment_job_view: aplica', !e, e?.message);
  await db.close();
}

console.log(`\n${passed} ok, ${failed} falha(s)`);
process.exit(failed ? 1 : 0);
