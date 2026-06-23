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
  candidates_count?: number;
  views?: number;
  company_id?: string;
  company?: {
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
 * 'invited'  — empresa convidou; aguarda resposta do freela (R5/R7).
 * 'declined' — freela recusou; NEUTRO, zero punição (R7).
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
  | 'declined';

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
