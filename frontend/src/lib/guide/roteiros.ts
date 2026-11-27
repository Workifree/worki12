/**
 * Catálogo de roteiros, derivado do mapa de intenções. Conteúdo próprio e versionado: nunca vem do
 * banco nem de texto de terceiros.
 */
import type { PapelGuia, PassoGuia, RoteiroGuia } from './tipos';

const GESTOR: readonly PapelGuia[] = ['gestor'];
const EMPRESA: readonly PapelGuia[] = ['gestor', 'encarregado'];
const ENCARREGADO: readonly PapelGuia[] = ['encarregado'];
const FREELA: readonly PapelGuia[] = ['freela'];

const SEM_TURNO_COM_VAGA =
    'Esse botão só aparece em turno com vaga aberta. Se a lista está vazia ou o turno já está completo, crie um turno primeiro.';

const abrirPresenca: PassoGuia = {
    rota: 'empresa.turnos',
    tambemEm: ['empresa.turno'],
    avancaAoChegar: 'empresa.presenca',
    alvos: ['empresa.turnos.marcar-presenca', 'empresa.turno.abrir-presenca', 'empresa.turnos.ver-turno'],
    titulo: 'Escolha o turno',
    explicacao: 'Procure o turno na lista. Cada turno tem o próprio acompanhamento.',
    aoTocar: 'Abre o turno. Se abrir o detalhe, siga até Presença e pagamento.',
    semAlvo: 'Não há turno com freela aqui. Troque o filtro ou crie um turno.',
};

const naPresenca = (passo: Omit<PassoGuia, 'rota'>): PassoGuia => ({ rota: 'empresa.presenca', ...passo });

const enviarTurno: PassoGuia = {
    rota: 'empresa.criar',
    alvos: ['empresa.turno-criar.enviar'],
    titulo: 'Confira e publique',
    explicacao: 'Revise data, horário e valor. Se faltar algo, a própria tela avisa o que é.',
    aoTocar: 'Cria o turno. Nenhum dinheiro é cobrado.',
};

