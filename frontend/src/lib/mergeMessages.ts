interface ChatRow {
    id: string;
    createdat: string;
    content: string;
    read_at: string | null;
}

/**
 * Junta o histórico relido com o que já está na tela, por `id`: nada some (a mensagem recém-enviada
 * pode ainda não vir na leitura) e, sem novidade, devolve o MESMO array (não mexe na rolagem).
 */
export function mergeMessages<T extends ChatRow>(current: T[], incoming: T[]): T[] {
    const byId = new Map(current.map((m) => [m.id, m]));
    let changed = false;
    for (const message of incoming) {
        const known = byId.get(message.id);
        // `read_at` nunca volta a nulo (resposta atrasada).
        const next = known?.read_at && !message.read_at ? { ...message, read_at: known.read_at } : message;
        if (!known || known.read_at !== next.read_at || known.content !== next.content) {
            byId.set(message.id, next);
            changed = true;
        }
    }
    if (!changed) return current;
    return [...byId.values()].sort((a, b) => new Date(a.createdat).getTime() - new Date(b.createdat).getTime());
}
