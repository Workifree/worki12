/**
 * Leitura da tela para o modelo. SUBSTITUI a serialização do page-agent, que:
 *  - envia o atributo `value` (o React espelha nele o que foi digitado, inclusive senha);
 *  - corta atributos em 20 caracteres, deixando e-mail e PIX truncados escaparem de regex;
 *  - envia todo o texto da página, título e URL completa.
 *
 * Aqui é lista de permissão: só sai o que este arquivo escreve. Controles, rótulos, títulos de
 * seção e avisos; nunca texto corrido, nunca valor que o modelo já não conheça.
 */
import { HELP_UI_SELECTOR, accessibleName, headingOf, isDisplayed, safeText, topModal } from './dom'
import { classifyClick, classifyFill, isSensitiveField, isTextEntry } from './risk'
import { redactPII } from './redact'
import { NAV_DESTINATIONS, pathPolicy, routePattern, screenName } from './routes'
import { filterToVocabulary } from './vocabulary'

export interface ObservedElement {
  element: HTMLElement
  /** Impressão digital do que foi mostrado ao modelo: se mudar, a ação é recusada. */
  fingerprint: string
  /** Descrição sem dado pessoal, para o modelo e para o registro local. */
  safeLabel: string
}

export interface Observation {
  content: string
  elements: Map<number, ObservedElement>
  pattern: string
  screen: string
}

export interface ObserveOptions {
  /** Palavras que a pessoa escreveu: liberadas no filtro de vocabulário. */
  allowedWords?: ReadonlySet<string>
  /** O que o próprio copiloto digitou: o modelo já conhece, então pode ver de volta. */
  typed?: WeakMap<Element, string>
}

const MAX_ELEMENTS = 140
const MAX_CHARS = 14_000
// 70 cortava o valor no fim do rótulo ("R$ 80,0…"); o filtro de dados roda antes do corte.
const MAX_LABEL = 120

const INTERACTIVE =
  'a[href],button,input,select,textarea,summary,[role="button"],[role="tab"],[role="link"],[role="menuitem"],' +
  '[role="checkbox"],[role="radio"],[role="switch"],[role="option"],[role="combobox"],[contenteditable="true"]'

const SKIP =
  `${HELP_UI_SELECTOR},[data-copilot-private],[data-page-agent-ignore="true"],#playwright-highlight-container,` +
  'script,style,noscript,template,svg,canvas,iframe,video,audio,object,embed'

const STATIC_TEXT = 'h1,h2,h3,legend,[role="alert"],[role="status"],[data-copilot-text]'

const ANCHOR_ID = /^(?:empresa|freela|publico)\.[a-z0-9-]+\.[a-z0-9-]+$/

const RISK_LABEL = {
  safe: '',
  confirm: ' risco=pede-confirmacao',
  forbidden: ' risco=SOMENTE-A-PESSOA',
  blocked: ' risco=bloqueado',
} as const

export function fingerprintOf(el: Element): string {
  return [el.tagName, el.getAttribute('type'), el.getAttribute('role'), el.getAttribute('data-copilot'), el.getAttribute('href'), accessibleName(el)]
    .map((part) => part ?? '')
    .join('\u0001')
}

/** Valor em dinheiro, data e horário: nunca podem ser cortados no meio nem somem por pouco. */
const VALOR_INTEIRO = /R\$\s?\d[\d.,]*|\d{1,2}h(?:\d{2})?|\d{1,2}:\d{2}|\d{1,4}[/.-]\d{1,2}(?:[/.-]\d{2,4})?/g
/** Quanto o corte pode passar do limite para não deixar um valor pela metade ou de fora. */
const FOLGA_DO_CORTE = 40

/** Corta em `limit`, mas empurra o corte até o fim de um valor monetário, data ou horário. */
export function cutLabel(text: string, limit = MAX_LABEL): string {
  if (text.length <= limit) return text
  let cut = limit
  for (const match of text.matchAll(VALOR_INTEIRO)) {
    const start = match.index ?? 0
    const end = start + match[0].length
    // O valor cruza o limite, ou começa logo depois dele: leva-o inteiro.
    if (end > cut && start < cut + FOLGA_DO_CORTE) cut = Math.max(cut, end)
  }
  if (cut >= text.length) return text
  // Termina em fim de palavra (sem partir "Confirm…").
  const space = text.lastIndexOf(' ', cut)
  const atWord = text[cut] === ' ' || text[cut] === undefined ? cut : space > cut - 24 ? space : cut
  return `${text.slice(0, atWord).trimEnd()}…`
}

