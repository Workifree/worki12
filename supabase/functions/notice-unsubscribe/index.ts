// Deploy: supabase functions deploy notice-unsubscribe --no-verify-jwt  (auth propria: link assinado HMAC)
import { handleUnsubscribe } from '../_shared/notices/handlers.ts';
import { env, log, rpc } from '../_shared/notices/runtime.ts';

Deno.serve((req) => handleUnsubscribe(req, { env, rpc, log }));
