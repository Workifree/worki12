/** Contrato entre o executor (código) e a interface do copiloto. */

export type CopilotMode = 'show' | 'do'

export interface ConfirmField {
  label: string
  value: string
}

/** Cartão montado PELO CÓDIGO a partir do elemento real. Nenhum texto vem do modelo. */
export interface ConfirmCard {
  screen: string
  /** Frase do que vai acontecer, ex.: `Tocar no botão "Publicar turno"`. */
  action: string
  reason: string
  /** Dados do formulário que serão enviados. Mostrados só aqui, no aparelho. */
  fields: ConfirmField[]
}

export interface ShowRequest {
  element: HTMLElement
  /** Instrução para a pessoa. */
  instruction: string
  kind: 'tap' | 'type'
}

export interface HandoffRequest {
  element: HTMLElement
  label: string
  reason: string
}

export interface CopilotUI {
  /** Só resolve `true` com um toque da pessoa no cartão. */
  confirm(card: ConfirmCard, element: HTMLElement | null, signal: AbortSignal): Promise<boolean>
  /** Modo "Me mostre": destaca e espera a pessoa agir. */
  showMe(request: ShowRequest, signal: AbortSignal): Promise<'done' | 'skip'>
  /** Categoria D: destaca; a tarefa termina aqui. */
  handoff(request: HandoffRequest): void
  highlight(element: HTMLElement, message: string): void
  ask(question: string, signal: AbortSignal): Promise<string>
  /** Texto do passo, gerado pelo código ("Tocando em Turnos"). */
  step(text: string): void
}
