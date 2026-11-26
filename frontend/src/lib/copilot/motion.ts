/** Movimento: preferência do sistema e esperas que o PARAR interrompe na hora. */

export function prefersReducedMotion(): boolean {
  try {
    return window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false
  } catch {
    return false
  }
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
