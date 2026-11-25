// Executa 20261126000900_previa_de_convite no PGlite.
// Uso, da raiz: npx -y -p @electric-sql/pglite@0.6.0 node supabase/tests/pglite-previa/run.mjs
// Limite: schema minimo (stub abaixo); os tokens do seed imitam o formato dos geradores reais.
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
const SQL = readFileSync(join(dir, '20261126000900_previa_de_convite.sql'), 'utf8').replace(/\r\n/g, '\n');
const id = (n) => `00000000-0000-0000-0000-${String(n).padStart(12, '0')}`;
const hex = (ch, n) => ch.repeat(n);

const STUB = `
CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON FUNCTIONS TO anon, authenticated, service_role;
GRANT USAGE ON SCHEMA public TO anon, authenticated;
CREATE TABLE public.companies (id uuid PRIMARY KEY, name text, anonymized_at timestamptz);
CREATE TABLE public.company_invite_links (company_id uuid PRIMARY KEY, token text NOT NULL UNIQUE);
CREATE TABLE public.company_members (company_id uuid, invite_token text, invite_token_hash text,
  role text, status text, expires_at timestamptz);
`;
const SEED = `
INSERT INTO public.companies VALUES
 ('${id(1)}', 'Momma Doces', NULL), ('${id(2)}', 'Apagada', now()), ('${id(3)}', '   ', NULL);
INSERT INTO public.company_invite_links VALUES
 ('${id(1)}', '${hex('a', 48)}'), ('${id(2)}', '${hex('b', 48)}'), ('${id(3)}', '${hex('c', 48)}');
INSERT INTO public.company_members VALUES
 ('${id(1)}', '${hex('1', 64)}', NULL, 'manager', 'invited', now() + interval '7 days'),
 ('${id(1)}', '${hex('2', 64)}', NULL, 'manager', 'invited', now() - interval '1 second'),
 ('${id(1)}', '${hex('3', 64)}', NULL, 'manager', 'removed', now() + interval '7 days'),
 ('${id(1)}', '${hex('4', 64)}', NULL, 'manager', 'active', now() + interval '7 days'),
 ('${id(1)}', '${hex('5', 64)}', NULL, 'encarregado', 'invited', now() + interval '7 days'),
 ('${id(2)}', '${hex('6', 64)}', NULL, 'manager', 'invited', now() + interval '7 days'),
 ('${id(1)}', '${hex('7', 64)}', NULL, 'manager', 'invited', NULL),
 ('${id(1)}', NULL, encode(sha256(convert_to('${hex('8', 64)}', 'UTF8')), 'hex'), 'manager', 'removed', NULL);
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
check('sem o schema a pre-condicao aborta', halted.includes('PRECONDICAO'), halted);

const db = new PGlite();
await db.exec(STUB);
await db.exec(SEED);
await apply(db, 'aplica');
await apply(db, 'reaplica (idempotente)');

const preview = async (t) => (await db.query('SELECT public.get_invite_preview($1) AS r', [t])).rows[0].r;
const snapshot = async () => JSON.stringify([
  (await db.query('SELECT * FROM public.company_invite_links ORDER BY company_id')).rows,
  (await db.query('SELECT * FROM public.company_members ORDER BY invite_token')).rows,
]);
const before = await snapshot();

await db.exec('SET ROLE anon');
let denied = false;
try { await db.query('SELECT * FROM public.company_invite_links'); } catch { denied = true; }
check('anon nao le a tabela de tokens', denied);

const isOk = (r, kind) => Object.keys(r).sort().join() === 'inviter_name,kind,outcome'
  && r.outcome === 'ok' && r.kind === kind && r.inviter_name === 'Momma Doces';
let r = await preview(hex('a', 48));
check('anon: link de Elenco', isOk(r, 'elenco'), JSON.stringify(r));
r = await preview(hex('1', 64));
check('anon: convite de gerente', isOk(r, 'gerente'), JSON.stringify(r));

const w = 'w_' + Buffer.from(id(1)).toString('base64url');
const bad = [
  ['nulo', null], ['vazio', ''], ['gigante', hex('a', 1_000_000)], ['curto', hex('a', 47)],
  ['maiusculo', hex('A', 48)], ['nao hex', hex('z', 48)], ['com espaco', ` ${hex('a', 48)} `],
  ['newline no fim', hex('a', 47) + '\n'], ['link w_ de freela', w],
  ['base64 antigo de empresa', Buffer.from(id(1)).toString('base64')],
  ['elenco inexistente ou rotacionado', hex('d', 48)], ['empresa anonimizada (elenco)', hex('b', 48)],
  ['empresa sem nome', hex('c', 48)], ['gerente inexistente', hex('9', 64)],
  ['gerente expirado', hex('2', 64)], ['gerente revogado', hex('3', 64)],
  ['gerente ja aceito', hex('4', 64)], ['encarregado (outra RPC)', hex('5', 64)],
  ['empresa anonimizada (gerente)', hex('6', 64)], ['gerente sem validade', hex('7', 64)],
  ['gerente queimado (so hash)', hex('8', 64)],
];
for (const [label, t] of bad) {
  const x = await preview(t);
  check(`not_found: ${label}`, Object.keys(x).length === 3 && x.outcome === 'not_found'
    && x.inviter_name === null && x.kind === null, JSON.stringify(x));
}
await db.exec('RESET ROLE; SET ROLE authenticated');
check('authenticated executa', isOk(await preview(hex('a', 48)), 'elenco'));
await db.exec('RESET ROLE');
check('sem efeito colateral', (await snapshot()) === before);

console.log(`\n${passed} ok, ${failed} falha(s)`);
process.exit(failed ? 1 : 0);
