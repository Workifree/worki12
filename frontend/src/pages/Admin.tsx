import { useEffect, useState, useCallback } from 'react';
import type { FormEvent } from 'react';
import { supabase } from '../lib/supabase';
import { useNavigate } from 'react-router-dom';
import { Loader2, Users, Briefcase, DollarSign, ShieldCheck, ArrowLeft, Lock, LogIn, RefreshCw } from 'lucide-react';
import { invokeFunction } from '../services/api';
import { logError } from '../lib/logger';

const ADMIN_EMAILS = import.meta.env.VITE_ADMIN_EMAILS
    ? (import.meta.env.VITE_ADMIN_EMAILS as string).split(',').map((e: string) => e.trim())
    : [];

const MAX_LOGIN_ATTEMPTS = 5;
const LOCKOUT_DURATION_MS = 60_000; // 1 minuto

interface AsaasBalance {
    currentBalance: number;
    pendingBalance: number;
    totalBalance: number;
}

interface Stats {
    totalWorkers: number;
    totalCompanies: number;
    totalJobs: number;
    totalEscrowReserved: number;
    totalEscrowReleased: number;
    dbTotalBalance: number;
    workerBalances: number;
    companyBalances: number;
    asaas: AsaasBalance | null;
}

interface UserInfo {
    user_id: string;
    email: string;
    user_type: string;
    name: string;
}

interface RichTransaction {
    id: string;
    wallet_id: string;
    amount: number;
    type: string;
    description: string | null;
    reference_id: string | null;
    created_at: string;
    user_info: UserInfo | null;
}

interface AdminUser {
    id: string;
    email: string;
    user_type: string;
    full_name: string;
    created_at: string;
    email_confirmed_at: string | null;
    last_sign_in_at: string | null;
    profile: Record<string, unknown> | null;
    balance: number;
}

interface RichEscrow {
    id: string;
    job_id: string;
    application_id: string | null;
    amount: number;
    status: string;
    created_at: string;
    released_at: string | null;
    company_wallet_id: string;
    worker_wallet_id: string | null;
    job?: { title: string; company_id: string } | null;
    company_info: UserInfo | null;
    worker_info: UserInfo | null;
}

type Tab = 'dashboard' | 'users' | 'escrows';

