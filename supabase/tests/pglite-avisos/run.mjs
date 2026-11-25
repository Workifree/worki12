// Executa as migrations de avisos (20261201000100..000300) no PGlite.
// Uso, da raiz: npx -y -p @electric-sql/pglite@0.6.0 node supabase/tests/pglite-avisos/run.mjs
// Limite: schema minimo (stub das tabelas de origem e helpers); nao e o catalogo de producao.
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
const MIGS = ['20261201000100_avisos_outbox_esquema.sql', '20261201000200_avisos_produtores.sql',
  '20261201000300_avisos_agendador.sql'].map(read);
// funcao REAL de horario de entrada
const SOS_FN = read('20261125000300_sos_usa_horario_de_entrada.sql')
  .match(/CREATE OR REPLACE FUNCTION public\.sos_shift_starts_at[\s\S]*?\$\$;/)?.[0];
if (!SOS_FN) throw new Error('sos_shift_starts_at nao encontrada');

const id = (n) => `00000000-0000-0000-0000-0000000000${String(n).padStart(2, '0')}`;
const EMP = id(1), W = id(2), W2 = id(3), GER = id(4), OUTRO = id(5);
const JOB = id(11), APP = id(12), CALL = id(13);

const STUB = `
CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role BYPASSRLS;
-- como no Supabase: objeto novo em public nasce com grant para os papeis da API
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO anon, authenticated, service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT EXECUTE ON FUNCTIONS TO anon, authenticated, service_role;
CREATE SCHEMA auth;
CREATE TABLE auth.users (id uuid PRIMARY KEY, email text);
CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('test.uid', true), '')::uuid $$;
GRANT USAGE ON SCHEMA public, auth TO anon, authenticated, service_role;

CREATE TABLE public.notifications (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid, link text,
  read_at timestamptz, created_at timestamptz DEFAULT now());
CREATE TABLE public.companies (id uuid PRIMARY KEY, name text, city text);
CREATE TABLE public.jobs (id uuid PRIMARY KEY, company_id uuid, status text DEFAULT 'open', start_date timestamptz, work_start_time text);
CREATE TABLE public.applications (id uuid PRIMARY KEY, job_id uuid, worker_id uuid, status text);
CREATE TABLE public.shift_calls (id uuid PRIMARY KEY, job_id uuid, status text DEFAULT 'open', expires_at timestamptz);
CREATE TABLE public.shift_call_targets (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), call_id uuid, worker_id uuid,
  notified_at timestamptz DEFAULT now(), responded_at timestamptz, response text, origin text DEFAULT 'team');
CREATE TABLE public.shift_attendance_confirmations (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), job_id uuid,
  worker_id uuid, response text);
CREATE TABLE public.shift_payments (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), job_id uuid, worker_id uuid, status text, amount numeric);

CREATE FUNCTION public.job_is_active(p uuid) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER AS
  $$ SELECT EXISTS (SELECT 1 FROM public.jobs WHERE id = p AND status <> 'deleted') $$;
CREATE FUNCTION public.is_job_owner(p uuid) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER AS
  $$ SELECT auth.uid() IN ('${EMP}'::uuid, '${GER}'::uuid) $$;
CREATE FUNCTION public.notification_recipients_for_job(p uuid) RETURNS SETOF uuid LANGUAGE sql STABLE SECURITY DEFINER AS
  $$ VALUES ('${EMP}'::uuid), ('${GER}'::uuid) $$;
CREATE FUNCTION public.anonymize_account(p_user_id uuid) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
    IF p_user_id IS NULL THEN RETURN jsonb_build_object('outcome', 'invalid_input'); END IF;
    RETURN jsonb_build_object(
        'outcome',       'anonymized',
        'user_id',       p_user_id);
END; $$;

INSERT INTO auth.users VALUES ('${EMP}','emp@x.test'), ('${W}','w@x.test'), ('${W2}','w2@x.test'), ('${GER}','g@x.test'), ('${OUTRO}', NULL);
INSERT INTO public.companies VALUES ('${EMP}', 'Doces Ltda', 'Belo Horizonte');
INSERT INTO public.jobs VALUES ('${JOB}', '${EMP}', 'open', now() + interval '3 days', '08:00');
INSERT INTO public.applications VALUES ('${APP}', '${JOB}', '${W}', 'hired');
INSERT INTO public.shift_calls VALUES ('${CALL}', '${JOB}', 'open', now() + interval '2 days');
`;

