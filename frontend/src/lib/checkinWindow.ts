/**
 * Janela de "Registrar chegada" do freela.
 *
 * Regra de produto: de 2h antes do início até 2h depois do fim; sem término, até 12h após o início.
 * É um subconjunto do que o banco aceita (`applications_update_guard`, migration 20261125000200:
 * a partir de 12h antes do início, sem limite superior), então a tela nunca oferece o que ele recusa.
 *
 * O início é a data do turno em America/Sao_Paulo + `work_start_time`, como no banco. São Paulo é
 * UTC-3 (sem horário de verão). Sem horário de início válido o dia inteiro conta (00:00 até 24:00).
 */
const ZONE = 'America/Sao_Paulo';
const SP_OFFSET_HOURS = 3;
const HOUR = 3_600_000;
const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d/;

export interface ShiftSchedule {
    startDate: string | null | undefined;
    startTime: string | null | undefined;
    endTime: string | null | undefined;
}

export type CheckinWindowState = 'before' | 'open' | 'closed' | 'no_date';

export interface CheckinWindow {
    state: CheckinWindowState;
    opensAt: Date | null;
    closesAt: Date | null;
    /** Dias civis (`YYYY-MM-DD`, São Paulo) em que o turno começa e termina. */
    startDay: string | null;
    endDay: string | null;
}

export function saoPauloDay(date: Date): string {
    return new Intl.DateTimeFormat('en-CA', { timeZone: ZONE }).format(date);
}

function jobDay(startDate: string | null | undefined): string | null {
    if (!startDate) return null;
    if (/^\d{4}-\d{2}-\d{2}$/.test(startDate)) return startDate;
    const parsed = new Date(startDate);
    return Number.isNaN(parsed.getTime()) ? null : saoPauloDay(parsed);
}

/** Instante de um horário de parede de São Paulo. */
function atSaoPaulo(day: string, time: string): Date {
    const [y, m, d] = day.split('-').map(Number);
    const [h, min] = time.split(':').map(Number);
    return new Date(Date.UTC(y, m - 1, d, h + SP_OFFSET_HOURS, min));
}

export function checkinWindow({ startDate, startTime, endTime }: ShiftSchedule, now: Date = new Date()): CheckinWindow {
    const startDay = jobDay(startDate);
    if (!startDay) return { state: 'no_date', opensAt: null, closesAt: null, startDay: null, endDay: null };

    const hasStart = TIME_RE.test(startTime ?? '');
    const start = atSaoPaulo(startDay, hasStart ? (startTime as string).slice(0, 5) : '00:00');

    let end: Date | null = null;
    if (TIME_RE.test(endTime ?? '')) {
        end = atSaoPaulo(startDay, (endTime as string).slice(0, 5));
        // Fim menor ou igual ao início: o turno vira a noite.
        if (end.getTime() <= start.getTime()) end = new Date(end.getTime() + 24 * HOUR);
    }

    const opensAt = new Date(start.getTime() - 2 * HOUR);
    const closesAt = end
        ? new Date(end.getTime() + 2 * HOUR)
        : new Date(start.getTime() + (hasStart ? 12 : 26) * HOUR);

    const t = now.getTime();
    const state: CheckinWindowState = t < opensAt.getTime() ? 'before' : t > closesAt.getTime() ? 'closed' : 'open';
    return { state, opensAt, closesAt, startDay, endDay: end ? saoPauloDay(end) : startDay };
}

export function formatWindowMoment(date: Date): string {
    const day = new Intl.DateTimeFormat('pt-BR', { timeZone: ZONE, day: '2-digit', month: '2-digit' }).format(date);
    const hour = new Intl.DateTimeFormat('pt-BR', { timeZone: ZONE, hour: '2-digit', minute: '2-digit' }).format(date);
    return `${day} às ${hour}`;
}

/** Quando o botão libera ou por que não libera, em uma frase. */
export function checkinWindowMessage(window: CheckinWindow): string {
    switch (window.state) {
        case 'before':
            return `Chegada liberada a partir de ${formatWindowMoment(window.opensAt!)}.`;
        case 'open':
            return `Você pode registrar até ${formatWindowMoment(window.closesAt!)}.`;
        case 'closed':
            return `O prazo para registrar a chegada terminou em ${formatWindowMoment(window.closesAt!)}. Fale com a empresa: ela pode registrar sua presença.`;
        default:
            return 'Este turno está sem data. Fale com a empresa para ela informar.';
    }
}

interface TodayCandidate extends ShiftSchedule {
    status: string;
    worker_checkin_at: string | null;
    worker_checkout_at: string | null;
    company_checkin_confirmed_at: string | null;
    company_checkout_confirmed_at: string | null;
}

/** Entra no cartão "Hoje": turno em curso, janela aberta ou turno que começa ou termina hoje. */
export function isTodayShift(shift: TodayCandidate, now: Date = new Date()): boolean {
    if (shift.status !== 'hired' && shift.status !== 'in_progress') return false;
    if (shift.worker_checkout_at || shift.company_checkout_confirmed_at) return false;
    if (shift.worker_checkin_at || shift.company_checkin_confirmed_at) return true;
    const window = checkinWindow(shift, now);
    if (window.state === 'no_date') return false;
    const today = saoPauloDay(now);
    return window.state === 'open' || (today >= window.startDay! && today <= window.endDay!);
}

/**
 * Traduz a recusa do guard de `applications` em frase clara. Devolve `null` para qualquer outro
 * erro. O texto cru do banco nunca chega à tela.
 */
export function attendanceGuardMessage(error: unknown, schedule?: ShiftSchedule): string | null {
    const raw = (error as { message?: unknown } | null)?.message;
    if (typeof raw !== 'string' || !raw.includes('applications_update_guard')) return null;
    if (raw.includes('este turno foi cancelado')) return 'Este turno foi cancelado.';
    if (raw.includes('horario de presenca no futuro')) return 'O horário não pode ser no futuro.';
    if (raw.includes('ainda nao e possivel registrar a chegada')) {
        const opensAt = schedule ? checkinWindow(schedule).opensAt : null;
        return opensAt
            ? `Só dá para registrar a chegada a partir de ${formatWindowMoment(opensAt)}.`
            : 'Ainda não dá para registrar a chegada neste turno.';
    }
    if (raw.includes('registro de presenca ja gravado')) return 'Essa presença já foi registrada. Atualize a página.';
    return 'Não foi possível fazer isso agora. Atualize a página e tente novamente.';
}
