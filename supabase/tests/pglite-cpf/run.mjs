// Executa 20261129000100_cpf_leitura_propria (etapa 1) e o rascunho da etapa 2 no PGlite.
// Uso, da raiz: npx -y -p @electric-sql/pglite@0.6.0 node supabase/tests/pglite-cpf/run.mjs
// Limite: stub minimo de workers/RLS; a policy de SELECT emula "vinculo aceito" (USING true).
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
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const rd = (p) => readFileSync(join(root, p), 'utf8').replace(/\r\n/g, '\n');
const ETAPA1 = rd('supabase/migrations/20261129000100_cpf_leitura_propria.sql');
const ETAPA2 = rd('.harness/spec/cpf-restrito/etapa2_trava_coluna.sql.pendente');
const W = '00000000-0000-0000-0000-000000000001';   // freela
const C = '00000000-0000-0000-0000-000000000002';   // empresa com vinculo

const STUB = `
CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;
GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role;
CREATE SCHEMA auth; GRANT USAGE ON SCHEMA auth TO anon, authenticated, service_role;
CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS
  $$ SELECT nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
CREATE TABLE public.workers (id uuid PRIMARY KEY, full_name text, phone text, pix_key text,
  cpf text, birth_date date, onboarding_completed boolean DEFAULT false, anonymized_at timestamptz);
ALTER TABLE public.workers ENABLE ROW LEVEL SECURITY;
CREATE POLICY w_sel ON public.workers FOR SELECT USING (true);
CREATE POLICY w_ins ON public.workers FOR INSERT WITH CHECK (id = auth.uid());
CREATE POLICY w_upd ON public.workers FOR UPDATE USING (id = auth.uid());
GRANT SELECT, INSERT, UPDATE ON public.workers TO authenticated;
GRANT ALL ON public.workers TO service_role;
-- imita render/accept_service_term: DEFINER de postgres lendo cpf
CREATE FUNCTION public.term_reads_cpf(p uuid) RETURNS text LANGUAGE sql SECURITY DEFINER SET search_path = ''
  AS $$ SELECT cpf FROM public.workers WHERE id = p $$;
GRANT EXECUTE ON FUNCTION public.term_reads_cpf(uuid) TO authenticated;
INSERT INTO public.workers VALUES ('${W}', 'Ana', '11999', 'k', NULL, NULL, false, NULL);
`;

const { PGlite } = await loadPglite();
let passed = 0, failed = 0;
const check = (l, c, x = '') => { if (c) { passed++; console.log('ok    ', l); } else { failed++; console.log('FALHOU', l, x); } };
const db = new PGlite();
await db.exec(STUB);

const as = async (role, uid, sql) => {
  await db.exec(`RESET ROLE; SELECT set_config('request.jwt.claim.sub', '${uid ?? ''}', false); SET ROLE ${role};`);
  try { return { rows: (await db.query(sql)).rows }; } catch (e) { return { err: e }; }
  finally { await db.exec('RESET ROLE'); }
};
const code = (r) => r.err?.code;

// ---------- Etapa 1 ----------
try { await db.exec(`BEGIN;\n${ETAPA1}\nCOMMIT;`); check('etapa 1 aplica', true); }
catch (e) { await db.exec('ROLLBACK'); check('etapa 1 aplica', false, e.message); }
try { await db.exec(ETAPA1); check('etapa 1 idempotente', true); } catch (e) { check('etapa 1 idempotente', false, e.message); }

const setId = async (uid, cpf, nasc = null) => (await as('authenticated', uid,
  `SELECT public.set_my_worker_identity(${cpf === null ? 'NULL' : `'${cpf}'`}, ${nasc === null ? 'NULL' : nasc.startsWith('(') ? nasc : `'${nasc}'`}) AS o`)).rows?.[0].o;
const stored = async () => (await db.query(`SELECT cpf, birth_date::text AS nasc FROM public.workers WHERE id = '${W}'`)).rows[0];
let r, o, s0;

