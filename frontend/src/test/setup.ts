import '@testing-library/jest-dom/vitest'

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
