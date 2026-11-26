// Executa 20261202000100_tempo_real no PGlite: publicacao, RLS do sinal de turno, avisos novos sem duplicar.
// Uso, da raiz: npx -y -p @electric-sql/pglite@0.6.0 node supabase/tests/pglite-temporeal/run.mjs
// Limite: schema minimo (stubs de colunas, policies e helpers). Nao e o catalogo de producao e nao
// prova a entrega pelo servidor Realtime, so o banco. O stub de claim_shift_slot reproduz os dois
// literais que a migration troca (conferidos em producao: 1 ocorrencia cada).
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
const MIG = readFileSync(join(root, 'migrations', '20261202000100_tempo_real.sql'), 'utf8').replace(/\r\n/g, '\n');

const id = (n) => `00000000-0000-0000-0000-0000000000${String(n).padStart(2, '0')}`;
const EMP = id(1), GER = id(2), W = id(3), W2 = id(4), OUTRA = id(5), ESTRANHO = id(6);
const JOB = id(11), APP = id(12), CALL = id(13), PAY = id(14), JOB_B = id(15);

const STUB = `
CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role BYPASSRLS;
CREATE SCHEMA auth;
CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('test.uid', true), '')::uuid $$;
GRANT USAGE ON SCHEMA auth, public TO anon, authenticated, service_role;
CREATE PUBLICATION supabase_realtime;
CREATE TABLE public.workers (id uuid PRIMARY KEY, full_name text);
CREATE TABLE public.jobs (id uuid PRIMARY KEY, company_id uuid, title text, status text DEFAULT 'open', start_date timestamptz,
  work_start_time text, work_end_time text, location text, budget numeric, views int DEFAULT 0, candidates_count int DEFAULT 0);
CREATE TABLE public.applications (id uuid PRIMARY KEY, job_id uuid, worker_id uuid, status text,
  worker_checkin_at timestamptz, worker_checkout_at timestamptz, company_checkin_confirmed_at timestamptz);
CREATE TABLE public.shift_calls (id uuid PRIMARY KEY, job_id uuid, company_id uuid);
CREATE TABLE public.shift_call_targets (id serial PRIMARY KEY, call_id uuid, worker_id uuid, response text);
CREATE TABLE public.shift_payments (id uuid PRIMARY KEY, job_id uuid, worker_id uuid, company_id uuid, worker_confirmed_at timestamptz);
CREATE TABLE public.team_connections (id uuid PRIMARY KEY, company_id uuid, worker_id uuid);
CREATE TABLE public.shift_attendance_confirmations (id uuid PRIMARY KEY, job_id uuid, worker_id uuid);
CREATE TABLE public.notifications (id serial PRIMARY KEY, user_id uuid, type text, title text, message text, link text);
CREATE FUNCTION public.is_job_owner(p uuid) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER AS
  $$ SELECT EXISTS (SELECT 1 FROM public.jobs j WHERE j.id = p AND j.company_id = auth.uid()) $$;
-- dono + um gerente
CREATE FUNCTION public.notification_recipients_for_job(p uuid) RETURNS SETOF uuid LANGUAGE sql STABLE SECURITY DEFINER AS
  $$ SELECT j.company_id FROM public.jobs j WHERE j.id = p UNION SELECT '${GER}'::uuid $$;
CREATE FUNCTION public.claim_shift_slot(p_call_id uuid) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_uid uuid := (SELECT auth.uid()); v_call public.shift_calls%ROWTYPE;
BEGIN
  SELECT * INTO v_call FROM public.shift_calls WHERE id = p_call_id;
  UPDATE public.applications SET status = 'hired' WHERE job_id = v_call.job_id AND worker_id = v_uid;
  UPDATE public.shift_call_targets SET response = 'accepted' WHERE call_id = p_call_id AND worker_id = v_uid;
  INSERT INTO public.notifications (user_id, type, title, message, link)
  SELECT rcp, 'status_change', 'Vaga preenchida no turno',
      'Um freela aceitou o chamado e ocupou uma vaga do turno.',
      '/company/jobs/' || v_call.job_id::text || '/candidates'
    FROM public.notification_recipients_for_job(v_call.job_id) AS rcp;
  RETURN '{"outcome":"claimed"}'::jsonb;
END $$;
-- como no Supabase: tabelas com RLS, authenticated com grants de tabela
DO $$ DECLARE t text; BEGIN FOR t IN SELECT tablename FROM pg_tables WHERE schemaname='public' LOOP
  EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
  EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON public.%I TO authenticated', t);
END LOOP; END $$;
GRANT USAGE ON ALL SEQUENCES IN SCHEMA public TO authenticated;
CREATE POLICY a_sel ON public.applications FOR SELECT TO authenticated USING (worker_id = auth.uid() OR public.is_job_owner(job_id));
CREATE POLICY a_upd ON public.applications FOR UPDATE TO authenticated USING (worker_id = auth.uid() OR public.is_job_owner(job_id));
CREATE POLICY j_all ON public.jobs TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY c_sel ON public.shift_calls FOR SELECT TO authenticated USING (true);
CREATE POLICY t_sel ON public.shift_call_targets FOR SELECT TO authenticated USING (worker_id = auth.uid());
CREATE POLICY sp_all ON public.shift_payments TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY n_ins ON public.notifications FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY n_sel ON public.notifications FOR SELECT TO authenticated USING (user_id = auth.uid());

INSERT INTO public.workers VALUES ('${W}', 'Maria Souza'), ('${W2}', 'João Lima');
INSERT INTO public.jobs (id, company_id, title, start_date) VALUES
  ('${JOB}', '${EMP}', 'Garçom sábado', '2026-12-05 15:00+00'), ('${JOB_B}', '${OUTRA}', 'Alheio', now());
`;