/** Marcadores que a redação escreve (`[cpf]`...): os únicos colchetes que podem ficar num rótulo. */
const MARCADOR_DE_REDACAO = /\[(?:cpf|cnpj|telefone|email|senha|codigo|token|pix|id|numero|nascimento|data-antiga|oculto)\]/gi

export function cleanLabel(raw: string, allowed: ReadonlySet<string> = new Set()): string {
  const filtered = filterToVocabulary(redactPII(raw.replace(/\s+/g, ' ').trim()), allowed)
  // Colchetes só sobrevivem nos marcadores da redação; texto da página não forja "[3]<button>" nem "[ ]".
  // (A redação já removeu qualquer caractere de uso privado: servem de reserva para os marcadores.)
  const kept: string[] = []
  const text = filtered
    .replace(MARCADOR_DE_REDACAO, (marker) => `${kept.push(marker) - 1}`)
    .replace(/[<>]/g, ' ')
    .replace(/[[\]]/g, (c) => (c === '[' ? '(' : ')'))
    .replace(/(\d+)/g, (_, i: string) => kept[Number(i)])
  return cutLabel(text)
}

function describeState(el: HTMLElement, options: ObserveOptions, allowed: ReadonlySet<string>): string {
  const parts: string[] = []
  const field = el as HTMLInputElement
  if (field.disabled || el.getAttribute('aria-disabled') === 'true') parts.push('desativado')
  if (field.required || el.getAttribute('aria-required') === 'true') parts.push('obrigatorio')
  if (el.getAttribute('aria-invalid') === 'true') parts.push('com-erro')
  if (el.getAttribute('aria-expanded')) parts.push(el.getAttribute('aria-expanded') === 'true' ? 'aberto' : 'fechado')
  if (el.getAttribute('aria-selected') === 'true') parts.push('selecionado')
  const type = (el.getAttribute('type') ?? '').toLowerCase()
  if (el.tagName === 'INPUT' && (type === 'checkbox' || type === 'radio')) {
    parts.push(field.checked ? 'marcado' : 'desmarcado')
  } else if (el.getAttribute('aria-checked') || el.getAttribute('aria-pressed')) {
    // Botão de liga/desliga: sem o estado, o modelo "marca" o que já está marcado e desmarca.
    parts.push((el.getAttribute('aria-checked') ?? el.getAttribute('aria-pressed')) === 'true' ? 'marcado' : 'desmarcado')
  }
  if (isSensitiveField(el) && (isTextEntry(el) || el.tagName === 'INPUT')) {
    // Nem preenchido/vazio: nada do campo sensível sai.
    parts.push('campo-sensivel-so-a-pessoa')
    return parts.length ? ` ${parts.join(' ')}` : ''
  }
  if (el.tagName === 'SELECT') {
    const select = el as unknown as HTMLSelectElement
    const options_ = Array.from(select.options, (o) => cleanLabel(o.textContent ?? '', allowed)).slice(0, 30)
    const current = select.selectedOptions[0]?.textContent ?? ''
    parts.push(`valor="${cleanLabel(current, allowed)}" opcoes="${options_.join(' | ')}"`)
  } else if (isTextEntry(el)) {
    const value = field.value
    if (!value) parts.push('vazio')
    else if (options.typed?.get(el) === value) parts.push(`valor="${redactPII(value).slice(0, MAX_LABEL)}"`)
    else if (['date', 'time', 'number'].includes(type)) parts.push(`valor="${redactPII(value).slice(0, 20)}"`)
    else parts.push('preenchido')
  }
  return parts.length ? ` ${parts.join(' ')}` : ''
}

/** Atalhos de menu que a ferramenta `navigate` já cobre: lê-los a cada passo só gasta leitura. */
const MENU_FIXO = 'nav[aria-label="Navegação principal"],nav[data-bottom-nav]'
const CAMINHOS_DE_NAVEGACAO = new Set<string>(
  [...Object.values(NAV_DESTINATIONS.company), ...Object.values(NAV_DESTINATIONS.worker)].map(String),
)
/** Listas longas: só as primeiras entram na leitura (o resto vira uma linha de aviso). */
const MAX_ITENS_DE_LISTA = 20

function isMenuShortcut(el: Element): boolean {
  if (el.tagName !== 'A' || !el.closest(MENU_FIXO)) return false
  try {
    return CAMINHOS_DE_NAVEGACAO.has(new URL(el.getAttribute('href') ?? '', window.location.origin).pathname)
  } catch {
    return false
  }
}

/** Link de "pular para o conteúdo": só serve ao teclado. */
function isSkipLink(el: Element): boolean {
  return el.tagName === 'A' && (el.getAttribute('href') ?? '').startsWith('#')
}

