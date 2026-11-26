// Abertura/fechamento do <dialog> com fallback para navegadores sem `showModal()` (Safari < 15.4,
// WebViews antigas): lá o diálogo só recebe o atributo `open` e o CSS `.worki-dialog` faz o papel
// de overlay; a contenção de foco é a da própria casca.

const shownAt = new WeakMap<HTMLDialogElement, number>();
let sequence = 0;

export function closeDialog(element: HTMLDialogElement) {
    if (typeof element.close === 'function' && !element.hasAttribute('data-fallback')) element.close();
    else element.removeAttribute('open');
}

/** `reopen` fecha e reabre: é o jeito de voltar ao topo do top layer. */
export function showDialog(element: HTMLDialogElement, reopen = false) {
    const focused = document.activeElement as HTMLElement | null;
    if (reopen) closeDialog(element);
    if (element.open) return;
    try {
        if (typeof element.showModal !== 'function') throw new Error('sem showModal');
        element.showModal();
    } catch {
        element.setAttribute('open', '');
        element.setAttribute('data-fallback', '');
    }
    shownAt.set(element, ++sequence);
    if (reopen && focused && element.contains(focused)) focused.focus();
}

export function isShownAfter(a: HTMLDialogElement, b: HTMLDialogElement) {
    return (shownAt.get(a) ?? 0) > (shownAt.get(b) ?? 0);
}
