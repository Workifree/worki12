import { createClient, navigatorLock } from '@supabase/supabase-js';
import { createResilientLock } from './authLock';

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseAnonKey) {
    throw new Error('Missing VITE_SUPABASE_URL or VITE_SUPABASE_ANON_KEY environment variables');
}

// Mesmo padrão do auth-js (navigator.locks quando existe; senão, sem trava), mas um timeout de
// aquisição é repetido em vez de ficar guardado no client para sempre (ver lib/authLock.ts).
const hasNavigatorLocks = typeof navigator !== 'undefined' && !!navigator.locks;

export const supabase = createClient(supabaseUrl, supabaseAnonKey, hasNavigatorLocks
    ? { auth: { lock: createResilientLock(navigatorLock) } }
    : undefined);

// ── Rajada de getUser() ─────────────────────────────────────────────────────────────────────
// Cada tela, serviço e componente chama `supabase.auth.getUser()` por conta própria, e uma
// navegação disparava ~8 GET /auth/v1/user iguais. Aqui as chamadas SEM argumento compartilham a
// mesma requisição em voo e reaproveitam o resultado POSITIVO por alguns segundos. Qualquer
// evento de auth (login, saída, refresh de token, troca de usuário) derruba o cache na hora.
// Erro e "sem usuário" nunca ficam guardados. Não muda a segurança: o servidor continua validando
// o JWT em toda consulta, e a RLS segue sendo a defesa.
const GET_USER_TTL_MS = 5_000;
const rawGetUser = supabase.auth.getUser.bind(supabase.auth);
type GetUserResult = Awaited<ReturnType<typeof rawGetUser>>;
let getUserInFlight: Promise<GetUserResult> | null = null;
let getUserCached: { at: number; value: GetUserResult } | null = null;
let getUserGeneration = 0;

supabase.auth.onAuthStateChange(() => {
    getUserGeneration += 1;
    getUserCached = null;
    getUserInFlight = null;
});

supabase.auth.getUser = ((jwt?: string) => {
    if (jwt !== undefined) return rawGetUser(jwt);
    if (getUserCached && Date.now() - getUserCached.at < GET_USER_TTL_MS) return Promise.resolve(getUserCached.value);
    if (getUserInFlight) return getUserInFlight;
    const generation = getUserGeneration;
    const request = rawGetUser()
        .then((value) => {
            if (generation === getUserGeneration && value.data.user && !value.error) {
                getUserCached = { at: Date.now(), value };
            }
            return value;
        })
        .finally(() => {
            if (getUserInFlight === request) getUserInFlight = null;
        });
    getUserInFlight = request;
    return request;
}) as typeof supabase.auth.getUser;
