/**
 * `PageController` do page-agent com a camada de segurança do Workyn. O laço do agente
 * (`PageAgentCore`) só alcança a página por esta classe.
 *
 *  - leitura: `observePage` (a serialização original NUNCA roda);
 *  - clique e digitação: primitivas do page-agent, mas só depois da classificação, da confirmação
 *    e dentro de um bilhete da guarda;
 *  - select: setter nativo (a primitiva original atribui `value` e o React ignora a mudança);
 *  - JavaScript arbitrário: não existe.
 */
import { PageController, clickElement, scrollVertically } from '@page-agent/page-controller'
import { accessibleName, headingOf, isDisplayed, topModal } from './dom'
import type { ActionGuard } from './guard'
import { writeLog } from './log'
import { cleanLabel, fingerprintOf, observePage, type Observation, type ObservedElement } from './observe'
import { containsPII, normalizeText } from './redact'
import { classifyClick, classifyFill, isSensitiveField, selectIsFormField, submitsForm } from './risk'
import { pathPolicy, screenName } from './routes'
import type { ConfirmCard, CopilotMode, CopilotUI } from './ui'

export type StopReason = 'user' | 'handoff' | 'declined' | 'blocked' | 'out-of-scope' | 'limit' | 'unchanged'

export interface ControllerDeps {
  guard: ActionGuard
  ui: CopilotUI
  mode: () => CopilotMode
  signal: AbortSignal
  stop: (reason: StopReason, detail?: string) => void
  allowedWords: Set<string>
  /** Teto de ações que tocam a página por tarefa. */
  maxActions?: number
  confirmTtlMs?: number
}

export interface ActionResult {
  success: boolean
  message: string
}

const ok = (message: string): ActionResult => ({ success: true, message })
const fail = (message: string): ActionResult => ({ success: false, message })

const MARCADOR = /\[(?:cpf|cnpj|telefone|email|senha|codigo|token|pix|id|numero|nascimento|data-antiga|oculto)\]/i

/** Texto cru, curto: só para a tela da própria pessoa. */
function localName(el: Element): string {
  return accessibleName(el).replace(/\s+/g, ' ').trim().slice(0, 80) || 'sem nome'
}

function tipoDe(el: Element): string {
  if (el.tagName === 'A') return 'no link'
  if (el.getAttribute('role') === 'tab') return 'na aba'
  const type = el.getAttribute('type')
  if (type === 'checkbox' || el.getAttribute('role') === 'switch') return 'na opção'
  return 'no botão'
}

function formFields(el: Element): ConfirmCard['fields'] {
  const scope = el.closest('form') ?? el.closest('dialog,[role="dialog"]')
  if (!scope) return []
  return Array.from(scope.querySelectorAll<HTMLInputElement>('input,select,textarea'))
    .filter((f) => f.type !== 'hidden' && isDisplayed(f))
    .slice(0, 14)
    .map((field) => {
      let value: string
      if (isSensitiveField(field)) value = '(não mostrado)'
      else if (field.type === 'checkbox' || field.type === 'radio') value = field.checked ? 'marcado' : 'desmarcado'
      else if (field.tagName === 'SELECT') {
        value = (field as unknown as HTMLSelectElement).selectedOptions[0]?.textContent?.trim() || '(vazio)'
      } else value = field.value.slice(0, 120) || '(vazio)'
      return { label: localName(field), value }
    })
}

/** Em botão de liga/desliga o cartão diz o EFEITO, não só o toque. */
function verboDe(el: Element): string {
  const pressed = el.getAttribute('aria-pressed')
  if (pressed === 'true') return 'Desmarcar (hoje está marcado)'
  if (pressed === 'false') return 'Marcar (hoje está desmarcado)'
  return `Tocar ${tipoDe(el)}`
}

export class GuardedPageController extends PageController {
  private readonly deps: ControllerDeps
  private observation: Observation | null = null
  private readonly typed = new WeakMap<Element, string>()
  private observedAt = 0
  private actions = 0
  /** Campos preenchidos nesta tarefa (para não descartar um formulário sem perguntar). */
  filled: Element[] = []

  constructor(deps: ControllerDeps) {
    super({ enableMask: false })
    this.deps = deps
  }

  override async updateTree(): Promise<string> {
    this.observation = observePage({ allowedWords: this.deps.allowedWords, typed: this.typed })
    this.observedAt = Date.now()
    return this.observation.content
  }