const { PGlite } = await loadPglite();
let passed = 0, failed = 0;
const check = (label, cond, extra = '') => {
  if (cond) { passed++; console.log('ok    ', label); } else { failed++; console.log('FALHOU', label, extra); }
};

const db = new PGlite();
await db.exec(STUB);
await db.exec(SOS_FN);
for (const m of MIGS) await db.exec(m);
for (const m of MIGS) await db.exec(m);
check('migrations aplicam e reaplicam (sem pg_cron/pg_net)', true);

const q = async (sql) => (await db.query(sql)).rows;
const one = async (sql) => (await q(sql))[0];

/** Roda como cliente em transacao desfeita. */
async function as(uid, sql, role = 'authenticated') {
  await db.exec('BEGIN');
  try {
    await db.exec(`SELECT set_config('test.uid', '${uid}', true); SET LOCAL ROLE ${role}`);
    const res = await db.query(sql);
    return { ok: true, rows: res.rows, n: res.affectedRows ?? 0 };
  } catch (e) {
    return { ok: false, error: `${e.code} ${e.message}` };
  } finally {
    await db.exec('ROLLBACK');
  }
}
/** Igual, mas confirmando (RPC do cliente). */
async function commitAs(uid, sql) {
  await db.exec('BEGIN');
  await db.exec(`SELECT set_config('test.uid', '${uid}', true); SET LOCAL ROLE authenticated`);
  const res = await db.query(sql);
  await db.exec('COMMIT');
  return res.rows;
}

const NO_QUIET = `quiet_start = '00:00', quiet_end = '00:00'`;
const PUSH_URL = (n) => `https://fcm.googleapis.com/fcm/send/${n}`;
async function reset() {
  await db.exec(`
    DELETE FROM public.notice_outbox; DELETE FROM public.shift_call_targets; DELETE FROM public.shift_attendance_confirmations;
    DELETE FROM public.shift_payments; DELETE FROM public.notifications; DELETE FROM public.push_subscriptions;
    DELETE FROM public.notice_preferences;
    UPDATE public.jobs SET status='open', start_date = now() + interval '3 days', work_start_time='08:00';
    UPDATE public.shift_calls SET status='open', expires_at = now() + interval '2 days';
    UPDATE public.applications SET status='hired';
    UPDATE public.notice_channel_settings SET enabled = (channel <> 'whatsapp'), whatsapp_delay_min = 10,
      daily_cap = CASE channel WHEN 'push' THEN 6 WHEN 'email' THEN 3 ELSE 2 END;
    INSERT INTO public.notice_preferences (user_id, quiet_start, quiet_end)
      SELECT id, '00:00', '00:00' FROM auth.users;
    INSERT INTO public.push_subscriptions (user_id, endpoint, p256dh, auth) VALUES ('${W}', '${PUSH_URL('w')}', 'k', 'a');
  `);
}
const target = async (worker = W, origin = 'team') =>
  (await one(`INSERT INTO public.shift_call_targets (call_id, worker_id, origin) VALUES ('${CALL}','${worker}','${origin}') RETURNING id`)).id;
const claim = (channels = 'NULL') => q(`SELECT * FROM public.claim_notice_batch(50, ${channels})`);
const statuses = async () => Object.fromEntries((await q(
  `SELECT d.channel, d.status FROM public.notice_deliveries d ORDER BY d.channel`)).map((r) => [r.channel, r.status]));
const count = async (t, w = 'true') => Number((await one(`SELECT count(*) n FROM public.${t} WHERE ${w}`)).n);

console.log('--- produtores e idempotencia');
await reset();
const t1 = await target();
let o = await one(`SELECT * FROM public.notice_outbox`);
check('chamado de turno enfileira com conteudo minimo', o?.event_kind === 'shift_call_target' && o.urgency === 'normal'
  && o.recipient_id === W && Object.keys(o.payload).sort().join() === 'city,company_name,path,starts_at', JSON.stringify(o));
