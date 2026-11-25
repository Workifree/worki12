import { supabase } from './supabase';

/** Conversa do turno (por `application`): reaproveita a existente ou cria. Lança em falha. */
export async function openShiftConversation(applicationId: string): Promise<string> {
    const { data: existing } = await supabase
        .from('Conversation')
        .select('id')
        .eq('application_uuid', applicationId)
        .limit(1);
    if (existing && existing.length > 0) return existing[0].id as string;

    const id = crypto.randomUUID();
    const { error } = await supabase
        .from('Conversation')
        .insert({ id, application_uuid: applicationId, islocked: false });
    if (error) throw error;
    return id;
}

/** Estado de navegação lido por `/messages`: preenche o campo, nunca envia. */
export interface MessagesLocationState {
    draft?: string;
}
