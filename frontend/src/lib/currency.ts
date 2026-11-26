/**
 * Formatadores canônicos de dinheiro e de horas trabalhadas.
 *
 * Dinheiro: "R$ 1.234,50" (milhar, vírgula, sempre 2 casas). Nunca `R$ {valor}` nem
 * `valor.toFixed(2).replace('.', ',')`.
 */
export function formatBRL(amount: number | null | undefined): string {
    const value = typeof amount === 'number' && Number.isFinite(amount) ? amount : 0;
    return value.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

/**
 * Horas decimais para "7h 30min", "8h", "45min", "1.250h". Dado ausente, zero ou abaixo de
 * 1 minuto NÃO vira "0h" nem "0min" (parece medida): devolve `fallback`.
 */
export function formatWorkedTime(hours: number | null | undefined, fallback = 'Sem registro'): string {
    if (typeof hours !== 'number' || !Number.isFinite(hours)) return fallback;
    const totalMinutes = Math.round(hours * 60);
    if (totalMinutes < 1) return fallback;
    const h = Math.floor(totalMinutes / 60);
    const m = totalMinutes % 60;
    if (h === 0) return `${m}min`;
    const wholeHours = `${h.toLocaleString('pt-BR')}h`;
    return m === 0 ? wholeHours : `${wholeHours} ${m}min`;
}

/**
 * Forma curta para faixa estreita: "R$ 2,3 mil", "R$ 1,2 mi". Só para EXIBIÇÃO quando a largura
 * não comporta o valor completo; o valor completo (`formatBRL`) deve ir em aria-label/title.
 */
export function formatBRLCompact(amount: number | null | undefined): string {
    const value = typeof amount === 'number' && Number.isFinite(amount) ? amount : 0;
    const abs = Math.abs(value);
    const fmt = (n: number) => n.toLocaleString('pt-BR', { maximumFractionDigits: 1 });
    if (abs >= 1_000_000) return `R$ ${fmt(value / 1_000_000)} mi`;
    if (abs >= 1_000) return `R$ ${fmt(value / 1_000)} mil`;
    return formatBRL(value);
}
