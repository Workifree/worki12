import { useEffect, useState, useRef, useSyncExternalStore } from 'react';
import type { RefObject } from 'react';
import { isShownAfter, showDialog } from '../lib/dialogElement';

// ---------------------------------------------------------------------------
// Pilha de modais. Quem usa é a casca única (`components/ui/Dialog`): um Esc fecha só o da frente,
// e o da frente na pilha é sempre o da frente na tela (top layer do <dialog>).
// ---------------------------------------------------------------------------

/** Camadas: quem tem o número maior fica na frente. `gate` = aceite obrigatório (Termos). */
export const MODAL_LAYER = { dialog: 70, invite: 75, gate: 90 } as const;

interface StackEntry {
    layer: number;
    order: number;
    close: () => void;
    element: () => HTMLDialogElement | null;
}

const stack: StackEntry[] = [];
const listeners = new Set<() => void>();
let nextOrder = 0;

function topEntry(): StackEntry | undefined {
    return stack.reduce<StackEntry | undefined>(
        (top, item) =>
            !top || item.layer > top.layer || (item.layer === top.layer && item.order > top.order) ? item : top,
        undefined,
    );
}

// O top layer do navegador segue a ordem de `showModal()`, não a nossa camada: se um diálogo de
// camada menor abriu DEPOIS do da frente, o da frente é reaberto para voltar ao topo.
function syncTopLayer() {
    const top = topEntry()?.element();
    if (!top) return;
    const covered = stack.some((item) => {
        const other = item.element();
        return !!other && other !== top && isShownAfter(other, top);
    });
    if (covered) {
        // `inert` ainda pode estar no elemento (o re-render vem depois): sai antes de reabrir.
        top.removeAttribute('inert');
        showDialog(top, true);
    }
}

function notify() {
    syncTopLayer();
    listeners.forEach((l) => l());
}

// UM listener para a pilha inteira: com um por modal, o React podia desmontar o do topo entre um
// listener e outro, e o de baixo "virava topo" no mesmo Esc.
function onStackKeyDown(e: KeyboardEvent) {
    if (e.key !== 'Escape' || e.defaultPrevented || e.isComposing) return;
    const top = topEntry();
    if (!top) return;
    // preventDefault: o navegador não fecha o <dialog> por conta própria (quem fecha é o estado).
    e.preventDefault();
    top.close();
}

function subscribe(listener: () => void) {
    listeners.add(listener);
    return () => {
        listeners.delete(listener);
    };
}

/**
 * Registra um modal na pilha. `active` = está na tela. `isTop` = é o da frente (os demais ficam
 * `inert`).
 */
export function useStackedModal(
    onClose: () => void,
    active: boolean,
    layer: number,
    elementRef?: RefObject<HTMLDialogElement | null>,
) {
    const closeRef = useRef(onClose);
    useEffect(() => {
        closeRef.current = onClose;
    });
    // Entrada estável: a posição na pilha não muda quando `onClose` é recriado a cada render.
    const [entry] = useState<StackEntry>(() => ({ layer, order: 0, close: () => {}, element: () => null }));

    useEffect(() => {
        if (!active) return;
        entry.close = () => closeRef.current();
        entry.element = () => elementRef?.current ?? null;
        entry.order = ++nextOrder;
        stack.push(entry);
        if (stack.length === 1) document.addEventListener('keydown', onStackKeyDown);
        notify();
        return () => {
            stack.splice(stack.indexOf(entry), 1);
            if (stack.length === 0) document.removeEventListener('keydown', onStackKeyDown);
            notify();
        };
    }, [active, entry, elementRef]);

    const isTop = useSyncExternalStore(subscribe, () => topEntry() === entry);

    return { isTop: active && isTop };
}

/** Elemento do diálogo da frente (ou null). Os toasts são desenhados dentro dele. */
export function useTopDialogElement(): HTMLDialogElement | null {
    return useSyncExternalStore(subscribe, () => topEntry()?.element() ?? null);
}
