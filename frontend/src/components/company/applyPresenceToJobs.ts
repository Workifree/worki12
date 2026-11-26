import { supabase } from '../../lib/supabase';
import { logError } from '../../lib/logger';
import type { PresencePolicy } from '../../lib/presence';

/**
 * A RPC de lote recusa a política de presença e os turnos nascem `dual`: a escolha é gravada em
 * seguida. `false` = algum turno ficou sem ela.
 */
export async function applyPresenceToJobs(jobIds: string[], policy: PresencePolicy): Promise<boolean> {
    if (policy.presence_mode !== 'qr_gps' || jobIds.length === 0) return true;
    const { data, error } = await supabase.from('jobs').update({ ...policy }).in('id', jobIds).select('id');
    if (error || (data?.length ?? 0) < jobIds.length) {
        logError('applyPresenceToJobs', error ?? 'linhas a menos');
        return false;
    }
    return true;
}
