import { lazy, useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { checkSession } from '../lib/authSession';
import { isStandalone } from '../lib/pwa';
import ErroDeVerificacao from './ErroDeVerificacao';

const Onboarding = lazy(() => import('../pages/Onboarding'));

/**
 * Raiz:
 * - Sessão válida -> painel do papel.
 * - App instalado (PWA standalone) sem sessão -> direto para `/login` (sem landing page web).
 * - Navegador web sem sessão -> landing page pública (`Onboarding`).
 */
export default function HomeRedirect() {
    const navigate = useNavigate();
    const standalone = isStandalone();
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
                if (session.user.user_metadata?.user_type === 'hire') navigate('/company/dashboard', { replace: true, state: { entrada: true } });
                else navigate('/dashboard', { replace: true });
            } else if (session.status === 'signed_out' && standalone) {
                navigate('/login', { replace: true });
            } else {
                setStatus(session.status);
            }
        });
        return () => { active = false; };
    }, [navigate, attempt, standalone]);

    useEffect(() => {
        if (status !== 'unavailable') return;
        window.addEventListener('online', retry);
        return () => window.removeEventListener('online', retry);
    }, [status, retry]);

    if (status === 'unavailable') return <ErroDeVerificacao onRetry={retry} />;
    if (status === 'checking' || (status === 'signed_out' && standalone)) {
        return (
            <div
                className="h-screen flex flex-col items-center justify-center gap-4 bg-white px-6"
                role="status"
            >
                <span className="sr-only">Carregando Workyn</span>
                <div className="flex items-center gap-3">
                    <img
                        src="/favicon.svg"
                        alt=""
                        width={52}
                        height={52}
                        className="w-13 h-13 border-2 border-black rounded-2xl shadow-brutal bg-white"
                    />
                    <span className="text-4xl font-black tracking-tight text-slate-950">Workyn.</span>
                </div>
                <div className="h-1.5 w-28 overflow-hidden rounded-full bg-slate-200">
                    <div className="h-full w-1/2 rounded-full bg-[#00A651] animate-pulse" />
                </div>
            </div>
        );
    }
    return <Onboarding />;
}
