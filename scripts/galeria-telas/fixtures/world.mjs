// Mundo fictício da galeria. Formas conferidas em frontend/src/types e nos services.
/** @typedef {import('../../../frontend/src/types').Job} Job */
/** @typedef {import('../../../frontend/src/types').Application} Application */
/** @typedef {import('../../../frontend/src/types').ShiftPayment} ShiftPayment */
/** @typedef {import('../../../frontend/src/types').WorkerProfile} WorkerProfile */
/** @typedef {import('../../../frontend/src/types').MyCompany} MyCompany */
/** @typedef {import('../../../frontend/src/types').TeamMemberItem} TeamMemberItem */

/** Relógio congelado no navegador: o "antes" e o "depois" ficam comparáveis. */
export const AGORA = new Date('2026-11-25T13:00:00-03:00');

export const id = (grupo, n = 1) => `${String(grupo).padStart(8, '0')}-0000-4000-8000-${String(n).padStart(12, '0')}`;
export const ID = {
  freela: id(1), empresa: id(2), encarregado: id(3), admin: id(4), gestor2: id(5), empresa2: id(2, 2), empresa3: id(2, 3), org: id(6),
};

/** Dia relativo a "hoje" (AGORA), como YYYY-MM-DD. */
export const dia = (d) => new Date(AGORA.getTime() + d * 864e5).toISOString().slice(0, 10);
/** Instante relativo: dias + hora local de Brasília. */
export const em = (d, hora = '12:00') => new Date(`${dia(d)}T${hora}:00-03:00`).toISOString();
const horas = (h) => new Date(AGORA.getTime() + h * 36e5).toISOString();

const NOMES = ['Ana Beatriz Souza', 'Carlos Eduardo Lima', 'Juliana Ribeiro', 'Marcos Vinícius Alves', 'Patrícia Gomes', 'Rafael Nogueira', 'Sabrina Teixeira', 'Thiago Moreira', 'Vanessa Cardoso', 'Lucas Fernandes'];
const FUNCOES = ['Garçom', 'Atendente', 'Barista', 'Bartender', 'Cozinheiro', 'Copeiro', 'Caixa', 'Recepcionista', 'Cumim', 'Auxiliar de Cozinha'];

export const NOME_LONGO = 'Maria Aparecida das Graças de Albuquerque Cavalcanti Montenegro Sobrinha';
export const EMPRESA_LONGA = 'Confeitaria, Cafeteria e Buffet para Eventos Corporativos Doces Momentos da Família Albuquerque Ltda';
export const TITULO_LONGO = 'Atendimento de salão e montagem de mesa de doces para o casamento da família Albuquerque Cavalcanti no Espaço Villa Real';
export const PALAVRA_SEM_ESPACO = 'Supercalifragilisticexpialidocioso_atendimento_de_buffet_corporativo_premium';

const freelaId = (n) => (n === 0 ? ID.freela : id(10, n));

/** @returns {WorkerProfile & Record<string, unknown>} */
function freela(n, extra = {}) {
  return {
    id: freelaId(n), full_name: NOMES[n % NOMES.length], city: 'São Paulo', phone: `(11) 9${8000 + n}-12${String(10 + n).slice(-2)}`,
    cpf: '529.982.247-25', birth_date: '1996-04-12', email: `freela${n}@galeria.invalid`,
    pix_key: n % 3 === 0 ? '52998224725' : `freela${n}@pix.galeria.invalid`,
    primary_role: FUNCOES[n % 10], roles: [FUNCOES[n % 10], FUNCOES[(n + 1) % 10]], tags: [], bio: 'Trabalho com eventos há quatro anos. Pontual e caprichosa no atendimento.',
    avatar_url: null, cover_url: null, photo_url: null, verified_identity: true, level: 3 + (n % 4), xp: 525 + n * 100,
    rating_average: 4.8 - (n % 5) * 0.2, reviews_count: 12 - n, completed_jobs_count: 14 - n, earnings_total: 2380 - n * 90,
    experience_years: '1-2 anos', availability: ['Noite', 'Fim de Semana'], goal: 'Renda extra com quem já confio',
    availability_days: { 0: ['manha', 'tarde'], 5: ['noite'], 6: ['tarde', 'noite'] },
    onboarding_completed: true, accepted_tos: true, badges_hidden: false, accepts_referrals: true, discoverable_for_sos: false,
    created_at: em(-200), updated_at: em(-2), ...extra,
  };
}

function empresa(eid, nome, extra = {}) {
  return {
    id: eid, owner_id: eid === ID.empresa ? ID.empresa : ID.empresa, name: nome, industry: 'Cafeterias e Confeitarias',
    description: 'Confeitaria artesanal com três lojas e operação de eventos nos fins de semana.', website: 'https://momentosdoces.galeria.invalid',
    email: 'contato@momentosdoces.galeria.invalid', address: 'Rua das Acácias, 120 - Pinheiros, São Paulo', city: 'São Paulo', cnpj: '11222333000181', company_type: 'LIMITED', size: '6-20',
    logo_url: null, cover_url: null, rating_average: 4.7, reviews_count: 23, onboarding_completed: true, accepted_tos: true,
    default_briefing: 'Calça preta, camisa branca, sapato fechado. Chegar 15 minutos antes.', link_risk_alert_enabled: true, link_risk_alert_threshold: 2,
    organization_id: ID.org, created_at: em(-300), ...extra,
  };
}

