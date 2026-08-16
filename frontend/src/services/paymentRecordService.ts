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
 * NOTIFICAÇÃO AO FREELA (migrations 20260816140000 e 20260816150000) — NÃO fazer
 * aqui: agendar/registrar/efetivar/estornar um `shift_payment` já dispara a
 * notificação correspondente ("pagamento agendado", "registrado", "efetivado",
 * "estornado") via trigger `SECURITY DEFINER` no banco, no INSERT/UPDATE de
 * `shift_payments`. Este service NUNCA deve dar `INSERT` em `notifications` — faria
 * o freela receber o mesmo aviso em duplicidade. Se um método deste arquivo parece
 * "não notificar ninguém", a notificação não está faltando: ela é responsabilidade
 * do trigger, não do client.
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

/**
 * ADR-20260712 — Pagamento agendado. `scheduleExternalPayment` registra a PROMESSA
 * (`status='scheduled'`, `scheduled_for`), sem `paid_at`. NÃO move saldo, NÃO chama RPC.
 */
export interface ScheduleExternalPaymentParams {
  jobId: string;
  workerId: string;
  applicationId: string;
  source: PaymentSource;
  /** Valor previsto a pagar (BRL). Deve ser > 0 (também reforçado por CHECK no DB). */
  amount: number;
  /** Data PREVISTA do pagamento (promessa), formato YYYY-MM-DD. */
  scheduledFor: string;
  note?: string;
}

export interface ScheduleExternalPaymentResult {
  success: boolean;
  payment?: ShiftPayment;
  /** true quando já existe um marcador ATIVO (scheduled ou recorded) para este job_id (UNIQUE parcial, 23505). */
  alreadyActive?: boolean;
  error?: string;
}

export interface EffectivateScheduledPaymentResult {
  success: boolean;
  payment?: ShiftPayment;
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

/**
 * Item de listagem para "Meus Recebimentos" (worker) — mesmo shape leve de
 * `ShiftPaymentReceipt`, mas nomeado à parte porque é usado numa LISTA (não um
 * recibo único) e não carrega `worker` (a tela já sabe quem é o próprio usuário).
 */
export interface WorkerShiftPaymentListItem {
  payment: ShiftPayment;
  job: {
    id: string;
    title: string;
    location: string;
    start_date: string;
  } | null;
  company: {
    id: string;
    name: string;
    logo_url?: string | null;
  } | null;
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

/** Projeção reutilizada pelas três consultas de `getReceipt` (ADR-20260816). */
const RECEIPT_SELECT = `
  *,
  job:jobs ( id, title, location, start_date, work_start_time, work_end_time ),
  company:companies ( id, name, logo_url ),
  worker:workers ( id, full_name, avatar_url )
`;

/** Achata a linha (com joins) de `shift_payments` no shape de `ShiftPaymentReceipt`. */
function mapReceiptRow(data: unknown): ShiftPaymentReceipt | null {
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
   * `(job_id, worker_id) WHERE status IN ('scheduled','recorded')` (migration
   * `20260816220000` — ADR-20260816-marcador-pagamento-por-freela) no DB rejeita um
   * segundo registro ativo para o mesmo (turno, freela) com erro Postgres 23505 —
   * tratado aqui como `alreadyRecorded: true`, nunca propagado como exceção.
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
   * Agenda a PROMESSA de pagamento de um turno (ADR-20260712) — status='scheduled',
   * `scheduled_for` preenchido, `paid_at` NULL (ainda não pagou). NÃO move saldo, NÃO
   * chama RPC, NÃO toca wallets/escrow_transactions (mesma fronteira do modo A).
   *
   * Reutiliza a MESMA validação defensiva de "turno concluído" de `recordExternalPayment`
   * (chegada e saída confirmadas pela empresa) — a promessa também exige lastro de trabalho.
   *
   * Idempotência: o UNIQUE parcial `(job_id, worker_id) WHERE status IN ('scheduled','recorded')`
   * (migration `20260816220000` — ADR-20260816-marcador-pagamento-por-freela) rejeita um segundo
   * marcador ATIVO para o mesmo (turno, freela) (Postgres 23505) — tratado como `alreadyActive: true`.
   */
  async scheduleExternalPayment(
    params: ScheduleExternalPaymentParams,
  ): Promise<ScheduleExternalPaymentResult> {
    try {
      const { jobId, workerId, applicationId, source, amount, scheduledFor, note } = params;

      if (!(amount > 0)) {
        return { success: false, error: 'O valor previsto deve ser maior que zero.' };
      }
      if (!scheduledFor) {
        return { success: false, error: 'Informe a data prevista do pagamento.' };
      }

      // 1. Validação defensiva: turno concluído (mesmo sinal REAL de recordExternalPayment).
      const { data: application, error: appErr } = await supabase
        .from('applications')
        .select('id, job_id, worker_id, company_checkin_confirmed_at, company_checkout_confirmed_at')
        .eq('id', applicationId)
        .maybeSingle();

      if (appErr) {
        logError('paymentRecord.scheduleExternalPayment.checkApplication', appErr);
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
          error: 'O turno precisa estar concluído (chegada e saída confirmadas) antes de agendar o pagamento.',
        };
      }

      // 2. Resolver a empresa dona (RLS exige company_id = empresa do auth.uid()).
      const companyId = await getAuthCompanyId();

      // 3. INSERT — nasce 'scheduled': sem paid_at, sem confirmação, sem void.
      const { data: payment, error: insertErr } = await supabase
        .from('shift_payments')
        .insert({
          job_id: jobId,
          company_id: companyId,
          worker_id: workerId,
          application_id: applicationId,
          source,
          amount,
          status: 'scheduled',
          scheduled_for: scheduledFor,
          paid_at: null,
          note: note ?? null,
        })
        .select()
        .single();

      if (insertErr) {
        if (insertErr.code === '23505') {
          return { success: false, alreadyActive: true };
        }
        logError('paymentRecord.scheduleExternalPayment.insert', insertErr);
        return { success: false, error: 'Não foi possível agendar o pagamento.' };
      }

      return { success: true, payment: payment as ShiftPayment };
    } catch (err) {
      logError('paymentRecord.scheduleExternalPayment', err);
      return { success: false, error: err instanceof Error ? err.message : 'Erro inesperado.' };
    }
  },

