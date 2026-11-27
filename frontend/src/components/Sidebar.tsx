import { User, PlusCircle, Building2, LogOut, HelpCircle, BadgeCheck, CircleDashed, UserCircle } from 'lucide-react';
import { Link, NavLink, useLocation, useNavigate } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { useAuth } from '../contexts/AuthContext';
import { useToast } from '../contexts/ToastContext';
import { logError } from '../lib/logger';
import NotificationBell from './NotificationBell';
import { ButtonLink, Menu } from './ui';
import { useEffect, useState } from 'react';
import { useCompanyNavContext } from '../hooks/useCompanyNavContext';
import { COMPANY_CREATE_ACTION, COMPANY_GESTAO_PATH, WORKER_PROFILE_LINK, getCompanyNav, getWorkerNav, isNavActive } from '../lib/navigation';
import { getMyCompanies, pickCurrentCompany, subscribeCompanyScope } from '../services/companyScopeService';
import type { MyCompany } from '../types';

interface SidebarProps {
    type?: 'worker' | 'company';
}

/**
 * Lateral do desktop (>= 768px). Largura vem de `--worki-side-w` (index.css): 15rem a partir de
 * 1100px; entre 768 e 1099px fica recolhida em ícones (4,5rem), com o rótulo só para leitor de
 * tela e `title` como dica. Estrutura: cabeçalho compacto, "Criar turno" (empresa), navegação e
 * conta em UMA linha (avatar, nome, menu "...").
 */
