// Deploy: supabase functions deploy notice-webhook-whatsapp --no-verify-jwt  (auth propria: verify token + X-Hub-Signature-256)
import { handleWhatsappWebhook } from '../_shared/notices/handlers.ts';
import { env, log, rpc } from '../_shared/notices/runtime.ts';

Deno.serve((req) => handleWhatsappWebhook(req, { env, rpc, log }));
