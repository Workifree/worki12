/**
 * PaymentRecordService — marcador de pagamento externo por turno (modo A do ADR).
 *
 * ADR: .harness/memory-bank/decisions/ADR-20260630-pagamento-opcional-piloto.md
 * Migration: supabase/migrations/20260630000000_shift_payments.sql
 * Plano: .harness/spec/v1-operacao-freelancer/plan-modo-a.md (§HALT RESOLVIDO)
 *
 * FRONTEIRA CRÍTICA (Article 8/9/10) — este service é REGISTRO/AUDITORIA, NÃO liquidação:
 *  - NÃO chama nenhuma RPC de saldo (reserve/release/refund/authorize/capture).
 *  - NÃO toca `wallets` nem `escrow_transactions`.
 *  - NÃO usa service_role — todo INSERT/UPDATE é do papel `authenticated` sob RLS.
 *
 * Decisões do HALT (2026-06-30, owner) refletidas aqui:
 *  1. Empresa registra + freela confirma (bilateral ATIVO) → confirmReceiptByWorker.
 *  2. Registrar EXIGE turno concluído — guarda dura fica na UI; este service valida
 *     defensivamente o SINAL REAL de conclusão (company_checkin_confirmed_at E
 *     company_checkout_confirmed_at preenchidos) antes do INSERT — não o `status`
 *     de `applications`, que só é setado 'completed' DEPOIS que este INSERT tem
 *     sucesso (evita dead-end: status='completed' sem registro se o INSERT falhar).
 *  3. 1 registro 'recorded' por turno — violação do UNIQUE parcial (Postgres 23505)
 *     é tratada como `alreadyRecorded: true`, nunca propagada como crash.
 *  4. Fontes: external_pix | cash | other.
 *
 * Padrões do projeto:
 *  - Fetch/mutate: supabase.from direto (Art. 5 — sem React Query).
 *  - Tipos à mão em types/index.ts (Art. 2).
 *  - Imports relativos (sem alias @/).
 *  - logError (nunca console.log).
 */

import { supabase } from '../lib/supabase';
import { logError } from '../lib/logger';
import type { ShiftPayment, PaymentSource } from '../types';

// ---------------------------------------------------------------------------
// Tipos de parâmetros e resultado
// ---------------------------------------------------------------------------

export interface RecordExternalPaymentParams {
  jobId: string;
  workerId: string;
  /**
   * Link ao ciclo específico (evidência de que o turno é o mesmo confirmado).
   * A coluna é nullable no schema (ON DELETE SET NULL — preserva o recibo se a
   * application for removida), mas o INSERT sempre parte de uma application
   * concreta neste fluxo (confirmação de conclusão), então é exigido aqui para
   * viabilizar a validação defensiva de "turno concluído".
   */
  applicationId: string;
  source: PaymentSource;
  /** Valor declarado pago (BRL). Deve ser > 0 (também reforçado por CHECK no DB). */
  amount: number;
  /** Quando o pagamento aconteceu (declarado). Default: agora. */
  paidAt?: string | Date;
  note?: string;
}

export interface RecordExternalPaymentResult {
  success: boolean;
  payment?: ShiftPayment;
  /** true quando já existe um registro 'recorded' ativo para este job_id (UNIQUE parcial, 23505). */
  alreadyRecorded?: boolean;
  error?: string;
}

export interface ConfirmReceiptResult {
  success: boolean;
  error?: string;
}

export interface VoidPaymentResult {
  success: boolean;
  error?: string;
}

export interface ShiftPaymentReceipt {
  payment: ShiftPayment;
  job: {
    id: string;
    title: string;
    location: string;
    start_date: string;
    work_start_time?: string | null;
    work_end_time?: string | null;
  } | null;
  company: {
    id: string;
    name: string;
    logo_url?: string | null;
  } | null;
  worker: {
    id: string;
    full_name: string;
    avatar_url?: string | null;
    photo_url?: string | null;
  } | null;
}

// ---------------------------------------------------------------------------
// Helpers internos
// ---------------------------------------------------------------------------

