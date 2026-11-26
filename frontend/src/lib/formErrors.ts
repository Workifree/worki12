/**
 * Leva a pessoa ao primeiro campo com problema (`aria-invalid` no controle, ou `data-invalid` num
 * grupo com `tabIndex={-1}`): foca e rola até ele. Chame DEPOIS de o erro estar no DOM
 * (`flushSync` no setState que marca a tentativa de envio).
 */
export function focusFirstInvalid(root: ParentNode | null): boolean {
    const target = root?.querySelector<HTMLElement>('[aria-invalid="true"]:not(fieldset), [data-invalid="true"]');
    if (!target) return false;
    target.focus({ preventScroll: true });
    target.scrollIntoView?.({ block: 'center' });
    return true;
}