/** Nome do contêiner clicável SEM repetir o texto dos controles que ele traz dentro (já têm linha própria). */
function ownName(el: HTMLElement): string {
  const full = accessibleName(el)
  if (el.getAttribute('aria-label') || !el.querySelector(INTERACTIVE)) return full
  const copy = el.cloneNode(true) as HTMLElement
  copy.querySelectorAll(INTERACTIVE).forEach((inner) => inner.remove())
  return accessibleName(copy) || full
}

export function observePage(options: ObserveOptions = {}, doc: Document = document): Observation {
  const pathname = window.location.pathname
  const pattern = routePattern(pathname)
  const screen = screenName(pathname)
  const elements = new Map<number, ObservedElement>()
  if (pathPolicy(pathname) === 'blocked') {
    return { content: '(tela fora do alcance do copiloto)', elements, pattern, screen }
  }
  const allowed = options.allowedWords ?? new Set<string>()
  const lines: string[] = []
  const modal = topModal(doc)
  let size = 0
  let index = 0
  let omittedMenu = 0

  const push = (line: string) => {
    if (size > MAX_CHARS) return false
    size += line.length
    lines.push(line)
    return true
  }

  const walk = (el: Element) => {
    if (el.matches(SKIP) || !isDisplayed(el)) return
    const sensitiveBlock = el.getAttribute('data-copilot-risk') === 'D' && !el.matches(INTERACTIVE)
    if (el.matches(INTERACTIVE) || (el.hasAttribute('data-copilot') && !el.querySelector(INTERACTIVE))) {
      const element = el as HTMLElement
      if (isMenuShortcut(element) || isSkipLink(element)) {
        omittedMenu += 1
      } else if (element.getAttribute('type') !== 'hidden' && elements.size < MAX_ELEMENTS) {
        const label = cleanLabel(ownName(element), allowed) || '(sem rótulo)'
        const fillable = isTextEntry(element) || element.tagName === 'SELECT'
        const fill = fillable ? classifyFill(element, pathname) : null
        const level = fill ? (fill.ok ? 'safe' : fill.verdict.level) : classifyClick(element, pathname).level
        if (level !== 'blocked') {
          const anchor = element.getAttribute('data-copilot')
          const id = anchor && ANCHOR_ID.test(anchor) ? ` id=${anchor}` : ''
          const tag = element.tagName.toLowerCase()
          const type = element.getAttribute('type') ?? element.getAttribute('role')
          // `button type=button` é o óbvio: só diz o que foge do padrão.
          const typeText = type && /^[a-z-]{1,20}$/.test(type) && !(tag === 'button' && type === 'button') ? ` tipo=${type}` : ''
          const current = index++
          if (push(`[${current}]<${tag}${typeText}${id}${RISK_LABEL[level]}${describeState(element, options, allowed)}> ${label} />`)) {
            elements.set(current, { element, fingerprint: fingerprintOf(element), safeLabel: label })
          }
        }
      }
      // Controles aninhados (cartão-link com botão dentro) também entram.
      if (el.querySelector(INTERACTIVE)) Array.from(el.children).forEach(walk)
      return
    }
    if (el.matches(STATIC_TEXT)) {
      const text = cleanLabel(safeText(el), allowed)
      if (text && text !== '…') push(`${el.tagName.toLowerCase()}: ${text}`)
      Array.from(el.querySelectorAll(INTERACTIVE)).forEach(walk)
      return
    }
    if (sensitiveBlock) push('(bloco com ação reservada para a pessoa)')
    const children = Array.from(el.children)
    if ((el.tagName === 'UL' || el.tagName === 'OL' || el.getAttribute('role') === 'list') && children.length > MAX_ITENS_DE_LISTA) {
      children.slice(0, MAX_ITENS_DE_LISTA).forEach(walk)
      push(`(lista com mais ${children.length - MAX_ITENS_DE_LISTA} itens parecidos, omitidos; peça à pessoa um filtro ou a busca)`)
      return
    }
    children.forEach(walk)
  }

  if (modal) {
    push(`JANELA ABERTA: ${cleanLabel(headingOf(modal), allowed)} (o resto da tela está bloqueado)`)
    Array.from(modal.children).forEach(walk)
  } else {
    Array.from(doc.body.children).forEach(walk)
  }
  if (size > MAX_CHARS) lines.push('(lista cortada: há mais itens na tela)')
  if (omittedMenu > 0) lines.unshift('(atalhos do menu omitidos: para trocar de tela use a ferramenta navigate)')

  // Última passada sobre o texto montado.
  return { content: redactPII(lines.join('\n')) || '(nada acionável nesta tela)', elements, pattern, screen }
}