check('normal cria so push e email', (await count('notice_deliveries')) === 2);
await q(`SELECT public.internal_enqueue_notice('shift_call_target','${t1}','${W}','{"path":"/my-jobs"}', now()+interval '1 day','normal')`);
check('enfileirar 2x o mesmo evento = 1 linha', (await count('notice_outbox')) === 1 && (await count('notice_deliveries')) === 2);

await reset();
await db.exec('BEGIN'); await target(); await db.exec('ROLLBACK');
check('rollback do evento nao deixa aviso', (await count('notice_outbox')) === 0);

await reset();
for (const [nome, payload] of [['chave fora da lista', '{"path":"/x","cpf":"1"}'], ['path externo', '{"path":"//mal.example"}'],
  ['sem path', '{"city":"x"}'], ['valor nao textual', '{"path":"/x","city":{"a":1}}']]) {
  let erro = '';
  try { await q(`SELECT public.internal_enqueue_notice('payment_recorded', gen_random_uuid(), '${W}', '${payload}', now()+interval '1 day','low')`); }
  catch (e) { erro = e.code; }
  check(`payload rejeitado: ${nome}`, erro === '23514', erro);
}

await reset();
await db.exec(`ALTER TABLE public.notice_outbox ADD CONSTRAINT quebra CHECK (false) NOT VALID`);
let ok = true; try { await target(); } catch { ok = false; }
await db.exec(`ALTER TABLE public.notice_outbox DROP CONSTRAINT quebra`);
check('falha ao enfileirar NAO derruba o evento', ok && (await count('shift_call_targets')) === 1);

await reset();
await target(W, 'sos');
o = await one(`SELECT * FROM public.notice_outbox`);
check('SOS e urgente e cria o canal WhatsApp com atraso', o.event_kind === 'sos_call_target' && o.urgency === 'urgent'
  && (await count('notice_deliveries', `channel='whatsapp' AND next_attempt_at > now() + interval '9 minutes'`)) === 1);
await reset();
await db.exec(`UPDATE public.jobs SET start_date = now(), work_start_time = NULL; UPDATE public.jobs SET
  start_date = now() + interval '3 hours', work_start_time = to_char((now() + interval '3 hours') AT TIME ZONE 'America/Sao_Paulo','HH24:MI')`);
await target();
check('turno em ate 6h e urgente', (await one(`SELECT urgency FROM public.notice_outbox`))?.urgency === 'urgent');

await reset();
await db.exec(`INSERT INTO public.shift_attendance_confirmations(job_id, worker_id) VALUES ('${JOB}','${W}')`);
check('pedido de vespera enfileira', (await count('notice_outbox', `event_kind='attendance_request'`)) === 1);

await reset();
await db.exec(`BEGIN; SELECT set_config('test.uid','${W}',true); UPDATE public.applications SET status='cancelled'; COMMIT`);
let rcp = (await q(`SELECT recipient_id FROM public.notice_outbox ORDER BY 1`)).map((r) => r.recipient_id);
check('freela cancela: avisa a empresa (dono + gerente)', rcp.join() === [EMP, GER].join(), rcp.join());
await reset();
await db.exec(`BEGIN; SELECT set_config('test.uid','${GER}',true); UPDATE public.applications SET status='cancelled'; COMMIT`);
rcp = await q(`SELECT recipient_id, payload->>'path' p FROM public.notice_outbox`);
check('empresa cancela: avisa so o freela', rcp.length === 1 && rcp[0].recipient_id === W && rcp[0].p === '/my-jobs');
await reset();
await db.exec(`UPDATE public.applications SET status='cancelled'`);
check('ator desconhecido: avisa os dois lados', (await count('notice_outbox')) === 3);

await reset();
await db.exec(`INSERT INTO public.shift_payments(job_id, worker_id, status, amount) VALUES ('${JOB}','${W}','scheduled', 150)`);
check('pagamento agendado nao avisa', (await count('notice_outbox')) === 0);
await db.exec(`UPDATE public.shift_payments SET status='recorded'; UPDATE public.shift_payments SET status='recorded'`);
o = await one(`SELECT * FROM public.notice_outbox`);
check('pagamento registrado avisa uma vez, sem valor', (await count('notice_outbox')) === 1 && o.urgency === 'low'
  && !JSON.stringify(o.payload).includes('150'));

