// Worki - Shared TypeScript Interfaces
// Centralized types for database entities

// =============================================
// USER & PROFILE
// =============================================

export interface WorkerProfile {
  id: string;
  full_name: string;
  city?: string;
  phone?: string;
  bio?: string;
  pix_key?: string;
  primary_role?: string;
  roles?: string[];
  tags?: string[];
  cover_url?: string;
  avatar_url?: string;
  photo_url?: string;
  verified_identity?: boolean;
  level?: number;
  xp?: number;
  rating_average?: number;
  reviews_count?: number;
  completed_jobs_count?: number;
  completed_jobs?: number;
  earnings_total?: number;
  experience_years?: number;
  availability?: string;
  recommendation_score?: number;
  location?: string;
  joined_at?: string;
  created_at?: string;
  updated_at?: string;
  onboarding_completed?: boolean;
}

export interface CompanyProfile {
  id?: string;
  name: string;
  industry?: string;
  description?: string;
  website?: string;
  email?: string;
  address?: string;
  logo_url?: string;
  cover_url?: string;
  rating_average?: number;
  reviews_count?: number;
  onboarding_completed?: boolean;
  owner_id?: string;
}

// =============================================
// JOB
// =============================================

export interface Job {
  id: string;
  display_code?: string;
  title: string;
  description?: string;
  briefing?: string;
  type?: string;
  status: string;
  location: string;
  start_date: string;
  created_at?: string;
  work_start_time?: string;
  work_end_time?: string;
  estimated_hours?: number;
  has_lunch?: boolean;
  budget: number;
  budget_period?: string;
  /**
   * Quantas pessoas o turno precisa (>=1, default 1 — migration 20260817000000).
   * Uma posição preenchida = uma application hired/in_progress/completed.
   */
  slots?: number;
  candidates_count?: number;
  views?: number;
  company_id?: string;
  company?: {
    id?: string;
    name: string;
    logo_url?: string;
    rating_average?: number;
    reviews_count?: number;
  };
}

// =============================================
// APPLICATION
// =============================================

/**
 * Status de application (pull = candidatura worker; push = convite empresa).
 * 'invited'   — empresa convidou; aguarda resposta do freela (R5/R7).
 * 'declined'  — freela recusou; NEUTRO, zero punição (R7).
 * 'cancelled' — worker cancelou turno já aceito (hired/in_progress → cancelled, ver
 *   `trg_notify_company_on_worker_cancel`) OU empresa cancelou convite/dispensou do
 *   turno. Transição irreversível (Article — máquina de estados de cancelamento).
 * Demais status: fluxo pull legado.
 */
export type ApplicationStatus =
  | 'pending'
  | 'reviewing'
  | 'interview'
  | 'hired'
  | 'in_progress'
  | 'completed'
  | 'rejected'
  | 'invited'
  | 'declined'
  | 'cancelled';

/**
 * Resposta do freela a um convite push.
 * NULL enquanto o convite está pendente.
 */
export type InvitationResponse = 'accepted' | 'declined';

export interface Application {
  id: string;
  job_id: string;
  worker_id: string;
  /** Usa ApplicationStatus — restrinja ao tipo ao criar/actualizar. */
  status: ApplicationStatus | string;
  cover_letter?: string;
  created_at?: string;
  worker_checkin_at?: string | null;
  worker_checkout_at?: string | null;
  company_checkin_confirmed_at?: string | null;
  company_checkout_confirmed_at?: string | null;
  // --- campos de convite push (nullable — null = fluxo pull) ---
  /** Quando a empresa criou o convite. NULL = aplicação pull. */
  invited_by_company_at?: string | null;
  /** Quando o freela respondeu ao convite. */
  invitation_responded_at?: string | null;
  /** Resposta do freela: 'accepted' | 'declined' | null (pendente). */
  invitation_response?: InvitationResponse | null;
  /** Data-limite para o freela responder (R8). Após esta data, slot reabre. */
  invitation_expires_at?: string | null;
  worker?: Partial<WorkerProfile>;
  job?: Partial<Job>;
}

// =============================================
// CHAMADO DE TURNO (F1) — disparo 1→N com primeiro-aceite
// =============================================

/**
 * Motivo da quebra que originou o chamado. Alimenta o BI de operação: o sócio-operador
 * controla o gasto com freela cruzando com nível de falta e quebra de escala.
 * Espelha o CHECK de `shift_calls.reason` (migration 20260817000100).
 */
