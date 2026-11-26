// Logica das edge functions de avisos (sem rede). Node 24+ (le .ts direto).
// Uso, da raiz: node supabase/tests/pglite-avisos/edge.mjs
import { createHmac } from 'node:crypto';
import * as c from '../../functions/_shared/notices/crypto.ts';
import { noticeText, renderEmail } from '../../functions/_shared/notices/templates.ts';
import { availableChannels, handleDispatch } from '../../functions/_shared/notices/dispatch.ts';
import { handleResendWebhook, handleUnsubscribe, handleWhatsappWebhook } from '../../functions/_shared/notices/handlers.ts';

let passed = 0, failed = 0;
const check = (label, cond, extra = '') => {
  if (cond) { passed++; console.log('ok    ', label); } else { failed++; console.log('FALHOU', label, extra); }
};
const USER = '00000000-0000-0000-0000-000000000001';

function deps(vars, extra = {}) {
  const calls = [];
  return {
    calls,
    env: (n) => vars[n],
    rpc: async (fn, args) => { calls.push({ fn, args }); return extra.rpc?.(fn, args); },
    log: () => {},
    fetch: extra.fetch ?? (async () => { throw new Error('rede nao esperada'); }),
    sendPush: extra.sendPush ?? (async () => 201),
    deleteSubscription: async (id) => { calls.push({ fn: 'delete', args: { id } }); },
  };
}
const post = (url, headers = {}, body) => new Request(url, { method: 'POST', headers, body });

console.log('--- dispatch');
let d = deps({});
let res = await handleDispatch(post('https://f/x', { 'x-dispatch-secret': 'qualquer' }), d);
check('sem NOTICE_DISPATCH_SECRET: 503 sem efeito', res.status === 503 && d.calls.length === 0);
d = deps({ NOTICE_DISPATCH_SECRET: 'segredo' });
res = await handleDispatch(post('https://f/x', { 'x-dispatch-secret': 'errado' }), d);
check('segredo errado: 401 sem efeito', res.status === 401 && d.calls.length === 0);
res = await handleDispatch(post('https://f/x', { 'x-dispatch-secret': 'segredo' }), d);
check('sem chaves de canal: pede lote sem canais, sem erro', res.status === 200 && d.calls[0].args.p_channels.length === 0);
check('e-mail exige remetente verificado e segredo de descadastro',
  !availableChannels((n) => ({ RESEND_API_KEY: 'k', SUPABASE_URL: 'u' })[n]).includes('email'));

const base = {
  event_id: '11111111-1111-1111-1111-111111111111', recipient_id: USER, event_kind: 'shift_call_target', urgency: 'normal',
  expires_at: new Date(Date.now() + 3600_000).toISOString(), email: 'w@x.test', phone: null,
  payload: { company_name: 'Doces <b>', city: 'BH', starts_at: '2026-12-05T11:00:00Z', path: '/my-jobs' },
};
const items = [
  { ...base, delivery_id: 'd1', channel: 'push', subscriptions: [{ id: 's1' }, { id: 's2' }] },
  { ...base, delivery_id: 'd2', channel: 'email', subscriptions: null },
  { ...base, delivery_id: 'd3', channel: 'push', subscriptions: [{ id: 's3' }] },
  { ...base, delivery_id: 'd4', channel: 'push', subscriptions: [{ id: 's4' }] },
];
let sentMail;
d = deps(
  { NOTICE_DISPATCH_SECRET: 's', RESEND_API_KEY: 'k', NOTICE_EMAIL_FROM: 'Worki <a@b>', NOTICE_UNSUBSCRIBE_SECRET: 'u', SUPABASE_URL: 'https://p.supabase.co' },
  {
    rpc: (fn) => (fn === 'claim_notice_batch' ? items : null),
    sendPush: async (sub) => ({ s1: 410, s2: 201, s3: 404, s4: 500 })[sub.id],
    fetch: async (_url, init) => { sentMail = { ...init, body: JSON.parse(init.body) }; return Response.json({ id: 're_9' }); },
  },
);
await handleDispatch(post('https://f/x', { 'x-dispatch-secret': 's' }), d);
const reports = Object.fromEntries(d.calls.filter((x) => x.fn === 'report_notice_result').map((x) => [x.args.p_delivery_id, x.args]));
check('push entregue em um aparelho = sent', reports.d1.p_status === 'sent');
check('404/410 apaga a inscricao', d.calls.filter((x) => x.fn === 'delete').map((x) => x.args.id).join() === 's1,s3');
check('so inscricoes mortas = skipped_no_contact', reports.d3.p_status === 'skipped_no_contact');
check('erro 500 = failed sem PII', reports.d4.p_status === 'failed' && reports.d4.p_error === 'push 500');
check('e-mail enviado com id, idempotencia e List-Unsubscribe', reports.d2.p_provider_message_id === 're_9'
  && sentMail.headers['Idempotency-Key'] === 'notice-d2' && sentMail.body.headers['List-Unsubscribe-Post'] === 'List-Unsubscribe=One-Click'
  && sentMail.body.headers['List-Unsubscribe'].startsWith('<https://p.supabase.co/functions/v1/notice-unsubscribe?t='));

