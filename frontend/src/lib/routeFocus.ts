/**
 * Navegação PARA FRENTE troca de tela: rola ao topo. No voltar/avançar (POP), na primeira carga e
 * quando só a query muda (abrir conversa, trocar filtro) a posição e o foco ficam como estão.
 */
export function shouldResetView(
    navigationType: 'PUSH' | 'POP' | 'REPLACE',
    previousPath: string | null,
    nextPath: string,
): boolean {
    return previousPath !== null && previousPath !== nextPath && navigationType !== 'POP';
}

/**
 * Foca o `<h1>` da tela nova, para leitor de tela e teclado começarem dela. Como as páginas são
 * lazy e têm esqueleto, espera o título aparecer. Não rouba o foco de um campo ou de um modal que
 * a própria tela já focou. Devolve a função que cancela a espera.
 */
export function focusPageHeading(timeoutMs = 5000): () => void {
    let observer: MutationObserver | null = null;
    let timer: ReturnType<typeof setTimeout> | undefined;

    const cancel = () => {
        observer?.disconnect();
        if (timer) clearTimeout(timer);
    };

    const tryFocus = () => {
        const heading = document.querySelector<HTMLElement>('main h1') ?? document.querySelector<HTMLElement>('h1');
        if (!heading) return false;
        const active = document.activeElement;
        const busy = !!active?.closest('input, textarea, select, [contenteditable="true"], dialog');
        if (!busy) {
            if (!heading.hasAttribute('tabindex')) heading.setAttribute('tabindex', '-1');
            heading.focus({ preventScroll: true });
        }
        return true;
    };

    if (!tryFocus()) {
        observer = new MutationObserver(() => {
            if (tryFocus()) cancel();
        });
        observer.observe(document.body, { childList: true, subtree: true });
        timer = setTimeout(cancel, timeoutMs);
    }
    return cancel;
}