/** Obtém o company_id da sessão autenticada (empresa). Espelha shiftInviteService. */
async function getAuthCompanyId(): Promise<string> {
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) throw new Error('Sessão expirada. Faça login novamente.');

  const { data: company, error } = await supabase
    .from('companies')
    .select('id')
    .eq('owner_id', user.id)
    .maybeSingle();

  if (error) throw error;
  if (!company) throw new Error('Perfil de empresa não encontrado.');

  return company.id as string;
}

/** Normaliza paidAt (string | Date | undefined) para ISO string. Default: agora. */
function normalizePaidAt(paidAt?: string | Date): string {
  if (!paidAt) return new Date().toISOString();
  return typeof paidAt === 'string' ? paidAt : paidAt.toISOString();
}

// ---------------------------------------------------------------------------
// PaymentRecordService (exportado)
// ---------------------------------------------------------------------------

export const PaymentRecordService = {
  /**
   * Registra que o pagamento de um turno foi feito FORA do Worki (PIX/dinheiro/outro).
   * NÃO move saldo, NÃO chama RPC, NÃO toca wallets/escrow_transactions.
   *
   * Validação defensiva (decisão do HALT #4 — "exige turno concluído"): a guarda dura
   * de habilitar/desabilitar o botão é responsabilidade da UI, mas este service confere
   * novamente antes do INSERT que a application referenciada pertence ao job/worker
   * informados e tem `company_checkin_confirmed_at` E `company_checkout_confirmed_at`
   * preenchidos (o sinal real de "turno concluído") — evita registro sem lastro de
   * trabalho mesmo se a UI for contornada. Deliberadamente NÃO depende de
   * `application.status === 'completed'`: esse status só é setado pela UI DEPOIS que
   * este método retorna sucesso, para nunca deixar uma application 'completed' sem
   * registro correspondente caso o INSERT falhe.
   *
   * Idempotência (decisão do HALT #5 — "1 registro por turno"): o UNIQUE parcial
   * `(job_id) WHERE status='recorded'` no DB rejeita um segundo registro ativo para o
   * mesmo turno com erro Postgres 23505 — tratado aqui como `alreadyRecorded: true`,
   * nunca propagado como exceção.
   */
  async recordExternalPayment(
    params: RecordExternalPaymentParams,
  ): Promise<RecordExternalPaymentResult> {
    try {
      const { jobId, workerId, applicationId, source, amount, paidAt, note } = params;

      if (!(amount > 0)) {
        return { success: false, error: 'O valor pago deve ser maior que zero.' };
      }

      // 1. Validação defensiva: turno concluído (HALT #4) — sinal REAL, não o status.
      const { data: application, error: appErr } = await supabase
        .from('applications')
        .select('id, job_id, worker_id, company_checkin_confirmed_at, company_checkout_confirmed_at')
        .eq('id', applicationId)
        .maybeSingle();

      if (appErr) {
        logError('paymentRecord.recordExternalPayment.checkApplication', appErr);
        return { success: false, error: 'Erro ao verificar o turno.' };
      }
      if (!application) {
        return { success: false, error: 'Candidatura/turno não encontrado.' };
      }
      if (application.job_id !== jobId || application.worker_id !== workerId) {
        return {
          success: false,
          error: 'A candidatura informada não corresponde ao turno/freela informado.',
        };
      }
      if (!application.company_checkin_confirmed_at || !application.company_checkout_confirmed_at) {
        return {
          success: false,
          error: 'O turno precisa estar concluído (chegada e saída confirmadas) antes de registrar o pagamento.',
        };
      }

      // 2. Resolver a empresa dona (RLS exige company_id = empresa do auth.uid()).
      const companyId = await getAuthCompanyId();

      // 3. INSERT — recorded_by é preenchido pelo DEFAULT auth.uid() no schema.
      const { data: payment, error: insertErr } = await supabase
        .from('shift_payments')
        .insert({
          job_id: jobId,
          company_id: companyId,
          worker_id: workerId,
          application_id: applicationId,
          source,
          amount,
          paid_at: normalizePaidAt(paidAt),
          note: note ?? null,
        })
        .select()
        .single();

      if (insertErr) {
        if (insertErr.code === '23505') {
          return { success: false, alreadyRecorded: true };
        }
        logError('paymentRecord.recordExternalPayment.insert', insertErr);
        return { success: false, error: 'Não foi possível registrar o pagamento.' };
      }

      return { success: true, payment: payment as ShiftPayment };
    } catch (err) {
      logError('paymentRecord.recordExternalPayment', err);
      return { success: false, error: err instanceof Error ? err.message : 'Erro inesperado.' };
    }
  },

  /**
   * Busca o registro 'recorded' (ativo) de um turno, se existir.
   * Usado pela UI para decidir entre mostrar "Registrar pagamento" ou "Ver recibo".
   */
  async getPaymentByJob(jobId: string): Promise<ShiftPayment | null> {
    try {
      const { data, error } = await supabase
        .from('shift_payments')
        .select('*')
        .eq('job_id', jobId)
        .eq('status', 'recorded')
        .maybeSingle();

      if (error) {
        logError('paymentRecord.getPaymentByJob', error);
        return null;
      }
      return (data as ShiftPayment) ?? null;
    } catch (err) {
      logError('paymentRecord.getPaymentByJob', err);
      return null;
    }
  },

  /**
   * Busca o marcador ativo do turno + dados leves para renderizar o recibo
   * (empresa, freela, turno). Só-leitura sob RLS — quem não é parte (nem empresa
   * dona nem freela pago) recebe null.
   */
  async getReceipt(jobId: string): Promise<ShiftPaymentReceipt | null> {
    try {
      const { data, error } = await supabase
        .from('shift_payments')
        .select(
          `
          *,
          job:jobs ( id, title, location, start_date, work_start_time, work_end_time ),
          company:companies ( id, name, logo_url ),
          worker:workers ( id, full_name, avatar_url, photo_url )
        `,
        )
        .eq('job_id', jobId)
        .eq('status', 'recorded')
        .maybeSingle();

      if (error) {
        logError('paymentRecord.getReceipt', error);
        return null;
      }
      if (!data) return null;

      const { job, company, worker, ...paymentFields } = data as ShiftPayment & {
        job: ShiftPaymentReceipt['job'];
        company: ShiftPaymentReceipt['company'];
        worker: ShiftPaymentReceipt['worker'];
      };

      return {
        payment: paymentFields as ShiftPayment,
        job: job ?? null,
        company: company ?? null,
        worker: worker ?? null,
      };
    } catch (err) {
      logError('paymentRecord.getReceipt', err);
      return null;
    }
  },

  /**
   * Freela confirma o recebimento do pagamento declarado (bilateral ATIVO — HALT #2).
   * One-way: só permite NULL → timestamp (o trigger `enforce_shift_payment_immutability`
   * rejeita qualquer tentativa de alterar depois de confirmado). NÃO bloqueia ciclo/avaliação.
   */
  async confirmReceiptByWorker(paymentId: string): Promise<ConfirmReceiptResult> {
    try {
      const { error } = await supabase
        .from('shift_payments')
        .update({ worker_confirmed_at: new Date().toISOString() })
        .eq('id', paymentId);

      if (error) {
        logError('paymentRecord.confirmReceiptByWorker', error);
        return { success: false, error: 'Não foi possível confirmar o recebimento.' };
      }
      return { success: true };
    } catch (err) {
      logError('paymentRecord.confirmReceiptByWorker', err);
      return { success: false, error: err instanceof Error ? err.message : 'Erro inesperado.' };
    }
  },

  /**
   * Estorno lógico de um registro ativo (só a empresa dona — RLS `sp_update_company`).
   * NUNCA faz UPDATE destrutivo do valor/fonte/data — só marca status='voided'.
   * Libera o `job_id` para um novo registro 'recorded' (UNIQUE é parcial).
   */
  async voidPayment(paymentId: string, reason: string): Promise<VoidPaymentResult> {
    try {
      const { error } = await supabase
        .from('shift_payments')
        .update({
          status: 'voided',
          voided_at: new Date().toISOString(),
          void_reason: reason,
        })
        .eq('id', paymentId);

      if (error) {
        logError('paymentRecord.voidPayment', error);
        return { success: false, error: 'Não foi possível estornar o registro.' };
      }
      return { success: true };
    } catch (err) {
      logError('paymentRecord.voidPayment', err);
      return { success: false, error: err instanceof Error ? err.message : 'Erro inesperado.' };
    }
  },
};