/** @returns {Job & Record<string, unknown>} */
function turno(n, extra) {
  return {
    id: id(20, n), display_code: `T-${100 + n}`, company_id: ID.empresa, title: 'Garçom para evento', description: 'Servir mesas, repor a mesa de doces e apoiar a desmontagem.',
    briefing: 'Calça preta, camisa branca, sapato fechado.', requirements: 'Experiência com eventos.', category: 'Garçom', type: 'freelance', status: 'open',
    location: 'Rua das Acácias, 120 - Pinheiros, São Paulo', start_date: `${dia(1)}T15:00:00+00:00`, work_start_time: '18:00', work_end_time: '23:00',
    estimated_hours: 5, has_lunch: false, budget: 160, budget_period: 'daily', slots: 1, certification_requirement: null, views: 14, series_id: null, series_occurrence_date: null,
    responsible_id: ID.empresa, tag_id: null, created_by: ID.empresa, created_at: em(-6), ...extra,
  };
}

/** @returns {Application & Record<string, unknown>} */
function cand(n, job, worker, status, extra = {}) {
  return {
    id: id(30, n), job_id: id(20, job), worker_id: freelaId(worker), status, cover_letter: null, created_at: em(-4),
    worker_checkin_at: null, worker_checkout_at: null, company_checkin_confirmed_at: null, company_checkout_confirmed_at: null,
    invited_by_company_at: em(-4), invitation_responded_at: status === 'invited' ? null : em(-3), invitation_response: status === 'invited' ? null : 'accepted',
    invitation_expires_at: status === 'invited' ? horas(30) : null, ...extra,
  };
}

const presencaCompleta = (d) => ({
  worker_checkin_at: em(d, '17:55'), company_checkin_confirmed_at: em(d, '18:02'), worker_checkout_at: em(d, '23:05'), company_checkout_confirmed_at: em(d, '23:10'),
});

/** @returns {ShiftPayment & Record<string, unknown>} */
function pagamento(n, job, worker, app, status, extra = {}) {
  return {
    id: id(40, n), job_id: id(20, job), company_id: ID.empresa, worker_id: freelaId(worker), application_id: id(30, app), source: 'external_pix', amount: 160,
    scheduled_for: status === 'scheduled' ? dia(4) : null, paid_at: status === 'scheduled' ? null : em(-1), recorded_by: ID.empresa,
    worker_confirmed_at: null, note: null, status, voided_at: status === 'voided' ? em(-1) : null, void_reason: status === 'voided' ? 'Valor digitado errado.' : null, created_at: em(-2), ...extra,
  };
}

const TERMO = `TERMO DE PRESTAÇÃO DE SERVIÇO AUTÔNOMO EVENTUAL

Contratante: Momentos Doces Confeitaria, CNPJ 11.222.333/0001-81.
Prestador(a): Ana Beatriz Souza, CPF 529.982.247-25.

1. Turno: Garçom para evento, realizado em 22/11/2026, na Rua das Acácias, 120, das 18h às 23h.
2. Segurança e equipamentos: o prestador usa calçado fechado e segue as orientações do local.
3. Condições: serviço eventual, sem exclusividade, sem habitualidade e sem subordinação. Valor ajustado de R$ 160,00, pago diretamente pela contratante.
4. O Worki apenas registra o aceite entre as partes. Não é parte deste termo nem responde pelo pagamento.`;

