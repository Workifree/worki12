import React, { createContext, useContext, useState, useCallback, useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { X, CheckCircle2, AlertCircle, Info } from 'lucide-react';
import { useTopDialogElement } from '../hooks/useModalDismiss';
import { pushToast, toastDuration } from '../lib/toastTiming';
import type { ToastType } from '../lib/toastTiming';

export type { ToastType };

interface Toast {
    id: string;
    message: string;
    type: ToastType;
}

interface ToastContextType {
    addToast: (message: string, type?: ToastType) => void;
    removeToast: (id: string) => void;
}

const ToastContext = createContext<ToastContextType | undefined>(undefined);

const STYLE: Record<ToastType, string> = {
    success: 'bg-green-50 text-green-900',
    error: 'bg-red-50 text-red-900',
    info: 'bg-blue-50 text-blue-900',
};

/** Um aviso. O relógio pausa com o ponteiro em cima ou o foco dentro e recomeça ao sair. */
function ToastItem({ toast, onRemove }: { toast: Toast; onRemove: (id: string) => void }) {
    const [hovered, setHovered] = useState(false);
    const [focused, setFocused] = useState(false);
    const paused = hovered || focused;
    const duration = toastDuration(toast.type, toast.message);
    const remaining = useRef(duration);
    const itemRef = useRef<HTMLDivElement>(null);
    const [closing, setClosing] = useState(false);

    // Saída: marca `data-closing` e só desmonta quando a transição termina (teto de 2s). Sem
    // transição (jsdom, navegador antigo) remove na hora.
    const dismiss = useCallback(() => {
        if (typeof itemRef.current?.getAnimations !== 'function') onRemove(toast.id);
        else setClosing(true);
    }, [toast.id, onRemove]);

    useEffect(() => {
        if (!closing) return;
        let done = false;
        const finish = () => {
            if (done) return;
            done = true;
            onRemove(toast.id);
        };
        const animations = itemRef.current?.getAnimations() ?? [];
        if (animations.length === 0) {
            finish();
            return;
        }
        const ceiling = setTimeout(finish, 2000);
        void Promise.allSettled(animations.map((a) => a.finished)).then(finish);
        return () => clearTimeout(ceiling);
    }, [closing, toast.id, onRemove]);

    useEffect(() => {
        if (paused || remaining.current === null) return;
        const startedAt = Date.now();
        const timer = setTimeout(dismiss, remaining.current);
        return () => {
            clearTimeout(timer);
            // Ao retomar, sobra no mínimo 2s: sumir assim que o ponteiro sai parece falha.
            if (remaining.current !== null) {
                remaining.current = Math.max(2000, remaining.current - (Date.now() - startedAt));
            }
        };
    }, [paused, dismiss]);

    return (
        <div
            ref={itemRef}
            data-closing={closing || undefined}
            role={toast.type === 'error' ? 'alert' : undefined}
            onPointerEnter={() => setHovered(true)}
            onPointerLeave={() => setHovered(false)}
            onFocus={() => setFocused(true)}
            onBlur={(e) => {
                if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setFocused(false);
            }}
            className={`worki-toast pointer-events-auto flex w-full md:w-auto md:max-w-md items-center gap-3 px-4 py-3 rounded-xl border-2 border-black shadow-brutal-sm ${STYLE[toast.type]}`}
        >
            {toast.type === 'success' && <CheckCircle2 size={20} aria-hidden="true" className="shrink-0 text-green-600" />}
            {toast.type === 'error' && <AlertCircle size={20} aria-hidden="true" className="shrink-0 text-red-600" />}
            {toast.type === 'info' && <Info size={20} aria-hidden="true" className="shrink-0 text-blue-600" />}

            <p className="font-bold text-sm flex-1 min-w-0 break-words">{toast.message}</p>

            <button
                type="button"
                onClick={dismiss}
                aria-label="Fechar aviso"
                className="-my-2 -mr-2 ml-1 min-h-11 min-w-11 inline-flex items-center justify-center flex-shrink-0 hover:bg-black/5 rounded-full transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-black"
            >
                <X size={16} aria-hidden="true" />
            </button>
        </div>
    );
}

export function ToastProvider({ children }: { children: React.ReactNode }) {
    const [toasts, setToasts] = useState<Toast[]>([]);
    // Com um <dialog> aberto o resto da página fica inerte e abaixo do top layer: os avisos são
    // desenhados DENTRO do diálogo da frente para aparecer, ser lidos e poder ser fechados.
    const topDialog = useTopDialogElement();

    const removeToast = useCallback((id: string) => {
        setToasts((prev) => prev.filter((toast) => toast.id !== id));
    }, []);

    const addToast = useCallback((message: string, type: ToastType = 'info') => {
        const id = Math.random().toString(36).substring(2, 9);
        setToasts((prev) => pushToast(prev, { id, message, type }));
    }, []);

    // No topo (abaixo do cabeçalho) no celular: a base da tela é da barra inferior, do botão
    // flutuante, do campo do chat e das barras de ação. No desktop, canto inferior direito.
    const viewport = (
        <div className="fixed z-[80] left-4 right-4 top-[calc(4rem+env(safe-area-inset-top))] md:left-auto md:top-auto md:bottom-4 max-h-[60dvh] overflow-y-auto flex flex-col items-stretch md:items-end gap-2 pb-1 pr-1 pointer-events-none">
            <div role="status" aria-live="polite" aria-atomic="false" className="contents">
                {toasts.filter((t) => t.type !== 'error').map((toast) => (
                    <ToastItem key={toast.id} toast={toast} onRemove={removeToast} />
                ))}
            </div>
            {toasts.filter((t) => t.type === 'error').map((toast) => (
                <ToastItem key={toast.id} toast={toast} onRemove={removeToast} />
            ))}
        </div>
    );

    return (
        <ToastContext.Provider value={{ addToast, removeToast }}>
            {children}
            {topDialog ? createPortal(viewport, topDialog) : viewport}
        </ToastContext.Provider>
    );
}

// eslint-disable-next-line react-refresh/only-export-components
export function useToast() {
    const context = useContext(ToastContext);
    if (context === undefined) {
        throw new Error('useToast must be used within a ToastProvider');
    }
    return context;
}
