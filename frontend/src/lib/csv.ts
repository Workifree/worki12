/**
 * Utilitários de CSV para Excel pt-BR: UTF-8 com BOM, delimitador `;`, decimal com vírgula.
 * Campos de texto livre (nomes, etiquetas, títulos) recebem proteção contra injeção de fórmula.
 */

export const CSV_BOM = '﻿';

/** Campo de TEXTO que começa com = + - @ ou tab/CR vira texto literal (apóstrofo na frente). */
export function csvSafeText(value: string | null | undefined): string {
  const s = value ?? '';
  return /^[=+\-@\t\r]/.test(s) ? `'${s}` : s;
}

/** Aspas quando o campo tem `;`, aspas ou quebra de linha. */
export function csvQuote(field: string): string {
  return /[;"\n\r]/.test(field) ? `"${field.replace(/"/g, '""')}"` : field;
}

/** Número com vírgula decimal e 2 casas; `null`/inválido = vazio (nunca "0"). */
export function csvDecimal(value: number | null | undefined): string {
  return typeof value === 'number' && Number.isFinite(value) ? value.toFixed(2).replace('.', ',') : '';
}

export function csvLine(cells: string[]): string {
  return cells.map(csvQuote).join(';');
}

/** Monta o arquivo: BOM + linhas separadas por CRLF. */
export function csvFile(lines: string[]): string {
  return CSV_BOM + lines.join('\r\n');
}

export function downloadCsv(content: string, filename: string): void {
  const blob = new Blob([content], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
