import { grupoDe, aria } from '../lib/cenario.mjs';
import { ID, id, em, dia, trilha } from '../fixtures/world.mjs';

const p = grupoDe('empresa-painel');
const t = grupoDe('empresa-turnos');
const pp = grupoDe('empresa-presenca-pagamento');
const ch = grupoDe('chamado-sos');
const el = grupoDe('empresa-elenco');
const pe = grupoDe('empresa-perfil');

const turno = (n) => `/company/jobs/${id(20, n)}`;
const cand = (n) => `${turno(n)}/candidates`;
const falhar = (tipo, ...tabelas) => (m) => { for (const x of tabelas) m.falhas[`rest:${x}`] = tipo; };
const semNada = (m) => {
  m.vazio('jobs', 'applications', 'shift_payments', 'team_connections', 'shift_calls', 'shift_call_targets', 'team_lists', 'team_list_members', 'job_series', 'notifications', 'Conversation', 'Message', 'worker_referrals', 'shift_attendance_confirmations', 'escrow_transactions', 'reviews');
  Object.assign(m.rpc, { list_worker_referral_cards: { outcome: 'ok', items: [] }, get_profile_reviews: [] });
};
const menuTurno = { css: aria('Mais opções do turno') };
/** Só a candidatura `n` no turno, para o botão certo ser o primeiro. */
const soCand = (n, extra = {}) => (m) => { const a = m.app(n); m.db.applications = [Object.assign(a, extra)]; };
const semPagamento = (m) => { soCand(4)(m); m.db.shift_payments = []; };
const sos = (reason, extra = {}) => (m) => { m.rpc.sos_call_eligibility = { eligible: reason === 'ok', reason, quota_week_left: 2, missing_slots: 2, ...extra }; m.db.shift_calls = []; m.db.shift_call_targets = []; };
const abrirChamado = [{ clicar: /^Chamar Freelas/ }];

