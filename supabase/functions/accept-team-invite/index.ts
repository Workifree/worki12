// Deploy: supabase functions deploy accept-team-invite --no-verify-jwt
// Auth propria pelo token de convite (256 bits, uso unico). ADR-20261127.
// Nunca loga e-mail, senha ou token — apenas `outcome`.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { isRateLimited } from '../_shared/rate-limit.ts';

const ALLOWED_ORIGINS = new Set([
  'https://worki-opal.vercel.app',
  'http://localhost:5173',
  'http://127.0.0.1:5173',
]);

function corsHeaders(req: Request): Record<string, string> {
  const origin = req.headers.get('origin') ?? '';
  const allowOrigin = ALLOWED_ORIGINS.has(origin) ? origin : 'https://worki-opal.vercel.app';
  return {
    'Access-Control-Allow-Origin': allowOrigin,
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Vary': 'Origin',
  };
}

function jsonResponse(req: Request, body: Record<string, unknown>, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      ...corsHeaders(req),
      'Content-Type': 'application/json',
    },
  });
}

function clientIp(req: Request): string {
  const fwd = req.headers.get('x-forwarded-for');
  if (fwd) return fwd.split(',')[0].trim();
  return req.headers.get('x-real-ip')?.trim() || 'unknown';
}

interface ProvisionCheckRow {
  outcome?: string;
  email?: string;
  account?: 'none' | 'company' | 'worker' | 'unconfirmed';
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders(req) });
  }

  if (req.method !== 'POST') {
    return jsonResponse(req, { outcome: 'invalid_input' }, 405);
  }

  const ip = clientIp(req);
  if (isRateLimited(ip, 'accept-team-invite', 10, 10 * 60_000)) {
    console.log('[accept-team-invite] outcome=rate_limited');
    return jsonResponse(req, { outcome: 'rate_limited' }, 429);
  }

  let body: { token?: unknown; password?: unknown; accept_tos?: unknown };
  try {
    body = await req.json();
  } catch {
    console.log('[accept-team-invite] outcome=invalid_input');
    return jsonResponse(req, { outcome: 'invalid_input' }, 400);
  }

  const token = typeof body.token === 'string' ? body.token.trim() : '';
  const password = typeof body.password === 'string' ? body.password : '';
  const acceptTos = body.accept_tos === true;

  if (!/^[0-9a-f]{64}$/.test(token) || !acceptTos || password.length < 8 || password.length > 72) {
    console.log('[accept-team-invite] outcome=invalid_input');
    return jsonResponse(req, { outcome: 'invalid_input' }, 400);
  }

  const supabaseUrl = Deno.env.get('SUPABASE_URL');
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (!supabaseUrl || !serviceRoleKey) {
    console.error('[accept-team-invite] outcome=error (missing env)');
    return jsonResponse(req, { outcome: 'error' }, 500);
  }

  const admin = createClient(supabaseUrl, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  const { data, error: rpcError } = await admin.rpc('internal_team_invite_provision_check', {
    p_token: token,
  });

  if (rpcError) {
    console.error('[accept-team-invite] outcome=error (rpc)');
    return jsonResponse(req, { outcome: 'error' }, 500);
  }

  const check = (data ?? null) as ProvisionCheckRow | null;
  if (!check || check.outcome !== 'ok' || !check.email || !check.account) {
    const outcome = check?.outcome ?? 'not_found';
    console.log(`[accept-team-invite] outcome=${outcome}`);
    return jsonResponse(req, { outcome });
  }

  if (check.account === 'worker') {
    console.log('[accept-team-invite] outcome=worker_cannot_be_manager');
    return jsonResponse(req, { outcome: 'worker_cannot_be_manager' });
  }

  if (check.account === 'unconfirmed') {
    console.log('[accept-team-invite] outcome=account_pending');
    return jsonResponse(req, { outcome: 'account_pending' });
  }

  if (check.account === 'company') {
    console.log('[accept-team-invite] outcome=existing_account');
    return jsonResponse(req, { outcome: 'existing_account' });
  }

  // account === 'none': cria a conta ja confirmada, marcada como email_ownership='not_verified'.
  const { error: createError } = await admin.auth.admin.createUser({
    email: check.email,
    password,
    email_confirm: true,
    user_metadata: { user_type: 'hire' },
    app_metadata: {
      provisioned_via: 'team_invite',
      email_ownership: 'not_verified',
    },
  });

  if (createError) {
    const msg = createError.message ?? '';
    if (/already.*registered|already.*exists|duplicate/i.test(msg)) {
      console.log('[accept-team-invite] outcome=existing_account');
      return jsonResponse(req, { outcome: 'existing_account' });
    }
    console.error('[accept-team-invite] outcome=error (createUser)');
    return jsonResponse(req, { outcome: 'error' }, 500);
  }

  console.log('[accept-team-invite] outcome=created');
  return jsonResponse(req, { outcome: 'created', email: check.email });
});