export default function Sidebar({ type = 'worker' }: SidebarProps) {
    const [name, setName] = useState('');
    // `null` = ainda carregando: o menu não pode afirmar "Não verificado" antes de saber.
    const [isVerified, setIsVerified] = useState<boolean | null>(null);
    interface WorkerData {
        full_name: string;
        level?: number;
        xp?: number;
        avatar_url?: string;
        verified_identity?: boolean;
    }

    const [workerData, setWorkerData] = useState<WorkerData | null>(null);
    // Quem é a PESSOA da sessão (o `name` acima é o da empresa) e o papel dela, para o rodapé.
    const [personName, setPersonName] = useState('');
    const [companyRole, setCompanyRole] = useState<MyCompany['role'] | null>(null);
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

    // Convidar/confirmar/remover alguém muda `team_enabled`/papel: relê o seam sem recarregar a página.
    const [scopeVersion, setScopeVersion] = useState(0);
    useEffect(() => subscribeCompanyScope(() => setScopeVersion((v) => v + 1)), []);

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
                        setCompanyRole(current.role);
                        // Encarregado tem nome na equipe (`display_name`); o Gestor, o do cadastro; senão o e-mail.
                        let memberName: string | null = null;
                        if (current.role === 'encarregado') {
                            try {
                                const { data: rows } = await supabase
                                    .from('company_members')
                                    .select('company_id, display_name')
                                    .eq('user_id', user.id);
                                memberName = ((rows ?? []) as { company_id: string; display_name: string | null }[])
                                    .find((r) => r.company_id === current.company_id)?.display_name?.trim() || null;
                            } catch (error) {
                                logError('Sidebar.fetchMemberName', error);
                            }
                        }
                        const metaName = typeof user.user_metadata?.full_name === 'string' ? user.user_metadata.full_name.trim() : '';
                        setPersonName(memberName || metaName || user.email || '');
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
    }, [type, scopeVersion]);

    const isCompany = type === 'company';
    const { pathname } = useLocation();
    const currentCompany = myCompanies.find(c => c.company_id === currentCompanyId) ?? null;
    const companyNav = useCompanyNavContext(isCompany ? currentCompany : null);
    const navItems = isCompany ? getCompanyNav(companyNav) : getWorkerNav();

    // Item ativo: preenchimento sólido, sem borda nem sombra (a moldura é só da lateral).
    // Empresa preto, freela verde AA (`primary-dark`: texto branco 4,57:1).
    const activeNavClass = isCompany ? 'bg-[#2563EB] text-white' : 'bg-primary-dark text-white';

    // Recolhida (768 a 1099px): só ícones. O texto continua no DOM (`sr-only`) para leitor de tela.
    const label = 'max-[1099px]:sr-only';

    const roleLabel = isCompany ? (companyRole === 'encarregado' ? 'Encarregado' : companyRole ? 'Gestor' : '') : 'Freela';
    const accountItems = [
        !isCompany && { label: WORKER_PROFILE_LINK.label, icon: UserCircle, onSelect: () => navigate(WORKER_PROFILE_LINK.path) },
        { label: 'Ajuda', icon: HelpCircle, onSelect: () => navigate('/ajuda') },
        { label: loggingOut ? 'Saindo...' : 'Sair', icon: LogOut, onSelect: handleLogout, danger: true, disabled: loggingOut },
    ];

    return (
        <aside aria-label="Menu lateral" className="hidden md:flex flex-col shrink-0 w-[var(--worki-side-w)] h-[calc(100dvh-2rem)] self-start m-4 sticky top-4
                      bg-white border-2 border-black rounded-2xl shadow-brutal-lg overflow-hidden z-50">

            {/* Cabeçalho compacto: marca + sino. Recolhida: marca em cima, sino embaixo. */}
            <div className="flex h-14 shrink-0 items-center justify-between gap-2 border-b border-gray-200 pl-4 pr-2 max-[1099px]:h-auto max-[1099px]:flex-col max-[1099px]:justify-center max-[1099px]:gap-0 max-[1099px]:px-0 max-[1099px]:py-3">
                <div className="flex min-w-0 items-center gap-2.5">
                    <span aria-hidden="true" className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full border-2 border-black text-xs font-bold ${isCompany ? 'bg-[#2563EB] text-white' : 'bg-primary-dark text-white'}`}>W.</span>
                    <div className={`min-w-0 leading-none ${label}`}>
                        <p className="text-base font-bold tracking-tight text-black">Worki</p>
                        {isCompany && <p className="mt-1 text-xs font-semibold text-gray-600">Empresa</p>}
                    </div>
                </div>
                <NotificationBell className="text-gray-700 hover:bg-gray-100" />
            </div>

            {isCompany && (
                <div className="shrink-0 px-3 pt-3">
                    <ButtonLink
                        to={COMPANY_CREATE_ACTION.path}
                        variant="dark"
                        fullWidth
                        title={COMPANY_CREATE_ACTION.label}
                        iconLeft={<PlusCircle size={18} aria-hidden="true" />}
                        className="max-[1099px]:px-0"
                    >
                        <span className={label}>{COMPANY_CREATE_ACTION.label}</span>
                    </ButtonLink>
                </div>
            )}

            {/* Navegação: itens e sub-rotas ativas vêm de lib/navigation. Rola só se faltar altura. */}
            <nav aria-label="Navegação principal" className="flex min-h-0 flex-1 flex-col gap-1 overflow-y-auto px-3 py-3">
                {navItems.map((item) => {
                    const active = isNavActive(pathname, item);
                    return (
                        <Link
                            key={item.id}
                            to={item.path}
                            title={item.label}
                            aria-current={active ? 'page' : undefined}
                            className={`flex min-h-11 shrink-0 items-center gap-3 rounded-xl px-3 text-sm font-semibold transition-colors duration-fast motion-reduce:transition-none max-[1099px]:justify-center max-[1099px]:px-0
              focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-black focus-visible:ring-offset-2
              ${active ? activeNavClass : 'text-gray-700 hover:bg-gray-100 hover:text-black'}`}
                        >
                            <item.icon size={18} strokeWidth={2} aria-hidden="true" className="shrink-0" />
                            <span className={`truncate ${label}`}>{item.label}</span>
                        </Link>
                    );
                })}
            </nav>

            {/* Conta em UMA linha: identidade (link) + menu "..." com Perfil, Ajuda e Sair. */}
            <div className="flex shrink-0 items-center gap-1 border-t border-gray-200 p-2 max-[1099px]:flex-col max-[1099px]:gap-0">
                <NavLink
                    to={isCompany ? COMPANY_GESTAO_PATH : WORKER_PROFILE_LINK.path}
                    title={(isCompany ? personName || name : name) || undefined}
                    className="flex min-h-11 min-w-0 flex-1 items-center gap-2.5 rounded-xl p-1.5 transition-colors duration-fast hover:bg-gray-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-black max-[1099px]:flex-none"
                    // No lado da empresa, quem marca "página atual" é o item Gestão do menu.
                    {...(isCompany ? { 'aria-current': undefined } : {})}
                >
                    <span className="flex h-9 w-9 shrink-0 items-center justify-center overflow-hidden rounded-full border-2 border-black bg-gray-100">
                        {isCompany ? (
                            <Building2 size={18} aria-hidden="true" />
                        ) : workerData?.avatar_url ? (
                            <img src={workerData.avatar_url} alt="" className="h-full w-full object-cover" />
                        ) : (
                            <User size={18} aria-hidden="true" />
                        )}
                    </span>
                    <span className={`flex min-w-0 flex-1 flex-col gap-0.5 ${label}`}>
                        {isCompany && isVerified === null ? (
                            <span className="flex animate-pulse flex-col gap-1.5" role="status" aria-label="Carregando dados da empresa">
                                <span className="h-3.5 w-28 rounded bg-gray-200" />
                                <span className="h-3 w-16 rounded bg-gray-200" />
                            </span>
                        ) : (
                            <span className="truncate text-sm font-semibold leading-tight text-black">
                                {isCompany ? (personName || 'Minha conta') : (name || '...')}
                            </span>
                        )}
                        {isCompany ? (isVerified !== null && (
                            <span className="flex min-w-0 items-center gap-1 text-xs font-medium leading-tight text-gray-600">
                                {isVerified
                                    ? <BadgeCheck size={13} aria-hidden="true" className="shrink-0 text-blue-600" />
                                    : <CircleDashed size={13} aria-hidden="true" className="shrink-0 text-gray-500" />}
                                <span className="shrink-0 font-semibold text-gray-800">{roleLabel}</span>
                                {name && <span aria-hidden="true" className="shrink-0">·</span>}
                                {name && <span className="truncate">{name}</span>}
                                <span className="sr-only">{isVerified ? ', verificado' : ', não verificado'}</span>
                            </span>
                        )) : (
                            // Sem dado ainda: esqueleto, nunca "Nível 1 · 0 XP" inventado.
                            workerData ? (
                                <span className="truncate text-xs font-medium leading-tight text-gray-600">
                                    {`${roleLabel} · Nível ${workerData.level || 1} · ${workerData.xp || 0} XP`}
                                </span>
                            ) : (
                                <span aria-hidden="true" className="mt-0.5 block h-3 w-20 rounded bg-gray-200 motion-safe:animate-pulse" />
                            )
                        )}
                    </span>
                </NavLink>
                <Menu label="Mais opções da conta" menuLabel="Conta" items={accountItems} />
            </div>
        </aside>
    );
}
