import { lazy, useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { checkSession } from '../lib/authSession';
import ErroDeVerificacao from './ErroDeVerificacao';

const Onboarding = lazy(() => import('../pages/Onboarding'));

/** Raiz: sessão válida vai ao painel do papel; só `signed_out` mostra a página pública. */
export default function HomeRedirect() {
    const navigate = useNavigate();
    const [status, setStatus] = useState<'checking' | 'signed_out' | 'unavailable'>('checking');
    const [attempt, setAttempt] = useState(0);

    const retry = useCallback(() => {
        setStatus('checking');
        setAttempt((n) => n + 1);
    }, []);

    useEffect(() => {
        let active = true;
        void checkSession().then((session) => {
            if (!active) return;
            if (session.status === 'ok') {
                navigate(session.user.user_metadata?.user_type === 'hire' ? '/company/dashboard' : '/dashboard');
            } else {
                setStatus(session.status);
            }
        });
        return () => { active = false; };
    }, [navigate, attempt]);

    useEffect(() => {
        if (status !== 'unavailable') return;
        window.addEventListener('online', retry);
        return () => window.removeEventListener('online', retry);
    }, [status, retry]);

    if (status === 'unavailable') return <ErroDeVerificacao onRetry={retry} />;
    if (status === 'checking') {
        return <div className="h-screen flex items-center justify-center bg-[#F4F4F0] animate-pulse"><div className="h-12 w-32 bg-gray-200 rounded-xl" /></div>;
    }
    return <Onboarding />;
}
