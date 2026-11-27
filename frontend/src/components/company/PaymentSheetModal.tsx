/**
 * PaymentSheetModal — Planilha de pagamento (só Gestor). ADR-20261127.
 *
 * Usa os mesmos filtros do relatório. A tela mostra CPF e PIX MASCARADOS; o arquivo exportado leva
 * os dados completos (a RPC é Gestor-only e grava o log de geração). Tipo da chave PIX é inferido
 * e rotulado "provável".
 */

import { useEffect, useState } from 'react';
import { Download, FileSpreadsheet, Loader2 } from 'lucide-react';
import ModalShell from '../ModalShell';
import { Alert, Button } from '../ui';
import { useToast } from '../../contexts/ToastContext';
import { logError } from '../../lib/logger';
import { formatBRL } from '../../lib/currency';
import { downloadCsv } from '../../lib/csv';
import { formatDateOnly } from '../../lib/dateUtils';
import type { PaymentSheet } from '../../types';
import type { ReportFilters } from '../../services/orderReportService';
import {
  PaymentSheetService,
  maskCpf,
  maskPixKey,
  paymentSheetOutcomeMessage,
  pixTypeLabel,
  toPaymentSheetCSV,
} from '../../services/paymentSheetService';

interface PaymentSheetModalProps {
  filters: ReportFilters;
  /** O relatório tem um filtro de status ligado; a planilha não o aplica. */
  statusFilterIgnored?: boolean;
  onClose: () => void;
}

export default function PaymentSheetModal({ filters, statusFilterIgnored = false, onClose }: PaymentSheetModalProps) {
  const { addToast } = useToast();
  const { from, to, workerId, responsibleId, tagId } = filters;
  const [sheet, setSheet] = useState<PaymentSheet | null>(null);
  const [failed, setFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);

  const retry = () => {
    setFailed(false);
    setSheet(null);
    setAttempt((n) => n + 1);
  };

  useEffect(() => {
    let active = true;
    void (async () => {
      try {
        const result = await PaymentSheetService.getPaymentSheet({ from, to, workerId, responsibleId, tagId });
        if (active) setSheet(result);
      } catch (err) {
        logError('PaymentSheetModal.load', err);
        if (active) setFailed(true);
      }
    })();
    return () => { active = false; };
  }, [from, to, workerId, responsibleId, tagId, attempt]);

  const rows = sheet?.outcome === 'ok' ? sheet.rows : [];

  const handleExport = () => {
    if (rows.length === 0) return;
    downloadCsv(toPaymentSheetCSV(rows), `planilha-de-pagamento-${from}_a_${to}.csv`);
    addToast('Planilha baixada. Ela contém CPF e chave PIX: compartilhe só com quem vai pagar.', 'info');
  };

  return (
    <ModalShell labelledBy="payment-sheet-title" onClose={onClose}>
      <div className="flex items-start gap-3">
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border-2 border-black bg-blue-50">
          <FileSpreadsheet size={20} aria-hidden="true" />
        </div>
        <div>
          <h2 id="payment-sheet-title" className="text-xl font-bold">Planilha de pagamento</h2>
          <p className="mt-1 text-sm text-gray-700">
            Uma linha por freela com turno concluído no período. Use para pagar.
          </p>
          <p className="mt-1 text-sm font-semibold">
            Período: {formatDateOnly(from, 'dd/MM/yyyy')} a {formatDateOnly(to, 'dd/MM/yyyy')}
            {workerId || responsibleId || tagId ? ' · com filtros de freela, responsável ou loja do relatório' : ''}
          </p>
        </div>
      </div>

      <Alert tone="warning" className="mt-4">
        O arquivo contém dados pessoais (CPF e chave PIX). Compartilhe só com quem vai pagar. Esta extração fica registrada.
      </Alert>

      {statusFilterIgnored && (
        <p role="status" className="mt-3 text-sm text-gray-700">
          O filtro de status do relatório não vale aqui: a planilha lista só turnos concluídos.
        </p>
      )}

      <div className="mt-4">
        {!sheet && !failed && (
          <div className="flex items-center justify-center py-10" role="status">
            <span className="sr-only">Carregando</span>
            <Loader2 size={24} aria-hidden="true" className="animate-spin text-gray-600" />
          </div>
        )}
        {failed && (
          <div role="alert" className="flex flex-wrap items-center justify-between gap-3">
            <p className="text-sm font-semibold text-red-700">Não foi possível gerar a planilha.</p>
            <Button variant="secondary" onClick={retry}>Tentar de novo</Button>
          </div>
        )}
        {sheet && sheet.outcome !== 'ok' && (
          <p role="alert" className="text-sm font-semibold text-red-700">{paymentSheetOutcomeMessage(sheet.outcome)}</p>
        )}
        {sheet?.outcome === 'ok' && sheet.truncated && (
          <Alert tone="warning" className="mb-3" role="alert">
            Planilha cortada em 500 freelas. Reduza o período ou use os filtros para ver os demais.
          </Alert>
        )}
        {sheet?.outcome === 'ok' && rows.length === 0 && (
          <p className="text-sm text-gray-700">Nenhum turno concluído no período e filtros escolhidos.</p>
        )}
        {rows.length > 0 && (
          <div tabIndex={0} role="region" aria-label="Planilha de pagamento, role para o lado para ver todas as colunas" className="overflow-x-auto rounded-xl border-2 border-black focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-black">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b-2 border-black bg-gray-50 text-left text-xs text-gray-600">
                  <th className="px-3 py-2 font-semibold">Freela</th>
                  <th className="px-3 py-2 font-semibold">CPF</th>
                  <th className="px-3 py-2 font-semibold">Chave PIX</th>
                  <th className="px-3 py-2 font-semibold text-right">Turnos</th>
                  <th className="px-3 py-2 font-semibold text-right">Pago</th>
                  <th className="px-3 py-2 font-semibold text-right">A pagar</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.worker_id} className="border-b border-gray-200 last:border-0 align-top">
                    <td className="px-3 py-2 font-medium">{r.full_name ?? '—'}</td>
                    <td className="px-3 py-2 whitespace-nowrap tabular-nums">{maskCpf(r.cpf)}</td>
                    <td className="px-3 py-2 whitespace-nowrap">
                      <span className="tabular-nums">{maskPixKey(r.pix_key)}</span>
                      {r.pix_key && <span className="block text-xs text-gray-600">{pixTypeLabel(r.pix_key)}</span>}
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums">{r.shifts_count}</td>
                    <td className="px-3 py-2 text-right tabular-nums whitespace-nowrap">{formatBRL(r.total_paid)}</td>
                    <td className="px-3 py-2 text-right tabular-nums whitespace-nowrap">
                      {formatBRL(r.total_to_pay)}
                      {r.has_estimated_amount && <span className="block text-xs text-gray-600">estimado</span>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <div className="mt-5 flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">
        <Button variant="secondary" onClick={onClose}>Fechar</Button>
        <Button variant="dark" onClick={handleExport} disabled={rows.length === 0} iconLeft={<Download size={16} />}>
          Baixar planilha (CSV)
        </Button>
      </div>
    </ModalShell>
  );
}
