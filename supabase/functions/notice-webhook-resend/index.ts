// Deploy: supabase functions deploy notice-webhook-resend --no-verify-jwt  (auth propria: assinatura Svix)
import { handleResendWebhook } from '../_shared/notices/handlers.ts';
import { env, log, rpc } from '../_shared/notices/runtime.ts';

Deno.serve((req) => handleResendWebhook(req, { env, rpc, log }));
