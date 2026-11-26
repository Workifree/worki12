import { grupoDe, aria } from '../lib/cenario.mjs';
import { ID, id, dia, pessoasDaEquipe } from '../fixtures/world.mjs';

const g = grupoDe('equipe-gestor');
const e = grupoDe('equipe-encarregado');
const a = grupoDe('equipe-acesso');

const URL = '/company/configuracoes/equipe';
const comEquipe = (extra) => (m) => { m.comEquipe(); extra?.(m); };
const soPessoa = (nome) => (m) => { m.rpc.list_company_members = { outcome: 'ok', items: pessoasDaEquipe().filter((p) => p.display_name === nome) }; };
const naoConfirmado = (m) => m.empresa({ role: 'encarregado', confirmed: false, team_enabled: true });
const comCobertura = (m) => { m.db.responsibility_coverages = [{ id: id(92), company_id: ID.empresa, from_user_id: ID.empresa, to_user_id: ID.encarregado, starts_on: dia(0), ends_on: dia(6), revoked_at: null }]; };
const dica = (uid) => ({ [`worki_team_member_hint:${uid}`]: '1' });

export default [
  g('pessoas-vazio', 'empresa', URL, 'dono sozinho: ninguém na equipe', { espera: 'Ninguém na equipe ainda' }),
  g('pessoas', 'empresa', URL, 'aguardando confirmação, ativos, convidados, vencidos', { prep: comEquipe(), espera: 'Precisa da sua confirmação' }),
  g('carregando', 'empresa', URL, 'lista pendurada', { prep: (m) => { m.falhas['rpc:list_company_members'] = 'pendura'; }, carregandoEsperado: true }),
  g('erro', 'empresa', URL, 'lista falha', { prep: (m) => { m.falhas['rpc:list_company_members'] = 'erro'; }, erroEsperado: true, espera: 'Tentar de novo' }),
  g('rotacionar-link', 'empresa', URL, 'elenco_link_rotation_pending', { prep: comEquipe((m) => { m.rpc.list_company_members.elenco_link_rotation_pending = true; }), espera: 'novo link do Elenco' }),
  g('convidar', 'empresa', URL, 'modal Convidar pessoa', { prep: comEquipe(), passos: [{ clicar: /^Convidar pessoa/ }], espera: 'Convidar pessoa' }),
  g('convidar-validacao', 'empresa', URL, 'gerar sem nome', { prep: comEquipe(), passos: [{ clicar: /^Convidar pessoa/ }, { clicar: 'Gerar convite' }], espera: 'nome' }),
  g('convite-pronto', 'empresa', URL, 'link gerado para WhatsApp', { prep: comEquipe(), passos: [{ clicar: /^Convidar pessoa/ }, { preencher: ['[role=dialog] input >> nth=0', 'Sabrina Teixeira'] }, { clicar: 'Gerar convite' }], espera: 'Convite pronto' }),
  g('confirmar-pessoa', 'empresa', URL, 'Gestor confirma ("é ele?")', { prep: comEquipe(), passos: [{ clicar: /^Confirmar$/ }], espera: 'Confirmar acesso' }),
  g('confirmar-nome-errado', 'empresa', URL, 'outcome=name_mismatch', { prep: comEquipe(), passos: [{ clicar: /^Confirmar$/ }, { preencher: ['[role=dialog] input >> nth=0', 'Outro Nome'] }, { clicar: 'Confirmar acesso' }], espera: 'nome' }),
  g('rejeitar-pessoa', 'empresa', URL, 'Não é essa pessoa', { prep: comEquipe(), passos: [{ clicar: 'Não é essa pessoa' }], espera: 'perde o acesso agora' }),
  g('remover-pessoa', 'empresa', URL, 'dry run com turnos abertos e aviso de link', { prep: comEquipe(soPessoa('Roberto Dias')), passos: [{ clicar: 'Remover da equipe' }], espera: 'Remover agora' }),
  g('hoje', 'empresa', '/company/hoje', 'Hoje com filtros por pessoa e etiqueta', { prep: comEquipe(), espera: 'Ver turno|Chamar' }),
  g('hoje-selecao', 'empresa', '/company/hoje', 'barra de seleção em lote', { prep: comEquipe(), passos: [{ esperar: 800 }, { avaliar: "[...document.querySelectorAll('button')].find((b) => b.textContent.trim() === 'Pular')?.click()" }, { css: '[aria-label^="Mais opções de "]' }, { css: '[role="menuitem"]:has-text("Selecionar vários")' }], espera: 'Limpar seleção' }),
  g('passar-turnos', 'empresa', '/company/hoje', 'PassJobsModal', { prep: comEquipe(), passos: [{ css: '[aria-label^="Selecionar "] >> nth=0' }, { clicar: 'Passar para' }], espera: 'Roberto Dias' }),
  g('cobrir', 'empresa', '/company/hoje', 'CoverageModal', { prep: comEquipe((m) => { m.rpc.list_company_operators = [...m.rpc.list_company_operators, { user_id: id(76, 40), label: 'Sabrina Teixeira', role: 'encarregado' }]; }), passos: [{ clicar: /^Cobrir alguém|^Cobrir meus turnos/ }], espera: 'cobertura' }),
  g('cobertura-ativa', 'empresa', '/company/hoje', 'coberturas em andamento', { prep: comEquipe(comCobertura), espera: 'Coberturas em andamento' }),
  g('cancelar-turno', 'empresa', '/company/hoje', 'CancelJobModal na Hoje', { prep: comEquipe(), passos: [{ css: '[aria-label^="Mais opções"] >> nth=1' }, { clicar: /Cancelar turno/ }], espera: 'Cancelar este turno' }),
  g('hoje-filtro-vazio', 'empresa', '/company/hoje', 'filtro sem resultado', { prep: comEquipe((m) => { m.rpc.list_jobs_by_responsible = (args) => ({ outcome: 'ok', truncated: false, items: [] }); }), espera: 'Nenhum turno|não tem turnos' }),
  g('hoje-erro', 'empresa', '/company/hoje', 'falha de carga', { prep: comEquipe((m) => { m.falhas['rpc:list_jobs_by_responsible'] = 'erro'; m.falhas['rest:jobs'] = 'erro'; }), erroEsperado: true, espera: 'Tentar de novo' }),
  g('etiquetas', 'empresa', '/company/profile', 'TagsPanel (empresa com equipe)', { prep: comEquipe(), passos: [{ clicar: /Etiquetas|Configurações|Segurança|Conta/ }], espera: 'Momentos Doces' }),
  g('criar-turno-com-etiqueta', 'empresa', '/company/create', 'equipe: campo Etiqueta', { prep: comEquipe(), espera: 'Etiqueta' }),

  e('hoje', 'encarregado', '/company/hoje', 'só os próprios turnos', { espera: 'Atendente de balcão' }),
  e('hoje-vazio', 'encarregado', '/company/hoje', 'sem turno', { prep: (m) => { m.db.jobs = []; m.rpc.list_jobs_by_responsible = { outcome: 'ok', truncated: false, items: [] }; }, espera: 'não tem turnos' }),
  e('inicio', 'encarregado', '/company/dashboard', 'painel restrito', { espera: 'turno|Bem-vindo' }),
  e('turnos', 'encarregado', '/company/jobs', 'lista restrita', { espera: 'Reforço de caixa' }),
  e('gestao', 'encarregado', '/company/gestao', 'hub sem itens de Gestor', { espera: 'Gestão' }),
  e('presenca', 'encarregado', `/company/jobs/${id(20, 7)}/candidates`, 'turno próprio (PII via RPC)', { espera: 'Reforço de caixa' }),
  e('turno-de-outro', 'encarregado', `/company/jobs/${id(20, 1)}/candidates`, 'SemAcesso: turno de outra pessoa', { espera: 'acesso' }),
  e('detalhe-de-outro', 'encarregado', `/company/jobs/${id(20, 1)}`, 'SemAcesso no detalhe', { espera: 'acesso' }),
  e('elenco', 'encarregado', '/company/team', 'Elenco único sem remover', { espera: 'Elenco' }),
  e('sem-acesso-relatorio', 'encarregado', '/company/relatorio', 'GestorRouteGuard: SemAcesso', { espera: 'acesso' }),
  e('sem-acesso-equipe', 'encarregado', URL, 'GestorRouteGuard: SemAcesso', { espera: 'acesso' }),
  e('sem-acesso-unidades', 'encarregado', '/company/organization', 'GestorRouteGuard: SemAcesso', { espera: 'acesso' }),
  e('perfil-redirecionado', 'encarregado', '/company/profile', 'perfil da empresa redireciona com aviso', { espera: 'não tem permissão', pausa: 150 }),

  a('aguardando-confirmacao', 'encarregado', '/company/hoje', 'encarregado com confirmed=false (R22)', { prep: naoConfirmado, espera: 'quase pronto' }),
  a('aguardando-via-onboarding', 'encarregado', '/company/onboarding', 'não escapa pela rota de onboarding', { prep: naoConfirmado, espera: 'quase pronto' }),
  a('acesso-encerrado', 'encarregado', '/company/hoje', 'sem empresa e com marca de membro (removido)', { prep: (m) => { m.rpc.get_my_companies = []; }, local: dica(ID.encarregado), espera: 'acesso' }),
  a('retorno-ao-convite', 'encarregado', '/company/hoje', 'sem empresa e token de equipe pendente', { prep: (m) => { m.rpc.get_my_companies = []; }, session: { pending_team_invite_token: 'token-de-equipe-falso-0001' }, espera: 'te convidou' }),
  a('gerente-revogado-sem-marca', 'encarregado', '/company/dashboard', 'sem empresa e sem marca: onboarding', { prep: (m) => { m.rpc.get_my_companies = []; m.db.companies = []; m.rpc.my_access_state = { removed: true, has_active: false, owns_company: false }; }, espera: 'encerrado' }),
  a('freela-em-rota-de-empresa', 'freela', '/company/dashboard', 'isolamento de papel com aviso', { espera: 'não tem permissão', pausa: 150 }),
  a('empresa-em-rota-de-freela', 'empresa', '/my-jobs', 'isolamento de papel com aviso', { espera: 'não tem permissão', pausa: 150 }),
  a('verificacao-falhou-empresa', 'empresa', '/company/dashboard', 'get_my_companies sem rede: ErroDeVerificacao', { prep: (m) => { m.falhas['rpc:get_my_companies'] = 'rede'; }, erroEsperado: true, espera: 'Tentar de novo' }),
  a('verificacao-falhou-freela', 'freela', '/dashboard', 'leitura de workers falha: ErroDeVerificacao', { prep: (m) => { m.falhas['rest:workers'] = 'erro'; }, erroEsperado: true, espera: 'Tentar de novo' }),
  a('verificacao-raiz-sem-rede', 'freela', '/', 'HomeRedirect sem rede', { prep: (m) => { m.falhas['auth:user'] = 'rede'; }, erroEsperado: true, espera: 'Tentar de novo' }),
  a('verificando', 'empresa', '/company/dashboard', 'gate carregando (spinner)', { prep: (m) => { m.falhas['rpc:get_my_companies'] = 'pendura'; }, carregandoEsperado: true }),
  a('verificacao-timeout', 'empresa', '/company/dashboard', 'passou de 20s: vira erro', { prep: (m) => { m.falhas['rpc:get_my_companies'] = 'pendura'; }, passos: [{ esperar: 21000 }], erroEsperado: true, espera: 'Tentar de novo', viewports: ['390'] }),
];