// recusas antes de qualquer gravacao
for (const bad of ['123', '12345678901', '529.982.247-24', '111.111.111-11', '000000000000', 'abc', '52998224725x', '529/982/247-25']) {
  o = await setId(W, bad, '1990-01-02');
  check(`cpf invalido recusado: ${bad}`, o?.outcome === 'invalid_cpf', JSON.stringify(o));
}
const HOJE = "((now() AT TIME ZONE 'America/Sao_Paulo')::date)";
for (const bad of [HOJE, '2999-01-01', '1899-12-31', 'infinity', '-infinity']) {
  o = await setId(W, '52998224725', bad);
  check(`nascimento invalido recusado: ${bad}`, o?.outcome === 'invalid_birth_date', JSON.stringify(o));
}
s0 = await stored();
check('recusas nao gravam nada', s0.cpf === null && s0.nasc === null);

o = await setId(W, ' 529.982.247-25 ', '1990-01-02');
check('freela grava identidade formatada', o?.outcome === 'saved' && !o.cpf_locked && !o.birth_date_locked, JSON.stringify(o));
s0 = await stored();
check('grava so digitos e a data', s0.cpf === '52998224725' && s0.nasc === '1990-01-02', JSON.stringify(s0));
o = await setId(W, '529.982.247-25', '1990-01-02');
check('reenvio dos mesmos valores: saved', o?.outcome === 'saved' && !o.cpf_locked && !o.birth_date_locked);
o = await setId(W, '11144477735');
check('cpf ja gravado fica travado', o?.outcome === 'cpf_locked' && o.cpf_locked && !o.birth_date_locked);
o = await setId(W, '11144477735', '1985-05-05');
check('cpf e data diferentes: os dois travados', o?.outcome === 'cpf_locked' && o.cpf_locked && o.birth_date_locked);
o = await setId(W, null, '1985-05-05');
check('so data diferente: birth_date_locked', o?.outcome === 'birth_date_locked' && o.birth_date_locked && !o.cpf_locked);
s0 = await stored();
check('valores travados nao mudam', s0.cpf === '52998224725' && s0.nasc === '1990-01-02', JSON.stringify(s0));

await db.exec(`UPDATE public.workers SET birth_date = NULL`);
o = await setId(W, '11144477735', '1991-03-04');
s0 = await stored();
check('cpf travado ainda preenche data vazia', o?.outcome === 'cpf_locked' && !o.birth_date_locked && s0.nasc === '1991-03-04' && s0.cpf === '52998224725');
await db.exec(`UPDATE public.workers SET cpf = '529.982.247-25', birth_date = '1990-01-02'`);
o = await setId(W, '52998224725');
check('cpf antigo com mascara nao conta como diferente', o?.outcome === 'saved' && !o.cpf_locked);
await db.exec(`UPDATE public.workers SET cpf = '', birth_date = '1990-01-02'`);
o = await setId(W, '52998224725', '1985-05-05');
s0 = await stored();
check('cpf vazio preenche; data existente preservada', o?.outcome === 'birth_date_locked' && s0.cpf === '52998224725' && s0.nasc === '1990-01-02');

await db.exec(`UPDATE public.workers SET anonymized_at = now(), cpf = NULL, birth_date = NULL`);
o = await setId(W, '52998224725', '1990-01-02');
s0 = await stored();
check('anonimizado: recusado e nada gravado', o?.outcome === 'anonymized' && s0.cpf === null && s0.nasc === null);
r = await as('authenticated', W, `SELECT public.get_my_worker_profile() AS p`);
check('anonimizado: leitura devolve NULL', r.rows?.[0].p === null);
await db.exec(`UPDATE public.workers SET anonymized_at = NULL, cpf = '52998224725', birth_date = '1990-01-02'`);

r = await as('authenticated', W, `SELECT public.get_my_worker_profile() AS p`);
check('freela le o proprio cpf', r.rows?.[0].p.cpf === '52998224725' && r.rows[0].p.birth_date === '1990-01-02');
r = await as('authenticated', C, `SELECT public.get_my_worker_profile() AS p`);
check('outro usuario recebe NULL (nao a linha do freela)', r.rows?.[0].p === null);
o = await setId(C, '52998224725');
check('sem perfil: not_found', o?.outcome === 'not_found');
o = await setId(null, '52998224725');
check('sem sessao: unauthenticated', o?.outcome === 'unauthenticated');
r = await as('anon', null, `SELECT public.get_my_worker_profile()`);
check('anon sem EXECUTE', code(r) === '42501');
r = await as('authenticated', C, `SELECT * FROM public.workers`);
check('etapa 1 nao trava nada: select(*) da main segue funcionando', !r.err);

