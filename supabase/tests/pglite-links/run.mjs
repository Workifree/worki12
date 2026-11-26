// Executa 20261126000300 no PGlite sobre a notify_new_message de 20260823000600.
// Uso, da raiz: npx -y -p @electric-sql/pglite@0.6.0 node supabase/tests/pglite-links/run.mjs
// Limite: schema minimo (stub abaixo), sem RLS.
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
const OLD = read('20260823000600_notificacao_de_mensagem_nunca_funcionou');
const FIX = read('20261126000300_aviso_de_chat_rota_da_empresa');

const id = (n) => `00000000-0000-0000-0000-00000000000${n}`;
const EMPRESA = id(1), FREELA = id(2), JOB = id(3), APP = id(4), ORFA = id(5);
const STUB = `
CREATE SCHEMA auth;
CREATE TABLE auth.users (id uuid PRIMARY KEY);
CREATE TABLE public.workers (id uuid PRIMARY KEY, full_name text);
CREATE TABLE public.companies (id uuid PRIMARY KEY, name text);
CREATE TABLE public.jobs (id uuid PRIMARY KEY, company_id uuid);
CREATE TABLE public.applications (id uuid PRIMARY KEY, job_id uuid, worker_id uuid);
CREATE TABLE public."Conversation" (id text PRIMARY KEY, application_uuid uuid);
CREATE TABLE public."Message" (id text PRIMARY KEY, content text, conversationid text, senderid text);
CREATE TABLE public.notifications (id serial, user_id uuid, type text, title text, message text, link text, read_at timestamptz, created_at timestamptz);
INSERT INTO auth.users VALUES ('${EMPRESA}'), ('${FREELA}'), ('${ORFA}');
INSERT INTO public.companies VALUES ('${EMPRESA}', 'Empresa'), ('${ORFA}', 'Orfa');
INSERT INTO public.workers VALUES ('${FREELA}', 'Freela');
INSERT INTO public.jobs VALUES ('${JOB}', '${EMPRESA}');
INSERT INTO public.applications VALUES ('${APP}', '${JOB}', '${FREELA}');
INSERT INTO public."Conversation" VALUES ('conv-1', '${APP}');
`;

const { PGlite } = await loadPglite();
let passed = 0, failed = 0;
const check = (label, cond, extra = '') => {
  if (cond) { passed++; console.log('ok    ', label); } else { failed++; console.log('FALHOU', label, extra); }
};
const db = new PGlite();
await db.exec(STUB);
await db.exec(OLD);
await db.exec('CREATE TRIGGER trg_notify_new_message AFTER INSERT ON public."Message" FOR EACH ROW EXECUTE FUNCTION public.notify_new_message();');

let seq = 0;
const send = (from) => db.exec(`INSERT INTO public."Message" VALUES ('m${++seq}', 'oi', 'conv-1', '${from}')`);
const rows = async () => (await db.query('SELECT user_id, type, title, message, link FROM public.notifications ORDER BY id')).rows;
const links = async () => (await rows()).map((r) => `${r.user_id}|${r.link}`);

await send(FREELA); await send(EMPRESA);
const antes = await rows();
check('antes: empresa recebia a rota do freela', antes[0].user_id === EMPRESA && antes[0].link === '/messages?conversation=conv-1');
await db.exec(`INSERT INTO public.notifications (user_id, type, link) VALUES
  ('${ORFA}', 'message', '/messages?conversation=apagada'),
  ('${FREELA}', 'message', '/messages?conversation=apagada'),
  ('${EMPRESA}', 'system', '/messages?conversation=conv-1')`);

await db.exec(FIX);
const l = await links();
check('antigo da empresa corrigido', l[0] === `${EMPRESA}|/company/messages?conversation=conv-1`, l[0]);
check('antigo do freela intacto', l[1] === `${FREELA}|/messages?conversation=conv-1`, l[1]);
check('orfao de empresa corrigido', l[2] === `${ORFA}|/company/messages?conversation=apagada`, l[2]);
check('orfao de freela intacto', l[3] === `${FREELA}|/messages?conversation=apagada`, l[3]);
check('outro tipo intacto', l[4] === `${EMPRESA}|/messages?conversation=conv-1`, l[4]);

await send(FREELA); await send(EMPRESA);
const novos = (await rows()).slice(-2);
check('novo: freela -> empresa', novos[0].user_id === EMPRESA && novos[0].link === '/company/messages?conversation=conv-1');
check('novo: empresa -> freela', novos[1].user_id === FREELA && novos[1].link === '/messages?conversation=conv-1');
check('titulo e mensagem preservados', novos[0].title === 'Nova mensagem de Freela' && novos[0].message === 'oi');

const meta = (await db.query("SELECT prosecdef, proconfig FROM pg_proc WHERE proname = 'notify_new_message'")).rows[0];
check('DEFINER e search_path preservados', meta.prosecdef === true && String(meta.proconfig).includes('search_path=public'));

await send('nao-e-uuid');
check('erro no aviso nao derruba a mensagem', (await db.query('SELECT count(*)::int c FROM public."Message"')).rows[0].c === seq);

const total = (await links()).join();
await db.exec(FIX);
check('reaplicar e idempotente', (await links()).join() === total);

await db.exec('CREATE OR REPLACE FUNCTION public.notify_new_message() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RETURN NEW; END $$;');
let halt = '';
try { await db.exec(FIX); } catch (e) { halt = e.message; }
check('corpo inesperado: HALT', halt.includes('PRECONDICAO'), halt);

console.log(`\n${passed} ok, ${failed} falha(s)`);
process.exit(failed ? 1 : 0);