export default function Admin() {
    const navigate = useNavigate();
    const [loading, setLoading] = useState(true);
    const [authorized, setAuthorized] = useState(false);
    const [needsLogin, setNeedsLogin] = useState(false);
    const [loginError, setLoginError] = useState('');
    const [loginLoading, setLoginLoading] = useState(false);
    const [email, setEmail] = useState('');
    const [password, setPassword] = useState('');
    const [tab, setTab] = useState<Tab>('dashboard');
    const [stats, setStats] = useState<Stats | null>(null);
    const [transactions, setTransactions] = useState<RichTransaction[]>([]);
    const [users, setUsers] = useState<AdminUser[]>([]);
    const [escrows, setEscrows] = useState<RichEscrow[]>([]);
    const [loadingTab, setLoadingTab] = useState(false);
    const [refreshing, setRefreshing] = useState(false);
    const [loginAttempts, setLoginAttempts] = useState(0);
    const [lockoutUntil, setLockoutUntil] = useState(0);
    const [cooldownSeconds, setCooldownSeconds] = useState(0);

    const loadDashboard = useCallback(async () => {
        try {
            const data = await invokeFunction<{ stats: Stats; transactions: RichTransaction[] }>('admin-data', { action: 'stats' });
            setStats(data.stats);
            setTransactions(data.transactions);
        } catch (err) {
            logError('Failed to load admin stats', err);
        }
    }, []);

    const loadUsers = useCallback(async () => {
        setLoadingTab(true);
        try {
            const data = await invokeFunction<{ users: AdminUser[] }>('admin-data', { action: 'users' });
            setUsers(data.users);
        } catch (err) {
            logError('Failed to load users', err);
        }
        setLoadingTab(false);
    }, []);

    const loadEscrows = useCallback(async () => {
        setLoadingTab(true);
        try {
            const data = await invokeFunction<{ escrows: RichEscrow[] }>('admin-data', { action: 'escrows' });
            setEscrows(data.escrows);
        } catch (err) {
            logError('Failed to load escrows', err);
        }
        setLoadingTab(false);
    }, []);

    const handleRefresh = async () => {
        setRefreshing(true);
        if (tab === 'dashboard') await loadDashboard();
        if (tab === 'users') await loadUsers();
        if (tab === 'escrows') await loadEscrows();
        setRefreshing(false);
    };

    const checkAuth = useCallback(async () => {
        const { data: { user } } = await supabase.auth.getUser();
        if (!user) {
            setNeedsLogin(true);
            setLoading(false);
            return;
        }
        if (!ADMIN_EMAILS.includes(user.email || '')) {
            setLoginError('Acesso negado. Este e-mail não tem permissão de administrador.');
            setNeedsLogin(true);
            setLoading(false);
            return;
        }
        setAuthorized(true);
        await loadDashboard();
        setLoading(false);
    }, [loadDashboard]);

    // Cooldown timer for rate limiting
    useEffect(() => {
        if (lockoutUntil <= Date.now()) {
            setCooldownSeconds(0);
            return;
        }
        const interval = setInterval(() => {
            const remaining = Math.ceil((lockoutUntil - Date.now()) / 1000);
            if (remaining <= 0) {
                setCooldownSeconds(0);
                clearInterval(interval);
            } else {
                setCooldownSeconds(remaining);
            }
        }, 1000);
        return () => clearInterval(interval);
    }, [lockoutUntil]);

    const isRateLimited = cooldownSeconds > 0;

    const handleLogin = async (e: FormEvent) => {
        e.preventDefault();
        setLoginError('');

        // Check rate limiting
        if (isRateLimited) {
            setLoginError('Muitas tentativas. Aguarde antes de tentar novamente.');
            return;
        }

        setLoginLoading(true);

        if (ADMIN_EMAILS.length === 0) {
            setLoginError('Nenhum e-mail de administrador configurado.');
            setLoginLoading(false);
            return;
        }

        if (!ADMIN_EMAILS.includes(email)) {
            setLoginError('Este e-mail não tem permissão de administrador.');
            setLoginLoading(false);
            const newAttempts = loginAttempts + 1;
            setLoginAttempts(newAttempts);
            if (newAttempts >= MAX_LOGIN_ATTEMPTS) {
                setLockoutUntil(Date.now() + LOCKOUT_DURATION_MS);
                setCooldownSeconds(Math.ceil(LOCKOUT_DURATION_MS / 1000));
                setLoginError('Muitas tentativas. Aguarde 1 minuto antes de tentar novamente.');
            } else {
                // Exponential delay: 1s, 2s, 4s, 8s...
                const delayMs = Math.min(Math.pow(2, newAttempts - 1) * 1000, LOCKOUT_DURATION_MS);
                setLockoutUntil(Date.now() + delayMs);
                setCooldownSeconds(Math.ceil(delayMs / 1000));
            }
            return;
        }

        const { error } = await supabase.auth.signInWithPassword({ email, password });
        if (error) {
            const newAttempts = loginAttempts + 1;
            setLoginAttempts(newAttempts);
            setLoginError(error.message);
            setLoginLoading(false);
            if (newAttempts >= MAX_LOGIN_ATTEMPTS) {
                setLockoutUntil(Date.now() + LOCKOUT_DURATION_MS);
                setCooldownSeconds(Math.ceil(LOCKOUT_DURATION_MS / 1000));
                setLoginError('Muitas tentativas. Aguarde 1 minuto antes de tentar novamente.');
            } else {
                const delayMs = Math.min(Math.pow(2, newAttempts - 1) * 1000, LOCKOUT_DURATION_MS);
                setLockoutUntil(Date.now() + delayMs);
                setCooldownSeconds(Math.ceil(delayMs / 1000));
            }
            return;
        }

        setLoginAttempts(0);
        setNeedsLogin(false);
        setAuthorized(true);
        await loadDashboard();
        setLoginLoading(false);
    };

    useEffect(() => {
        // eslint-disable-next-line react-hooks/set-state-in-effect
        checkAuth();
    }, [checkAuth]);

    useEffect(() => {
        if (!authorized) return;
        if (tab === 'users' && users.length === 0) {
            // eslint-disable-next-line react-hooks/set-state-in-effect
            loadUsers();
        }
        if (tab === 'escrows' && escrows.length === 0) {
            loadEscrows();
        }
    }, [tab, authorized, users.length, escrows.length, loadUsers, loadEscrows]);

    if (loading) return (
        <div className="min-h-screen flex items-center justify-center">
            <Loader2 className="animate-spin" size={32} />
        </div>
    );

    if (needsLogin && !authorized) return (
        <div className="min-h-screen bg-gray-50 flex items-center justify-center p-6">
            <div className="w-full max-w-sm">
                <div className="bg-white border-2 border-black rounded-2xl p-8">
                    <div className="flex items-center gap-3 mb-6">
                        <ShieldCheck size={28} className="text-red-600" />
                        <h1 className="text-2xl font-black uppercase">Admin</h1>
                    </div>
                    <form onSubmit={handleLogin} className="space-y-4">
                        <div>
                            <label className="block text-xs font-bold uppercase mb-1">Email</label>
                            <input
                                type="email"
                                value={email}
                                onChange={e => setEmail(e.target.value)}
                                className="w-full px-3 py-2 border-2 border-gray-300 rounded-lg text-sm focus:border-black focus:outline-none"
                                placeholder="admin@email.com"
                                required
                            />
                        </div>
                        <div>
                            <label className="block text-xs font-bold uppercase mb-1">Senha</label>
                            <input
                                type="password"
                                value={password}
                                onChange={e => setPassword(e.target.value)}
                                className="w-full px-3 py-2 border-2 border-gray-300 rounded-lg text-sm focus:border-black focus:outline-none"
                                placeholder="••••••••"
                                required
                            />
                        </div>
                        {loginError && (
                            <p className="text-red-500 text-xs font-bold">{loginError}</p>
                        )}
                        <button
                            type="submit"
                            disabled={loginLoading || isRateLimited}
                            className="w-full py-3 bg-black text-white font-bold uppercase rounded-lg hover:bg-gray-800 disabled:opacity-50 flex items-center justify-center gap-2"
                        >
                            {loginLoading ? <Loader2 className="animate-spin" size={16} /> : isRateLimited ? <Lock size={16} /> : <LogIn size={16} />}
                            {isRateLimited ? `Aguarde ${cooldownSeconds}s` : 'Entrar'}
                        </button>
                    </form>
                </div>
            </div>
        </div>
    );

    return (
        <div className="min-h-screen bg-gray-50 p-4 md:p-6">
            <div className="max-w-7xl mx-auto">
                <div className="flex items-center justify-between mb-6">
                    <div className="flex items-center gap-4">
                        <button onClick={() => navigate('/')} className="p-2 hover:bg-gray-200 rounded-lg">
                            <ArrowLeft size={20} />
                        </button>
                        <ShieldCheck size={28} className="text-red-600" />
                        <h1 className="text-2xl md:text-3xl font-black uppercase">Admin Panel</h1>
                    </div>
                    <button
                        onClick={handleRefresh}
                        disabled={refreshing}
                        className="flex items-center gap-2 px-3 py-2 text-xs font-bold uppercase border-2 border-gray-300 rounded-lg hover:border-black disabled:opacity-50"
                    >
                        <RefreshCw size={14} className={refreshing ? 'animate-spin' : ''} />
                        Atualizar
                    </button>
                </div>

                {/* Tabs */}
                <div className="flex gap-2 mb-6">
                    {(['dashboard', 'users', 'escrows'] as Tab[]).map(t => (
                        <button
                            key={t}
                            onClick={() => setTab(t)}
                            className={`px-4 py-2 rounded-lg text-sm font-bold uppercase border-2 transition-colors ${
                                tab === t ? 'bg-black text-white border-black' : 'bg-white text-black border-gray-300 hover:border-black'
                            }`}
                        >
                            {t === 'dashboard' ? 'Dashboard' : t === 'users' ? 'Usuarios' : 'Escrows'}
                        </button>
                    ))}
                </div>

                {tab === 'dashboard' && <DashboardTab stats={stats} transactions={transactions} />}
                {tab === 'users' && (loadingTab ? <TabLoader /> : <UsersTab users={users} />)}
                {tab === 'escrows' && (loadingTab ? <TabLoader /> : <EscrowsTab escrows={escrows} />)}
            </div>
        </div>
    );
}

