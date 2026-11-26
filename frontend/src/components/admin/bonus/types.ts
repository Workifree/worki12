// Contrato da UI admin da Trilha de bônus (spec trilha-bonus-operador: AF6, R26-R30).
// Valores monetários SEMPRE em centavos. Nada de "saldo"/"carteira": é bônus pago por fora.

export type ReviewDecision = 'approve' | 'not_count';

export interface ReviewItem {
    ledgerId: string;
    operatorName: string;
    companyName: string;
    jobTitle: string;
    workerName: string;
    /** Códigos internos de AF4 (burst, single_worker, stuck_times, repeat_pattern, shared_pix, shared_phone, voided_after). */
    flags: string[];
    valueAtStakeCents: number;
    flaggedAt: string;
    reviewDueAt: string | null;
}

export interface PayoutMilestone {
    title: string;
    amountCents: number;
}

export interface PayoutItem {
    payoutId: string;
    operatorName: string;
    companyName: string;
    amountCents: number;
    pixKey: string;
    scheduledFor: string;
    /** Revalidação de identidade/PIX falhou: NÃO pagar. */
    blocked: boolean;
    blockReason: 'identity' | 'pix_match' | string | null;
    /** false antes do corte (o operador ainda pode cancelar) ou quando bloqueado. */
    payable: boolean;
    milestones: PayoutMilestone[];
}

export interface VetoItem {
    personId: string;
    personName: string;
    reason: string;
    createdAt: string;
}

export type TrackParamValue = number | string | boolean | null;

export interface TrackConfig {
    trackKey: string;
    name: string;
    status: 'calibrating' | 'open' | 'closed' | string;
    capCents: number;
    params: Record<string, TrackParamValue>;
}

export interface HabitRow {
    operatorName: string;
    baselineWeeklyAvg: number | null;
    avgWeeks1to12: number | null;
    avgWeeks13to16: number | null;
}

export interface TrackingSummary {
    activeOperators: number;
    maxExposureCents: number;
    earnedCents: number;
    availableCents: number;
    paidCents: number;
    milestonesByWeek: { weekStart: string; count: number }[];
    habit: HabitRow[];
    /** false quando a leitura admin_bonus_habit_overview ainda não existe/falhou. */
    habitAvailable: boolean;
}

export type EnrollmentStatus = 'invited' | 'active' | 'ended' | 'cancelled';

export interface EnrollmentItem {
    enrollmentId: string;
    trackKey: string;
    displayName: string;
    companyName: string;
    status: EnrollmentStatus;
    companyAckAt: string | null;
    companyAckByLabel: string | null;
    acceptedAt: string | null;
    endsAt: string | null;
    payoutBlockReason: 'identity' | 'pix_match' | string | null;
    /** A última avaliação desta inscrição falhou: não pagar. */
    evaluationFailed: boolean;
}

export interface BonusAlert {
    id: string;
    at: string;
    kind: 'payability' | 'voided_late';
    operatorName: string;
    /** Só em `payability`: motivo do bloqueio novo; null = bloqueio removido. */
    blockReason: string | null;
}

export interface BonusAlerts {
    items: BonusAlert[];
    evaluationFailed: string[];
}

export interface NewEnrollment {
    trackKey: 'eventos' | 'lojas';
    operatorUserId: string;
    companyId: string;
    displayName: string;
}

export interface ParamsHistoryEntry {
    id: string;
    at: string;
    actorLabel: string;
    summary: string;
}

/** Adaptador injetável: em produção chama `admin-data`; nos testes é um mock. */
export interface BonusAdminAdapter {
    getReviewQueue(): Promise<ReviewItem[]>;
    decideReview(ledgerId: string, decision: ReviewDecision): Promise<void>;
    getPayouts(): Promise<PayoutItem[]>;
    markPayoutPaid(payoutId: string, note?: string): Promise<void>;
    getVetos(): Promise<VetoItem[]>;
    addVeto(personId: string, reason: string): Promise<void>;
    removeVeto(personId: string): Promise<void>;
    getTracks(): Promise<TrackConfig[]>;
    updateTrackParams(trackKey: string, params: Record<string, number>): Promise<void>;
    updateTrackStatus(trackKey: string, status: 'calibrating' | 'open' | 'closed'): Promise<void>;
    getTracking(): Promise<TrackingSummary>;
    getParamsHistory(): Promise<ParamsHistoryEntry[]>;
    getEnrollments(): Promise<EnrollmentItem[]>;
    getAlerts(): Promise<BonusAlerts>;
    createEnrollment(input: NewEnrollment): Promise<void>;
    registerCompanyAck(enrollmentId: string, byLabel: string, note: string): Promise<void>;
    cancelEnrollment(enrollmentId: string): Promise<void>;
    /** Interruptor do programa: no esquema real é GLOBAL (bonus_program_settings.enabled), não por trilha. */
    getProgramEnabled(): Promise<boolean>;
    setProgramEnabled(enabled: boolean): Promise<void>;
}
