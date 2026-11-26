/**
 * Escolhe quais avisos NOVOS viram toast. A fonte é a própria tabela `notifications` (a mesma do
 * sino): nada é inventado no client, então o toast não cria um segundo aviso.
 */
export interface AlertRow {
    id: string;
    type: string;
    title: string;
    message: string;
    link?: string | null;
    read_at: string | null;
    created_at: string;
}

export interface AlertToast {
    message: string;
    type: 'success' | 'info';
}

const MAX_MESSAGE = 140;
const MAX_INDIVIDUAL = 2;

export function createAlertTracker() {
    let seen: Set<string> | null = null;
    let baselineAt = '';

    return {
        /**
         * `rows`: as mais recentes primeiro. A primeira chamada é só a linha de base (o que já
         * existia não vira toast). `skip` silencia o que a pessoa já está vendo na tela.
         */
        collect(rows: AlertRow[], skip: (row: AlertRow) => boolean = () => false): AlertToast[] {
            if (!seen) {
                seen = new Set(rows.map((r) => r.id));
                baselineAt = rows.reduce((max, r) => (r.created_at > max ? r.created_at : max), '');
                return [];
            }
            const known = seen;
            // `>` pela hora do SERVIDOR: linha antiga que reaparece na janela (outra foi apagada) não é novidade.
            const fresh = rows.filter((r) => !known.has(r.id) && r.created_at > baselineAt);
            for (const r of rows) known.add(r.id);
            const shown = fresh.filter((r) => !r.read_at && !skip(r)).reverse();
            if (shown.length === 0) return [];
            const toToast = (r: AlertRow): AlertToast => ({
                message: r.message && r.message.length <= MAX_MESSAGE ? r.message : r.title,
                type: / aceitou /.test(` ${r.title} `) ? 'success' : 'info',
            });
            if (shown.length <= MAX_INDIVIDUAL) return shown.map(toToast);
            return [
                toToast(shown[shown.length - 1]),
                { message: `Mais ${shown.length - 1} avisos novos no sino.`, type: 'info' },
            ];
        },
    };
}
