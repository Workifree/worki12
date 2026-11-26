// Webhooks e descadastro. Sem Deno.*: testado em Node.

import { safeEqual, verifyMetaSignature, verifySvix, verifyUnsubscribeToken } from './crypto.ts';
import type { Env, Rpc } from './dispatch.ts';

export interface HandlerDeps {
    env: Env;
    rpc: Rpc;
    log: (message: string) => void;
}

const DEFAULT_APP_URL = 'https://worki-opal.vercel.app';
const MAX_BODY = 200_000;

const json = (body: unknown, status = 200, headers: Record<string, string> = {}) =>
    new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', ...headers } });

const RESEND_EVENTS: Record<string, string> = {
    'email.delivered': 'delivered',
    'email.opened': 'opened',
    'email.bounced': 'bounced',
    'email.complained': 'complaint',
    'email.failed': 'failed',
};

export async function handleResendWebhook(req: Request, deps: HandlerDeps): Promise<Response> {
    if (req.method === 'OPTIONS') return new Response(null, { status: 204 });
    const secret = deps.env('RESEND_WEBHOOK_SECRET');
    if (!secret) return json({ error: 'not_configured' }, 503);
    if (req.method !== 'POST') return json({ error: 'method_not_allowed' }, 405);
    const body = await req.text();
    if (body.length > MAX_BODY || !(await verifySvix(secret, req.headers, body))) {
        return json({ error: 'invalid_signature' }, 401);
    }
    let event: { type?: string; data?: { email_id?: string; bounce?: { type?: string } } };
    try {
        event = JSON.parse(body);
    } catch {
        return json({ error: 'invalid_body' }, 400);
    }
    let status = RESEND_EVENTS[event.type ?? ''];
    // bounce temporario nao desliga o e-mail da pessoa
    if (status === 'bounced' && /transient/i.test(event.data?.bounce?.type ?? '')) status = 'failed';
    if (!status || !event.data?.email_id) return json({ ignored: true });
    try {
        await deps.rpc('record_notice_event', {
            p_channel: 'email', p_provider_message_id: event.data.email_id, p_status: status,
        });
    } catch {
        deps.log('notice-webhook-resend: falha ao gravar evento');
        return json({ error: 'store_failed' }, 500); // o provedor reenvia
    }
    return json({ ok: true });
}

/** A Meta as vezes manda celular brasileiro sem o 9: testa as duas formas. */
export function phoneVariants(waId: string): string[] {
    const digits = waId.replace(/\D/g, '');
    const variants = [`+${digits}`];
    if (/^55\d{10}$/.test(digits)) variants.push(`+${digits.slice(0, 4)}9${digits.slice(4)}`);
    if (/^55\d{2}9\d{8}$/.test(digits)) variants.push(`+${digits.slice(0, 4)}${digits.slice(5)}`);
    return variants;
}

interface WaValue {
    statuses?: { id?: string; status?: string }[];
    messages?: { from?: string; text?: { body?: string }; button?: { text?: string } }[];
}

const WA_STATUS: Record<string, string> = { read: 'opened', delivered: 'delivered', failed: 'failed' };

export async function handleWhatsappWebhook(req: Request, deps: HandlerDeps): Promise<Response> {
    if (req.method === 'OPTIONS') return new Response(null, { status: 204 });
    const verifyToken = deps.env('WA_VERIFY_TOKEN');
    const appSecret = deps.env('WA_APP_SECRET');
    if (!verifyToken || !appSecret) return json({ error: 'not_configured' }, 503);

    if (req.method === 'GET') {
        const q = new URL(req.url).searchParams;
        if (q.get('hub.mode') === 'subscribe' && (await safeEqual(q.get('hub.verify_token') ?? '', verifyToken))) {
            return new Response(q.get('hub.challenge') ?? '', { headers: { 'Content-Type': 'text/plain' } });
        }
        return json({ error: 'forbidden' }, 403);
    }
    if (req.method !== 'POST') return json({ error: 'method_not_allowed' }, 405);

    const body = await req.text();
    const signature = req.headers.get('x-hub-signature-256');
    if (body.length > MAX_BODY || !(await verifyMetaSignature(appSecret, signature, body))) {
        return json({ error: 'invalid_signature' }, 401);
    }
    let parsed: { entry?: { changes?: { value?: WaValue }[] }[] };
    try {
        parsed = JSON.parse(body);
    } catch {
        return json({ error: 'invalid_body' }, 400);
    }

    try {
        for (const change of (parsed.entry ?? []).flatMap((e) => e.changes ?? [])) {
            for (const s of change.value?.statuses ?? []) {
                const status = WA_STATUS[s.status ?? ''];
                if (status && s.id) {
                    await deps.rpc('record_notice_event', {
                        p_channel: 'whatsapp', p_provider_message_id: s.id, p_status: status,
                    });
                }
            }
            for (const m of change.value?.messages ?? []) {
                const text = (m.text?.body ?? m.button?.text ?? '').trim().replace(/[.!]+$/, '').toUpperCase();
                if (m.from && (text === 'PARAR' || text === 'SAIR')) {
                    for (const phone of phoneVariants(m.from)) {
                        await deps.rpc('record_notice_whatsapp_stop', { p_phone_e164: phone });
                    }
                }
            }
        }
    } catch {
        deps.log('notice-webhook-whatsapp: falha ao gravar evento');
        return json({ error: 'store_failed' }, 500);
    }
    return json({ ok: true });
}

/**
 * GET NUNCA altera estado (antivirus abre links): so leva a pagina de confirmacao do app.
 * POST desliga (botao da pagina e One-Click da RFC 8058). O Supabase nao serve HTML em funcao,
 * por isso a pagina e estatica (frontend/public/descadastro.html).
 */
export async function handleUnsubscribe(req: Request, deps: HandlerDeps): Promise<Response> {
    const appUrl = (deps.env('APP_URL') || DEFAULT_APP_URL).replace(/\/+$/, '');
    const origin = req.headers.get('origin') ?? '';
    const cors: Record<string, string> = {
        'Access-Control-Allow-Origin': origin === 'http://localhost:5173' ? origin : new URL(appUrl).origin,
        'Access-Control-Allow-Methods': 'POST, OPTIONS',
        'Access-Control-Allow-Headers': 'content-type',
        Vary: 'Origin',
    };
    if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });
    const secret = deps.env('NOTICE_UNSUBSCRIBE_SECRET');
    if (!secret) return json({ error: 'not_configured' }, 503, cors);
    const token = new URL(req.url).searchParams.get('t') ?? '';
    if (req.method === 'GET') {
        return new Response(null, {
            status: 303, headers: { Location: `${appUrl}/descadastro.html#t=${encodeURIComponent(token)}` },
        });
    }
    if (req.method !== 'POST') return json({ error: 'method_not_allowed' }, 405, cors);
    const claim = await verifyUnsubscribeToken(secret, token);
    if (!claim) return json({ error: 'invalid_token' }, 400, cors);
    try {
        await deps.rpc('notice_unsubscribe', { p_user_id: claim.userId, p_channel: claim.channel });
    } catch {
        deps.log('notice-unsubscribe: falha ao gravar');
        return json({ error: 'store_failed' }, 500, cors);
    }
    return json({ ok: true, channel: claim.channel }, 200, cors);
}
