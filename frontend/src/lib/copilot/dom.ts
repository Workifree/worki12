/** Utilidades de DOM do copiloto. Nada aqui lê `value` de campo sensível. */
import { stripAccents } from './vocabulary'

/** Raiz da interface do próprio copiloto: nunca lida, nunca acionada pela IA. */
export const UI_ATTR = 'data-copilot-ui'

/** Interfaces de ajuda (a do copiloto e a do guia, lib/guide): idem. */
export const HELP_UI_SELECTOR = `[${UI_ATTR}],[data-guide]`

export const PRIVATE_SELECTOR = '[data-copilot-private]'

const NAME_SKIP = `${PRIVATE_SELECTOR},[${UI_ATTR}],[data-page-agent-ignore="true"],[aria-hidden="true"],script,style,noscript,template`

export function fold(text: string): string {
  return stripAccents(text).replace(/\s+/g, ' ').trim()
}

export function closestSafe(el: Element, selector: string): Element | null {
  return el.closest(selector)
}

export function isPrivate(el: Element): boolean {
  return !!el.closest(PRIVATE_SELECTOR)
}

export function isCopilotUi(el: Element): boolean {
  return !!el.closest(HELP_UI_SELECTOR)
}

/** Texto visível de um nó, sem subárvores privadas. */
export function safeText(node: Node, limit = 400): string {
  let out = ''
  const walk = (current: Node) => {
    if (out.length > limit) return
    if (current.nodeType === Node.TEXT_NODE) {
      out += ` ${current.textContent ?? ''}`
      return
    }
    if (current.nodeType !== Node.ELEMENT_NODE) return
    const el = current as Element
    if (el !== node && el.matches(NAME_SKIP)) return
    if (el.tagName === 'SELECT' || el.tagName === 'TEXTAREA') return
    if (el.tagName === 'IMG') {
      out += ` ${el.getAttribute('alt') ?? ''}`
      return
    }
    el.childNodes.forEach(walk)
  }
  if (node.nodeType === Node.ELEMENT_NODE && (node as Element).matches(PRIVATE_SELECTOR)) return ''
  walk(node)
  return out.replace(/\s+/g, ' ').trim().slice(0, limit)
}

function textOfIds(doc: Document, ids: string | null): string {
  if (!ids) return ''
  return ids
    .split(/\s+/)
    .map((id) => {
      const target = doc.getElementById(id)
      return target && !isPrivate(target) ? safeText(target) : ''
    })
    .join(' ')
    .trim()
}

function labelText(el: Element): string {
  const labels = (el as HTMLInputElement).labels
  if (labels && labels.length) {
    return Array.from(labels)
      .map((label) => (isPrivate(label) ? '' : safeText(label)))
      .join(' ')
      .trim()
  }
  return ''
}

const FIELD_TAGS = new Set(['INPUT', 'SELECT', 'TEXTAREA'])

/** Nome acessível (texto CRU: serve para classificar e para a confirmação local, nunca vai direto ao modelo). */
export function accessibleName(el: Element): string {
  const doc = el.ownerDocument
  const aria = el.getAttribute('aria-label')?.trim() || textOfIds(doc, el.getAttribute('aria-labelledby'))
  if (aria) return aria
  if (FIELD_TAGS.has(el.tagName)) {
    const input = el as HTMLInputElement
    // Em botões de formulário o rótulo é o próprio value.
    if (el.tagName === 'INPUT' && ['submit', 'button', 'reset'].includes(input.type)) return input.value
    return labelText(el) || el.getAttribute('placeholder') || el.getAttribute('title') || ''
  }
  return safeText(el) || el.getAttribute('title') || el.querySelector('img[alt]')?.getAttribute('alt') || ''
}

/** Todos os textos que descrevem um controle, inclusive o visível (o aria-label pode dizer outra coisa). */
export function allNames(el: Element): string[] {
  return [accessibleName(el), FIELD_TAGS.has(el.tagName) ? '' : safeText(el), el.getAttribute('title') ?? '']
    .map(fold)
    .filter(Boolean)
}

export function isDisplayed(el: Element): boolean {
  const view = el.ownerDocument.defaultView
  for (let current: Element | null = el; current; current = current.parentElement) {
    if (current.hasAttribute('hidden') || current.hasAttribute('inert')) return false
    if (current.getAttribute('aria-hidden') === 'true') return false
    if (current.tagName === 'DIALOG' && !current.hasAttribute('open')) return false
    const style = view?.getComputedStyle(current)
    if (style && (style.display === 'none' || style.visibility === 'hidden')) return false
  }
  return true
}

/** Modal que está na frente (ordem no documento é a aproximação de top layer). */
export function topModal(doc: Document = document): Element | null {
  const modals = Array.from(doc.querySelectorAll('dialog[open], [aria-modal="true"]')).filter(
    (el) => !isCopilotUi(el) && isDisplayed(el),
  )
  return modals.length ? modals[modals.length - 1] : null
}

export function headingOf(container: Element): string {
  const labelled =
    container.getAttribute('aria-label') || textOfIds(container.ownerDocument, container.getAttribute('aria-labelledby'))
  const heading = container.querySelector('h1,h2,h3')
  const title = heading && !isPrivate(heading) ? safeText(heading) : ''
  return Array.from(new Set([labelled, title].filter(Boolean))).join(' ')
}
