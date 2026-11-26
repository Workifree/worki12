// Executa 20261126000800 no PGlite: cada falha reproduz ANTES, some DEPOIS, e os fluxos legitimos seguem.
// Uso, da raiz: npx -y -p @electric-sql/pglite@0.6.0 node supabase/tests/pglite-nivel/run.mjs
// Limite: schema minimo (stub das colunas, policies e helpers), nao e o catalogo de producao.
// Os guards "antes" saem do proprio arquivo 20261126000700.
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
const MIG = read('20261126000800_nivel_chat_gerente_e_elenco.sql');
const PREV = read('20261126000700_travas_de_integridade.sql');
const prevFn = (name) => PREV.match(new RegExp(`CREATE OR REPLACE FUNCTION public\\.${name}\\(\\)[\\s\\S]*?\\n\\$\\$;`))[0];

const id = (n) => `00000000-0000-0000-0000-0000000000${String(n).padStart(2, '0')}`;
const EMP = id(1), W = id(3), W2 = id(4), GER = id(5), ENC = id(6), TERC = id(7), ORG = id(8);
const JOB = id(11), APP = id(13), TC = id(15), W475 = id(21), WOK = id(22);

const STUB = `
CREATE ROLE authenticated; CREATE ROLE service_role BYPASSRLS;
CREATE SCHEMA auth;
CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('test.uid', true), '')::uuid $$;
CREATE TABLE public.workers (id uuid PRIMARY KEY, full_name text, avatar_url text, primary_role text, roles jsonb,
  xp int DEFAULT 0, level int DEFAULT 1, completed_jobs_count int DEFAULT 0, earnings_total numeric DEFAULT 0);
CREATE TABLE public.companies (id uuid PRIMARY KEY, name text);
CREATE TABLE public.jobs (id uuid PRIMARY KEY, company_id uuid, budget numeric);
CREATE TABLE public.applications (id uuid PRIMARY KEY, job_id uuid, worker_id uuid, status text, invitation_response text,
  worker_checkin_at timestamptz, worker_checkout_at timestamptz, company_checkin_confirmed_at timestamptz, company_checkout_confirmed_at timestamptz);
CREATE TABLE public.team_connections (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), company_id uuid, worker_id uuid, status text, source text,
  blocked_by uuid, created_at timestamptz DEFAULT now(), accepted_at timestamptz, updated_at timestamptz DEFAULT now(), invited_by uuid);
CREATE TABLE public.shift_payments (id serial PRIMARY KEY, job_id uuid, company_id uuid, worker_id uuid, application_id uuid, amount numeric);
CREATE TABLE public.notifications (id serial PRIMARY KEY, user_id uuid, type text, title text, message text, link text, read_at timestamptz, created_at timestamptz);
CREATE TABLE public."Conversation" (id text PRIMARY KEY, application_uuid uuid);
CREATE TABLE public."Message" (id text PRIMARY KEY DEFAULT gen_random_uuid()::text, content text, conversationid text, senderid text, read_at timestamptz);

CREATE FUNCTION public.worker_level_for_xp(p_xp integer) RETURNS integer LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE WHEN p_xp>=4500 THEN 10 WHEN p_xp>=3600 THEN 9 WHEN p_xp>=2800 THEN 8 WHEN p_xp>=2100 THEN 7 WHEN p_xp>=1500 THEN 6
    WHEN p_xp>=1000 THEN 5 WHEN p_xp>=600 THEN 4 WHEN p_xp>=300 THEN 3 WHEN p_xp>=100 THEN 2 ELSE 1 END $$;
CREATE FUNCTION public.recompute_worker_aggregates(p uuid) RETURNS void LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE v_xp int; BEGIN
  SELECT (SELECT count(*) FROM public.applications WHERE worker_id=p AND status='completed')*100
    + CASE WHEN coalesce(avatar_url,'')<>'' THEN 50 ELSE 0 END + CASE WHEN coalesce(primary_role,'')<>'' THEN 75 ELSE 0 END
    INTO v_xp FROM public.workers WHERE id=p;
  UPDATE public.workers SET xp=v_xp, level=public.worker_level_for_xp(v_xp) WHERE id=p;
END $$;
CREATE FUNCTION public.calculate_level_from_xp() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN NEW.level := FLOOR(NEW.xp/100)+1; RETURN NEW; END $$;
CREATE TRIGGER trigger_update_level BEFORE UPDATE OF xp ON public.workers FOR EACH ROW WHEN (OLD.xp IS DISTINCT FROM NEW.xp) EXECUTE FUNCTION public.calculate_level_from_xp();
CREATE FUNCTION public.award_xp_on_photo_upload() RETURNS trigger LANGUAGE plpgsql AS
  $$ BEGIN IF OLD.avatar_url IS NULL AND NEW.avatar_url IS NOT NULL THEN NEW.xp := COALESCE(NEW.xp,0)+50; END IF; RETURN NEW; END $$;
CREATE TRIGGER trigger_award_xp_on_photo BEFORE UPDATE OF avatar_url ON public.workers FOR EACH ROW EXECUTE FUNCTION public.award_xp_on_photo_upload();

-- GER = gerente (nao dono); ORG = operador da organizacao; ENC = encarregado (opera o turno, NAO e Gestor)
CREATE FUNCTION public.is_company_owner(c uuid) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER AS
  $$ SELECT c = auth.uid() OR (c = '${EMP}' AND auth.uid() IN ('${GER}','${ORG}')) $$;
CREATE FUNCTION public.is_company_member_confirmed(c uuid) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER AS
  $$ SELECT public.is_company_owner(c) OR (c = '${EMP}' AND auth.uid() = '${ENC}') $$;
CREATE FUNCTION public.can_access_application(a text) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER AS
  $$ SELECT EXISTS (SELECT 1 FROM public.applications x JOIN public.jobs j ON j.id = x.job_id
       WHERE x.id::text = a AND (x.worker_id = auth.uid() OR public.is_company_owner(j.company_id))) $$;
CREATE FUNCTION public.can_access_conversation(p text) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER AS
  $$ SELECT EXISTS (SELECT 1 FROM public."Conversation" c WHERE c.id = p AND public.can_access_application(c.application_uuid::text)) $$;

CREATE FUNCTION public.notify_new_message() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER AS $$ BEGIN RETURN NEW; END $$;
CREATE TRIGGER trg_notify_new_message AFTER INSERT ON public."Message" FOR EACH ROW EXECUTE FUNCTION public.notify_new_message();

${prevFn('team_connections_update_guard')}
CREATE TRIGGER trg_zz_team_connections_guard BEFORE UPDATE ON public.team_connections FOR EACH ROW EXECUTE FUNCTION public.team_connections_update_guard();
${prevFn('shift_payments_insert_guard')}
CREATE TRIGGER trg_zz_shift_payments_insert_guard BEFORE INSERT ON public.shift_payments FOR EACH ROW EXECUTE FUNCTION public.shift_payments_insert_guard();

-- escrita legitima do servidor (RPC DEFINER): link do Elenco e anonimizacao
CREATE FUNCTION public.srv_link(c uuid, w uuid) RETURNS void LANGUAGE sql SECURITY DEFINER AS
  $$ INSERT INTO public.team_connections(company_id, worker_id, status, source, accepted_at) VALUES (c, w, 'accepted', 'link', now()) $$;

GRANT USAGE ON SCHEMA public, auth TO authenticated, service_role;
GRANT ALL ON ALL TABLES IN SCHEMA public TO authenticated, service_role;
GRANT ALL ON ALL SEQUENCES IN SCHEMA public TO authenticated, service_role;

ALTER TABLE public."Message" ENABLE ROW LEVEL SECURITY;
${['Participants can view messages', 'Users can view messages in their conversations'].map((n) => `
CREATE POLICY "${n}" ON public."Message" FOR SELECT USING (EXISTS (SELECT 1 FROM public."Conversation" c JOIN public.applications a ON a.id = c.application_uuid
  WHERE c.id = "Message".conversationid AND (a.worker_id = auth.uid() OR a.job_id IN (SELECT j.id FROM public.jobs j WHERE j.company_id = auth.uid()))));`).join('')}
${['Participants can insert messages', 'Users can insert messages in their conversations'].map((n) => `
CREATE POLICY "${n}" ON public."Message" FOR INSERT WITH CHECK (senderid = auth.uid()::text AND EXISTS (SELECT 1 FROM public."Conversation" c JOIN public.applications a ON a.id = c.application_uuid
  WHERE c.id = "Message".conversationid AND (a.worker_id = auth.uid() OR a.job_id IN (SELECT j.id FROM public.jobs j WHERE j.company_id = auth.uid()))));`).join('')}

ALTER TABLE public.team_connections ENABLE ROW LEVEL SECURITY;
CREATE POLICY s ON public.team_connections FOR SELECT USING (worker_id = auth.uid() OR public.is_company_member_confirmed(company_id));
CREATE POLICY tc_insert_company ON public.team_connections FOR INSERT WITH CHECK (status = 'pending' AND public.is_company_member_confirmed(company_id));
CREATE POLICY tc_update_worker ON public.team_connections FOR UPDATE USING (worker_id = auth.uid())
  WITH CHECK (worker_id = auth.uid() AND status IN ('accepted','blocked'));
CREATE POLICY tc_update_company ON public.team_connections FOR UPDATE USING (public.is_company_owner(company_id) AND status <> 'blocked')
  WITH CHECK (public.is_company_owner(company_id) AND status IN ('pending','blocked'));

INSERT INTO public.companies VALUES ('${EMP}', 'Empresa A');
INSERT INTO public.workers(id, full_name) VALUES ('${W}', 'Freela'), ('${W2}', 'Outro');
INSERT INTO public.workers(id, primary_role, xp, level) VALUES ('${W475}', 'r', 475, 5), ('${WOK}', 'r', 625, 4);
INSERT INTO public.jobs VALUES ('${JOB}', '${EMP}', 10);
INSERT INTO public.applications(id, job_id, worker_id, status) VALUES ('${APP}', '${JOB}', '${W}', 'hired');
INSERT INTO public.team_connections(id, company_id, worker_id, status, source) VALUES ('${TC}', '${EMP}', '${W}', 'accepted', 'link');
INSERT INTO public."Conversation" VALUES ('conv', '${APP}');
INSERT INTO public."Message"(content, conversationid, senderid) VALUES ('oi', 'conv', '${W}');
`;