function banco() {
  const workers = Array.from({ length: 10 }, (_, n) => freela(n));
  const companies = [
    empresa(ID.empresa, 'Momentos Doces Confeitaria'),
    empresa(ID.empresa2, 'Café Girassol', { industry: 'Bares e Restaurantes', rating_average: 4.3, reviews_count: 8 }),
    empresa(ID.empresa3, 'Buffet Villa Real', { industry: 'Buffets e Eventos', rating_average: null, reviews_count: 0 }),
  ];
  const jobs = [
    turno(1, { title: 'Garçom para casamento', slots: 3, start_date: `${dia(1)}T15:00:00+00:00`, certification_requirement: 'Manipulação de alimentos' }),
    turno(2, { title: 'Atendente de balcão', status: 'in_progress', start_date: `${dia(0)}T15:00:00+00:00`, work_start_time: '10:00', work_end_time: '16:00', budget: 130 }),
    turno(3, { title: 'Garçom para evento', status: 'completed', start_date: `${dia(-3)}T15:00:00+00:00`, slots: 4 }),
    turno(4, { title: 'Barista de sábado', start_date: `${dia(3)}T15:00:00+00:00`, series_id: id(60), series_occurrence_date: dia(3), work_start_time: '08:00', work_end_time: '14:00', budget: 140 }),
    turno(5, { title: 'Barista de sábado', start_date: `${dia(10)}T15:00:00+00:00`, series_id: id(60), series_occurrence_date: dia(10), work_start_time: '08:00', work_end_time: '14:00', budget: 140 }),
    turno(6, { title: 'Copeiro para feira', status: 'cancelled', start_date: `${dia(-8)}T15:00:00+00:00` }),
    turno(7, { title: 'Reforço de caixa', start_date: `${dia(0)}T15:00:00+00:00`, work_start_time: '14:00', work_end_time: '20:00', slots: 2 }),
  ];
  const applications = [
    cand(1, 1, 1, 'hired'), cand(2, 1, 2, 'invited'),
    cand(3, 2, 0, 'in_progress', { worker_checkin_at: em(0, '09:55'), company_checkin_confirmed_at: em(0, '10:03') }),
    cand(4, 3, 0, 'completed', presencaCompleta(-3)), cand(5, 3, 3, 'completed', presencaCompleta(-3)), cand(6, 3, 4, 'completed', presencaCompleta(-3)), cand(7, 3, 5, 'completed', presencaCompleta(-3)),
    cand(8, 4, 0, 'hired'),
    cand(9, 7, 6, 'hired', { worker_checkin_at: em(0, '13:50') }),
    cand(10, 1, 7, 'declined', { invitation_response: 'declined' }),
    cand(11, 6, 0, 'cancelled'),
  ];
  const shift_payments = [
    pagamento(1, 3, 0, 4, 'recorded'),
    pagamento(2, 3, 3, 5, 'scheduled'),
    pagamento(3, 3, 4, 6, 'recorded', { worker_confirmed_at: em(-1, '20:00') }),
    pagamento(4, 3, 5, 7, 'voided'),
  ];
  const team_connections = [
    ...[0, 1, 2, 3, 4, 5, 6].map((n) => ({ id: id(50, n + 1), company_id: ID.empresa, worker_id: freelaId(n), status: 'accepted', source: 'link', blocked_by: null, created_at: em(-90 + n), accepted_at: em(-89 + n), updated_at: em(-89 + n), invited_by: ID.empresa })),
    { id: id(50, 20), company_id: ID.empresa, worker_id: freelaId(7), status: 'pending', source: 'phone', blocked_by: null, created_at: em(-2), accepted_at: null, updated_at: em(-2), invited_by: ID.empresa },
    { id: id(50, 21), company_id: ID.empresa2, worker_id: ID.freela, status: 'pending', source: 'link', blocked_by: null, created_at: em(-1), accepted_at: null, updated_at: em(-1) },
    { id: id(50, 22), company_id: ID.empresa3, worker_id: ID.freela, status: 'accepted', source: 'referral', blocked_by: null, created_at: em(-30), accepted_at: em(-29), updated_at: em(-29) },
  ];
  const notif = (n, user_id, type, title, message, link, lida = false) => ({ id: id(70, n), user_id, type, title, message, link, read_at: lida ? em(-1) : null, created_at: horas(-n * 5) });
  return {
    workers, companies, jobs, applications, shift_payments, team_connections,
    job_series: [{ id: id(60), company_id: ID.empresa, recurrence_type: 'weekly', weekdays: [6], range_start_date: dia(3), range_end_date: dia(45), occurrences_generated: 7, status: 'active', created_by: ID.empresa, created_at: em(-7) }],
    job_categories: [{ name: 'Bares e Restaurantes', slug: 'hospitality' }, { name: 'Cafeterias e Confeitarias', slug: 'cafes' }, { name: 'Buffets e Eventos', slug: 'events' }],
    shift_calls: [
      { id: id(80, 1), job_id: id(20, 1), company_id: ID.empresa, created_by: ID.empresa, slots: 3, reason: 'evento', message: 'Casamento grande, preciso de gente de confiança.', targets_count: 4, status: 'open', expires_at: horas(5), created_at: horas(-1), closed_at: null, first_claim_at: horas(-0.8), origin: 'team' },
      { id: id(80, 2), job_id: id(20, 3), company_id: ID.empresa, created_by: ID.empresa, slots: 4, reason: 'pico_previsto', message: null, targets_count: 6, status: 'filled', expires_at: em(-4), created_at: em(-5, '09:00'), closed_at: em(-5, '09:20'), first_claim_at: em(-5, '09:06'), origin: 'team' },
    ],
    shift_call_targets: [
      { id: id(81, 1), call_id: id(80, 1), worker_id: freelaId(1), notified_at: horas(-1), responded_at: horas(-0.8), response: 'accepted', origin: 'team' },
      { id: id(81, 2), call_id: id(80, 1), worker_id: freelaId(3), notified_at: horas(-1), responded_at: horas(-0.5), response: 'declined', origin: 'team' },
      { id: id(81, 3), call_id: id(80, 1), worker_id: freelaId(4), notified_at: horas(-1), responded_at: null, response: null, origin: 'team' },
      { id: id(81, 4), call_id: id(80, 1), worker_id: freelaId(5), notified_at: horas(-1), responded_at: null, response: null, origin: 'team' },
      { id: id(81, 5), call_id: id(80, 2), worker_id: freelaId(0), notified_at: em(-5, '09:00'), responded_at: em(-5, '09:06'), response: 'accepted', origin: 'team' },
    ],
    shift_attendance_confirmations: [
      { id: id(90, 1), application_id: id(30, 1), job_id: id(20, 1), worker_id: freelaId(1), source: 'auto', requested_by: null, requested_at: horas(-3), response: 'confirmed', responded_at: horas(-2) },
      { id: id(90, 2), application_id: id(30, 8), job_id: id(20, 4), worker_id: ID.freela, source: 'manual', requested_by: ID.empresa, requested_at: horas(-3), response: null, responded_at: null },
    ],
    service_terms: [1, 3].map((p) => ({ id: id(41, p), shift_payment_id: id(40, p), job_id: id(20, 3), worker_id: freelaId(p === 1 ? 0 : 4), company_id: ID.empresa, term_version: 'v1', term_text: TERMO, amount: 160, created_at: em(-1), accepted_at: p === 3 ? em(-1, '20:00') : null, accepted_ip: p === 3 ? '203.0.113.10' : null, accepted_user_agent: p === 3 ? 'Chrome em Android' : null, anonymized_at: null })),
    notifications: [
      notif(1, ID.freela, 'payment', 'Pagamento registrado — confirme', 'Momentos Doces registrou o pagamento de R$ 160,00. Abra o recibo e confirme.', `/recibo/${id(20, 3)}`),
      notif(2, ID.freela, 'status_change', 'Pedido de confirmação de presença', 'Confirme se você vai ao turno de sábado.', '/my-jobs'),
      notif(3, ID.freela, 'message', 'Nova mensagem', 'Momentos Doces: Pode chegar um pouco antes?', '/messages', true),
      notif(4, ID.empresa, 'status_change', 'Convite aceito', 'Carlos Eduardo aceitou o turno Garçom para casamento.', `/company/jobs/${id(20, 1)}/candidates`),
      notif(5, ID.empresa, 'status_change', 'Turno cancelado pelo freela', 'Thiago cancelou o turno de amanhã.', `/company/jobs/${id(20, 1)}/candidates`, true),
    ],
    Conversation: [{ id: id(95, 1), application_uuid: id(30, 3), createdat: em(-1), islocked: false }, { id: id(95, 2), application_uuid: id(30, 1), createdat: em(-2), islocked: false }],
    Message: [
      { id: id(96, 1), conversationid: id(95, 1), senderid: ID.empresa, content: 'Oi! Pode chegar 15 minutos antes para a gente alinhar o salão?', createdat: horas(-4), read_at: null },
      { id: id(96, 2), conversationid: id(95, 1), senderid: ID.freela, content: 'Claro, chego às 9h45.', createdat: horas(-3), read_at: horas(-2) },
      { id: id(96, 3), conversationid: id(95, 1), senderid: ID.empresa, content: 'Perfeito. O endereço é o mesmo da semana passada.', createdat: horas(-2), read_at: null },
    ],
    team_lists: [{ id: id(55, 1), company_id: ID.empresa, name: 'Turma de sábado', created_by: ID.empresa, created_at: em(-20), updated_at: em(-20) }, { id: id(55, 2), company_id: ID.empresa, name: 'Garçons de evento', created_by: ID.empresa, created_at: em(-12), updated_at: em(-12) }],
    team_list_members: [[1, 0], [1, 1], [1, 2], [2, 1], [2, 3]].map(([l, w], i) => ({ id: id(56, i + 1), list_id: id(55, l), worker_id: freelaId(w), added_at: em(-10) })),
    reviews: [{ id: id(97, 1), job_id: id(20, 6), application_id: id(30, 11), reviewer_id: ID.empresa, reviewed_id: ID.freela, reviewee_id: ID.freela, rating: 5, comment: 'Excelente atendimento.', direction: 'worker', created_at: em(-7) }],
    worker_certifications: [
      { id: id(98, 1), worker_id: ID.freela, title: 'Manipulação de alimentos', issuer: 'Senac-SP', registration_number: 'MA-48213', issued_at: dia(-340), expires_at: dia(25), verified_by_company_id: ID.empresa, verified_at: em(-100), verified_note: 'Vi o certificado original.', notified_30d_at: null, notified_expired_at: null, created_at: em(-120), updated_at: em(-100) },
      { id: id(98, 2), worker_id: ID.freela, title: 'Curso de barista', issuer: 'Academia do Café', registration_number: null, issued_at: dia(-800), expires_at: dia(-70), verified_by_company_id: null, verified_at: null, verified_note: null, notified_30d_at: null, notified_expired_at: null, created_at: em(-300), updated_at: em(-300) },
    ],
    worker_trainings: [
      { id: id(99, 1), company_id: ID.empresa, worker_id: ID.freela, title: 'Padrão de atendimento da loja', completed_at: dia(-60), note: 'Turma de setembro.', created_by: ID.empresa, created_at: em(-60), revoked_at: null, revoked_reason: null },
      { id: id(99, 2), company_id: ID.empresa, worker_id: ID.freela, title: 'Operação de máquina de espresso', completed_at: dia(-200), note: null, created_by: ID.empresa, created_at: em(-200), revoked_at: em(-20), revoked_reason: 'Registrado na pessoa errada.' },
    ],
    worker_referrals: [{ id: id(65, 1), worker_id: freelaId(2), referring_company_id: ID.empresa, requesting_company_id: ID.empresa2, status: 'awaiting_worker', message: 'Ótima para fins de semana.', created_by: ID.empresa, created_at: em(-2), expires_at: em(12), responded_at: null },
      { id: id(65, 2), worker_id: ID.freela, referring_company_id: ID.empresa, requesting_company_id: ID.empresa2, status: 'awaiting_worker', message: 'Pode confiar, é pontual.', created_by: ID.empresa, created_at: em(-1), expires_at: em(13), responded_at: null }],
    company_invite_links: [{ company_id: ID.empresa, token: 'dG9rZW4tZmFsc28tZGEtZ2FsZXJpYQ' }],
    company_tags: [{ id: id(66, 1), company_id: ID.empresa, name: 'Eventos', archived_at: null }, { id: id(66, 2), company_id: ID.empresa, name: 'Lojas', archived_at: null }],
    company_members: [],
    responsibility_coverages: [],
    analytics_events: [], escrow_transactions: [], wallets: [{ id: id(67), user_id: ID.freela, user_type: 'worker', balance: 0 }, { id: id(67, 2), user_id: ID.empresa, user_type: 'company', balance: 0 }], wallet_transactions: [], payment_methods: [],
  };
}