console.log('--- convite vencido nao envia');
await reset();
await db.exec(`UPDATE public.shift_calls SET expires_at = now() - interval '1 minute'`);
await target();
check('chamado ja vencido nem entra na fila', (await count('notice_outbox')) === 0);
for (const [nome, sql] of [
  ['expirou na fila', `UPDATE public.notice_outbox SET expires_at = now() - interval '1 second'`],
  ['chamado preenchido', `UPDATE public.shift_calls SET status='filled'`],
  ['chamado cancelado', `UPDATE public.shift_calls SET status='cancelled'`],
  ['prazo do chamado encerrado', `UPDATE public.shift_calls SET expires_at = now() - interval '1 second'`],
  ['alvo ja respondeu', `UPDATE public.shift_call_targets SET response='declined', responded_at=now()`],
  ['turno excluido', `UPDATE public.jobs SET status='deleted'`],
]) {
  await reset(); await target(); await db.exec(sql);
  const r = await claim();
  const s = await statuses();
  check(`nao envia: ${nome}`, r.length === 0 && s.push === 'skipped_expired' && s.email === 'skipped_expired', JSON.stringify(s));
}

console.log('--- preferencias, canal e contato');
await reset(); await target();
let r = await claim();
check('envia push e e-mail com os contatos', r.length === 2 && r.find((x) => x.channel === 'email').email === 'w@x.test'
  && r.find((x) => x.channel === 'push').subscriptions.length === 1);
check('segundo claim nao devolve de novo', (await claim()).length === 0);
await reset(); await db.exec(`UPDATE public.notice_preferences SET email=false WHERE user_id='${W}'`); await target(); await claim();
check('preferencia desligada = skipped_pref', (await statuses()).email === 'skipped_pref' && (await statuses()).push === 'sending');
await reset(); await target(); await claim(`ARRAY['email']`);
check('canal sem segredo na funcao = skipped_channel_off', (await statuses()).push === 'skipped_channel_off' && (await statuses()).email === 'sending');
await reset(); await db.exec(`DELETE FROM public.push_subscriptions`); await target(); await claim();
check('sem inscricao de push = skipped_no_contact', (await statuses()).push === 'skipped_no_contact');

console.log('--- silencio com urgencia');
const QUIET_NOW = `UPDATE public.notice_preferences SET tz='UTC', quiet_start=((now() - interval '1 hour') AT TIME ZONE 'UTC')::time,
  quiet_end=((now() + interval '1 hour') AT TIME ZONE 'UTC')::time`;
await reset(); await db.exec(QUIET_NOW); await target(); r = await claim();
check('normal em silencio e reagendado para o fim', r.length === 0 && (await count('notice_deliveries',
  `status='pending' AND next_attempt_at BETWEEN now() + interval '55 minutes' AND now() + interval '65 minutes'`)) === 2);
await reset(); await db.exec(QUIET_NOW); await target(W, 'sos'); r = await claim();
check('urgente atravessa o silencio', r.length === 2);
await reset(); await db.exec(QUIET_NOW); await db.exec(`UPDATE public.shift_calls SET expires_at = now() + interval '20 minutes'`);
await target(); await claim();
check('venceria dentro do silencio = skipped_quiet', (await statuses()).push === 'skipped_quiet');
const quiet = await one(`SELECT
  public.internal_notice_quiet_until('2026-12-01 23:30-03','22:00','07:00','America/Sao_Paulo') = '2026-12-02 07:00-03'::timestamptz a,
  public.internal_notice_quiet_until('2026-12-02 06:59-03','22:00','07:00','America/Sao_Paulo') = '2026-12-02 07:00-03'::timestamptz b,
  public.internal_notice_quiet_until('2026-12-02 07:00-03','22:00','07:00','America/Sao_Paulo') IS NULL c`);
check('janela que cruza a meia-noite', quiet.a && quiet.b && quiet.c, JSON.stringify(quiet));

