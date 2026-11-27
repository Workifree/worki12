/**
 * PaymentSheetService — Planilha de pagamento (uma linha por freela com turnos concluídos).
 *
 * Contrato: ADR-20261127-relatorio-financeiro-e-planilha-de-pagamento (seções 5, 6 e 7).
 * RPC `get_payment_sheet` (SECURITY DEFINER, GESTOR-ONLY, VOLATILE: grava log de geração sem CPF/PIX).
 * É a ÚNICA saída com CPF e PIX completos. A tela mostra mascarado (`maskCpf`/`maskPixKey`); só o
 * arquivo exportado leva inteiro. O mascaramento é UX — a fronteira de segurança é o Gestor-only.
 * O tipo da chave PIX é INFERIDO (não existe coluna) e sempre rotulado "provável".
 *
 * Não move saldo (modo A, Article 8 intacto).
 */

import { supabase } from '../lib/supabase';
import { logError } from '../lib/logger';
import { getSessionUserOrThrow } from '../lib/authSession';
import { getAuthenticatedCompanyId } from './companyScopeService';
import { validateCPF, validateCNPJ } from '../lib/validation';
import type { PixKeyType } from '../lib/validation';
import { csvDecimal, csvFile, csvKeepDigitsAsText, csvLine, csvSafeText } from '../lib/csv';
import type { PaymentSheet, PaymentSheetOutcome, PaymentSheetRow } from '../types';
import type { ReportFilters } from './orderReportService';

// ---------------------------------------------------------------------------
// Máscaras e inferência (puras)
// ---------------------------------------------------------------------------

/** CPF mascarado `***.456.789-**`. Fora do formato de 11 dígitos, esconde tudo menos o fim. */
export function maskCpf(cpf: string | null | undefined): string {
  if (!cpf) return '—';
  const d = cpf.replace(/\D/g, '');
  if (d.length !== 11) return `•••${d.slice(-2)}`;
  return `***.${d.slice(3, 6)}.${d.slice(6, 9)}-**`;
}

/**
 * Chave PIX mascarada pelo tipo inferido, para não somar com o CPF mascarado ao lado (a chave
 * costuma SER o CPF): CPF/CNPJ não mostram dígito algum, só "CPF (provável)"; telefone, só os 2
 * últimos; e-mail, a inicial e o domínio; aleatória, os 4 primeiros.
 */
export function maskPixKey(pix: string | null | undefined): string {
  if (!pix) return '—';
  const v = pix.trim();
  switch (inferPixKeyType(v)) {
    case 'cpf': return 'CPF (provável)';
    case 'cnpj': return 'CNPJ (provável)';
    case 'telefone': return `••••${v.replace(/\D/g, '').slice(-2)}`;
    case 'email': {
      const [user, domain] = v.split('@');
      return `${user.slice(0, 1)}•••@${domain}`;
    }
    case 'aleatoria': return `${v.slice(0, 4)}••••`;
    default: return v.length <= 6 ? '••••' : `••••${v.slice(-2)}`;
  }
}

const UUID_RE = /^[0-9a-f]{8}-?[0-9a-f]{4}-?[0-9a-f]{4}-?[0-9a-f]{4}-?[0-9a-f]{12}$/i;

/**
 * Infere o tipo da chave PIX pelo valor. É PALPITE: telefone × CPF têm ambos 11 dígitos (CPF só
 * quando o dígito verificador fecha). Devolve null quando não reconhece.
 */
export function inferPixKeyType(value: string | null | undefined): PixKeyType | null {
  const v = (value ?? '').trim();
  if (!v) return null;
  if (v.includes('@')) return 'email';
  if (UUID_RE.test(v)) return 'aleatoria';
  if (!/^[+\d\s()./-]+$/.test(v)) return null;
  const digits = v.replace(/\D/g, '');
  if (v.startsWith('+')) return 'telefone';
  if (digits.length === 14 && validateCNPJ(digits)) return 'cnpj';
  if (digits.length === 11) return validateCPF(digits) ? 'cpf' : 'telefone';
  if (digits.length === 10 || ((digits.length === 12 || digits.length === 13) && digits.startsWith('55'))) return 'telefone';
  return null;
}

