/**
 * Classificação de risco decidida pelo CÓDIGO, sobre o elemento real e seus ancestrais.
 * O modelo não opina: o que ele disser sobre um alvo é ignorado.
 *
 *  safe      -> navegação e interface pura (link permitido, aba, abrir menu, focar campo) e escolha de
 *               valor em campo de formulário (opção, data, lista): nada disso grava nem avisa ninguém
 *  confirm   -> o que grava, envia, publica, chama ou convida (classe C) e o DESCONHECIDO: cartão
 *  forbidden -> categoria D: a IA nunca aciona; só destaca para a pessoa tocar
 *  blocked   -> nem destaca (interface do copiloto, área privada, link externo ou proibido)
 */
import { alvoEhRiscoD, alvoSemEfeito } from './riskCatalog'
import { accessibleName, allNames, fold, headingOf, isCopilotUi, isPrivate, safeText } from './dom'
import { judgeUrl, pathPolicy } from './routes'

export type RiskLevel = 'safe' | 'confirm' | 'forbidden' | 'blocked'

export interface Verdict {
  level: RiskLevel
  reason: string
}

const v = (level: RiskLevel, reason: string): Verdict => ({ level, reason })

/** Categoria D por texto (sem acento, minúsculo). */
const TEXTO_D = new RegExp(
  '\\b(?:' +
    [
      // dinheiro
      'pagar', 'pague', 'pagamentos?', 'paguei', 'pago', 'estornar?', 'estorno', 'sacar', 'saque', 'depositar',
      'deposito', 'transferir', 'liberar', 'confirmar entrega',
      // apagar e desfazer vínculo
      'excluir', 'exclua', 'apagar', 'deletar', 'cancelar', 'cancele', 'remover', 'remova', 'bloquear',
      'desbloquear', 'dispensar', 'recusar', 'recusa', 'rejeitar', 'revogar', 'encerrar', 'desativar', 'ativar',
      // consentimento e decisões da pessoa
      'aceitar', 'aceito', 'aceite', 'concordo', 'concordar', 'consinto', 'termos?', 'assinar', 'confirmar',
      'confirmo', 'contratar', 'promover',
      // presença é prova
      'check ?-?in', 'check ?-?out', 'registrar chegada', 'registrar saida', 'sim,? vou', 'nao vou poder',
      'recebi', 'nao recebi', 'marcar como pago',
      // dados sensíveis, acesso e conta
      'senha', 'cpf', 'pix', 'codigo de verificacao', 'convidar (?:encarregado|gerente|pessoa para a equipe)',
      'gerar novo link', 'passar (?:turnos?|para)', 'cobrir', 'sair', 'logout', 'sos',
      'aparecer no', 'receber indicacoes', 'aceitar indicacoes',
    ].join('|') +
    ')\\b',
)

/** Em link de navegação só o VERBO de ação pesa ("Presença e pagamento" é só um destino). */
const VERBO_EM_LINK =
  /\b(?:pagar|estornar|excluir|apagar|deletar|cancelar|remover|bloquear|dispensar|recusar|aceitar|confirmar|contratar|encerrar|revogar|sair|sacar)\b/

const DISPENSA = /^(?:fechar|voltar|agora nao|nao|nao,? voltar|x)$/

/** Botão `type="button"` que só muda o que aparece (passo, mês, mais itens). Nome inteiro, sem verbo de efeito. */
const SO_MOSTRA = /^(?:proximo|anterior|proximo mes|mes anterior|ver mais|mostrar mais|ver menos|mostrar menos|ver detalhes|expandir|recolher|ver todos|ver todas)$/

/** Nomes que mudam dado ou avisam alguém: nunca contam como "escolha de valor". */
const VERBO_C =
  /\b(?:salvar|enviar|publicar|chamar|convidar|criar|adicionar|gravar|registrar|disparar|avisar|notificar|mandar|duplicar|repetir|aplicar|atualizar|alterar|editar|trocar|indicar|apresentar|marcar todos)\b/

/** Contêineres onde controles de escolha são partes de um formulário (mesmo sem `<form>`). */
const GRUPO_DE_ESCOLHA = 'form,fieldset,[role="group"],[role="radiogroup"],[role="listbox"],[role="tablist"]'