const { PGlite } = await loadPglite();
const db = new PGlite();
await db.exec(STUB);

let passed = 0, failed = 0;
const check = (label, cond, extra = '') => {
  if (cond) { passed++; console.log('ok    ', label); } else { failed++; console.log('FALHOU', label, extra); }
};
const q = async (sql) => (await db.query(sql)).rows;
const as = async (uid, sql) => {
  await db.exec(`SELECT set_config('test.uid', '${uid}', false); SET ROLE authenticated;`);
  try { return (await db.query(sql)).rows; } finally { await db.exec(`RESET ROLE; SELECT set_config('test.uid', '', false);`); }
};
const reset = () => db.exec('DELETE FROM public.notifications');
const notes = () => q('SELECT user_id, type, title, message, link FROM public.notifications ORDER BY id');
const toCompany = (rows, title) => {
  const r = rows.filter((n) => n.title === title);
  return r.length === 2 && new Set(r.map((n) => n.user_id)).size === 2 && r.every((n) => [EMP, GER].includes(n.user_id));
};

await db.exec(MIG);
await db.exec(MIG);
check('migration aplica e re-aplica (idempotente)', true);

console.log('--- publicacao');
const pub = (await q("SELECT tablename FROM pg_publication_tables WHERE pubname='supabase_realtime' ORDER BY 1")).map((r) => r.tablename);
check('publica as 7 tabelas', pub.join() === 'applications,job_live_signals,shift_attendance_confirmations,shift_call_targets,shift_calls,shift_payments,team_connections', pub.join());
check('jobs, workers e notifications nao foram acrescentadas', !pub.some((t) => ['jobs', 'workers', 'notifications'].includes(t)));
const pk = await q(`SELECT c.relname, count(*)::int n, string_agg(format_type(a.atttypid, null), ',') tipos, c.relreplident::text ri
  FROM pg_index i JOIN pg_class c ON c.oid=i.indrelid JOIN pg_attribute a ON a.attrelid=c.oid AND a.attnum=ANY(i.indkey)
  WHERE i.indisprimary AND c.relname='job_live_signals' GROUP BY 1, c.relreplident`);
check('sinal: PK simples uuid e replica identity default (DELETE so leva o id)', pk[0].n === 1 && pk[0].tipos === 'uuid' && pk[0].ri === 'd');

console.log('--- sinal de turno e RLS');
await db.exec(`UPDATE public.jobs SET title = 'Garçom sábado' WHERE false; UPDATE public.jobs SET status='open'`);
await db.exec(`DELETE FROM public.job_live_signals; UPDATE public.jobs SET views = views + 1 WHERE id='${JOB}'`);
check('mudanca so de contador nao gera sinal', (await q('SELECT 1 FROM public.job_live_signals')).length === 0);
await db.exec(`UPDATE public.jobs SET title = title || ' ' WHERE id='${JOB}'; UPDATE public.jobs SET title='x' WHERE id='${JOB_B}'`);
await db.exec(`UPDATE public.jobs SET title = 'Garçom sábado' WHERE id='${JOB}'`);
const cols = (await q("SELECT string_agg(column_name, ',' ORDER BY ordinal_position) c FROM information_schema.columns WHERE table_name='job_live_signals'"))[0].c;
check('sinal sem conteudo', cols === 'job_id,company_id,changed_at', cols);
const seen = async (u) => (await as(u, 'SELECT job_id FROM public.job_live_signals')).map((r) => r.job_id);
check('empresa ve so o proprio turno', (await seen(EMP)).join() === JOB);
check('outra empresa nao ve o turno alheio', (await seen(OUTRA)).join() === JOB_B);
check('conta sem vinculo nao ve nada', (await seen(ESTRANHO)).length === 0);
check('freela sem candidatura nem chamado nao ve', (await seen(W)).length === 0);
await db.exec(`INSERT INTO public.shift_calls VALUES ('${CALL}','${JOB}','${EMP}'); INSERT INTO public.shift_call_targets (call_id, worker_id) VALUES ('${CALL}','${W}')`);
check('freela chamado passa a ver', (await seen(W)).join() === JOB);
let denied = false;
try { await as(EMP, `INSERT INTO public.job_live_signals VALUES ('${JOB}','${EMP}', now())`); } catch { denied = true; }
check('client nao escreve no sinal', denied);
denied = false;
try { await as(W, `SELECT public.internal_live_notify_company('${JOB}','system','x','y')`); } catch { denied = true; }
check('client nao executa o helper de aviso', denied);

