/**
 * Filtro de vocabulário: de todo texto lido da PÁGINA, só saem palavras conhecidas da interface
 * (e as que a própria pessoa escreveu no pedido). Nome de gente, de empresa, endereço e texto de
 * terceiro viram "…". Falha para o lado fechado: palavra nova da interface some até entrar aqui.
 *
 * Não é barreira contra injeção sozinho (dá para atacar só com palavras comuns); a trava de ações
 * não depende deste filtro.
 */

const PALAVRAS = `
a o as os um uma uns umas de do da dos das em no na nos nas por pelo pela para pra com sem sob sobre
entre ate apos antes depois desde ou e mas se que quem qual quais quando onde como porque nao sim
mais menos muito pouco todo toda todos todas outro outra outros outras este esta estes estas esse
essa esses essas isso isto aquele aquela meu minha meus minhas seu sua seus suas voce voces ele ela
eles elas nosso nossa aqui ali la ja ainda so tambem agora hoje amanha ontem sempre nunca cada
algum alguma nenhum nenhuma vez vezes primeiro ultimo proximo proxima anterior novo nova novos novas
mesmo mesma proprio propria ter tem tinha ha ser sera sao foi esta estao estava ficar fica vai vao
pode podem deve devem precisa precisam quer querem falta faltam falte
abrir abra abriu aberto aberta abertos abertas fechar feche fechado fechada fechados ver veja visto
vista voltar volte avancar continuar salvar salve salvo enviar envie enviado enviada criar crie
criado criada editar edite alterar altere alteracao alteracoes mudar mude adicionar adicione incluir
escolher escolha selecionar selecione selecionado selecionados marcar marque marcado marcados
desmarcar buscar busque busca procurar procurando filtrar filtro filtros ordenar limpar atualizar
atualize atualizado carregar carregando copiar copie copiado compartilhar imprimir exportar baixar
publicar publique publicado rascunho repetir repetido duplicar reabrir pausar pausado pausada
cancelar cancele cancelado cancelada cancelados excluir exclua excluido excluida apagar remover
remova removido bloquear bloqueado desbloquear dispensar dispensado recusar recusa recusado recusada
rejeitar aceitar aceite aceito aceita confirmar confirme confirmado confirmada confirmacao registrar
registre registrado registrada registro agendar agendado agendada agendamento estornar estorno
estornado pagar pague pago paga pagamento pagamentos receber recebi recebido recebida recebimento
recebimentos contratar contratado contratada liberar encerrar encerrado encerrada revogar ativar
desativar sair entrar acessar acesso concluir concluir concluido concluida concluidos chamar chame
chamado chamados convidar convide convidado convidada convidados convite convites responder resposta
respostas respondeu respondeu aguardando aguarde pendente pendentes expirado expirada andamento
ajuda ajudar explicar mostrar mostre fazer faca feito pronto tentar tente novamente ok
inicio painel visao geral turno turnos vaga vagas trabalho trabalhos servico servicos diaria diarias
escala serie evento eventos empresa empresas equipe elenco freela freelas
freelancer freelancers trabalhador pessoa pessoas membro membros gestor gerente encarregado
responsavel cliente clientes operacao operacoes relatorio relatorios gestao indicacao indicacoes
indicar mensagem mensagens conversa conversas notificacao notificacoes aviso avisos perfil conta
dados configuracoes configuracao preferencias carteira recibo recibos termo termos privacidade
regulamento trilha bonus lista listas turma etiqueta etiquetas certificacao certificacoes
certificado treinamento treinamentos disponibilidade habilidade habilidades experiencia avaliacao
avaliacoes avaliar nota estrela estrelas comentario motivo observacao briefing requisitos requisito
descricao titulo funcao funcoes categoria tipo nome completo cidade estado endereco local
localizacao especifica foto capa logo imagem arquivo documento documentos
data datas dia dias semana semanas mes meses ano anos hora horas horario horarios minuto minutos
entrada saida inicio fim termino intervalo almoco jantar pausa chegada presenca check checkin
checkout periodo manha tarde noite madrugada segunda terca quarta quinta sexta sabado domingo seg
ter qua qui sex sab dom janeiro fevereiro marco abril maio junho julho agosto setembro outubro
novembro dezembro jan fev mar abr mai jun jul ago set out nov dez
valor valores total orcamento preco quantidade quantas quantos numero minimo maximo opcional
obrigatorio obrigatoria obrigatorios campo campos preencha preenchido vazio invalido valido erro
atencao sucesso falha falhou salvando enviando publicando conexao internet detalhes detalhe resumo
historico status situacao motivos modelo modelos padrao opcao opcoes mostrar ocultar expandir
recolher menu aba abas passo passos etapa etapas revisao revisar finalizar disponivel indisponivel
nenhum resultado resultados encontrado encontrada vazia sua suas
garcom garconete cozinheiro cozinheira cozinha auxiliar ajudante atendente atendimento balcao caixa
bartender barman bar copa copeiro chapeiro pizzaiolo confeiteiro padeiro recepcao recepcionista
seguranca limpeza faxina repositor estoque estoquista vendedor vendas promotor entregador motorista
montador producao salao delivery loja restaurante evento eventos buffet outros
id numero antiga oculto removido link nascimento
chave copiloto trocar sobre alterar abaixo
completa especifico orcamento exigida certificacao repetir cria varios mesmo horario
cozinheiro cozinha barman atendente loja recepcao limpeza copa estoque seguranca promotor
auxiliar eventos buffet garcom garconete pessoas precisa projeto fixo hora dia
bartender hostess cumim barista cafeteria frente reposicao portaria degustacao steward hospitality
reais real brl pix cpf cnpj telefone whatsapp email senha codigo sos urgente urgencia certeza
tem certeza desfazer desfeito irreversivel permanente definitivo fechar dispensa janela dialogo
publicacao selecione escolha digite informe ex exemplo clique toque aqui abaixo acima
`

function strip(word: string): string {
  return word.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
}

const VOCABULARIO: ReadonlySet<string> = new Set(PALAVRAS.split(/\s+/).filter(Boolean).map(strip))

const PALAVRA = /\p{L}+/gu

/**
 * Valor em dinheiro, data e horário não são texto de terceiro: passam inteiros (a redação de dados
 * pessoais já decidiu antes o que é dado pessoal). Sem isto "R$ 80,00" virava "….$ 80,00" e "08h30" "08…30".
 */
const PALAVRA_OU_PROTEGIDO = /R\$\s?\d[\d.,]*|\d{1,2}h(?:\d{2})?(?!\p{L})|\d[\d:/.-]*\d|\p{L}+/gu

/** Palavras que a própria pessoa escreveu (já redigidas): o modelo já as conhece. */
export function wordsOf(text: string): string[] {
  return (text.match(PALAVRA) ?? []).map(strip).filter((w) => w.length > 1)
}

export function filterToVocabulary(text: string, extra: ReadonlySet<string> = new Set()): string {
  return text
    .normalize('NFC')
    .replace(PALAVRA_OU_PROTEGIDO, (word) => {
      if (/^(?:R\$|\d)/.test(word)) return word
      const key = strip(word)
      return VOCABULARIO.has(key) || extra.has(key) ? word : '…'
    })
    .replace(/…(?:[\s'’.-]*…)+/g, '…')
}

export { strip as stripAccents }
