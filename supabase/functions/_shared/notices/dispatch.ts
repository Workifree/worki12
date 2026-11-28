// Nucleo do notice-dispatch. Sem Deno.* e sem pacotes: dependencias entram por parametro.
// Regras de envio (expiracao, preferencia, silencio, teto) vivem SO no SQL (claim_notice_batch).

import { safeEqual, signUnsubscribeToken } from './crypto.ts';
import type { NoticeChannel } from './crypto.ts';
import { formatWhen, noticeText, renderEmail } from './templates.ts';
import type { NoticeEventKind, NoticePayload } from './templates.ts';

export type Env = (name: string) => string | undefined;
export type Rpc = (fn: string, args: Record<string, unknown>) => Promise<unknown>;

export interface PushSubscriptionRow {
    id: string;
    endpoint: string;
    p256dh: string;
    auth: string;
}

export interface ClaimedNotice {
    delivery_id: string;
    channel: NoticeChannel;
    event_kind: NoticeEventKind;
    event_id: string;
    recipient_id: string;
    payload: NoticePayload;
    urgency: 'low' | 'normal' | 'urgent';
    expires_at: string;
    email: string | null;
    phone: string | null;
    subscriptions: PushSubscriptionRow[] | null;
}

export interface DispatchDeps {
    env: Env;
    rpc: Rpc;
    fetch: typeof fetch;
    /** Devolve o status HTTP do servico de push. */
    sendPush: (
        sub: PushSubscriptionRow, body: string, options: { ttl: number; urgent: boolean; topic: string },
    ) => Promise<number>;
    deleteSubscription: (id: string) => Promise<void>;
    log: (message: string) => void;
}

const DEFAULT_APP_URL = 'https://www.workyn.app';
const TIMEOUT_MS = 10_000;

const hasAll = (env: Env, names: string[]) => names.every((n) => !!env(n));

/** Canal sem segredo = desligado, sem erro. */
export function availableChannels(env: Env): NoticeChannel[] {
    const channels: NoticeChannel[] = [];
    if (hasAll(env, ['VAPID_PUBLIC_KEY', 'VAPID_PRIVATE_KEY', 'VAPID_SUBJECT'])) channels.push('push');
    if (hasAll(env, ['RESEND_API_KEY', 'NOTICE_EMAIL_FROM', 'NOTICE_UNSUBSCRIBE_SECRET', 'SUPABASE_URL'])) {
        channels.push('email');
    }
    if (hasAll(env, ['WA_ACCESS_TOKEN', 'WA_PHONE_NUMBER_ID', 'WA_APP_SECRET', 'WA_VERIFY_TOKEN'])) {
        channels.push('whatsapp');
    }
    return channels;
}

interface SendResult {
    status: 'sent' | 'failed' | 'skipped_no_contact';
    providerId?: string;
    error?: string;
}

async function pushNotice(item: ClaimedNotice, deps: DispatchDeps): Promise<SendResult> {
    const t = noticeText(item.event_kind, item.payload);
    const body = JSON.stringify({
        title: t.title, body: t.body, tag: item.event_id, data: { path: t.path, eventId: item.event_id },
    });
    const secondsLeft = Math.floor((Date.parse(item.expires_at) - Date.now()) / 1000);
    const options = {
        ttl: Math.max(0, Math.min(secondsLeft, 86_400)),
        urgent: item.urgency === 'urgent',
        topic: item.event_id.replaceAll('-', '').slice(0, 32),
    };
    let delivered = 0;
    let gone = 0;
    let lastStatus = 'rede';
    const subs = item.subscriptions ?? [];
    for (const sub of subs) {
        try {
            const status = await deps.sendPush(sub, body, options);
            if (status >= 200 && status < 300) {
                delivered++;
            } else if (status === 404 || status === 410) {
                gone++;
                await deps.deleteSubscription(sub.id);
            } else {
                lastStatus = String(status);
            }
        } catch {
            lastStatus = 'rede';
        }
    }
    if (delivered > 0) return { status: 'sent' };
    if (gone === subs.length) return { status: 'skipped_no_contact', error: 'inscricao expirada' };
    return { status: 'failed', error: `push ${lastStatus}` };
}

