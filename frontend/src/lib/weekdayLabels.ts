/**
 * Rótulos de dia da semana para textos de recorrência, com concordância correta.
 *
 * Duas telas montavam isso na mão com `toda ${dia}` fixo, e o portugues nao coopera: **domingo** e
 * **sábado** sao masculinos ("todo domingo", "todo sábado"), os outros cinco sao femininos
 * ("toda segunda"). A agenda exibia "SÉRIE · TODA SÁBADO".
 *
 * Para mais de um dia, o artigo singular fica estranho de qualquer jeito ("toda sexta e sábado"),
 * entao a forma plural resolve gênero e leitura de uma vez: "às sextas e sábados".
 *
 * Índice 0 = domingo … 6 = sábado — mesma convenção de `getDay()` e de `job_series.weekdays`.
 */
export const WEEKDAY_FULL_LABELS = [
    'domingo', 'segunda', 'terça', 'quarta', 'quinta', 'sexta', 'sábado',
] as const;

const PLURAIS = [
    'domingos', 'segundas', 'terças', 'quartas', 'quintas', 'sextas', 'sábados',
] as const;

/** Masculinos: domingo (0) e sábado (6). */
function artigo(dia: number): 'todo' | 'toda' {
    return dia === 0 || dia === 6 ? 'todo' : 'toda';
}

/** Um dia só: "todo sábado", "toda sexta". */
export function rotuloDeUmDia(dia: number): string {
    return `${artigo(dia)} ${WEEKDAY_FULL_LABELS[dia] ?? ''}`.trim();
}

/**
 * Lista de dias: "toda sexta" (um), "às sextas e sábados" (vários).
 * Ordena por dia da semana para o texto nao depender da ordem de clique.
 */
export function rotuloDeDias(dias: number[]): string {
    const ordenados = [...new Set(dias)].sort((a, b) => a - b);
    if (ordenados.length === 0) return '';
    if (ordenados.length === 1) return rotuloDeUmDia(ordenados[0]);
    const nomes = ordenados.map((d) => PLURAIS[d] ?? '').filter(Boolean);
    return `às ${nomes.slice(0, -1).join(', ')} e ${nomes[nomes.length - 1]}`;
}
