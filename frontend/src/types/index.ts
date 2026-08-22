// Worki - Shared TypeScript Interfaces
// Centralized types for database entities

// =============================================
// USER & PROFILE
// =============================================

// F7 — disponibilidade declarada pelo freela (grade dia × período).
// Espelha o CHECK `workers_availability_days_shape` (migration 20260817001200):
// chave = dia da semana '0'(domingo)..'6'(sábado), MESMA convenção de `job_series.weekdays`;
// valor = subconjunto (até 3, sem duplicata efetiva) de ['manha','tarde','noite'].
// Ver `.harness/spec/disponibilidade-freela/ddl-aprovado.md` e ADR-20260821.
export type AvailabilityPeriod = 'manha' | 'tarde' | 'noite';
export type AvailabilityWeekday = '0' | '1' | '2' | '3' | '4' | '5' | '6';
export type AvailabilityDays = Partial<Record<AvailabilityWeekday, AvailabilityPeriod[]>>;

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
  // F7 — opcional porque nem toda query traz a coluna; `| null` porque "nunca declarou" é um
  // valor de verdade (condição do CTA de adoção), distinto de "coluna não pedida no select".
  // Fonte da verdade para ordenação/ranking automático; `availability` (acima) é legado só de
  // exibição, sem dia da semana — nunca fazer backfill de um para o outro (ver migration).
  availability_days?: AvailabilityDays | null;
  recommendation_score?: number;
  location?: string;
  joined_at?: string;
  created_at?: string;
  updated_at?: string;
  onboarding_completed?: boolean;
  // F12 — chave-mestra de badges (migration 20260817001400). `undefined` = coluna não pedida no
  // select; distinto de `false` (visível). Ver `.harness/spec/badges-empresas/ddl-aprovado.md` DS2.
  badges_hidden?: boolean;
  // F10 — opt-out de indicação entre empresas (migration 20260817001500). Default true (opt-in
  // implícito — Suposição 3 da spec). Escrita só pelo próprio freela. Ver ddl-aprovado.md §1.
  accepts_referrals?: boolean;
  // F11 — opt-in EXPLÍCITO para ser alcançado por SOS (migration 20260817001600). Default false
  // (o oposto de accepts_referrals: aqui ninguém entra sem pedir). Escrita só pelo próprio
  // freela. Ver .harness/spec/sos-descoberta/ddl-aprovado.md §1 e ADR-20260821.
  discoverable_for_sos?: boolean;
}

// =============================================
// INDICAÇÃO DE FREELA ENTRE EMPRESAS (F10) — .harness/spec/troca-freelas/ddl-aprovado.md
// Vocabulário é requisito: "indicação"/"indicar"/"indicado por". NUNCA troca/emprestar/
// transferir/ceder/repassar em nome de tipo, campo, string de UI ou rota.
// =============================================
export type WorkerReferralStatus =
  | 'awaiting_worker' | 'accepted' | 'declined' | 'cancelled' | 'expired';

/** Shape da tabela `worker_referrals` (migration 20260817001500). Sem policy de UPDATE/DELETE —
 *  toda transição passa por RPC. A empresa destino só lê a própria linha após `status='accepted'`
 *  (RLS `wr_select_requesting_company`) — antes disso, use `WorkerReferralCard` via RPC. */
export interface WorkerReferral {
  id: string;
  worker_id: string;
  referring_company_id: string;
  requesting_company_id: string;
  status: WorkerReferralStatus;
  message?: string | null;
  created_by?: string | null;
  created_at: string;
  expires_at: string;
  responded_at?: string | null;
}

/** Projeção fechada devolvida por `get_worker_referral_card` / `list_worker_referral_cards`.
 *  NUNCA estender com cpf/phone/pix_key/birth_date sem novo gate do architect (ddl-aprovado.md §3). */
export interface WorkerReferralCard {
  referral_id: string;
  status: WorkerReferralStatus;
  message?: string | null;
  created_at: string;
  expires_at: string;
  referring_company: { id: string; name: string; logo_url?: string | null };
  /** `null` enquanto `status !== 'accepted'` — por design (ddl-aprovado.md §5, D2 do ADR). Nenhum
   *  fluxo de UI pode depender deste campo antes do aceite. */
  worker_id: string | null;
  card: {
    full_name: string;
    avatar_url?: string | null;
    rating_average?: number | null;
    reviews_count?: number | null;
    primary_role?: string | null;
    roles?: string[] | null;
  };
}

