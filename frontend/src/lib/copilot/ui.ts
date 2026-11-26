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

/** O que o executor vai fazer a seguir, para o ponteiro virtual mostrar ANTES (só imagem). */
export interface ActRequest {
  element: HTMLElement
  kind: 'click' | 'type' | 'select'
  /** Texto a escrever, só para a pré-visualização local. */
  text?: string
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
  /**
   * Opcional: antes de tocar/escrever, mostra o ponteiro chegando ao alvo. Resolve quando a ação de
   * verdade pode acontecer (ou na hora, com PARAR). Nunca dispara evento.
   */
  actOn?(request: ActRequest, signal: AbortSignal): Promise<void>
  /** Opcional: rolagem do dedo/seta. */
  scrolled?(down: boolean, signal: AbortSignal): Promise<void>
}
