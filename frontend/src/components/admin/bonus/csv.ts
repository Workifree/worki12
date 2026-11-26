import type { PayoutItem } from './types';
import { isPayable } from './format';

// Célula segura: escapa aspas e neutraliza fórmula (=, +, -, @) ao abrir em planilha.
function cell(value: string): string {
    const safe = /^[=+\-@\t\r]/.test(value) ? `'${value}` : value;
    return `"${safe.replace(/"/g, '""')}"`;
}

const money = (cents: number): string => (cents / 100).toFixed(2).replace('.', ',');

export function payoutsToCsv(items: PayoutItem[]): string {
    const header = ['Operador', 'Empresa', 'Segunda', 'Valor (R$)', 'Chave PIX', 'Marcos'];
    // Pedido bloqueado ou antes do corte nunca vai para a planilha (a chave PIX não pode sair).
    const lines = items.filter(isPayable).map((p) => [
        p.operatorName,
        p.companyName,
        p.scheduledFor,
        money(p.amountCents),
        p.pixKey,
        p.milestones.map((m) => `${m.title} (${money(m.amountCents)})`).join(' | '),
    ]);
    return [header, ...lines].map((row) => row.map(cell).join(';')).join('\r\n');
}

export function downloadCsv(filename: string, csv: string): void {
    const url = URL.createObjectURL(new Blob([`\uFEFF${csv}`], { type: 'text/csv;charset=utf-8' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
}