async function emailNotice(item: ClaimedNotice, deps: DispatchDeps): Promise<SendResult> {
    if (!item.email) return { status: 'skipped_no_contact' };
    const { env } = deps;
    const appUrl = (env('APP_URL') || DEFAULT_APP_URL).replace(/\/+$/, '');
    const token = await signUnsubscribeToken(env('NOTICE_UNSUBSCRIBE_SECRET')!, item.recipient_id, 'email');
    const mail = renderEmail(item.event_kind, item.payload, {
        appUrl,
        // fragmento: o token nao aparece em log de servidor
        unsubscribePageUrl: `${appUrl}/descadastro.html#t=${token}`,
        senderAddress: env('NOTICE_SENDER_ADDRESS'),
    });
    const res = await deps.fetch('https://api.resend.com/emails', {
        method: 'POST',
        signal: AbortSignal.timeout(TIMEOUT_MS),
        headers: {
            Authorization: `Bearer ${env('RESEND_API_KEY')}`,
            'Content-Type': 'application/json',
            'Idempotency-Key': `notice-${item.delivery_id}`,
        },
        body: JSON.stringify({
            from: env('NOTICE_EMAIL_FROM'),
            to: item.email,
            subject: mail.subject,
            html: mail.html,
            text: mail.text,
            headers: {
                'List-Unsubscribe': `<${env('SUPABASE_URL')}/functions/v1/notice-unsubscribe?t=${token}>`,
                'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click',
            },
        }),
    });
    if (!res.ok) return { status: 'failed', error: `resend ${res.status}` };
    const json = (await res.json().catch(() => ({}))) as { id?: string };
    return { status: 'sent', providerId: json.id };
}

// F3. Pronto e desligado: precisa dos segredos WA_* E de notice_channel_settings.enabled=true.
async function whatsappNotice(item: ClaimedNotice, deps: DispatchDeps): Promise<SendResult> {
    if (!item.phone) return { status: 'skipped_no_contact' };
    const { env } = deps;
    const t = noticeText(item.event_kind, item.payload);
    const when = formatWhen(item.payload.starts_at);
    const variables = [
        item.payload.company_name || 'Uma empresa', when.day, when.time || 'a combinar',
        item.payload.city || 'sua cidade',
    ];
    const res = await deps.fetch(
        `https://graph.facebook.com/${env('WA_API_VERSION') || 'v21.0'}/${env('WA_PHONE_NUMBER_ID')}/messages`,
        {
            method: 'POST',
            signal: AbortSignal.timeout(TIMEOUT_MS),
            headers: { Authorization: `Bearer ${env('WA_ACCESS_TOKEN')}`, 'Content-Type': 'application/json' },
            body: JSON.stringify({
                messaging_product: 'whatsapp',
                to: item.phone.replace(/^\+/, ''),
                type: 'template',
                template: {
                    name: env('WA_TEMPLATE_NAME') || 'turno_disponivel',
                    language: { code: 'pt_BR' },
                    components: [
                        { type: 'body', parameters: variables.map((text) => ({ type: 'text', text })) },
                        {
                            type: 'button', sub_type: 'url', index: '0',
                            parameters: [{ type: 'text', text: t.path.slice(1) }],
                        },
                    ],
                },
            }),
        },
    );
    if (!res.ok) return { status: 'failed', error: `whatsapp ${res.status}` };
    const json = (await res.json().catch(() => ({}))) as { messages?: { id?: string }[] };
    return { status: 'sent', providerId: json.messages?.[0]?.id };
}

const SENDERS = { push: pushNotice, email: emailNotice, whatsapp: whatsappNotice };

const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

export async function handleDispatch(req: Request, deps: DispatchDeps): Promise<Response> {
    // Chamada servidor-servidor: o preflight responde sem liberar origem nenhuma.
    if (req.method === 'OPTIONS') return new Response(null, { status: 204 });
    const secret = deps.env('NOTICE_DISPATCH_SECRET');
    if (!secret) return json({ error: 'not_configured' }, 503);
    if (req.method !== 'POST') return json({ error: 'method_not_allowed' }, 405);
    if (!(await safeEqual(req.headers.get('x-dispatch-secret') ?? '', secret))) {
        return json({ error: 'unauthorized' }, 401);
    }

    let items: ClaimedNotice[];
    try {
        items = ((await deps.rpc('claim_notice_batch', {
            p_limit: 50, p_channels: availableChannels(deps.env),
        })) ?? []) as ClaimedNotice[];
    } catch {
        deps.log('notice-dispatch: falha ao reivindicar lote');
        return json({ error: 'claim_failed' }, 500);
    }

    const totals: Record<string, number> = { claimed: items.length, sent: 0, failed: 0, skipped_no_contact: 0 };
    for (const item of items) {
        let result: SendResult;
        try {
            result = await SENDERS[item.channel](item, deps);
        } catch {
            result = { status: 'failed', error: `${item.channel} erro de envio` };
        }
        totals[result.status]++;
        try {
            await deps.rpc('report_notice_result', {
                p_delivery_id: item.delivery_id, p_status: result.status,
                p_provider_message_id: result.providerId ?? null, p_error: result.error ?? null,
            });
        } catch {
            // fica em 'sending' e volta para a fila em 10 min
            deps.log(`notice-dispatch: falha ao gravar resultado ${item.delivery_id}`);
        }
    }
    return json(totals);
}