/** @returns {MyCompany} */
export function minhaEmpresa(extra = {}) {
  return { company_id: ID.empresa, company_name: 'Momentos Doces Confeitaria', role: 'owner', organization_id: ID.org, organization_name: 'Grupo Momentos Doces', onboarding_completed: true, accepted_tos: true, confirmed: true, team_enabled: false, ...extra };
}

/** @returns {Array<Record<string, unknown>>} linhas cruas de `list_company_members` */
export function pessoasDaEquipe() {
  const m = (n, display_name, role, state, extra = {}) => ({
    member_id: id(75, n), user_id: state.startsWith('invite') ? null : id(76, n), display_name, role, status: state.startsWith('invite') ? 'invited' : state === 'removed' ? 'removed' : 'active', state,
    confirmed: state === 'active', accepted_email: state.startsWith('invite') ? null : `${display_name.split(' ')[0].toLowerCase()}@galeria.invalid`, invited_at: em(-3), expires_at: em(11), accepted_at: state.startsWith('invite') ? null : em(-2), confirmed_at: state === 'active' ? em(-2) : null, removed_at: null, confirmation_expires_at: state === 'awaiting_confirmation' ? horas(40) : null, ...extra,
  });
  return [m(1, 'Sabrina Teixeira', 'encarregado', 'awaiting_confirmation'), m(2, 'Roberto Dias', 'encarregado', 'active', { user_id: ID.encarregado }), m(3, 'Fernanda Rocha', 'manager', 'active'), m(4, 'João Pedro', 'encarregado', 'invited'), m(5, 'Camila Prado', 'encarregado', 'invite_expired', { expires_at: em(-2) }), m(6, 'Diego Martins', 'encarregado', 'pending_expired')];
}