/** Controle cujo toque só escolhe um valor (opção, data, chip), sem enviar nada. */
function isChoiceControl(el: Element): boolean {
  const role = el.getAttribute('role') ?? ''
  if (['radio', 'option', 'menuitemradio', 'menuitemcheckbox', 'checkbox', 'switch'].includes(role)) return true
  if (el.tagName === 'INPUT') return ['checkbox', 'radio'].includes((el.getAttribute('type') ?? '').toLowerCase())
  if (el.tagName === 'BUTTON' && (el.getAttribute('type') ?? 'submit').toLowerCase() === 'button') {
    return el.hasAttribute('aria-pressed') || el.hasAttribute('aria-checked') || el.hasAttribute('aria-selected')
  }
  return false
}

/** Lista fora de `<form>` que faz parte de um conjunto de campos (há outro campo no mesmo bloco, e ela tem rótulo). */
export function selectIsFormField(select: Element): boolean {
  if (select.closest('form')) return true
  const labelled = ((select as HTMLSelectElement).labels?.length ?? 0) > 0 || !!select.getAttribute('aria-label')
  if (!labelled) return false
  const block = select.closest('fieldset,[role="group"],section,dialog,[role="dialog"]')
  if (!block) return false
  return Array.from(block.querySelectorAll('input,select,textarea')).some(
    (field) => field !== select && (field.tagName !== 'INPUT' || isTextEntry(field)),
  )
}

const SENSIVEL = new RegExp(
  '(?:senha|password|passcode|\\bcpf\\b|\\bcnpj\\b|\\bpix\\b|\\botp\\b|\\bcodigo\\b|\\btoken\\b|telefone|celular|' +
    'whats ?app|e-?mail|nascimento|chave|cartao|\\bcvv\\b|\\brg\\b|documento|conta bancaria|agencia)',
)

const TIPOS_SENSIVEIS = new Set(['password', 'tel', 'email', 'hidden', 'file'])
const AUTOCOMPLETE_SENSIVEL = /one-time-code|password|^cc-|bday|tel|email/

/** Campo cujo valor nunca é lido nem escrito pela IA. */
export function isSensitiveField(el: Element): boolean {
  if (el.closest('[data-copilot-private],[data-copilot-risk="D"]')) return true
  if (el.tagName === 'INPUT' && TIPOS_SENSIVEIS.has((el.getAttribute('type') ?? 'text').toLowerCase())) return true
  if (AUTOCOMPLETE_SENSIVEL.test(el.getAttribute('autocomplete') ?? '')) return true
  const maxLength = Number(el.getAttribute('maxlength') ?? 0)
  if (el.getAttribute('inputmode') === 'numeric' && maxLength > 0 && maxLength <= 8) return true
  const labels = Array.from((el as HTMLInputElement).labels ?? [], (label) => safeText(label))
  const descritores = [
    el.getAttribute('name'),
    el.id,
    el.getAttribute('placeholder'),
    el.getAttribute('aria-label'),
    el.getAttribute('data-copilot'),
    accessibleName(el),
    ...labels,
  ]
  return descritores.some((text) => !!text && SENSIVEL.test(fold(text)))
}

function chainOf(el: Element): Element[] {
  const chain: Element[] = []
  for (let current: Element | null = el; current && current !== el.ownerDocument.body; current = current.parentElement) {
    chain.push(current)
  }
  return chain
}

const ACIONAVEL =
  'a[href],button,input,select,textarea,summary,label,[role="button"],[role="link"],[role="menuitem"],' +
  '[role="tab"],[role="checkbox"],[role="radio"],[role="switch"],[role="option"],[data-copilot]'

function idIsD(id: string | null): boolean {
  if (!id) return false
  return (
    alvoEhRiscoD(id) ||
    /\.(?:aceitar|recusar|estornar|dispensar|registrar-pagamento|agendar-pagamento|marcar-pago|registrar-chegada|registrar-saida|cancelar(?:-[a-z]+)?|excluir(?:-[a-z]+)?|cadastrar-(?:pix|cpf)|salvar-senha|sos|selos|indicacoes-consentimento)$/.test(
      id,
    ) ||
    /-(?:confirmar)$/.test(id)
  )
}

function textIsD(el: Element): boolean {
  return allNames(el).some((name) => !DISPENSA.test(name) && TEXTO_D.test(name))
}

function isSubmitControl(el: Element): boolean {
  if (el.tagName === 'BUTTON') return (el.getAttribute('type') ?? 'submit').toLowerCase() === 'submit' && !!el.closest('form')
  if (el.tagName === 'INPUT') return ['submit', 'image'].includes((el.getAttribute('type') ?? '').toLowerCase())
  return false
}

export function submitsForm(el: Element): boolean {
  return chainOf(el).some(isSubmitControl)
}

