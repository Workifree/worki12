/**
 * CompanyOrdersReport — Relatório de Ordens da empresa.
 *
 * "Ordem" = par (turno, freela) — não mais "turno" sozinho (ver ADR-20260816-marcador-
 * pagamento-por-freela.md). Um turno com N freelas contratados pode virar até N ordens,
 * cada uma com seu próprio status (aberta/paga/conciliada): o freela com pagamento
 * registrado usa os dados da nota; o freela contratado mas ainda sem pagamento aparece
 * como 'aberta' (passivo em aberto), pra não sumir do relatório. "Nota"/comprovante =
 * pagamento (shift_payments). Ao registrar o pagamento a candidatura do freela já vira
 * 'completed' — esta página dá a visão consolidada + export pro financeiro/estoquista.
 *
 * Padrões: useState + useEffect, imports relativos, TS strict, design neo-brutalista empresa.
 */

import { useEffect, useState, useCallback } from 'react';
import { PainelNumerosTabs } from '../../components/company/PainelNumerosTabs';
import {
  FileText,
  Printer,
  Download,
  Calendar,
  Loader2,
  AlertTriangle,
} from 'lucide-react';
import { OrderReportService, toCSV } from '../../services/orderReportService';
import type { OrderReport, OrderRow, OrderStatus } from '../../services/orderReportService';
import { ORDER_STATUS_LABELS, PAYMENT_SOURCE_LABELS } from '../../services/orderReportService';
import { logError } from '../../lib/logger';
import { useToast } from '../../contexts/ToastContext';
import PageMeta from '../../components/PageMeta';

// ---------------------------------------------------------------------------
// Helpers de data/format
// ---------------------------------------------------------------------------

function toDateInput(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function startOfWeek(d: Date): Date {
  const day = d.getDay(); // 0 = domingo
  const diff = d.getDate() - day;
  return new Date(d.getFullYear(), d.getMonth(), diff);
}

function startOfMonth(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), 1);
}

function formatDDMMYYYY(value: string): string {
  const datePart = value.slice(0, 10);
  if (/^\d{4}-\d{2}-\d{2}$/.test(datePart)) {
    const [y, m, dd] = datePart.split('-').map(Number);
    const dt = new Date(y, m - 1, dd);
    return `${String(dt.getDate()).padStart(2, '0')}/${String(dt.getMonth() + 1).padStart(2, '0')}/${dt.getFullYear()}`;
  }
  const dt = new Date(value);
  return dt.toLocaleDateString('pt-BR');
}

