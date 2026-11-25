import { useEffect, useCallback, useState, useRef, useSyncExternalStore } from 'react';

/**
 * Saída de emergência de modal (heurística #3 de Nielsen — controle e liberdade do usuário).
 *
 * Achado da avaliação heurística de 01/09/2026: NENHUM dos 24 modais do produto fechava com ESC
 * ou com toque no fundo escurecido — só pelo botão explícito. O único que tentava (RateModal)
 * usava `onKeyDown` na própria div, que só dispara com foco DENTRO dela; sem foco, o ESC nunca
 * chegava. Verificado no browser: ESC e backdrop ignorados.
 *
 * Este hook resolve os dois de uma vez:
 *  - ESC: listener no `document` (pega a tecla com qualquer foco);
 *  - fundo: devolve um onClick para o wrapper `fixed inset-0` que só fecha quando o clique foi
 *    NO PRÓPRIO fundo (`e.target === e.currentTarget`) — clique dentro do cartão nunca fecha.
 *
 * NÃO usar em modal que é gate de propósito (TosGateModal, convite obrigatório pós-criação de
 * turno): ali a impossibilidade de dispensar é a feature.
 */
export function useModalDismiss(onClose: () => void) {
    useEffect(() => {
        const aoTeclar = (e: KeyboardEvent) => {
            if (e.key === 'Escape') onClose();
        };
        document.addEventListener('keydown', aoTeclar);
        return () => document.removeEventListener('keydown', aoTeclar);
    }, [onClose]);

    return useCallback(
        (e: React.MouseEvent<HTMLElement>) => {
            if (e.target === e.currentTarget) onClose();
        },
        [onClose],
    );
}

// ---------------------------------------------------------------------------
// Pilha de modais (para os que podem ficar abertos ao mesmo tempo)
// ---------------------------------------------------------------------------

/** Camadas: quem tem o número maior fica na frente. Espelha o z-index de cada modal. */
export const MODAL_LAYER = { dialog: 70, invite: 75 } as const;

interface StackEntry {
    layer: number;
    order: number;
    close: () => void;
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

// UM listener para a pilha inteira: com um por modal, o React podia desmontar o do topo entre um
// listener e outro, e o de baixo "virava topo" no mesmo Esc.
function onStackKeyDown(e: KeyboardEvent) {
    if (e.key === 'Escape') topEntry()?.close();
}

function subscribe(listener: () => void) {
    listeners.add(listener);
    return () => {
        listeners.delete(listener);
    };
}

/**
 * Como `useModalDismiss`, para modal que pode coexistir com outro: um Esc fecha só o da frente.
 * `active` = o modal está na tela. `isTop` = é o da frente (os demais devem ficar `inert`).
 */
export function useStackedModal(onClose: () => void, active: boolean, layer: number) {
    const closeRef = useRef(onClose);
    useEffect(() => {
        closeRef.current = onClose;
    });
    // Entrada estável: a posição na pilha não muda quando `onClose` é recriado a cada render.
    const [entry] = useState<StackEntry>(() => ({ layer, order: 0, close: () => {} }));

    useEffect(() => {
        if (!active) return;
        entry.close = () => closeRef.current();
        entry.order = ++nextOrder;
        stack.push(entry);
        if (stack.length === 1) document.addEventListener('keydown', onStackKeyDown);
        listeners.forEach((l) => l());
        return () => {
            stack.splice(stack.indexOf(entry), 1);
            if (stack.length === 0) document.removeEventListener('keydown', onStackKeyDown);
            listeners.forEach((l) => l());
        };
    }, [active, entry]);

    const isTop = useSyncExternalStore(subscribe, () => topEntry() === entry);

    const onBackdropClick = useCallback((e: React.MouseEvent<HTMLElement>) => {
        if (e.target === e.currentTarget) closeRef.current();
    }, []);

    return { onBackdropClick, isTop: active && isTop };
}
