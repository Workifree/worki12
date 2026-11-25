import { grupoDe } from '../lib/cenario.mjs';
import { ID } from '../fixtures/world.mjs';

const el = grupoDe('convite-elenco');
const ge = grupoDe('convite-gerente');
const eq = grupoDe('convite-equipe');

const b64 = (s) => Buffer.from(s).toString('base64url');
const URL_EMPRESA = `/convite/${b64(ID.empresa)}`;
const URL_FREELA = `/convite/w_${b64(ID.freela)}`;
const URL_GE = '/convite-gerente/token-gerente-falso';
const URL_EQ = '/convite-equipe/token-de-equipe-falso-0001';
const preview = (v) => (m) => { m.rpc.get_member_invite_preview = v; };
const outcome = (o) => (m) => { m.rpc.accept_company_member_invite = { outcome: o, company_id: ID.empresa }; };
const erroRpc = (nome, message) => (m) => { m.falhas[`rpc:${nome}`] = { status: 400, body: { message, code: 'P0001' } }; };
const marcarTos = { marcar: '#team-invite-tos' };
const pedirCodigo = [{ preencher: ['input[type=email]', 'roberto@galeria.invalid'] }, marcarTos, { clicar: 'Receber código' }];
const comCodigo = [...pedirCodigo, { preencher: ['input[inputmode=numeric]', '123456'] }, { clicar: 'Entrar na equipe' }];
const semConta = (m) => { m.auth.verify = () => ({ body: { access_token: m.token, refresh_token: 'r', token_type: 'bearer', expires_in: 31536000, expires_at: m.expira, user: { ...m.usuarioNovo, email: 'roberto@galeria.invalid', user_metadata: { user_type: 'hire' } } } }); };
const entrar = [marcarTos, { clicar: 'Entrar na equipe' }];
const semVinculo = (m) => { m.db.team_connections = m.db.team_connections.filter((x) => x.worker_id !== ID.freela); };

const desfechos = [['expired', 'Convite vencido'], ['revoked', 'Convite cancelado'], ['token_already_used', 'Link já usado'], ['not_found', 'Link inválido'], ['worker_cannot_be_manager', 'conta de freela'], ['use_manager_invite', 'convite é de Gestor'], ['email_not_verified', 'confirmar seu e-mail'], ['invalid_input', 'Não foi possível entrar'], ['unauthenticated', 'sessão expirou'], ['error', 'Não foi possível processar']];