const EMPRESA_ROTEIROS: readonly RoteiroGuia[] = [
    {
        id: 'empresa-criar-turno', papeis: EMPRESA,
        titulo: 'Criar um turno',
        descricao: 'Publicar um turno novo com data, horário e valor.',
        frases: ['nova vaga', 'abrir turno', 'publicar diaria', 'marcar plantao', 'escala', 'preciso de gente amanha'],
        passos: [
            {
                rota: 'empresa.criar', alvos: ['empresa.turno-criar.usar-modelo'],
                titulo: 'Comece de um turno anterior',
                explicacao: 'Se quiser, copie um turno que você já fez. Depois é só escolher a nova data.',
                aoTocar: 'Preenche o formulário. Nada é publicado ainda.',
                semAlvo: 'Não há turno anterior para copiar aqui. Preencha título, função, data, horários e valor.',
            },
            enviarTurno,
        ],
    },
    {
        id: 'empresa-repetir-turno', papeis: EMPRESA,
        titulo: 'Repetir um turno que já fiz',
        descricao: 'Aproveitar os dados de um turno recente.',
        frases: ['copiar turno', 'turno igual ao de ontem', 'duplicar vaga', 'toda semana', 'toda sexta'],
        passos: [
            {
                rota: 'empresa.inicio', alvos: ['empresa.inicio.repetir-turno'],
                titulo: 'Toque em repetir',
                explicacao: 'Na lista de turnos recentes, escolha o que quer repetir.',
                aoTocar: 'Abre o formulário já preenchido, com a data em branco.',
                semAlvo: 'Não há turno recente para repetir. Use Criar turno.',
                avancaAoTocar: true,
            },
            {
                ...enviarTurno,
                explicacao: 'Escolha a nova data. Para repetir toda semana, use a opção de repetição do formulário.',
            },
        ],
    },
    {
        id: 'empresa-chamar-freelas', papeis: EMPRESA,
        titulo: 'Chamar freelas para um turno',
        descricao: 'Convidar várias pessoas do Elenco. Quem aceitar primeiro ocupa a vaga.',
        frases: ['convidar gente', 'preencher vaga', 'falta um garcom', 'convocar', 'mandar chamado'],
        passos: [
            {
                rota: 'empresa.turnos', alvos: ['empresa.turnos.chamar-freelas'],
                titulo: 'Escolha o turno com vaga',
                explicacao: 'Toque em Chamar freelas no turno que precisa de gente.',
                aoTocar: 'Abre a escolha de pessoas. Nada é enviado ainda.',
                semAlvo: SEM_TURNO_COM_VAGA,
                avancaAoTocar: true,
                avancaAoChegar: 'empresa.presenca',
            },
            naPresenca({
                alvos: ['empresa.chamado.enviar', 'empresa.presenca.chamar-freelas'],
                titulo: 'Marque quem chamar e envie',
                explicacao: 'Marque as pessoas, escolha o motivo e o prazo de resposta. Depois envie.',
                aoTocar: 'No envio, as pessoas marcadas recebem o convite. A primeira que aceitar fica com a vaga.',
                semAlvo: 'Se o turno já está completo, não há botão de chamar.',
            }),
        ],
    },
    {
        id: 'empresa-ver-respostas', papeis: EMPRESA,
        titulo: 'Ver quem respondeu ao chamado',
        descricao: 'Acompanhar respostas e, se quiser, parar de procurar.',
        frases: ['quem aceitou', 'cancelar chamado', 'parar de procurar', 'ninguem respondeu'],
        passos: [
            abrirPresenca,
            naPresenca({
                alvos: ['empresa.presenca.encerrar-chamado'],
                titulo: 'Acompanhe o chamado',
                explicacao: 'O quadro de chamados mostra quem aceitou, recusou ou ainda não respondeu.',
                aoTocar: 'O botão encerra a procura, após confirmação. Quem já aceitou continua no turno.',
                semAlvo: 'Não há chamado aberto neste turno.',
            }),
        ],
    },
    {
        id: 'empresa-sos', papeis: EMPRESA,
        titulo: 'Pedir ajuda urgente fora do Elenco (SOS)',
        descricao: 'Avisar freelas de fora quando o Elenco não resolveu e falta pouco tempo.',
        frases: ['urgencia', 'emergencia', 'alguem faltou', 'sos nao abre', 'ninguem do elenco'],
        passos: [
            abrirPresenca,
            naPresenca({
                alvos: ['empresa.presenca.sos'],
                titulo: 'SOS: fora do Elenco',
                explicacao: 'Só libera perto do horário e depois de tentar o seu Elenco. Há limite de uso. Apagado, o motivo aparece ao lado.',
                aoTocar: 'Abre a confirmação. Se enviar, pessoas fora do Elenco são avisadas.',
                semAlvo: 'O SOS não aparece neste turno. Confira se ainda há vaga aberta e se o turno não começou.',
            }),
        ],
    },
    {
        id: 'empresa-presenca', papeis: EMPRESA,
        titulo: 'Registrar chegada e saída',
        descricao: 'Confirmar a presença de quem trabalhou.',
        frases: ['presenca', 'checkin', 'checkout', 'ponto', 'freela chegou', 'confirmar entrada'],
        passos: [
            abrirPresenca,
            naPresenca({
                alvos: ['empresa.presenca.registrar-chegada'],
                titulo: 'Chegada', risco: 'D',
                explicacao: 'Confira o nome e o horário. A presença gravada não pode ser mudada.',
                aoTocar: 'Registra a chegada dessa pessoa.',
                semAlvo: 'Não há chegada para registrar: já foi registrada ou não há freela contratado.',
            }),
            naPresenca({
                alvos: ['empresa.presenca.registrar-saida'],
                titulo: 'Saída', risco: 'D',
                explicacao: 'No fim do turno, registre a saída. Ela vem antes do pagamento.',
                aoTocar: 'Registra a saída. Também não pode ser mudada.',
                semAlvo: 'A saída só aparece depois da chegada registrada.',
            }),
        ],
    },
    {
        id: 'empresa-confirmacao-vespera', papeis: EMPRESA,
        titulo: 'Perguntar se o freela vem',
        descricao: 'Pedir confirmação antes do turno.',
        frases: ['confirmar vespera', 'sera que vem', 'confirmacao de presenca', 'lembrar freela'],
        passos: [
            abrirPresenca,
            naPresenca({
                alvos: ['empresa.presenca.perguntar-se-vem'],
                titulo: 'Perguntar se vem',
                explicacao: 'Serve para descobrir a falta com antecedência. Há um intervalo entre um pedido e outro.',
                aoTocar: 'O freela recebe a pergunta no app.',
                semAlvo: 'O botão só aparece antes do turno, para quem está contratado.',
            }),
        ],
    },
    {
        id: 'empresa-whatsapp', papeis: EMPRESA,
        titulo: 'Avisar o freela no WhatsApp',
        descricao: 'Abrir o WhatsApp com a mensagem do turno pronta.',
        frases: ['zap', 'mandar mensagem no whats', 'telefone do freela'],
        passos: [
            abrirPresenca,
            naPresenca({
                alvos: ['empresa.presenca.avisar-whatsapp'],
                titulo: 'Avisar no WhatsApp',
                explicacao: 'A mensagem já vem pronta com os dados do turno.',
                aoTocar: 'Abre o WhatsApp. Você revisa e envia por lá.',
                semAlvo: 'O botão não aparece se não há freela neste turno ou se o aviso não se aplica.',
            }),
        ],
    },
    {
        id: 'empresa-pagamento', papeis: EMPRESA,
        titulo: 'Registrar um pagamento',
        descricao: 'Você paga por fora (PIX ou dinheiro) e registra aqui. O Worki não paga por você.',
        frases: ['pagar freela', 'pix', 'acerto', 'dei o dinheiro', 'agendar pagamento', 'marcar como pago', 'recibo'],
        passos: [
            abrirPresenca,
            naPresenca({
                alvos: ['empresa.presenca.registrar-pagamento', 'empresa.presenca.agendar-pagamento'],
                titulo: 'Registrar ou agendar', risco: 'D',
                explicacao: 'Pague primeiro pelo seu banco ou em dinheiro. Aqui fica só o registro. Se vai pagar depois, use Agendar pagamento.',
                aoTocar: 'Abre o formulário. Ao confirmar, o freela é avisado.',
                semAlvo: 'Isso libera depois da saída confirmada. Se já há pagamento registrado ou agendado para a pessoa, não aparece de novo.',
            }),
            naPresenca({
                alvos: ['empresa.presenca.marcar-pago', 'empresa.presenca.ver-recibo'],
                titulo: 'Depois do registro', risco: 'D',
                explicacao: 'Pagamento agendado precisa ser marcado como pago quando você pagar. O recibo fica disponível para os dois.',
                aoTocar: 'Marcar como pago pede ao freela que confirme o recebimento. Ver recibo só abre o comprovante.',
                semAlvo: 'Esses botões aparecem depois que existe um pagamento registrado ou agendado.',
            }),
        ],
    },
    {
        id: 'empresa-estornar', papeis: GESTOR,
        titulo: 'Estornar um pagamento registrado',
        descricao: 'Corrigir um registro errado. O dinheiro já enviado não volta sozinho.',
        frases: ['paguei errado', 'desfazer pagamento', 'cancelar agendamento', 'estorno'],
        passos: [
            abrirPresenca,
            naPresenca({
                alvos: ['empresa.presenca.estornar'],
                titulo: 'Estornar', risco: 'D',
                explicacao: 'Só o Gestor faz. Isso corrige o registro no Worki, não movimenta dinheiro.',
                aoTocar: 'Pede o motivo e a confirmação. O freela é avisado.',
                semAlvo: 'Não há pagamento registrado ou agendado neste turno.',
            }),
        ],
    },
    {
        id: 'empresa-avaliar', papeis: EMPRESA,
        titulo: 'Avaliar um freela',
        descricao: 'Dar nota depois do turno.',
        frases: ['dar estrelas', 'nota do freela', 'comentario'],
        passos: [
            abrirPresenca,
            naPresenca({
                alvos: ['empresa.presenca.avaliar'],
                titulo: 'Avaliar',
                explicacao: 'A nota e o comentário são seus.',
                aoTocar: 'Abre a janela das estrelas.',
                semAlvo: 'A avaliação aparece depois do turno concluído.',
                avancaAoTocar: true,
            }),
            naPresenca({
                alvos: ['empresa.presenca.enviar-avaliacao'],
                titulo: 'Enviar a avaliação',
                explicacao: 'Escolha as estrelas. O comentário é opcional.',
                aoTocar: 'Envia a avaliação.',
                semAlvo: 'Abra a janela em Avaliar para ver este botão.',
            }),
        ],
    },
    {
        id: 'empresa-dispensar', papeis: EMPRESA,
        titulo: 'Cancelar um convite ou dispensar um freela',
        descricao: 'Tirar alguém do turno e, se precisar, chamar outra pessoa.',
        frases: ['desconvidar', 'tirar do turno', 'substituir', 'trocar freela'],
        passos: [
            abrirPresenca,
            naPresenca({
                alvos: ['empresa.presenca.cancelar-convite', 'empresa.presenca.dispensar'],
                titulo: 'Cancelar convite ou dispensar', risco: 'D',
                explicacao: 'Cancelar vale para quem ainda não respondeu. Dispensar vale para quem já está contratado. A mesma pessoa não volta para este turno.',
                aoTocar: 'Cancela o convite ou pede confirmação para dispensar. O freela é avisado.',
                semAlvo: 'Não há convite pendente nem contratado que possa sair deste turno.',
            }),
        ],
    },
    {
        id: 'empresa-cancelar-turno', papeis: EMPRESA,
        titulo: 'Cancelar ou excluir um turno',
        descricao: 'Retirar um turno que não vai acontecer.',
        frases: ['apagar turno', 'excluir vaga', 'desmarcar', 'nao vai ter evento'],
        passos: [{
            rota: 'empresa.turnos', alvos: [], risco: 'D',
            titulo: 'Abra as opções do turno',
            explicacao: 'No turno certo, abra o menu de mais opções. Cancelar e excluir ficam no fim da lista.',
            aoTocar: 'A tela pede confirmação antes. Se há gente no turno, ela é avisada. Não dá para desfazer.',
        }],
    },
    {
        id: 'empresa-elenco-adicionar', papeis: EMPRESA,
        titulo: 'Trazer um freela para o Elenco',
        descricao: 'Mandar o seu link ou adicionar pelo código do freela.',
        frases: ['adicionar freela', 'convidar freelancer', 'link do elenco', 'codigo do freela', 'qr'],
        passos: [
            {
                rota: 'empresa.elenco', alvos: ['empresa.elenco.copiar-link'],
                titulo: 'Copie o link do Elenco',
                explicacao: 'Mande o link por onde preferir. O freela abre e entra no seu Elenco.',
                aoTocar: 'Copia o link. Nada é enviado sozinho.',
                semAlvo: 'O link não está nesta tela para você agora. Use Adicionar freela.',
            },
            {
                rota: 'empresa.elenco', alvos: ['empresa.elenco.adicionar-freela'],
                titulo: 'Ou adicione por aqui',
                explicacao: 'Se o freela te passou o código dele, adicione por este botão.',
                aoTocar: 'Abre a janela. O freela precisa aceitar o pedido.',
                semAlvo: 'O botão aparece no topo do Elenco quando a tela termina de carregar.',
            },
        ],
    },
    {
        id: 'empresa-convidar-um', papeis: EMPRESA,
        titulo: 'Convidar uma pessoa específica para um turno',
        descricao: 'Chamar só quem você escolher no Elenco.',
        frases: ['chamar so uma pessoa', 'convite individual', 'convidar do elenco'],
        passos: [{
            rota: 'empresa.elenco', alvos: ['empresa.elenco.convidar-turno'],
            titulo: 'Convidar para turno',
            explicacao: 'Ache a pessoa no Elenco e toque no botão dela.',
            aoTocar: 'Abre a escolha do turno. O convite só sai quando você confirmar.',
            semAlvo: 'Só quem já aceitou entrar no Elenco pode ser convidado. Se está vazio, traga alguém primeiro.',
        }],
    },
    {
        id: 'empresa-relatorio', papeis: GESTOR,
        titulo: 'Ver quanto gastei',
        descricao: 'Relatório de pagamentos registrados por período.',
        frases: ['gasto do mes', 'relatorio', 'exportar planilha', 'csv', 'quanto paguei', 'total'],
        passos: [{
            rota: 'empresa.relatorio', alvos: ['empresa.relatorio.exportar-csv'],
            titulo: 'Escolha o período e exporte',
            explicacao: 'Os totais mudam com o período escolhido. Se quiser, leve os dados para uma planilha.',
            aoTocar: 'Baixa um arquivo com os registros mostrados.',
            semAlvo: 'Sem registros no período, não há o que exportar. Troque as datas.',
        }],
    },
    {
        id: 'empresa-operacao', papeis: GESTOR,
        titulo: 'Ver como anda a operação',
        descricao: 'Indicadores dos seus turnos.',
        frases: ['indicadores', 'numeros', 'faltas', 'desempenho'],
        passos: [{
            rota: 'empresa.operacao', alvos: [], titulo: 'Números da operação',
            explicacao: 'Escolha o período no alto da tela. Os quadros resumem o que aconteceu nele.',
            aoTocar: 'Mudar o período só atualiza a visão.',
        }],
    },
    {
        id: 'empresa-convidar-encarregado', papeis: GESTOR,
        titulo: 'Convidar um funcionário (Gestor ou Encarregado)',
        descricao: 'Convidar um funcionário por e-mail e, se quiser, definir a loja dele.',
        frases: ['adicionar gerente', 'equipe', 'cadastrar funcionario', 'adicionar pessoa', 'link da equipe', 'login para funcionario', 'encarregado', 'permissao'],
        passos: [{
            rota: 'empresa.equipe', alvos: ['empresa.equipe.convidar'], risco: 'D',
            titulo: 'Convidar para a equipe (funcionários)',
            explicacao: 'Quem entrar passa a operar na sua empresa. Depois do aceite, você ainda confirma se é a pessoa certa.',
            aoTocar: 'Abre o formulário do convite, que gera um link para você enviar.',
            semAlvo: 'Só o Gestor vê este botão.',
        }],
    },
    {
        id: 'empresa-dados', papeis: GESTOR,
        titulo: 'Mudar os dados da empresa e o briefing padrão',
        descricao: 'Editar o perfil e o texto que preenche os novos turnos.',
        frases: ['editar perfil', 'endereco', 'uniforme', 'instrucoes padrao', 'logo'],
        passos: [{
            rota: 'empresa.dados', alvos: ['empresa.dados.editar'],
            titulo: 'Editar',
            explicacao: 'O briefing padrão já vem preenchido em cada turno novo.',
            aoTocar: 'Abre os campos. Nada muda até você salvar.',
            semAlvo: 'Se os campos já estão abertos, você já está editando. Salve no fim.',
        }],
    },
    {
        id: 'empresa-indicar', papeis: GESTOR,
        titulo: 'Indicar um freela para outra empresa',
        descricao: 'Apresentar alguém. Só vale se o freela aceitar.',
        frases: ['indicacao', 'recomendar freela'],
        passos: [{
            rota: 'empresa.indicacoes', alvos: ['empresa.indicacoes.indicar'],
            titulo: 'Indicar freela',
            explicacao: 'Escolha a pessoa e a empresa. O freela decide se aceita.',
            aoTocar: 'Abre o formulário. Nada é enviado até você confirmar.',
            semAlvo: 'O botão aparece quando a tela Indicar freela termina de carregar.',
        }],
    },
    {
        id: 'empresa-mensagens', papeis: EMPRESA,
        titulo: 'Responder mensagem de um freela',
        descricao: 'Conversar pelo chat do Worki.',
        frases: ['chat', 'falar com freela', 'conversa'],
        passos: [{
            rota: 'empresa.mensagens', alvos: ['empresa.mensagens.enviar'],
            titulo: 'Abra a conversa e responda',
            explicacao: 'Escolha o freela na lista, escreva e envie. Se ele tem mais de um turno, troque o turno no topo da conversa. O Encarregado vê só os freelas dos turnos que cuida.',
            aoTocar: 'Envia a sua mensagem ao freela.',
            semAlvo: 'Abra uma conversa na lista. Se não há nenhuma, comece pela tela do turno.',
        }],
    },
    {
        id: 'empresa-cobrir', papeis: EMPRESA,
        titulo: 'Deixar alguém cobrindo os turnos',
        descricao: 'Passar o cuidado dos turnos para outra pessoa da equipe por alguns dias.',
        frases: ['folga', 'ferias', 'passar turno', 'substituir encarregado', 'cobertura'],
        passos: [{
            rota: 'empresa.hoje', alvos: ['empresa.hoje.cobrir'], risco: 'D',
            titulo: 'Cobrir',
            explicacao: 'Muda quem consegue ver e cuidar dos turnos nas datas escolhidas.',
            aoTocar: 'Abre a escolha de pessoa e datas, com confirmação.',
            semAlvo: 'Só aparece quando há outra pessoa na equipe.',
        }],
    },
    {
        id: 'encarregado-meus-turnos', papeis: ENCARREGADO,
        titulo: 'Ver meus turnos de hoje',
        descricao: 'Os turnos sob sua responsabilidade ou que você está cobrindo.',
        frases: ['o que tenho hoje', 'agenda', 'amanha', 'nao vejo turno'],
        passos: [{
            rota: 'empresa.hoje', alvos: ['empresa.hoje.ver-turno', 'empresa.hoje.chamar-freelas', 'empresa.hoje.criar-turno'],
            titulo: 'Seus turnos',
            explicacao: 'Aparecem só os turnos em que você é responsável ou que está cobrindo.',
            aoTocar: 'Abre o turno ou a ação escrita no botão.',
            semAlvo: 'Não há turno seu nestas datas. Se esperava ver um, peça ao Gestor para passar para você.',
        }],
    },
    {
        id: 'encarregado-menus', papeis: ENCARREGADO,
        titulo: 'Entender por que não vejo alguns menus',
        descricao: 'O que fica só com o Gestor.',
        frases: ['sem acesso', 'nao consigo abrir', 'equipe indicacoes'],
        passos: [{
            rota: 'empresa.hoje', alvos: [], titulo: 'Acesso de encarregado',
            explicacao: 'Equipe, Indicar freela e Dados da empresa ficam só com o Gestor. Se precisar de algo daí, peça a ele. Mensagens e Relatórios mostram só os turnos que você cuida.',
            aoTocar: 'Nada muda por aqui.',
        }],
    },
];