const cartaoIndicacao = (n, status) => ({
  referral_id: id(65, 10 + n), status, message: 'Excelente no salão, recomendo.', created_at: em(-2), expires_at: em(12),
  referring_company: { id: ID.empresa2, name: 'Café Girassol', logo_url: null }, worker_id: status === 'accepted' ? freelaId(n) : null,
  card: { full_name: NOMES[n], avatar_url: null, rating_average: 4.6, reviews_count: 9, primary_role: FUNCOES[n], roles: [FUNCOES[n]] },
});

export const marcos = (concluidos = 5) => [
  ['A', 'Entrar na trilha', 1000], ['A', 'Criar o primeiro turno', 1000], ['A', 'Convidar um freela', 1500], ['A', 'Primeira presença confirmada', 1500],
  ['B', '5 turnos com presença dos dois lados', 2500], ['B', '5 pagamentos registrados', 2500], ['C', '15 turnos completos', 4000], ['C', '4 semanas seguidas usando o app', 3500],
  ['D', '30 turnos completos', 6000], ['D', '8 semanas seguidas usando o app', 6500], ['E', 'Coleção completa', 5000],
].map(([group, title, amount_cents], i) => ({
  id: id(77, i + 1), key: `m${i + 1}`, group, sort_order: i, title, amount_cents, counts_in_total: group !== 'E', earned: i < concluidos, earned_at: i < concluidos ? em(-20 + i) : null,
  award_state: i < concluidos ? ['paid', 'paid', 'in_payout', 'available', 'validating'][i % 5] : null, available_at: i < concluidos ? em(2) : null, release_text: i < concluidos ? 'Libera em 2 dias.' : null,
  award_id: i < concluidos ? id(78, i + 1) : null, celebrated: true, progress: i === concluidos ? { current: 3, target: 5, unit: 'turnos' } : null,
}));

