import React from 'react';
import { AlertTriangle, RefreshCw } from 'lucide-react';
import * as Sentry from '@sentry/react';
import { Button } from './ui';

interface Props {
    children: React.ReactNode;
}

interface State {
    hasError: boolean;
    error: Error | null;
}

export default class ErrorBoundary extends React.Component<Props, State> {
    constructor(props: Props) {
        super(props);
        this.state = { hasError: false, error: null };
    }

    static getDerivedStateFromError(error: Error): State {
        return { hasError: true, error };
    }

    componentDidCatch(error: Error, errorInfo: React.ErrorInfo) {
        console.error('ErrorBoundary caught:', error, errorInfo);
        Sentry.captureException(error, { extra: { componentStack: errorInfo.componentStack } });
    }

    render() {
        if (this.state.hasError) {
            return (
                <div className="min-h-screen bg-[#F4F4F0] flex items-center justify-center p-6 font-sans">
                    <div className="bg-white border-2 border-black rounded-2xl p-6 sm:p-8 max-w-md w-full text-center shadow-[6px_6px_0px_0px_rgba(0,0,0,1)]">
                        <AlertTriangle size={40} className="mx-auto mb-4 text-red-500" />
                        <h2 className="text-2xl font-bold tracking-tight mb-2">Algo deu errado</h2>
                        <p className="text-sm sm:text-base text-gray-600 mb-6">
                            Ocorreu um erro inesperado. Tente recarregar a página.
                        </p>
                        <Button
                            variant="dark"
                            size="lg"
                            onClick={() => window.location.reload()}
                            iconLeft={<RefreshCw size={18} />}
                        >
                            Recarregar
                        </Button>
                    </div>
                </div>
            );
        }

        return this.props.children;
    }
}