const FREELA_ROTEIROS: readonly RoteiroGuia[] = [
    {
        id: 'freela-convite', papeis: FREELA,
        titulo: 'Responder um convite de turno',
        descricao: 'Ver o convite, aceitar ou recusar.',
        frases: ['aceitar turno', 'recusar convite', 'me chamaram', 'proposta de trabalho', 'vaga'],
        passos: [
            {
                rota: 'freela.inicio', tambemEm: ['freela.turnos'],
                alvos: ['freela.inicio.ver-convite'],
                titulo: 'Veja o convite',
                explicacao: 'Quando uma empresa te chama, o aviso aparece no Início.',
                aoTocar: 'Abre Meus Turnos. Ainda não aceita nada.',
                semAlvo: 'Não há convite no Início agora. Siga para conferir em Meus Turnos.',
                avancaAoTocar: true,
            },
            {
                rota: 'freela.turnos', alvos: ['freela.convite.aceitar', 'freela.convite-destaque.aceitar'], risco: 'D',
                titulo: 'Se quiser ir, aceite',
                explicacao: 'Antes, confira data, horário, local, valor e instruções. A decisão é sua.',
                aoTocar: 'Você assume o turno e a empresa é avisada. Se a vaga já foi preenchida, o app avisa.',
                semAlvo: 'Não há convite pendente à vista. Toque na aba de convites; os vencidos ou já preenchidos somem.',
            },
            {
                rota: 'freela.turnos', alvos: ['freela.convite.recusar', 'freela.convite-destaque.recusar'], risco: 'D',
                titulo: 'Se não puder, recuse',
                explicacao: 'Se não der para ir, recuse para a empresa chamar outra pessoa.',
                aoTocar: 'Recusa o convite, após confirmação.',
                semAlvo: 'Não há convite pendente para recusar.',
            },
        ],
    },
    {
        id: 'freela-chegada', papeis: FREELA,
        titulo: 'Registrar minha chegada e saída',
        descricao: 'Marcar o começo e o fim do turno.',
        frases: ['checkin', 'checkout', 'cheguei', 'bater ponto', 'presenca', 'sai do trabalho'],
        passos: [
            {
                rota: 'freela.turnos', tambemEm: ['freela.inicio'],
                alvos: ['freela.turno.registrar-chegada'], risco: 'D',
                titulo: 'Ao chegar',
                explicacao: 'Toque só quando estiver no local. Vale a hora do momento do toque.',
                aoTocar: 'Registra sua chegada. Não dá para desfazer.',
                semAlvo: 'O botão aparece no turno de hoje. Antes do horário liberado ele fica apagado; depois de registrada a chegada, ele some.',
            },
            {
                rota: 'freela.turnos', tambemEm: ['freela.inicio'],
                alvos: ['freela.turno.registrar-saida'], risco: 'D',
                titulo: 'Ao sair',
                explicacao: 'Toque quando terminar o turno.',
                aoTocar: 'Registra sua saída. Não dá para desfazer.',
                semAlvo: 'A saída só aparece depois da chegada registrada.',
            },
        ],
    },
    {
        id: 'freela-falar-empresa', papeis: FREELA,
        titulo: 'Falar com a empresa',
        descricao: 'Abrir a conversa sobre um turno.',
        frases: ['chat', 'mandar mensagem', 'duvida do turno', 'vou atrasar'],
        passos: [
            {
                rota: 'freela.turnos', tambemEm: ['freela.inicio'],
                alvos: ['freela.turno.falar-empresa'],
                titulo: 'Falar com a empresa',
                explicacao: 'Fica no cartão do turno.',
                aoTocar: 'Abre a conversa. Você escreve e envia.',
                semAlvo: 'O botão aparece em turno aceito. Olhe as outras abas.',
                avancaAoTocar: true,
            },
            {
                rota: 'freela.mensagens', alvos: ['freela.mensagens.enviar'],
                titulo: 'Escreva e envie',
                explicacao: 'Escreva sua mensagem no campo.',
                aoTocar: 'Envia a mensagem para a empresa.',
                semAlvo: 'Escolha uma conversa na lista.',
            },
        ],
    },
    {
        id: 'freela-cancelar-turno', papeis: FREELA,
        titulo: 'Cancelar um turno que aceitei',
        descricao: 'Avisar que você não vai.',
        frases: ['desistir', 'nao vou poder ir', 'fiquei doente', 'faltar'],
        passos: [{
            rota: 'freela.turnos', tambemEm: ['freela.inicio'],
            alvos: ['freela.turnos.cancelar'], risco: 'D',
            titulo: 'Cancelar turno',
            explicacao: 'Cancele o quanto antes para a empresa achar outra pessoa. Você não volta para este turno.',
            aoTocar: 'Pede confirmação e avisa a empresa.',
            semAlvo: 'Só turno agendado e sem chegada registrada pode ser cancelado. Olhe a aba dos agendados.',
        }],
    },
    {
        id: 'freela-confirmar-recebimento', papeis: FREELA,
        titulo: 'Ver pagamento e confirmar que recebi',
        descricao: 'Quem paga é a empresa, por fora. Aqui você acompanha e confirma.',
        frases: ['cade meu pagamento', 'dinheiro', 'pix', 'recibo', 'nao recebi', 'saque', 'carteira'],
        passos: [
            {
                rota: 'freela.recebimentos', alvos: ['freela.recebimentos.confirmar'],
                titulo: 'Abra o recibo',
                explicacao: 'O Worki não deposita nem tem saque: a empresa paga direto a você e registra aqui.',
                aoTocar: 'Abre o recibo para conferir.',
                semAlvo: 'Não há pagamento esperando sua confirmação. Se a empresa ainda não registrou, fale com ela.',
                avancaAoTocar: true,
            },
            {
                rota: 'freela.recibo', alvos: ['freela.recibo.confirmar'], risco: 'D',
                titulo: 'Confirme só se o dinheiro chegou',
                explicacao: 'Confira o valor na sua conta antes. Leia o termo quando houver.',
                aoTocar: 'Registra que você recebeu. Não dá para desfazer.',
                semAlvo: 'Este recibo não pede confirmação: já foi confirmado ou o pagamento ainda está agendado.',
            },
            {
                rota: 'freela.recibo', alvos: ['freela.recibo.nao-recebi'],
                titulo: 'Se não recebeu',
                explicacao: 'Não confirme. Fale com a empresa.',
                aoTocar: 'Abre o caminho para falar com a empresa.',
                semAlvo: 'A opção aparece só em pagamento aguardando confirmação.',
            },
        ],
    },
    {
        id: 'freela-pix', papeis: FREELA,
        titulo: 'Cadastrar minha chave PIX',
        descricao: 'Sem ela a empresa não sabe para onde pagar.',
        frases: ['chave pix', 'dados para pagamento', 'mudar pix', 'cpf'],
        passos: [{
            rota: 'freela.perfil', alvos: ['freela.perfil.cadastrar-pix'], risco: 'D',
            titulo: 'Cadastrar chave PIX',
            explicacao: 'Digite a chave com calma e confira. O guia nunca preenche esse campo.',
            aoTocar: 'Abre o campo da chave. Só vale depois de salvar.',
            semAlvo: 'Sua chave já está cadastrada ou o perfil está em edição. Para trocar, edite o perfil.',
        }],
    },
    {
        id: 'freela-meu-link', papeis: FREELA,
        titulo: 'Entrar no Elenco de uma empresa',
        descricao: 'Mandar seu link ou código para a empresa.',
        frases: ['meu link', 'meu codigo', 'qr', 'empresa me adicionar', 'trabalhar com uma empresa'],
        passos: [{
            rota: 'freela.perfil', alvos: ['freela.perfil.copiar-link'],
            titulo: 'Copie seu link',
            explicacao: 'Mande o link para a empresa. Ao lado também dá para copiar o código.',
            aoTocar: 'Copia o link. Você escolhe para quem mandar.',
            semAlvo: 'O link aparece quando o perfil termina de carregar.',
        }],
    },
    {
        id: 'freela-disponibilidade', papeis: FREELA,
        titulo: 'Dizer os dias em que posso trabalhar',
        descricao: 'Declarar dias e períodos livres.',
        frases: ['disponibilidade', 'agenda', 'horario livre', 'fim de semana', 'folga'],
        passos: [{
            rota: 'freela.perfil', alvos: [], titulo: 'Disponibilidade',
            explicacao: 'No seu perfil, procure a parte de disponibilidade, marque dias e períodos e salve.',
            aoTocar: 'As empresas passam a ver quando você costuma poder.',
        }],
    },
    {
        id: 'freela-sos', papeis: FREELA,
        titulo: 'Receber chamados urgentes (SOS)',
        descricao: 'Escolher se empresas de fora das suas podem te avisar em urgências.',
        frases: ['sos', 'urgencia', 'mais trabalho', 'empresas novas', 'aparecer'],
        passos: [{
            rota: 'freela.perfil', alvos: ['freela.perfil.sos'], risco: 'D',
            titulo: 'Você decide se aparece',
            explicacao: 'Leia o texto ao lado antes de ligar.',
            aoTocar: 'Liga ou desliga os avisos urgentes. Dá para mudar quando quiser.',
            semAlvo: 'Essa opção fica em Preferências e privacidade, no perfil.',
        }],
    },
    {
        id: 'freela-privacidade', papeis: FREELA,
        titulo: 'Controlar indicações e selos no perfil',
        descricao: 'Privacidade: quem pode te indicar e o que aparece.',
        frases: ['privacidade', 'indicacao', 'esconder empresa', 'selos', 'ja trabalhou com'],
        passos: [
            {
                rota: 'freela.perfil', alvos: ['freela.perfil.indicacoes'], risco: 'D',
                titulo: 'Indicações',
                explicacao: 'Escolha se uma empresa pode te apresentar a outra. Mesmo ligado, nada acontece sem o seu aceite.',
                aoTocar: 'Muda sua preferência.',
                semAlvo: 'Fica em Preferências e privacidade, no perfil.',
            },
            {
                rota: 'freela.perfil', alvos: ['freela.perfil.selos'], risco: 'D',
                titulo: 'Empresas em que já trabalhei',
                explicacao: 'Você escolhe se esses selos aparecem.',
                aoTocar: 'Mostra ou esconde no seu perfil.',
                semAlvo: 'Os selos aparecem depois de um turno concluído.',
            },
        ],
    },
];

export const ROTEIROS: readonly RoteiroGuia[] = [...EMPRESA_ROTEIROS, ...FREELA_ROTEIROS];

export function roteirosDoPapel(papel: PapelGuia): RoteiroGuia[] {
    return ROTEIROS.filter((r) => r.papeis.includes(papel));
}

/** Primeiros passos por papel (ids do catálogo). */
export const PRIMEIROS_PASSOS: Readonly<Record<PapelGuia, readonly string[]>> = {
    gestor: ['empresa-elenco-adicionar', 'empresa-criar-turno', 'empresa-chamar-freelas', 'empresa-presenca', 'empresa-pagamento'],
    encarregado: ['encarregado-meus-turnos', 'empresa-chamar-freelas', 'empresa-presenca', 'empresa-mensagens', 'encarregado-menus'],
    freela: ['freela-pix', 'freela-meu-link', 'freela-convite', 'freela-chegada', 'freela-confirmar-recebimento'],
};