export type ShiftCallReason =
  | 'falta'
  | 'demissao'
  | 'pico_previsto'
  | 'evento'
  | 'ferias'
  | 'folga'
  | 'reforco'
  | 'outro';

/** Rótulos em pt-BR dos motivos — fonte única para dropdown e relatório. */
export const SHIFT_CALL_REASON_LABELS: Record<ShiftCallReason, string> = {
  falta: 'Falta de funcionário',
  demissao: 'Demissão / quebra de escala',
  pico_previsto: 'Pico de movimento previsto',
  evento: 'Evento',
  ferias: 'Cobertura de férias',
  folga: 'Cobertura de folga',
  reforco: 'Reforço de equipe',
  outro: 'Outro',
};

/** Estado do chamado. Muda SÓ por RPC — nunca por UPDATE do client. */
export type ShiftCallStatus = 'open' | 'filled' | 'cancelled' | 'expired';

/**
 * Resposta de um alvo do chamado.
 * 'closed' = a vaga encheu (ou o chamado foi cancelado/expirou) antes deste alvo responder.
 * NÃO é recusa e NÃO é punição — o freela segue elegível ao mesmo turno se a vaga reabrir.
 */
export type ShiftCallTargetResponse = 'accepted' | 'declined' | 'closed';

/**
 * Espelha `public.shift_calls` (migration 20260817000100).
 * Um chamado com um único alvo é o convite individual — não existem dois fluxos.
 */
export interface ShiftCall {
  id: string;
  job_id: string;
  company_id: string;
  /** Quem disparou. Hoje o dono da conta; com multi-unidade, o gerente. */
  created_by: string;
  /** Snapshot de `jobs.slots` no disparo. */
  slots: number;
  reason: ShiftCallReason;
  message?: string | null;
  /** Quantos freelas receberam o disparo (1 = convite individual). Desnormalizado: a RLS não
   *  deixa o freela contar os concorrentes, e ele precisa saber que a vaga é disputada. */
  targets_count: number;
  status: ShiftCallStatus;
  expires_at: string;
  created_at: string;
  closed_at?: string | null;
  /** Primeiro aceite. (first_claim_at - created_at) = tempo de preenchimento. */
  first_claim_at?: string | null;
  // --- joins opcionais para UI ---
  targets?: ShiftCallTarget[];
  job?: Partial<Job>;
}

/** Espelha `public.shift_call_targets` (migration 20260817000100). */
export interface ShiftCallTarget {
  id: string;
  call_id: string;
  worker_id: string;
  notified_at: string;
  responded_at?: string | null;
  response?: ShiftCallTargetResponse | null;
  // --- joins opcionais para UI ---
  worker?: Partial<WorkerProfile>;
  call?: ShiftCall;
}

/**
 * Resultado das RPCs de resposta ao chamado (`claim_shift_slot`, `decline_shift_call`,
 * `cancel_shift_call`). O banco é a autoridade da corrida — o client só reage ao outcome.
 */
export type ShiftCallOutcome =
  | 'claimed'
  | 'declined'
  | 'cancelled'
  | 'filled'
  | 'expired'
  | 'not_target'
  | 'already_responded'
  | 'already_hired'
  | 'blocked_cancelled'
  | 'not_open'
  | 'forbidden'
  | 'not_found'
  | 'unauthenticated';

export interface ShiftCallRpcResult {
  outcome: ShiftCallOutcome;
  application_id?: string;
  /** Posições ocupadas após este aceite. */
  filled?: number;
  slots?: number;
  pending?: number;
  response?: ShiftCallTargetResponse;
  status?: ShiftCallStatus;
}

/**
 * Convite pendente na visão do freela, normalizado.
 * Existem DUAS origens vivas e o freela não deve perceber a diferença:
 *  - 'call'   — alvo de um `shift_calls` (o caminho novo);
 *  - 'legacy' — `applications` com status 'invited' criada antes do F1 (ainda em produção).
 */
export interface PendingInvite {
  source: 'call' | 'legacy';
  /** id do alvo (source='call') ou da application (source='legacy'). */
  id: string;
  /** Só em source='call' — é o que a RPC recebe. */
  callId?: string;
  /** Só em source='legacy' — é o que `respondToInvite` recebe. */
  applicationId?: string;
  jobId: string;
  expiresAt: string | null;
  /** true quando outros freelas receberam o mesmo chamado (corrida). */
  disputed: boolean;
  /** Quantos alvos receberam este chamado (1 = convite individual). */
  targetsCount: number;
  slots: number;
  reason?: ShiftCallReason;
  message?: string | null;
  job?: Partial<Job>;
}