export const PIX_TYPE_LABELS: Record<PixKeyType, string> = {
  cpf: 'CPF',
  cnpj: 'CNPJ',
  email: 'E-mail',
  telefone: 'Telefone',
  aleatoria: 'Aleatória',
};

/** "CPF (provável)" ou "não identificado". */
export function pixTypeLabel(pix: string | null | undefined): string {
  const t = inferPixKeyType(pix);
  return t ? `${PIX_TYPE_LABELS[t]} (provável)` : 'Não identificado';
}

// ---------------------------------------------------------------------------
// Leitura
// ---------------------------------------------------------------------------

const num = (v: unknown): number => {
  const n = typeof v === 'number' ? v : Number(v);
  return Number.isFinite(n) ? n : 0;
};

export const PaymentSheetService = {
  /** Gestor-only no banco. `outcome` diferente de 'ok' volta como dado; falha de rede/RPC lança. */
  async getPaymentSheet(params: ReportFilters): Promise<PaymentSheet> {
    try {
      const user = await getSessionUserOrThrow();
      if (!user) return { outcome: 'unauthenticated', truncated: false, rows: [], generated_at: null, log_id: null };
      const companyId = await getAuthenticatedCompanyId();

      const { data, error } = await supabase.rpc('get_payment_sheet', {
        p_company_id: companyId,
        p_from: params.from,
        p_to: params.to,
        p_worker_id: params.workerId || null,
        p_responsible_id: params.responsibleId || null,
        p_tag_id: params.tagId || null,
      });
      if (error) throw error;

      const payload = (data ?? {}) as Partial<PaymentSheet>;
      return {
        outcome: (payload.outcome ?? 'ok') as PaymentSheetOutcome,
        truncated: payload.truncated === true,
        rows: (payload.rows ?? []).map((r: PaymentSheetRow) => ({
          ...r,
          cpf: r.cpf ?? null,
          pix_key: r.pix_key ?? null,
          shifts_count: num(r.shifts_count),
          hours_total: num(r.hours_total),
          hours_missing_count: num(r.hours_missing_count),
          total_paid: num(r.total_paid),
          total_to_pay: num(r.total_to_pay),
          has_estimated_amount: r.has_estimated_amount === true,
          tags: r.tags ?? [],
          payment_ids: r.payment_ids ?? [],
        })),
        generated_at: payload.generated_at ?? null,
        log_id: payload.log_id ?? null,
      };
    } catch (err) {
      logError('paymentSheet.getPaymentSheet', err);
      throw err;
    }
  },
};

export function paymentSheetOutcomeMessage(outcome: PaymentSheetOutcome): string {
  switch (outcome) {
    case 'forbidden':
      return 'A planilha de pagamento é só para o Gestor.';
    case 'range_too_large':
      return 'Período grande demais. Escolha no máximo 92 dias.';
    case 'invalid_range':
      return 'Confira as datas escolhidas.';
    default:
      return 'Não foi possível gerar a planilha.';
  }
}

// ---------------------------------------------------------------------------
// CSV — CPF/PIX COMPLETOS (só o arquivo exportado)
// ---------------------------------------------------------------------------

export const PAYMENT_SHEET_CSV_HEADER = [
  'Freela', 'CPF', 'Chave PIX', 'Tipo da chave (provável)', 'Turnos concluídos', 'Horas',
  'Turnos sem check-in/out', 'Total pago', 'A pagar', 'A pagar inclui valor estimado', 'Lojas', 'IDs dos pagamentos',
];

export function toPaymentSheetCSV(rows: PaymentSheetRow[]): string {
  const lines = [csvLine(PAYMENT_SHEET_CSV_HEADER)];
  for (const r of rows) {
    lines.push(
      csvLine([
        csvSafeText(r.full_name),
        csvKeepDigitsAsText(r.cpf),
        csvKeepDigitsAsText(r.pix_key),
        r.pix_key ? pixTypeLabel(r.pix_key) : '',
        String(r.shifts_count),
        csvDecimal(r.hours_total),
        String(r.hours_missing_count),
        csvDecimal(r.total_paid),
        csvDecimal(r.total_to_pay),
        r.has_estimated_amount ? 'Sim' : 'Não',
        csvSafeText(r.tags.join(', ')),
        r.payment_ids.join(', '),
      ]),
    );
  }
  return csvFile(lines);
}