console.log('--- aceite pelo chamado');
await db.exec(`INSERT INTO public.applications (id, job_id, worker_id, status) VALUES ('${APP}','${JOB}','${W}','invited')`);
await reset();
await as(W, `SELECT public.claim_shift_slot('${CALL}')`);
let n = await notes();
check('um aviso por destinatario, sem duplicar', n.length === 2 && toCompany(n, 'Maria Souza aceitou o turno'), JSON.stringify(n));
check('mensagem diz quem, qual turno e o dia', n[0]?.message === 'Maria Souza aceitou o turno "Garçom sábado" de 05/12.', n[0]?.message);

console.log('--- convite direto');
await db.exec(`UPDATE public.shift_call_targets SET response='closed'; UPDATE public.applications SET status='invited'`);
await reset();
await as(W, `UPDATE public.applications SET status='hired' WHERE id='${APP}'`);
await as(W, `INSERT INTO public.notifications (user_id, type, title, message, link) VALUES ('${EMP}','status_change','Freela aceitou o turno','Um freela aceitou seu convite de turno.','/company/jobs/${JOB}/candidates')`);
n = await notes();
check('aceite direto: avisa dono e gerente e descarta o aviso anonimo do client', n.length === 2 && toCompany(n, 'Maria Souza aceitou o turno'), JSON.stringify(n));
await db.exec(`UPDATE public.applications SET status='invited'`); await reset();
await as(W, `UPDATE public.applications SET status='declined' WHERE id='${APP}'`);
check('recusa direta avisa a empresa', toCompany(await notes(), 'Maria Souza não vai pegar o turno'));
await db.exec(`UPDATE public.applications SET status='invited'`); await reset();
await db.exec(`UPDATE public.applications SET status='hired' WHERE id='${APP}'`);
check('mudanca feita pelo servidor nao gera aviso de aceite', (await notes()).length === 0);

console.log('--- chegada e saida');
await reset();
await as(W, `UPDATE public.applications SET worker_checkin_at=now(), status='in_progress' WHERE id='${APP}'`);
n = await notes();
check('chegada do freela avisa uma vez', n.length === 2 && toCompany(n, 'Maria Souza registrou a chegada'), JSON.stringify(n));
await reset();
await as(W, `UPDATE public.applications SET worker_checkin_at=worker_checkin_at WHERE id='${APP}'`);
check('regravar o mesmo horario nao repete', (await notes()).length === 0);
await as(W, `UPDATE public.applications SET worker_checkout_at=now() WHERE id='${APP}'`);
check('saida do freela avisa', toCompany(await notes(), 'Maria Souza registrou a saída'));
await db.exec(`UPDATE public.applications SET worker_checkin_at=NULL`); await reset();
await as(EMP, `UPDATE public.applications SET worker_checkin_at=now() WHERE id='${APP}'`);
check('carimbo feito pela empresa nao avisa a empresa', (await notes()).length === 0);

console.log('--- recebimento e turno alterado');
await db.exec(`INSERT INTO public.shift_payments VALUES ('${PAY}','${JOB}','${W}','${EMP}',NULL)`); await reset();
await as(W, `UPDATE public.shift_payments SET worker_confirmed_at=now() WHERE id='${PAY}'`);
await as(W, `UPDATE public.shift_payments SET worker_confirmed_at=now() WHERE id='${PAY}'`);
n = await notes();
check('confirmacao de recebimento avisa uma vez, tipo payment', n.length === 2 && toCompany(n, 'Maria Souza confirmou o recebimento') && n.every((x) => x.type === 'payment'));
await db.exec(`UPDATE public.applications SET status='hired'; INSERT INTO public.applications (id, job_id, worker_id, status) VALUES ('${id(20)}','${JOB}','${W2}','declined')`); await reset();
await as(EMP, `UPDATE public.jobs SET work_start_time='19:00' WHERE id='${JOB}'`);
n = await notes();
check('mudar horario avisa so quem esta no turno', n.length === 1 && n[0].user_id === W && n[0].title === 'Turno alterado' && n[0].link === '/my-jobs', JSON.stringify(n));
await reset();
await as(EMP, `UPDATE public.jobs SET title='Outro nome', views=9 WHERE id='${JOB}'`);
await as(EMP, `UPDATE public.jobs SET status='deleted', location='X' WHERE id='${JOB}'`);
check('titulo/contador e cancelamento nao geram "Turno alterado"', (await notes()).length === 0);

console.log('--- falha de aviso nao derruba o gesto');
await db.exec(`CREATE OR REPLACE FUNCTION public.notification_recipients_for_job(p uuid) RETURNS SETOF uuid LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'boom'; END $$; UPDATE public.applications SET worker_checkin_at=NULL WHERE id='${APP}'`);
await as(W, `UPDATE public.applications SET worker_checkin_at=now() WHERE id='${APP}'`);
check('chegada gravada mesmo com aviso quebrado', (await q(`SELECT worker_checkin_at FROM public.applications WHERE id='${APP}'`))[0].worker_checkin_at !== null);

console.log(`\n${passed} ok, ${failed} falharam`);
process.exit(failed ? 1 : 0);
