export function formatCents(cents: number): string {
    return (cents / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

/** Falha fechada: só é pagável com `payable === true` explícito e sem bloqueio. */
export function isPayable(p: { payable: boolean; blocked: boolean }): boolean {
    return p.payable === true && p.blocked !== true;
}

export function blockReasonText(reason: string | null): string {
    if (reason === 'identity') return 'a conferência de identidade do operador não passou.';
    if (reason === 'pix_match') return 'há coincidência de chave PIX ou identidade com pessoa que não pode contar para este bônus.';
    if (reason === 'evaluation_failed') return 'a última avaliação falhou e os dados podem estar desatualizados.';
    return 'o pedido está bloqueado para conferência.';
}

export const PIX_MATCH_PROCEDURE: readonly string[] = [
    'Não existe liberação manual: o bloqueio só sai quando a coincidência deixa de existir.',
    'Abra a Conferência e veja se há turno reaberto com "Mesma chave PIX"; decida cada um.',
    'Se a chave PIX cadastrada está errada, a pessoa corrige a própria chave no app. Com pedido aberto, o operador precisa cancelar o pedido antes de trocar a chave dele.',
    'Se um veto foi incluído por engano, remova em "Vetos e limiares".',
    'Volte a esta tela: a avaliação roda de novo e o bloqueio some sozinho se não houver mais coincidência.',
];

export function payoutHoldMessage(p: { blocked: boolean; blockReason: string | null }): string {
    if (!p.blocked) return 'Ainda não pague: só depois de sexta 23:59 (até lá o operador pode cancelar o pedido).';
    return `NÃO PAGUE: ${blockReasonText(p.blockReason)}`;
}

export function formatDate(iso: string | null): string {
    if (!iso) return '-';
    const d = new Date(iso.length === 10 ? `${iso}T12:00:00` : iso);
    if (Number.isNaN(d.getTime())) return '-';
    return d.toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo' });
}

/** `emptyLabel`: "sem baseline" na coluna anterior ao programa (R30); "sem dado" nas demais. */
export function formatNumber(n: number | null, emptyLabel: 'sem dado' | 'sem baseline' = 'sem dado'): string {
    return n === null ? emptyLabel : n.toLocaleString('pt-BR', { maximumFractionDigits: 1 });
}

// Mesmos limites de PARAM_BOUNDS em supabase/functions/admin-data/bonus.ts (o servidor é quem manda).
export const PARAM_BOUNDS: Record<string, readonly [number, number]> = {
    validation_hours: [0, 168], review_hours: [1, 168], receipt_hours: [1, 168], receipt_grace_days: [0, 30],
    min_shift_minutes: [0, 1440], checkin_tolerance_min: [0, 720], checkout_tolerance_min: [0, 720],
    min_lead_minutes: [0, 10080], max_counted_per_day: [1, 50], max_counted_per_week: [1, 200],
    max_per_worker_week: [1, 2], burst_count: [2, 50], burst_window_hours: [1, 168],
    single_worker_pct: [1, 100], single_worker_min_shifts: [1, 100], stuck_minutes: [0, 240],
    pattern_count: [2, 50], max_gap_days: [1, 90], min_shifts_for_gap: [1, 100], briefing_min_chars: [0, 500],
    clock_tolerance_min: [1, 240], stuck_times_enabled: [0, 1],
};

export function paramError(key: string, value: number): string | null {
    const [min, max] = PARAM_BOUNDS[key] ?? [0, Number.MAX_SAFE_INTEGER];
    if (Number.isInteger(value) && value >= min && value <= max) return null;
    return `"${paramLabel(key)}" aceita um número inteiro de ${min} a ${max}.`;
}

const FLAG_LABELS: Record<string, string> = {
    burst: 'Rajada: vários turnos criados e concluídos em pouco tempo',
    single_worker: 'Quase todos os turnos com o mesmo freela',
    stuck_times: 'Entrada e saída registradas quase juntas',
    repeat_pattern: 'Mesmo horário e duração repetidos no mesmo freela',
    shared_pix: 'Mesma chave PIX em mais de um freela do operador',
    shared_phone: 'Mesmo telefone em mais de um freela do operador',
    voided_after: 'Recibo estornado depois do turno',
};

export function flagLabel(flag: string): string {
    return FLAG_LABELS[flag] ?? `Sinal: ${flag}`;
}

const PARAM_LABELS: Record<string, string> = {
    validation_hours: 'Janela de validação (horas)',
    review_hours: 'Prazo da conferência (horas)',
    min_shift_minutes: 'Duração mínima do turno (min)',
    checkin_tolerance_min: 'Tolerância de entrada (min)',
    checkout_tolerance_min: 'Tolerância de saída (min)',
    min_lead_minutes: 'Antecedência mínima do turno (min)',
    max_counted_per_day: 'Máximo de turnos contados por dia',
    max_counted_per_week: 'Máximo de turnos contados por semana',
    max_per_worker_week: 'Máximo por freela por semana (1 ou 2)',
    receipt_hours: 'Prazo do recibo (horas)',
    receipt_grace_days: 'Tolerância do recibo (dias)',
    max_gap_days: 'Lacuna máxima (dias)',
    min_shifts_for_gap: 'Mínimo de turnos para a lacuna',
    briefing_min_chars: 'Mínimo de caracteres do briefing',
    burst_count: 'Rajada: nº de turnos',
    burst_window_hours: 'Rajada: janela (horas)',
    single_worker_pct: 'Mesmo freela: % dos turnos',
    single_worker_min_shifts: 'Mesmo freela: mínimo de turnos',
    stuck_minutes: 'Registros colados: minutos',
    pattern_count: 'Padrão repetido: nº de turnos',
    clock_tolerance_min: 'Tolerância de relógio (min)',
    stuck_times_enabled: 'Sinal de registros colados (0 desliga, 1 liga)',
};

export function paramLabel(key: string): string {
    return PARAM_LABELS[key] ?? key;
}
