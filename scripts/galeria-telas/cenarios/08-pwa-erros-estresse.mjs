import { grupoDe, aria } from '../lib/cenario.mjs';
import { AGORA, ID, id, em, dia, NOME_LONGO, EMPRESA_LONGA, TITULO_LONGO, PALAVRA_SEM_ESPACO, pessoasDaEquipe } from '../fixtures/world.mjs';

const pw = grupoDe('pwa-offline');
const er = grupoDe('erros');
const es = grupoDe('estresse');
const nz = grupoDe('nulos');

const IPHONE = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1';
const dispararInstalacao = { avaliar: "(() => { const e = new Event('beforeinstallprompt', { cancelable: true }); e.prompt = async () => {}; e.userChoice = Promise.resolve({ outcome: 'dismissed' }); window.dispatchEvent(e); })()" };
// Service worker de mentira com uma versão "esperando": é o que faz o app oferecer a atualização.
const SW_FALSO = () => {
  const falso = { controller: {}, addEventListener() {}, register: async () => ({ waiting: { postMessage() {} }, addEventListener() {}, update: async () => {} }) };
  Object.defineProperty(navigator, 'serviceWorker', { configurable: true, get: () => falso });
};
const SESSAO_ANTIGA = { 'worki:pwa-sessao-inicio': String(AGORA.getTime() - 60000) };
const irPara = (rota) => ({ avaliar: `(() => { history.pushState({}, '', ${JSON.stringify(rota)}); window.dispatchEvent(new PopStateEvent('popstate')); })()` });
const quebra = (arquivo) => (m) => { m.modulos = { [arquivo]: "export default function Quebrada() { throw new Error('galeria: erro simulado de renderização'); }" }; };

// --- estresse: textos longos e listas grandes ---
const textosLongos = (m) => {
  m.db.workers.forEach((w, i) => { w.full_name = i % 2 ? NOME_LONGO : `${w.full_name} de ${PALAVRA_SEM_ESPACO}`; w.city = 'São José do Vale do Rio Preto das Palmeiras Imperiais'; w.primary_role = 'Auxiliar de cozinha especializado em confeitaria fina'; w.pix_key = 'nome.sobrenome.muito.comprido.mesmo@provedor-de-email-corporativo.galeria.invalid'; });
  m.db.companies.forEach((c) => { c.name = EMPRESA_LONGA; c.industry = 'Buffets, Eventos Corporativos e Confeitaria Artesanal'; c.description = `${PALAVRA_SEM_ESPACO} `.repeat(6); c.address = 'Avenida Professor Doutor Francisco Morato de Oliveira Albuquerque, 12.345, bloco B, Jardim das Palmeiras Imperiais'; c.website = `https://${'a'.repeat(60)}.galeria.invalid`; });
  m.db.jobs.forEach((j) => { j.title = TITULO_LONGO; j.location = 'Avenida Professor Doutor Francisco Morato de Oliveira Albuquerque, 12.345, bloco B, 7º andar, Jardim das Palmeiras Imperiais, São Paulo - SP'; j.budget = 1234567.89; });
  m.db.notifications.forEach((n) => { n.title = TITULO_LONGO; n.message = `${TITULO_LONGO}. ${PALAVRA_SEM_ESPACO}`; });
  m.db.Message.forEach((x, i) => { x.content = i ? `https://galeria.invalid/${'x'.repeat(120)}` : `${TITULO_LONGO}. `.repeat(5); });
  m.db.team_lists.forEach((l) => { l.name = 'Turma fixa de sábado à noite da loja de Pinheiros e eventos externos'; });
  m.db.shift_payments.forEach((s) => { s.amount = 1234567.89; if (s.status === 'recorded') s.note = `${PALAVRA_SEM_ESPACO} `.repeat(4); });
  m.db.worker_certifications.forEach((c) => { c.title = TITULO_LONGO; c.issuer = EMPRESA_LONGA; c.registration_number = '9'.repeat(40); });
  const base = m.rpc.get_my_companies[0]; m.rpc.get_my_companies = [{ ...base, company_name: EMPRESA_LONGA, organization_name: EMPRESA_LONGA }];
  m.rpc.get_worker_company_badges = [{ company_id: ID.empresa, company_name: EMPRESA_LONGA, company_logo_url: null, shifts_count: 12345, last_shift_at: em(-1), avg_rating: 4.9, reviews_count: 9999, hidden: false }];
};
const grande = (m) => {
  const w0 = m.db.workers; const j0 = m.db.jobs;
  for (let i = 10; i < 90; i++) m.db.workers.push({ ...w0[i % 10], id: id(10, i), full_name: `${w0[i % 10].full_name} ${i}` });
  m.db.team_connections = m.db.workers.map((w, i) => ({ id: id(50, 100 + i), company_id: ID.empresa, worker_id: w.id, status: i % 12 === 5 ? 'pending' : 'accepted', source: 'link', created_at: em(-90), accepted_at: em(-80), updated_at: em(-80) }));
  for (let i = 8; i < 70; i++) m.db.jobs.push({ ...j0[i % 7], id: id(20, i), title: `${j0[i % 7].title} #${i}`, start_date: `${dia((i % 13) - 3)}T15:00:00+00:00`, series_id: null });
  m.db.applications.push(...Array.from({ length: 40 }, (_, i) => ({ id: id(30, 200 + i), job_id: id(20, 1), worker_id: id(10, 20 + i), status: ['hired', 'invited', 'completed', 'declined'][i % 4], created_at: em(-3), invited_by_company_at: em(-3), invitation_expires_at: em(2) })));
  m.db.applications.push(...Array.from({ length: 40 }, (_, i) => ({ id: id(30, 300 + i), job_id: id(20, 8 + i), worker_id: ID.freela, status: ['hired', 'completed', 'cancelled'][i % 3], created_at: em(-3) })));
  m.db.shift_payments.push(...Array.from({ length: 40 }, (_, i) => ({ id: id(40, 200 + i), job_id: id(20, 8 + i), worker_id: ID.freela, company_id: ID.empresa, application_id: id(30, 300 + i), source: 'cash', amount: 100 + i, status: 'recorded', paid_at: em(-i), worker_confirmed_at: i % 5 ? em(-i) : null, created_at: em(-i) })));
  m.db.notifications.push(...Array.from({ length: 60 }, (_, i) => ({ id: id(70, 100 + i), user_id: m.sessao.id, type: 'system', title: `Aviso ${i + 1}`, message: 'Atualização do turno.', link: '/', read_at: i % 3 ? em(-1) : null, created_at: em(-i / 10) })));
};
const ambos = (m) => { grande(m); textosLongos(m); };
const nulos = (m) => {
  m.db.jobs.forEach((j) => Object.assign(j, { budget: 0, location: null, description: null, briefing: null, requirements: null, work_start_time: null, work_end_time: null, estimated_hours: null, category: null, views: null }));
  m.db.workers.forEach((w) => Object.assign(w, { avatar_url: null, city: null, phone: null, pix_key: null, bio: null, primary_role: null, roles: null, tags: null, rating_average: null, reviews_count: null, completed_jobs_count: null, earnings_total: null, xp: null, level: null, availability_days: null, availability: null }));
  m.db.companies.forEach((c) => Object.assign(c, { logo_url: null, industry: null, address: null, rating_average: null, reviews_count: null, city: null, description: null }));
  m.db.shift_payments.forEach((s) => { s.amount = 0; });
};