const { PGlite } = await loadPglite();
let passed = 0, failed = 0;
const check = (label, cond, extra = '') => {
  if (cond) { passed++; console.log('ok    ', label); } else { failed++; console.log('FALHOU', label, extra); }
};

// Roda `sql` como cliente `uid`, em transacao desfeita. `setup` roda antes e `after` depois, como dono.
async function as(db, uid, sql, setup = '', after = null, role = 'authenticated') {
  await db.exec('BEGIN');
  try {
    if (setup) await db.exec(setup);
    await db.exec(`SELECT set_config('test.uid', '${uid}', true); SET LOCAL ROLE ${role}`);
    const res = await db.query(sql);
    let extra = null;
    if (after) { await db.exec('RESET ROLE'); extra = (await db.query(after)).rows[0]; }
    return { ok: (res.affectedRows ?? 0) > 0 || res.rows.length > 0, rows: res.rows, extra };
  } catch (e) {
    return { ok: false, error: `${e.code} ${e.message}` };
  } finally {
    await db.exec('ROLLBACK');
  }
}
const barred = (r) => !r.ok && (!r.error || r.error.startsWith('42501'));

const readMsg = `SELECT 1 FROM public."Message" WHERE conversationid='conv'`;
const send = (uid, sender = uid) => `INSERT INTO public."Message"(content, conversationid, senderid) VALUES ('x','conv','${sender}')`;
const invite = (extra = '', vals = '') =>
  `INSERT INTO public.team_connections(company_id, worker_id, status, source${extra}) VALUES ('${EMP}','${W2}','pending','link'${vals}) RETURNING blocked_by, accepted_at, created_at > now() - interval '1 minute' AS agora`;
