import { useEffect, useState, useCallback } from 'react';
import { supabase } from '../lib/supabase';
import { WalletService } from '../services/walletService';
import PageMeta from '../components/PageMeta';
import type { WalletTransaction } from '../services/walletService';
import { DollarSign, CreditCard, ArrowDownLeft, ArrowUpRight, History, Loader2, Wallet as WalletIcon, X } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { useToast } from '../contexts/ToastContext';
import { validateCPF, validateCNPJ, EMAIL_REGEX } from '../lib/validation';

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default function Wallet() {
    const navigate = useNavigate();
    const [loading, setLoading] = useState(true);
    const [balance, setBalance] = useState(0);
    const [transactions, setTransactions] = useState<WalletTransaction[]>([]);
    const [stats, setStats] = useState({ income: 0, pending: 0 });
    const [withdrawing, setWithdrawing] = useState(false);
    const [showWithdrawModal, setShowWithdrawModal] = useState(false);
    const [withdrawAmount, setWithdrawAmount] = useState('');
    const [pixKey, setPixKey] = useState('');
    const [pixKeyType, setPixKeyType] = useState('CPF');
    const { addToast } = useToast();

    const fetchWalletData = useCallback(async () => {
        const { data: { user } } = await supabase.auth.getUser();
        if (!user) return navigate('/login');

        // 1. Get or create worker wallet
        const wallet = await WalletService.getOrCreateWallet(user.id, 'worker');
        if (wallet) {
            setBalance(wallet.balance);
        }

        // 2. Fetch Transactions
        const txs = await WalletService.getTransactions(user.id);
        setTransactions(txs);

        // 3. Calculate Stats
        const income = txs
            .filter(t => t.type === 'escrow_release' || t.amount > 0)
            .reduce((acc, t) => acc + Math.abs(t.amount), 0);

        // Fetch pending escrows (jobs that are hired but not completed)
        const { data: pendingApps } = await supabase
            .from('applications')
            .select('job:jobs(budget)')
            .eq('worker_id', user.id)
            .eq('status', 'hired');

        const pending = (pendingApps || []).reduce((acc: number, app: unknown) => {
            const record = app as { job: { budget: number } | null };
            return acc + (record.job?.budget || 0);
        }, 0);

        setStats({ income, pending });

        setLoading(false);
    }, [navigate]);

    useEffect(() => {
        let isMounted = true;
        const init = async () => {
            await fetchWalletData();

            const res = await WalletService.syncBalance();
            if (isMounted && res.success && res.hasUpdates) {
                await fetchWalletData();
            }
        };

        init();
        return () => { isMounted = false; };
    }, [fetchWalletData]);

    const handleWithdraw = async () => {
        const amount = parseFloat(withdrawAmount);
        if (!amount || amount < 5) {
            addToast('Valor mínimo para saque: R$ 5,00', 'error');
            return;
        }
        if (amount > 50000) {
            addToast('Valor máximo para saque: R$ 50.000,00', 'error');
            return;
        }
        if (amount > balance) {
            addToast('Saldo insuficiente.', 'error');
            return;
        }
        if (!pixKey.trim()) {
            addToast('Insira sua chave PIX.', 'error');
            return;
        }

        // PIX key format validation with checksum
        const key = pixKey.trim();
        if (pixKeyType === 'CPF') {
            const digits = key.replace(/\D/g, '');
            if (!validateCPF(digits)) {
                addToast('CPF invalido. Verifique os digitos.', 'error');
                return;
            }
        }
        if (pixKeyType === 'CNPJ') {
            const digits = key.replace(/\D/g, '');
            if (!validateCNPJ(digits)) {
                addToast('CNPJ invalido. Verifique os digitos.', 'error');
                return;
            }
        }
        if (pixKeyType === 'EMAIL' && !EMAIL_REGEX.test(key)) {
            addToast('Formato de email invalido. Use: usuario@dominio.com', 'error');
            return;
        }
        if (pixKeyType === 'PHONE') {
            const digits = key.replace(/\D/g, '');
            if (digits.length < 10 || digits.length > 13) {
                addToast('Telefone invalido. Use formato: +5511999999999', 'error');
                return;
            }
        }
        if (pixKeyType === 'EVP' && !UUID_REGEX.test(key)) {
            addToast('Chave aleatoria invalida. Use formato UUID.', 'error');
            return;
        }

        const percentFee = parseFloat((amount * 0.05).toFixed(2));
        const fixedFee = 3.00;
        const totalFee = parseFloat((fixedFee + percentFee).toFixed(2));
        const net = parseFloat((amount - totalFee).toFixed(2));
        if (!window.confirm(`Confirmar saque de R$ ${amount.toFixed(2)}?\n\nTaxa de servico Worki (5%): R$ ${percentFee.toFixed(2)}\nTaxa do operador financeiro: R$ ${fixedFee.toFixed(2)}\nTotal de taxas: R$ ${totalFee.toFixed(2)}\nVoce recebera: R$ ${net.toFixed(2)}\n\nEsta acao nao pode ser desfeita.`)) {
            return;
        }

        setWithdrawing(true);

        const { success, error } = await WalletService.withdrawFunds(amount, pixKey.trim(), pixKeyType);

        if (success) {
            addToast('Saque solicitado com sucesso! O valor será transferido para sua chave PIX.', 'success');
            setShowWithdrawModal(false);
            setWithdrawAmount('');
            setPixKey('');
            fetchWalletData();
        } else {
            addToast(error || 'Erro ao processar saque.', 'error');
        }
        setWithdrawing(false);
    };

    const formatDate = (dateStr: string) => {
        return new Date(dateStr).toLocaleDateString('pt-BR', {
            day: '2-digit',
            month: 'short',
            year: 'numeric'
        });
    };

    const getTransactionIcon = (type: string) => {
        switch (type) {
            case 'escrow_release': return <ArrowDownLeft size={20} />;
            case 'debit': return <ArrowUpRight size={20} />;
            default: return <DollarSign size={20} />;
        }
    };

    if (loading) return (
        <div className="flex flex-col gap-8 pb-12 max-w-4xl mx-auto animate-pulse">
            <div>
                <div className="h-10 bg-gray-200 rounded w-1/3 mb-2" />
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
            <PageMeta title="Carteira" />

            <header>
                <h2 className="text-4xl font-black uppercase tracking-tighter mb-2">Carteira</h2>
                <p className="text-gray-500">Seus ganhos e pagamentos</p>
            </header>

            {/* Main Balance Card */}
            <div className="bg-black text-white p-8 rounded-2xl border-2 border-black shadow-[6px_6px_0px_0px_rgba(0,166,81,1)] relative overflow-hidden">
                <div className="relative z-10">
                    <span className="text-sm font-bold uppercase text-gray-400 tracking-wider">Saldo Disponível</span>
                    <h2 className="text-6xl font-black tracking-tighter text-white mt-2 mb-6">R$ {balance.toFixed(2).replace('.', ',')}</h2>

                    <div className="flex gap-4">
                        <button
                            className="flex-1 bg-primary text-white py-4 rounded-xl font-black uppercase shadow-[4px_4px_0px_0px_rgba(255,255,255,0.2)] hover:shadow-none hover:translate-y-1 transition-all flex items-center justify-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:shadow-[4px_4px_0px_0px_rgba(255,255,255,0.2)] disabled:hover:translate-y-0"
                            onClick={() => { setWithdrawAmount(balance.toFixed(2)); setShowWithdrawModal(true); }}
                            disabled={balance <= 0}
                        >
                            <ArrowDownLeft size={20} /> Sacar (Pix)
                        </button>
                        <button
                            className="flex-1 bg-white/10 text-white py-4 rounded-xl font-bold uppercase hover:bg-white/20 transition-colors flex items-center justify-center gap-2"
                            onClick={() => navigate('/profile')}
                        >
                            <CreditCard size={20} /> Ver Perfil
                        </button>
                    </div>
                    {balance <= 0 && (
                        <p className="text-xs text-red-500 mt-1">Saldo insuficiente para saque</p>
                    )}
                </div>
                {/* Background Element */}
                <WalletIcon size={200} className="absolute -top-10 -right-10 text-white/5 rotate-12" />
            </div>

            {/* Withdraw Modal */}
            {showWithdrawModal && (
                <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4" onClick={() => setShowWithdrawModal(false)} onKeyDown={(e) => { if (e.key === 'Escape') setShowWithdrawModal(false); }}>
                    <div role="dialog" aria-modal="true" aria-label="Sacar via PIX" className="bg-white rounded-2xl border-2 border-black p-6 w-full max-w-md space-y-4" onClick={e => e.stopPropagation()}>
                        <div className="flex justify-between items-center">
                            <h3 className="text-xl font-black uppercase">Sacar via PIX</h3>
                            <button onClick={() => setShowWithdrawModal(false)} aria-label="Fechar" className="p-1 hover:bg-gray-100 rounded-lg">
                                <X size={20} />
                            </button>
                        </div>

                        <div className="space-y-3">
                            <div>
                                <label className="text-xs font-bold uppercase block mb-1">Valor do Saque (R$)</label>
                                <input
                                    type="number"
                                    value={withdrawAmount}
                                    onChange={e => setWithdrawAmount(e.target.value)}
                                    className="w-full border-2 border-gray-200 rounded-xl p-3 font-bold focus:border-black outline-none"
                                    placeholder="0.00"
                                    min="5"
                                    max={balance}
                                    step="0.01"
                                />
                            </div>

                            <div>
                                <label className="text-xs font-bold uppercase block mb-1">Tipo da Chave PIX</label>
                                <select
                                    value={pixKeyType}
                                    onChange={e => setPixKeyType(e.target.value)}
                                    className="w-full border-2 border-gray-200 rounded-xl p-3 font-bold focus:border-black outline-none appearance-none"
                                >
                                    <option value="CPF">CPF</option>
                                    <option value="CNPJ">CNPJ</option>
                                    <option value="EMAIL">E-mail</option>
                                    <option value="PHONE">Telefone</option>
                                    <option value="EVP">Chave Aleatoria</option>
                                </select>
                            </div>

                            <div>
                                <label className="text-xs font-bold uppercase block mb-1">Chave PIX</label>
                                <input
                                    type="text"
                                    value={pixKey}
                                    onChange={e => setPixKey(e.target.value)}
                                    className="w-full border-2 border-gray-200 rounded-xl p-3 font-bold focus:border-black outline-none"
                                    placeholder={pixKeyType === 'EMAIL' ? 'email@exemplo.com' : pixKeyType === 'PHONE' ? '11999999999' : pixKeyType === 'EVP' ? 'xxxxxxxx-xxxx-xxxx-xxxx' : '000.000.000-00'}
                                />
                            </div>

                            {parseFloat(withdrawAmount) > 0 && (() => {
                                const wAmt = parseFloat(withdrawAmount);
                                const wPercentFee = parseFloat((wAmt * 0.05).toFixed(2));
                                const wFixedFee = 3.00;
                                const wTotalFee = parseFloat((wFixedFee + wPercentFee).toFixed(2));
                                const wNet = parseFloat((wAmt - wTotalFee).toFixed(2));

                                return (
                                    <div className="bg-gray-50 rounded-xl p-3 text-sm space-y-1">
                                        <div className="flex justify-between">
                                            <span className="text-gray-500">Valor do saque</span>
                                            <span className="font-bold">R$ {wAmt.toFixed(2)}</span>
                                        </div>
                                        <div className="flex justify-between">
                                            <span className="text-gray-500">Taxa de servico Worki (5%)</span>
                                            <span className="font-bold text-red-500">- R$ {wPercentFee.toFixed(2)}</span>
                                        </div>
                                        <div className="flex justify-between">
                                            <span className="text-gray-500">Taxa do operador financeiro</span>
                                            <span className="font-bold text-red-500">- R$ {wFixedFee.toFixed(2)}</span>
                                        </div>
                                        <div className="flex justify-between border-t pt-1">
                                            <span className="font-bold">Voce recebe via PIX</span>
                                            <span className="font-black text-green-600">R$ {wNet.toFixed(2)}</span>
                                        </div>
                                        <p className="text-xs text-gray-400 mt-1">Taxas cobradas apenas no saque. Seu saldo na plataforma e o valor bruto ganho nos jobs.</p>
                                    </div>
                                );
                            })()}

                            <button
                                onClick={handleWithdraw}
                                disabled={withdrawing || !pixKey.trim() || parseFloat(withdrawAmount) < 5}
                                className="w-full bg-primary text-white py-4 rounded-xl font-black uppercase flex items-center justify-center gap-2 hover:opacity-90 transition-all disabled:opacity-50"
                            >
                                {withdrawing ? <Loader2 className="animate-spin" size={20} /> : <><ArrowDownLeft size={20} /> Confirmar Saque</>}
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {/* Stats Cards */}
            <div className="grid grid-cols-2 gap-6">
                <div className="bg-white p-6 rounded-2xl border-2 border-black">
                    <div className="flex items-center gap-2 mb-2 text-green-600">
                        <ArrowDownLeft size={20} /> <span className="text-xs font-black uppercase">Total Recebido</span>
                    </div>
                    <h3 className="text-2xl font-black">R$ {stats.income.toFixed(2).replace('.', ',')}</h3>
                    <p className="text-xs text-gray-400 mt-1">Pagamentos por turnos</p>
                </div>
                <div className="bg-white p-6 rounded-2xl border-2 border-black">
                    <div className="flex items-center gap-2 mb-2 text-orange-600">
                        <DollarSign size={20} /> <span className="text-xs font-black uppercase">A Receber</span>
                    </div>
                    <h3 className="text-2xl font-black">R$ {stats.pending.toFixed(2).replace('.', ',')}</h3>
                    <p className="text-xs text-gray-400 mt-1">Turnos em andamento</p>
                </div>
            </div>

            {/* Transactions List */}
            <section className="bg-white border-2 border-black rounded-2xl p-6">
                <h3 className="text-lg font-black uppercase mb-6 flex items-center gap-2">
                    <History size={20} /> Histórico de Transações
                </h3>

                <div className="space-y-4">
                    {transactions.length > 0 ? transactions.map((t) => (
                        <div key={t.id} className="flex justify-between items-center border-b border-gray-100 last:border-0 pb-4 last:pb-0">
                            <div className="flex items-center gap-4">
                                <div className={`p-3 rounded-xl ${t.amount > 0 ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-500'}`}>
                                    {getTransactionIcon(t.type)}
                                </div>
                                <div>
                                    <h4 className="font-bold text-sm">{t.description || 'Transação'}</h4>
                                    <p className="text-xs text-gray-400">{formatDate(t.created_at)}</p>
                                </div>
                            </div>
                            <span className={`text-lg font-black ${t.amount > 0 ? 'text-green-600' : 'text-gray-900'}`}>
                                {t.amount > 0 ? '+' : ''} R$ {Math.abs(t.amount).toFixed(2).replace('.', ',')}
                            </span>
                        </div>
                    )) : (
                        <div className="text-center py-8 text-gray-400">
                            <WalletIcon size={48} className="mx-auto mb-4 opacity-30" />
                            <p className="font-bold text-sm">Nenhuma transação ainda.</p>
                            <p className="text-xs mt-1">Complete turnos para começar a ganhar!</p>
                        </div>
                    )}
                </div>
            </section>

        </div>
    );
}
