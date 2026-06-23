import { useEffect, useState } from 'react';
import { supabase } from '../../lib/supabase';
import { WalletService } from '../../services/walletService';
import type { WalletTransaction, EscrowTransaction } from '../../services/walletService';
import { DollarSign, ArrowDownLeft, ArrowUpRight, History, Lock, Wallet, TrendingUp } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import DepositModal from '../../components/DepositModal';
import PaymentMethodsSection from '../../components/PaymentMethodsSection';

export default function CompanyWallet() {
    const navigate = useNavigate();
    const [loading, setLoading] = useState(true);
    const [balance, setBalance] = useState(0);
    const [transactions, setTransactions] = useState<WalletTransaction[]>([]);
    const [escrows, setEscrows] = useState<EscrowTransaction[]>([]);
    const [stats, setStats] = useState({ totalSpent: 0, inEscrow: 0 });
    const [isDepositModalOpen, setIsDepositModalOpen] = useState(false);

    const fetchWalletData = async () => {
        const { data: { user } } = await supabase.auth.getUser();
        if (!user) return navigate('/login');

        // 1. Get or create company wallet
        const wallet = await WalletService.getOrCreateWallet(user.id, 'company');
        if (wallet) {
            setBalance(wallet.balance);
        }

        // 2. Fetch Transactions
        const txs = await WalletService.getTransactions(user.id);
        setTransactions(txs);

        // 3. Fetch Escrows
        const companyEscrows = await WalletService.getCompanyEscrows(user.id);
        setEscrows(companyEscrows);

        // 4. Calculate Stats
        const totalSpent = txs
            .filter(t => t.type === 'escrow_release' || (t.type === 'debit' && t.amount < 0))
            .reduce((acc, t) => acc + Math.abs(t.amount), 0);

        const inEscrow = companyEscrows
            .filter(e => e.status === 'reserved')
            .reduce((acc, e) => acc + e.amount, 0);

        setStats({ totalSpent, inEscrow });

        setLoading(false);
    };

    useEffect(() => {
        let isMounted = true;
        const init = async () => {
            await fetchWalletData(); // Load local data fast

            // Background sync with Asaas silently
            const res = await WalletService.syncBalance();
            if (isMounted && res.success && res.hasUpdates) {
                await fetchWalletData(); // Refresh UI with new Asaas data if updates found
            }
        };

        init();
        return () => { isMounted = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- init e fetchWalletData usam state setters estaveis, navigate estavel
    }, [navigate]);

    const formatDate = (dateStr: string) => {
        return new Date(dateStr).toLocaleDateString('pt-BR', {
            day: '2-digit',
            month: 'short',
            year: 'numeric'
        });
    };

    const getTransactionIcon = (type: string) => {
        switch (type) {
            case 'initial_balance': return <TrendingUp size={20} />;
            case 'escrow_reserve': return <Lock size={20} />;
            case 'escrow_release': return <ArrowUpRight size={20} />;
            case 'credit': return <ArrowDownLeft size={20} />;
            case 'platform_fee': return <DollarSign size={20} />;
            default: return <DollarSign size={20} />;
        }
    };

    const getTransactionColor = (type: string, amount: number) => {
        if (type === 'platform_fee') {
            return 'text-orange-600 bg-orange-100';
        }
        if (type === 'initial_balance' || type === 'credit' || amount > 0) {
            return 'text-green-600 bg-green-100';
        }
        return 'text-red-600 bg-red-100';
    };

    const getTransactionLabel = (t: WalletTransaction) => {
        if (t.type === 'credit') {
            return t.description || 'Deposito via PIX';
        }
        if (t.type === 'platform_fee') {
            return t.description || 'Taxa de servico';
        }
        return t.description || t.type;
    };

    if (loading) return (
        <div className="flex flex-col gap-8 pb-12 max-w-4xl mx-auto animate-pulse">
            <div>
                <div className="h-10 bg-gray-200 rounded w-2/5 mb-2" />
                <div className="h-4 bg-gray-200 rounded w-1/2" />
            </div>
            <div className="h-36 bg-gray-200 rounded-2xl" />
            <div className="space-y-3">
                {[...Array(5)].map((_, i) => (
                    <div key={i} className="h-16 bg-gray-200 rounded-xl" />
                ))}
            </div>
        </div>
    );

    return (
        <div className="flex flex-col gap-8 pb-12 font-sans text-accent max-w-4xl mx-auto">

            <header>
                <h2 className="text-4xl font-black uppercase tracking-tighter mb-2">Carteira da Empresa</h2>
                <p className="text-gray-500">Gerencie seu saldo e pagamentos</p>
            </header>

            {/* Main Balance Card */}
            <div className="bg-gradient-to-br from-blue-600 to-blue-800 text-white p-8 rounded-2xl border-2 border-black shadow-[6px_6px_0px_0px_rgba(0,0,0,1)] relative overflow-hidden">
                <div className="relative z-10">
                    <span className="text-sm font-bold uppercase text-blue-200 tracking-wider">Saldo Disponível</span>
                    <h2 className="text-6xl font-black tracking-tighter text-white mt-2 mb-6">R$ {balance.toFixed(2).replace('.', ',')}</h2>

                    <div className="flex gap-4">
                        <button
                            className="flex-1 bg-white text-blue-600 py-4 rounded-xl font-black uppercase shadow-[4px_4px_0px_0px_rgba(0,0,0,0.2)] hover:shadow-none hover:translate-y-1 transition-all flex items-center justify-center gap-2"
                            onClick={() => navigate('/company/create')}
                        >
                            <DollarSign size={20} /> Criar Vaga
                        </button>
                        <button
                            className="flex-1 bg-white/10 text-white py-4 rounded-xl font-bold uppercase hover:bg-white/20 transition-colors flex items-center justify-center gap-2"
                            onClick={() => setIsDepositModalOpen(true)}
                        >
                            <ArrowDownLeft size={20} /> Adicionar Saldo
                        </button>
                    </div>
                </div>
                {/* Background Element */}
                <Wallet size={200} className="absolute -top-10 -right-10 text-white/5 rotate-12" />
            </div>

            <DepositModal
                isOpen={isDepositModalOpen}
                onClose={() => setIsDepositModalOpen(false)}
                onSuccess={() => {
                    fetchWalletData();
                }}
            />

            {/* Stats Cards */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
                <div className="bg-white p-6 rounded-2xl border-2 border-black">
                    <div className="flex items-center gap-2 mb-2 text-orange-600">
                        <Lock size={20} /> <span className="text-xs font-black uppercase">Em Escrow</span>
                    </div>
                    <h3 className="text-2xl font-black">R$ {stats.inEscrow.toFixed(2).replace('.', ',')}</h3>
                    <p className="text-xs text-gray-400 mt-1">Reservado para vagas ativas</p>
                </div>
                <div className="bg-white p-6 rounded-2xl border-2 border-black">
                    <div className="flex items-center gap-2 mb-2 text-gray-600">
                        <ArrowUpRight size={20} /> <span className="text-xs font-black uppercase">Total Pago</span>
                    </div>
                    <h3 className="text-2xl font-black">R$ {stats.totalSpent.toFixed(2).replace('.', ',')}</h3>
                    <p className="text-xs text-gray-400 mt-1">Pagamentos a freelancers</p>
                </div>
            </div>

            {/* Active Escrows */}
            {escrows.filter(e => e.status === 'reserved').length > 0 && (
                <section className="bg-orange-50 border-2 border-orange-200 rounded-2xl p-6">
                    <h3 className="text-lg font-black uppercase mb-4 flex items-center gap-2 text-orange-700">
                        <Lock size={20} /> Valores em Escrow
                    </h3>
                    <div className="space-y-3">
                        {escrows.filter(e => e.status === 'reserved').map((escrow) => (
                            <div key={escrow.id} className="flex justify-between items-center bg-white p-4 rounded-xl border border-orange-200">
                                <div>
                                    <h4 className="font-bold text-sm">{escrow.job?.title || 'Vaga'}</h4>
                                    <p className="text-xs text-gray-400">Reservado em {formatDate(escrow.created_at)}</p>
                                </div>
                                <span className="text-lg font-black text-orange-600">
                                    R$ {escrow.amount.toFixed(2).replace('.', ',')}
                                </span>
                            </div>
                        ))}
                    </div>
                </section>
            )}

            {/* Payment Methods — cartoes on-file para postpago */}
            <PaymentMethodsSection />

            {/* Transactions List */}
            <section className="bg-white border-2 border-black rounded-2xl p-6">
                <h3 className="text-lg font-black uppercase mb-6 flex items-center gap-2">
                    <History size={20} /> Histórico de Transações
                </h3>

                <div className="space-y-4">
                    {transactions.length > 0 ? transactions.map((t) => (
                        <div key={t.id} className="flex justify-between items-center border-b border-gray-100 last:border-0 pb-4 last:pb-0">
                            <div className="flex items-center gap-4">
                                <div className={`p-3 rounded-xl ${getTransactionColor(t.type, t.amount)}`}>
                                    {getTransactionIcon(t.type)}
                                </div>
                                <div>
                                    <h4 className="font-bold text-sm">{getTransactionLabel(t)}</h4>
                                    <p className="text-xs text-gray-400">{formatDate(t.created_at)}</p>
                                </div>
                            </div>
                            <span className={`text-lg font-black ${t.type === 'platform_fee' ? 'text-orange-600' : t.amount >= 0 ? 'text-green-600' : 'text-red-600'}`}>
                                {t.amount >= 0 ? '+' : ''} R$ {Math.abs(t.amount).toFixed(2).replace('.', ',')}
                            </span>
                        </div>
                    )) : (
                        <div className="text-center py-8 text-gray-400">
                            <p className="font-bold text-sm">Nenhuma transação registrada.</p>
                        </div>
                    )}
                </div>
            </section>

        </div>
    );
}