const forged = invite(', blocked_by, accepted_at, created_at', `, '${W2}', now(), '2000-01-01'`);
const blockNoAuthor = `UPDATE public.team_connections SET status='blocked'`;
const pay = `INSERT INTO public.shift_payments(job_id, company_id, worker_id, application_id, amount) VALUES ('${JOB}','${EMP}','${W}','${APP}',10)`;
const appSet = (set) => `UPDATE public.applications SET ${set} WHERE id='${APP}'`;
const NEVER = ['pending', 'reviewing', 'interview', 'applied', 'invited', 'declined', 'rejected'];

const db = new PGlite();
await db.exec(STUB);

console.log('--- antes (a falha reproduz)');
const levelAfter = async (sql) => {
  await db.exec('BEGIN');
  await db.exec(sql);
  const r = (await db.query(`SELECT xp, level FROM public.workers WHERE id='${W}'`)).rows[0];
  await db.exec('ROLLBACK');
  return r;
};
const six = `UPDATE public.workers SET primary_role='r' WHERE id='${W}';
  INSERT INTO public.applications(id, job_id, worker_id, status) SELECT gen_random_uuid(), '${JOB}', '${W}', 'completed' FROM generate_series(1,4);
  SELECT public.recompute_worker_aggregates('${W}');`;