function formatBRL(value: number): string {
  return value.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

type PresetKey = 'hoje' | 'semana' | 'mes' | 'custom';

const STATUS_OPTIONS: Array<{ key: OrderStatus | 'todas'; label: string }> = [
  { key: 'todas', label: 'Todas' },
  { key: 'aberta', label: 'Abertas' },
  { key: 'paga', label: 'Pagas' },
  { key: 'conciliada', label: 'Conciliadas' },
];

const STATUS_BADGE_CLASS: Record<OrderStatus, string> = {
  aberta: 'bg-yellow-100 text-yellow-700 border-yellow-300',
  paga: 'bg-blue-100 text-blue-700 border-blue-300',
  conciliada: 'bg-primary-light text-primary border-black',
};

// ---------------------------------------------------------------------------
// Página
// ---------------------------------------------------------------------------

export default function CompanyOrdersReport() {
  const { addToast } = useToast();

  const [preset, setPreset] = useState<PresetKey>('mes');
  const [from, setFrom] = useState<string>(toDateInput(startOfMonth(new Date())));
  const [to, setTo] = useState<string>(toDateInput(new Date()));
  const [statusFilter, setStatusFilter] = useState<OrderStatus | 'todas'>('todas');

  const [report, setReport] = useState<OrderReport | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchReport = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const result = await OrderReportService.getReport({ from, to, status: statusFilter });
      setReport(result);
    } catch (err) {
      logError('CompanyOrdersReport.fetchReport', err);
      setError('Não foi possível carregar o relatório.');
    } finally {
      setLoading(false);
    }
  }, [from, to, statusFilter]);

  useEffect(() => {
    fetchReport();
  }, [fetchReport]);

  function applyPreset(key: PresetKey) {
    const now = new Date();
    if (key === 'hoje') {
      const today = toDateInput(now);
      setFrom(today);
      setTo(today);
    } else if (key === 'semana') {
      setFrom(toDateInput(startOfWeek(now)));
      setTo(toDateInput(now));
    } else if (key === 'mes') {
      setFrom(toDateInput(startOfMonth(now)));
      setTo(toDateInput(now));
    }
    setPreset(key);
  }

  function handleCustomDateChange(which: 'from' | 'to', value: string) {
    setPreset('custom');
    if (which === 'from') setFrom(value);
    else setTo(value);
  }

  function handleExportCSV() {
    if (!report || report.rows.length === 0) {
      addToast('Nenhum pagamento para exportar.', 'info');
      return;
    }
    const csv = toCSV(report);
    // BOM UTF-8 para o Excel pt-BR reconhecer acentos corretamente.
    const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `relatorio-ordens-${from}_a_${to}.csv`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

  const rows: OrderRow[] = report?.rows ?? [];
  const summary = report?.summary;
  const periodLabel = `${formatDDMMYYYY(from)} a ${formatDDMMYYYY(to)}`;

  return (
    <div className="flex flex-col gap-8 pb-20 md:pb-12 font-sans text-accent max-w-5xl mx-auto print:pb-0">
      <PageMeta title="Relatório de Pagamentos" />

      {/* Header — some na impressão (cabeçalho de impressão próprio abaixo) */}
      <header className="print:hidden">
        <PainelNumerosTabs />
<h1 className="text-4xl font-black uppercase tracking-tighter mb-2 flex items-center gap-3">
          <FileText size={32} strokeWidth={3} /> Relatório de Pagamentos
        </h1>
        {/* Ha DOIS lugares com numeros e o usuario nao tem como adivinhar qual responde o que
            (cheiro de informacao). Uma linha diz o que ESTA pagina responde e aponta a outra. */}
        <p className="text-sm font-bold text-gray-500 mt-1">
          Quanto foi pago, a quem, quando — com exportação para o financeiro.
        </p>
        <p className="text-gray-500 text-sm">
          Visão consolidada dos turnos e seus pagamentos — um turno com mais de um freela
          vira uma ordem por freela — export pro financeiro/estoquista.
        </p>
      </header>

      {/* Cabeçalho de impressão — só aparece no print */}
      <div className="hidden print:block">
        <h1 className="text-2xl font-black uppercase">Relatório de Ordens</h1>
        <p className="text-sm font-bold">Período: {periodLabel}</p>
      </div>

      {/* Filtros + ações — não imprime */}
      <div className="bg-white border-2 border-black rounded-2xl p-6 shadow-[6px_6px_0px_0px_rgba(0,0,0,1)] print:hidden flex flex-col gap-5">
        {/* Presets */}
        <div className="flex flex-wrap gap-3">
          {(['hoje', 'semana', 'mes'] as PresetKey[]).map((key) => (
            <button
              key={key}
              onClick={() => applyPreset(key)}
              className={`min-h-11 px-5 py-2.5 rounded-xl border-2 font-black uppercase text-sm transition-all
                ${preset === key
                  ? 'bg-black text-white border-black shadow-[4px_4px_0px_0px_rgba(0,166,81,1)]'
                  : 'bg-white text-gray-500 border-black hover:bg-gray-100'
                }`}
            >
              {key === 'hoje' ? 'Hoje' : key === 'semana' ? 'Semana' : 'Mês'}
            </button>
          ))}
        </div>

        {/* Intervalo custom + status */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <div>
            <label htmlFor="fromInput" className="block text-xs font-black uppercase text-gray-500 mb-1">
              De
            </label>
            <div className="relative">
              <Calendar size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
              <input
                id="fromInput"
                type="date"
                value={from}
                max={to}
                onChange={(e) => handleCustomDateChange('from', e.target.value)}
                className="min-h-11 w-full pl-9 pr-3 py-2.5 border-2 border-black rounded-xl font-bold text-sm focus:outline-none focus:ring-2 focus:ring-primary"
              />
            </div>
          </div>
          <div>
            <label htmlFor="toInput" className="block text-xs font-black uppercase text-gray-500 mb-1">
              Até
            </label>
            <div className="relative">
              <Calendar size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
              <input
                id="toInput"
                type="date"
                value={to}
                min={from}
                onChange={(e) => handleCustomDateChange('to', e.target.value)}
                className="min-h-11 w-full pl-9 pr-3 py-2.5 border-2 border-black rounded-xl font-bold text-sm focus:outline-none focus:ring-2 focus:ring-primary"
              />
            </div>
          </div>
          <div>
            <label htmlFor="statusSelect" className="block text-xs font-black uppercase text-gray-500 mb-1">
              Status
            </label>
            <select
              id="statusSelect"
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value as OrderStatus | 'todas')}
              className="min-h-11 w-full px-3 py-2.5 border-2 border-black rounded-xl font-bold text-sm focus:outline-none focus:ring-2 focus:ring-primary bg-white"
            >
              {STATUS_OPTIONS.map((opt) => (
                <option key={opt.key} value={opt.key}>
                  {opt.label}
                </option>
              ))}
            </select>
          </div>
        </div>

        {/* Ações */}
        <div className="flex flex-wrap gap-3 border-t-2 border-black pt-5">
          <button
            onClick={handleExportCSV}
            disabled={loading || rows.length === 0}
            className="min-h-11 flex items-center gap-2 px-5 py-2.5 bg-black hover:bg-primary text-white rounded-xl font-black uppercase text-sm transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            <Download size={16} /> Exportar CSV
          </button>
          <button
            onClick={() => window.print()}
            disabled={loading || rows.length === 0}
            className="min-h-11 flex items-center gap-2 px-5 py-2.5 border-2 border-black rounded-xl font-black uppercase text-sm hover:bg-black hover:text-white transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            <Printer size={16} /> Imprimir / PDF
          </button>
        </div>
      </div>

      {/* Resumo */}
      {summary && (
        // `summary.total` conta ORDENS (pares turno+freela), não turnos distintos — um
        // turno com 2 freelas soma 2 aqui. Rótulo "Ordens" em vez de "Total" pra não
        // sugerir contagem de turnos (orderReportService.ts — JSDoc do topo).
        // Valor pago (realizado) e valor previsto (passivo em aberto, estimado) são
        // números de natureza diferente — nunca somados num "Valor Total" só, que
        // mentiria misturando dinheiro que já saiu com estimativa do que falta pagar.
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-6 gap-3 print:grid-cols-6">
          <SummaryCard label="Ordens" value={String(summary.total)} />
          <SummaryCard label="Abertas" value={String(summary.abertas)} className="text-yellow-700" />
          <SummaryCard label="Pagas" value={String(summary.pagas)} className="text-blue-700" />
          <SummaryCard label="Conciliadas" value={String(summary.conciliadas)} className="text-primary" />
          <SummaryCard label="Valor Pago" value={formatBRL(summary.valorPago)} />
          <SummaryCard label="Valor Previsto" value={formatBRL(summary.valorPrevisto)} className="text-yellow-700" />
        </div>
      )}

      {/* Conteúdo */}
      {loading ? (
        <div className="flex items-center justify-center py-16 print:hidden">
          <Loader2 size={28} className="animate-spin text-gray-400" />
        </div>
      ) : error ? (
        <div className="bg-red-50 border-2 border-red-200 rounded-2xl p-6 text-center print:hidden">
          <AlertTriangle size={28} className="mx-auto mb-2 text-red-500" />
          <p className="font-black text-red-600 uppercase text-sm">{error}</p>
          <button
            onClick={fetchReport}
            className="min-h-11 mt-3 px-6 py-2 rounded-xl border-2 border-black font-black uppercase text-sm hover:bg-black hover:text-white transition-colors"
          >
            Tentar novamente
          </button>
        </div>
      ) : rows.length === 0 ? (
        <div className="bg-white border-2 border-black rounded-2xl p-10 text-center shadow-[6px_6px_0px_0px_rgba(0,0,0,1)] print:shadow-none">
          <FileText size={40} className="mx-auto mb-4 text-gray-300" />
          <p className="font-black text-gray-500 uppercase text-sm">Nenhum pagamento no período.</p>
        </div>
      ) : (
        <>
          {/* Mobile: cards */}
          <div className="flex flex-col gap-3 md:hidden print:hidden">
            {rows.map((row) => (
              <OrderCard key={`${row.jobId}:${row.workerId ?? 'none'}`} row={row} />
            ))}
          </div>

          {/* Desktop / impressão: tabela */}
          <div className="hidden md:block print:block bg-white border-2 border-black rounded-2xl overflow-x-auto shadow-[6px_6px_0px_0px_rgba(0,0,0,1)] print:shadow-none">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b-2 border-black bg-gray-50 text-left">
                  <th className="px-4 py-3 font-black uppercase text-xs">Data</th>
                  <th className="px-4 py-3 font-black uppercase text-xs">Função</th>
                  <th className="px-4 py-3 font-black uppercase text-xs">Freela</th>
                  <th className="px-4 py-3 font-black uppercase text-xs text-right">Valor</th>
                  <th className="px-4 py-3 font-black uppercase text-xs">Forma</th>
                  <th className="px-4 py-3 font-black uppercase text-xs">Status</th>
                  <th className="px-4 py-3 font-black uppercase text-xs">Data Pgto</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr key={`${row.jobId}:${row.workerId ?? 'none'}`} className="border-b border-gray-200 last:border-0">
                    <td className="px-4 py-3 font-bold whitespace-nowrap">{row.date ? formatDDMMYYYY(row.date) : '—'}</td>
                    <td className="px-4 py-3 font-medium">{row.category ?? row.title}</td>
                    <td className="px-4 py-3 font-medium">{row.workerName ?? '—'}</td>
                    <td className="px-4 py-3 font-black tabular-nums text-right whitespace-nowrap">{formatBRL(row.amount)}</td>
                    <td className="px-4 py-3">{row.source ? PAYMENT_SOURCE_LABELS[row.source] ?? row.source : '—'}</td>
                    <td className="px-4 py-3">
                      <StatusBadge status={row.status} />
                    </td>
                    <td className="px-4 py-3 whitespace-nowrap">{row.paidAt ? formatDDMMYYYY(row.paidAt) : '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Subcomponentes
// ---------------------------------------------------------------------------

function SummaryCard({ label, value, className = '' }: { label: string; value: string; className?: string }) {
  return (
    <div className="bg-white border-2 border-black rounded-xl p-4 shadow-[4px_4px_0px_0px_rgba(0,0,0,1)] print:shadow-none">
      <p className="text-[10px] font-black uppercase text-gray-500 mb-1">{label}</p>
      <p className={`text-xl font-black tabular-nums truncate ${className}`}>{value}</p>
    </div>
  );
}

function StatusBadge({ status }: { status: OrderStatus }) {
  return (
    <span className={`text-[10px] font-black uppercase px-2 py-1 rounded-full border-2 ${STATUS_BADGE_CLASS[status]}`}>
      {ORDER_STATUS_LABELS[status]}
    </span>
  );
}

function OrderCard({ row }: { row: OrderRow }) {
  return (
    <div className="bg-white border-2 border-black rounded-xl p-4 shadow-[4px_4px_0px_0px_rgba(0,0,0,1)] flex flex-col gap-2">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="font-black text-sm truncate">{row.category ?? row.title}</p>
          <p className="text-xs text-gray-500">{row.date ? formatDDMMYYYY(row.date) : '—'}</p>
        </div>
        <StatusBadge status={row.status} />
      </div>
      <div className="flex items-center justify-between text-sm">
        <span className="font-medium text-gray-600 truncate">{row.workerName ?? '—'}</span>
        <span className="font-black tabular-nums">{formatBRL(row.amount)}</span>
      </div>
      <div className="flex items-center justify-between text-xs text-gray-400">
        <span>{row.source ? PAYMENT_SOURCE_LABELS[row.source] ?? row.source : '—'}</span>
        <span>{row.paidAt ? `Pago em ${formatDDMMYYYY(row.paidAt)}` : ''}</span>
      </div>
    </div>
  );
}