console.log('--- teto em 24h');
const pay = () => db.exec(`INSERT INTO public.shift_payments(job_id, worker_id, status) VALUES ('${JOB}','${W}','recorded')`);
await reset(); for (let i = 0; i < 8; i++) await pay(); await claim();
check('teto: 6 push e 3 e-mails', (await count('notice_deliveries', `channel='push' AND status='sending'`)) === 6
  && (await count('notice_deliveries', `channel='email' AND status='sending'`)) === 3
  && (await count('notice_deliveries', `status='skipped_cap'`)) === 7);
await target(W, 'sos'); r = await claim();
check('urgente conta mas nao e barrado em push/e-mail', r.length === 2, JSON.stringify(r.map((x) => x.channel)));

console.log('--- WhatsApp (F3)');
const waOn = async () => {
  await db.exec(`UPDATE public.notice_channel_settings SET enabled = true, whatsapp_delay_min = 0`);
};
const optIn = () => commitAs(W, `SELECT public.set_notice_preference('whatsapp', true, '+5531999990000', 'wa-optin-v1') r`);
await reset(); await db.exec(`UPDATE public.notice_channel_settings SET whatsapp_delay_min = 0`); await optIn(); await target(W, 'sos'); await claim();
check('nasce desligado', (await statuses()).whatsapp === 'skipped_channel_off');
await reset(); await waOn(); await optIn(); await target(); await claim();
check('so urgente tem WhatsApp', (await count('notice_deliveries', `channel='whatsapp'`)) === 0);
await reset(); await waOn(); await optIn(); await target(W, 'sos'); r = await claim();
check('com opt-in vigente envia para o telefone do consentimento', r.find((x) => x.channel === 'whatsapp')?.phone === '+5531999990000');
await reset(); await waOn(); await db.exec(`UPDATE public.notice_preferences SET whatsapp = true`);
await target(W2, 'sos'); await claim();
check('preferencia sem consentimento nao basta', (await statuses()).whatsapp === 'skipped_pref');
await reset(); await waOn(); await optIn();
await q(`SELECT public.record_notice_whatsapp_stop('+5531999990000')`);
await db.exec(`UPDATE public.notice_preferences SET whatsapp = true`); await target(W, 'sos'); await claim();
check('PARAR revoga mesmo se a preferencia for religada por fora', (await statuses()).whatsapp === 'skipped_pref');
await reset(); await waOn(); await optIn();
await db.exec(`BEGIN; INSERT INTO public.notifications(user_id, link) VALUES ('${W}','/my-jobs');
  INSERT INTO public.shift_call_targets(call_id, worker_id, origin) VALUES ('${CALL}','${W}','sos'); COMMIT;
  UPDATE public.notifications SET read_at = now()`);
await claim();
check('sino lido = superseded', (await statuses()).whatsapp === 'superseded');
await reset(); await waOn(); await optIn(); await target(W, 'sos');
await db.exec(`UPDATE public.shift_call_targets SET response='accepted', responded_at=now()`); await claim();
check('respondeu = superseded', (await statuses()).whatsapp === 'superseded');

console.log('--- resultado, backoff e webhooks');
await reset(); await target(); await claim(`ARRAY['email']`);
const del = (await one(`SELECT id FROM public.notice_deliveries WHERE channel='email'`)).id;
const waits = [];
let last;
for (let i = 0; i < 5; i++) {
  last = (await one(`SELECT public.report_notice_result('${del}','failed',NULL,'resend 500') r`)).r;
  if (last === 'pending') {
    waits.push(Math.round(Number((await one(`SELECT extract(epoch FROM next_attempt_at - now())/60 m FROM public.notice_deliveries WHERE id='${del}'`)).m)));
    await db.exec(`UPDATE public.notice_deliveries SET next_attempt_at = now() WHERE id='${del}'`);
    await claim(`ARRAY['email']`);
  }
}
check('backoff 1, 5, 30, 120 e depois failed', waits.join() === '1,5,30,120' && last === 'failed', `${waits.join()} ${last}`);
await reset(); await target(); await claim();
await db.exec(`UPDATE public.notice_deliveries SET claimed_at = now() - interval '11 minutes'`);
check('envio travado volta para a fila', (await claim()).length === 2);
const mail = (await one(`SELECT id FROM public.notice_deliveries WHERE channel='email'`)).id;
await q(`SELECT public.report_notice_result('${mail}','sent','re_1',NULL)`);
await q(`SELECT public.record_notice_event('email','re_1','opened')`);
await q(`SELECT public.record_notice_event('email','re_1','delivered')`);
check('estado so avanca (opened nao volta a delivered)', (await statuses()).email === 'opened');
await q(`SELECT public.record_notice_event('email','re_1','complaint')`);
await q(`SELECT public.record_notice_event('email','re_1','complaint')`);
check('reclamacao desliga o e-mail e registra um opt-out', (await one(`SELECT email FROM public.notice_preferences WHERE user_id='${W}'`)).email === false
  && (await count('notice_consents', `user_id='${W}' AND channel='email' AND action='opt_out' AND source='email_link'`)) === 1);