export default [
  el('deslogado-vai-ao-login', 'anon', URL_EMPRESA, 'sem sessão: guarda o token e manda ao login', { espera: 'Começar a Trabalhar|Criar Conta' }),
  el('contato-freela-deslogado', 'anon', URL_FREELA, 'token w_ deslogado: login de empresa', { espera: 'Contratar Talentos|Criar Conta' }),
  el('processando', 'freela', URL_EMPRESA, 'RPC em andamento', { prep: (m) => { m.falhas['rpc:accept_company_invite_by_token'] = 'pendura'; }, carregandoEsperado: true, espera: 'Processando convite' }),
  el('aceito', 'freela', URL_EMPRESA, 'success', { prep: semVinculo, espera: 'Convite Aceito' }),
  el('freela-convidado', 'empresa', URL_FREELA, 'empresa abre link de contato (success)', { prep: (m) => { m.db.team_connections = []; }, espera: 'Freela Convidado' }),
  el('ja-no-elenco', 'empresa', URL_FREELA, 'alreadyExists', { espera: 'Já está no seu elenco' }),
  el('bloqueado', 'empresa', URL_FREELA, 'conexão blocked (mensagem neutra)', { prep: (m) => { m.db.team_connections[0].status = 'blocked'; }, espera: 'Não Foi Possível Concluir' }),
  el('papel-errado', 'empresa', URL_EMPRESA, 'empresa abre link de elenco (not_a_worker)', { prep: erroRpc('accept_company_invite_by_token', 'not_a_worker'), espera: 'Apenas freelas' }),
  el('invalido', 'freela', URL_EMPRESA, 'invalid_token', { prep: erroRpc('accept_company_invite_by_token', 'invalid_token'), espera: 'inválido ou expirado' }),
  el('empresa-inexistente', 'freela', URL_EMPRESA, 'company_not_found', { prep: erroRpc('accept_company_invite_by_token', 'company_not_found'), espera: 'não encontrada' }),
  el('sem-conexao', 'freela', URL_EMPRESA, 'sessão indisponível', { prep: (m) => { m.falhas['auth:user'] = 'rede'; }, erroEsperado: true, espera: 'Tentar de novo' }),

  ge('deslogado-vai-ao-login', 'anon', URL_GE, 'sem sessão: login type=hire', { espera: 'Contratar Talentos|Criar Conta' }),
  ge('processando', 'empresa', URL_GE, 'RPC em andamento', { prep: (m) => { m.falhas['rpc:accept_manager_invite'] = 'pendura'; }, carregandoEsperado: true, espera: 'Processando convite' }),
  ...[['accepted', 'Convite Aceito'], ['already_accepted', 'já aceito'], ['token_already_used', 'já usado'], ['revoked', 'cancelado'], ['expired', 'expirado'], ['worker_cannot_be_manager', 'Conta incompatível'], ['not_found', 'Não foi possível processar']]
    .map(([o, t]) => ge(o.replace(/_/g, '-'), 'empresa', URL_GE, `accept_manager_invite outcome=${o}`, { prep: (m) => { m.rpc.accept_manager_invite = { outcome: o }; }, espera: t })),
  ge('sem-conexao', 'empresa', URL_GE, 'sessão indisponível', { prep: (m) => { m.falhas['auth:user'] = 'rede'; }, erroEsperado: true, espera: 'Tentar de novo' }),

  eq('abrindo', 'anon', URL_EQ, 'prévia carregando', { prep: (m) => { m.falhas['rpc:get_member_invite_preview'] = 'pendura'; }, carregandoEsperado: true, espera: 'Abrindo seu convite' }),
  eq('deslogado-email', 'anon', URL_EQ, 'prévia ok, sem sessão', { espera: 'te convidou como Encarregado' }),
  eq('email-invalido', 'anon', URL_EQ, 'validação local', { passos: [{ preencher: ['input[type=email]', 'semarroba'] }, { clicar: 'Receber código' }], espera: 'e-mail válido' }),
  eq('sem-aceitar-termos', 'anon', URL_EQ, 'Termos obrigatórios', { passos: [{ preencher: ['input[type=email]', 'roberto@galeria.invalid'] }, { clicar: 'Receber código' }], espera: 'Aceite os Termos' }),
  eq('limite-de-codigo', 'anon', URL_EQ, 'otp 429', { prep: (m) => { m.auth.otp = () => ({ status: 429, body: { msg: 'rate limit', message: 'rate limit' } }); }, passos: pedirCodigo, espera: 'Aguarde um minuto' }),
  eq('falha-ao-enviar-codigo', 'anon', URL_EQ, 'otp 500', { prep: (m) => { m.auth.otp = () => ({ status: 500, body: { msg: 'boom' } }); }, passos: pedirCodigo, espera: 'Não conseguimos enviar' }),
  eq('codigo', 'anon', URL_EQ, 'código enviado', { passos: pedirCodigo, espera: 'Enviamos um código' }),
  eq('codigo-curto', 'anon', URL_EQ, 'menos de 6 dígitos', { passos: [...pedirCodigo, { preencher: ['input[inputmode=numeric]', '12'] }, { clicar: 'Entrar na equipe' }], espera: 'Digite o código' }),
  eq('codigo-errado', 'anon', URL_EQ, 'verifyOtp falha', { prep: (m) => { m.auth.verify = () => ({ status: 403, body: { msg: 'Token has expired or is invalid', error_code: 'otp_expired' } }); }, passos: comCodigo, espera: 'Código incorreto' }),
  eq('aceitando', 'anon', URL_EQ, 'aceite em andamento', { prep: (m) => { semConta(m); m.falhas['rpc:accept_company_member_invite'] = 'pendura'; }, passos: comCodigo, carregandoEsperado: true, espera: 'Entrando na equipe' }),
  eq('logado-confirmar', 'empresa', URL_EQ, 'já há sessão de empresa', { espera: 'Você está com a conta' }),
  eq('logado-freela', 'freela', URL_EQ, 'sessão de freela (papel errado)', { espera: 'conta de freela' }),
  eq('ok-aguardando-confirmacao', 'encarregado', URL_EQ, 'accepted + não confirmado: tela de espera', { prep: (m) => { m.empresa({ role: 'encarregado', confirmed: false }); m.db.jobs = []; }, passos: entrar, espera: 'quase pronto' }),
  ...[['accepted', 'ok'], ['already_accepted', 'ja-usado-por-mim'], ['already_operator', 'ja-opera-a-empresa']].map(([o, n]) => eq(n, 'encarregado', URL_EQ, `outcome=${o}: vai para Hoje`, { prep: outcome(o), passos: entrar, espera: 'Atendente de balcão' })),
  eq('tos-requerido', 'empresa', URL_EQ, 'outcome=tos_required', { prep: outcome('tos_required'), passos: entrar, espera: 'aceite os Termos' }),
  ...desfechos.map(([o, t]) => eq(`desfecho-${o.replace(/_/g, '-')}`, 'empresa', URL_EQ, `accept outcome=${o}`, { prep: outcome(o), passos: entrar, espera: t })),
  eq('previa-inexistente', 'anon', URL_EQ, 'prévia not_found', { prep: preview({ outcome: 'not_found' }), espera: 'Link inválido' }),
  eq('previa-vencida', 'anon', URL_EQ, 'prévia expired', { prep: preview({ outcome: 'expired' }), espera: 'Convite vencido' }),
  eq('previa-sem-rede', 'anon', URL_EQ, 'prévia falha', { prep: (m) => { m.falhas['rpc:get_member_invite_preview'] = 'erro'; }, erroEsperado: true, espera: 'Tentar de novo' }),
];
