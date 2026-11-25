import { grupoDe, aria } from '../lib/cenario.mjs';
import { ID, id, em, dia } from '../fixtures/world.mjs';

const c = grupoDe('freela-telas');
const mj = grupoDe('freela-turnos');
const iv = grupoDe('freela-convite-turno');
const pg = grupoDe('pagamento-recibo');
const pf = grupoDe('freela-perfil');

const TABELAS = ['applications', 'shift_payments', 'team_connections', 'shift_call_targets', 'shift_calls', 'shift_attendance_confirmations', 'reviews', 'notifications', 'Conversation', 'Message', 'worker_referrals', 'worker_certifications', 'worker_trainings', 'service_terms'];
const vazio = (m) => { m.vazio(...TABELAS); m.rpc.get_worker_company_badges = []; m.rpc.get_profile_reviews = []; m.rpc.list_worker_referral_cards = { outcome: 'ok', items: [] }; };
const falhar = (tipo, ...tabelas) => (m) => { for (const t of tabelas) m.falhas[`rest:${t}`] = tipo; };
/** Já avaliou tudo: evita o modal de avaliação automático em Meus Turnos. */
const jaAvaliou = (m) => { m.db.reviews.push({ id: id(97, 5), job_id: m.job(3).id, reviewer_id: ID.freela, reviewed_id: ID.empresa, rating: 5, direction: 'company', created_at: em(-2) }); };
/** Chamado de turno aberto em que o freela é um dos alvos (gera o InviteTakeover). */
export const comConvite = (alvos = 4, extra = {}) => (m) => {
  m.db.shift_calls.push({ id: id(80, 5), job_id: m.job(5).id, company_id: ID.empresa, created_by: ID.empresa, slots: 2, reason: 'falta', message: 'Faltou gente, consegue cobrir?', targets_count: alvos, status: 'open', expires_at: em(1, '12:00'), created_at: em(0, '12:00'), origin: 'team', ...extra });
  m.db.shift_call_targets.push({ id: id(81, 20), call_id: id(80, 5), worker_id: ID.freela, notified_at: em(0, '12:00'), responded_at: null, response: null, origin: extra.origin || 'team' });
};
const conviteLegado = (m) => { m.db.applications.push({ id: id(30, 40), job_id: m.job(5).id, worker_id: ID.freela, status: 'invited', invited_by_company_at: em(-1), invitation_expires_at: em(1), created_at: em(-1) }); };
const fecharConvite = { clicar: 'Fechar aviso de convite' };
const recibo = (job = 3) => `/recibo/${id(20, job)}`;
const soPagamento = (status, extra = {}) => (m) => { const p = m.db.shift_payments[0]; Object.assign(p, { status, ...extra }); if (status === 'scheduled') Object.assign(p, { paid_at: null, scheduled_for: dia(4) }); };
const aba = (nome) => ({ clicar: new RegExp(`^${nome}`) });

