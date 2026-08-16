import { useEffect, useState } from 'react';
import { Navigate, Outlet, useLocation } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { logError } from '../lib/logger';
import { useToast } from '../contexts/ToastContext';
import { Loader2 } from 'lucide-react';
import TosGateModal from './TosGateModal';

export default function ProtectedRoute() {
    const [loading, setLoading] = useState(true);
    const [user, setUser] = useState<{ id: string; user_metadata?: { user_type?: string } } | null>(null);
    const [onboardingChecked, setOnboardingChecked] = useState(false);
    const [onboardingRedirect, setOnboardingRedirect] = useState<string | null>(null);
    const [tosAccepted, setTosAccepted] = useState<boolean | null>(null);
    const [detectedRole, setDetectedRole] = useState<'worker' | 'company'>('worker');
    const [roleRedirect, setRoleRedirect] = useState<string | null>(null);
    const location = useLocation();
    const { addToast } = useToast();

    useEffect(() => {
        const checkAuth = async () => {
            const { data: { session } } = await supabase.auth.getSession();
            const currentUser = session?.user ?? null;
            setUser(currentUser as { id: string; user_metadata?: { user_type?: string } } | null);
            setLoading(false);

            if (currentUser) {
                await checkOnboarding(currentUser);
                await checkTos(currentUser);
            }
        };

        const checkOnboarding = async (authUser: { id: string; user_metadata?: { user_type?: string } }) => {
            const pathname = location.pathname;

            if (pathname === '/worker/onboarding' || pathname === '/company/onboarding') {
                setOnboardingChecked(true);
                return;
            }

            const userType = authUser.user_metadata?.user_type;

            try {
                let data = null;
                if (userType === 'work') {
                    const result = await supabase
                        .from('workers')
                        .select('onboarding_completed')
                        .eq('id', authUser.id)
                        .single();
                    data = result.data;
                } else if (userType === 'hire') {
                    const result = await supabase
                        .from('companies')
                        .select('onboarding_completed')
                        .eq('id', authUser.id)
                        .single();
                    data = result.data;
                }

                if (data?.onboarding_completed !== true) {
                    setOnboardingRedirect(
                        userType === 'work' ? '/worker/onboarding' : '/company/onboarding'
                    );
                }
            } catch (error) {
                logError('Erro ao verificar onboarding', error);
                if (userType === 'work') {
                    setOnboardingRedirect('/worker/onboarding');
                } else if (userType === 'hire') {
                    setOnboardingRedirect('/company/onboarding');
                }
            }

            setOnboardingChecked(true);
        };

        const checkTos = async (authUser: { id: string; user_metadata?: { user_type?: string } }) => {
            const userType = authUser.user_metadata?.user_type;

            // Tenta workers primeiro
            if (userType === 'work') {
                const { data: workerData } = await supabase
                    .from('workers')
                    .select('accepted_tos')
                    .eq('id', authUser.id)
                    .single();

                if (workerData) {
                    setTosAccepted(workerData.accepted_tos === true);
                    setDetectedRole('worker');
                    return;
                }
            }

            // Tenta companies
            if (userType === 'hire') {
                const { data: companyData } = await supabase
                    .from('companies')
                    .select('accepted_tos')
                    .eq('id', authUser.id)
                    .single();

                if (companyData) {
                    setTosAccepted(companyData.accepted_tos === true);
                    setDetectedRole('company');
                    return;
                }
            }

            // Usuário sem perfil ainda (em onboarding) — não exibir gate de TOS
            setTosAccepted(true);
        };

        checkAuth();

        const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
            setUser(session?.user as { id: string; user_metadata?: { user_type?: string } } | null);
            if (!session?.user) {
                setTosAccepted(null);
            }
            setLoading(false);
        });

        return () => subscription.unsubscribe();
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    if (loading || (user && !onboardingChecked) || (user && tosAccepted === null)) {
        return (
            <div className="flex h-screen w-full items-center justify-center bg-gray-50">
                <Loader2 className="animate-spin text-primary" size={48} />
            </div>
        );
    }

    if (!user) return <Navigate to="/" replace />;

    // Redirect to onboarding if not completed, but only if not already on the onboarding page
    if (onboardingRedirect && location.pathname !== onboardingRedirect) {
        return <Navigate to={onboardingRedirect} replace />;
    }

    // Role isolation: prevent wrong role from accessing wrong routes
    if (user && !roleRedirect) {
        const userType = user.user_metadata?.user_type;
        const pathname = location.pathname;
        const workerOnlyPaths = ['/dashboard', '/my-jobs', '/carteira', '/messages', '/profile', '/notifications', '/empresa'];

        if (userType === 'work' && pathname.startsWith('/company/')) {
            addToast('Você não tem permissão para acessar esta página.', 'error');
            setRoleRedirect('/dashboard');
        } else if (userType === 'hire' && workerOnlyPaths.some(p => pathname === p || pathname.startsWith(p + '/'))) {
            addToast('Você não tem permissão para acessar esta página.', 'error');
            setRoleRedirect('/company/dashboard');
        }
    }

    if (roleRedirect) return <Navigate to={roleRedirect} replace />;

    // Pular gate de TOS durante onboarding para nao confundir o usuario
    const isOnboardingRoute = location.pathname.includes('/onboarding');

    if (tosAccepted === false && !isOnboardingRoute) return (
        <>
            <TosGateModal userRole={detectedRole} onAccepted={() => setTosAccepted(true)} />
            <Outlet />
        </>
    );

    return <Outlet />;
}