// ---------- Etapa 2 (rascunho) ----------
const falhaCom = async (sql, re) => {
  try { await db.exec(`BEGIN;\n${sql}\nCOMMIT;`); return false; }
  catch (e) { await db.exec('ROLLBACK'); return re.test(e.message); }
};
await db.exec('ALTER FUNCTION public.set_my_worker_identity(text, date) RENAME TO tmp_set');
check('etapa 2 para sem a RPC de escrita', await falhaCom(ETAPA2, /PRECONDICAO/));
await db.exec('ALTER FUNCTION public.tmp_set(text, date) RENAME TO set_my_worker_identity');
await db.exec('GRANT SELECT (cpf) ON public.workers TO PUBLIC');
check('etapa 2 para se cpf segue legivel via PUBLIC', await falhaCom(ETAPA2, /VERIFICACAO/));
await db.exec('REVOKE SELECT (cpf) ON public.workers FROM PUBLIC');
try { await db.exec(`BEGIN;\n${ETAPA2}\nCOMMIT;`); check('etapa 2 aplica', true); }
catch (e) { await db.exec('ROLLBACK'); check('etapa 2 aplica', false, e.message); }
try { await db.exec(ETAPA2); check('etapa 2 idempotente', true); } catch (e) { check('etapa 2 idempotente', false, e.message); }

r = await as('authenticated', C, `SELECT * FROM public.workers`);
check('empresa: select(*) falha 42501', code(r) === '42501');
r = await as('authenticated', C, `SELECT cpf FROM public.workers`);
check('empresa: select cpf falha', code(r) === '42501');
r = await as('authenticated', C, `SELECT birth_date FROM public.workers`);
check('empresa: select birth_date falha', code(r) === '42501');
r = await as('authenticated', C, `SELECT id, full_name, phone, pix_key FROM public.workers`);
check('empresa: colunas explicitas seguem', r.rows?.length === 1);
r = await as('authenticated', W, `SELECT * FROM public.workers WHERE id = '${W}'`);
check('freela: select(*) tambem falha (por isso a RPC)', code(r) === '42501');
r = await as('authenticated', W, `SELECT public.get_my_worker_profile() AS p`);
check('freela: RPC segue lendo cpf', r.rows?.[0].p.cpf === '52998224725');
r = await as('authenticated', C, `SELECT public.term_reads_cpf('${W}') AS c`);
check('termo (DEFINER) segue lendo cpf', r.rows?.[0].c === '52998224725');
r = await as('authenticated', W, `UPDATE public.workers SET full_name = 'Ana B' WHERE id = '${W}' RETURNING id`);
check('Profile update + select(id) segue', r.rows?.length === 1);
r = await as('authenticated', W, `INSERT INTO public.workers (id, full_name, onboarding_completed) VALUES ('${W}', 'Ana C', true)
  ON CONFLICT (id) DO UPDATE SET full_name = EXCLUDED.full_name, onboarding_completed = EXCLUDED.onboarding_completed`);
check('upsert do onboarding SEM cpf segue', !r.err, r.err?.message);
r = await as('authenticated', W, `INSERT INTO public.workers (id, cpf) VALUES ('${W}', '1')
  ON CONFLICT (id) DO UPDATE SET cpf = EXCLUDED.cpf`);
check('upsert COM cpf quebra (motivo de mudar o onboarding na etapa 1)', code(r) === '42501');
r = await as('service_role', null, `SELECT cpf FROM public.workers`);
check('service_role (delete-account/admin) le cpf', r.rows?.length === 1);
r = await as('anon', null, `SELECT id FROM public.workers`);
check('anon sem SELECT', code(r) === '42501');

const db2 = new PGlite();
await db2.exec(STUB.replace(', anonymized_at timestamptz)', ')').replace(', false, NULL);', ', false);'));
try { await db2.exec(ETAPA1); check('etapa 1 para sem anonymized_at', false); }
catch (e) { check('etapa 1 para sem anonymized_at', /PRECONDICAO/.test(e.message), e.message); }

console.log(`\n${passed} ok, ${failed} falhas`);
process.exit(failed ? 1 : 0);