// =============================================
// TEAM CONNECTIONS
// =============================================

/**
 * Status da aresta consentida empresa↔freela (R1/R2).
 * 'pending'  — empresa convidou, aguarda aceite do freela.
 * 'accepted' — freela aceitou; handshake concluído (1x).
 * 'blocked'  — freela saiu/bloqueou a empresa.
 */
export type TeamConnectionStatus = 'pending' | 'accepted' | 'blocked';

/**
 * Canal pelo qual a empresa adicionou o freela ao roster.
 */
export type TeamConnectionSource = 'qr' | 'link' | 'phone';

/**
 * Espelha a tabela `team_connections`.
 * Gerado à mão conforme migration `20260622000000_team_connections.sql`.
 */
export interface TeamConnection {
  id: string;
  company_id: string;
  worker_id: string;
  status: TeamConnectionStatus;
  source: TeamConnectionSource;
  /** auth.uid() de quem bloqueou (auditoria). */
  blocked_by?: string | null;
  created_at: string;
  accepted_at?: string | null;
  updated_at: string;
  // --- joins opcionais para UI ---
  worker?: Partial<WorkerProfile>;
  company?: Partial<CompanyProfile>;
}

/**
 * Membro da equipe: conexão aceita com perfil do worker embutido.
 * Retornado por TeamConnectionService.listTeamMembers().
 */
export interface TeamMember {
  connection: TeamConnection;
  worker: WorkerProfile;
}

/**
 * "Minha loja": conexão aceita vista pelo worker, com dados da empresa.
 * Retornado por TeamConnectionService.listMyStores().
 */
export interface MyStore {
  connection: TeamConnection;
  company: CompanyProfile;
}

// =============================================
// PAGAMENTO POSTPAGO (Slice 2) — cartão on-file da empresa
// =============================================

/**
 * Método de pagamento on-file da empresa (cartão tokenizado no Asaas).
 * Espelha public.payment_methods (migration 20260622000600). NUNCA carrega o PAN —
 * só o token opaco do Asaas + metadados não-sensíveis (PCI / Article 10).
 */
export interface PaymentMethod {
  id: string;
  /** company_id = auth.uid() da empresa (= jobs.company_id = wallets.user_id). */
  company_id: string;
  /** creditCardToken opaco do Asaas (não é o número do cartão). */
  asaas_credit_card_token: string;
  brand?: string | null;
  /** 4 dígitos finais para exibição ("•••• 1234"). */
  last4?: string | null;
  holder_name?: string | null;
  is_default: boolean;
  created_at: string;
  updated_at: string;
}

/** prepaid = fluxo pull legado (saldo pré-depositado); postpaid = push Slice 2 (hold no cartão). */
export type EscrowKind = 'prepaid' | 'postpaid';

/**
 * Estados do escrow. Prepago: reserved→released|refunded. Postpago: authorized→captured→released,
 * ou authorized→refunded (cancel/no-show). Espelha o CHECK de escrow_transactions.status
 * (migration 20260622000700).
 */
export type EscrowStatus = 'reserved' | 'authorized' | 'captured' | 'released' | 'refunded';

// =============================================
// MESSAGING
// =============================================

export interface Message {
  id: string;
  content: string;
  senderid: string;
  createdat: string;
  conversationid?: string;
  read_at?: string | null;
  is_mine?: boolean;
}

export interface ConversationItem {
  id: string;
  application_uuid: string;
  job_title: string;
  last_message?: string;
  last_message_at?: string;
  unread_count: number;
  status: string;
}

export interface WorkerConversationItem extends ConversationItem {
  company_name: string;
  company_logo?: string;
}

export interface CompanyConversationItem extends ConversationItem {
  worker_name: string;
  worker_avatar?: string;
}

// =============================================
// REVIEW
// =============================================

/**
 * Direção da avaliação (coluna adicionada em `20260622000200_company_rating_trigger.sql`).
 * 'worker'  → empresa avaliou o freela (reviewed_id é worker).
 * 'company' → freela avaliou a empresa (reviewed_id é company).
 * NULL = legado (pre-migration).
 * IMPORTANTE: reviewer_id/reviewed_id são TEXT no DB (não UUID).
 */
export type ReviewDirection = 'worker' | 'company';