/** Formulário em que gravar é D: marcado, com credencial, ou cujo envio é D. */
function formIsD(form: Element): boolean {
  if (form.getAttribute('data-copilot-risk') === 'D') return true
  if (form.querySelector('input[type="password"],[autocomplete="one-time-code"]')) return true
  return Array.from(form.querySelectorAll('button,input[type="submit"]'))
    .filter(isSubmitControl)
    .some((submit) => submit.getAttribute('data-copilot-risk') === 'D' || textIsD(submit))
}

/** Dentro de um diálogo cujo título é D (ex.: "Excluir turno" -> botão "Sim"). */
function dialogIsD(el: Element): boolean {
  const dialog = el.closest('dialog,[role="dialog"],[role="alertdialog"]')
  if (!dialog) return false
  return dialog.getAttribute('data-copilot-risk') === 'D' || TEXTO_D.test(fold(headingOf(dialog)))
}

/** Veto absoluto sobre um elemento e tudo que o clique atravessa. Também usado pela guarda de eventos. */
export function hardVerdict(el: Element, pathname: string = window.location.pathname): Verdict | null {
  const chain = chainOf(el)
  if (isCopilotUi(el)) return v('blocked', 'É a interface do próprio copiloto.')
  if (pathPolicy(pathname) === 'blocked') return v('blocked', 'Esta tela está fora do alcance do copiloto.')
  if (isPrivate(el)) return v('blocked', 'Área com dados pessoais.')
  if (chain.some((node) => node.getAttribute('data-copilot-risk') === 'D')) {
    return v('forbidden', 'Marcado como ação que só a pessoa faz.')
  }
  if (chain.some((node) => idIsD(node.getAttribute('data-copilot')))) {
    return v('forbidden', 'Ação reservada para a pessoa.')
  }
  const acionaveis = chain.filter((node) => node === el || node.matches(ACIONAVEL))
  for (const node of acionaveis) {
    // Link de navegação com nome sensível não é D (abrir "Pagamentos" não paga nada).
    if (node.tagName === 'A' && node.getAttribute('href')) continue
    if (['INPUT', 'SELECT', 'TEXTAREA'].includes(node.tagName) && !isSubmitControl(node)) {
      const type = (node.getAttribute('type') ?? '').toLowerCase()
      if (!['checkbox', 'radio', 'button'].includes(type)) continue
    }
    if (node.getAttribute('role') === 'tab') continue
    if (textIsD(node)) return v('forbidden', 'Mexe com dinheiro, vínculo, consentimento, acesso ou dado sensível.')
  }
  // Um label aciona o campo ligado a ele.
  const label = chain.find((node) => node.tagName === 'LABEL') as HTMLLabelElement | undefined
  if (label?.control && label.control !== el && !label.control.contains(el)) {
    const control = hardVerdict(label.control, pathname)
    if (control) return control
  }
  return null
}

/** Qualquer descendente MARCADO como D, em qualquer tipo de elemento. */
function hasMarkedDescendant(el: Element): boolean {
  if (el.querySelector('[data-copilot-risk="D"]')) return true
  return Array.from(el.querySelectorAll('[data-copilot]')).some((node) => idIsD(node.getAttribute('data-copilot')))
}

/** Em contêiner que não é controle nativo, o texto de um filho acionável também conta. */
function descendantTextIsD(el: Element): boolean {
  return Array.from(el.querySelectorAll(ACIONAVEL)).some(
    (node) => !['INPUT', 'SELECT', 'TEXTAREA', 'A'].includes(node.tagName) && textIsD(node),
  )
}

const CAMPO_DE_TEXTO = new Set(['text', 'search', 'number', 'date', 'time', 'datetime-local', 'month', 'week', ''])

export function isTextEntry(el: Element): boolean {
  if (el.tagName === 'TEXTAREA') return true
  return el.tagName === 'INPUT' && CAMPO_DE_TEXTO.has((el.getAttribute('type') ?? '').toLowerCase())
}

