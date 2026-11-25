/**
 * Guarda em fase de captura: a última barreira, independente do modelo e do executor.
 *
 * Enquanto uma tarefa roda, todo evento SINTÉTICO de ativação é bloqueado, a não ser que caia
 * dentro do elemento do "bilhete" aberto pelo executor E o alvo real do evento (com todos os
 * ancestrais) passe de novo pela classificação. Cobre filho clicável, delegação de eventos,
 * label que aciona campo, e código da página que reaja ao clique clicando em outra coisa.
 * Toque de verdade da pessoa (`isTrusted`) sempre passa.
 *
 * Fora do DOM: `history.pushState/replaceState` para rota bloqueada (ex.: /convite*, que age ao
 * montar) e `window.open`.
 */
import { hardVerdict } from './risk'
import { judgeUrl } from './routes'

export interface GuardViolation {
  type: string
  reason: string
}

export interface GuardOptions {
  onViolation?: (violation: GuardViolation) => void
  /** Injetável só para testes (jsdom não produz eventos confiáveis). */
  isHuman?: (event: Event) => boolean
}

const EVENTOS = [
  'click', 'dblclick', 'auxclick', 'contextmenu', 'pointerdown', 'pointerup', 'mousedown', 'mouseup',
  'touchstart', 'touchend', 'keydown', 'keypress', 'keyup', 'input', 'change', 'submit',
] as const

/** Eventos que, sintéticos e sem bilhete, são só o React/navegador trabalhando. */
const PASSIVOS = new Set(['input', 'change'])

const JANELA_DO_TOQUE_MS = 1_000

interface Ticket {
  element: Element
  allowSubmit: boolean
}

export interface ActionGuard {
  arm(): void
  disarm(): void
  readonly armed: boolean
  /** Executa uma ação do copiloto liberando eventos SÓ dentro de `element`. */
  withTicket<T>(element: Element, options: { allowSubmit?: boolean }, run: () => Promise<T>): Promise<T>
  /** PARAR: nada mais sintético passa, mesmo com uma ação no meio. */
  revoke(): void
  /** Quantas vezes algo foi barrado nesta tarefa. */
  readonly violations: GuardViolation[]
}

export function createActionGuard(options: GuardOptions = {}): ActionGuard {
  const isHuman = options.isHuman ?? ((event: Event) => event.isTrusted)
  const violations: GuardViolation[] = []
  let ticket: Ticket | null = null
  let armed = false
  let lastHumanAt = 0
  let restore: Array<() => void> = []

  const block = (event: Event | null, type: string, reason: string) => {
    event?.preventDefault()
    event?.stopImmediatePropagation()
    const violation = { type, reason }
    violations.push(violation)
    options.onViolation?.(violation)
  }

  const inTicket = (target: Element, current: Ticket) => {
    if (current.element === target || current.element.contains(target)) return true
    const label = current.element.closest('label') as HTMLLabelElement | null
    return !!label?.control && label.control === target
  }

  const listener = (event: Event) => {
    const type = event.type
    if (type === 'submit') {
      // `submit` chega como confiável mesmo vindo de um clique sintético.
      if (ticket?.allowSubmit) return
      if (!ticket && Date.now() - lastHumanAt < JANELA_DO_TOQUE_MS) return
      block(event, type, 'Envio de formulário sem confirmação.')
      return
    }
    if (isHuman(event)) {
      lastHumanAt = Date.now()
      return
    }
    const raw = event.composedPath()[0]
    const target = raw instanceof Element ? raw : raw instanceof Node ? raw.parentElement : null
    if (!ticket) {
      if (PASSIVOS.has(type)) return
      block(event, type, 'Evento sintético fora de uma ação liberada.')
      return
    }
    if (!target || !inTicket(target, ticket)) {
      if (PASSIVOS.has(type)) return
      block(event, type, 'Evento fora do elemento liberado.')
      return
    }
    const veto = hardVerdict(target)
    if (veto) {
      block(event, type, veto.reason)
      return
    }
    const anchor = target.closest('a[href]')
    if (type === 'click' && anchor && judgeUrl(anchor.getAttribute('href') ?? '') === 'blocked') {
      block(event, type, 'Link proibido.')
    }
  }

  const patch = () => {
    const history = window.history
    for (const method of ['pushState', 'replaceState'] as const) {
      const original = history[method]
      const guarded = function guarded(this: History, data: unknown, unused: string, url?: string | URL | null) {
        // /convite* aceita sozinho ao montar: barrado na origem enquanto a tarefa roda.
        if (url && /\/convite/i.test(decodeURIComponent(String(url)))) {
          block(null, method, 'Navegação para convite.')
          return
        }
        return original.call(this, data, unused, url)
      }
      history[method] = guarded
      restore.push(() => {
        if (history[method] === guarded) history[method] = original
      })
    }
    const originalOpen = window.open
    const guardedOpen: typeof window.open = (...args) => {
      if (ticket) {
        block(null, 'window.open', 'Abrir janela externa.')
        return null
      }
      return originalOpen.apply(window, args)
    }
    window.open = guardedOpen
    restore.push(() => {
      if (window.open === guardedOpen) window.open = originalOpen
    })
  }

  return {
    get armed() {
      return armed
    },
    violations,
    arm() {
      if (armed) return
      armed = true
      violations.length = 0
      lastHumanAt = 0
      for (const type of EVENTOS) window.addEventListener(type, listener, { capture: true })
      patch()
    },
    disarm() {
      if (!armed) return
      armed = false
      ticket = null
      for (const type of EVENTOS) window.removeEventListener(type, listener, { capture: true })
      restore.forEach((undo) => undo())
      restore = []
    },
    revoke() {
      ticket = null
    },
    async withTicket(element, { allowSubmit = false }, run) {
      if (!armed) throw new Error('guarda desarmada')
      if (ticket) throw new Error('já há uma ação em curso')
      ticket = { element, allowSubmit }
      try {
        return await run()
      } finally {
        ticket = null
      }
    },
  }
}
