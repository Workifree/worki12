import '@testing-library/jest-dom/vitest'
import { vi } from 'vitest'

// Tempo real: nenhum teste abre canal de verdade. Para simular evento, `emitLive` de `./liveHubMock`.
vi.mock('../lib/realtime/defaultHub', async () => {
  const { testHub } = await import('./liveHubMock')
  return { getLiveHub: () => testHub }
})

// O jsdom não implementa `showModal()`/`close()` do <dialog>. Polyfill SÓ de teste (no app, quem
// não tem `showModal` cai no fallback de `lib/dialogElement.ts`).
if (typeof HTMLDialogElement !== 'undefined' && typeof HTMLDialogElement.prototype.showModal !== 'function') {
  HTMLDialogElement.prototype.showModal = function showModal(this: HTMLDialogElement) {
    this.setAttribute('open', '')
  }
  HTMLDialogElement.prototype.close = function close(this: HTMLDialogElement) {
    if (!this.hasAttribute('open')) return
    this.removeAttribute('open')
    // Como no navegador, o evento `close` é assíncrono.
    setTimeout(() => this.dispatchEvent(new Event('close')), 0)
  }
}
