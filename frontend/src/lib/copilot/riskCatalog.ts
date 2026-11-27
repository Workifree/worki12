/**
 * Âncoras `data-copilot` que são categoria D mesmo que a tela esqueça `data-copilot-risk="D"`.
 * Defesa extra e independente: não depende do catálogo do guia (lib/guide), que é de outra frente.
 * Fonte: âncoras existentes no código em 25/11/2026 + mapa-de-intencoes.md.
 */
const ALVOS_D: ReadonlySet<string> = new Set([
  'publico.termos.aceitar',
  'publico.redefinir-senha.salvar',
  'publico.redefinir-senha.pedir-novo-link',
  'publico.recuperar-senha.enviar-link',
  'publico.login.criar-conta',
  'publico.login.entrar',
  'publico.convite-equipe.entrar',
  'publico.convite-equipe.confirmar-codigo',
  'publico.convite-equipe.aceitar',
  'publico.convite-elenco.aceitar',
  'freela.turno.registrar-chegada',
  'freela.turno.registrar-saida',
  'freela.turnos.cancelar',
  'freela.convite.aceitar',
  'freela.convite.recusar',
  'freela.convite-destaque.aceitar',
  'freela.convite-destaque.recusar',
  'freela.recibo.confirmar',
  'freela.recibo.nao-recebi',
  'freela.recebimentos.confirmar',
  'freela.inicio.confirmar-recebimento',
  'freela.inicio.cadastrar-pix',
  'freela.perfil.cadastrar-pix',
  'freela.perfil.cadastrar-cpf',
  'freela.perfil.sos',
  'freela.perfil.selos',
  'freela.perfil.indicacoes',
  'empresa.presenca.registrar-chegada',
  'empresa.presenca.registrar-saida',
  'empresa.presenca.registrar-pagamento',
  'empresa.presenca.agendar-pagamento',
  'empresa.presenca.marcar-pago',
  'empresa.presenca.estornar',
  'empresa.presenca.dispensar',
  'empresa.presenca.cancelar-convite',
  'empresa.presenca.sos',
  'empresa.inicio.registrar-chegada',
  'empresa.inicio.registrar-saida',
  'empresa.turno.excluir-confirmar',
  'empresa.turno.cancelar-confirmar',
  'empresa.turnos.excluir-confirmar',
  'empresa.serie.encerrar-confirmar',
  'empresa.passar-turnos.confirmar',
  'empresa.hoje.cobrir',
  'empresa.unidades.convidar-gerente',
])

export const alvoEhRiscoD = (alvo: string): boolean => ALVOS_D.has(alvo)

/**
 * Âncoras que só mudam o que aparece (abrem um passo, montam um rascunho local, mostram o calendário).
 * Não gravam nem avisam ninguém: passam sem cartão. Nada aqui pode publicar, chamar ou convidar.
 */
const ALVOS_SEM_EFEITO: ReadonlySet<string> = new Set([
  'empresa.turno-lote.do-zero',
  'empresa.turno-lote.usar-modelo',
  'empresa.turno-lote.abrir-historico',
  'empresa.modelos.usar',
  'empresa.modelos.novo',
  'empresa.turno-lote.repetir-recente',
  'empresa.turno-lote.continuar-rascunho',
  'empresa.turno-lote.ler-texto',
  'empresa.turno-lote.calendario',
  'empresa.turno-lote.varias-datas',
  'empresa.turno-lote.revisar',
  // "Quem vai trabalhar": só monta o rascunho. O envio dos chamados acontece em Publicar (com cartão).
  'empresa.turno-lote.quem-trabalha',
  'empresa.turno-lote.chamar-pessoas',
  'empresa.turno-lote.lista',
  'empresa.turno-lote.pessoa',
  'empresa.turno-lote.pessoas-salvar',
  'empresa.turno-lote.pessoas-voltar',
])

export const alvoSemEfeito = (alvo: string): boolean => ALVOS_SEM_EFEITO.has(alvo)