export function trilha(status = 'active', extra = {}) {
  return {
    status, ends_at: em(status === 'ended' ? -2 : 52, '23:59'), milestones: ['active', 'ended'].includes(status) ? marcos(5) : [], earned_cents: 7500, releasing_cents: 2500, releasing_until: em(2), release_text: 'R$ 25,00 em conferência.',
    pending_shifts: [{ job_id: id(20, 2), job_title: 'Atendente de balcão', shift_date: dia(0), worker_name: 'Ana Beatriz Souza', missing_stamps: ['worker_checkout', 'company_checkout', 'payment_record'], warnings: [] }],
    available_cents: 3500, min_payout_cents: 2500, requested_payout_cents: null, next_payout_date: dia(5), pix_key_masked: '***.982.***-25',
    payouts: [{ id: id(79), amount_cents: 2000, paid_at: em(-9), milestone_titles: ['Entrar na trilha', 'Criar o primeiro turno'] }], ...extra,
  };
}

function rpcs() {
  return {
    get_my_companies: [minhaEmpresa()],
      my_access_state: { removed: false, has_active: false, owns_company: false },
      get_invite_preview: { outcome: 'ok', inviter_name: 'Momentos Doces Confeitaria', kind: 'elenco' },
    list_team_connection_cards: (_a, m) => ({ outcome: 'ok', items: m.db.team_connections.filter((c) => c.company_id === ID.empresa).map((c) => ({ ...c, worker: m.db.workers.find((w) => w.id === c.worker_id) })) }),
    get_profile_reviews: [
      { review_id: id(97, 11), rating: 5, comment: 'Pagamento certinho e equipe educada.', created_at: em(-5), reviewer_id: null, reviewer_name: 'Carlos E.' },
      { review_id: id(97, 12), rating: 4, comment: null, created_at: em(-18), reviewer_id: null, reviewer_name: 'Juliana R.' },
    ],
    get_worker_company_badges: [
      { company_id: ID.empresa, company_name: 'Momentos Doces Confeitaria', company_logo_url: null, shifts_count: 11, last_shift_at: em(-3), avg_rating: 4.9, reviews_count: 7, hidden: false },
      { company_id: ID.empresa3, company_name: 'Buffet Villa Real', company_logo_url: null, shifts_count: 2, last_shift_at: em(-40), avg_rating: null, reviews_count: 0, hidden: true },
    ],
    set_worker_badge_visibility: true,
    my_link_risk_config: { outcome: 'ok', enabled: true, threshold: 2 },
    count_worker_shifts_by_week: (a) => (a.p_worker_ids || []).slice(0, 2).map((w) => ({ worker_id: w, week_start: dia(-3), shift_count: 3 })),
    get_company_invite_token: 'dG9rZW4tZmFsc28tZGEtZ2FsZXJpYQ',
    list_company_members: { outcome: 'ok', items: [], elenco_link_rotation_pending: false },
    list_company_operators: [{ user_id: ID.empresa, label: 'Você (dona)', role: 'owner' }, { user_id: ID.encarregado, label: 'Roberto Dias', role: 'encarregado' }],
    list_jobs_by_responsible: (_a, m) => ({ outcome: 'ok', truncated: false, items: m.db.jobs.filter((j) => j.company_id === ID.empresa && j.start_date.slice(0, 10) >= dia(0) && j.status !== 'cancelled').map((j) => ({
      job_id: j.id, title: j.title, status: j.status, date: j.start_date.slice(0, 10), start_time: j.work_start_time, slots: j.slots, filled: m.db.applications.filter((a) => a.job_id === j.id && ['hired', 'in_progress', 'completed'].includes(a.status)).length,
      responsible_id: j.responsible_id, responsible_label: j.responsible_id === ID.encarregado ? 'Roberto Dias' : 'Você (dona)', creator_label: 'Você (dona)', tag_id: j.tag_id, tag_name: j.tag_id ? 'Eventos' : null, tag_archived: false })) }),
    get_my_worker_profile: (_a, m) => m.db.workers.find((w) => w.id === m.sessao?.id) ?? null,
    set_my_worker_identity: { outcome: 'saved' },
    get_busy_workers: [],
    get_shift_worker_payment_card: (a, m) => ({ outcome: 'ok', items: m.db.applications.filter((x) => x.job_id === a.p_job_id).map((x) => { const w = m.db.workers.find((y) => y.id === x.worker_id); return { worker_id: w.id, full_name: w.full_name, avatar_url: null, pix_key: w.pix_key, phone: w.phone }; }) }),
    cancel_job: { outcome: 'not_found' },
    sos_call_eligibility: { eligible: false, reason: 'team_not_tried' },
    create_sos_call: { outcome: 'created', call_id: id(80, 9), targets_count: 12, expires_at: horas(2) },
    list_worker_referral_cards: { outcome: 'ok', items: [cartaoIndicacao(7, 'awaiting_worker'), cartaoIndicacao(8, 'accepted'), cartaoIndicacao(9, 'declined')] },
    get_worker_referral_card: (a) => ({ outcome: 'ok', ...cartaoIndicacao(7, 'awaiting_worker'), referral_id: a.p_referral_id, referring_company: { id: ID.empresa, name: 'Momentos Doces Confeitaria', logo_url: null } }),
    create_worker_referral: { outcome: 'created', referral_id: id(65, 30) },
    bonus_get_my_trail: { status: 'not_enrolled' },
    bonus_mark_celebrated: null, bonus_accept_enrollment: { outcome: 'track_not_open' },
    recompute_my_aggregates: null, increment_job_view: null, increment_worker_view: null,
    accept_company_invite_by_token: { id: id(50, 99), company_id: ID.empresa, worker_id: ID.freela, status: 'accepted', source: 'link', created_at: em(0), accepted_at: em(0), updated_at: em(0) },
    accept_manager_invite: { outcome: 'accepted', company_id: ID.empresa, member_id: id(75, 3) },
    accept_company_member_invite: { outcome: 'accepted', company_id: ID.empresa, member_id: id(75, 1), role: 'encarregado', confirmed: false },
    get_member_invite_preview: { outcome: 'ok', company_name: 'Momentos Doces Confeitaria', role: 'encarregado' },
    remove_company_member: { outcome: 'would_remove', member_id: id(75, 2), display_name: 'Roberto Dias', role: 'encarregado', open_jobs: 3, elenco_link_rotation_advised: true, already_removed: false },
    invite_company_member: { outcome: 'invited', member_id: id(75, 7), invite_token: 'token-de-equipe-falso-0001', expires_at: em(14) },
    confirm_company_member: { outcome: 'name_mismatch' },
  };
}

