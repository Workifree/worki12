/**
 * Presença verificada (QR do local + GPS): tipos, textos e selo.
 * Contrato: `supabase/migrations/20261127000100`–`000300`. Quem decide é sempre o banco.
 * Os tipos moram aqui até serem movidos para `types/index.ts` (ver integracao.md).
 */

export type PresenceMode = 'dual' | 'qr_gps';
export type PresenceQrMode = 'rotating' | 'static';
export type PresenceKind = 'arrival' | 'departure';

export interface PresencePolicy {
    presence_mode: PresenceMode;
    site_id: string | null;
    qr_mode: PresenceQrMode;
}

export interface CompanySite {
    id: string;
    company_id: string;
    name: string;
    address_text: string | null;
    lat: number;
    lng: number;
    radius_m: number;
    archived_at: string | null;
}

export const EXCEPTION_REASONS = {
    sem_sinal_gps: 'Sem sinal de GPS',
    gps_negado: 'Localização não permitida no aparelho',
    qr_ilegivel: 'Não foi possível ler o QR',
    celular_sem_bateria: 'Celular sem bateria',
    local_mudou: 'O turno mudou de local',
    outro: 'Outro motivo',
} as const;
export type PresenceExceptionReason = keyof typeof EXCEPTION_REASONS;

export type PresenceResult =
    | 'verified' | 'manual_exception' | 'unverified' | 'exception_requested'
    | 'qr_invalid' | 'qr_expired' | 'gps_out_of_range' | 'gps_low_accuracy'
    | 'gps_unavailable' | 'outside_window' | 'invalid_input';

export interface PresenceCheck {
    id: string;
    application_id: string;
    job_id: string;
    worker_id: string;
    kind: PresenceKind;
    result: PresenceResult;
    distance_m: number | null;
    accuracy_m: number | null;
    reason: PresenceExceptionReason | null;
    decided_by: string | null;
    created_at: string;
}

export const MIN_RADIUS_M = 50;
export const MAX_RADIUS_M = 500;
export const DEFAULT_RADIUS_M = 150;
/** Precisão máxima aceita para marcar o ponto de um local ("Estou aqui agora"). */
export const SITE_CAPTURE_MAX_ACCURACY_M = 50;

export function kindLabel(kind: PresenceKind): string {
    return kind === 'arrival' ? 'chegada' : 'saída';
}

const MESSAGES: Record<string, string> = {
    verified: 'Presença verificada no local.',
    already_verified: 'Essa presença já está registrada.',
    already_registered: 'Esse horário já foi registrado.',
    qr_invalid: 'Esse não é o QR deste turno. Leia o código mostrado pelo responsável ou o cartaz do local.',
    qr_expired: 'O código venceu. Leia o QR que está na tela agora.',
    gps_out_of_range: 'Sua localização está fora da área do local do turno. Chegue mais perto e tente de novo.',
    gps_low_accuracy: 'O sinal de localização está impreciso. Vá para perto de uma janela ou área aberta e tente de novo.',
    gps_unavailable: 'Não conseguimos obter sua localização.',
    invalid_input: 'Não foi possível usar os dados lidos. Tente de novo.',
    outside_window: 'Ainda é cedo: dá para registrar a partir de 12 horas antes do início do turno.',
    too_many_attempts: 'Muitas tentativas seguidas. Aguarde alguns minutos ou peça a confirmação ao responsável.',
    not_owner: 'Este turno não é seu.',
    not_qr_gps: 'Este turno não usa QR e localização. Atualize a página.',
    invalid_status: 'Não dá para registrar presença neste turno agora. Atualize a página.',
    no_arrival: 'A chegada ainda não foi registrada.',
    forbidden: 'Você não tem permissão para isso neste turno.',
    static_mode: 'Este turno usa o QR impresso do local.',
    archived: 'Este local está arquivado.',
    requested: 'Pedido enviado. O responsável pode confirmar sua presença.',
    already_requested: 'Você já pediu há pouco. Fale com o responsável.',
    recorded: 'Presença confirmada manualmente.',
    registered: 'Saída registrada sem verificação.',
    unauthenticated: 'Sua sessão expirou. Entre novamente.',
};

export function presenceMessage(outcome: string): string {
    return MESSAGES[outcome] ?? 'Não foi possível concluir agora. Verifique a conexão e tente de novo.';
}

// ── Selo ────────────────────────────────────────────────────────────────────────────────────

export type PresenceSeal = 'verified' | 'manual' | 'unverified';

export interface PresenceSummary {
    seal: PresenceSeal;
    label: string;
}

type CheckLike = Pick<PresenceCheck, 'kind' | 'result' | 'reason'>;

/** Desfecho que vale para um momento: exceção/verificada têm precedência sobre "sem verificação". */
export function decidedCheck<T extends CheckLike>(checks: T[], kind: PresenceKind): T | null {
    const ofKind = checks.filter((c) => c.kind === kind);
    return ofKind.find((c) => c.result === 'verified' || c.result === 'manual_exception')
        ?? ofKind.find((c) => c.result === 'unverified')
        ?? null;
}

const reasonText = (c: CheckLike) => (c.reason ? EXCEPTION_REASONS[c.reason] : EXCEPTION_REASONS.outro);

/**
 * Selo do recibo e do pagamento (só para turno `qr_gps`). Informa, nunca bloqueia.
 * `departureDone` = a saída já foi registrada: sem registro de verificação, conta como não verificada.
 */
export function presenceSummary(checks: CheckLike[], departureDone = false): PresenceSummary {
    const arrival = decidedCheck(checks, 'arrival');
    const departure = decidedCheck(checks, 'departure');
    if (!arrival || arrival.result === 'unverified') return { seal: 'unverified', label: 'Presença não verificada' };

    const departureUnverified = departure ? departure.result === 'unverified' : departureDone;
    const manual = [arrival, departure].find((c) => c?.result === 'manual_exception');
    const base: PresenceSummary = manual
        ? { seal: 'manual', label: `Confirmada manualmente: ${reasonText(manual)}` }
        : { seal: 'verified', label: 'Presença verificada no local' };
    if (!departureUnverified) return base;
    return {
        seal: 'unverified',
        label: manual ? `${base.label} · saída não verificada` : 'Chegada verificada · saída não verificada',
    };
}

/** Pedidos de ajuda ainda sem decisão (um por candidatura e momento, o mais recente). */
export function pendingExceptionRequests<T extends PresenceCheck>(checks: T[]): T[] {
    const latest = new Map<string, T>();
    for (const c of checks) {
        if (c.result !== 'exception_requested') continue;
        const key = `${c.application_id}:${c.kind}`;
        const current = latest.get(key);
        if (!current || c.created_at > current.created_at) latest.set(key, c);
    }
    return [...latest.values()].filter(
        (r) => !decidedCheck(checks.filter((c) => c.application_id === r.application_id), r.kind),
    );
}
