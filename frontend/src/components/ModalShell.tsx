import type { ReactNode } from 'react';
import { Dialog } from './ui/Dialog';

interface ModalShellProps {
    /** id do título (aria-labelledby). */
    labelledBy: string;
    onClose: () => void;
    /** Muda quando o conteúdo troca de etapa: leva o foco de volta ao primeiro controle. */
    focusKey?: string;
    children: ReactNode;
}

/** Atalho da casca única (`ui/Dialog`). Monte-o só enquanto o modal estiver aberto. */
export default function ModalShell({ labelledBy, onClose, focusKey, children }: ModalShellProps) {
    return (
        <Dialog labelledBy={labelledBy} onClose={onClose} focusKey={focusKey}>
            {children}
        </Dialog>
    );
}