const f = await one(`SELECT sum(enqueued)::int e, sum(sent)::int s FROM public.notice_funnel_daily`);
check('view de metricas responde', f.e === 2 && f.s === 1, JSON.stringify(f));

console.log('--- cliente sem acesso a fila');
await reset(); await target(); await optIn();
for (const role of ['authenticated', 'anon']) {
  for (const t of ['notice_outbox', 'notice_deliveries', 'notice_channel_settings', 'notice_funnel_archive', 'notice_funnel_daily']) {
    const x = await as(W, `SELECT * FROM public.${t}`, role);
    check(`${role} nao le ${t}`, !x.ok && x.error.startsWith('42501'), x.error ?? 'leu');
  }
}
for (const [nome, sql] of [
  ['inserir na fila', `INSERT INTO public.notice_outbox(event_kind,event_id,recipient_id,payload,urgency,expires_at) VALUES ('payment_recorded',gen_random_uuid(),'${W}','{"path":"/x"}','low',now())`],
  ['alterar entrega', `UPDATE public.notice_deliveries SET status='pending'`],
  ['forjar consentimento', `INSERT INTO public.notice_consents(user_id,channel,action,source) VALUES ('${W}','whatsapp','opt_in','app')`],
  ['apagar consentimento', `DELETE FROM public.notice_consents`],
  ['ligar canal', `UPDATE public.notice_channel_settings SET enabled=true`],
  ['enfileirar', `SELECT public.internal_enqueue_notice('payment_recorded',gen_random_uuid(),'${W2}','{"path":"/x"}',now()+interval '1 day','low')`],
  ['reivindicar lote', `SELECT * FROM public.claim_notice_batch(50, NULL)`],
  ['gravar resultado', `SELECT public.report_notice_result(gen_random_uuid(),'sent')`],
  ['descadastrar outra pessoa', `SELECT public.notice_unsubscribe('${W2}','email')`],
  ['disparar o agendador', `SELECT public.internal_trigger_notice_dispatch()`],
  ['limpar avisos de outro', `SELECT public.internal_anonymize_notices('${W2}')`],
  ['gravar preferencia de outro', `INSERT INTO public.notice_preferences(user_id) VALUES ('${W2}') ON CONFLICT (user_id) DO UPDATE SET email=false`],
  ['inscrever endpoint arbitrario (SSRF)', `INSERT INTO public.push_subscriptions(user_id,endpoint,p256dh,auth) VALUES ('${W}','https://interno.example/x','k','a')`],
]) {
  const x = await as(W, sql);
  check(`cliente nao consegue ${nome}`, !x.ok && /^(42501|23514)/.test(x.error), x.error ?? 'passou');
}
let x = await as(W2, `SELECT * FROM public.notice_consents`);
check('consentimento: so o dono le', x.ok && x.rows.length === 0);
x = await as(W2, `SELECT * FROM public.push_subscriptions`);
check('inscricao de push: so o dono le', x.ok && x.rows.length === 0);
let erro = ''; try { await q(`UPDATE public.notice_consents SET action='opt_out'`); } catch (e) { erro = e.code; }
check('consentimento e append-only ate para o servidor', erro === '42501', erro);
x = await as(W2, `SELECT public.register_push_subscription('${PUSH_URL('w')}','roubada','x') r`);
check('endpoint de outra pessoa nao e tomado sem as chaves', x.rows?.[0].r.outcome === 'conflict');
x = await as(W2, `SELECT public.register_push_subscription('${PUSH_URL('w')}','k','a') r`);
check('troca de conta no mesmo navegador transfere', x.rows?.[0].r.outcome === 'ok');
x = await as(W2, `SELECT public.register_push_subscription('https://interno.example/x','k','a') r`);
check('RPC recusa endpoint fora dos servicos de push', x.rows?.[0].r.outcome === 'invalid_input');
x = await as(W, `SELECT public.set_notice_preference('whatsapp', true) r`);
check('opt-in de WhatsApp exige telefone e texto', x.rows?.[0].r.outcome === 'phone_and_consent_required');
x = await as(W, `UPDATE public.notice_preferences SET tz='Lua/Base'`);
check('fuso invalido e recusado', !x.ok && x.error.startsWith('22023'), x.error);
await claim(); const pushDel = (await one(`SELECT id FROM public.notice_deliveries WHERE channel='push'`)).id;
await q(`SELECT public.report_notice_result('${pushDel}','sent')`);
const ev = (await one(`SELECT event_id FROM public.notice_outbox`)).event_id;
x = await as(W2, `SELECT public.mark_notice_opened('${ev}') r`);
check('outra pessoa nao marca como aberto', x.rows?.[0].r === false);
x = await as(W, `SELECT public.mark_notice_opened('${ev}') r`);
check('o destinatario marca como aberto', x.rows?.[0].r === true);

