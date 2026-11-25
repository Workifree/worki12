import { useEffect, useState } from 'react';
import { Navigate, Outlet, useLocation } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { logError } from '../lib/logger';
import { useToast } from '../contexts/ToastContext';
import { Loader2 } from 'lucide-react';
import TosGateModal from './TosGateModal';
import AguardandoConfirmacao from './AguardandoConfirmacao';
import AcessoEncerrado from './AcessoEncerrado';
import { hasTeamMemberHint, readPendingTeamInviteToken } from '../lib/teamInviteToken';
import ErroDeEmpresa from './ErroDeEmpresa';
import { getMyCompanies, pickCurrentCompany, isUnconfirmedEncarregado } from '../services/companyScopeService';
import type { CompanyRole } from '../types';

/**
 * Isolamento de papel — avisa uma vez (`useEffect` com dep no destino, não a cada render) e
 * navega. Componente próprio em vez de `addToast` direto no corpo de `ProtectedRoute`: o alvo é
 * recomputado a cada render (nunca guardado em state, ver comentário acima), então chamar
 * `addToast` ali disparava o toast em loop enquanto a navegação não completava.
 */
function RoleRedirect({ to }: { to: string }) {
    const { addToast } = useToast();
    useEffect(() => {
        addToast('Você não tem permissão para acessar esta página.', 'error');
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [to]);
    return <Navigate to={to} replace />;
}

export default function ProtectedRoute() {
    const [loading, setLoading] = useState(true);
    const [user, setUser] = useState<{ id: string; user_metadata?: { user_type?: string } } | null>(null);
    const [onboardingChecked, setOnboardingChecked] = useState(false);
    const [onboardingRedirect, setOnboardingRedirect] = useState<string | null>(null);
    const [tosAccepted, setTosAccepted] = useState<boolean | null>(null);
    const [detectedRole, setDetectedRole] = useState<'worker' | 'company'>('worker');
    const [companyRole, setCompanyRole] = useState<CompanyRole | null>(null);
    // R22: Encarregado que entrou mas o Gestor ainda não confirmou — só vê a tela de espera.
    const [awaitingConfirmation, setAwaitingConfirmation] = useState(false);
    // Quem era da equipe e ficou sem nenhuma empresa (removido/revogado): tela neutra, nunca onboarding de CNPJ.
    const [accessEnded, setAccessEnded] = useState(false);
    // `get_my_companies` falhou: não sabemos se há empresa — mostra erro, nunca decide por ausência.
    const [scopeError, setScopeError] = useState(false);
    const location = useLocation();

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
                    // Atalho anti-loop do onboarding. Única exceção: Encarregado não confirmado não
                    // pode "escapar" da tela de espera por esta rota (R22) — confere o papel antes.
                    try {
                        const atual = pickCurrentCompany(await getMyCompanies());
                        if (atual) {
                            setCompanyRole(atual.role);
                            setAwaitingConfirmation(isUnconfirmedEncarregado(atual));
                        }
                    } catch (error) {
                        // Sem saber se esta conta já tem empresa, o formulário de onboarding NÃO abre
                        // (ele grava por cima da linha existente): tela de erro com "Tentar de novo".
                        logError('Erro ao verificar a empresa no onboarding', error);
                        setScopeError(true);
                    }
                    setOnboardingChecked(true);
                    setTosAccepted(true);
                    return;
                }

                try {
                    const companies = await getMyCompanies();
                    const current = pickCurrentCompany(companies);

                    if (!current) {
                        const tokenPendente = readPendingTeamInviteToken();
                        if (hasTeamMemberHint(authUser.id)) {
                            // Era da equipe e ficou sem empresa: acesso encerrado, não onboarding de CNPJ.
                            setAccessEnded(true);
                        } else if (tokenPendente) {
                            // Está no meio do convite de equipe: volta para terminá-lo.
                            setOnboardingRedirect(`/convite-equipe/${tokenPendente}`);
                        } else {
                            setOnboardingRedirect('/company/onboarding');
                        }
                        setTosAccepted(true);
                    } else {
                        setCompanyRole(current.role);
                        setAwaitingConfirmation(isUnconfirmedEncarregado(current));
                        if (current.role === 'encarregado') {
                            // Encarregado não tem onboarding de CNPJ (a empresa não é dele) e aceita os
                            // Termos por pessoa no próprio convite; o TosGate de empresa não o alcança.
                            setOnboardingRedirect(null);
                            setTosAccepted(true);
                        } else {
                            setOnboardingRedirect(current.onboarding_completed ? null : '/company/onboarding');
                            setTosAccepted(current.accepted_tos === true);
                        }
                    }
                } catch (error) {
                    // FALHA ao resolver a empresa não é "não tem empresa": nunca vai ao onboarding (que
                    // gravaria por cima de uma empresa já cadastrada) nem finge tela de espera para o
                    // dono. Onboarding só com resposta VÁLIDA sem empresa.
                    logError('Erro ao verificar onboarding', error);
                    setScopeError(true);
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

    if (scopeError) return <ErroDeEmpresa />;

    // R22: Encarregado não confirmado não vê nada além da tela de espera (nem rota, nem menu).
    if (awaitingConfirmation) return <AguardandoConfirmacao />;
    if (accessEnded) return <AcessoEncerrado />;

    // Redirect to onboarding if not completed, but only if not already on the onboarding page
    if (onboardingRedirect && location.pathname !== onboardingRedirect) {
        return <Navigate to={onboardingRedirect} replace />;
    }

    // Role isolation: prevent wrong role from accessing wrong routes. Derivado PURAMENTE do
    // pathname corrente a cada render (nunca guardado em state) — como este componente
    // permanece montado ao navegar entre rotas irmãs (mesmo <Route element={<ProtectedRoute/>}>
    // envolve worker e company), um `roleRedirect` gravado em state travaria a sessão
    // navegando para o MESMO destino para sempre, mesmo depois de chegar lá.
    const userType = user.user_metadata?.user_type;
    const pathname = location.pathname;
    const workerOnlyPaths = ['/dashboard', '/my-jobs', '/carteira', '/messages', '/profile', '/notifications', '/empresa', '/recebimentos'];

    let roleRedirectTarget: string | null = null;
    if (userType === 'work' && pathname.startsWith('/company/')) {
        roleRedirectTarget = '/dashboard';
    } else if (userType === 'hire' && workerOnlyPaths.some(p => pathname === p || pathname.startsWith(p + '/'))) {
        roleRedirectTarget = '/company/dashboard';
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
        roleRedirectTarget = '/company/dashboard';
    } else if (
        userType === 'hire'
        && companyRole === 'encarregado'
        && (
            pathname.startsWith('/company/configuracoes')
            // Onboarding de CNPJ e perfil da empresa também são do Gestor: a empresa não é dele.
            || pathname === '/company/onboarding'
            || pathname === '/company/profile'
            || pathname.startsWith('/company/profile/')
        )
    ) {
        // Equipe/Configurações/perfil da empresa são do Gestor. Encarregado nunca administra pessoas.
        roleRedirectTarget = '/company/dashboard';
    }

    if (roleRedirectTarget) return <RoleRedirect to={roleRedirectTarget} />;

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
