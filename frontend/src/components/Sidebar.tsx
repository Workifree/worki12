import { Home, Briefcase, User, Zap, PlusCircle, Building2, MessageSquare, LogOut, Users, Contact, Inbox, Loader2, FileText, HelpCircle, Receipt, BarChart3, Share2, Network, ChevronDown } from 'lucide-react';
import { NavLink, useNavigate } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { useAuth } from '../contexts/AuthContext';
import { useToast } from '../contexts/ToastContext';
import { logError } from '../lib/logger';
import NotificationBell from './NotificationBell';
import { useEffect, useState } from 'react';
import { getMyCompanies, pickCurrentCompany, setSelectedCompanyId } from '../services/companyScopeService';
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
    // recebe Convites e cuida da Carteira de Clientes. "Buscar Vagas"/"Analytics"
    // saem do menu (Fase 2, ver ADR-20260630-pagamento-opcional-piloto), sem remover a rota.
    const workerNavItems = [
        { icon: Home, label: 'Início', path: '/dashboard' },
        { icon: Inbox, label: 'Convites', path: '/my-jobs' },
        { icon: Contact, label: 'Carteira de Clientes', path: '/carteira' },
        { icon: Receipt, label: 'Meus Recebimentos', path: '/recebimentos' },
        { icon: Share2, label: 'Quem Te Indicou', path: '/indicacoes' },
        { icon: MessageSquare, label: 'Mensagens', path: '/messages' },
        { icon: User, label: 'Meu Perfil', path: '/profile' },
    ];

    const currentCompany = myCompanies.find(c => c.company_id === currentCompanyId) ?? null;
    // R16: só sócio/operador (organization_members ativo) vê a visão consolidada da organização.
    const canSeeOrganization = currentCompany?.role === 'owner' || currentCompany?.role === 'operator';

    const companyNavItems = [
        { icon: Home, label: 'Dashboard', path: '/company/dashboard' },
        { icon: Users, label: 'Meu Elenco', path: '/company/team' },
        { icon: PlusCircle, label: 'Criar Turno', path: '/company/create' },
        { icon: Briefcase, label: 'Meus Turnos', path: '/company/jobs' },
        { icon: Share2, label: 'Indicações', path: '/company/indicacoes' },
        { icon: MessageSquare, label: 'Mensagens', path: '/company/messages' },
        { icon: FileText, label: 'Relatório', path: '/company/relatorio' },
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

    return (
        <aside aria-label="Menu lateral" className="hidden md:flex flex-col w-72 h-[calc(100vh-32px)] m-4 sticky top-4 
                      bg-white border-2 border-black rounded-2xl shadow-[8px_8px_0px_0px_rgba(0,0,0,1)] 
                      overflow-hidden z-50 transition-all hover:translate-y-[-2px] hover:shadow-[10px_10px_0px_0px_rgba(0,166,81,1)]">

            {/* Logo */}
            <div className={`p-8 border-b-2 border-black ${isCompany ? 'bg-white' : 'bg-black'} ${isCompany ? 'text-black' : 'text-white'}`}>
                <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                        <div className={`w-8 h-8 rounded-full border-2 border-black flex items-center justify-center ${isCompany ? 'bg-black text-white' : 'bg-primary text-black border-white'}`}>
                            <span className="font-black text-sm">W.</span>
                        </div>
                        <h1 className="text-3xl font-black tracking-tighter">Worki.</h1>
                        {isCompany && <span className="text-[10px] font-bold uppercase bg-gray-200 px-1.5 py-0.5 rounded border border-black">Empresa</span>}
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
                            className="w-full appearance-none bg-gray-50 border-2 border-black rounded-xl pl-3 pr-9 py-2.5 text-xs font-black uppercase tracking-wide text-gray-900 cursor-pointer focus:outline-none focus:ring-2 focus:ring-primary"
                        >
                            {myCompanies.map((c) => (
                                <option key={c.company_id} value={c.company_id}>
                                    {c.company_name || 'Unidade sem nome'}
                                </option>
                            ))}
                        </select>
                        <ChevronDown size={16} className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-gray-500" />
                    </div>
                </div>
            )}

            {/* Navigation */}
            <nav className="flex-1 px-4 py-8 flex flex-col gap-3 overflow-y-auto">
                {navItems.map((item) => (
                    <NavLink
                        key={item.path}
                        to={item.path}
                        className={({ isActive }) => `
              flex items-center gap-4 px-6 py-4 rounded-xl transition-all duration-200 font-bold uppercase text-sm border-2
              ${isActive
                                ? (isCompany ? 'bg-black text-white border-black shadow-[4px_4px_0px_0px_rgba(0,166,81,1)] translate-x-1' : 'bg-primary text-white border-black shadow-[4px_4px_0px_0px_rgba(0,0,0,1)] translate-x-1')
                                : 'bg-transparent text-gray-500 border-transparent hover:bg-gray-100 hover:border-black hover:text-black'}
            `}
                    >
                        <item.icon size={20} strokeWidth={3} />
                        {item.label}
                    </NavLink>
                ))}
            </nav>

            {/* User Details (Hooked Investment) */}
            <div className="p-6 border-t-2 border-black bg-gray-50 flex flex-col gap-4">
                <div className={`flex items-center gap-4 p-4 rounded-xl border-2 border-black bg-white shadow-[4px_4px_0px_0px_rgba(0,0,0,0.1)] cursor-pointer transition-all ${isCompany ? 'hover:shadow-[4px_4px_0px_0px_rgba(33,150,243,1)]' : 'hover:shadow-[4px_4px_0px_0px_rgba(0,166,81,1)]'}`}>
                    <div className="relative">
                        <div className="w-12 h-12 rounded-xl bg-gray-200 border-2 border-black flex items-center justify-center overflow-hidden">
                            {isCompany ? (
                                <Building2 size={24} />
                            ) : (
                                workerData?.avatar_url ? <img src={workerData.avatar_url} className="w-full h-full object-cover" /> : <User size={24} />
                            )}
                        </div>
                        <div className={`absolute -top-2 -right-2 text-white text-[10px] font-black px-1.5 py-0.5 rounded-full border border-black ${isCompany ? 'bg-blue-500' : 'bg-primary'}`}>
                            {isCompany ? 'PRO' : `LVL ${workerData?.level || 1}`}
                        </div>
                    </div>
                    <div className="flex flex-col">
                        <span className="text-sm font-black uppercase text-accent truncate max-w-[100px]">{name || (isCompany ? 'Carregando...' : '...')}</span>
                        <div className="flex items-center gap-1 text-xs font-bold text-gray-500">
                            <Zap size={10} className={`${isCompany ? (isVerified ? 'text-blue-500 fill-blue-500' : 'text-gray-300 fill-gray-300') : 'text-primary fill-primary'}`} />
                            {isCompany ? (isVerified ? 'Verificado' : 'Não Verificado') : `${workerData?.xp || 0} XP`}
                        </div>
                    </div>
                </div>

                <button
                    onClick={handleLogout}
                    disabled={loggingOut}
                    className="flex items-center justify-center gap-2 w-full py-2 rounded-xl font-bold uppercase text-xs text-red-600 hover:bg-red-50 border-2 border-transparent hover:border-red-200 transition-all disabled:opacity-50 disabled:cursor-not-allowed"
                >
                    {loggingOut ? <Loader2 size={16} className="animate-spin" /> : <LogOut size={16} />}
                    {loggingOut ? 'Saindo...' : 'Sair'}
                </button>

                <NavLink
                    to="/ajuda"
                    className="flex items-center justify-center gap-1.5 w-full py-1 text-[11px] font-bold uppercase text-gray-400 hover:text-gray-600 transition-colors"
                >
                    <HelpCircle size={12} />
                    Ajuda
                </NavLink>
            </div>
        </aside>
    );
}