  override async getBrowserState() {
    const content = await this.updateTree()
    const observation = this.observation!
    return {
      // Só o padrão da rota: sem id, query, hash ou título do documento.
      url: observation.pattern,
      title: observation.screen,
      header: `Tela atual: ${observation.screen} (rota ${observation.pattern})`,
      content,
      footer: '[fim da tela]',
    }
  }

  override async getCurrentUrl(): Promise<string> {
    return this.observation?.pattern ?? '/'
  }

  override async getLastUpdateTime(): Promise<number> {
    return this.observedAt
  }

  override async showMask(): Promise<void> {}
  override async hideMask(): Promise<void> {}
  override async cleanUpHighlights(): Promise<void> {}

  override async executeJavascript(): Promise<ActionResult> {
    writeLog('bloqueado', 'Pedido de executar código na página foi recusado.')
    return fail('Executar código não existe neste copiloto.')
  }

  override async scrollHorizontally(): Promise<ActionResult> {
    return fail('Rolagem horizontal não existe neste copiloto.')
  }

  override async scroll(options: { down: boolean; numPages: number; pixels?: number; index?: number }): Promise<ActionResult> {
    const element = options.index === undefined ? null : (this.observation?.elements.get(options.index)?.element ?? null)
    const pixels = (options.pixels ?? options.numPages * window.innerHeight) * (options.down ? 1 : -1)
    await this.deps.ui.scrolled?.(options.down, this.deps.signal)
    if (this.deps.signal.aborted) return fail('Tarefa interrompida.')
    await scrollVertically(pixels, element)
    // Sem este aviso, modelos rolam em laço esperando itens novos.
    return ok('Rolei. A leitura já traz a tela INTEIRA: rolar não revela itens novos. Não role de novo; toque, destaque ou responda.')
  }

  elementFor(index: number): ObservedElement | null {
    return this.observation?.elements.get(index) ?? null
  }

  /** Nome para a interface local ("Tocando em ..."). */
  localLabel(index: number): string {
    const entry = this.elementFor(index)
    return entry ? localName(entry.element) : 'um item da tela'
  }

  /** O elemento ainda é o mesmo que o modelo viu? (React reaproveita nós.) */
  resolve(index: number): ObservedElement | string {
    if (pathPolicy(window.location.pathname) === 'blocked') return 'Esta tela está fora do alcance do copiloto.'
    const entry = this.elementFor(index)
    if (!entry) return `Não há item [${index}] nesta tela.`
    const { element, fingerprint } = entry
    const modal = topModal()
    if (!element.isConnected || !isDisplayed(element) || fingerprintOf(element) !== fingerprint) {
      return 'A tela mudou desde a última leitura. Observe de novo.'
    }
    if (modal && !modal.contains(element)) return 'Há uma janela aberta na frente. Observe de novo.'
    return entry
  }

  private halted(): ActionResult | null {
    return this.deps.signal.aborted ? fail('Tarefa interrompida.') : null
  }

  private countAction(): ActionResult | null {
    this.actions += 1
    if (this.actions <= (this.deps.maxActions ?? 25)) return null
    this.deps.stop('limit')
    return fail('Limite de ações da tarefa atingido.')
  }

  private handoff(element: HTMLElement, safeLabel: string, reason: string): ActionResult {
    writeLog('entregue', `Deixei para você: ${safeLabel}`)
    this.deps.ui.handoff({ element, label: localName(element), reason })
    this.deps.stop('handoff', localName(element))
    return fail('Ação reservada para a pessoa. Foi destacada e a tarefa acabou.')
  }

  private async askConfirmation(element: HTMLElement, card: ConfirmCard): Promise<boolean> {
    const before = JSON.stringify([fingerprintOf(element), formFields(element)])
    const asked = Date.now()
    const approved = await this.deps.ui.confirm(card, element, this.deps.signal)
    if (!approved || this.deps.signal.aborted) return false
    // Aprovação vale para o que foi mostrado, uma vez, por pouco tempo.
    if (Date.now() - asked > (this.deps.confirmTtlMs ?? 120_000)) return false
    return element.isConnected && JSON.stringify([fingerprintOf(element), formFields(element)]) === before
  }

