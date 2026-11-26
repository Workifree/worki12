/** Movimento: preferência do sistema e esperas que o PARAR interrompe na hora. */

const MOTION_KEY = 'worki:copilot:movimento'
export type MotionMode = 'pleno' | 'reduzido'

/** Escolha da pessoa no copiloto. Padrão: movimento COMPLETO (igual ao laboratório), mesmo com "reduzir movimento" do sistema. */
export function getMotionMode(): MotionMode {
  try {
    return window.localStorage.getItem(MOTION_KEY) === 'reduzido' ? 'reduzido' : 'pleno'
  } catch {
    return 'pleno'
  }
}

/** Grava a escolha e a publica no <html> (o CSS do copiloto lê `data-copilot-motion`). */
export function setMotionMode(mode: MotionMode): void {
  try {
    window.localStorage.setItem(MOTION_KEY, mode)
  } catch {
    // vale só para esta visita
  }
  applyMotionMode()
}

export function applyMotionMode(): void {
  if (typeof document === 'undefined') return
  document.documentElement.setAttribute('data-copilot-motion', getMotionMode() === 'reduzido' ? 'reduced' : 'full')
}

export function prefersReducedMotion(): boolean {
  return getMotionMode() === 'reduzido'
}

/** Espera `ms`; resolve antes se o sinal abortar (nunca rejeita). */
export function wait(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    if (signal?.aborted || ms <= 0) return resolve()
    const done = () => {
      clearTimeout(timer)
      signal?.removeEventListener('abort', done)
      resolve()
    }
    const timer = setTimeout(done, ms)
    signal?.addEventListener('abort', done, { once: true })
  })
}

export const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value))