export function classifyClick(el: Element, pathname: string = window.location.pathname): Verdict {
  const hard = hardVerdict(el, pathname)
  if (hard) return hard

  const anchor = el.closest('a[href]')
  const nested = el.querySelector('a[href]')
  const link = anchor ?? nested
  if (link) {
    const verdict = judgeUrl(link.getAttribute('href') ?? '')
    if (verdict === 'blocked') return v('blocked', 'Link externo ou para tela que o copiloto não abre.')
  }

  // O clique cai no filho que está no centro: um contêiner com ação D dentro é tratado como D.
  if (hasMarkedDescendant(el) || (!el.matches('a[href],button,input,select,textarea') && descendantTextIsD(el))) {
    return v('forbidden', 'Há uma ação reservada dentro deste bloco.')
  }

  const form = el.closest('form')
  const isSubmit = submitsForm(el)
  if (isSubmit && form && formIsD(form)) return v('forbidden', 'Este envio só a pessoa pode fazer.')

  const name = fold(accessibleName(el))
  if (dialogIsD(el) && !DISPENSA.test(name)) return v('forbidden', 'Esta janela trata de uma ação que só a pessoa faz.')
  const isField = el.tagName === 'TEXTAREA' || el.tagName === 'SELECT' || (el.tagName === 'INPUT' && !isSubmit)
  if (isField && isSensitiveField(el)) return v('forbidden', 'Campo com dado sensível: só a pessoa mexe.')
  if (isTextEntry(el) || el.tagName === 'SELECT') return v('safe', 'Só foca o campo.')
  if (pathPolicy(pathname) === 'readonly') {
    if (anchor && judgeUrl(anchor.getAttribute('href') ?? '') === 'safe') return v('safe', 'Navegação.')
    if (el.getAttribute('role') === 'tab') return v('safe', 'Troca de aba.')
    return v('forbidden', 'Nesta tela o copiloto só explica e mostra.')
  }
  if (el.getAttribute('data-copilot-risk') === 'A') return v('safe', 'Marcado como sem efeito.')
  if (isSubmit) return v('confirm', 'Envia o formulário.')
  if (anchor && anchor === el.closest(ACIONAVEL)) {
    if (anchor.hasAttribute('download')) return v('confirm', 'Baixa um arquivo.')
    if (judgeUrl(anchor.getAttribute('href') ?? '') !== 'safe') return v('confirm', 'Abrir esta tela tem efeito.')
    if (allNames(anchor).some((n) => VERBO_EM_LINK.test(n))) return v('confirm', 'Link com nome de ação sensível.')
    return v('safe', 'Navegação.')
  }
  if (el.getAttribute('role') === 'tab' || el.tagName === 'SUMMARY') return v('safe', 'Só muda o que aparece.')
  const acionavel = el.closest(ACIONAVEL) ?? el
  if (alvoSemEfeito(acionavel.getAttribute('data-copilot') ?? '')) return v('safe', 'Só abre um passo.')
  const nomes = allNames(acionavel)
  const temVerboC = nomes.some((n) => VERBO_C.test(n))
  if (isChoiceControl(acionavel) && acionavel.closest(GRUPO_DE_ESCOLHA) && !temVerboC) {
    return v('safe', 'Só escolhe um valor do formulário.')
  }
  if (acionavel.tagName === 'BUTTON' && acionavel.getAttribute('type') === 'button') {
    if (acionavel.hasAttribute('aria-haspopup') || acionavel.hasAttribute('aria-expanded')) return v('safe', 'Abre ou fecha um menu.')
    if (DISPENSA.test(name)) return v('safe', 'Fecha ou volta.')
    if (!temVerboC && nomes.some((n) => SO_MOSTRA.test(n))) return v('safe', 'Só muda o que aparece.')
  }
  if (temVerboC) return v('confirm', 'Grava, envia ou avisa alguém.')
  return v('confirm', 'Não sei o que este toque faz: confirme antes.')
}

export type FillVerdict = { ok: true } | { ok: false; verdict: Verdict }

/** Pode a IA escrever neste campo? */
export function classifyFill(el: Element, pathname: string = window.location.pathname): FillVerdict {
  const no = (level: RiskLevel, reason: string): FillVerdict => ({ ok: false, verdict: v(level, reason) })
  if (isCopilotUi(el) || isPrivate(el)) return no('blocked', 'Campo fora do alcance.')
  if (pathPolicy(pathname) !== 'normal') return no('forbidden', 'Nesta tela o copiloto não preenche nada.')
  if (isSensitiveField(el)) {
    return no('forbidden', 'Senha, código, CPF, PIX, telefone, e-mail e nascimento são só da pessoa.')
  }
  const field = el as HTMLInputElement
  if (field.disabled || field.readOnly) return no('blocked', 'Campo desativado.')
  if (!isTextEntry(el) && el.tagName !== 'SELECT') return no('blocked', 'Não é um campo que o copiloto preenche.')
  const form = el.closest('form')
  if (form && formIsD(form)) return no('forbidden', 'Este formulário é só da pessoa.')
  if (dialogIsD(el)) return no('forbidden', 'Esta janela é de uma ação que só a pessoa faz.')
  return { ok: true }
}