function TabLoader() {
    return (
        <div className="flex items-center justify-center py-12">
            <Loader2 className="animate-spin" size={24} />
        </div>
    );
}

function formatDate(d: string) {
    return new Date(d).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: '2-digit', hour: '2-digit', minute: '2-digit' });
}

function formatMoney(v: number) {
    // Preserva o sinal: um prejuizo em 'Lucro Liquido' aparecia POSITIVO por causa do Math.abs
    // (a cor vermelha era a unica pista). PT-BR com virgula, consistente com o resto da UI.
    const abs = Math.abs(v).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    return `${v < 0 ? '-' : ''}R$ ${abs}`;
}

const USER_TYPE_LABELS: Record<string, string> = {
    worker: 'Trabalhador',
    company: 'Empresa',
    hire: 'Empresa',
    admin: 'Admin',
};

const TYPE_LABELS: Record<string, string> = {
    credit: 'Credito',
    debit: 'Debito',
    escrow_reserve: 'Reserva Escrow',
    escrow_release: 'Liberacao Escrow',
    initial_balance: 'Saldo Inicial',
    platform_fee: 'Taxa Plataforma',
};

const TYPE_COLORS: Record<string, string> = {
    credit: 'bg-green-100 text-green-800',
    debit: 'bg-red-100 text-red-800',
    escrow_reserve: 'bg-orange-100 text-orange-800',
    escrow_release: 'bg-blue-100 text-blue-800',
    initial_balance: 'bg-gray-100 text-gray-800',
    platform_fee: 'bg-purple-100 text-purple-800',
};