export interface Review {
  id: string;
  rating: number;
  comment?: string;
  /** TEXT no DB — não cast para UUID. */
  reviewer_id: string;
  /** TEXT no DB — não cast para UUID. */
  reviewed_id?: string;
  /** @deprecated use reviewed_id */
  reviewee_id?: string;
  application_id?: string;
  /**
   * Direção explícita: quem é o avaliado.
   * Passar SEMPRE ao inserir: 'worker' quando empresa avalia freela;
   * 'company' quando freela avalia empresa.
   * O trigger BEFORE INSERT (`set_review_direction`) preenche automaticamente
   * se omitido, mas o service DEVE passar explicitamente (ADR-001).
   */
  direction?: ReviewDirection | null;
  created_at?: string;
  company?: { name: string };
}

// =============================================
// NOTIFICATION
// =============================================

export interface Notification {
  id: string;
  user_id?: string;
  type: 'status_change' | 'message' | 'payment' | 'system';
  title: string;
  message: string;
  link?: string;
  read_at: string | null;
  created_at: string;
}

// =============================================
// ANALYTICS
// =============================================

export interface AnalyticsEvent {
  id?: string;
  user_id: string;
  event_type: string;
  metadata?: Record<string, unknown>;
  created_at?: string;
}

// =============================================
// JOB CATEGORY
// =============================================

export interface JobCategory {
  name: string;
  slug: string;
}

// =============================================
// INTELIGÊNCIA FINANCEIRA — Slice 3 (R12-R16)
// =============================================

/**
 * Teto de gasto mensal por empresa (migration 20260623000000_company_spend_limits.sql).
 * alert_thresholds: limiares em % que disparam alerta in-app (default {80,90,100}).
 * scope: '' = empresa inteira (v1 single-store, NOT NULL DEFAULT ''); rótulo de loja para multi-loja (Fase 2).
 */
export interface SpendLimit {
  id: string;
  company_id: string;
  period: 'month';
  amount: number;
  alert_thresholds: number[];
  scope: string;
  financial_contact_email: string | null;
  financial_contact_phone: string | null;
  created_at: string;
  updated_at: string;
}

/**
 * Faturamento mensal declarado pela empresa (migration 20260623000100_company_monthly_revenue.sql).
 * year_month: DATE ancorada no dia 1 (ex: 2026-06-01). Normalizar com date_trunc('month') no service.
 * amount: faturamento bruto BRL >= 0 (0 = informou que não faturou).
 */
export interface MonthlyRevenue {
  id: string;
  company_id: string;
  /** DATE string no formato YYYY-MM-DD, sempre ancorada no dia 1 do mês. */
  year_month: string;
  amount: number;
  created_at: string;
  updated_at: string;
}

// --- Shapes de resultado das queries de BI (FinancialBIService) ---

/**
 * BI-1: Gasto acumulado do período.
 * Derivado de escrow_transactions WHERE status IN ('released','captured').
 */
export interface AccumulatedSpend {
  /** Gasto total em BRL no período. */
  totalAmount: number;
  /** Início do período (primeiro dia do mês, ISO string). */
  periodStart: string;
  /** Início do próximo período (exclusive, ISO string). */
  periodEnd: string;
}

/**
 * BI-2: Gasto e horas por freela no período.
 * Horas reais quando há checkout; fallback jobs.estimated_hours.
 */
export interface SpendByWorker {
  workerId: string;
  workerName: string;
  workerAvatarUrl?: string | null;
  /** Total gasto com este freela no período (BRL). */
  totalAmount: number;
  /** Total de horas (real ou estimada). */
  totalHours: number;
  /** Fonte das horas: 'real' (checkout - checkin) ou 'estimated' (jobs.estimated_hours). */
  hoursSource: 'real' | 'estimated' | 'mixed';
  /** Número de turnos concluídos no período. */
  shiftsCount: number;
}

/**
 * BI-3: Ratio custo/hora e custo como % do faturamento.
 * costPercentRevenue é null quando não há faturamento informado para o mês.
 */
export interface CostRatio {
  /** Custo médio por hora no período (BRL/h). Null quando horas = 0. */
  costPerHour: number | null;
  /** Custo total no período. */
  totalCost: number;
  /** Horas totais no período. */
  totalHours: number;
  /** Custo como % do faturamento. Null quando faturamento não foi informado. */
  costPercentRevenue: number | null;
  /** Faturamento declarado no mês (null = não informado — exibir CTA). */
  declaredRevenue: number | null;
}