// =============================================
// BADGES DE EMPRESAS (F12) — .harness/spec/badges-empresas/ddl-aprovado.md
// Shape do retorno de `get_worker_company_badges` (migration 20260817001400). Badge é DERIVADO
// em query (applications.status='completed' + jobs + reviews) — nenhuma tabela armazena isto.
// =============================================
export interface CompanyBadge {
  company_id: string;
  company_name: string;
  company_logo_url?: string | null;
  shifts_count: number;
  /** ISO-8601 UTC (a RPC já formata via to_char — ver DS6). */
  last_shift_at: string;
  /** null = a empresa nunca avaliou. NUNCA renderizar como "0 estrelas". */
  avg_rating: number | null;
  reviews_count: number;
  /** Só vem `true` na visão do próprio freela (mode='manage'); terceiros nunca recebem linha oculta. */
  hidden: boolean;
}

/** Shape da tabela `worker_company_badge_prefs` (opt-out por empresa, bisturi de DS2). */
export interface WorkerCompanyBadgePref {
  worker_id: string;
  company_id: string;
  hidden: boolean;
  updated_at: string;
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
  /**
   * Guarda de risco de vínculo (F5, `supabase/migrations/20260817000900_link_risk_guard.sql`).
   * Opcionais: nem toda query traz a coluna (`select('id, name')`, etc.). Ler como `!== false`
   * quando o significado for "aviso ligado" — `undefined` NÃO é `false` (LM-6, ddl-aprovado.md).
   * Fonte canônica de leitura é a RPC `my_link_risk_config()` (sempre devolve os dois campos),
   * não um `select('*')` avulso.
   */
  link_risk_alert_enabled?: boolean;
  link_risk_alert_threshold?: number;
}

// =============================================
// MULTI-UNIDADE / GERENTE (F13) — .harness/spec/multi-unidade/ddl-aprovado.md §7
// Shape do retorno de `get_my_companies()` (migration 20260818100300). É o ÚNICO resolvedor de
// escopo de empresa do frontend (teamConnectionService.getAuthenticatedCompanyId(), CompanyProfile,
// operationAnalyticsService.resolveCompanyScope() consomem esta RPC — nunca
// `.eq('id', authUser.id).single()`).
// =============================================
export type CompanyRole = 'owner' | 'operator' | 'manager';

export interface MyCompany {
  company_id: string;
  company_name: string | null;
  role: CompanyRole;
  organization_id: string;
  organization_name: string | null;
  onboarding_completed: boolean;
  accepted_tos: boolean;
}

/**
 * Linha de `company_members` (migration 20260818100000) — vínculo gerente x unidade. `user_id`
 * é `null` enquanto o convite não foi aceito (R9). Projeção usada por `organizationService` /
 * `pages/company/Organization.tsx` (R14-R16) — nunca dado financeiro/PII além do e-mail
 * convidado, que a própria empresa digitou.
 */
export type CompanyMemberStatus = 'invited' | 'active' | 'removed';

export interface CompanyMember {
  id: string;
  company_id: string;
  user_id: string | null;
  role: 'manager';
  status: CompanyMemberStatus;
  invited_email: string | null;
  /** Só não-nulo enquanto `status='invited'` — queima (`NULL`) no aceite (R9). */
  invite_token: string | null;
  invited_at: string;
  accepted_at: string | null;
  expires_at: string;
}

// =============================================
// JOB
// =============================================

