/**
 * O que cada tela escuta (tabelas publicadas em 20261202000100). A RLS é quem limita o que chega;
 * o filtro só reduz ruído. `jobs` NÃO é publicada: criação/edição/cancelamento chegam por
 * `job_live_signals` (sem conteúdo — recarregue pela consulta normal).
 */
import type { LiveSource } from './liveHub';

/** DELETE não aceita filtro: sem esta origem, remover alguém do elenco não chegaria. */
const elencoRemovido: LiveSource = { table: 'team_connections', event: 'DELETE' };

/** Telas da empresa que olham vários turnos (painel, lista, "Hoje"). */
export function companyShiftSources(companyId: string): LiveSource[] {
    const own = `company_id=eq.${companyId}`;
    return [
        { table: 'job_live_signals', filter: own },
        { table: 'applications' }, // sem company_id: a RLS entrega só os turnos que a pessoa opera
        { table: 'shift_calls', filter: own },
        { table: 'shift_call_targets' },
        { table: 'shift_payments', filter: own },
        { table: 'shift_attendance_confirmations' },
    ];
}

/** Um turno específico (presença e pagamento, detalhe). */
export function jobSources(jobId: string): LiveSource[] {
    const own = `job_id=eq.${jobId}`;
    return [
        { table: 'job_live_signals', filter: own },
        { table: 'applications', filter: own },
        { table: 'shift_calls', filter: own },
        { table: 'shift_call_targets' }, // não tem job_id
        { table: 'shift_payments', filter: own },
        { table: 'shift_attendance_confirmations', filter: own },
    ];
}

export function companyTeamSources(companyId: string): LiveSource[] {
    return [{ table: 'team_connections', filter: `company_id=eq.${companyId}` }, elencoRemovido];
}

/** Telas do freela. */
export function workerShiftSources(userId: string): LiveSource[] {
    const own = `worker_id=eq.${userId}`;
    return [
        { table: 'applications', filter: own },
        { table: 'shift_call_targets', filter: own },
        { table: 'job_live_signals' }, // a RLS entrega só turnos em que a pessoa está
        { table: 'shift_payments', filter: own },
        { table: 'shift_attendance_confirmations', filter: own },
    ];
}

export function workerTeamSources(userId: string): LiveSource[] {
    return [{ table: 'team_connections', filter: `worker_id=eq.${userId}` }, elencoRemovido];
}

export function notificationSources(userId: string): LiveSource[] {
    return [{ table: 'notifications', filter: `user_id=eq.${userId}` }];
}

/** Lista de conversas (a conversa aberta já tem canal próprio nas telas de mensagens). */
export function conversationListSources(): LiveSource[] {
    return [{ table: 'Message' }, { table: 'Conversation' }];
}