function funcoesAdmin() {
  const info = (nome, tipo) => ({ user_id: id(1), email: `${tipo}@galeria.invalid`, user_type: tipo, name: nome });
  return {
    'admin-data:stats': { stats: { totalWorkers: 42, totalCompanies: 13, totalJobs: 187, totalEscrowReserved: 0, totalEscrowReleased: 0, dbTotalBalance: 0, workerBalances: 0, companyBalances: 0, asaas: null }, transactions: [{ id: id(68), wallet_id: id(67), amount: 0, type: 'credit', description: 'Lançamento de teste', reference_id: 'teste:1', created_at: em(-9), user_info: info('Ana Beatriz Souza', 'work') }] },
    'admin-data:financial_summary': { asaas: null, totalWalletBalances: 0, totalEscrowReserved: 0, totalPlatformFees: 0, depositCount: 0, withdrawalCount: 0, estimatedAsaasCost: 0, netProfit: 0 },
    'admin-data:users': { users: NOMES.map((n, i) => ({ id: id(10, i + 1), email: `usuario${i}@galeria.invalid`, user_type: i % 3 ? 'work' : 'hire', full_name: i === 0 ? NOME_LONGO : n, created_at: em(-30 - i), email_confirmed_at: i % 4 ? em(-29) : null, last_sign_in_at: i % 5 ? em(-1) : null, profile: {}, balance: 0 })) },
    'admin-data:escrows': { escrows: [{ id: id(69), job_id: id(20, 3), application_id: id(30, 4), amount: 160, status: 'refunded', created_at: em(-40), released_at: null, company_wallet_id: id(67, 2), worker_wallet_id: id(67), job: { title: 'Garçom para evento', company_id: ID.empresa }, company_info: info('Momentos Doces', 'hire'), worker_info: info('Ana Beatriz Souza', 'work') }] },
    'admin-data:bonus_review_queue': { items: [{ ledgerId: id(71), operatorName: 'Sabrina Teixeira', companyName: 'Momentos Doces', jobTitle: 'Garçom para casamento', workerName: 'Carlos Eduardo Lima', flags: ['same_pix', 'short_shift'], valueAtStakeCents: 2500, flaggedAt: em(-1), reviewDueAt: em(2) }] },
    'admin-data:bonus_payouts': { items: [{ payoutId: id(72), operatorName: 'Roberto Dias', companyName: 'Momentos Doces', amountCents: 5500, pixKey: 'roberto@pix.galeria.invalid', scheduledFor: dia(5), blocked: false, blockReason: null, payable: true, milestones: [{ title: '5 pagamentos registrados', amountCents: 2500 }, { title: 'Primeira presença confirmada', amountCents: 3000 }] }, { payoutId: id(72, 2), operatorName: 'Sabrina Teixeira', companyName: 'Momentos Doces', amountCents: 2500, pixKey: '52998224725', scheduledFor: dia(5), blocked: true, blockReason: 'pix_match', payable: false, milestones: [{ title: 'Criar o primeiro turno', amountCents: 2500 }] }] },
    'admin-data:bonus_vetos': { items: [{ personId: id(10, 3), personName: 'Marcos Vinícius Alves', reason: 'Sócio do Worki', createdAt: em(-15) }] },
    'admin-data:bonus_tracks': { items: [{ trackKey: 'eventos', name: 'Trilha de eventos', status: 'open', capCents: 30000, params: { semanas: 12, minimo_turno_horas: 3 } }, { trackKey: 'lojas', name: 'Trilha de lojas', status: 'calibrating', capCents: 30000, params: { semanas: 12, turnos_por_semana: null } }] },
    'admin-data:bonus_tracking': { activeOperators: 3, maxExposureCents: 90000, earnedCents: 22500, availableCents: 8000, paidCents: 6000, milestonesByWeek: [{ weekStart: dia(-21), count: 3 }, { weekStart: dia(-14), count: 6 }, { weekStart: dia(-7), count: 4 }], habit: [{ operatorName: 'Roberto Dias', baselineWeeklyAvg: 1.5, avgWeeks1to12: 3.2, avgWeeks13to16: null }], habitAvailable: true },
    'admin-data:bonus_params_history': { items: [{ id: id(73), at: em(-12), actorLabel: 'admin@galeria.invalid', summary: 'Trilha de eventos: semanas 10 para 12.' }] },
    'admin-data:bonus_enrollments': { items: [{ enrollmentId: id(74), trackKey: 'eventos', displayName: 'Sabrina Teixeira', companyName: 'Momentos Doces', status: 'invited', companyAckAt: null, companyAckByLabel: null, acceptedAt: null, endsAt: null, payoutBlockReason: null, evaluationFailed: false }, { enrollmentId: id(74, 2), trackKey: 'eventos', displayName: 'Roberto Dias', companyName: 'Momentos Doces', status: 'active', companyAckAt: em(-30), companyAckByLabel: 'Dona Marta', acceptedAt: em(-29), endsAt: em(52), payoutBlockReason: 'identity', evaluationFailed: true }] },
    'admin-data:bonus_settings': { enabled: false },
    'admin-data:bonus_alerts': { items: [{ id: id(74, 9), at: em(-1), kind: 'voided_late', operatorName: 'Roberto Dias', blockReason: null }], evaluationFailed: ['Roberto Dias'] },
  };
}

