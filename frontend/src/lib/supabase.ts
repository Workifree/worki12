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