export default [
  p('inicio', 'empresa', '/company/dashboard', 'dono sozinho, com pendências', { espera: 'Bem-vindo de volta' }),
  p('inicio-com-equipe', 'empresa', '/company/dashboard', 'team_enabled: navegação ganha Hoje e Equipe', { prep: (m) => m.comEquipe(), espera: 'Bem-vindo de volta' }),
  p('inicio-vazio', 'empresa', '/company/dashboard', 'empresa nova, zero turnos', { prep: semNada, espera: 'Bem-vindo' }),
  p('inicio-carregando', 'empresa', '/company/dashboard', 'consultas penduradas', { prep: falhar('pendura', 'jobs', 'applications', 'shift_payments'), carregandoEsperado: true }),
  p('inicio-erro', 'empresa', '/company/dashboard', 'todas as consultas falham (DEFEITO: a consulta de companies ignora o erro e o painel fica em esqueleto para sempre)', { prep: falhar('erro', 'jobs', 'applications', 'shift_payments', 'companies'), erroEsperado: true, carregandoEsperado: true, pausa: 9000, espera: 'Turnos recentes' }),
  p('inicio-erro-turnos', 'empresa', '/company/dashboard', 'só a consulta de turnos falha (DEFEITO: aparece 0 turnos e "Criar primeiro turno", sem erro)', { prep: falhar('erro', 'jobs'), erroEsperado: true, pausa: 9000, espera: 'Nenhum turno encontrado|Tentar' }),
  p('inicio-atalho-trilha', 'empresa', '/company/dashboard', 'inscrição ativa mostra atalho da trilha', { prep: (m) => { m.rpc.bonus_get_my_trail = trilha('active'); }, espera: 'trilha|Trilha' }),
  p('gestao', 'empresa', '/company/gestao', 'hub Gestão (Gestor)', { espera: 'Gestão' }),
  p('gestao-com-equipe-trilha', 'empresa', '/company/gestao', 'equipe + trilha ativa', { prep: (m) => { m.comEquipe(); m.rpc.bonus_get_my_trail = trilha('active'); }, espera: 'Gestão' }),
  p('hoje-dono-sozinho', 'empresa', '/company/hoje', 'sem equipe: sem filtros por pessoa', { espera: 'Atendente de balcão' }),
  p('relatorio', 'empresa', '/company/relatorio', 'relatório de ordens', { espera: 'Relatório|Ordens' }),
  p('relatorio-vazio', 'empresa', '/company/relatorio', 'sem dados', { prep: semNada, espera: 'Relatório|Ordens|Nenhum' }),
  p('relatorio-erro', 'empresa', '/company/relatorio', 'falha de carga (DEFEITO: o service devolve vazio e a tela mostra R$ 0,00 em vez de erro)', { prep: falhar('erro', 'jobs'), erroEsperado: true, espera: 'Nenhum pagamento no período|Não foi possível carregar' }),
  p('operacao', 'empresa', '/company/operacao', 'painel de operação com amostra', { espera: 'Operação' }),
  p('operacao-amostra-insuficiente', 'empresa', '/company/operacao', 'sem fonte / amostra insuficiente', { prep: semNada, espera: 'Operação' }),
  p('operacao-erro', 'empresa', '/company/operacao', 'hasError', { prep: falhar('erro', 'jobs', 'shift_payments', 'shift_calls'), erroEsperado: true, espera: 'Operação' }),
  p('unidades', 'empresa', '/company/organization', 'dono/operador de organização', { prep: (m) => { m.db.company_members = [{ id: id(75, 30), company_id: ID.empresa, user_id: id(76, 30), role: 'manager', status: 'active', invited_email: 'gerente@galeria.invalid', invite_token: null, invited_at: em(-30), accepted_at: em(-29), expires_at: em(-20) }, { id: id(75, 31), company_id: ID.empresa, user_id: null, role: 'manager', status: 'invited', invited_email: 'nome.muito.comprido.do.gerente.da.unidade@confeitariamomentosdoces.galeria.invalid', invite_token: 'token-gerente-falso', invited_at: em(-1), accepted_at: null, expires_at: em(6) }]; }, espera: 'Unidades|gerente' }),
  p('multi-unidade', 'empresa', '/company/dashboard', 'operador com 3 unidades: seletor', { prep: (m) => { const base = m.rpc.get_my_companies[0]; m.rpc.get_my_companies = [{ ...base, role: 'operator' }, { ...base, company_id: ID.empresa2, company_name: 'Café Girassol', role: 'operator' }, { ...base, company_id: ID.empresa3, company_name: 'Buffet Villa Real da Zona Sul', role: 'operator' }]; }, espera: 'Bem-vindo' }),
  p('multi-unidade-organizacao', 'empresa', '/company/organization', 'visão das 3 unidades', { prep: (m) => { const base = m.rpc.get_my_companies[0]; m.rpc.get_my_companies = [base, { ...base, company_id: ID.empresa2, company_name: 'Café Girassol', role: 'operator' }, { ...base, company_id: ID.empresa3, company_name: 'Buffet Villa Real', role: 'operator' }]; }, espera: 'Café Girassol' }),
  p('mensagens', 'empresa', '/company/messages', 'lista de conversas', { espera: 'Ana Beatriz' }),
  p('mensagens-conversa', 'empresa', `/company/messages?conversation=${id(95, 1)}`, 'conversa aberta', { espera: '15 minutos antes' }),
  p('mensagens-vazio', 'empresa', '/company/messages', 'sem conversas', { prep: semNada, espera: 'conversa|mensagen' }),
  p('notificacoes', 'empresa', '/company/notifications', 'lista', { espera: 'Convite aceito' }),

  t('lista', 'empresa', '/company/jobs', 'abertos, em andamento, concluídos, série e chamado aberto', { espera: 'Garçom para casamento' }),
  t('lista-vazia', 'empresa', '/company/jobs', 'nenhum turno', { prep: semNada, espera: 'Nenhum turno|primeiro turno' }),
  t('lista-erro', 'empresa', '/company/jobs', 'falha de carga', { prep: falhar('erro', 'jobs'), erroEsperado: true, espera: 'Tentar' }),
  t('busca-sem-resultado', 'empresa', '/company/jobs', 'busca sem resultado', { passos: [{ preencher: [aria('Buscar turnos'), 'zzzz'] }], espera: 'Nenhum turno' }),
  t('menu', 'empresa', '/company/jobs', 'menu de ações do turno', { passos: [menuTurno], espera: 'Excluir|Editar' }),
  t('menu-serie', 'empresa', '/company/jobs', 'menu de ocorrência de série', { prep: (m) => { m.db.jobs = [m.job(4), m.job(5)]; }, passos: [menuTurno], espera: 'série' }),
  t('excluir', 'empresa', '/company/jobs', 'confirmar exclusão (menu do primeiro turno da lista cheia)', { passos: [menuTurno, { clicar: /^Excluir/ }], espera: 'Excluir turno' }),
  t('menu-coberto', 'empresa', '/company/jobs', 'um único turno (DEFEITO no celular: menu abre sob a barra inferior e o botão Criar turno; a página não rola e Excluir fica inalcançável)', { prep: (m) => { m.db.jobs = [m.job(1)]; m.db.applications = []; m.db.shift_calls = []; }, passos: [menuTurno], espera: 'Ver Detalhes' }),
  t('serie-editar', 'empresa', '/company/jobs', 'EditSeriesModal', { prep: (m) => { m.db.jobs = [m.job(4), m.job(5)]; }, passos: [menuTurno, { clicar: /Editar.*(série|seguintes|futur)/i }], espera: 'série' }),
  t('serie-cancelar', 'empresa', '/company/jobs', 'CancelSeriesModal com prévia', { prep: (m) => { m.db.jobs = [m.job(4), m.job(5)]; m.rpc.stop_job_series = { outcome: 'ok', affected: 6, with_commitments: 1, kept: 1, workers: 2 }; }, passos: [menuTurno, { clicar: /(Cancelar|Encerrar|Parar).*série/i }], espera: 'série' }),
  t('serie-convidar', 'empresa', '/company/jobs', 'InviteSeriesModal', { prep: (m) => { m.db.jobs = [m.job(4), m.job(5)]; }, passos: [menuTurno, { clicar: /Convidar.*série/i }], espera: 'série' }),
  t('convidar-na-lista', 'empresa', '/company/jobs', 'modal Convidar freela', { passos: [{ clicar: /^Convidar/ }], espera: 'Convidar' }),
  t('criar', 'empresa', '/company/create', 'formulário novo (com turnos anteriores como modelo)', { espera: 'Título|turno' }),
  t('criar-validacao', 'empresa', '/company/create', 'enviar vazio mostra erros', { prep: (m) => { m.db.jobs = []; }, passos: [{ css: 'form button[type=submit]' }], espera: 'Falta|Escolha|Informe' }),
  t('criar-serie', 'empresa', '/company/create', 'repetição semanal ligada', { passos: [{ clicar: /Repetir|recorr/i }], espera: 'Repetir até|série' }),
  t('criar-opcionais', 'empresa', '/company/create', 'detalhes opcionais abertos', { passos: [{ clicar: /Requisitos, briefing/ }], espera: 'Certificação|certificação exigida|Briefing' }),
  t('editar', 'empresa', `${turno(1)}/edit`, 'edição de turno', { espera: 'Garçom para casamento' }),
  t('editar-erro', 'empresa', `${turno(1)}/edit`, 'falha ao carregar para edição', { prep: falhar('erro', 'jobs'), erroEsperado: true, espera: 'Tentar' }),
  t('detalhe', 'empresa', turno(1), 'detalhe do turno', { espera: 'Garçom para casamento' }),
  t('detalhe-menu', 'empresa', turno(1), 'menu de ações', { passos: [menuTurno], espera: 'Excluir|Cancelar|Editar' }),
  t('detalhe-cancelar', 'empresa', turno(1), 'CancelJobModal (R23: só quem opera em equipe)', { prep: (m) => m.comEquipe(), passos: [menuTurno, { clicar: /Cancelar turno/ }], espera: 'Manter o turno' }),
  t('detalhe-cancelado', 'empresa', turno(6), 'turno cancelado', { espera: 'Copeiro' }),
  t('detalhe-erro', 'empresa', turno(1), 'falha de carga', { prep: falhar('erro', 'jobs'), erroEsperado: true, espera: 'Tentar' }),

  pp('turno-futuro', 'empresa', cand(1), 'contratado, convidado, recusou, chamado aberto, véspera confirmada', { espera: 'Garçom para casamento' }),
  pp('sem-ninguem', 'empresa', cand(1), 'nenhum freela no turno', { prep: (m) => { m.db.applications = []; m.db.shift_calls = []; m.db.shift_call_targets = []; }, espera: 'Nenhum freela atrelado' }),
  pp('convidar-do-elenco', 'empresa', cand(1), 'modal Convidar Freela', { prep: (m) => { m.db.applications = []; m.db.shift_calls = []; m.db.shift_call_targets = []; }, passos: [{ clicar: 'Convidar Freela do Elenco' }], espera: 'Convidar Freela' }),
  pp('convite-expirado-reconvidar', 'empresa', cand(1), 'invited vencido: Convidar outro', { prep: soCand(2, { invitation_expires_at: em(-1) }), passos: [{ clicar: /^Convidar outro/ }], espera: 'convite anterior expirou' }),
  pp('sem-resposta-vespera', 'empresa', cand(1), 'pediu confirmação e não respondeu: substituto', { prep: (m) => { soCand(1)(m); Object.assign(m.db.shift_attendance_confirmations[0], { source: 'manual', requested_by: ID.empresa, response: null, responded_at: null }); }, espera: 'Sem resposta' }),
  pp('nao-vai', 'empresa', cand(1), 'avisou que não vai', { prep: (m) => { soCand(1)(m); m.db.shift_attendance_confirmations[0].response = 'cannot_attend'; }, espera: 'não vai' }),
  pp('dispensar', 'empresa', cand(1), 'modal Dispensar Freela', { prep: soCand(1), passos: [{ clicar: /^Dispensar/ }], espera: 'Dispensar' }),
  pp('confirmar-chegada', 'empresa', cand(7), 'freela marcou chegada, empresa confirma', { espera: 'Confirmar Chegada' }),
  pp('presenca-manual', 'empresa', cand(7), 'modal de horário manual (freela sem check-in)', { prep: (m) => { m.app(9).worker_checkin_at = null; }, passos: [{ clicar: /^Confirmar Presença/ }], espera: 'Horário real' }),
  pp('saida-manual', 'empresa', cand(2), 'modal de saída manual', { passos: [{ clicar: /^Registrar Saída/ }], espera: 'Horário real' }),
  pp('concluido-todos-estados', 'empresa', cand(3), 'registrado, agendado, confirmado e estornado', { espera: 'Ver Comprovante' }),
  pp('registrar-pagamento', 'empresa', cand(3), 'modal Registrar Pagamento com PIX', { prep: semPagamento, passos: [{ clicar: /^Registrar Pagamento/ }], espera: 'declaratório' }),
  pp('registrar-pagamento-sem-pix', 'empresa', cand(3), 'freela sem chave PIX, valor zero', { prep: (m) => { semPagamento(m); m.eu().pix_key = null; m.job(3).budget = 0; }, passos: [{ clicar: /^Registrar Pagamento/ }], espera: 'declaratório' }),
  pp('pagamento-registrado', 'empresa', cand(3), 'confirmação de sucesso', { prep: semPagamento, passos: [{ clicar: /^Registrar Pagamento/ }, { clicar: /^Confirmar Registro/ }], espera: 'registrado' }),
  pp('agendar-pagamento', 'empresa', cand(3), 'modal Agendar Pagamento', { prep: semPagamento, passos: [{ clicar: /^Agendar Pagamento/ }], espera: 'Agendar' }),
  pp('estornar', 'empresa', cand(3), 'modal Estornar/cancelar a partir de um pagamento agendado', { prep: soCand(5), passos: [{ clicar: /^(Estornar|Cancelar agendamento)/ }], espera: 'Estornar pagamento' }),
  pp('finalizado-registrado-sem-estorno', 'empresa', cand(3), 'DEFEITO: turno finalizado com pagamento registrado só oferece Ver Recibo (sem Estornar)', { prep: soCand(4), espera: 'Ver Recibo' }),
  pp('avaliar', 'empresa', cand(3), 'empresa avalia freela', { prep: soCand(4), passos: [{ clicar: /^Avaliar/ }], espera: 'Coment|Avaliar' }),
  pp('confirmar-entrega-escrow', 'empresa', cand(3), 'legado com escrow: Confirmar Entrega', { prep: (m) => { soCand(4, { status: 'in_progress' })(m); m.db.shift_payments = []; m.db.escrow_transactions = [{ id: id(91), job_id: id(20, 3), application_id: id(30, 4), kind: 'prepaid', status: 'reserved', amount: 160 }]; }, passos: [{ clicar: /^Confirmar Entrega/ }], espera: 'Confirmar Entrega' }),
  pp('carregando', 'empresa', cand(1), 'consulta pendurada', { prep: falhar('pendura', 'applications'), carregandoEsperado: true }),
  pp('erro', 'empresa', cand(1), 'falha de carga', { prep: falhar('erro', 'jobs'), erroEsperado: true, espera: 'Tentar|Voltar para Turnos' }),
  pp('perfil-do-freela', 'empresa', `/company/worker/${ID.freela}`, 'perfil visto pela empresa com certificações e treinamentos', { espera: 'Ana Beatriz' }),
  pp('registrar-treinamento', 'empresa', `/company/worker/${ID.freela}`, 'modal Registrar Treinamento', { passos: [{ clicar: /^Registrar/ }], espera: 'Treinamento' }),
  pp('revogar-treinamento', 'empresa', `/company/worker/${ID.freela}`, 'modal Revogar com motivo', { passos: [{ clicar: /^Revogar/ }], espera: 'Revogar Treinamento' }),
  pp('freela-sem-certificacao', 'empresa', `/company/worker/${id(10, 5)}`, 'sem certificação nem histórico', { prep: (m) => { m.db.worker_certifications = []; m.db.worker_trainings = []; m.rpc.get_profile_reviews = []; m.rpc.get_worker_company_badges = []; }, espera: 'não cadastrou certificações' }),
  pp('freela-inexistente', 'empresa', `/company/worker/${id(9, 9)}`, 'id inexistente ou sem vínculo', { espera: 'Não foi possível abrir|não encontrado' }),

  ch('painel-aberto', 'empresa', cand(1), 'chamado em aberto com respostas', { prep: (m) => { m.db.shift_attendance_confirmations = []; }, espera: 'Cancelar' }),
  ch('cancelar-chamado', 'empresa', cand(1), 'confirmação de cancelar chamado', { passos: [{ clicar: /Cancelar chamado|Encerrar chamado|^Cancelar$/ }], espera: 'Cancelar este chamado' }),
  ch('modal-chamado', 'empresa', cand(1), 'ShiftCallModal com listas, disponibilidade e risco de vínculo', { prep: (m) => { m.db.applications = []; m.db.shift_calls = []; }, passos: abrirChamado, espera: 'Motivo' }),
  ch('modal-chamado-selecionados', 'empresa', cand(1), 'lista selecionada e aviso de menos alvos que vagas', { prep: (m) => { m.db.applications = []; m.db.shift_calls = []; }, passos: [...abrirChamado, { clicar: /Turma de sábado/ }], espera: 'selecion|Chamar' }),
  ch('modal-chamado-elenco-vazio', 'empresa', cand(1), 'elenco vazio', { prep: (m) => { m.db.applications = []; m.db.team_connections = []; m.db.shift_calls = []; }, passos: abrirChamado, espera: 'Motivo|elenco|Elenco' }),
  ch('via-query', 'empresa', `${cand(1)}?chamar=1`, '?chamar=1 abre o modal', { espera: 'Motivo' }),
  ch('sos-elegivel', 'empresa', cand(1), 'sos_call_eligibility.eligible', { prep: sos('ok'), espera: 'SOS: fora do Elenco' }),
  ch('sos-modal', 'empresa', cand(1), 'modal do SOS', { prep: sos('ok'), passos: [{ clicar: 'SOS: fora do Elenco' }], espera: 'não vai ver quem foi chamado' }),
  ...['quota_open', 'quota_week', 'team_not_tried', 'team_call_still_open', 'not_urgent', 'already_filled'].map((r) => ch(`sos-bloqueado-${r.replace(/_/g, '-')}`, 'empresa', cand(1), `SOS inelegível: ${r}`, { prep: sos(r), espera: 'SOS' })),
  ch('chamado-sos-aberto', 'empresa', cand(1), 'chamado de origem SOS: alvos ocultos', { prep: (m) => { Object.assign(m.db.shift_calls[0], { origin: 'sos', targets_count: 18 }); m.db.shift_call_targets = []; }, espera: 'SOS|18' }),
  ch('chamado-expirado', 'empresa', cand(1), 'prazo vencido com status ainda open (não há cron); DEFEITO: alvos sem resposta seguem "Aguardando"', { prep: (m) => { m.db.shift_calls[0].expires_at = em(-1); }, espera: 'Chamado expirou' }),

  el('elenco', 'empresa', '/company/team', 'membros, pendentes, listas', { espera: 'Turma de sábado' }),
  el('vazio', 'empresa', '/company/team', 'elenco vazio', { prep: semNada, espera: 'Elenco vazio' }),
  el('adicionar', 'empresa', '/company/team', 'AddWorkerModal', { passos: [{ clicar: 'Adicionar Freela' }], espera: 'Adicionar|ID|QR' }),
  el('nova-lista', 'empresa', '/company/team', 'TeamListModal (nova)', { passos: [{ clicar: 'Nova lista' }], espera: 'lista' }),
  el('editar-lista', 'empresa', '/company/team', 'TeamListModal (editar)', { passos: [{ css: aria('Editar lista Turma de sábado') }], espera: 'Turma de sábado' }),
  el('excluir-lista', 'empresa', '/company/team', 'confirmação de exclusão', { passos: [{ css: aria('Excluir lista Turma de sábado') }], espera: 'Excluir lista' }),
  el('convidar-para-turno', 'empresa', '/company/team', 'InviteToShiftModal', { passos: [{ clicar: 'Convidar para turno' }], espera: 'turno' }),
  el('convidar-para-turno-sem-turno', 'empresa', '/company/team', 'sem turno aberto', { prep: (m) => { m.db.jobs = []; }, passos: [{ clicar: 'Convidar para turno' }], espera: 'turno' }),
  el('remover', 'empresa', '/company/team', 'RemoveMemberDialog', { passos: [{ css: '[aria-label^="Remover freela"]' }], espera: 'Remover' }),
  el('indicacoes-recebidas', 'empresa', '/company/indicacoes', 'recebidas em 3 estados', { espera: 'Indicado por' }),
  el('indicacoes-enviadas', 'empresa', '/company/indicacoes', 'aba enviadas', { passos: [{ clicar: /Enviadas/ }], espera: 'Café Girassol' }),
  el('indicacoes-vazio', 'empresa', '/company/indicacoes', 'nenhuma recebida', { prep: semNada, espera: 'Nenhuma indicação' }),
  el('indicar', 'empresa', '/company/indicacoes', 'CreateReferralModal', { passos: [{ clicar: 'Indicar Freela' }], espera: 'Empresa destino' }),

  pe('visao', 'empresa', '/company/profile', 'dados da empresa', { espera: 'Momentos Doces' }),
  pe('vazio', 'empresa', '/company/profile', 'campos nulos e sem nota', { prep: (m) => { Object.assign(m.db.companies[0], { description: null, website: null, email: null, address: null, industry: null, default_briefing: null, rating_average: null, reviews_count: 0 }); m.rpc.get_profile_reviews = []; }, espera: 'Momentos Doces' }),
  pe('editando', 'empresa', '/company/profile', 'modo edição', { passos: [{ clicar: 'Editar Perfil' }], espera: 'Cancelar' }),
  pe('conta', 'empresa', '/company/profile', 'configurações de conta', { passos: [{ clicar: /Configurações|Segurança|Conta/ }], espera: 'Zona de Perigo' }),
  pe('excluir', 'empresa', '/company/profile', 'modal de exclusão', { passos: [{ clicar: /Configurações|Segurança|Conta/ }, { clicar: /Excluir minha empresa|Excluir/ }], espera: 'irreversível' }),
];
