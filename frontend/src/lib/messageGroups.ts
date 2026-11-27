/**
 * Mensagens da empresa (ADR-20261127): o modelo é uma conversa por candidatura (freela x turno),
 * mas a lista mostra UMA linha por freela. Aqui só apresentação, nada de regra de acesso.
 */

export interface GroupableConversation {
    id: string;
    /** Freela da conversa; sem ele, a conversa fica sozinha na própria linha. */
    worker_id: string | null;
    unread_count: number;
    last_message_at?: string;
    no_messages?: boolean;
}

export interface WorkerThreadGroup<T extends GroupableConversation> {
    key: string;
    /** Da mais recente para a mais antiga. */
    conversations: T[];
    /** Conversa que representa o freela na lista (a de atividade mais recente com mensagem). */
    latest: T;
    unread_count: number;
    no_messages: boolean;
}

const time = (iso?: string): number => (iso ? new Date(iso).getTime() : 0);

/** Conversa vazia de candidatura cancelada ou turno apagado é ruído; com mensagem, é histórico. */
export function isHiddenEmptyConversation(input: {
    applicationStatus: string;
    jobStatus?: string | null;
    hasMessages: boolean;
    /** Só some quando a ausência de mensagem está provada (consulta de prévias completa). */
    previewsComplete: boolean;
}): boolean {
    if (input.hasMessages || !input.previewsComplete) return false;
    return input.applicationStatus === 'cancelled' || input.jobStatus === 'deleted';
}

/** Não lidas primeiro; depois a atividade mais recente. */
export function groupByWorker<T extends GroupableConversation>(conversations: T[]): Array<WorkerThreadGroup<T>> {
    const byKey = new Map<string, T[]>();
    for (const conv of conversations) {
        const key = conv.worker_id ?? `conv:${conv.id}`;
        const list = byKey.get(key);
        if (list) list.push(conv);
        else byKey.set(key, [conv]);
    }

    const groups = [...byKey.entries()].map(([key, list]): WorkerThreadGroup<T> => {
        const sorted = [...list].sort((a, b) => time(b.last_message_at) - time(a.last_message_at));
        return {
            key,
            conversations: sorted,
            latest: sorted.find((c) => !c.no_messages) ?? sorted[0],
            unread_count: sorted.reduce((sum, c) => sum + c.unread_count, 0),
            no_messages: sorted.every((c) => c.no_messages),
        };
    });

    return groups.sort((a, b) =>
        Number(b.unread_count > 0) - Number(a.unread_count > 0)
        || time(b.latest.last_message_at) - time(a.latest.last_message_at));
}