console.log('--- templates');
const mail = renderEmail('shift_call_target', base.payload, { appUrl: 'https://app', unsubscribePageUrl: 'https://app/descadastro.html#t=a' });
check('escapa HTML do nome da empresa', mail.html.includes('Doces &lt;b&gt;') && !mail.html.includes('Doces <b>'));
check('texto com dia, hora (SP) e cidade', mail.text.includes('05/12 às 08:00 (BH)') && mail.text.includes('https://app/my-jobs'));
const extra = renderEmail('payment_recorded', { ...base.payload, cpf: '12345678900', amount: 'R$ 150', pix_key: 'chave' },
  { appUrl: 'https://app', unsubscribePageUrl: 'https://app/u' });
check('campos fora da lista nunca aparecem', !/12345678900|150,|R\$|chave/.test(extra.html + extra.text));
check('aviso a empresa nao cita nome de freela', noticeText('shift_cancelled', { path: '/company/jobs/a/candidates' }).body.startsWith('Houve um cancelamento'));
check('path externo vira /', noticeText('shift_call_target', { path: 'https://mal.example' }).path === '/');

console.log('--- webhook Resend (Svix)');
const key = Buffer.from('chave-de-teste-32-bytes-xxxxxxxx');
const secret = `whsec_${key.toString('base64')}`;
const body = JSON.stringify({ type: 'email.delivered', data: { email_id: 're_9' } });
const svix = (b, ts = Math.floor(Date.now() / 1000)) => ({
  'svix-id': 'm1', 'svix-timestamp': String(ts),
  'svix-signature': `v1,${createHmac('sha256', key).update(`m1.${ts}.${b}`).digest('base64')}`,
});
d = deps({ RESEND_WEBHOOK_SECRET: secret });
check('assinatura valida grava o evento', (await handleResendWebhook(post('https://f/x', svix(body), body), d)).status === 200
  && d.calls[0].args.p_status === 'delivered');
d = deps({ RESEND_WEBHOOK_SECRET: secret });
check('corpo adulterado: 401', (await handleResendWebhook(post('https://f/x', svix(body), body + ' '), d)).status === 401 && d.calls.length === 0);
check('fora da janela de 5 min: 401', (await handleResendWebhook(post('https://f/x', svix(body, Math.floor(Date.now() / 1000) - 301), body), d)).status === 401);
check('sem assinatura: 401', (await handleResendWebhook(post('https://f/x', {}, body), d)).status === 401);
check('sem segredo: 503', (await handleResendWebhook(post('https://f/x', svix(body), body), deps({}))).status === 503);

console.log('--- webhook WhatsApp');
const wa = { WA_VERIFY_TOKEN: 'vt', WA_APP_SECRET: 'as' };
const waBody = JSON.stringify({ entry: [{ changes: [{ value: { messages: [{ from: '553199990000', text: { body: 'parar' } }] } }] }] });
const hub = (b) => ({ 'x-hub-signature-256': `sha256=${createHmac('sha256', 'as').update(b).digest('hex')}` });
d = deps(wa);
res = await handleWhatsappWebhook(post('https://f/x', hub(waBody), waBody), d);
check('PARAR assinado registra opt-out (com e sem o 9)', res.status === 200
  && d.calls.map((x) => x.args.p_phone_e164).join() === '+553199990000,+5531999990000');
d = deps(wa);
check('assinatura adulterada: 401', (await handleWhatsappWebhook(post('https://f/x', hub(waBody + 'x'), waBody), d)).status === 401 && d.calls.length === 0);
res = await handleWhatsappWebhook(new Request('https://f/x?hub.mode=subscribe&hub.verify_token=vt&hub.challenge=42'), d);
check('verificacao GET devolve o challenge', (await res.text()) === '42');
check('verify token errado: 403', (await handleWhatsappWebhook(new Request('https://f/x?hub.mode=subscribe&hub.verify_token=no'), d)).status === 403);
check('sem segredos: 503', (await handleWhatsappWebhook(post('https://f/x', {}, waBody), deps({}))).status === 503);

console.log('--- descadastro');
const env = { NOTICE_UNSUBSCRIBE_SECRET: 'u' };
const token = await c.signUnsubscribeToken('u', USER, 'email');
d = deps(env);
res = await handleUnsubscribe(new Request(`https://f/x?t=${token}`), d);
check('GET nao altera nada e leva a pagina de confirmacao', res.status === 303 && d.calls.length === 0
  && res.headers.get('location').includes('/descadastro.html#t='));
res = await handleUnsubscribe(post(`https://f/x?t=${token}`), d);
check('POST desliga o canal do token', res.status === 200 && d.calls[0].fn === 'notice_unsubscribe' && d.calls[0].args.p_channel === 'email');
d = deps(env);
check('token adulterado: 400', (await handleUnsubscribe(post(`https://f/x?t=${token}x`), d)).status === 400 && d.calls.length === 0);
const old = await c.signUnsubscribeToken('u', USER, 'email', Date.now() - 91 * 86400_000);
check('token vencido (90 dias): 400', (await handleUnsubscribe(post(`https://f/x?t=${old}`), d)).status === 400);
check('assinado com outro segredo: 400', (await handleUnsubscribe(post(`https://f/x?t=${await c.signUnsubscribeToken('z', USER, 'email')}`), d)).status === 400);

console.log(`\n${passed} ok, ${failed} falhas`);
process.exit(failed ? 1 : 0);
