// ---------------------------------------------------------------------------
// Helpers de data em horário LOCAL (nunca `toISOString()`/UTC) — várias telas
// de empresa precisavam da data de "hoje" como string `YYYY-MM-DD` para
// comparar com inputs de data (`<input type="date">`) e para filtrar turnos
// futuros/passados.
// ---------------------------------------------------------------------------

/**
 * Data de hoje em horário LOCAL, no formato `YYYY-MM-DD`.
 *
 * Evita off-by-one de fuso: `new Date().toISOString()` usa UTC, o que faz a
 * data "andar" perto da meia-noite em BRT (UTC-3). Entre ~21h e 23:59 local,
 * o UTC já virou o dia seguinte — isso fazia o turno de hoje sumir do picker
 * de data mínima e a data de pagamento defaultar para amanhã. Usar os
 * componentes locais (`getFullYear`/`getMonth`/`getDate`) evita o bug.
 */
export function todayLocalDate(): string {
    const d = new Date();
    const yyyy = d.getFullYear();
    const mm = String(d.getMonth() + 1).padStart(2, '0');
    const dd = String(d.getDate()).padStart(2, '0');
    return `${yyyy}-${mm}-${dd}`;
}
