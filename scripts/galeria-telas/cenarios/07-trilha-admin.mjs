import { grupoDe } from '../lib/cenario.mjs';
import { id, em, dia, trilha, marcos, AGORA } from '../fixtures/world.mjs';

const t = grupoDe('trilha');
const ad = grupoDe('admin');
const URL = '/company/trilha';
const com = (snap) => (m) => { m.rpc.bonus_get_my_trail = snap; };
const fase = (nome, regra, snap, espera, extra = {}) => t(nome, 'empresa', URL, regra, { prep: com(snap), espera, ...extra });
const aba = (n) => ({ clicar: new RegExp(n, 'i') });
const painel = (n) => [aba('Trilha|B[oô]nus'), ...(n ? [{ clicar: new RegExp(`^${n}$`, 'i') }] : [])];
const semSessao = { prep: (m) => { m.sessao = null; } };

export default [
  fase('desligada', 'enabled=false', { status: 'disabled' }, 'Trilha'),
  fase('sem-inscricao', 'not_enrolled', { status: 'not_enrolled' }, 'Trilha'),
  fase('sem-login-proprio', 'identity_required', { status: 'identity_required' }, 'próprio acesso'),
  fase('convidada', 'invited: aceite do regulamento', trilha('invited'), 'Entrar na trilha'),
  fase('convidada-cadastrar-pix', 'convite: formulário da chave PIX', trilha('invited'), 'PIX', { passos: [{ clicar: 'Cadastrar chave PIX' }] }),
  fase('aceite-falhou', 'accept outcome=track_not_open', trilha('invited'), 'regulamento', { passos: [{ css: 'input[type=checkbox]' }, { clicar: 'Entrar na trilha' }] }),
  fase('ativa', 'active com turnos quase lá e saque disponível', trilha('active'), 'marcos concluídos'),
  fase('ativa-inicial', 'dia 1: dois marcos, nada disponível, sem PIX', trilha('active', { milestones: marcos(2), earned_cents: 2000, releasing_cents: 0, releasing_until: null, release_text: null, available_cents: 0, pending_shifts: [], pix_key_masked: null, payouts: [] }), 'marcos concluídos'),
  fase('ativa-abaixo-do-minimo', 'disponível menor que R$25', trilha('active', { available_cents: 1500 }), 'marcos'),
  fase('pagamento-solicitado', 'requested_payout_cents', trilha('active', { requested_payout_cents: 3500, available_cents: 0 }), 'marcos'),
  fase('celebracao', 'marco conquistado ainda não celebrado', trilha('active', { milestones: marcos(5).map((m, i) => (i === 4 ? { ...m, celebrated: false } : m)) }), 'marcos'),
  fase('todos-concluidos', 'coleção completa e teto atingido', trilha('active', { milestones: marcos(11), earned_cents: 30000, available_cents: 30000, pending_shifts: [] }), '11 de|marcos'),
  fase('encerrada', 'ended', trilha('ended', { pending_shifts: [] }), 'terminou'),
  t('erro', 'empresa', URL, 'falha ao carregar', { prep: (m) => { m.falhas['rpc:bonus_get_my_trail'] = 'erro'; }, erroEsperado: true, espera: 'Tentar de novo' }),
  t('carregando', 'empresa', URL, 'consulta pendurada', { prep: (m) => { m.falhas['rpc:bonus_get_my_trail'] = 'pendura'; }, carregandoEsperado: true }),
  t('encarregado-ativa', 'encarregado', URL, 'trilha vista pelo Encarregado', { prep: com(trilha('active')), espera: 'marcos' }),

  ad('login', 'anon', '/admin', 'rota protegida sem sessão volta à raiz', { espera: 'Quero trabalhar' }),
  ad('acesso-negado', 'empresa', '/admin', 'e-mail fora de ADMIN_EMAILS', { espera: 'Acesso negado' }),
  ad('visao-geral', 'admin', '/admin', 'aba dashboard', { espera: '187|Admin' }),
  ad('usuarios', 'admin', '/admin', 'aba usuários', { passos: [aba('Usu[aá]rios')], espera: 'usuario1@' }),
  ad('escrows', 'admin', '/admin', 'aba escrows', { passos: [aba('Escrow|Cust[oó]dia|Reservas')], espera: 'Garçom para evento' }),
  ad('bonus-conferencia', 'admin', '/admin', 'trilha: fila de conferência', { passos: painel('Conferência'), espera: 'Sabrina' }),
  ad('bonus-inscricoes', 'admin', '/admin', 'trilha: inscrições', { passos: painel('Inscrições'), espera: 'Sabrina' }),
  ad('bonus-pix', 'admin', '/admin', 'trilha: PIX da segunda, com bloqueado', { passos: painel('PIX da segunda'), espera: 'Roberto' }),
  ad('bonus-vetos', 'admin', '/admin', 'trilha: vetos e limiares', { passos: painel('Vetos e limiares'), espera: 'Sócio do Worki' }),
  ad('bonus-acompanhamento', 'admin', '/admin', 'trilha: acompanhamento', { passos: painel('Acompanhamento'), espera: 'Roberto|exposi' }),
  ad('bonus-vazio', 'admin', '/admin', 'filas vazias', { prep: (m) => { m.fn['admin-data:bonus_review_queue'] = { items: [] }; }, passos: painel('Conferência'), espera: 'Nada|Nenhum|vazia' }),
  ad('erro', 'admin', '/admin', 'edge function falha', { prep: (m) => { m.falhas['fn:admin-data'] = 'erro'; }, erroEsperado: true, espera: 'Admin|erro' }),
];