let l = await levelAfter(six);
check('antes: 475 XP vira nivel 5 quando o xp muda', l.xp === 475 && l.level === 5, JSON.stringify(l));
l = await levelAfter(`${six} SELECT public.recompute_worker_aggregates('${W}');`);
check('antes: o mesmo recompute volta para 3', l.level === 3, JSON.stringify(l));
check('antes: gerente nao le', barred(await as(db, GER, readMsg)));
check('antes: gerente nao envia', barred(await as(db, GER, send(GER))));
let r = await as(db, EMP, forged);
check('antes: INSERT aceita blocked_by/accepted_at do cliente', r.ok && r.rows[0].blocked_by === W2 && r.rows[0].accepted_at !== null, r.error);
check('antes: empresa bloqueia sem autor', (await as(db, EMP, blockNoAuthor)).ok);
for (const s of NEVER) check(`antes: paga candidatura ${s}`, (await as(db, EMP, pay, appSet(`status='${s}'`))).ok);

await db.exec(MIG);
await db.exec(MIG);
check('migration aplica e reaplica', true);

console.log('--- nivel');
const lv = (await db.query(`SELECT id, xp, level FROM public.workers WHERE id IN ('${W475}','${WOK}') ORDER BY id`)).rows;
check('incoerente 475/5 vira 3, xp intacto', lv[0].xp === 475 && lv[0].level === 3, JSON.stringify(lv));
check('coerente 625/4 nao muda', lv[1].xp === 625 && lv[1].level === 4);
l = await levelAfter(six);
check('recompute que muda o xp ja da 3', l.xp === 475 && l.level === 3, JSON.stringify(l));
l = await levelAfter(`UPDATE public.workers SET avatar_url='u' WHERE id='${W}'`);
check('foto nao soma XP por fora', l.xp === 0, JSON.stringify(l));
l = await levelAfter(`UPDATE public.workers SET avatar_url='u' WHERE id='${W}'; SELECT public.recompute_worker_aggregates('${W}')`);
check('bonus de foto vem do recompute', l.xp === 50 && l.level === 1, JSON.stringify(l));

console.log('--- chat');
for (const [who, uid] of [['freela', W], ['dono', EMP], ['gerente', GER], ['operador da organizacao', ORG]]) {
  check(`${who} le`, (await as(db, uid, readMsg)).ok);
  r = await as(db, uid, send(uid));
  check(`${who} envia`, r.ok, r.error);
}
for (const [who, uid] of [['encarregado', ENC], ['terceiro', TERC]]) {
  check(`${who} nao le`, barred(await as(db, uid, readMsg)));
  check(`${who} nao envia`, barred(await as(db, uid, send(uid))));
}
check('gerente nao envia em nome do dono', barred(await as(db, GER, send(GER, EMP))));
const aviso = `SELECT user_id, title, link FROM public.notifications ORDER BY id DESC LIMIT 1`;
r = await as(db, GER, send(GER), '', aviso);
check('aviso do gerente vai ao freela com o nome da empresa', r.extra?.user_id === W && r.extra.title === 'Nova mensagem de Empresa A' && r.extra.link === '/messages?conversation=conv', JSON.stringify(r));
r = await as(db, W, send(W), '', aviso);
check('aviso do freela segue indo a empresa', r.extra?.user_id === EMP && r.extra.title === 'Nova mensagem de Freela' && r.extra.link === '/company/messages?conversation=conv', JSON.stringify(r));

