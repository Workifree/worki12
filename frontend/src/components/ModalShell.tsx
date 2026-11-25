import { useEffect } from 'react';
import type { ReactNode } from 'react';
import { useFocusTrap } from '../hooks/useFocusTrap';
import { useModalDismiss } from '../hooks/useModalDismiss';

interface ModalShellProps {
    /** id do título (aria-labelledby). */
    labelledBy: string;
    onClose: () => void;
    /** Muda quando o conteúdo troca de etapa: leva o foco de volta ao primeiro controle. */
    focusKey?: string;
    children: ReactNode;
}

/**
 * Casca de modal brutalista acessível: foco inicial no primeiro controle (ou em `[data-autofocus]`),
 * Escape e toque no fundo fecham, Tab fica preso dentro e o foco volta ao botão que abriu
 * (`useFocusTrap` restaura o elemento ativo no desmonte). Monte-a só enquanto o modal estiver aberto.
 */
export default function ModalShell({ labelledBy, onClose, focusKey, children }: ModalShellProps) {
    const trapRef = useFocusTrap(true);
    const aoClicarNoFundo = useModalDismiss(onClose);

    useEffect(() => {
        const container = trapRef.current;
        if (!container) return;
        const alvo =
            container.querySelector<HTMLElement>('[data-autofocus]') ??
            container.querySelector<HTMLElement>('input:not([disabled]), button:not([disabled])');
        alvo?.focus();
    }, [trapRef, focusKey]);

    return (
        <div
            onClick={aoClicarNoFundo}
            className="fixed inset-0 z-[70] bg-black/50 backdrop-blur-sm flex items-center justify-center p-4 animate-in fade-in duration-200"
        >
            <div
                ref={trapRef}
                role="dialog"
                aria-modal="true"
                aria-labelledby={labelledBy}
                className="bg-white rounded-2xl border-2 border-black shadow-[8px_8px_0px_0px_rgba(0,0,0,1)] w-full max-w-md p-6 max-h-[calc(100dvh-2rem)] overflow-y-auto"
            >
                {children}
            </div>
        </div>
    );
}