const PAPEIS = {
  anon: null,
  freela: { id: ID.freela, tipo: 'work', email: 'ana@galeria.invalid' },
  empresa: { id: ID.empresa, tipo: 'hire', email: 'dona@galeria.invalid' },
  encarregado: { id: ID.encarregado, tipo: 'hire', email: 'roberto@galeria.invalid' },
  admin: { id: ID.admin, tipo: 'hire', email: 'admin@galeria.invalid' },
};

export function usuario(papel) {
  const p = PAPEIS[papel];
  if (!p) return null;
  return { id: p.id, aud: 'authenticated', role: 'authenticated', email: p.email, email_confirmed_at: em(-100), user_metadata: { user_type: p.tipo }, app_metadata: { provider: 'email' }, identities: [{ id: '1' }], created_at: em(-100) };
}

export function criarMundo(papel = 'anon') {
  const sessao = usuario(papel);
  const expira = Math.floor(AGORA.getTime() / 1000) + 365 * 86400;
  const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
  const token = `${b64({ alg: 'HS256', typ: 'JWT' })}.${b64({ sub: sessao?.id ?? ID.freela, exp: expira, role: 'authenticated' })}.assinatura-falsa`;
  const mundo = { papel, sessao, token, expira, agora: AGORA.toISOString(), usuarioNovo: usuario('freela'), db: banco(), rpc: rpcs(), fn: funcoesAdmin(), falhas: {}, auth: {}, modulos: null };
  if (papel === 'encarregado') {
    mundo.rpc.get_my_companies = [minhaEmpresa({ role: 'encarregado', team_enabled: true })];
    mundo.db.jobs.forEach((j) => { if ([2, 7].some((n) => j.id === id(20, n))) j.responsible_id = ID.encarregado; });
  }
  // Imitação mínima do RLS onde a falta dele mudaria a tela: o freela só lê os próprios pagamentos.
  mundo.rls = papel === 'freela' ? { shift_payments: (r) => r.worker_id === ID.freela, service_terms: (r) => r.worker_id === ID.freela } : {};
  // Atalhos usados pelos cenários.
  mundo.empresa = (extra) => { mundo.rpc.get_my_companies = [minhaEmpresa(extra)]; };
  mundo.comEquipe = () => { mundo.empresa({ team_enabled: true }); mundo.rpc.list_company_members = { outcome: 'ok', items: pessoasDaEquipe(), elenco_link_rotation_pending: false }; mundo.db.jobs[6].responsible_id = ID.encarregado; mundo.db.jobs[0].tag_id = id(66, 1); };
  mundo.vazio = (...tabelas) => { for (const t of tabelas) mundo.db[t] = []; };
  mundo.eu = () => mundo.db.workers[0];
  mundo.job = (n) => mundo.db.jobs[n - 1];
  mundo.app = (n) => mundo.db.applications[n - 1];
  return mundo;
}