  private async waitShowMe(element: HTMLElement, kind: 'tap' | 'type', instruction: string): Promise<ActionResult> {
    const outcome = await this.deps.ui.showMe({ element, kind, instruction }, this.deps.signal)
    if (outcome === 'done') return ok('A pessoa fez este passo.')
    this.deps.stop('declined')
    return fail('A pessoa não quis fazer este passo.')
  }

  private async guarded(element: HTMLElement, allowSubmit: boolean, run: () => Promise<void>): Promise<boolean> {
    const before = this.deps.guard.violations.length
    await this.deps.guard.withTicket(element, { allowSubmit }, run)
    return this.deps.guard.violations.length === before
  }

  override async clickElement(index: number): Promise<ActionResult> {
    const halted = this.halted() ?? this.countAction()
    if (halted) return halted
    const entry = this.resolve(index)
    if (typeof entry === 'string') return fail(entry)
    const { element, safeLabel } = entry
    if ((element as HTMLButtonElement).disabled || element.getAttribute('aria-disabled') === 'true') {
      return fail('Este item está desativado.')
    }
    const verdict = classifyClick(element)
    if (verdict.level === 'blocked') {
      writeLog('bloqueado', `Não toquei em ${safeLabel}`)
      return fail(`Bloqueado: ${verdict.reason}`)
    }
    if (verdict.level === 'forbidden') return this.handoff(element, safeLabel, verdict.reason)
    if (this.deps.mode() === 'show') {
      return this.waitShowMe(element, 'tap', `Toque em "${localName(element)}".`)
    }
    let confirmed = false
    if (verdict.level === 'confirm') {
      confirmed = await this.askConfirmation(element, {
        screen: screenName(window.location.pathname),
        action: `${verboDe(element)} "${localName(element)}"${
          element.closest('dialog') ? ` da janela "${headingOf(element.closest('dialog')!).slice(0, 80)}"` : ''
        }`,
        reason: verdict.reason,
        fields: submitsForm(element) ? formFields(element) : [],
      })
      if (!confirmed) {
        writeLog('recusado', `Não confirmado: ${safeLabel}`)
        this.deps.stop('declined')
        return fail('A pessoa não confirmou (ou a tela mudou). Nada foi feito.')
      }
      writeLog('confirmado', `Você confirmou: ${safeLabel}`)
    }
    // O ponteiro chega ao alvo (só imagem) e a tela pode mudar enquanto isso: confere de novo.
    await this.deps.ui.actOn?.({ element, kind: 'click' }, this.deps.signal)
    const stillHalted = this.halted()
    if (stillHalted) return stillHalted
    if (fingerprintOf(element) !== entry.fingerprint || !element.isConnected) return fail('A tela mudou. Nada foi feito.')
    // Reclassifica no último instante.
    const last = classifyClick(element)
    if (last.level === 'forbidden') return this.handoff(element, safeLabel, last.reason)
    if (last.level === 'blocked' || (last.level === 'confirm' && !confirmed)) return fail('A tela mudou. Nada foi feito.')

    const clean = await this.guarded(element, confirmed && submitsForm(element), () => clickElement(element))
    if (!clean) {
      writeLog('bloqueado', `A trava barrou um efeito ao tocar em ${safeLabel}`)
      this.deps.stop('blocked')
      return fail('A trava de segurança barrou esse toque.')
    }
    writeLog('acao', `Toquei em ${safeLabel}`)
    return ok(`Toquei em "${safeLabel}".`)
  }

