import React, { createContext, useContext, useState, useCallback } from 'react';
import { X, CheckCircle, AlertCircle, Info } from 'lucide-react';

export type ToastType = 'success' | 'error' | 'info';

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

export function ToastProvider({ children }: { children: React.ReactNode }) {
    const [toasts, setToasts] = useState<Toast[]>([]);

    const removeToast = useCallback((id: string) => {
        setToasts((prev) => prev.filter((toast) => toast.id !== id));
    }, []);

    const addToast = useCallback((message: string, type: ToastType = 'info') => {
        const id = Math.random().toString(36).substring(7);
        setToasts((prev) => [...prev, { id, message, type }]);

        // Auto remove after 3 seconds
        setTimeout(() => {
            removeToast(id);
        }, 3000);
    }, [removeToast]);

    return (
        <ToastContext.Provider value={{ addToast, removeToast }}>
            {children}
            {/* z-[80] acima de modais (z-[70]) e da BottomNav (z-50); no mobile sobe acima da BottomNav. */}
            <div
                role="status"
                aria-live="polite"
                className="fixed z-[80] left-4 right-4 md:left-auto md:right-4 bottom-[calc(5rem+env(safe-area-inset-bottom))] md:bottom-4 flex flex-col items-stretch md:items-end gap-2 pointer-events-none"
            >
                {toasts.map((toast) => (
                    <div
                        key={toast.id}
                        role={toast.type === 'error' ? 'alert' : undefined}
                        className={`
              pointer-events-auto flex items-center gap-3 px-4 py-3 rounded-xl border-2 shadow-[3px_3px_0px_0px_rgba(0,0,0,1)] animate-in slide-in-from-right-full duration-300
              ${toast.type === 'success' ? 'bg-green-50 border-black text-green-900' : ''}
              ${toast.type === 'error' ? 'bg-red-50 border-black text-red-900' : ''}
              ${toast.type === 'info' ? 'bg-blue-50 border-black text-blue-900' : ''}
            `}
                    >
                        {toast.type === 'success' && <CheckCircle size={20} className="shrink-0 text-green-600" />}
                        {toast.type === 'error' && <AlertCircle size={20} className="shrink-0 text-red-600" />}
                        {toast.type === 'info' && <Info size={20} className="shrink-0 text-blue-600" />}

                        <p className="font-bold text-sm flex-1 min-w-0">{toast.message}</p>

                        <button
                            type="button"
                            onClick={() => removeToast(toast.id)}
                            aria-label="Fechar aviso"
                            className="-my-2 -mr-2 ml-1 min-h-11 min-w-11 inline-flex items-center justify-center flex-shrink-0 hover:bg-black/5 rounded-full transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-black"
                        >
                            <X size={16} />
                        </button>
                    </div>
                ))}
            </div>
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
