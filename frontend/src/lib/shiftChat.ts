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

/** Aviso quando o banco recusa criar a conversa de um turno que a pessoa não opera (ADR-20261127). */
export const CHAT_DENIED_MESSAGE =
    'Este turno não está sob sua responsabilidade, então você não pode iniciar a conversa. Peça ao Gestor.';

/** A RLS negou (42501 / "row-level security"): não é falha de rede, é falta de vínculo com o turno. */
export function isChatDeniedByRls(error: unknown): boolean {
    if (!error || typeof error !== 'object') return false;
    const { code, message } = error as { code?: string; message?: string };
    return code === '42501' || /row-level security/i.test(message ?? '');
}

/** Estado de navegação lido por `/messages`: preenche o campo, nunca envia. */
export interface MessagesLocationState {
    draft?: string;
}
