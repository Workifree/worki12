import { Home, Briefcase, User, Zap, PlusCircle, Building2, MessageSquare, LogOut, Users, Contact, Inbox, FileText, HelpCircle, Receipt, BarChart3, Share2, Network, ChevronDown, BadgeCheck, CircleDashed } from 'lucide-react';
import { NavLink, useNavigate } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { useAuth } from '../contexts/AuthContext';
import { useToast } from '../contexts/ToastContext';
import { logError } from '../lib/logger';
import NotificationBell from './NotificationBell';
import { Button } from './ui';
import { useEffect, useState } from 'react';
import { getMyCompanies, pickCurrentCompany, setSelectedCompanyId, canSeeOrganization as podeVerOrganizacao } from '../services/companyScopeService';
import type { MyCompany } from '../types';

interface SidebarProps {
    type?: 'worker' | 'company';
}

export default function Sidebar({ type = 'worker' }: SidebarProps) {
    const [name, setName] = useState('');
    const [isVerified, setIsVerified] = useState(false);
    interface WorkerData {
        full_name: string;
        level?: number;
        xp?: number;
        avatar_url?: string;
        verified_identity?: boolean;
    }

    const [workerData, setWorkerData] = useState<WorkerData | null>(null);
    // F13 (R13) — seletor de unidade: só aparece quando a sessão opera mais de UMA empresa
    // (gerente de duas lojas, ou sócio navegando por unidade). Para 100% das contas de hoje
    // (uma linha), `myCompanies.length <= 1` e o seletor nunca renderiza.
    const [myCompanies, setMyCompanies] = useState<MyCompany[]>([]);
    const [currentCompanyId, setCurrentCompanyId] = useState<string | null>(null);
    const navigate = useNavigate();
    const { signOut } = useAuth();
    const { addToast } = useToast();
    const [loggingOut, setLoggingOut] = useState(false);

    // R4: fonte única de verdade (AuthContext.signOut) + try/catch + toast de erro +
    // estado de loading/disabled — nunca falha em silêncio.
    const handleLogout = async () => {
        if (loggingOut) return;
        setLoggingOut(true);
        try {
            await signOut();
            navigate('/login');
        } catch (error) {
            logError('Sidebar.handleLogout', error);
            addToast('Não foi possível sair. Tente novamente.', 'error');
        } finally {
            setLoggingOut(false);
        }
    };

    useEffect(() => {
        const fetchData = async () => {
            const { data: { user } } = await supabase.auth.getUser();
            if (!user) return;

            if (type === 'company') {
                // F13 (R11/R13) — `get_my_companies()` é o único resolvedor de escopo de empresa.
                // `.eq('id', user.id)` nunca casava para um gerente (sem linha própria em
                // `companies`), deixando o nome preso em "Carregando...". Resolve a lista inteira
                // aqui: também alimenta o seletor de unidade quando há mais de uma.
                try {
                    const companies = await getMyCompanies();
                    setMyCompanies(companies);
                    const current = pickCurrentCompany(companies);
                    if (current) {
                        setName(current.company_name ?? '');
                        setCurrentCompanyId(current.company_id);
                    }
                } catch (error) {
                    logError('Sidebar.fetchCompanyScope', error);
                }
                setIsVerified(!!user.email_confirmed_at);
            } else {
                // Fetch from unified 'workers' table
                const { data: worker } = await supabase
                    .from('workers')
                    .select('full_name, level, xp, avatar_url, verified_identity')
                    .eq('id', user.id)
                    .maybeSingle();

                if (worker) {
                    setName(worker.full_name);
                    setWorkerData(worker);
                }
            }
        };
        fetchData();
    }, [type]);

    // Nav push-first (pivô empresa-primeiro, jun/2026): worker não busca vagas —
    // recebe Convites e cuida das suas Empresas. "Buscar Vagas"/"Analytics"
    // saem do menu (Fase 2, ver ADR-20260630-pagamento-opcional-piloto), sem remover a rota.
    const workerNavItems = [
        { icon: Home, label: 'Início', path: '/dashboard' },
        // "Meus Turnos", nao "Convites": o rotulo descreve o DESTINO (a pagina se chama Meus
        // Turnos e guarda agendados/andamento/historico), nao o evento mais quente. Information
        // scent (Pirolli & Card): quem procura "meu turno de amanha" nao clicaria em "Convites".
        // A saliencia do convite continua no badge, no takeover e no hero do dashboard.
        { icon: Inbox, label: 'Meus Turnos', path: '/my-jobs' },
        { icon: Contact, label: 'Minhas Empresas', path: '/carteira' },
        { icon: Receipt, label: 'Meus Recebimentos', path: '/recebimentos' },
        { icon: Share2, label: 'Quem Te Indicou', path: '/indicacoes' },
        { icon: MessageSquare, label: 'Mensagens', path: '/messages' },
        { icon: User, label: 'Meu Perfil', path: '/profile' },
    ];

    const currentCompany = myCompanies.find(c => c.company_id === currentCompanyId) ?? null;
    // R16: só sócio/operador (organization_members ativo) vê a visão consolidada da organização.
    const canSeeOrganization = podeVerOrganizacao(currentCompany);

    const companyNavItems = [
        { icon: Home, label: 'Dashboard', path: '/company/dashboard' },
        { icon: Users, label: 'Meu Elenco', path: '/company/team' },
        { icon: PlusCircle, label: 'Criar Turno', path: '/company/create' },
        { icon: Briefcase, label: 'Meus Turnos', path: '/company/jobs' },
        { icon: Share2, label: 'Indicações', path: '/company/indicacoes' },
        { icon: MessageSquare, label: 'Mensagens', path: '/company/messages' },
        { icon: FileText, label: 'Pagamentos', path: '/company/relatorio' },
        { icon: BarChart3, label: 'Operação', path: '/company/operacao' },
        ...(canSeeOrganization ? [{ icon: Network, label: 'Organização', path: '/company/organization' }] : []),
        { icon: User, label: 'Perfil Empresa', path: '/company/profile' },
    ];

    const navItems = type === 'company' ? companyNavItems : workerNavItems;
    const isCompany = type === 'company';

    // F13 (R13) — troca de unidade: grava a seleção (companyScopeService, singleton + sessionStorage)
    // e recarrega a página. Um reload total é a forma mais simples e segura de garantir que TODA
    // tela já montada (que resolve `company_id` no próprio `useEffect` de montagem) releia o dado
    // da unidade nova, sem precisar plumbar um contexto reativo por todas as páginas de empresa.
    const handleSwitchCompany = (companyId: string) => {
        if (companyId === currentCompanyId) return;
        setSelectedCompanyId(companyId);
        window.location.assign('/company/dashboard');
    };

    // Acabamento refinado (11/2026): moldura brutalista (borda 2px + sombra offset) mantida,
    // mas estática (sem "pulo" no hover do menu inteiro) e com tipografia contida.
    const activeNavClass = isCompany
        ? 'bg-black text-white border-black shadow-[3px_3px_0px_0px_rgba(0,166,81,1)]'
        : 'bg-primary text-white border-black shadow-[3px_3px_0px_0px_rgba(0,0,0,1)]';

    return (
        <aside aria-label="Menu lateral" className="hidden md:flex flex-col w-72 h-[calc(100vh-32px)] m-4 sticky top-4
                      bg-white border-2 border-black rounded-2xl shadow-[6px_6px_0px_0px_rgba(0,0,0,1)]
                      overflow-hidden z-50">

            {/* Logo */}
            <div className={`px-6 py-5 border-b-2 border-black ${isCompany ? 'bg-white text-black' : 'bg-black text-white'}`}>
                <div className="flex items-center justify-between gap-2">
                    <div className="flex items-center gap-2.5 min-w-0">
                        <div className={`w-8 h-8 shrink-0 rounded-full border-2 flex items-center justify-center ${isCompany ? 'bg-black text-white border-black' : 'bg-primary text-black border-white'}`}>
                            <span className="font-bold text-xs">W.</span>
                        </div>
                        <p className="text-2xl font-bold tracking-tight">Worki</p>
                        {isCompany && <span className="text-[10px] font-semibold uppercase tracking-wide bg-gray-100 text-gray-700 px-2 py-0.5 rounded-full border border-black">Empresa</span>}
                    </div>
                    <NotificationBell className={isCompany ? "text-gray-500 hover:bg-gray-100" : "text-gray-400 hover:bg-white/10"} />
                </div>
            </div>

            {/* Seletor de unidade (F13 R13) — só aparece quando a sessão opera mais de uma
                empresa (gerente de duas lojas, ou sócio navegando por unidade). Zero mudança
                visual para as contas de hoje (uma unidade). */}
            {isCompany && myCompanies.length > 1 && (
                <div className="px-4 pt-4">
                    <label htmlFor="sidebar-company-switch" className="sr-only">Trocar de unidade</label>
                    <div className="relative">
                        <select
                            id="sidebar-company-switch"
                            value={currentCompanyId ?? ''}
                            onChange={(e) => handleSwitchCompany(e.target.value)}
                            className="w-full h-11 appearance-none bg-gray-50 border-2 border-black rounded-xl pl-3 pr-9 text-sm font-semibold text-gray-900 cursor-pointer focus:outline-none focus:ring-2 focus:ring-primary"
                        >
                            {myCompanies.map((c) => (
                                <option key={c.company_id} value={c.company_id}>
                                    {c.company_name || 'Unidade sem nome'}
                                </option>
                            ))}
                        </select>
                        <ChevronDown size={16} aria-hidden="true" className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-gray-500" />
                    </div>
                </div>
            )}

            {/* Navigation */}
            <nav className="flex-1 px-4 py-5 flex flex-col gap-1.5 overflow-y-auto">
                {navItems.map((item) => (
                    <NavLink
                        key={item.path}
                        to={item.path}
                        className={({ isActive }) => `
              flex items-center gap-3 h-11 px-4 shrink-0 rounded-xl border-2 text-sm font-semibold
              transition-colors duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-black focus-visible:ring-offset-2
              ${isActive
                                ? activeNavClass
                                : 'border-transparent text-gray-600 hover:bg-gray-100 hover:text-black'}
            `}
                    >
                        <item.icon size={18} strokeWidth={2} aria-hidden="true" className="shrink-0" />
                        <span className="truncate">{item.label}</span>
                    </NavLink>
                ))}
            </nav>

            {/* Conta: identidade + sair */}
            <div className="p-4 border-t-2 border-black bg-gray-50 flex flex-col gap-3">
                <div className="flex items-center gap-3 p-3 rounded-xl border-2 border-black bg-white">
                    <div className="relative shrink-0">
                        <div className="w-11 h-11 rounded-xl bg-gray-100 border-2 border-black flex items-center justify-center overflow-hidden">
                            {isCompany ? (
                                <Building2 size={22} aria-hidden="true" />
                            ) : (
                                workerData?.avatar_url ? <img src={workerData.avatar_url} alt="" className="w-full h-full object-cover" /> : <User size={22} aria-hidden="true" />
                            )}
                        </div>
                        {!isCompany && (
                            <div className="absolute -top-2 -right-2 bg-primary text-white text-[10px] font-bold px-1.5 py-0.5 rounded-full border border-black leading-none">
                                {`LVL ${workerData?.level || 1}`}
                            </div>
                        )}
                    </div>
                    <div className="flex flex-col min-w-0 gap-0.5">
                        <span className="text-sm font-semibold text-accent truncate">{name || (isCompany ? 'Carregando...' : '...')}</span>
                        {isCompany ? (
                            <span className={`inline-flex items-center gap-1 text-xs font-medium ${isVerified ? 'text-blue-700' : 'text-gray-500'}`}>
                                {isVerified
                                    ? <BadgeCheck size={14} aria-hidden="true" className="text-blue-600 shrink-0" />
                                    : <CircleDashed size={14} aria-hidden="true" className="text-gray-400 shrink-0" />}
                                {isVerified ? 'Verificado' : 'Não verificado'}
                            </span>
                        ) : (
                            <span className="inline-flex items-center gap-1 text-xs font-medium text-gray-600">
                                <Zap size={12} aria-hidden="true" className="text-primary fill-primary shrink-0" />
                                {`${workerData?.xp || 0} XP`}
                            </span>
                        )}
                    </div>
                </div>

                <Button
                    variant="ghost"
                    fullWidth
                    onClick={handleLogout}
                    loading={loggingOut}
                    iconLeft={<LogOut size={16} aria-hidden="true" />}
                    className="!text-red-600 enabled:hover:bg-red-50"
                >
                    {loggingOut ? 'Saindo...' : 'Sair'}
                </Button>

                <NavLink
                    to="/ajuda"
                    className="flex items-center justify-center gap-1.5 w-full min-h-11 py-1 text-xs font-medium text-gray-500 hover:text-black transition-colors"
                >
                    <HelpCircle size={14} aria-hidden="true" />
                    Ajuda
                </NavLink>
            </div>
        </aside>
    );
}