const telas = [
  ['freela', '/dashboard', 'inicio-freela'], ['freela', '/my-jobs', 'meus-turnos'], ['freela', '/carteira', 'carteira'], ['freela', '/recebimentos', 'recebimentos'], ['freela', '/profile', 'perfil-freela'], ['freela', '/notifications', 'notificacoes'], ['freela', `/messages?conversation=${id(95, 1)}`, 'chat-freela'], ['freela', `/empresa/${ID.empresa}`, 'empresa-publica'], ['freela', `/recibo/${id(20, 3)}`, 'recibo'],
  ['empresa', '/company/dashboard', 'inicio-empresa'], ['empresa', '/company/jobs', 'turnos'], ['empresa', `/company/jobs/${id(20, 1)}`, 'detalhe-turno'], ['empresa', `/company/jobs/${id(20, 1)}/candidates`, 'presenca'], ['empresa', '/company/team', 'elenco'], ['empresa', '/company/hoje', 'hoje'], ['empresa', '/company/relatorio', 'relatorio'], ['empresa', '/company/operacao', 'operacao'], ['empresa', '/company/profile', 'perfil-empresa'], ['empresa', `/company/worker/${ID.freela}`, 'perfil-do-freela'], ['empresa', `/company/messages?conversation=${id(95, 1)}`, 'chat-empresa'],
];

