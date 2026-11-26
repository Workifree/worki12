import type { useCopilotAgent } from '../../hooks/copilot/useCopilotAgent'
import type { CopilotRole } from '../../lib/copilot/routes'
import type { CopilotMode } from '../../lib/copilot/ui'

export type Availability = 'checking' | 'ready' | 'unavailable'

/** Estado e ações do copiloto, compartilhados pelas duas telas (PC e celular). O agente é um só. */
export interface CopilotViewProps {
  role: CopilotRole
  agent: ReturnType<typeof useCopilotAgent>
  open: boolean
  close: () => void
  openIt: () => void
  showLauncher: boolean
  /** Aba lateral de abrir no celular. O app a desliga: lá o gatilho é a pílula "Ajuda" do cabeçalho. */
  mobileLauncher: boolean
  availability: Availability
  consent: boolean
  accept: () => void
  mode: CopilotMode
  setMode: (mode: CopilotMode) => void
  draft: string
  setDraft: (text: string) => void
  send: (text: string) => void
  suggestions: string[]
  history: string[]
  forgetHistory: () => void
  onOpenGuide?: () => void
  navigate: (path: string) => void
  confirmArmDelayMs?: number
  showLog: boolean
  /** Demonstração dos efeitos (cursor/toque, ondulação, pulo, gota, brilho) sem chamar a IA. */
  demo: () => void
  setShowLog: (value: boolean) => void
}