  /**
   * Efetiva uma promessa (`scheduled` → `recorded`), gravando a data REAL do pagamento em
   * `paid_at` (uma única vez — o trigger `enforce_shift_payment_immutability` congela depois).
   * Só a empresa dona pode efetivar (RLS `sp_update_company` + trigger). NÃO altera nenhuma
   * outra coluna material (job_id, amount, source, scheduled_for, ...) — o trigger bloqueia.
   */
  async effectivateScheduledPayment(
    paymentId: string,
    paidAt?: string | Date,
  ): Promise<EffectivateScheduledPaymentResult> {
    try {
      const { data: payment, error } = await supabase
        .from('shift_payments')
        .update({
          status: 'recorded',
          paid_at: normalizePaidAt(paidAt),
        })
        .eq('id', paymentId)
        .select()
        .single();

      if (error) {
        logError('paymentRecord.effectivateScheduledPayment', error);
        return { success: false, error: 'Não foi possível marcar o pagamento como efetivado.' };
      }
      return { success: true, payment: payment as ShiftPayment };
    } catch (err) {
      logError('paymentRecord.effectivateScheduledPayment', err);
      return { success: false, error: err instanceof Error ? err.message : 'Erro inesperado.' };
    }
  },

  /**
   * Busca o marcador ATIVO ('scheduled' ou 'recorded') de um (turno, freela), se existir.
   *
   * ADR-20260816 — `workerId` é OBRIGATÓRIO (não opcional): filtrar por `(job_id, worker_id)`
   * garante no máximo 1 linha em QUALQUER estado do banco — hoje, sob o UNIQUE parcial
   * `(job_id)`, um turno já tem no máximo 1 linha ativa no total (que bate ou não com o
   * worker pedido); depois da migration `20260816220000` (UNIQUE `(job_id, worker_id)`),
   * pode haver 1 linha ativa POR freela. Sem o filtro de worker o `.maybeSingle()` abaixo
   * viraria PGRST116 (erro) assim que dois freelas do mesmo turno tivessem marcador ativo —
   * exatamente o beco que o ADR corrige. Uso pontual (ex.: validação defensiva de um freela
   * específico); a tela da empresa usa `listActivePaymentsByJob` para ver TODOS os freelas.
   */
  async getPaymentByJob(jobId: string, workerId: string): Promise<ShiftPayment | null> {
    // G3: guarda de id falsy — evita GET shift_payments?job_id=eq.null (400).
    if (!jobId || !workerId) return null;
    try {
      const { data, error } = await supabase
        .from('shift_payments')
        .select('*')
        .eq('job_id', jobId)
        .eq('worker_id', workerId)
        .in('status', ['scheduled', 'recorded'])
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
   * Lista TODOS os marcadores ATIVOS ('scheduled' ou 'recorded') de um turno — um por freela
   * quando o turno tem mais de um contratado (ADR-20260816). Mais antigo primeiro.
   *
   * Usada pela tela da empresa (`CompanyJobCandidates`) para montar o mapa
   * `paymentByWorker: Record<worker_id, ShiftPayment>` — cada card do freela olha só a
   * própria entrada, nunca a de outro. Compatível com o banco ATUAL (no máximo 1 linha,
   * mesmo comportamento de antes) e com o FUTURO (0..N linhas, uma por freela) sem
   * nenhuma outra mudança de chamador.
   */
  async listActivePaymentsByJob(jobId: string): Promise<ShiftPayment[]> {
    // G3: guarda de id falsy — evita GET shift_payments?job_id=eq.null (400).
    if (!jobId) return [];
    try {
      const { data, error } = await supabase
        .from('shift_payments')
        .select('*')
        .eq('job_id', jobId)
        .in('status', ['scheduled', 'recorded'])
        .order('created_at', { ascending: true });

      if (error) {
        logError('paymentRecord.listActivePaymentsByJob', error);
        return [];
      }
      return (data as ShiftPayment[]) ?? [];
    } catch (err) {
      logError('paymentRecord.listActivePaymentsByJob', err);
      return [];
    }
  },

  /**
   * Busca o marcador ativo de um turno + dados leves para renderizar o recibo (empresa,
   * freela, turno). Só-leitura sob RLS — quem não é parte (nem empresa dona nem freela
   * pago) recebe null. `/recibo/:jobId` não muda de contrato (link já persistido em
   * notificações — ver ADR-20260816); a desambiguação entre freelas do mesmo turno é feita
   * AQUI, pelo espectador, não na rota.
   *
   * `workerId` é filtro de EXIBIÇÃO, NUNCA autorização — quem autoriza é a RLS
   * (`sp_select_participants`). Passar um `worker_id` alheio (de outro freela, ou de um
   * turno onde o usuário não é parte) não vaza nada: a policy não devolve a linha, e este
   * método retorna null exatamente como se o registro não existisse.
   *
   * Resolução (ADR-20260816):
   *  1. `workerId` explícito (`?worker=` — a empresa sempre chega aqui a partir do card de
   *     UM freela específico): filtra por ele.
   *  2. Sem `workerId`: tenta resolver como o PRÓPRIO freela (`worker_id = auth.uid()`) —
   *     cobre o link enviado por notificação ao freela, que nunca leva o parâmetro.
   *  3. Ainda sem resultado (o usuário não é o freela de nenhum marcador ativo deste turno —
   *     tipicamente a empresa acessando um link antigo, sem `?worker=`): cai para o marcador
   *     ativo mais antigo que a RLS deixar essa sessão enxergar, de forma determinística.
   */
  async getReceipt(jobId: string, workerId?: string): Promise<ShiftPaymentReceipt | null> {
    // G3: guarda de id falsy — evita GET shift_payments?job_id=eq.null (400).
    if (!jobId) return null;
    try {
      if (workerId) {
        const { data, error } = await supabase
          .from('shift_payments')
          .select(RECEIPT_SELECT)
          .eq('job_id', jobId)
          .in('status', ['scheduled', 'recorded'])
          .eq('worker_id', workerId)
          .maybeSingle();

        if (error) {
          logError('paymentRecord.getReceipt', error);
          return null;
        }
        return mapReceiptRow(data);
      }

      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) return null;

      // 2. Tenta como o próprio freela (caso mais comum sem `?worker=`).
      const { data: ownRow, error: ownErr } = await supabase
        .from('shift_payments')
        .select(RECEIPT_SELECT)
        .eq('job_id', jobId)
        .in('status', ['scheduled', 'recorded'])
        .eq('worker_id', user.id)
        .maybeSingle();

      if (ownErr) {
        logError('paymentRecord.getReceipt', ownErr);
        return null;
      }
      if (ownRow) return mapReceiptRow(ownRow);

      // 3. Fallback determinístico (empresa em link antigo, sem `?worker=`) — RLS decide o
      // que essa sessão pode ver; sem vínculo nenhum, `rows` volta vazio.
      const { data: rows, error: fallbackErr } = await supabase
        .from('shift_payments')
        .select(RECEIPT_SELECT)
        .eq('job_id', jobId)
        .in('status', ['scheduled', 'recorded'])
        .order('created_at', { ascending: true })
        .limit(1);

      if (fallbackErr) {
        logError('paymentRecord.getReceipt', fallbackErr);
        return null;
      }
      return mapReceiptRow(rows?.[0] ?? null);
    } catch (err) {
      logError('paymentRecord.getReceipt', err);
      return null;
    }
  },

  /**
   * Lista TODOS os marcadores (scheduled | recorded | voided) do freela autenticado,
   * mais recentes primeiro — alimenta "Meus Recebimentos" (worker). Só-leitura sob RLS
   * (`sp_select_participants`: worker_id = auth.uid()), então não precisa filtrar por
   * worker_id explicitamente no client, mas fazemos assim mesmo por clareza/defesa (evita
   * depender só do RLS se a policy mudar) — mesmo espírito de `getAuthCompanyId`.
   */
  async listForWorker(workerId: string): Promise<WorkerShiftPaymentListItem[]> {
    if (!workerId) return [];
    try {
      const { data, error } = await supabase
        .from('shift_payments')
        .select(
          `
          *,
          job:jobs ( id, title, location, start_date ),
          company:companies ( id, name, logo_url )
        `,
        )
        .eq('worker_id', workerId)
        .order('created_at', { ascending: false });

      if (error) {
        logError('paymentRecord.listForWorker', error);
        return [];
      }
      if (!data) return [];

      return (data as Array<ShiftPayment & {
        job: WorkerShiftPaymentListItem['job'];
        company: WorkerShiftPaymentListItem['company'];
      }>).map(({ job, company, ...paymentFields }) => ({
        payment: paymentFields as ShiftPayment,
        job: job ?? null,
        company: company ?? null,
      }));
    } catch (err) {
      logError('paymentRecord.listForWorker', err);
      return [];
    }
  },

  /**
   * Freela confirma o recebimento do pagamento declarado (bilateral ATIVO — HALT #2).
   * One-way: só permite NULL → timestamp (o trigger `enforce_shift_payment_immutability`
   * rejeita qualquer tentativa de alterar depois de confirmado). NÃO bloqueia ciclo/avaliação.
   */
  async confirmReceiptByWorker(paymentId: string): Promise<ConfirmReceiptResult> {
    try {
      // `.select('id')` obrigatório (padrão `removeFromTeam`/patterns.md — DELETE/UPDATE sob
      // RLS negado silenciosamente): se a linha não casar com a policy USING (ex.: pagamento
      // não pertence a este freela, ou já foi estornado), o PostgREST retorna 204 sem erro e
      // 0 linhas afetadas. Sem checar `data`, o freela veria "confirmado" com o banco intocado.
      const { data, error } = await supabase
        .from('shift_payments')
        .update({ worker_confirmed_at: new Date().toISOString() })
        .eq('id', paymentId)
        .select('id');

      if (error) {
        logError('paymentRecord.confirmReceiptByWorker', error);
        return { success: false, error: 'Não foi possível confirmar o recebimento.' };
      }
      if (!data || data.length === 0) {
        return { success: false, error: 'Não foi possível confirmar este recebimento. Atualize a página e tente novamente.' };
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
      // `.select('id')` obrigatório (padrão `removeFromTeam`/patterns.md — DELETE/UPDATE sob
      // RLS negado silenciosamente): sem checar `data`, um estorno negado pela policy USING
      // (ex.: sessão não é mais a empresa dona) reportaria "estornado" com o marcador ainda
      // ATIVO no banco — e "Dispensar" ficaria travado sem explicação nenhuma (guarda de
      // `dismissFromShift` continuaria enxergando o marcador ativo que a UI já deu como sumido).
      const { data, error } = await supabase
        .from('shift_payments')
        .update({
          status: 'voided',
          voided_at: new Date().toISOString(),
          void_reason: reason,
        })
        .eq('id', paymentId)
        .select('id');

      if (error) {
        logError('paymentRecord.voidPayment', error);
        return { success: false, error: 'Não foi possível estornar o registro.' };
      }
      if (!data || data.length === 0) {
        return { success: false, error: 'Não foi possível estornar este registro. Atualize a página e tente novamente.' };
      }
      return { success: true };
    } catch (err) {
      logError('paymentRecord.voidPayment', err);
      return { success: false, error: err instanceof Error ? err.message : 'Erro inesperado.' };
    }
  },
};