export default [
  // Convite: 20s de uso na sessão (sessionStorage "antigo") e nunca na 1ª tela (navega pelo roteador).
  pw('instalar-android', 'freela', '/my-jobs', 'beforeinstallprompt após 20s de sessão, 2ª tela', { convitePwa: true, session: SESSAO_ANTIGA, passos: [dispararInstalacao, irPara('/dashboard'), { esperar: 800 }], espera: 'Instale o Worki' }),
  pw('instalar-iphone', 'freela', '/my-jobs', 'Safari iOS: linha compacta + folha com o passo a passo', { convitePwa: true, session: SESSAO_ANTIGA, ua: IPHONE, viewports: ['390', '320'], passos: [irPara('/dashboard'), { esperar: 800 }, { clicar: /^Instalar$/ }], espera: 'Adicionar à Tela de Início' }),
  pw('instalar-empresa', 'empresa', '/company/jobs', 'convite sobre o painel da empresa', { convitePwa: true, session: SESSAO_ANTIGA, passos: [dispararInstalacao, irPara('/company/dashboard'), { esperar: 800 }], espera: 'Instale o Worki' }),
  pw('atualizar', 'freela', '/dashboard', 'service worker novo esperando', { init: SW_FALSO, passos: [{ avaliar: "import('/src/lib/pwa.ts').then((m) => m.registerServiceWorker(true))" }, { esperar: 800 }], espera: 'Nova versão disponível' }),
  pw('faixa-sem-internet-freela', 'freela', '/dashboard', 'navigator.onLine=false', { passos: [{ offline: true }], espera: 'sem internet' }),
  pw('faixa-sem-internet-empresa', 'empresa', '/company/jobs', 'navigator.onLine=false', { passos: [{ offline: true }], espera: 'sem internet' }),
  pw('faixa-sem-internet-chat', 'freela', `/messages?conversation=${id(95, 1)}`, 'faixa descontada da altura do chat', { passos: [{ offline: true }], espera: 'sem internet' }),
  pw('faixa-sem-internet-modal', 'empresa', '/company/team', 'offline com modal aberto', { passos: [{ clicar: 'Adicionar Freela' }, { offline: true }], espera: 'sem internet' }),

  er('error-boundary-publico', 'anon', '/ajuda', 'exceção de render (módulo trocado pela galeria)', { prep: quebra('/src/pages/Help.tsx'), erroEsperado: true, espera: 'Algo deu errado|Tentar|Recarregar' }),
  er('error-boundary-logado', 'empresa', '/company/relatorio', 'exceção de render numa página interna', { prep: quebra('/src/pages/company/CompanyOrdersReport.tsx'), erroEsperado: true, espera: 'Algo deu errado|Tentar|Recarregar' }),
  er('pagina-carregando', 'anon', '/ajuda', 'chunk da página demorando (PageLoader)', { init: () => {}, prep: (m) => { m.modulos = { '/src/pages/Help.tsx': 'await new Promise(() => {}); export default function X() { return null; }' }; }, carregandoEsperado: true }),

  ...telas.map(([papel, rota, nome]) => es(`longos-${nome}`, papel, rota, 'nomes, títulos, endereços e valores muito longos', { prep: textosLongos })),
  ...telas.filter(([, , n]) => ['meus-turnos', 'recebimentos', 'notificacoes', 'inicio-empresa', 'turnos', 'presenca', 'elenco', 'hoje', 'relatorio', 'operacao'].includes(n)).map(([papel, rota, nome]) => es(`volume-${nome}`, papel, rota, 'dezenas de turnos, pessoas, pagamentos e avisos', { prep: grande })),
  es('longos-modal-chamado', 'empresa', `/company/jobs/${id(20, 1)}/candidates?chamar=1`, 'modal de chamado com 80 pessoas e nomes longos', { prep: (m) => { ambos(m); m.db.applications = []; m.db.shift_calls = []; }, espera: 'Motivo' }),
  es('longos-modal-lista', 'empresa', '/company/team', 'TeamListModal com 80 pessoas', { prep: ambos, passos: [{ clicar: 'Nova lista' }], espera: 'lista' }),
  es('longos-equipe', 'empresa', '/company/configuracoes/equipe', 'nomes e e-mails longos na equipe', { prep: (m) => { m.comEquipe(); m.rpc.list_company_members = { outcome: 'ok', items: pessoasDaEquipe().map((x) => ({ ...x, display_name: NOME_LONGO, accepted_email: 'nome.sobrenome.muito.comprido@provedor-corporativo.galeria.invalid' })) }; }, espera: 'Precisa da sua confirmação' }),
  es('longos-indicacoes', 'empresa', '/company/indicacoes', 'indicação com nomes longos', { prep: (m) => { const i = m.rpc.list_worker_referral_cards.items; i.forEach((x) => { x.card.full_name = NOME_LONGO; x.referring_company.name = EMPRESA_LONGA; x.message = `${PALAVRA_SEM_ESPACO} `.repeat(5); }); }, espera: 'Indicado por' }),
  es('longos-gate-equipe', 'anon', '/convite-equipe/token-de-equipe-falso-0001', 'nome de empresa longo no convite', { prep: (m) => { m.rpc.get_member_invite_preview = { outcome: 'ok', company_name: `${EMPRESA_LONGA} ${PALAVRA_SEM_ESPACO}`, role: 'encarregado' }; }, espera: 'te convidou' }),

  ...telas.filter(([, , n]) => !['chat-freela', 'chat-empresa'].includes(n)).map(([papel, rota, nome]) => nz(nome, papel, rota, 'valores zero e campos nulos', { prep: nulos })),
];
