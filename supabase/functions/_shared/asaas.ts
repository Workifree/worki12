const CORS_ORIGIN = Deno.env.get('CORS_ORIGIN');
const IS_PRODUCTION = Deno.env.get('ASAAS_ENVIRONMENT') === 'production';

// In production, CORS_ORIGIN must be set (e.g. https://worki.com.br)
// In sandbox/dev, allow all origins for testing
const ALLOWED_ORIGIN = CORS_ORIGIN || (IS_PRODUCTION ? '' : '*');

if (IS_PRODUCTION && !CORS_ORIGIN) {
    console.error('CRITICAL: CORS_ORIGIN must be set in production. All requests will be blocked.');
}

// Allowlist of origins that may call these functions. Includes the configured
// production origin (CORS_ORIGIN, e.g. the Vercel URL) plus local dev origins so
// `npm run dev` on localhost:5173 is not blocked by CORS in production.
const STATIC_ALLOWED_ORIGINS = [
    'http://localhost:5173',
    'http://127.0.0.1:5173',
    'http://localhost:3000',
    'https://worki-opal.vercel.app',
];

const ALLOWED_ORIGINS = [
    ...(CORS_ORIGIN ? [CORS_ORIGIN] : []),
    ...STATIC_ALLOWED_ORIGINS,
];

/**
 * Returns CORS headers with the Access-Control-Allow-Origin dynamically
 * reflected from the request's Origin header when it is in the allowlist.
 * Falls back to the configured ALLOWED_ORIGIN otherwise.
 */
export function getCorsHeaders(req?: Request) {
    const requestOrigin = req?.headers.get('Origin') ?? '';
    const origin = ALLOWED_ORIGINS.includes(requestOrigin)
        ? requestOrigin
        : ALLOWED_ORIGIN;
    return {
        'Access-Control-Allow-Origin': origin,
        'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
        'Vary': 'Origin',
    };
}

// Backward-compatible static export (no request context). Prefer getCorsHeaders(req).
export const corsHeaders = {
    'Access-Control-Allow-Origin': ALLOWED_ORIGIN,
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

export const ASAAS_API_URL = Deno.env.get('ASAAS_ENVIRONMENT') === 'production'
    ? 'https://api.asaas.com/v3'
    : 'https://sandbox.asaas.com/api/v3';

export const getAsaasHeaders = (apiKey?: string) => {
    const token = apiKey || Deno.env.get('ASAAS_API_KEY');
    if (!token) {
        throw new Error('ASAAS_API_KEY is not configured');
    }
    return {
        'Content-Type': 'application/json',
        'access_token': token,
    };
};
