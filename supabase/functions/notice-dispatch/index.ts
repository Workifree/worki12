// Deploy: supabase functions deploy notice-dispatch --no-verify-jwt  (auth propria: x-dispatch-secret)
import webpush from 'npm:web-push@3.6.7';
import { handleDispatch } from '../_shared/notices/dispatch.ts';
import { admin, env, log, rpc } from '../_shared/notices/runtime.ts';

Deno.serve((req) =>
    handleDispatch(req, {
        env,
        rpc,
        log,
        fetch,
        async sendPush(sub, body, options) {
            // A biblioteca so monta o request cifrado; o envio e por fetch.
            const details = webpush.generateRequestDetails(
                { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
                body,
                {
                    TTL: options.ttl,
                    urgency: options.urgent ? 'high' : 'normal',
                    topic: options.topic,
                    contentEncoding: 'aes128gcm',
                    vapidDetails: {
                        subject: env('VAPID_SUBJECT')!,
                        publicKey: env('VAPID_PUBLIC_KEY')!,
                        privateKey: env('VAPID_PRIVATE_KEY')!,
                    },
                },
            );
            const headers = { ...details.headers } as Record<string, string | number>;
            delete headers['Content-Length'];
            const res = await fetch(details.endpoint, {
                method: details.method,
                headers: headers as unknown as Record<string, string>,
                body: details.body,
                redirect: 'manual',
                signal: AbortSignal.timeout(10_000),
            });
            await res.body?.cancel();
            if (res.ok) {
                await admin().from('push_subscriptions')
                    .update({ last_success_at: new Date().toISOString(), failed_count: 0 }).eq('id', sub.id);
            }
            return res.status;
        },
        async deleteSubscription(id) {
            await admin().from('push_subscriptions').delete().eq('id', id);
        },
    })
);
