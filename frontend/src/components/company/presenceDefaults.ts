/** Padrão de presença da empresa. Só usar com `isPresencaEnabled()` (colunas da migration P1). */
import { supabase } from '../../lib/supabase';
import { logError } from '../../lib/logger';
import type { PresencePolicy } from '../../lib/presence';

export const DUAL_POLICY: PresencePolicy = { presence_mode: 'dual', site_id: null, qr_mode: 'rotating' };

export function toPolicy(row: Partial<PresencePolicy> | null | undefined): PresencePolicy {
    const qr = row?.presence_mode === 'qr_gps';
    return {
        presence_mode: qr ? 'qr_gps' : 'dual',
        site_id: qr ? row?.site_id ?? null : null,
        qr_mode: row?.qr_mode === 'static' ? 'static' : 'rotating',
    };
}

/** `null` = não deu para ler. O banco não aplica o padrão sozinho: quem cria o turno copia. */
export async function loadPresenceDefault(companyId: string): Promise<PresencePolicy | null> {
    const { data, error } = await supabase
        .from('companies').select('default_presence_mode, default_site_id, default_qr_mode')
        .eq('id', companyId).maybeSingle();
    if (error || !data) {
        if (error) logError('presenceDefaults.load', error);
        return null;
    }
    return toPolicy({
        presence_mode: data.default_presence_mode, site_id: data.default_site_id, qr_mode: data.default_qr_mode,
    });
}

export async function savePresenceDefault(companyId: string, policy: PresencePolicy): Promise<boolean> {
    const { data, error } = await supabase
        .from('companies')
        .update({
            default_presence_mode: policy.presence_mode,
            default_site_id: policy.site_id,
            default_qr_mode: policy.qr_mode,
        })
        .eq('id', companyId)
        .select('id');
    if (error || !data?.length) {
        logError('presenceDefaults.save', error ?? 'sem linha');
        return false;
    }
    return true;
}
