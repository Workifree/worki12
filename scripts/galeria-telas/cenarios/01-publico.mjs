import { grupoDe } from '../lib/cenario.mjs';

const c = grupoDe('publico');
const a = grupoDe('acesso');
const enviarLogin = [{ preencher: ['input[type=email]', 'ana@galeria.invalid'] }, { preencher: ['input[type=password]', 'SenhaDeMentira#1'] }, { css: 'form button[type=submit]' }];
const erroAuth = (nome, msg, status, code) => (m) => { m.auth[nome] = () => ({ status, body: { code, error_code: code, msg, message: msg, error_description: msg } }); };
const novaSenha = (s1, s2) => [{ preencher: ['input >> nth=0', s1] }, { preencher: ['input >> nth=1', s2] }, { css: 'form button[type=submit]' }];

export default [
  c('escolha-de-papel', 'anon', '/', 'sem sessão em /', { espera: 'Quero trabalhar' }),
  c('landing-sobre', 'anon', '/sobre', 'pública', { espera: 'Worki' }),
  c('termos', 'anon', '/termos', 'pública', { espera: 'Termos de Uso' }),
  c('privacidade', 'anon', '/privacidade', 'pública', { espera: 'Privacidade' }),
  c('ajuda', 'anon', '/ajuda', 'pública', { espera: 'Ajuda' }),
  c('regulamento-trilha', 'anon', '/regulamento-trilha', 'pública, versionada', { espera: 'Regulamento' }),
  c('404', 'anon', '/rota-que-nao-existe', 'path="*"', { espera: 'não encontrada|404' }),

  a('login-freela', 'anon', '/login?type=work', 'type=work', { espera: 'Entrar como freela' }),
  a('login-empresa', 'anon', '/login?type=hire', 'type=hire', { espera: 'Entrar como empresa' }),
  a('login-sessao-expirada', 'anon', '/login?reason=session_expired', 'reason=session_expired', { espera: 'expirou' }),
  a('cadastro', 'anon', '/login?type=work&cadastro=1', 'cadastro=1', { espera: 'Criar Conta' }),
  a('cadastro-forca-senha', 'anon', '/login?type=hire&cadastro=1', 'senha digitada mostra a força', { passos: [{ preencher: ['input[type=password]', 'abc12345'] }], espera: 'Força' }),
  a('cadastro-confirmar-email', 'anon', '/login?type=work&cadastro=1', 'signUp sem sessão devolvida', { passos: enviarLogin, espera: 'Verifique seu email' }),
  a('cadastro-email-ja-existe', 'anon', '/login?type=work&cadastro=1', 'identities vazio', { prep: (m) => { m.auth.signup = () => ({ body: { ...m.usuarioNovo, identities: [] } }); }, passos: enviarLogin, espera: 'já tem uma conta' }),
  a('login-senha-errada', 'anon', '/login?type=work', 'Invalid login credentials', { prep: erroAuth('token', 'Invalid login credentials', 400, 'invalid_credentials'), passos: enviarLogin, espera: 'incorretos' }),
  a('login-email-nao-confirmado', 'anon', '/login?type=work', 'Email not confirmed', { prep: erroAuth('token', 'Email not confirmed', 400, 'email_not_confirmed'), passos: enviarLogin, espera: 'verifique seu email' }),
  a('login-muitas-tentativas', 'anon', '/login?type=work', 'status 429', { prep: erroAuth('token', 'rate_limit', 429, 'over_request_rate_limit'), passos: enviarLogin, espera: 'Muitas tentativas' }),
  a('login-sem-internet', 'anon', '/login?type=work', 'fetch falha', { prep: (m) => { m.falhas['auth:token'] = 'rede'; }, passos: enviarLogin, espera: 'Sem conexão' }),
  a('login-papel-errado', 'anon', '/login?type=hire', 'conta de freela entrando por type=hire', { passos: enviarLogin, espera: 'já está cadastrado como' }),
  a('esqueci-senha', 'anon', '/esqueci-senha', 'pública', { espera: 'senha' }),
  a('esqueci-senha-email-invalido', 'anon', '/esqueci-senha', 'validação nativa do navegador (balão do Chrome)', { passos: [{ preencher: ['input[type=email]', 'semarroba'] }, { css: 'form button[type=submit]' }], espera: 'Esqueci a Senha' }),
  a('esqueci-senha-enviado', 'anon', '/esqueci-senha', 'recover ok (com espera para reenviar)', { passos: [{ preencher: ['input[type=email]', 'ana@galeria.invalid'] }, { css: 'form button[type=submit]' }], espera: 'Email Enviado' }),
  a('redefinir-senha', 'freela', '/redefinir-senha', 'link de recuperação (sessão)', { espera: 'senha' }),
  a('redefinir-senha-diferentes', 'freela', '/redefinir-senha', 'confirmação não bate', { passos: novaSenha('SenhaNova#123', 'SenhaOutra#123'), espera: 'não coincidem' }),
  a('redefinir-senha-ok', 'freela', '/redefinir-senha', 'updateUser ok', { passos: novaSenha('SenhaNova#123', 'SenhaNova#123'), espera: 'Senha Redefinida' }),
  a('redefinir-senha-link-expirado', 'freela', '/redefinir-senha', 'updateUser: token expirado', { prep: (m) => { m.auth.user = (corpo) => (corpo ? { status: 422, body: { msg: 'Token has expired', message: 'Token has expired' } } : { body: m.sessao }); }, passos: novaSenha('SenhaNova#123', 'SenhaNova#123'), espera: 'expirado' }),
];
