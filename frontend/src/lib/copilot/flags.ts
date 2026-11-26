/** Copiloto desligado por padrão: só liga com `VITE_COPILOT_ENABLED=true` no build. */
export function isCopilotEnabled(): boolean {
  return import.meta.env.VITE_COPILOT_ENABLED === 'true'
}