console.log('--- elenco');
for (const [who, uid] of [['dono', EMP], ['encarregado', ENC]]) {
  r = await as(db, uid, forged);
  check(`${who}: INSERT forjado nasce limpo`, r.ok && r.rows[0].blocked_by === null && r.rows[0].accepted_at === null && r.rows[0].agora, r.error ?? JSON.stringify(r.rows));
  check(`${who}: convite comum segue`, (await as(db, uid, invite())).ok);
}
check('empresa nao bloqueia sem autor', barred(await as(db, EMP, blockNoAuthor)));
check('freela nao bloqueia sem autor', barred(await as(db, W, blockNoAuthor)));
check('autor nao apaga a autoria mantendo bloqueado',
  barred(await as(db, W, `UPDATE public.team_connections SET blocked_by=NULL`, `UPDATE public.team_connections SET status='blocked', blocked_by='${W}'`)));
for (const [label, uid, sql, setup] of [
  ['freela bloqueia com autoria (blockConnection)', W, `UPDATE public.team_connections SET status='blocked', blocked_by='${W}'`],
  ['Gestor bloqueia com autoria', GER, `UPDATE public.team_connections SET status='blocked', blocked_by='${GER}'`],
  ['freela desfaz o proprio bloqueio', W, `UPDATE public.team_connections SET status='accepted', blocked_by=NULL`, `UPDATE public.team_connections SET status='blocked', blocked_by='${W}'`],
  ['freela aceita (acceptConnection)', W, `UPDATE public.team_connections SET status='accepted', accepted_at=now()`, `UPDATE public.team_connections SET status='pending'`],
  ['RPC DEFINER cria vinculo aceito', W2, `SELECT public.srv_link('${EMP}','${W2}')`],
]) {
  r = await as(db, uid, sql, setup);
  check(`legitimo: ${label}`, r.ok, r.error ?? '0 linhas');
}
r = await as(db, W2, `SELECT public.srv_link('${EMP}','${W2}')`, '', `SELECT accepted_at FROM public.team_connections WHERE worker_id='${W2}'`);
check('RPC DEFINER preserva accepted_at', r.extra?.accepted_at != null, r.error);

console.log('--- pagamento');
for (const s of NEVER) check(`barrado: nunca contratado (${s})`, barred(await as(db, EMP, pay, appSet(`status='${s}'`))));
for (const s of ['hired', 'in_progress', 'completed', 'cancelled', 'accepted', 'approved']) {
  r = await as(db, EMP, pay, appSet(`status='${s}'`));
  check(`legitimo: paga ${s}`, r.ok, r.error);
}
check('legitimo: paga quem saiu e bloqueou depois de concluir',
  (await as(db, EMP, pay, `${appSet("status='completed'")}; UPDATE public.team_connections SET status='blocked', blocked_by='${W}'`)).ok);
for (const [label, set] of [['presenca registrada', "status='rejected', worker_checkin_at=now()"], ['convite aceito', "status='rejected', invitation_response='accepted'"]]) {
  check(`legitimo: status antigo com ${label}`, (await as(db, EMP, pay, appSet(set))).ok);
}
check('continua barrado: candidatura de outro freela', barred(await as(db, EMP, pay.replace(`'${W}','${APP}'`, `'${W2}','${APP}'`))));
check('service_role nao e travado', (await as(db, EMP, pay, appSet("status='pending'"), null, 'service_role')).ok);

console.log(`\n${passed} ok, ${failed} falhas`);
process.exit(failed ? 1 : 0);
