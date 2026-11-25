import { useEffect, useState, useCallback } from 'react';
import type { FormEvent } from 'react';
import { supabase } from '../lib/supabase';
import { useNavigate } from 'react-router-dom';
import { Loader2, Users, Briefcase, DollarSign, ShieldCheck, ArrowLeft, Lock, LogIn, RefreshCw } from 'lucide-react';
import { invokeFunction } from '../services/api';
import { logError } from '../lib/logger';
import BonusAdminPanel from '../components/admin/bonus/BonusAdminPanel';
import { ErrorState } from '../components/ui';
import { formatBRL } from '../lib/currency';

const ADMIN_EMAILS = import.meta.env.VITE_ADMIN_EMAILS
    ? (import.meta.env.VITE_ADMIN_EMAILS as string).split(',').map((e: string) => e.trim())
    : [];

// Célula de tabela: no celular cada linha vira um cartão com o rótulo da coluna (sem rolagem lateral).
const CELL =
    'flex min-w-0 items-start justify-between gap-3 break-all text-right before:shrink-0 before:text-left before:text-xs before:font-bold before:text-gray-600 before:content-[attr(data-label)] md:table-cell md:break-normal md:before:content-none';

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

type Tab = 'dashboard' | 'users' | 'escrows' | 'bonus';

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
    // Abas cuja última carga falhou: mostram erro, nunca zero ou lista vazia.
    const [failed, setFailed] = useState<Partial<Record<Tab, boolean>>>({});
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
            setFailed(f => ({ ...f, dashboard: false }));
        } catch (err) {
            logError('Failed to load admin stats', err);
            setFailed(f => ({ ...f, dashboard: true }));
        }
    }, []);

    const loadUsers = useCallback(async () => {
        setLoadingTab(true);
        try {
            const data = await invokeFunction<{ users: AdminUser[] }>('admin-data', { action: 'users' });
            setUsers(data.users);
            setFailed(f => ({ ...f, users: false }));
        } catch (err) {
            logError('Failed to load users', err);
            setFailed(f => ({ ...f, users: true }));
        }
        setLoadingTab(false);
    }, []);

    const loadEscrows = useCallback(async () => {
        setLoadingTab(true);
        try {
            const data = await invokeFunction<{ escrows: RichEscrow[] }>('admin-data', { action: 'escrows' });
            setEscrows(data.escrows);
            setFailed(f => ({ ...f, escrows: false }));
        } catch (err) {
            logError('Failed to load escrows', err);
            setFailed(f => ({ ...f, escrows: true }));
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
        <div className="min-h-screen flex items-center justify-center" role="status">
            <span className="sr-only">Carregando</span>
            <Loader2 aria-hidden="true" className="animate-spin" size={32} />
        </div>
    );

    if (needsLogin && !authorized) return (
        <div className="min-h-screen bg-gray-50 flex items-center justify-center p-6">
            <div className="w-full max-w-sm">
                <div className="bg-white border-2 border-black rounded-2xl p-8">
                    <div className="flex items-center gap-3 mb-6">
                        <ShieldCheck size={28} className="text-red-600" />
                        <h1 className="text-2xl font-bold">Admin</h1>
                    </div>
                    <form onSubmit={handleLogin} className="space-y-4">
                        <div>
                            <label className="block text-xs font-bold uppercase mb-1">Email</label>
                            <input
                                type="email"
                                autoComplete="username"
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
                                autoComplete="current-password"
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
        <div className="min-h-screen bg-gray-50 p-3 md:p-6">
            <div className="max-w-7xl mx-auto">
                <div className="flex flex-wrap items-center justify-between gap-3 mb-6">
                    <div className="flex min-w-0 items-center gap-2 sm:gap-4">
                        <button type="button" aria-label="Voltar ao início" onClick={() => navigate('/')} className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-xl hover:bg-gray-200">
                            <ArrowLeft size={20} />
                        </button>
                        <ShieldCheck size={28} className="text-red-600" />
                        <h1 className="text-xl md:text-3xl font-bold">Admin</h1>
                    </div>
                    <button
                        onClick={handleRefresh}
                        disabled={refreshing}
                        className="flex min-h-11 items-center gap-2 px-3 text-sm font-bold border-2 border-gray-300 rounded-xl hover:border-black disabled:opacity-50"
                    >
                        <RefreshCw size={14} className={refreshing ? 'animate-spin' : ''} />
                        Atualizar
                    </button>
                </div>

                {/* Tabs */}
                <div className="flex flex-wrap gap-2 mb-6">
                    {(['dashboard', 'users', 'escrows', 'bonus'] as Tab[]).map(t => (
                        <button
                            key={t}
                            onClick={() => setTab(t)}
                            className={`min-h-11 px-4 rounded-xl text-sm font-bold border-2 transition-colors ${
                                tab === t ? 'bg-black text-white border-black' : 'bg-white text-black border-gray-300 hover:border-black'
                            }`}
                        >
                            {t === 'dashboard' ? 'Dashboard' : t === 'users' ? 'Usuários' : t === 'escrows' ? 'Escrows' : 'Bônus'}
                        </button>
                    ))}
                </div>

                {tab !== 'bonus' && failed[tab] ? (
                    <ErrorState onRetry={() => void handleRefresh()} retrying={refreshing || loadingTab} />
                ) : (
                    <>
                        {tab === 'dashboard' && (stats ? <DashboardTab stats={stats} transactions={transactions} /> : <ErrorState onRetry={() => void handleRefresh()} retrying={refreshing} />)}
                        {tab === 'users' && (loadingTab ? <TabLoader /> : <UsersTab users={users} />)}
                        {tab === 'escrows' && (loadingTab ? <TabLoader /> : <EscrowsTab escrows={escrows} />)}
                        {tab === 'bonus' && <BonusAdminPanel />}
                    </>
                )}
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

const USER_TYPE_LABELS: Record<string, string> = {
    worker: 'Trabalhador',
    company: 'Empresa',
    hire: 'Empresa',
    admin: 'Admin',
};

const TYPE_LABELS: Record<string, string> = {
    credit: 'Crédito',
    debit: 'Débito',
    escrow_reserve: 'Reserva Escrow',
    escrow_release: 'Liberação Escrow',
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
            <span className="text-xs text-gray-500 font-mono">{info.email}</span>
            <span className={`text-xs font-bold w-fit px-1 rounded mt-0.5 ${
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
            <div className="bg-white border-2 border-purple-300 rounded-2xl p-4 sm:p-6 mb-6">
                <h2 className="text-lg font-bold mb-4 text-purple-800">Receita Worki (taxas de serviço)</h2>
                {loadingFinancial ? (
                    <div className="flex justify-center py-4"><Loader2 className="animate-spin" size={24} /></div>
                ) : financialSummary ? (
                    <div className="grid grid-cols-1 min-[420px]:grid-cols-2 md:grid-cols-3 gap-4">
                        <div className="p-4 rounded-xl border-2 bg-purple-50 border-purple-200">
                            <p className="text-xs font-bold uppercase text-purple-600 mb-1">Receita Total (taxas)</p>
                            <p className="text-2xl font-black text-purple-800 whitespace-nowrap">{formatBRL(financialSummary.totalPlatformFees)}</p>
                        </div>
                        <div className="p-4 rounded-xl border-2 bg-red-50 border-red-200">
                            <p className="text-xs font-bold uppercase text-red-600 mb-1">Custo Asaas estimado</p>
                            <p className="text-2xl font-black text-red-800 whitespace-nowrap">{formatBRL(financialSummary.estimatedAsaasCost)}</p>
                            <p className="text-xs text-red-600 mt-1">{financialSummary.depositCount} depósitos + {financialSummary.withdrawalCount} saques x R$ 1,99</p>
                        </div>
                        <div className={`p-4 rounded-xl border-2 ${financialSummary.netProfit >= 0 ? 'bg-green-50 border-green-200' : 'bg-red-50 border-red-200'}`}>
                            <p className="text-xs font-bold uppercase text-gray-600 mb-1">Lucro líquido Worki</p>
                            <p className={`text-2xl font-black ${financialSummary.netProfit >= 0 ? 'text-green-800' : 'text-red-800'}`}>{formatBRL(financialSummary.netProfit)}</p>
                            <p className="text-xs text-gray-500 mt-1">Receita taxas - Custo Asaas</p>
                        </div>
                    </div>
                ) : (
                    <p className="text-xs text-gray-600">Não foi possível carregar resumo financeiro.</p>
                )}
            </div>

            {/* Wallet Central Asaas - Fluxo de Caixa Real */}
            <div className="bg-white border-2 border-black rounded-2xl p-4 sm:p-6 mb-6">
                <h2 className="text-lg font-bold mb-4">Wallet Central Asaas (Dinheiro Real)</h2>
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                    <div className="p-4 rounded-xl border-2 bg-green-50 border-green-300">
                        <p className="text-xs font-bold uppercase text-green-600 mb-1">Saldo disponível</p>
                        <p className="text-2xl font-black text-green-800 whitespace-nowrap">{stats?.asaas ? formatBRL(stats.asaas.currentBalance) : '—'}</p>
                        <p className="text-xs text-green-600 mt-1">Dinheiro real na conta Asaas</p>
                    </div>
                    <div className="p-4 rounded-xl border-2 bg-yellow-50 border-yellow-300">
                        <p className="text-xs font-bold uppercase text-yellow-600 mb-1">Saldo Pendente</p>
                        <p className="text-2xl font-black text-yellow-800 whitespace-nowrap">{stats?.asaas ? formatBRL(stats.asaas.pendingBalance) : '—'}</p>
                        <p className="text-xs text-yellow-600 mt-1">Pagamentos aguardando confirmação</p>
                    </div>
                    <div className="p-4 rounded-xl border-2 bg-gray-100 border-gray-400">
                        <p className="text-xs font-bold uppercase text-gray-600 mb-1">Total Asaas</p>
                        <p className="text-2xl font-black text-gray-800 whitespace-nowrap">{stats?.asaas ? formatBRL(stats.asaas.totalBalance) : '—'}</p>
                        <p className="text-xs text-gray-500 mt-1">Disponível + pendente</p>
                    </div>
                </div>
                {!stats?.asaas && (
                    <p className="text-xs text-red-500 mt-3 font-bold">Não foi possível consultar o saldo do Asaas. Verifique a ASAAS_API_KEY.</p>
                )}
            </div>

            {/* Saldos Internos (DB) */}
            <div className="bg-white border-2 border-gray-200 rounded-2xl p-4 sm:p-6 mb-6">
                <h2 className="text-lg font-bold mb-4">Saldos Internos (livro contábil)</h2>
                <p className="text-xs text-gray-500 mb-3">Saldos rastreados pelo sistema. Devem bater com o Asaas em producao.</p>
                <div className="grid grid-cols-1 min-[420px]:grid-cols-2 md:grid-cols-4 gap-4">
                    <StatCard icon={<DollarSign size={18} />} label="Saldo Empresas" value={formatBRL(stats?.companyBalances || 0)} color="blue" />
                    <StatCard icon={<DollarSign size={18} />} label="Saldo Freelas" value={formatBRL(stats?.workerBalances || 0)} color="green" />
                    <StatCard icon={<Lock size={18} />} label="Em Escrow" value={formatBRL(stats?.totalEscrowReserved || 0)} color="orange" />
                    <StatCard icon={<DollarSign size={18} />} label="Total DB" value={formatBRL(stats?.dbTotalBalance || 0)} color="gray" />
                </div>
            </div>

            {/* Plataforma */}
            <div className="grid grid-cols-1 min-[420px]:grid-cols-2 md:grid-cols-4 gap-4 mb-8">
                <StatCard icon={<Users size={20} />} label="Freelas" value={stats?.totalWorkers || 0} color="green" />
                <StatCard icon={<Briefcase size={20} />} label="Empresas" value={stats?.totalCompanies || 0} color="blue" />
                <StatCard icon={<Briefcase size={20} />} label="Vagas" value={stats?.totalJobs || 0} color="purple" />
                <StatCard icon={<DollarSign size={20} />} label="Escrow Liberado" value={formatBRL(stats?.totalEscrowReleased || 0)} color="green" />
            </div>

            <div className="bg-white border-2 border-black rounded-2xl p-4 sm:p-6">
                <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
                    <h2 className="text-xl font-bold">Transações ({filtered.length})</h2>
                    <select
                        value={filterType}
                        onChange={e => setFilterType(e.target.value)}
                        aria-label="Filtrar" className="min-h-11 max-w-full text-sm font-bold border-2 border-gray-300 rounded-xl px-2 focus:border-black focus:outline-none"
                    >
                        <option value="all">Todos</option>
                        <option value="credit">Crédito</option>
                        <option value="debit">Débito</option>
                        <option value="escrow_reserve">Reserva Escrow</option>
                        <option value="escrow_release">Liberação Escrow</option>
                        <option value="initial_balance">Saldo Inicial</option>
                        <option value="platform_fee">Taxa Plataforma</option>
                    </select>
                </div>
                <div className="overflow-x-auto">
                    <table className="block w-full text-sm md:table">
                        <thead className="hidden md:table-header-group">
                            <tr className="border-b-2 border-black">
                                <th className="text-left py-2 font-bold text-xs">Data</th>
                                <th className="text-left py-2 font-bold text-xs">Tipo</th>
                                <th className="text-left py-2 font-bold text-xs">Usuário</th>
                                <th className="text-right py-2 font-bold text-xs">Valor</th>
                                <th className="text-left py-2 font-bold text-xs">Descrição</th>
                                <th className="text-left py-2 font-bold text-xs">Ref</th>
                            </tr>
                        </thead>
                        <tbody className="block md:table-row-group">
                            {filtered.length === 0 && (
                                <tr className="block md:table-row"><td colSpan={6} className="block md:table-cell py-4 text-center text-gray-600">Nenhuma transação</td></tr>
                            )}
                            {filtered.map(tx => (
                                <tr key={tx.id} className="block border-b-2 border-gray-200 py-2 md:table-row md:border-b md:border-gray-100 md:hover:bg-gray-50">
                                    <td data-label="Data" className={`${CELL} py-2 text-xs text-gray-500 whitespace-nowrap`}>
                                        {formatDate(tx.created_at)}
                                    </td>
                                    <td data-label="Tipo" className={`${CELL} py-2`}>
                                        <span className={`px-2 py-0.5 rounded text-xs font-bold whitespace-nowrap ${TYPE_COLORS[tx.type] || 'bg-gray-100 text-gray-700'}`}>
                                            {TYPE_LABELS[tx.type] || tx.type}
                                        </span>
                                    </td>
                                    <td data-label="Usuário" className={`${CELL} py-2`}>
                                        <UserBadge info={tx.user_info} />
                                    </td>
                                    <td data-label="Valor" className={`${CELL} py-2 md:text-right font-bold whitespace-nowrap ${
                                        tx.type === 'credit' || tx.type === 'escrow_release' || tx.type === 'initial_balance' ? 'text-green-600' : tx.type === 'platform_fee' ? 'text-purple-600' : 'text-red-600'
                                    }`}>
                                        {tx.type === 'debit' || tx.type === 'escrow_reserve' || tx.type === 'platform_fee' ? '- ' : '+ '}
                                        {formatBRL(Math.abs(tx.amount))}
                                    </td>
                                    <td data-label="Descrição" className={`${CELL} py-2 text-xs text-gray-600 max-w-[200px] truncate`}>
                                        {tx.description || '-'}
                                    </td>
                                    <td data-label="Ref" className={`${CELL} py-2 text-xs text-gray-600 font-mono max-w-[100px] truncate`}>
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
        <div className="bg-white border-2 border-black rounded-2xl p-4 sm:p-6">
            <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
                <h2 className="text-xl font-bold">Usuários ({filtered.length})</h2>
                <div className="flex flex-wrap items-center gap-3">
                    <span className="text-xs text-gray-500">Saldo total: <strong className="text-black">{formatBRL(totalBalance)}</strong></span>
                    <select
                        value={filter}
                        onChange={e => setFilter(e.target.value)}
                        aria-label="Filtrar" className="min-h-11 max-w-full text-sm font-bold border-2 border-gray-300 rounded-xl px-2 focus:border-black focus:outline-none"
                    >
                        <option value="all">Todos</option>
                        <option value="worker">Freelas</option>
                        <option value="company">Empresas</option>
                        <option value="hire">Empresa (hire)</option>
                    </select>
                </div>
            </div>
            <div className="overflow-x-auto">
                <table className="block w-full text-sm md:table">
                    <thead className="hidden md:table-header-group">
                        <tr className="border-b-2 border-black">
                            <th className="text-left py-2 font-bold text-xs">Email</th>
                            <th className="text-left py-2 font-bold text-xs">Tipo</th>
                            <th className="text-left py-2 font-bold text-xs">Nome</th>
                            <th className="text-right py-2 font-bold text-xs">Saldo</th>
                            <th className="text-left py-2 font-bold text-xs">Email confirmado</th>
                            <th className="text-left py-2 font-bold text-xs">Último login</th>
                            <th className="text-left py-2 font-bold text-xs">Cadastro</th>
                        </tr>
                    </thead>
                    <tbody className="block md:table-row-group">
                        {filtered.length === 0 && (
                            <tr className="block md:table-row"><td colSpan={7} className="block md:table-cell py-4 text-center text-gray-600">Nenhum usuário</td></tr>
                        )}
                        {filtered.map(u => (
                            <tr key={u.id} className="block border-b-2 border-gray-200 py-2 md:table-row md:border-b md:border-gray-100 md:hover:bg-gray-50">
                                <td data-label="Email" className={`${CELL} py-2 font-mono text-xs`}>{u.email}</td>
                                <td data-label="Tipo" className={`${CELL} py-2`}>
                                    <span className={`px-2 py-0.5 rounded text-xs font-bold ${
                                        u.user_type === 'worker' ? 'bg-green-100 text-green-700' :
                                        u.user_type === 'company' || u.user_type === 'hire' ? 'bg-blue-100 text-blue-700' :
                                        'bg-gray-100 text-gray-700'
                                    }`}>
                                        {USER_TYPE_LABELS[u.user_type] ?? u.user_type}
                                    </span>
                                </td>
                                <td data-label="Nome" className={`${CELL} py-2 text-xs`}>{u.full_name || '-'}</td>
                                <td data-label="Saldo" className={`${CELL} py-2 md:text-right font-bold whitespace-nowrap text-xs`}>
                                    {formatBRL(u.balance)}
                                </td>
                                <td data-label="Email confirmado" className={`${CELL} py-2`}>
                                    {u.email_confirmed_at
                                        ? <span className="text-green-600 font-bold text-xs bg-green-50 px-1.5 py-0.5 rounded">Sim</span>
                                        : <span className="text-red-500 font-bold text-xs bg-red-50 px-1.5 py-0.5 rounded">Não</span>
                                    }
                                </td>
                                <td data-label="Último login" className={`${CELL} py-2 text-gray-600 text-xs whitespace-nowrap`}>
                                    {u.last_sign_in_at ? formatDate(u.last_sign_in_at) : '-'}
                                </td>
                                <td data-label="Cadastro" className={`${CELL} py-2 text-gray-600 text-xs whitespace-nowrap`}>
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
            <div className="grid grid-cols-1 min-[420px]:grid-cols-2 md:grid-cols-4 gap-4">
                <StatCard icon={<Lock size={20} />} label="Reservados" value={`${reserved.length} (${formatBRL(reservedTotal)})`} color="orange" />
                <StatCard icon={<DollarSign size={20} />} label="Liberados" value={`${released.length} (${formatBRL(releasedTotal)})`} color="green" />
                <StatCard icon={<ArrowLeft size={20} />} label="Reembolsados" value={refunded.length} color="gray" />
                <StatCard icon={<DollarSign size={20} />} label="Total Escrows" value={escrows.length} color="blue" />
            </div>

            <div className="bg-white border-2 border-black rounded-2xl p-4 sm:p-6">
                <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
                    <h2 className="text-xl font-bold">Escrows ({filtered.length})</h2>
                    <select
                        value={filterStatus}
                        onChange={e => setFilterStatus(e.target.value)}
                        aria-label="Filtrar" className="min-h-11 max-w-full text-sm font-bold border-2 border-gray-300 rounded-xl px-2 focus:border-black focus:outline-none"
                    >
                        <option value="all">Todos</option>
                        <option value="reserved">Reservados</option>
                        <option value="released">Liberados</option>
                        <option value="refunded">Reembolsados</option>
                    </select>
                </div>
                <div className="overflow-x-auto">
                    <table className="block w-full text-sm md:table">
                        <thead className="hidden md:table-header-group">
                            <tr className="border-b-2 border-black">
                                <th className="text-left py-2 font-bold text-xs">Data</th>
                                <th className="text-left py-2 font-bold text-xs">Vaga</th>
                                <th className="text-left py-2 font-bold text-xs">Empresa (pagou)</th>
                                <th className="text-left py-2 font-bold text-xs">Freela (recebe)</th>
                                <th className="text-right py-2 font-bold text-xs">Valor</th>
                                <th className="text-left py-2 font-bold text-xs">Status</th>
                                <th className="text-left py-2 font-bold text-xs">Liberado em</th>
                            </tr>
                        </thead>
                        <tbody className="block md:table-row-group">
                            {filtered.length === 0 && (
                                <tr className="block md:table-row"><td colSpan={7} className="block md:table-cell py-4 text-center text-gray-600">Nenhum escrow</td></tr>
                            )}
                            {filtered.map(e => (
                                <tr key={e.id} className="block border-b-2 border-gray-200 py-2 md:table-row md:border-b md:border-gray-100 md:hover:bg-gray-50">
                                    <td data-label="Data" className={`${CELL} py-2 text-xs text-gray-500 whitespace-nowrap`}>
                                        {formatDate(e.created_at)}
                                    </td>
                                    <td data-label="Vaga" className={`${CELL} py-2 text-xs font-medium`}>
                                        {e.job?.title || e.job_id.slice(0, 8)}
                                    </td>
                                    <td data-label="Empresa (pagou)" className={`${CELL} py-2`}>
                                        <UserBadge info={e.company_info} />
                                    </td>
                                    <td data-label="Freela (recebe)" className={`${CELL} py-2`}>
                                        <UserBadge info={e.worker_info} />
                                    </td>
                                    <td data-label="Valor" className={`${CELL} py-2 md:text-right font-bold whitespace-nowrap`}>
                                        {formatBRL(e.amount)}
                                    </td>
                                    <td data-label="Status" className={`${CELL} py-2`}>
                                        <span className={`px-2 py-0.5 rounded text-xs font-bold ${
                                            e.status === 'reserved' ? 'bg-orange-100 text-orange-800' :
                                            e.status === 'released' ? 'bg-green-100 text-green-800' :
                                            'bg-gray-100 text-gray-800'
                                        }`}>
                                            {e.status === 'reserved' ? 'Reservado' : e.status === 'released' ? 'Liberado' : 'Reembolsado'}
                                        </span>
                                    </td>
                                    <td data-label="Liberado em" className={`${CELL} py-2 text-xs text-gray-600 whitespace-nowrap`}>
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
            <div className="flex items-center gap-2 mb-1">{icon} <span className="text-xs font-bold uppercase">{label}</span></div>
            <p className="text-xl font-black whitespace-nowrap">{value}</p>
        </div>
    );
}