/**
 * BI-4: Custo de no-show estimado no período (heurística v1).
 * ROTULADO COMO ESTIMATIVA — sem coluna explícita de no-show na v1.
 */
export interface NoShowCost {
  /** Número de potenciais no-shows (convite aceito + turno passou + sem checkout). */
  estimatedCount: number;
  /**
   * Valor potencialmente perdido/desperdiçado.
   * No postpago sem captura, o hold foi liberado (custo real = 0). Expõe o custo de oportunidade.
   */
  estimatedAmount: number;
  /** Sempre true: indica que este é um dado estimado (heurística v1, sem marcador explícito). */
  isEstimate: true;
}

/**
 * BI-5: Flag de concentração de horas por freela (risco de vínculo trabalhista — R16).
 * Flag quando horas/dias cruzam o limiar de produto (constante no service).
 */
export interface ConcentrationFlag {
  workerId: string;
  workerName: string;
  /** Total de horas no período. */
  totalHours: number;
  /** Número de dias distintos trabalhados no período. */
  distinctDays: number;
  /** true quando cruzou o limiar de produto. */
  flagged: boolean;
  /** Limiar de horas usado para a flag. */
  hoursThreshold: number;
  /** Limiar de dias usado para a flag. */
  daysThreshold: number;
}

/**
 * Shape consolidado do hook useFinancialBI — todos os BI do período.
 */
export interface FinancialBIData {
  accumulatedSpend: AccumulatedSpend;
  spendByWorker: SpendByWorker[];
  costRatio: CostRatio;
  noShowCost: NoShowCost;
  concentrationFlags: ConcentrationFlag[];
}

// =============================================
// PAGAMENTO EXTERNO — modo A (ADR-20260630-pagamento-opcional-piloto)
// migration: supabase/migrations/20260630000000_shift_payments.sql
// =============================================

/**
 * Método declarado do pagamento (NÃO é prova bancária — é uma declaração).
 */
export type PaymentSource = 'external_pix' | 'cash' | 'other';

/**
 * Estado do registro. 'scheduled' é a promessa (data prevista, sem paid_at). 'voided' é
 * totalmente imutável (correção = novo registro). Ver ADR-20260712 (pagamento agendado).
 */
export type ShiftPaymentStatus = 'scheduled' | 'recorded' | 'voided';

/**
 * Espelha a tabela `shift_payments` (marcador de pagamento externo por turno).
 * Registro/auditoria declaratório — NÃO move saldo, NÃO toca wallets/escrow_transactions,
 * sem RPC (Article 8 intacto). Gerado à mão conforme migration
 * `20260630000000_shift_payments.sql` + `20260712000000_shift_payment_scheduled.sql`.
 *
 * Imutabilidade (trigger `enforce_shift_payment_immutability`):
 *  - Colunas materiais (job_id, company_id, worker_id, application_id, source, amount,
 *    recorded_by, note, created_at, scheduled_for) são imutáveis após o INSERT.
 *  - `paid_at` é NULL enquanto `scheduled`; setado UMA vez na efetivação (scheduled→recorded)
 *    e então imutável.
 *  - `worker_confirmed_at` é one-way (NULL → timestamp).
 *  - Correção = estorno lógico (status='voided' + voided_at + void_reason).
 */
export interface ShiftPayment {
  id: string;
  job_id: string;
  company_id: string;
  worker_id: string;
  /** Link opcional ao ciclo específico; ON DELETE SET NULL preserva o recibo. */
  application_id: string | null;
  /** Método DECLARADO (não prova bancária). */
  source: PaymentSource;
  /** Valor declarado pago (BRL). Sempre > 0. */
  amount: number;
  /** Data prevista do pagamento (promessa, YYYY-MM-DD) quando status='scheduled'. Material/imutável. */
  scheduled_for: string | null;
  /** Quando o pagamento aconteceu de fato (declarado). NULL enquanto 'scheduled'. */
  paid_at: string | null;
  /** auth.uid() de quem registrou (empresa no v1). */
  recorded_by: string;
  /** Confirmação de recebimento pelo freela (bilateral ativo). One-way NULL→ts. Não bloqueia ciclo. */
  worker_confirmed_at: string | null;
  /** Observação livre (ex.: "pago em 2x", referência PIX). Imutável. */
  note: string | null;
  /** scheduled (promessa) | recorded (efetivado/ativo) | voided (estornado, imutável). */
  status: ShiftPaymentStatus;
  voided_at: string | null;
  void_reason: string | null;
  created_at: string;
}
