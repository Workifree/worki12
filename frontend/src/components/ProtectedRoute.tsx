import { useEffect, useState } from 'react';
import { Navigate, Outlet, useLocation } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { logError } from '../lib/logger';
import { useToast } from '../contexts/ToastContext';
import { Loader2 } from 'lucide-react';
import TosGateModal from './TosGateModal';
import { getMyCompanies, pickCurrentCompany } from '../services/companyScopeService';
import type { CompanyRole } from '../types';

export default function ProtectedRoute() {
    const [loading, setLoading] = useState(true);
    const [user, setUser] = useState<{ id: string; user_metadata?: { user_type?: string } } | null>(null);
    const [onboardingChecked, setOnboardingChecked] = useState(false);
    const [onboardingRedirect, setOnboardingRedirect] = useState<string | null>(null);
    const [tosAccepted, setTosAccepted] = useState<boolean | null>(null);
    const [detectedRole, setDetectedRole] = useState<'worker' | 'company'>('worker');
    const [companyRole, setCompanyRole] = useState<CompanyRole | null>(null);
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
                await checkOnboardingAndTos(currentUser);
            }
        };

        // F13 (R11) — a resolução de "esta sessão é company e está pronta?" (onboarding + TOS)
        // NÃO pode ser `.eq('id', authUser.id).single()`: um gerente ativo (`company_members`)
        // não tem linha própria em `companies` (a casca é apagada no aceite do convite,
        // `accept_manager_invite`), então essa query sempre falha (PGRST116) e o gerente ficava
        // preso num loop de onboarding permanente — o achado mais crítico da spec (A7).
        // `get_my_companies()` (ddl-aprovado.md §7) é o único resolvedor de escopo de empresa do
        // frontend: zero linhas → onboarding; uma ou mais → usa `onboarding_completed`/
        // `accepted_tos` da linha corrente (role='owner' primeiro, senão a primeira).
        const checkOnboardingAndTos = async (authUser: { id: string; user_metadata?: { user_type?: string } }) => {
            const pathname = location.pathname;
            const userType = authUser.user_metadata?.user_type;

            if (userType === 'work') {
                if (pathname === '/worker/onboarding') {
                    setOnboardingChecked(true);
                    setTosAccepted(true);
                    return;
                }
                try {
                    const { data } = await supabase
                        .from('workers')
                        .select('onboarding_completed')
                        .eq('id', authUser.id)
                        .single();

                    if (data?.onboarding_completed !== true) {
                        setOnboardingRedirect('/worker/onboarding');
                    }
                } catch (error) {
                    logError('Erro ao verificar onboarding', error);
                    setOnboardingRedirect('/worker/onboarding');
                }

                const { data: workerData } = await supabase
                    .from('workers')
                    .select('accepted_tos')
                    .eq('id', authUser.id)
                    .single();

                setTosAccepted(workerData ? workerData.accepted_tos === true : true);
                setDetectedRole('worker');
                setOnboardingChecked(true);
                return;
            }

            if (userType === 'hire') {
                if (pathname === '/company/onboarding') {
                    setOnboardingChecked(true);
                    setTosAccepted(true);
                    return;
                }

                try {
                    const companies = await getMyCompanies();
                    const current = pickCurrentCompany(companies);

                    if (!current) {
                        setOnboardingRedirect('/company/onboarding');
                        setTosAccepted(true);
                    } else {
                        setOnboardingRedirect(current.onboarding_completed ? null : '/company/onboarding');
                        setTosAccepted(current.accepted_tos === true);
                        setCompanyRole(current.role);
                    }
                } catch (error) {
                    logError('Erro ao verificar onboarding', error);
                    setOnboardingRedirect('/company/onboarding');
                    setTosAccepted(true);
                }

                setDetectedRole('company');
                setOnboardingChecked(true);
                return;
            }

            // user_type desconhecido (sessão em transição) — não bloqueia, mas também não
            // afirma TOS aceito por engano.
            setTosAccepted(true);
            setOnboardingChecked(true);
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
        const workerOnlyPaths = ['/dashboard', '/my-jobs', '/carteira', '/messages', '/profile', '/notifications', '/empresa', '/recebimentos'];

        if (userType === 'work' && pathname.startsWith('/company/')) {
            addToast('Você não tem permissão para acessar esta página.', 'error');
            setRoleRedirect('/dashboard');
        } else if (userType === 'hire' && workerOnlyPaths.some(p => pathname === p || pathname.startsWith(p + '/'))) {
            addToast('Você não tem permissão para acessar esta página.', 'error');
            setRoleRedirect('/company/dashboard');
        } else if (
            userType === 'hire'
            && pathname.startsWith('/company/organization')
            && companyRole !== null
            && companyRole !== 'owner'
            && companyRole !== 'operator'
        ) {
            // R16: /company/organization só é acessível a sócio/operador (organization_members
            // ativo) — mesma técnica do bloqueio worker⇎company acima. Gerente comum (role
            // 'manager') não vê a visão consolidada da organização (fora do escopo dele, R14).
            addToast('Apenas sócio/operador pode acessar a Organização.', 'error');
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