function UserBadge({ info }: { info: UserInfo | null }) {
    if (!info) return <span className="text-gray-300 text-xs">-</span>;
    return (
        <div className="flex flex-col">
            <span className="text-xs font-bold">{info.name}</span>
            <span className="text-[10px] text-gray-500 font-mono">{info.email}</span>
            <span className={`text-[10px] font-bold w-fit px-1 rounded mt-0.5 ${
                info.user_type === 'worker' ? 'bg-green-100 text-green-700' :
                info.user_type === 'company' ? 'bg-blue-100 text-blue-700' :
                'bg-gray-100 text-gray-600'
            }`}>{USER_TYPE_LABELS[info.user_type] ?? info.user_type}</span>
        </div>
    );
}

interface FinancialSummary {
    asaas: { currentBalance: number; pendingBalance: number } | null;
    totalWalletBalances: number;
    totalEscrowReserved: number;
    totalPlatformFees: number;
    depositCount: number;
    withdrawalCount: number;
    estimatedAsaasCost: number;
    netProfit: number;
}

function DashboardTab({ stats, transactions }: { stats: Stats | null; transactions: RichTransaction[] }) {
    const [filterType, setFilterType] = useState<string>('all');
    const [financialSummary, setFinancialSummary] = useState<FinancialSummary | null>(null);
    const [loadingFinancial, setLoadingFinancial] = useState(false);

    const loadFinancialSummary = useCallback(async () => {
        setLoadingFinancial(true);
        try {
            const data = await invokeFunction<FinancialSummary>('admin-data', { action: 'financial_summary' });
            setFinancialSummary(data);
        } catch (err) {
            logError('Failed to load financial summary', err);
        }
        setLoadingFinancial(false);
    }, []);

    useEffect(() => {
        loadFinancialSummary();
    }, [loadFinancialSummary]);

    const filtered = filterType === 'all'
        ? transactions
        : transactions.filter(tx => tx.type === filterType);

    return (
        <>
            {/* Financial Summary - Receita Worki */}
            <div className="bg-white border-2 border-purple-300 rounded-2xl p-6 mb-6">
                <h2 className="text-lg font-black uppercase mb-4 text-purple-800">Receita Worki (Taxas de Servico)</h2>
                {loadingFinancial ? (
                    <div className="flex justify-center py-4"><Loader2 className="animate-spin" size={24} /></div>
                ) : financialSummary ? (
                    <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
                        <div className="p-4 rounded-xl border-2 bg-purple-50 border-purple-200">
                            <p className="text-[10px] font-bold uppercase text-purple-600 mb-1">Receita Total (taxas)</p>
                            <p className="text-2xl font-black text-purple-800">{formatMoney(financialSummary.totalPlatformFees)}</p>
                        </div>
                        <div className="p-4 rounded-xl border-2 bg-red-50 border-red-200">
                            <p className="text-[10px] font-bold uppercase text-red-600 mb-1">Custo Asaas estimado</p>
                            <p className="text-2xl font-black text-red-800">{formatMoney(financialSummary.estimatedAsaasCost)}</p>
                            <p className="text-[10px] text-red-600 mt-1">{financialSummary.depositCount} depositos + {financialSummary.withdrawalCount} saques x R$ 1,99</p>
                        </div>
                        <div className={`p-4 rounded-xl border-2 ${financialSummary.netProfit >= 0 ? 'bg-green-50 border-green-200' : 'bg-red-50 border-red-200'}`}>
                            <p className="text-[10px] font-bold uppercase text-gray-600 mb-1">Lucro Liquido Worki</p>
                            <p className={`text-2xl font-black ${financialSummary.netProfit >= 0 ? 'text-green-800' : 'text-red-800'}`}>{formatMoney(financialSummary.netProfit)}</p>
                            <p className="text-[10px] text-gray-500 mt-1">Receita taxas - Custo Asaas</p>
                        </div>
                    </div>
                ) : (
                    <p className="text-xs text-gray-400">Nao foi possivel carregar resumo financeiro.</p>
                )}
            </div>

            {/* Wallet Central Asaas - Fluxo de Caixa Real */}
            <div className="bg-white border-2 border-black rounded-2xl p-6 mb-6">
                <h2 className="text-lg font-black uppercase mb-4">Wallet Central Asaas (Dinheiro Real)</h2>
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                    <div className="p-4 rounded-xl border-2 bg-green-50 border-green-300">
                        <p className="text-[10px] font-bold uppercase text-green-600 mb-1">Saldo Disponivel</p>
                        <p className="text-2xl font-black text-green-800">{formatMoney(stats?.asaas?.currentBalance || 0)}</p>
                        <p className="text-[10px] text-green-600 mt-1">Dinheiro real na conta Asaas</p>
                    </div>
                    <div className="p-4 rounded-xl border-2 bg-yellow-50 border-yellow-300">
                        <p className="text-[10px] font-bold uppercase text-yellow-600 mb-1">Saldo Pendente</p>
                        <p className="text-2xl font-black text-yellow-800">{formatMoney(stats?.asaas?.pendingBalance || 0)}</p>
                        <p className="text-[10px] text-yellow-600 mt-1">Pagamentos aguardando confirmacao</p>
                    </div>
                    <div className="p-4 rounded-xl border-2 bg-gray-100 border-gray-400">
                        <p className="text-[10px] font-bold uppercase text-gray-600 mb-1">Total Asaas</p>
                        <p className="text-2xl font-black text-gray-800">{formatMoney(stats?.asaas?.totalBalance || 0)}</p>
                        <p className="text-[10px] text-gray-500 mt-1">Disponivel + Pendente</p>
                    </div>
                </div>
                {!stats?.asaas && (
                    <p className="text-xs text-red-500 mt-3 font-bold">Nao foi possivel consultar o saldo do Asaas. Verifique a ASAAS_API_KEY.</p>
                )}
            </div>

            {/* Saldos Internos (DB) */}
            <div className="bg-white border-2 border-gray-200 rounded-2xl p-6 mb-6">
                <h2 className="text-lg font-black uppercase mb-4">Saldos Internos (Livro Contabil)</h2>
                <p className="text-[10px] text-gray-500 mb-3">Saldos rastreados pelo sistema. Devem bater com o Asaas em producao.</p>
                <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                    <StatCard icon={<DollarSign size={18} />} label="Saldo Empresas" value={formatMoney(stats?.companyBalances || 0)} color="blue" />
                    <StatCard icon={<DollarSign size={18} />} label="Saldo Workers" value={formatMoney(stats?.workerBalances || 0)} color="green" />
                    <StatCard icon={<Lock size={18} />} label="Em Escrow" value={formatMoney(stats?.totalEscrowReserved || 0)} color="orange" />
                    <StatCard icon={<DollarSign size={18} />} label="Total DB" value={formatMoney(stats?.dbTotalBalance || 0)} color="gray" />
                </div>
            </div>

            {/* Plataforma */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-8">
                <StatCard icon={<Users size={20} />} label="Workers" value={stats?.totalWorkers || 0} color="green" />
                <StatCard icon={<Briefcase size={20} />} label="Empresas" value={stats?.totalCompanies || 0} color="blue" />
                <StatCard icon={<Briefcase size={20} />} label="Vagas" value={stats?.totalJobs || 0} color="purple" />
                <StatCard icon={<DollarSign size={20} />} label="Escrow Liberado" value={formatMoney(stats?.totalEscrowReleased || 0)} color="green" />
            </div>

            <div className="bg-white border-2 border-black rounded-2xl p-6">
                <div className="flex items-center justify-between mb-4">
                    <h2 className="text-xl font-black uppercase">Transacoes ({filtered.length})</h2>
                    <select
                        value={filterType}
                        onChange={e => setFilterType(e.target.value)}
                        className="text-xs font-bold border-2 border-gray-300 rounded-lg px-2 py-1 focus:border-black focus:outline-none"
                    >
                        <option value="all">Todos</option>
                        <option value="credit">Credito</option>
                        <option value="debit">Debito</option>
                        <option value="escrow_reserve">Reserva Escrow</option>
                        <option value="escrow_release">Liberacao Escrow</option>
                        <option value="initial_balance">Saldo Inicial</option>
                        <option value="platform_fee">Taxa Plataforma</option>
                    </select>
                </div>
                <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                        <thead>
                            <tr className="border-b-2 border-black">
                                <th className="text-left py-2 font-black uppercase text-xs">Data</th>
                                <th className="text-left py-2 font-black uppercase text-xs">Tipo</th>
                                <th className="text-left py-2 font-black uppercase text-xs">Usuario</th>
                                <th className="text-right py-2 font-black uppercase text-xs">Valor</th>
                                <th className="text-left py-2 font-black uppercase text-xs">Descricao</th>
                                <th className="text-left py-2 font-black uppercase text-xs">Ref</th>
                            </tr>
                        </thead>
                        <tbody>
                            {filtered.length === 0 && (
                                <tr><td colSpan={6} className="py-4 text-center text-gray-400">Nenhuma transacao</td></tr>
                            )}
                            {filtered.map(tx => (
                                <tr key={tx.id} className="border-b border-gray-100 hover:bg-gray-50">
                                    <td className="py-2 text-xs text-gray-500 whitespace-nowrap">
                                        {formatDate(tx.created_at)}
                                    </td>
                                    <td className="py-2">
                                        <span className={`px-2 py-0.5 rounded text-[10px] font-bold whitespace-nowrap ${TYPE_COLORS[tx.type] || 'bg-gray-100 text-gray-700'}`}>
                                            {TYPE_LABELS[tx.type] || tx.type}
                                        </span>
                                    </td>
                                    <td className="py-2">
                                        <UserBadge info={tx.user_info} />
                                    </td>
                                    <td className={`py-2 text-right font-bold whitespace-nowrap ${
                                        tx.type === 'credit' || tx.type === 'escrow_release' || tx.type === 'initial_balance' ? 'text-green-600' : tx.type === 'platform_fee' ? 'text-purple-600' : 'text-red-600'
                                    }`}>
                                        {tx.type === 'debit' || tx.type === 'escrow_reserve' || tx.type === 'platform_fee' ? '- ' : '+ '}
                                        {formatMoney(Math.abs(tx.amount))}
                                    </td>
                                    <td className="py-2 text-xs text-gray-600 max-w-[200px] truncate">
                                        {tx.description || '-'}
                                    </td>
                                    <td className="py-2 text-[10px] text-gray-400 font-mono max-w-[100px] truncate">
                                        {tx.reference_id || '-'}
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            </div>
        </>
    );
}

function UsersTab({ users }: { users: AdminUser[] }) {
    const [filter, setFilter] = useState<string>('all');

    const filtered = filter === 'all'
        ? users
        : users.filter(u => u.user_type === filter);

    const totalBalance = filtered.reduce((s, u) => s + Number(u.balance), 0);

    return (
        <div className="bg-white border-2 border-black rounded-2xl p-6">
            <div className="flex items-center justify-between mb-4">
                <h2 className="text-xl font-black uppercase">Usuarios ({filtered.length})</h2>
                <div className="flex items-center gap-3">
                    <span className="text-xs text-gray-500">Saldo total: <strong className="text-black">{formatMoney(totalBalance)}</strong></span>
                    <select
                        value={filter}
                        onChange={e => setFilter(e.target.value)}
                        className="text-xs font-bold border-2 border-gray-300 rounded-lg px-2 py-1 focus:border-black focus:outline-none"
                    >
                        <option value="all">Todos</option>
                        <option value="worker">Workers</option>
                        <option value="company">Empresas</option>
                        <option value="hire">Empresa (hire)</option>
                    </select>
                </div>
            </div>
            <div className="overflow-x-auto">
                <table className="w-full text-sm">
                    <thead>
                        <tr className="border-b-2 border-black">
                            <th className="text-left py-2 font-black uppercase text-xs">Email</th>
                            <th className="text-left py-2 font-black uppercase text-xs">Tipo</th>
                            <th className="text-left py-2 font-black uppercase text-xs">Nome</th>
                            <th className="text-right py-2 font-black uppercase text-xs">Saldo</th>
                            <th className="text-left py-2 font-black uppercase text-xs">Email confirmado</th>
                            <th className="text-left py-2 font-black uppercase text-xs">Ultimo Login</th>
                            <th className="text-left py-2 font-black uppercase text-xs">Cadastro</th>
                        </tr>
                    </thead>
                    <tbody>
                        {filtered.length === 0 && (
                            <tr><td colSpan={7} className="py-4 text-center text-gray-400">Nenhum usuario</td></tr>
                        )}
                        {filtered.map(u => (
                            <tr key={u.id} className="border-b border-gray-100 hover:bg-gray-50">
                                <td className="py-2 font-mono text-xs">{u.email}</td>
                                <td className="py-2">
                                    <span className={`px-2 py-0.5 rounded text-[10px] font-bold ${
                                        u.user_type === 'worker' ? 'bg-green-100 text-green-700' :
                                        u.user_type === 'company' || u.user_type === 'hire' ? 'bg-blue-100 text-blue-700' :
                                        'bg-gray-100 text-gray-700'
                                    }`}>
                                        {USER_TYPE_LABELS[u.user_type] ?? u.user_type}
                                    </span>
                                </td>
                                <td className="py-2 text-xs">{u.full_name || '-'}</td>
                                <td className="py-2 text-right font-bold text-xs">
                                    {formatMoney(u.balance)}
                                </td>
                                <td className="py-2">
                                    {u.email_confirmed_at
                                        ? <span className="text-green-600 font-bold text-[10px] bg-green-50 px-1.5 py-0.5 rounded">Sim</span>
                                        : <span className="text-red-500 font-bold text-[10px] bg-red-50 px-1.5 py-0.5 rounded">Nao</span>
                                    }
                                </td>
                                <td className="py-2 text-gray-400 text-xs whitespace-nowrap">
                                    {u.last_sign_in_at ? formatDate(u.last_sign_in_at) : '-'}
                                </td>
                                <td className="py-2 text-gray-400 text-xs whitespace-nowrap">
                                    {formatDate(u.created_at)}
                                </td>
                            </tr>
                        ))}
                    </tbody>
                </table>
            </div>
        </div>
    );
}

function EscrowsTab({ escrows }: { escrows: RichEscrow[] }) {
    const [filterStatus, setFilterStatus] = useState<string>('all');

    const filtered = filterStatus === 'all'
        ? escrows
        : escrows.filter(e => e.status === filterStatus);

    const reserved = escrows.filter(e => e.status === 'reserved');
    const released = escrows.filter(e => e.status === 'released');
    const refunded = escrows.filter(e => e.status === 'refunded');
    const reservedTotal = reserved.reduce((s, e) => s + Number(e.amount), 0);
    const releasedTotal = released.reduce((s, e) => s + Number(e.amount), 0);

    return (
        <div className="space-y-6">
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                <StatCard icon={<Lock size={20} />} label="Reservados" value={`${reserved.length} (${formatMoney(reservedTotal)})`} color="orange" />
                <StatCard icon={<DollarSign size={20} />} label="Liberados" value={`${released.length} (${formatMoney(releasedTotal)})`} color="green" />
                <StatCard icon={<ArrowLeft size={20} />} label="Reembolsados" value={refunded.length} color="gray" />
                <StatCard icon={<DollarSign size={20} />} label="Total Escrows" value={escrows.length} color="blue" />
            </div>

            <div className="bg-white border-2 border-black rounded-2xl p-6">
                <div className="flex items-center justify-between mb-4">
                    <h2 className="text-xl font-black uppercase">Escrows ({filtered.length})</h2>
                    <select
                        value={filterStatus}
                        onChange={e => setFilterStatus(e.target.value)}
                        className="text-xs font-bold border-2 border-gray-300 rounded-lg px-2 py-1 focus:border-black focus:outline-none"
                    >
                        <option value="all">Todos</option>
                        <option value="reserved">Reservados</option>
                        <option value="released">Liberados</option>
                        <option value="refunded">Reembolsados</option>
                    </select>
                </div>
                <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                        <thead>
                            <tr className="border-b-2 border-black">
                                <th className="text-left py-2 font-black uppercase text-xs">Data</th>
                                <th className="text-left py-2 font-black uppercase text-xs">Vaga</th>
                                <th className="text-left py-2 font-black uppercase text-xs">Empresa (pagou)</th>
                                <th className="text-left py-2 font-black uppercase text-xs">Worker (recebe)</th>
                                <th className="text-right py-2 font-black uppercase text-xs">Valor</th>
                                <th className="text-left py-2 font-black uppercase text-xs">Status</th>
                                <th className="text-left py-2 font-black uppercase text-xs">Liberado em</th>
                            </tr>
                        </thead>
                        <tbody>
                            {filtered.length === 0 && (
                                <tr><td colSpan={7} className="py-4 text-center text-gray-400">Nenhum escrow</td></tr>
                            )}
                            {filtered.map(e => (
                                <tr key={e.id} className="border-b border-gray-100 hover:bg-gray-50">
                                    <td className="py-2 text-xs text-gray-500 whitespace-nowrap">
                                        {formatDate(e.created_at)}
                                    </td>
                                    <td className="py-2 text-xs font-medium">
                                        {e.job?.title || e.job_id.slice(0, 8)}
                                    </td>
                                    <td className="py-2">
                                        <UserBadge info={e.company_info} />
                                    </td>
                                    <td className="py-2">
                                        <UserBadge info={e.worker_info} />
                                    </td>
                                    <td className="py-2 text-right font-bold whitespace-nowrap">
                                        {formatMoney(e.amount)}
                                    </td>
                                    <td className="py-2">
                                        <span className={`px-2 py-0.5 rounded text-[10px] font-bold ${
                                            e.status === 'reserved' ? 'bg-orange-100 text-orange-800' :
                                            e.status === 'released' ? 'bg-green-100 text-green-800' :
                                            'bg-gray-100 text-gray-800'
                                        }`}>
                                            {e.status === 'reserved' ? 'Reservado' : e.status === 'released' ? 'Liberado' : 'Reembolsado'}
                                        </span>
                                    </td>
                                    <td className="py-2 text-xs text-gray-400 whitespace-nowrap">
                                        {e.released_at ? formatDate(e.released_at) : '-'}
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            </div>
        </div>
    );
}

function StatCard({ icon, label, value, color }: { icon: React.ReactNode; label: string; value: string | number; color: string }) {
    const colors: Record<string, string> = {
        green: 'bg-green-50 text-green-700 border-green-200',
        blue: 'bg-blue-50 text-blue-700 border-blue-200',
        purple: 'bg-purple-50 text-purple-700 border-purple-200',
        orange: 'bg-orange-50 text-orange-700 border-orange-200',
        gray: 'bg-gray-50 text-gray-700 border-gray-200',
    };
    return (
        <div className={`p-4 rounded-xl border-2 ${colors[color] || colors.gray}`}>
            <div className="flex items-center gap-2 mb-1">{icon} <span className="text-[10px] font-bold uppercase">{label}</span></div>
            <p className="text-xl font-black">{value}</p>
        </div>
    );
}