  override async inputText(index: number, text: string): Promise<ActionResult> {
    const halted = this.halted() ?? this.countAction()
    if (halted) return halted
    const entry = this.resolve(index)
    if (typeof entry === 'string') return fail(entry)
    const { element, safeLabel } = entry
    const fill = classifyFill(element)
    if (!fill.ok) {
      if (fill.verdict.level === 'forbidden') return this.handoff(element, safeLabel, fill.verdict.reason)
      return fail(`Bloqueado: ${fill.verdict.reason}`)
    }
    if (element.tagName === 'SELECT') return fail('Use select_dropdown_option para listas.')
    if (containsPII(text) || MARCADOR.test(text)) {
      writeLog('bloqueado', `Recusei digitar dado pessoal em ${safeLabel}`)
      return fail('O copiloto não digita dado pessoal. Peça para a pessoa preencher.')
    }
    if (this.deps.mode() === 'show') {
      return this.waitShowMe(element, 'type', `Preencha "${localName(element)}" com: ${text.slice(0, 200)}`)
    }
    const field = element as HTMLInputElement
    await this.deps.ui.actOn?.({ element, kind: 'type', text }, this.deps.signal)
    const interrupted = this.halted()
    if (interrupted) return interrupted
    if (fingerprintOf(element) !== entry.fingerprint || !element.isConnected) return fail('A tela mudou. Nada foi feito.')
    // Não usa `inputTextElement`: ele espera cerca de 0,4 s e escreve pelo setter nativo mesmo
    // depois do PARAR (setter não é evento, e `input` é passivo para a guarda).
    const clean = await this.guarded(element, false, async () => {
      await clickElement(element)
      if (this.deps.signal.aborted) return
      // Conferência e escrita sem nenhum `await` no meio.
      Object.getOwnPropertyDescriptor(Object.getPrototypeOf(field), 'value')!.set!.call(field, text)
      field.dispatchEvent(new Event('input', { bubbles: true }))
    })
    const stopped = this.halted()
    if (stopped) return stopped
    if (!clean) {
      this.deps.stop('blocked')
      return fail('A trava de segurança barrou esse preenchimento.')
    }
    const accepted = field.value === text || (field.type === 'number' && Number(field.value) === Number(text))
    if (!accepted) return fail('O campo não aceitou esse valor (confira o formato: data AAAA-MM-DD, hora HH:MM).')
    this.typed.set(element, field.value)
    this.filled.push(element)
    writeLog('acao', `Preenchi ${safeLabel}`)
    return ok(`Preenchi "${safeLabel}".`)
  }

  override async selectOption(index: number, optionText: string): Promise<ActionResult> {
    const halted = this.halted() ?? this.countAction()
    if (halted) return halted
    const entry = this.resolve(index)
    if (typeof entry === 'string') return fail(entry)
    const { element, safeLabel } = entry
    if (element.tagName !== 'SELECT') return fail('Este item não é uma lista.')
    const select = element as HTMLSelectElement
    const fill = classifyFill(element)
    if (!fill.ok) {
      if (fill.verdict.level === 'forbidden') return this.handoff(element, safeLabel, fill.verdict.reason)
      return fail(`Bloqueado: ${fill.verdict.reason}`)
    }
    // O modelo vê o texto já normalizado ("…" vira "..."): compara na mesma forma.
    const wanted = normalizeText(optionText.trim())
    const option = Array.from(select.options).find((o) => {
      const raw = o.textContent?.trim() ?? ''
      return !o.disabled && (normalizeText(raw) === wanted || normalizeText(cleanLabel(raw, this.deps.allowedWords)) === wanted)
    })
    if (!option) return fail('Não há essa opção na lista.')
    const raw = option.textContent?.trim() ?? ''
    if (this.deps.mode() === 'show') return this.waitShowMe(element, 'type', `Em "${localName(element)}", escolha "${raw}".`)
    // Lista solta (sem formulário nem campos vizinhos) costuma gravar na hora (etiqueta, troca de unidade).
    const needsConfirm = !selectIsFormField(select)
    if (needsConfirm) {
      const approved = await this.askConfirmation(element, {
        screen: screenName(window.location.pathname),
        action: `Escolher "${raw}" em "${localName(element)}"`,
        reason: 'Esta lista pode gravar na hora.',
        fields: [],
      })
      if (!approved) {
        this.deps.stop('declined')
        return fail('A pessoa não confirmou. Nada foi feito.')
      }
    }
    await this.deps.ui.actOn?.({ element, kind: 'select' }, this.deps.signal)
    const interrupted = this.halted()
    if (interrupted) return interrupted
    if (fingerprintOf(element) !== entry.fingerprint || !element.isConnected) return fail('A tela mudou. Nada foi feito.')
    const clean = await this.guarded(element, false, async () => {
      const setter = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(select), 'value')!.set!
      setter.call(select, option.value)
      select.dispatchEvent(new Event('input', { bubbles: true }))
      select.dispatchEvent(new Event('change', { bubbles: true }))
    })
    if (!clean) {
      this.deps.stop('blocked')
      return fail('A trava de segurança barrou essa escolha.')
    }
    this.filled.push(select)
    writeLog('acao', `Escolhi uma opção em ${safeLabel}`)
    return ok(`Escolhi a opção em "${safeLabel}".`)
  }
}
