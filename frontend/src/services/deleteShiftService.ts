/**
 * "Excluir turno" passa pela RPC `cancel_job`: ela encerra convites, candidaturas e chamados na
 * mesma transação (sem isso o freela com convite pendente seguia vendo "Aceitar").
 *
 * `refund_escrow` só é chamado quando existe escrow RESERVADO: a RPC recusa com `active_escrow` e
 * só então devolvemos o saldo. No banco, a recusa por presença vem DEPOIS da de escrow, por isso a
 * presença é conferida antes do estorno (não devolver saldo de um turno que não será excluído).
 */
import { supabase } from '../lib/supabase';
import { logError } from '../lib/logger';
import { cancelJob, type CancelJobResult } from './shiftOperationService';
import { WalletService } from './walletService';

const REFUND_REASON = 'Dinheiro retornado do escrow - turno deletado';

async function checkRefund(jobId: string): Promise<'refund' | 'attendance' | 'no'> {
  const { data: apps, error: appsError } = await supabase
    .from('applications')
    .select('status, worker_checkin_at, company_checkin_confirmed_at, company_checkout_confirmed_at')
    .eq('job_id', jobId)
    .in('status', ['hired', 'in_progress', 'completed']);
  if (appsError) throw appsError;
  const started = (apps ?? []).some(
    (a) => a.status !== 'hired' || a.worker_checkin_at || a.company_checkin_confirmed_at || a.company_checkout_confirmed_at,
  );
  if (started) return 'attendance';

  const { data: escrows, error } = await supabase
    .from('escrow_transactions')
    .select('status')
    .eq('job_id', jobId)
    .in('status', ['reserved', 'authorized', 'captured']);
  if (error) throw error;
  // Hold de cartão (authorized/captured) não é "reservado": não é este fluxo que o devolve.
  const rows = escrows ?? [];
  return rows.length > 0 && rows.every((e) => e.status === 'reserved') ? 'refund' : 'no';
}

export async function deleteShift(jobId: string): Promise<CancelJobResult> {
  const result = await cancelJob(jobId);
  if (result.outcome !== 'active_escrow') return result;
  try {
    const verdict = await checkRefund(jobId);
    if (verdict === 'attendance') return { ...result, outcome: 'attendance_started' };
    if (verdict === 'no') return result;
    const refund = await WalletService.refundEscrow(jobId, REFUND_REASON);
    if (!refund.success) return result;
    return await cancelJob(jobId);
  } catch (error) {
    logError('deleteShift', error);
    return { ...result, outcome: 'error' };
  }
}
