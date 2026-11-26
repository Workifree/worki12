import React from 'react';
import { captureException } from '../lib/logger';
import { ErrorState } from './ui';

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
        captureException(error, { extra: { componentStack: errorInfo.componentStack } });
    }

    render() {
        if (this.state.hasError) {
            return (
                <main className="min-h-screen bg-canvas flex items-center justify-center font-sans">
                    <ErrorState
                        className="max-w-md w-full"
                        title="Algo deu errado"
                        message="Ocorreu um erro inesperado. Tente de novo."
                        onRetry={() => window.location.reload()}
                    />
                </main>
            );
        }

        return this.props.children;
    }
}
