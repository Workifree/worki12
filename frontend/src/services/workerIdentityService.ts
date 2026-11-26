/**
 * Cadastro do PRÓPRIO freela (inclui cpf e birth_date) — cpf-restrito etapa 1
 * (`supabase/migrations/20261129000100`). Enquanto a migration não estiver aplicada, a RPC não
 * existe e o comportamento antigo é mantido. Depois dela, `workers` não se lê mais com `*`.
 * Nunca logar CPF ou data de nascimento.
 */
import { supabase } from '../lib/supabase';
import { logError } from '../lib/logger';

export type WorkerIdentityOutcome =
    | 'saved' | 'cpf_locked' | 'birth_date_locked' | 'invalid_cpf' | 'invalid_birth_date'
    | 'anonymized' | 'not_found' | 'unauthenticated';

export interface WorkerIdentityResult {
    /** `unavailable` = RPC ainda não existe no banco; `error` = a chamada falhou. */
    outcome: WorkerIdentityOutcome | 'unavailable' | 'error';
    cpf_locked?: boolean;
    birth_date_locked?: boolean;
}

/** PostgREST (`PGRST202`) ou Postgres (`42883`): a função não existe. Outro erro NÃO cai no fallback. */
function isMissingRpc(error: { code?: string } | null): boolean {
    return error?.code === 'PGRST202' || error?.code === '42883';
}

/** Mesmo contrato do `.single()`: sem linha visível é erro. */
export async function getMyWorkerProfile(userId: string) {
    const { data, error } = await supabase.rpc('get_my_worker_profile');
    if (isMissingRpc(error)) {
        // Só alcançado antes da migration; com a etapa 2 aplicada a RPC já existe.
        return supabase.from('workers').select('*').eq('id', userId).single();
    }
    if (error) return { data: null, error };
    if (!data) return { data: null, error: new Error('Perfil não encontrado.') };
    return { data, error: null };
}

/** Grava cpf/nascimento do próprio freela (cada um só se ainda vazio). Sem argumentos não escreve. */
export async function setMyWorkerIdentity(
    identity: { cpf?: string | null; birthDate?: string | null } = {},
): Promise<WorkerIdentityResult> {
    const { data, error } = await supabase.rpc('set_my_worker_identity', {
        p_cpf: identity.cpf || null,
        p_birth_date: identity.birthDate || null,
    });
    if (isMissingRpc(error)) return { outcome: 'unavailable' };
    if (error || !data) {
        // Só o código: a mensagem do banco pode ecoar os parâmetros.
        logError('workerIdentity.set', error?.code ?? 'sem resposta');
        return { outcome: 'error' };
    }
    return data as WorkerIdentityResult;
}