export interface Job {
  id: string;
  /**
   * FK para `job_series` (nullable — `NULL` = turno avulso, comportamento de hoje inalterado).
   * Espelha `jobs.series_id` (migration 20260817000400, F3 — Escala Recorrente).
   */
  series_id?: string | null;
  /**
   * Data LOCAL (`YYYY-MM-DD`) desta ocorrência dentro da série — identidade estável da
   * ocorrência, independente de fuso (ADR-20260817-serie-eager-e-cancelamento-suave, decisão 6).
   * `NULL` para turnos avulsos.
   */
  series_occurrence_date?: string | null;
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
  /**
   * Requisito de certificação do turno — texto livre, ADVISORY (F8, migration
   * 20260817001300). Aparece como UMA linha de aviso no topo do ShiftCallModal;
   * NUNCA filtra freela, nunca bloqueia seleção/disparo. `null`/undefined = sem requisito.
   */
  certification_requirement?: string | null;
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
 * F11 — 'team' = chamado ao Elenco (F1). 'sos' = alcance ampliado fora do Elenco, nascido
 * exclusivamente dentro de `create_sos_call`. O cliente só consegue escrever 'team' — a policy
 * de INSERT de `shift_calls` recusa qualquer outro valor. Ver ddl-aprovado.md §1.
 */
export type ShiftCallOrigin = 'team' | 'sos';

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
  /** F11 — 'team' (F1) ou 'sos' (alcance fora do Elenco). Migration 20260817001600. */
  origin?: ShiftCallOrigin;
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
  /**
   * F11 — cópia denormalizada de `shift_calls.origin`, gravada pelo trigger
   * `trg_sync_shift_call_target_origin` (migration 20260817001600). Para 'sos', a empresa só
   * enxerga a linha quando `response === 'accepted'` — a RLS não devolve o pool antes do aceite.
   */
  origin?: ShiftCallOrigin;
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
// SOS — DESCOBERTA EM URGÊNCIA (F11)
// .harness/spec/sos-descoberta/ddl-aprovado.md · ADR-20260821-sos-abertura-controlada-do-grafo
// =============================================

/**
 * Todos os `outcome` possíveis de `create_sos_call` (migration 20260817001600). O botão é UX;
 * a RPC reverifica tudo — todo `outcome` de recusa deve ter mensagem específica na UI (contrato
 * §4.5 do ddl-aprovado.md: nunca esconder o botão como única guarda).
 */
export type SosOutcome =
  | 'created'
  | 'pool_empty'
  | 'quota_exceeded'
  | 'not_urgent'
  | 'already_filled'
  | 'team_not_tried'
  | 'team_call_still_open'
  | 'company_city_missing'
  | 'job_started'
  | 'job_deleted'
  | 'invalid_reason'
  | 'forbidden'
  | 'not_found'
  | 'unauthenticated';

/** Retorno de `create_sos_call`. NUNCA traz a lista de alvos — só a contagem (D1 do ADR). */
export interface SosCallRpcResult {
  outcome: SosOutcome;
  call_id?: string;
  targets_count?: number;
  expires_at?: string;
  limit?: 'open' | 'week';
}

/**
 * Retorno de `sos_call_eligibility` — alimenta SÓ o botão "Chamar fora do Elenco" (R8/R9). Não
 * devolve nada sobre o pool (nem tamanho): saber "há N pessoas elegíveis" antes de disparar
 * seria uma prévia do alcance, que o ADR-20260821 proíbe.
 */
export interface SosEligibility {
  eligible: boolean;
  reason: string;
  quota_week_left?: number;
  missing_slots?: number;
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
// TEAM LISTS (F2) — agrupamento organizacional do elenco
// =============================================

/**
 * Espelha `public.team_lists` (migration 20260817000300, F2).
 * Agrupamento organizacional interno da empresa sobre o elenco aceito (`team_connections`) —
 * ex.: "Cozinha", "Salão". Não é vaga, não é convite, não move dinheiro (Article 8 intacto).
 * Atalho de seleção reaproveitado pelos chips do `ShiftCallModal` (R8/R9).
 */
export interface TeamList {
  id: string;
  company_id: string;
  name: string;
  /** Quem criou a lista. Hoje = dono da conta; com multi-unidade (F3), o gerente. */
  created_by: string;
  created_at: string;
  updated_at: string;
}

/**
 * Espelha `public.team_list_members` (migration 20260817000300, F2).
 * Um freela pode estar em N listas (sem exclusividade). O freela não enxerga esta tabela —
 * é artefato interno da empresa.
 */
export interface TeamListMember {
  id: string;
  list_id: string;
  worker_id: string;
  added_at: string;
}

/**
 * Lista com os `worker_id` dos membros já resolvidos (join `team_list_members`).
 * Retornado por `TeamListService.listLists()` — consumido pelo CRUD de `CompanyTeam.tsx`
 * e pelo cálculo de interseção dos chips de `ShiftCallModal` (R9/R10/R11).
 */
export interface TeamListWithMembers extends TeamList {
  memberIds: string[];
}

// =============================================
// ESCALA RECORRENTE (F3) — registro-mãe de série + ocorrências materializadas em `jobs`
// =============================================

/**
 * `weekly`  — 1+ dias-da-semana marcados (folga dominical, ex.).
 * `daily`   — todo dia corrido no intervalo (bloco de cobertura/férias).
 * Espelha o CHECK de `job_series.recurrence_type` (migration 20260817000400).
 */
export type RecurrenceType = 'weekly' | 'daily';

/**
 * Espelha `public.job_series` (migration 20260817000400, F3 — Escala Recorrente).
 * Gate: `.harness/memory-bank/decisions/ADR-20260817-serie-eager-e-cancelamento-suave.md`.
 *
 * `job_series` é um MOLDE e um registro de auditoria, não o dono das ocorrências (ADR, decisão
 * 1): depois da geração EAGER, cada `jobs` é canônico e autônomo. Editar a série não é uma
 * operação suportada — o único campo mutável é `status` (privilégio de coluna, `GRANT UPDATE
 * (status)`), e mesmo essa mutação acontece via RPC (`stop_job_series`), nunca `.update()` direto
 * do client em uso normal.
 */
export interface JobSeries {
  id: string;
  company_id: string;
  recurrence_type: RecurrenceType;
  /** 0=domingo..6=sábado. `NULL` quando `recurrence_type === 'daily'`. */
  weekdays: number[] | null;
  /** `YYYY-MM-DD`, inclusive. */
  range_start_date: string;
  /** `YYYY-MM-DD`, inclusive. Sempre presente — não existe recorrência sem fim (R1). */
  range_end_date: string;
  occurrences_generated: number;
  /** `stopped` = "Cancelar a série inteira" (R11) — impede reaproveitar a série; não é exclusão. */
  status: 'active' | 'stopped';
  created_by: string;
  created_at: string;
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

// =============================================
// CONFIRMAÇÃO DE VÉSPERA (D-1, F4) — log de pedidos, não colunas em `applications`
// migration: supabase/migrations/20260817000600_shift_attendance_confirmations.sql
// DDL aprovado: .harness/spec/confirmacao-vespera/ddl-aprovado.md
// ADR: .harness/memory-bank/decisions/ADR-20260817-confirmacao-vespera-log-evento.md
// =============================================

/** Quem originou o pedido. 'auto' = varredura D-1 (cap 1 por índice). 'manual' = botão da empresa. */
export type AttendanceConfirmationSource = 'auto' | 'manual';

/** Resposta do freela ao pedido. NULL na linha = ainda pendente. */
export type AttendanceConfirmationResponse = 'confirmed' | 'cannot_attend';

/**
 * Espelha `public.shift_attendance_confirmations` — uma linha por PEDIDO (não por application).
 * `request_count`/cooldown do freela+turno são derivados no client agrupando por
 * `application_id` (ver `attendanceConfirmationService`), nunca colunas próprias.
 */
export interface ShiftAttendanceConfirmation {
  id: string;
  application_id: string;
  job_id: string;
  worker_id: string;
  source: AttendanceConfirmationSource;
  /** NULL sempre que source='auto'. uid de quem apertou "Pedir confirmação". */
  requested_by: string | null;
  requested_at: string;
  /** NULL = pendente. Imutável após a primeira resposta (L8 — UPDATE atômico na RPC). */
  response: AttendanceConfirmationResponse | null;
  responded_at: string | null;
}

/**
 * Outcomes das RPCs `request_attendance_confirmation`/`respond_attendance_confirmation`
 * (20260817000700). O banco é a autoridade — o client só reage ao outcome.
 */
export type AttendanceConfirmationOutcome =
  | 'requested'
  | 'confirmed'
  | 'cannot_attend'
  | 'unauthenticated'
  | 'forbidden'
  | 'not_target'
  | 'invalid_status'
  | 'invalid_response'
  | 'job_inactive'
  | 'job_past'
  | 'already_responded'
  | 'not_requested'
  | 'limit_reached'
  | 'cooldown'
  | 'not_found';

// =============================================
// TERMO DE PRESTAÇÃO DE SERVIÇO (F6) — aceite eletrônico, 1:1 com shift_payments
// migration: supabase/migrations/20260817001100_service_terms.sql
// DDL aprovado: .harness/spec/termo-prestacao/ddl-aprovado.md
// ADR: .harness/memory-bank/decisions/ADR-20260818-termo-congelado-no-aceite.md
// =============================================

/**
 * Espelha `public.service_terms`. REGISTRO DECLARATÓRIO entre empresa e freela — a Worki
 * NÃO é parte, não valida e não garante validade jurídica (a cláusula está DENTRO de
 * `term_text`, item 4 do render). NÃO move saldo (Article 8): `amount` é cópia declaratória
 * de `shift_payments.amount`, não é saldo, não entra em soma alguma.
 *
 * `term_text` é RASCUNHO enquanto `accepted_at IS NULL` (o freela precisa ler o que vai
 * assinar) e CONGELA no aceite: `accept_service_term` re-renderiza com os dados vigentes e
 * grava `term_text` + `accepted_at` no MESMO UPDATE. Depois disso é imutável para TODOS os
 * papéis (trigger `enforce_service_term_immutability`), inclusive `service_role`/owner —
 * a única exceção é a anonimização LGPD (`anonymized_at` NULL → timestamp).
 *
 * NÃO existe coluna `status`: o estado do termo é a presença de `accepted_at`, e nada mais.
 * Não adicionar `validated_by`, `company_accepted_at`, `signature_hash`, `is_valid` etc. —
 * qualquer campo que sugira que o Worki valida/garante o termo é violação da fronteira
 * jurídica (ver DDL aprovado §1 pergunta 5).
 */
export interface ServiceTerm {
  id: string;
  shift_payment_id: string;
  job_id: string;
  worker_id: string;
  company_id: string;
  /** 'modelo-worki-v1' — MODELO (sugestão), não "termo oficial da Worki". */
  term_version: string;
  /** Rascunho enquanto accepted_at é null; snapshot CONGELADO desde o aceite depois. */
  term_text: string;
  /** Cópia declaratória de shift_payments.amount. NÃO é saldo — nenhuma RPC financeira. */
  amount: number;
  created_at: string;
  /** null = pendente. Único estado do termo — não existe coluna `status`. */
  accepted_at: string | null;
  /**
   * BEST-EFFORT e FALSIFICÁVEL — primeiro elemento de x-forwarded-for, que o próprio
   * cliente pode forjar (proxies fazem append, não sobrescrevem). Pode vir null (fora do
   * PostgREST, GUC ausente, parse falhou). Nunca rotular como "IP verificado" na UI.
   */
  accepted_ip: string | null;
  /** BEST-EFFORT. Header user-agent truncado em 512 chars. Pode vir null. Indício, não prova. */
  accepted_user_agent: string | null;
  /**
   * Única transição que permite reescrever term_text após o aceite (alavanca LGPD).
   * NULL->timestamp, one-way, fechada ao client (sem policy de UPDATE para authenticated).
   * Por DEFAULT não é usada: termo assinado é retido como prova (ADR-20260818).
   */
  anonymized_at: string | null;
}

/**
 * Outcomes da RPC `accept_service_term` (20260817001100). O banco é a autoridade — o
 * client só reage ao outcome, nunca decide localmente se o aceite deveria ter passado.
 */
export type ServiceTermAcceptOutcome =
  | 'accepted'
  | 'already_accepted'
  | 'unauthenticated'
  | 'not_found'
  | 'forbidden'
  | 'payment_voided'
  | 'missing_cpf';

// ---------------------------------------------------------------------------
// F8 — Certificações e capacitações (migration 20260817001300).
// DDL aprovado (fonte normativa): .harness/spec/certificacoes/ddl-aprovado.md
// ADR: .harness/memory-bank/decisions/ADR-20260821-certificacoes-metadado-sem-arquivo.md
//
// Dois objetos, não um com `type`: `worker_trainings` (interno, a empresa é dona do
// registro) e `worker_certifications` (externo, o freela é dono do documento). v1 SEM
// ARQUIVO (D1 do gate) — nenhum campo `document_path`/bucket. Validade é DERIVADA, nunca
// coluna de status — ver `isCertificationExpired` em `lib/dateUtils.ts`.
// ---------------------------------------------------------------------------

/**
 * Treinamento INTERNO: a empresa declara que treinou o freela (ex.: "treinamento Divino
 * Fogão", "boas práticas RDC 216"). Sem emissor externo, sem validade. Visível só para a
 * empresa que registrou e para o próprio freela (A15) — nunca para outra empresa.
 * Registro de auditoria: revoga-se (`revoked_at`/`revoked_reason`), nunca se apaga/edita.
 */
export interface WorkerTraining {
  id: string;
  company_id: string;
  worker_id: string;
  title: string;
  /** Data de conclusão (`YYYY-MM-DD`), nunca no futuro (trigger valida no INSERT). */
  completed_at: string;
  note?: string | null;
  created_by: string;
  created_at: string;
  /** Revogação one-way — empresa desfaz um registro feito por engano. Nunca reescreve. */
  revoked_at?: string | null;
  revoked_reason?: string | null;
}

/**
 * Certificação EXTERNA do freela (CREF, manipulação de alimentos, curso técnico).
 * AUTO-DECLARADA pelo próprio freela. Uma empresa com vínculo pode CONFERIR visualmente
 * — sempre ATRIBUÍDA a uma empresa nomeada + data (`verified_by_company_id`/`verified_at`
 * são par: nulos juntos ou preenchidos juntos, CHECK no banco). O Worki NUNCA atesta —
 * proibido exibir selo genérico de "verificado" na UI.
 *
 * v1 SEM ARQUIVO (D1): não existe `document_path` nem bucket. `registration_number`
 * substitui o documento (é público/conferível na fonte pelo próprio operador).
 *
 * Vencimento é DERIVADO, nunca coluna de status — usar `isCertificationExpired(expires_at)`
 * (`lib/dateUtils.ts`), nunca comparar `expires_at` inline numa tela.
 *
 * `notified_30d_at`/`notified_expired_at` são livro-caixa do AGENDADOR (fora do GRANT
 * UPDATE do client) — não renderizar como se fossem status de validade.
 */
export interface WorkerCertification {
  id: string;
  worker_id: string;
  title: string;
  issuer?: string | null;
  registration_number?: string | null;
  issued_at?: string | null;
  expires_at?: string | null;
  /** Par travado por CHECK no banco: nulo/preenchido sempre junto de verified_at. */
  verified_by_company_id?: string | null;
  verified_at?: string | null;
  verified_note?: string | null;
  /** Livro-caixa do agendador (F8 R9) — NÃO é status de validade. Só o cron escreve. */
  notified_30d_at?: string | null;
  notified_expired_at?: string | null;
  created_at: string;
  updated_at: string;
}

// =============================================
// ANALYTICS DE OPERAÇÃO (F9) — painel `/company/operacao`
// =============================================
// Somente-leitura (Article 8 intacto). Ver `.harness/spec/analytics-operacao/prd.md`.
//
// D6 (PRD) eleva "estado vazio honesto" a requisito de arquitetura: cada bloco devolve um union
// type com 3 estados possíveis do SERVICE (o 4º estado, `loading`, é responsabilidade da UI —
// o service é síncrono-por-chamada, nunca fica "em voo" no seu próprio retorno):
//   - 'sem-fonte': zero linhas na fonte no período. UI: mensagem acionável, NUNCA "0%"/"R$ 0,00".
//   - 'amostra-insuficiente': há linhas, mas abaixo do mínimo de confiança (ex.: recebidos < 2).
//     UI: "—" + nota do porquê.
//   - 'ok': há fonte suficiente — inclui o caso zero-real (zero é resultado válido, não vazio).
// Ver D6 do PRD para a tabela completa dos 4 estados (o 4º, 'loading', mora no componente).
export type AnalyticsBlockState = 'sem-fonte' | 'amostra-insuficiente' | 'ok';

/** Bloco de métrica com estado explícito — nunca colapsar 'sem-fonte' em 'ok' com zeros. */
export type MetricBlock<T> =
  | { state: 'sem-fonte' }
  | { state: 'amostra-insuficiente' }
  | ({ state: 'ok' } & T);

/**
 * Comparação vs. o período anterior de MESMA DURAÇÃO (só nos 4 cards de resumo — R5–R8).
 * `previous: null` quando o período anterior não tinha fonte (não dá para calcular variação).
 * `percentChange: null` quando `previous` é `null` OU `previous === 0` (divisão por zero evitada
 * — variação "infinita" não é exibível como percentual).
 */
export interface PeriodDelta {
  current: number;
  previous: number | null;
  percentChange: number | null;
}

/** R5 — Card Gasto absoluto. União shift_payments (modo A) + escrow_transactions (modos B/C, D8). */
export interface SpendSummary {
  totalAmount: number;
  delta: PeriodDelta;
  /**
   * D8 — pares (job_id, worker_id) presentes nas DUAS fontes (shift_payments E escrow) no
   * período. `shift_payments` sempre vence (modo A é o registro declarado pela empresa); esta
   * contagem é só para a UI rotular o conflito, nunca para somar duas vezes.
   */
  conflictingRowsCount: number;
}

/** R6 — Card Contratações. */
export interface HiresSummary {
  count: number;
  /**
   * D6 — vagas criadas no período (denominador de contexto). Sem isto, `count: 0` renderizava
   * "0" nu — indistinguível de erro/sem-dado ao olho, mesmo sendo zero-real válido (empresa criou
   * vagas mas nenhuma virou contratação). Com o denominador, a tela mostra "0 de N vagas criadas".
   */
  jobsCreatedCount: number;
  delta: PeriodDelta;
}

/**
 * R7 — Card Custo por hora (D2b/D2c). `costPerHour: null` quando o denominador (horas) é 0 —
 * a UI mostra "—", nunca `Infinity`/`NaN`.
 */
export interface CostPerHourSummary {
  costPerHour: number | null;
  totalSpend: number;
  totalHours: number;
  /** Turnos `completed` no período (denominador de "X de Y usaram estimativa"). */
  shiftsCount: number;
  /** Turnos sem NENHUMA hora real (checkin/checkout de nenhuma fonte) que caíram para `estimated_hours`. */
  estimatedHoursShiftsCount: number;
  /** D2c — turnos descartados do cálculo por duração > `MAX_PLAUSIBLE_SHIFT_HOURS` (marcação inconsistente). */
  inconsistentDurationShiftsCount: number;
  /**
   * Turnos `completed` sem NENHUMA fonte de hora: nem marcação de ponto (checkin/checkout, D2a)
   * nem `estimated_hours` cadastrado. Sem este contador, `costPerHour: null` (denominador zero)
   * renderizava "—" mudo, sem nenhuma das duas legendas condicionais (que dependem de
   * `estimatedHoursShiftsCount`/`inconsistentDurationShiftsCount` > 0) — violava D6 linha 3 ("—"
   * + nota do porquê é obrigatório, nunca "—" sozinho).
   */
  noHoursSourceShiftsCount: number;
  delta: PeriodDelta;
}

/**
 * R8 — Card Razão horas realizadas ÷ previstas (D2b, estrito). Turno sem hora real é excluído do
 * numerador E do denominador (nunca cai para `estimated_hours` como se fosse realizado — isso
 * empurraria a razão para 1,00 artificialmente). `ratio: null` quando o denominador é 0.
 */
export interface HoursRatioSummary {
  ratio: number | null;
  realizedHours: number;
  estimatedHours: number;
  /** Turnos excluídos por `estimated_hours` nulo (não cadastrado). */
  excludedNoEstimateCount: number;
  /** Turnos excluídos por ausência de marcação de ponto em ambas as fontes. */
  excludedNoAttendanceCount: number;
  delta: PeriodDelta;
}

/** R9 — Card Tempo médio de preenchimento do chamado (`first_claim_at − created_at`). */
export interface FillTimeStats {
  averageMs: number;
  /** Já formatado via `formatDurationMs` — a UI não reformata. */
  averageLabel: string;
  /** Quantos chamados entraram na média (têm `first_claim_at` preenchido no período). */
  sampleCount: number;
}

/** R10 — Bloco Chamados × preenchimento. `expired` sempre presente, mesmo 0 (nunca omitido). */
export interface CallsByStatus {
  open: number;
  filled: number;
  expired: number;
  cancelled: number;
  total: number;
}

/** R11 — Bloco Motivo da quebra, uma linha por `ShiftCallReason` presente no período. */
export interface CallsByReasonRow {
  reason: ShiftCallReason;
  total: number;
  filled: number;
  expired: number;
}

/**
 * R12 — Tabela Aceite por freela. `acceptanceRate: null` quando `received < 2` (amostra mínima —
 * nunca 0%/100% precipitado de 1 chamado). Ordenação SEMPRE alfabética por nome — nunca por
 * métrica (R17/D4: proibido virar ranking).
 */
export interface WorkerAcceptanceRow {
  workerId: string;
  workerName: string;
  /** D5.3 — unidade de origem da linha; hoje sempre 1 valor (piloto), preparado para F13. */
  companyId: string;
  received: number;
  accepted: number;
  declined: number;
  /** Chamado fechado ('closed') ou expirado antes deste alvo responder — NÃO é recusa. */
  noResponse: number;
  acceptanceRate: number | null;
}

/**
 * R13–R15 — Tabela por freela de presença: no-show, cancelamentos, pontualidade.
 * `cancelledCount` carrega rótulo fixo na UI ("não distingue quem cancelou" — R14, sem
 * `cancelled_by` persistido). `punctualityRate`/`lateCount` só fazem sentido com
 * `checkinsWithScheduleCount >= 2` (R15); abaixo disso, `punctualityRate` é `null`.
 */
export interface WorkerAttendanceRow {
  workerId: string;
  workerName: string;
  /** D5.3 */
  companyId: string;
  /** A7' — no-show corrigido: turno já deveria ter terminado (D7) e sem checkin em nenhuma fonte. */
  noShowCount: number;
  /** Turnos excluídos do no-show por falta de `work_start_time` E `work_end_time` (D7). */
  noShowExcludedNoScheduleCount: number;
  /** R14 — combinado empresa+freela, rótulo fixo obrigatório na UI. */
  cancelledCount: number;
  punctualCount: number;
  lateCount: number;
  /** Denominador de `punctualityRate` — turnos com checkin registrado E `work_start_time` cadastrado. */
  checkinsWithScheduleCount: number;
  punctualityRate: number | null;
}

/**
 * R16 — Card Desempenho por freela. NUNCA combinar `ratingAverage` (global, todas as empresas)
 * com `completedWithCompanyCount` num único score/número (R17/D4 Opção A — proibido `score`).
 */
export interface WorkerPerformanceRow {
  workerId: string;
  workerName: string;
  /** D5.3 */
  companyId: string;
  /** `workers.rating_average` — rótulo obrigatório na UI: "Avaliação (global — todas as empresas)". */
  ratingAverage: number | null;
  completedWithCompanyCount: number;
}

/**
 * D4 — F4 (confirmação de véspera) só entra como bloco AGREGADO de operação nesta v1, nunca
 * como coluna por freela (sem `pg_cron` verificado ativo em produção por >= 30 dias, "não
 * respondeu" significaria "ninguém perguntou" — acusaria o freela por falha de infraestrutura).
 */
export interface AttendanceConfirmationsSummary {
  requested: number;
  responded: number;
  /** `response = 'cannot_attend'`. */
  declined: number;
}

export type SpendSummaryBlock = MetricBlock<SpendSummary>;
export type HiresSummaryBlock = MetricBlock<HiresSummary>;
export type CostPerHourSummaryBlock = MetricBlock<CostPerHourSummary>;
export type HoursRatioSummaryBlock = MetricBlock<HoursRatioSummary>;
export type FillTimeStatsBlock = MetricBlock<FillTimeStats>;
export type CallsByStatusBlock = MetricBlock<CallsByStatus>;
export type CallsByReasonBlock = MetricBlock<{ rows: CallsByReasonRow[] }>;
export type WorkerAcceptanceBlock = MetricBlock<{ rows: WorkerAcceptanceRow[] }>;
export type WorkerAttendanceBlock = MetricBlock<{ rows: WorkerAttendanceRow[] }>;
export type WorkerPerformanceBlock = MetricBlock<{ rows: WorkerPerformanceRow[] }>;
export type AttendanceConfirmationsBlock = MetricBlock<AttendanceConfirmationsSummary>;

/**
 * Agregado consolidado devolvido por `operationAnalyticsService.getOperationAnalytics()`.
 *
 * `scopeCompanyIds` (D5.1/D5.5) — resultado de `resolveCompanyScope()`; hoje 1–2 ids
 * (ancoragem dupla `auth.uid()` + `companies.owner_id`). É o ÚNICO ponto do frontend que muda
 * quando `is_job_owner`/`is_company_owner` forem unificadas (F13 multi-unidade) — ver
 * ADR-20260817-seam-autorizacao-empresa.md.
 *
 * `truncated` (D1 guarda 2) — `true` quando QUALQUER fonte paginada atingiu `MAX_PAGES` sem
 * terminar. A UI é obrigada a exibir a faixa de truncamento (A16) e NUNCA um número parcial sem
 * esse rótulo.
 *
 * `hasError` — `true` quando alguma fonte falhou a leitura (erro de rede/RLS/coluna inexistente)
 * durante a coleta. Antes, um erro de leitura era engolido por `logError` e devolvido como
 * `sem-fonte` em todos os 11 blocos — indistinguível de "esta empresa realmente não tem dado
 * nenhum". A UI é obrigada a mostrar um aviso de falha de carregamento (nunca reportar como
 * "nenhum turno criado") quando `hasError` é `true`.
 */
export interface OperationAnalytics {
  scopeCompanyIds: string[];
  truncated: boolean;
  hasError: boolean;
  spend: SpendSummaryBlock;
  hires: HiresSummaryBlock;
  costPerHour: CostPerHourSummaryBlock;
  hoursRatio: HoursRatioSummaryBlock;
  fillTime: FillTimeStatsBlock;
  callsByStatus: CallsByStatusBlock;
  callsByReason: CallsByReasonBlock;
  acceptanceByWorker: WorkerAcceptanceBlock;
  attendanceByWorker: WorkerAttendanceBlock;
  performanceByWorker: WorkerPerformanceBlock;
  attendanceConfirmations: AttendanceConfirmationsBlock;
}
