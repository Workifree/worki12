// Executa 20261126000600_meu_estado_de_acesso no PGlite.
// Uso, da raiz: npx -y -p @electric-sql/pglite@0.6.0 node supabase/tests/pglite-acesso/run.mjs
// Limite: schema minimo (stub abaixo), sem RLS nem triggers.
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
const SQL = readFileSync(join(dir, '20261126000600_meu_estado_de_acesso.sql'), 'utf8').replace(/\r\n/g, '\n');
const id = (n) => `00000000-0000-0000-0000-${String(n).padStart(12, '0')}`;

const STUB = `
CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON FUNCTIONS TO anon, authenticated, service_role;
CREATE SCHEMA auth;
CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT NULLIF(current_setting('test.uid', true), '')::uuid $$;
CREATE TABLE public.companies (id uuid PRIMARY KEY, owner_id uuid, organization_id uuid, onboarding_completed bool);
CREATE TABLE public.company_members (company_id uuid, user_id uuid, role text, status text, removed_at timestamptz);
CREATE TABLE public.organization_members (organization_id uuid, user_id uuid, role text, status text);
`;
// empresa id(100), organizacao id(200), dono id(1)
const SEED = `
INSERT INTO public.companies VALUES ('${id(100)}', '${id(1)}', '${id(200)}', true);
INSERT INTO public.organization_members VALUES ('${id(200)}', '${id(1)}', 'owner', 'active');
INSERT INTO public.company_members VALUES
 ('${id(100)}', '${id(2)}', 'encarregado', 'removed', now()),
 ('${id(100)}', '${id(3)}', 'manager', 'removed', NULL),
 ('${id(100)}', '${id(4)}', 'encarregado', 'removed', now()),
 ('${id(100)}', '${id(4)}', 'encarregado', 'active', NULL),
 ('${id(100)}', NULL, 'encarregado', 'removed', now()),
 ('${id(100)}', '${id(8)}', 'encarregado', 'removed', now());
-- 3: casca propria apagada, sobra a organizacao orfa com linha owner ativa
INSERT INTO public.organization_members VALUES ('${id(203)}', '${id(3)}', 'owner', 'active');
INSERT INTO public.organization_members VALUES ('${id(200)}', '${id(5)}', 'operator', 'active');
INSERT INTO public.organization_members VALUES ('${id(200)}', '${id(6)}', 'operator', 'removed');
-- 9: removida, com empresa propria concluida
INSERT INTO public.company_members VALUES ('${id(100)}', '${id(9)}', 'encarregado', 'removed', now());
INSERT INTO public.companies VALUES ('${id(9)}', '${id(9)}', '${id(209)}', true);
-- 8: removida, com casca propria
INSERT INTO public.companies VALUES ('${id(8)}', '${id(8)}', '${id(208)}', false);
INSERT INTO public.organization_members VALUES ('${id(208)}', '${id(8)}', 'owner', 'active');
`;

const { PGlite } = await loadPglite();
let passed = 0, failed = 0;
const check = (label, cond, extra = '') => {
  if (cond) { passed++; console.log('ok    ', label); } else { failed++; console.log('FALHOU', label, extra); }
};
const apply = async (db, label) => {
  try { await db.exec(`BEGIN;\n${SQL}\nCOMMIT;`); check(label, true); }
  catch (e) { await db.exec('ROLLBACK'); check(label, false, e.message); }
};

const empty = new PGlite();
await empty.exec('CREATE TABLE public.companies (id uuid);');
let halted = '';
try { await empty.exec(SQL); } catch (e) { halted = e.message; }
check('sem o schema de equipe a pre-condicao aborta', halted.includes('PRECONDICAO'), halted);

const db = new PGlite();
await db.exec(STUB);
await db.exec(SEED);
await apply(db, 'aplica');
await apply(db, 'reaplica (idempotente)');

async function state(uid) {
  await db.query(`SELECT set_config('test.uid', $1, false)`, [uid]);
  return (await db.query('SELECT public.my_access_state() AS s')).rows[0].s;
}
// [rotulo, uid, removed, has_active, owns_company]
const cases = [
  ['dono com onboarding concluido', id(1), false, false, true],
  ['removida com empresa propria concluida', id(9), true, false, true],
  ['encarregado removido', id(2), true, false, false],
  ['gerente F13 revogado, sem removed_at e com org orfa', id(3), true, false, false],
  ['removido e reconvidado (ativo)', id(4), true, true, false],
  ['operador de organizacao ativo', id(5), false, true, false],
  ['operador de organizacao removido', id(6), true, false, false],
  ['pessoa sem vinculo nenhum', id(7), false, false, false],
  ['removida com casca incompleta: nao e dona', id(8), true, false, false],
  ['sessao nula (convite com user_id NULL nao conta)', '', false, false, false],
];
for (const [label, uid, removed, active, owns] of cases) {
  const s = await state(uid);
  check(label, Object.keys(s).sort().join() === 'has_active,owns_company,removed'
    && s.removed === removed && s.has_active === active && s.owns_company === owns, JSON.stringify(s));
}
const g = (await db.query(`SELECT
  has_function_privilege('anon', 'public.my_access_state()', 'EXECUTE') AS anon,
  has_function_privilege('authenticated', 'public.my_access_state()', 'EXECUTE') AS auth`)).rows[0];
check('anon sem EXECUTE, authenticated com', g.anon === false && g.auth === true, JSON.stringify(g));

console.log(`\n${passed} ok, ${failed} falha(s)`);
process.exit(failed ? 1 : 0);
