// Assinaturas dos avisos. So Web Crypto, sem Deno.*: testado em Node (supabase/tests/pglite-avisos).

const encoder = new TextEncoder();

type Bytes = Uint8Array<ArrayBuffer>;

export async function hmacSha256(key: string | Bytes, data: string): Promise<Bytes> {
    const raw = typeof key === 'string' ? encoder.encode(key) : key;
    const cryptoKey = await crypto.subtle.importKey('raw', raw, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
    return new Uint8Array(await crypto.subtle.sign('HMAC', cryptoKey, encoder.encode(data)));
}

/** Comparacao de tempo constante (inclusive para tamanhos diferentes: compara os hashes). */
export async function safeEqual(a: string, b: string): Promise<boolean> {
    const [x, y] = await Promise.all(
        [a, b].map(async (v) => new Uint8Array(await crypto.subtle.digest('SHA-256', encoder.encode(v)))),
    );
    let diff = 0;
    for (let i = 0; i < x.length; i++) diff |= x[i] ^ y[i];
    return diff === 0;
}

const toBase64 = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes));
const fromBase64 = (value: string): Bytes => {
    const bin = atob(value);
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
};
const toBase64Url = (bytes: Uint8Array) => toBase64(bytes).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '');
const fromBase64Url = (value: string) => fromBase64(value.replaceAll('-', '+').replaceAll('_', '/'));
const toHex = (bytes: Uint8Array) => Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');

export const SVIX_TOLERANCE_SECONDS = 300;

/** Webhook do Resend (padrao Svix): HMAC de "id.timestamp.corpo", janela de 5 minutos. */
export async function verifySvix(secret: string, headers: Headers, body: string, nowMs = Date.now()): Promise<boolean> {
    const id = headers.get('svix-id');
    const timestamp = headers.get('svix-timestamp');
    const signatures = headers.get('svix-signature');
    if (!secret || !id || !timestamp || !signatures || !/^\d+$/.test(timestamp)) return false;
    if (Math.abs(nowMs / 1000 - Number(timestamp)) > SVIX_TOLERANCE_SECONDS) return false;
    let key: Bytes;
    try {
        key = fromBase64(secret.replace(/^whsec_/, ''));
    } catch {
        return false;
    }
    if (key.length === 0) return false;
    const expected = toBase64(await hmacSha256(key, `${id}.${timestamp}.${body}`));
    for (const part of signatures.split(' ')) {
        const [version, value] = part.split(',');
        if (version === 'v1' && value && (await safeEqual(value, expected))) return true;
    }
    return false;
}

/** X-Hub-Signature-256 da Meta sobre o corpo CRU. */
export async function verifyMetaSignature(appSecret: string, header: string | null, body: string): Promise<boolean> {
    if (!appSecret || !header?.startsWith('sha256=')) return false;
    return safeEqual(header.slice(7), toHex(await hmacSha256(appSecret, body)));
}

export type NoticeChannel = 'push' | 'email' | 'whatsapp';
export const UNSUBSCRIBE_TTL_SECONDS = 90 * 24 * 60 * 60;

export async function signUnsubscribeToken(
    secret: string, userId: string, channel: NoticeChannel, nowMs = Date.now(),
): Promise<string> {
    const claim = `${userId}.${channel}.${Math.floor(nowMs / 1000) + UNSUBSCRIBE_TTL_SECONDS}`;
    return `${toBase64Url(encoder.encode(claim))}.${toBase64Url(await hmacSha256(secret, `unsubscribe:${claim}`))}`;
}

export async function verifyUnsubscribeToken(
    secret: string, token: string, nowMs = Date.now(),
): Promise<{ userId: string; channel: NoticeChannel } | null> {
    const [claim64, signature, extra] = token.split('.');
    if (!secret || !claim64 || !signature || extra !== undefined || token.length > 400) return null;
    let claim: string;
    try {
        claim = new TextDecoder().decode(fromBase64Url(claim64));
    } catch {
        return null;
    }
    const expected = toBase64Url(await hmacSha256(secret, `unsubscribe:${claim}`));
    if (!(await safeEqual(signature, expected))) return null;
    const [userId, channel, exp] = claim.split('.');
    if (!/^[0-9a-f-]{36}$/.test(userId) || !['push', 'email', 'whatsapp'].includes(channel)) return null;
    if (!(Number(exp) * 1000 > nowMs)) return null;
    return { userId, channel: channel as NoticeChannel };
}