export default [
  c('inicio', 'freela', '/dashboard', 'com próximo turno e recebimento a confirmar', { espera: 'Fala, Ana' }),
  c('inicio-com-convite', 'freela', '/dashboard', 'convite pendente, takeover fechado', { prep: (m) => { comConvite()(m); m.db.shift_payments = []; }, passos: [fecharConvite], espera: 'Convite pendente' }),
  c('inicio-vazio', 'freela', '/dashboard', 'conta nova sem nada', { prep: (m) => { vazio(m); Object.assign(m.eu(), { xp: 0, level: 1, rating_average: null, reviews_count: 0, completed_jobs_count: 0, earnings_total: 0, avatar_url: null, roles: [], primary_role: null, availability_days: null }); }, espera: 'Fala' }),
  c('inicio-carregando', 'freela', '/dashboard', 'consultas penduradas', { prep: falhar('pendura', 'applications', 'shift_payments', 'team_connections', 'shift_call_targets'), carregandoEsperado: true }),
  c('inicio-erro-parcial', 'freela', '/dashboard', 'parte das consultas falha (ErroDeCarga)', { prep: falhar('erro', 'applications', 'shift_payments'), erroEsperado: true, espera: 'não carregou|Tentar de novo', pausa: 9000 }),
  c('carteira', 'freela', '/carteira', 'empresas do elenco + convite de elenco pendente', { espera: 'Buffet Villa Real' }),
  c('carteira-vazia', 'freela', '/carteira', 'sem conexões', { prep: vazio, espera: 'ainda não tem empresas' }),
  c('carteira-erro', 'freela', '/carteira', 'falha de carga', { prep: falhar('erro', 'team_connections'), erroEsperado: true, espera: 'Tentar de novo' }),
  c('carteira-sair-empresa', 'freela', '/carteira', 'confirmação de sair do elenco', { passos: [{ css: '[aria-label="Sair da empresa Buffet Villa Real"]' }], espera: 'Sair de Buffet Villa Real' }),
  c('carteira-recusar-elenco', 'freela', '/carteira', 'recusar convite de elenco', { passos: [{ clicar: /^Recusar/ }], espera: '2 empresas' }),
  c('empresa-publica', 'freela', `/empresa/${ID.empresa}`, 'perfil público antes de aceitar convite', { espera: 'Momentos Doces' }),
  c('empresa-publica-sem-avaliacao', 'freela', `/empresa/${ID.empresa3}`, 'sem nota nem avaliações', { prep: (m) => { m.rpc.get_profile_reviews = []; }, espera: 'Buffet Villa Real' }),
  c('empresa-publica-inexistente', 'freela', `/empresa/${id(9, 9)}`, 'id inexistente', { espera: 'não encontrada' }),
  c('indicacoes', 'freela', '/indicacoes', 'indicação aguardando o freela', { espera: 'indic' }),
  c('indicacoes-vazio', 'freela', '/indicacoes', 'sem indicação', { prep: (m) => { m.db.worker_referrals = []; }, espera: 'Nenhuma indicação' }),
  c('mensagens', 'freela', '/messages', 'lista de conversas', { espera: 'Momentos Doces' }),
  c('mensagens-conversa', 'freela', `/messages?conversation=${id(95, 1)}`, 'conversa aberta', { espera: '15 minutos antes' }),
  c('mensagens-vazio', 'freela', '/messages', 'sem conversa', { prep: vazio, espera: 'conversa|mensagen' }),
  c('mensagens-erro', 'freela', '/messages', 'falha de carga', { prep: falhar('erro', 'Conversation'), erroEsperado: true, espera: 'Tentar de novo' }),
  c('notificacoes', 'freela', '/notifications', 'lidas e não lidas', { espera: 'Pagamento registrado' }),
  c('notificacoes-vazio', 'freela', '/notifications', 'nenhuma', { prep: (m) => { m.db.notifications = []; }, espera: 'Notifica' }),
  c('sino-aberto', 'freela', '/dashboard', 'dropdown do sino', { passos: [{ css: 'button[aria-label*="otifica" i]' }], espera: 'Pagamento registrado' }),

  mj('convites', 'freela', '/my-jobs', 'aba Convites com chamado disputado', { prep: (m) => { jaAvaliou(m); comConvite()(m); }, passos: [fecharConvite], espera: 'Aceitar' }),
  mj('convites-vazio', 'freela', '/my-jobs', 'aba Convites vazia', { prep: (m) => { vazio(m); }, espera: 'convite' }),
  mj('convite-recusa-armada', 'freela', '/my-jobs', 'recusar pede segundo toque', { prep: (m) => { jaAvaliou(m); conviteLegado(m); }, passos: [fecharConvite, { clicar: /^Recusar$/ }], espera: 'de novo|Confirmar' }),
  mj('confirmar-presenca', 'freela', '/my-jobs', 'pedido de confirmação de véspera em aberto', { prep: jaAvaliou, espera: 'Sim, vou' }),
  mj('presenca-respondida', 'freela', '/my-jobs', 'resposta enviada', { prep: (m) => { jaAvaliou(m); m.rpc.respond_attendance_confirmation = { outcome: 'confirmed' }; }, passos: [{ clicar: 'Sim, vou' }], espera: 'confirm' }),
  mj('em-andamento', 'freela', '/my-jobs', 'turno em andamento (check-out)', { prep: jaAvaliou, passos: [aba('Em Andamento')], espera: 'Atendente de balcão' }),
  mj('agendados', 'freela', '/my-jobs', 'turnos agendados', { prep: jaAvaliou, passos: [aba('Agendados')], espera: 'Barista de sábado' }),
  mj('checkin', 'freela', '/my-jobs', 'turno de hoje aguardando chegada', { prep: (m) => { jaAvaliou(m); const a = m.app(3); Object.assign(a, { status: 'hired', worker_checkin_at: null, company_checkin_confirmed_at: null }); m.job(2).work_start_time = '13:15'; m.job(2).work_end_time = '19:00'; }, passos: [aba('Em Andamento')], espera: 'Check-in' }),
  mj('historico', 'freela', '/my-jobs', 'concluídos e cancelados', { prep: jaAvaliou, passos: [aba('Histórico')], espera: 'Garçom para evento' }),
  mj('detalhe', 'freela', '/my-jobs', 'modal de detalhe do turno', { prep: jaAvaliou, passos: [aba('Histórico'), { clicar: /Garçom para evento/ }], espera: 'Garçom para evento' }),
  mj('cancelar-turno', 'freela', '/my-jobs', 'modal de cancelamento pelo freela', { prep: jaAvaliou, passos: [aba('Agendados'), { clicar: /^Cancelar turno/ }], espera: 'Cancelar este turno' }),
  mj('avaliar', 'freela', '/my-jobs', 'RateModal abre sozinho para turno concluído sem avaliação', { espera: 'Comentário' }),
  mj('erro', 'freela', '/my-jobs', 'falha de carga', { prep: falhar('erro', 'applications', 'reviews'), erroEsperado: true, espera: 'Tentar de novo' }),

  iv('chamado-disputado', 'freela', '/dashboard', 'InviteTakeover: chamado 1→N', { prep: comConvite(), espera: 'Convite de turno' }),
  iv('chamado-individual', 'freela', '/dashboard', 'InviteTakeover: só um alvo', { prep: comConvite(1), espera: 'Convite de turno' }),
  iv('chamado-sos', 'freela', '/dashboard', 'InviteTakeover vindo de SOS (fora do elenco)', { prep: comConvite(12, { origin: 'sos' }), espera: 'Convite de turno' }),
  iv('legado', 'freela', '/dashboard', 'InviteTakeover: application invited', { prep: conviteLegado, espera: 'Convite de turno' }),
  iv('recusa-armada', 'freela', '/dashboard', 'primeiro toque em Recusar', { prep: comConvite(), passos: [{ clicar: /^Recusar/ }], espera: 'Convite de turno' }),
  iv('aceito', 'freela', '/dashboard', 'claim_shift_slot=claimed', { prep: (m) => { comConvite()(m); m.rpc.claim_shift_slot = (_a, w) => { w.db.shift_call_targets.at(-1).response = 'accepted'; return { outcome: 'claimed' }; }; }, passos: [{ clicar: /^Aceitar/ }], espera: 'Vaga garantida' }),
  iv('perdeu-a-corrida', 'freela', '/dashboard', 'claim_shift_slot=filled', { prep: (m) => { comConvite()(m); m.rpc.claim_shift_slot = { outcome: 'filled' }; }, passos: [{ clicar: /^Aceitar/ }], espera: 'aceitou primeiro' }),
  iv('texto-longo', 'freela', '/dashboard', 'empresa, título, endereço e briefing longos', { prep: (m) => { comConvite()(m); m.db.companies[0].name = 'Confeitaria, Cafeteria e Buffet para Eventos Corporativos Doces Momentos da Família Albuquerque Ltda'; Object.assign(m.job(5), { title: 'Atendimento de salão e montagem de mesa de doces para o casamento da família Albuquerque Cavalcanti no Espaço Villa Real', location: 'Avenida Professor Doutor Francisco Morato de Oliveira Albuquerque, 12.345, bloco B, 7º andar, Jardim das Palmeiras Imperiais, São Paulo', briefing: 'Chegar 40 minutos antes. '.repeat(30), budget: 12500 }); }, espera: 'Convite de turno' }),

  pg('recibo-registrado-confirmar', 'freela', recibo(), 'recorded sem confirmação + termo a aceitar', { espera: 'Recibo de Pagamento' }),
  pg('recibo-termo-aberto', 'freela', recibo(), 'termo expandido', { passos: [{ clicar: 'Ler o termo inteiro' }], espera: 'TERMO DE PRESTAÇÃO' }),
  pg('recibo-termo-marcado', 'freela', recibo(), 'termo lido e concordância marcada', { passos: [{ clicar: 'Ler o termo inteiro' }, { css: 'input[type=checkbox]' }], espera: 'TERMO DE PRESTAÇÃO' }),
  pg('recibo-sem-cpf', 'freela', recibo(), 'termo com CPF não informado (bloqueia aceite)', { prep: (m) => { m.db.service_terms[0].term_text = m.db.service_terms[0].term_text.replace(/CPF [\d.-]+/, 'CPF: não informado'); }, espera: 'CPF' }),
  pg('recibo-confirmado', 'freela', recibo(), 'recebimento confirmado e termo aceito', { prep: (m) => { soPagamento('recorded', { worker_confirmed_at: em(0, '09:00') })(m); Object.assign(m.db.service_terms[0], { accepted_at: em(0, '09:00'), accepted_ip: '203.0.113.7', accepted_user_agent: 'Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 Chrome/141.0 Mobile Safari/537.36' }); }, espera: 'Termo aceito' }),
  pg('recibo-agendado', 'freela', recibo(), 'status scheduled: comprovante de agendamento', { prep: soPagamento('scheduled'), espera: 'Comprovante de Agendamento' }),
  pg('recibo-estornado', 'freela', recibo(), 'voided não aparece: recibo não encontrado', { prep: soPagamento('voided', { voided_at: em(0) }), espera: 'não encontrado' }),
  pg('recibo-termo-falhou', 'freela', recibo(), 'leitura do termo falha: confirmação bloqueada', { prep: falhar('erro', 'service_terms'), erroEsperado: true, espera: 'Não foi possível verificar o termo' }),
  pg('recibo-sem-presenca-nota', 'freela', recibo(), 'sem horários, dinheiro, com nota longa e valor zero', { prep: (m) => { Object.assign(m.db.shift_payments[0], { amount: 0, source: 'cash', note: 'Pago em dinheiro no fim do turno, incluindo a ajuda de custo do transporte e o jantar. '.repeat(3) }); Object.assign(m.app(4), { worker_checkin_at: null, worker_checkout_at: null }); }, espera: 'Recibo' }),
  pg('recibo-empresa', 'empresa', `${recibo()}?worker=${ID.freela}`, 'empresa vê o recibo (aguarda aceite)', { espera: 'Aguardando aceite' }),
  pg('recibo-erro', 'freela', recibo(), 'falha de carga', { prep: falhar('erro', 'shift_payments'), erroEsperado: true, espera: 'Tentar de novo' }),
  pg('recebimentos', 'freela', '/recebimentos', 'a confirmar, agendado, recebido, cancelado', { prep: (m) => { m.db.shift_payments.forEach((p) => { p.worker_id = ID.freela; }); m.db.shift_payments[1].job_id = m.job(2).id; m.db.shift_payments[2].job_id = m.job(4).id; m.db.shift_payments[3].job_id = m.job(6).id; }, espera: 'Total recebido' }),
  pg('recebimentos-vazio', 'freela', '/recebimentos', 'sem pagamento', { prep: (m) => { m.db.shift_payments = []; }, espera: 'pagamento|recebimento' }),
  pg('recebimentos-erro', 'freela', '/recebimentos', 'falha de carga', { prep: falhar('erro', 'shift_payments'), erroEsperado: true, espera: 'Tentar de novo' }),

  pf('visao', 'freela', '/profile', 'perfil completo: badges, certificações, SOS, indicações', { espera: 'Ana Beatriz' }),
  pf('vazio', 'freela', '/profile', 'sem CPF, PIX, disponibilidade, badges e certificados', { prep: (m) => { Object.assign(m.eu(), { cpf: null, pix_key: null, bio: null, availability_days: null, availability: [], roles: [], primary_role: null, city: null, phone: null, xp: 0, level: 1, rating_average: null, reviews_count: 0 }); m.db.worker_certifications = []; m.db.worker_trainings = []; m.rpc.get_worker_company_badges = []; m.rpc.get_profile_reviews = []; }, espera: 'Cadastrar CPF|disponibilidade' }),
  pf('editando', 'freela', '/profile', 'modo edição (disponibilidade em grade)', { passos: [{ clicar: /^Editar/ }], espera: 'Salvar' }),
  pf('badges-ocultos', 'freela', '/profile', 'chave-mestra de badges ligada', { prep: (m) => { m.eu().badges_hidden = true; }, espera: 'Mostrar onde já trabalhei' }),
  pf('badges-erro', 'freela', '/profile', 'RPC de selos falha', { prep: (m) => { m.falhas['rpc:get_worker_company_badges'] = 'erro'; }, erroEsperado: true, espera: 'selos' }),
  pf('sos-ligado', 'freela', '/profile', 'discoverable_for_sos=true', { prep: (m) => { m.eu().discoverable_for_sos = true; m.eu().accepts_referrals = false; }, espera: 'Descoberta ativ|Desativar' }),
  pf('certificacao-nova', 'freela', '/profile', 'modal de cadastro de certificação', { passos: [{ clicar: /^Cadastrar$/ }], espera: 'certificação' }),
  pf('certificacao-editar', 'freela', '/profile', 'editar certificação conferida', { passos: [{ css: aria('Editar certificação Manipulação de alimentos') }], espera: 'Manipulação' }),
  pf('certificacao-excluir', 'freela', '/profile', 'confirmar exclusão', { passos: [{ css: aria('Excluir certificação Curso de barista') }], espera: 'Excluir certificação' }),
  pf('meu-qr', 'freela', '/profile', 'modal QR de identidade', { passos: [{ clicar: /QR/ }], espera: 'Meu QR de identidade' }),
  pf('conta', 'freela', '/profile', 'configurações de conta abertas', { passos: [{ clicar: /Segurança|Conta|Configurações/ }], espera: 'Zona de perigo' }),
  pf('excluir-conta', 'freela', '/profile', 'modal de exclusão de conta', { passos: [{ clicar: /Segurança|Conta|Configurações/ }, { clicar: 'Excluir minha conta' }], espera: 'irreversível' }),
  pf('erro', 'freela', '/profile', 'falha ao carregar perfil', { prep: (m) => { let n = 0; Object.defineProperty(m.falhas, 'rest:workers', { get: () => (++n > 1 ? 'erro' : undefined), enumerable: true }); }, erroEsperado: true, espera: 'Tentar de novo|erro' }),
];
