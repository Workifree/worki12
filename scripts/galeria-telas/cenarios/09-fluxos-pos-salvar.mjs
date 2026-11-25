// Estados que só aparecem depois de salvar: precisam percorrer o formulário.
import { grupoDe, aria } from '../lib/cenario.mjs';
import { id, dia } from '../fixtures/world.mjs';

const t = grupoDe('empresa-turnos');
const pp = grupoDe('empresa-presenca-pagamento');
const x = grupoDe('extras');
const travar = (m) => { m.db.Conversation.forEach((c) => { c.islocked = true; }); };

const preencher = [
  { preencher: [aria('Título do Turno'), 'Garçom para confraternização'] }, { selecionar: [aria('Função'), { index: 1 }] },
  { preencher: [aria('Data de início'), dia(5)] }, { preencher: [aria('Horário de entrada'), '18:00'] }, { preencher: [aria('Horário de saída'), '23:00'] },
  { preencher: [aria('Localização Específica'), 'Rua das Acácias, 120 - Pinheiros'] }, { preencher: [aria('Valor do orçamento'), '180'] },
  { preencher: [aria('Descrição Completa'), 'Servir as mesas e apoiar a desmontagem.'] },
];
const enviar = { css: 'form button[type=submit]' };
const semModelos = (m) => { m.db.jobs = []; };
const soConcluido = (m) => { m.db.applications = [m.app(4)]; m.db.shift_payments = []; };

export default [
  t('criado-convidar', 'empresa', '/company/create', 'turno salvo: painel Convidar freela', { prep: semModelos, passos: [...preencher, enviar], espera: 'Convidar freela' }),
  t('criado-convidar-sem-elenco', 'empresa', '/company/create', 'turno salvo com elenco vazio', { prep: (m) => { semModelos(m); m.db.team_connections = []; }, passos: [...preencher, enviar], espera: 'Meu Elenco|elenco' }),
  t('serie-criada', 'empresa', '/company/create', 'create_job_series outcome=ok', { prep: (m) => { semModelos(m); m.rpc.create_job_series = { outcome: 'ok', series_id: id(60, 9), occurrences: 6 }; }, passos: [...preencher, { clicar: /Repetir este turno|Repetir|recorr/i }, { preencher: [aria('Repetir até'), dia(47)] }, { clicar: /^s[aá]b/i }, enviar], espera: 'Série criada' }),
  t('serie-editar-previa', 'empresa', '/company/jobs', 'prévia (dry run) da edição das próximas', { prep: (m) => { m.db.jobs = [m.job(4), m.job(5)]; m.rpc.update_job_series_future = { outcome: 'ok', affected: 6, with_commitments: 2, skipped: 1, workers: 2 }; }, passos: [{ css: aria('Mais opções do turno') }, { clicar: /Editar.*(série|seguintes|futur)/i }, { preencher: ['[role=dialog] input >> nth=0', 'Barista de sábado (manhã)'] }, { clicar: /^Continuar/ }], espera: 'Voltar' }),
  pp('pagamento-agendado-sucesso', 'empresa', `/company/jobs/${id(20, 3)}/candidates`, 'agendamento gravado', { prep: soConcluido, passos: [{ clicar: /^Agendar Pagamento/ }, { preencher: ['[role=dialog] input[type=date]', dia(6)] }, { css: '[role=dialog] button >> text=/^(Agendar|Confirmar)/' }], espera: 'agendado' }),
  x('chat-travado-freela', 'freela', `/messages?conversation=${id(95, 1)}`, 'Conversation.islocked', { prep: travar, espera: '15 minutos antes' }),
  x('chat-travado-empresa', 'empresa', `/company/messages?conversation=${id(95, 1)}`, 'Conversation.islocked', { prep: travar, espera: '15 minutos antes' }),
  x('qr-camera-negada', 'empresa', '/company/team', 'leitor de QR sem permissão de câmera', { init: () => { if (navigator.mediaDevices) { navigator.mediaDevices.getUserMedia = () => Promise.reject(new DOMException('negado', 'NotAllowedError')); navigator.mediaDevices.enumerateDevices = () => Promise.resolve([]); } }, passos: [{ clicar: 'Adicionar Freela' }, { clicar: /QR|c[aâ]mera/i }], espera: 'câmera' }),
  x('admin-email-sem-permissao', 'empresa', '/admin', 'tentativa de login com e-mail fora da lista (espera progressiva)', { passos: [{ preencher: ['input[type=email]', 'outra@galeria.invalid'] }, { preencher: ['input[type=password]', 'SenhaDeMentira#1'] }, { css: 'form button[type=submit]' }], espera: 'não tem permissão' }),
  x('sino-vazio', 'empresa', '/company/dashboard', 'dropdown sem notificações', { prep: (m) => { m.db.notifications = []; }, passos: [{ css: 'button[aria-label*="otifica" i]' }], espera: 'Nenhuma|sem notifica' }),
  x('redefinir-senha-sem-sessao', 'anon', '/redefinir-senha', 'link aberto sem sessão de recuperação', { espera: 'senha' }),
];
