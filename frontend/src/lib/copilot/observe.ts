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
import { pathPolicy, routePattern, screenName } from './routes'
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
const MAX_LABEL = 70

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

export function cleanLabel(raw: string, allowed: ReadonlySet<string> = new Set()): string {
  const text = filterToVocabulary(redactPII(raw.replace(/\s+/g, ' ').trim()), allowed).replace(/[<>[\]]/g, (c) =>
    // Colchetes só sobrevivem nos marcadores da redação; texto da página não forja "[3]<button>".
    c === '<' || c === '>' ? ' ' : c,
  )
  const noFakeIndex = text.replace(/\[(\d+)\]/g, '($1)')
  return noFakeIndex.length > MAX_LABEL ? `${noFakeIndex.slice(0, MAX_LABEL)}…` : noFakeIndex
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
  } else if (el.getAttribute('aria-checked')) {
    parts.push(el.getAttribute('aria-checked') === 'true' ? 'marcado' : 'desmarcado')
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
      if (element.getAttribute('type') !== 'hidden' && elements.size < MAX_ELEMENTS) {
        const label = cleanLabel(accessibleName(element), allowed) || '(sem rótulo)'
        const fillable = isTextEntry(element) || element.tagName === 'SELECT'
        const fill = fillable ? classifyFill(element, pathname) : null
        const level = fill ? (fill.ok ? 'safe' : fill.verdict.level) : classifyClick(element, pathname).level
        if (level !== 'blocked') {
          const anchor = element.getAttribute('data-copilot')
          const id = anchor && ANCHOR_ID.test(anchor) ? ` id=${anchor}` : ''
          const tag = element.tagName.toLowerCase()
          const type = element.getAttribute('type') ?? element.getAttribute('role')
          const typeText = type && /^[a-z-]{1,20}$/.test(type) ? ` tipo=${type}` : ''
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
    Array.from(el.children).forEach(walk)
  }

  if (modal) {
    push(`JANELA ABERTA: ${cleanLabel(headingOf(modal), allowed)} (o resto da tela está bloqueado)`)
    Array.from(modal.children).forEach(walk)
  } else {
    Array.from(doc.body.children).forEach(walk)
  }
  if (size > MAX_CHARS) lines.push('(lista cortada: há mais itens na tela)')

  // Última passada sobre o texto montado.
  return { content: redactPII(lines.join('\n')) || '(nada acionável nesta tela)', elements, pattern, screen }
}