console.log('--- agendador, LGPD e travas');
await reset();
check('fila vazia nao chama HTTP', (await one(`SELECT public.internal_trigger_notice_dispatch() r`)).r === 'idle');
await target();
check('sem pg_net avisa', (await one(`SELECT public.internal_trigger_notice_dispatch() r`)).r === 'no_pg_net');
await db.exec(`CREATE SCHEMA net; CREATE TABLE net.calls(url text, headers jsonb);
  CREATE FUNCTION net.http_post(url text, body jsonb, headers jsonb, timeout_milliseconds int) RETURNS void LANGUAGE sql AS
    'INSERT INTO net.calls VALUES ($1, $3)';
  CREATE SCHEMA vault; CREATE TABLE vault.decrypted_secrets(name text, decrypted_secret text)`);
check('sem segredo no Vault nao chama', (await one(`SELECT public.internal_trigger_notice_dispatch() r`)).r === 'no_secret');
await db.exec(`INSERT INTO vault.decrypted_secrets VALUES ('notice_dispatch_secret','s3'), ('notice_dispatch_url','https://x.supabase.co/functions/v1/notice-dispatch')`);
check('com segredo chama com o header', (await one(`SELECT public.internal_trigger_notice_dispatch() r`)).r === 'requested'
  && (await one(`SELECT headers->>'x-dispatch-secret' s FROM net.calls`)).s === 's3');
await db.exec(`UPDATE public.notice_outbox SET created_at = now() - interval '100 days'`);
await q(`SELECT public.internal_purge_notices()`);
check('expurgo de 90 dias preserva o agregado', (await count('notice_outbox')) === 0 && (await count('notice_funnel_archive')) === 2);
await reset(); await optIn(); await target();
const anon = (await one(`SELECT public.anonymize_account('${W}') r`)).r;
check('anonymize_account limpa as tabelas novas', anon.outcome === 'anonymized'
  && (await count('push_subscriptions', `user_id='${W}'`)) + (await count('notice_outbox', `recipient_id='${W}'`))
     + (await count('notice_preferences', `user_id='${W}'`)) + (await count('notice_consents', `user_id='${W}' AND phone_e164 IS NOT NULL`)) === 0
  && (await count('notice_consents', `user_id='${W}'`)) > 0);
const writers = await q(`SELECT p.proname FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public'
  AND p.prosrc ~* '\\m(insert\\s+into|update)\\s+(public\\.)?(workers|companies|team_connections|notifications|shift_payments)\\M'`);
check('nenhuma funcao nova escreve em tabela travada por 20261126000700', writers.length === 0, JSON.stringify(writers));

console.log(`\n${passed} ok, ${failed} falhas`);
process.exit(failed ? 1 : 0);
