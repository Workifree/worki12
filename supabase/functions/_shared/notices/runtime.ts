// Ligacao com o Deno (service_role so aqui, via Deno.env).
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

export const env = (name: string) => Deno.env.get(name);
export const log = (message: string) => console.error(message); // sem PII

export function admin() {
    return createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, {
        auth: { persistSession: false },
    });
}

export async function rpc(fn: string, args: Record<string, unknown>): Promise<unknown> {
    const { data, error } = await admin().rpc(fn, args);
    if (error) throw new Error(error.code ?? 'rpc_error');
    return data;
}
