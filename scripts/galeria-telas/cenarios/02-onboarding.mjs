import { grupoDe, aria } from '../lib/cenario.mjs';

const c = grupoDe('onboarding');
const novoFreela = (m) => { m.eu().onboarding_completed = false; m.eu().accepted_tos = false; };
const novaEmpresa = (m) => { m.rpc.get_my_companies = []; m.db.companies = []; };
const passo1 = [
  { preencher: [aria('Nome completo'), 'Ana Beatriz Souza'] }, { preencher: [aria('CPF'), '52998224725'] }, { preencher: [aria('Data de nascimento'), '1996-04-12'] },
  { preencher: [aria('Celular ou WhatsApp'), '11987654321'] }, { preencher: [aria('Cidade'), 'São Paulo'] }, { preencher: [aria('Chave PIX'), '52998224725'] },
];
const proximo = { clicar: /^Próximo/ };
const passo2 = [{ clicar: /^Garçom$/ }, { clicar: /^Barista$/ }, { selecionar: ['select', '1-2 anos'] }, { preencher: [aria('Bio curta'), 'Trabalho com eventos há quatro anos.'] }];
const emp1 = (doc) => [{ preencher: [aria('Nome da empresa'), 'Momentos Doces Confeitaria'] }, { preencher: [aria('CNPJ ou CPF'), doc] }, { selecionar: [aria('Tipo de empresa'), 'LIMITED'] }, { selecionar: [aria('Setor'), 'Cafeterias e Confeitarias'] }, { preencher: [aria('Cidade'), 'São Paulo'] }];
const f = (id, regra, extra) => c(`freela-${id}`, 'freela', '/worker/onboarding', regra, { ...extra, prep: (m) => { novoFreela(m); extra.prep?.(m); } });
const e = (id, regra, extra) => c(`empresa-${id}`, 'empresa', '/company/onboarding', regra, { ...extra, prep: (m) => { novaEmpresa(m); extra.prep?.(m); } });
const inc = 'onboarding_completed=false';
const ate3 = [...passo1, proximo, ...passo2, proximo];

export default [
  c('freela-redirecionado', 'freela', '/dashboard', 'gate: onboarding incompleto redireciona', { prep: novoFreela, espera: 'Passo 1 de 3' }),
  f('passo1-vazio', inc, { espera: 'Falta preencher' }),
  f('passo1-pix-invalida', 'CPF inválido como chave PIX', { passos: [...passo1.slice(0, 5), { preencher: [aria('Chave PIX'), '11111111111'] }], espera: 'chave PIX válida' }),
  f('passo1-pix-email', 'tipo e-mail com valor inválido', { passos: [...passo1.slice(0, 5), { selecionar: ['select', 'email'] }, { preencher: [aria('Chave PIX'), 'ana-sem-arroba'] }], espera: 'chave PIX válida' }),
  f('passo1-preenchido', inc, { passos: passo1, espera: 'Passo 1 de 3' }),
  f('passo2-vazio', 'sem especialidade e experiência', { passos: [...passo1, proximo], espera: 'especialidade' }),
  f('passo2-preenchido', inc, { passos: [...passo1, proximo, ...passo2], espera: 'Passo 2 de 3' }),
  f('passo3-vazio', 'sem disponibilidade e Termos', { passos: ate3, espera: 'aceite dos Termos' }),
  f('passo3-preenchido', 'pronto para finalizar', { passos: [...ate3, { clicar: /^Noite$/ }, { clicar: /^Fim de Semana$/ }, { css: '#tos' }], espera: 'Finalizar' }),
  f('erro-ao-salvar', 'upsert falha: aviso', { passos: [...ate3, { clicar: /^Noite$/ }, { css: '#tos' }, { falhar: { 'rest:workers': 'erro' } }, { clicar: /^Finalizar/ }], espera: 'erro', pausa: 200 }),
  f('sair-armado', 'saída pede segundo toque', { passos: [{ clicar: 'Sair e voltar' }], espera: 'toque de novo' }),

  c('empresa-redirecionada', 'empresa', '/company/dashboard', 'gate: sem empresa vai ao onboarding', { prep: novaEmpresa, espera: 'Primeiro acesso' }),
  e('passo1-vazio', 'get_my_companies vazio', { espera: 'Sobre a empresa' }),
  e('passo1-cnpj-invalido', 'dígitos do CNPJ inválidos', { passos: [...emp1('11111111111111'), proximo], espera: 'CNPJ inválido' }),
  e('passo1-cpf-invalido', 'dígitos do CPF inválidos', { passos: [...emp1('11111111111'), proximo], espera: 'CPF inválido' }),
  e('passo1-preenchido', 'dados válidos', { passos: emp1('11222333000181'), espera: 'Passo 1 de 2' }),
  e('passo2-vazio', 'sem objetivo, volume e Termos', { passos: [...emp1('11222333000181'), proximo], espera: 'Como você usa freelas' }),
  e('passo2-preenchido', 'pronto para finalizar', { passos: [...emp1('11222333000181'), proximo, { css: 'input[name=goal]' }, { marcar: 'input[name=volume]' }, { css: 'input[type=checkbox]' }], espera: 'Passo 2 de 2' }),
  e('sair-armado', 'saída pede segundo toque', { passos: [{ clicar: 'Sair e voltar' }], espera: 'toque de novo' }),

  c('termos-gate-freela', 'freela', '/dashboard', 'accepted_tos=false (TosGateModal)', { prep: (m) => { m.eu().accepted_tos = false; }, espera: 'Termos de Uso Atualizados' }),
  c('termos-gate-empresa', 'empresa', '/company/dashboard', 'accepted_tos=false (TosGateModal)', { prep: (m) => m.empresa({ accepted_tos: false }), espera: 'Termos de Uso Atualizados' }),
  c('termos-gate-erro-ao-salvar', 'freela', '/dashboard', 'gravação do aceite falha', { prep: (m) => { m.eu().accepted_tos = false; }, passos: [{ css: '#tos-checkbox' }, { falhar: { 'rest:workers': 'erro' } }, { clicar: /^Aceitar e Continuar/ }], espera: 'Termos de Uso Atualizados' }),
];
