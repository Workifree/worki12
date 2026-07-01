
import { useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '../lib/supabase';
import PageMeta from '../components/PageMeta';
import {
    Clock, Star, TrendingUp, Award, Zap,
    ChevronRight, CheckCircle2, AlertCircle, Send, Building2, ArrowRight
} from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { useWorkerInvites } from '../hooks/useShiftInvites';
import { useWorkerStores } from '../hooks/useTeamConnections';

interface NextJobData {
    status: string;
    job: {
        title: string;
        date: string;
        start_time: string;
        company: { name: string };
    };
}

interface HistoryItem {
    status: string;
    created_at: string;
    job: {
        title: string;
    };
}

export default function Dashboard() {
    const navigate = useNavigate();

    const { data: authUser } = useQuery({
        queryKey: ['authUser'],
        queryFn: async () => {
            const { data: { user } } = await supabase.auth.getUser();
            return user;
        },
        staleTime: 300000
    });

    // React Query Hooks
    const { data: worker, isLoading: isLoadingWorker } = useQuery({
        queryKey: ['workerProfile'],
        queryFn: async () => {
            const { data: { user } } = await supabase.auth.getUser();
            if (!user) throw new Error('No user');
            const { data } = await supabase.from('workers').select('*').eq('id', user.id).single();
            return data;
        }
    });

    const { data: nextJob } = useQuery({
        queryKey: ['nextJob'],
        queryFn: async () => {
            const { data: { user } } = await supabase.auth.getUser();
            if (!user) return null;
            const { data } = await supabase
                .from('applications')
                .select('status, job:jobs(*, company:companies(name))')
                .eq('worker_id', user.id)
                .in('status', ['approved', 'scheduled', 'hired', 'in_progress'])
                .limit(1)
                .maybeSingle();
            return data as unknown as NextJobData;
        },
        enabled: !!worker
    });

    const { data: history = [] } = useQuery({
        queryKey: ['workerHistory'],
        queryFn: async () => {
            const { data: { user } } = await supabase.auth.getUser();
            if (!user) return [];
            const { data } = await supabase
                .from('applications')
                .select('status, created_at, job:jobs(title)')
                .eq('worker_id', user.id)
                .in('status', ['completed', 'rejected', 'cancelled'])
                .order('created_at', { ascending: false })
                .limit(3);
            return (data as unknown as HistoryItem[]) || [];
        },
        enabled: !!worker
    });

    // Convites de turno pendentes (push, Slice 1) — mesmo hook do InviteTakeover/MyJobs.
    const { pendingInvites, loading: invitesLoading } = useWorkerInvites();

    // "Meus clientes" — empresas conectadas (equipe aceita), atalho para a Carteira.
    const { myStores, loading: storesLoading } = useWorkerStores();

    // Quests Logic (derived from worker data)
    const quests = worker ? [
        { id: 1, title: 'Adicionar Foto de Perfil', xp: 50, done: !!worker.avatar_url, action: '/profile' },
        { id: 2, title: 'Confirmar Email', xp: 100, done: !!authUser?.email_confirmed_at, action: '/profile' },
        { id: 3, title: 'Adicionar Especialidades', xp: 75, done: (worker.roles && worker.roles.length > 0) || !!worker.primary_role, action: '/profile' },
    ] : [];

    // Unified Loading State
    const loading = isLoadingWorker;

    // Prefetching logic could go here, or just rely on the queries running
    useEffect(() => {
        if (!worker && !loading) {
            // User not logged in handled by ProtectedRoute mostly, but good check
            navigate('/login');
        }
    }, [worker, loading, navigate]);

    if (loading) return (
        <div className="flex flex-col gap-6 pb-12 font-sans text-accent animate-pulse">
            <div className="bg-gray-200 rounded-3xl h-24 w-full" />
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                {[...Array(2)].map((_, i) => (
                    <div key={i} className="bg-gray-200 rounded-2xl h-40" />
                ))}
            </div>
            <div className="space-y-4">
                <div className="h-14 bg-gray-200 rounded-xl w-full" />
                {[...Array(2)].map((_, i) => (
                    <div key={i} className="h-24 bg-gray-200 rounded-2xl" />
                ))}
            </div>
        </div>
    );

    if (!worker) return <div>Erro ao carregar dados.</div>;

    // Helper for Quest Progress
    const completedQuests = quests.filter(q => q.done).length;
    const totalQuests = quests.length;

    const primaryInvite = pendingInvites[0];
    const primaryInviteCompany = (primaryInvite?.job?.company as { name?: string } | undefined)?.name ?? 'Empresa';
    const primaryInviteTitle = primaryInvite?.job?.title ?? 'Novo turno';

    return (
        <div className="flex flex-col gap-6 pb-12 font-sans text-accent">
            <PageMeta title="Dashboard" />

            {/* --- WELCOME HEADER (leve — sem barra de XP em destaque) --- */}
            <div className="flex items-center justify-between bg-black text-white p-6 rounded-3xl border-2 border-black">
                <div>
                    <h1 className="text-2xl md:text-3xl font-black uppercase tracking-tight mb-1 flex items-center gap-2">
                        Fala, <span className="text-primary">{worker.full_name?.split(' ')[0]}</span>! <Zap className="text-yellow-400 fill-current" size={22} />
                    </h1>
                    <p className="text-gray-400 font-bold text-sm">Pronto para faturar hoje?</p>
                </div>
                <div className="hidden sm:flex items-center gap-2 bg-white/10 px-3 py-2 rounded-xl border border-white/10 flex-shrink-0">
                    <Award size={16} className="text-primary" />
                    <span className="text-xs font-black uppercase text-gray-300">Lvl {worker.level || 1}</span>
                </div>
            </div>

            {/* --- HERO: CONVITE PENDENTE (push-first) --- */}
            {!invitesLoading && primaryInvite && (
                <section className="bg-primary text-white p-6 rounded-2xl border-2 border-black shadow-[6px_6px_0px_0px_rgba(0,0,0,1)] flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
                    <div className="min-w-0">
                        <span className="inline-flex items-center gap-1.5 bg-black text-primary text-[10px] font-black uppercase px-3 py-1 rounded-pill mb-2">
                            <Send size={12} /> Convite pendente
                        </span>
                        <h2 className="text-xl font-black uppercase truncate">{primaryInviteTitle}</h2>
                        <p className="text-sm font-bold text-white/80 truncate">{primaryInviteCompany} está te chamando para um turno.</p>
                    </div>
                    <button
                        onClick={() => navigate('/my-jobs')}
                        className="bg-black hover:bg-white hover:text-black text-white px-6 py-3 rounded-xl font-black uppercase transition-colors whitespace-nowrap flex-shrink-0"
                    >
                        Ver Convite{pendingInvites.length > 1 ? `s (${pendingInvites.length})` : ''}
                    </button>
                </section>
            )}

            {/* --- PRÓXIMO TURNO + MEUS CLIENTES --- */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">

                {/* Próximo Turno */}
                <div className="bg-black text-white p-6 rounded-2xl border-2 border-black shadow-[4px_4px_0px_0px_rgba(0,0,0,0.3)]">
                    <h3 className="text-lg font-black uppercase mb-4 flex items-center gap-2">
                        <Clock size={18} className="text-primary" /> Próximo Turno
                    </h3>
                    {nextJob ? (
                        <>
                            <div className="bg-white/10 p-4 rounded-xl border border-white/10 mb-4">
                                <div className="flex justify-between items-start mb-2">
                                    <span className="text-2xl font-black">{new Date(nextJob.job.date).getDate()} {new Date(nextJob.job.date).toLocaleString('default', { month: 'short' }).toUpperCase()}</span>
                                    <span className="bg-primary text-black text-[10px] font-bold px-2 py-0.5 rounded-full uppercase">{nextJob.status}</span>
                                </div>
                                <p className="font-bold text-lg leading-tight">{nextJob.job.title}</p>
                                <p className="text-sm text-gray-400">{nextJob.job.start_time || 'Horário indefinido'}</p>
                            </div>
                            <button onClick={() => navigate('/my-jobs')} className="w-full bg-white text-black font-black uppercase py-3 rounded-xl hover:bg-primary hover:text-white transition-colors">
                                Ver Detalhes
                            </button>
                        </>
                    ) : (
                        <div className="text-center py-6 text-gray-500 font-bold bg-white/5 rounded-xl border border-white/5">
                            Nenhum turno agendado.
                        </div>
                    )}
                </div>

                {/* Meus Clientes */}
                <div className="bg-white p-6 rounded-2xl border-2 border-black shadow-sm flex flex-col justify-between">
                    <div>
                        <h3 className="text-lg font-black uppercase mb-4 flex items-center gap-2">
                            <Building2 size={18} /> Meus Clientes
                        </h3>
                        {storesLoading ? (
                            <div className="h-10 bg-gray-100 rounded-xl animate-pulse" />
                        ) : myStores.length > 0 ? (
                            <p className="text-4xl font-black mb-1">{myStores.length}</p>
                        ) : (
                            <p className="text-sm font-bold text-gray-400 mb-4">
                                Você ainda não tem empresas na sua carteira.
                            </p>
                        )}
                        {myStores.length > 0 && (
                            <p className="text-sm font-bold text-gray-500 mb-4">
                                empresa{myStores.length > 1 ? 's' : ''} confiando no seu trabalho.
                            </p>
                        )}
                    </div>
                    <button
                        onClick={() => navigate('/carteira')}
                        className="w-full bg-primary hover:bg-black text-white font-black uppercase py-3 rounded-xl transition-colors flex items-center justify-center gap-2"
                    >
                        Ver Carteira <ArrowRight size={16} />
                    </button>
                </div>
            </div>

            {/* --- ONBOARDING / INVESTMENT (Hooked: Investment) --- */}
            {completedQuests < totalQuests && (
                <section className="bg-[#F4F4F0] border-2 border-black rounded-2xl p-6 relative overflow-hidden">
                    <div className="absolute top-0 left-0 w-2 h-full bg-primary"></div>

                    <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-6 relative z-10">
                        <div>
                            <h3 className="text-xl font-black uppercase mb-1 flex items-center gap-2">
                                <AlertCircle size={20} className="text-primary" /> Complete seu Perfil
                            </h3>
                            <p className="text-sm font-bold text-gray-500">
                                Complete essas tarefas para ganhar <span className="text-black bg-white px-1">XP</span> e passar mais confiança para as empresas.
                            </p>
                        </div>

                        <div className="w-full md:w-auto flex flex-col gap-3">
                            {quests.filter(q => !q.done).slice(0, 2).map(quest => (
                                <button key={quest.id} onClick={() => navigate('/profile')} className="flex items-center justify-between w-full md:w-80 bg-white p-3 rounded-xl border-2 border-gray-200 hover:border-black hover:shadow-md transition-all group text-left">
                                    <span className="text-sm font-bold text-gray-700">{quest.title}</span>
                                    <span className="text-xs font-black bg-primary text-white px-2 py-1 rounded-md group-hover:scale-110 transition-transform">
                                        +{quest.xp} XP
                                    </span>
                                </button>
                            ))}
                        </div>
                    </div>
                </section>
            )}

            {/* --- STANDING PROFISSIONAL (rebaixado — era o herói da tela, agora é secundário) --- */}
            <section className="space-y-3">
                <h2 className="text-xs font-black uppercase text-gray-400 tracking-wide px-1">Seu standing profissional</h2>
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">

                    {/* Level & XP */}
                    <div className="bg-white p-4 rounded-2xl border-2 border-black shadow-[4px_4px_0px_0px_rgba(0,0,0,0.1)]">
                        <div className="flex items-center gap-2 mb-2">
                            <Award size={16} className="text-primary" />
                            <span className="text-xs font-black uppercase text-gray-400">Nível</span>
                        </div>
                        <p className="text-2xl font-black italic mb-2">LVL {worker.level || 1}</p>
                        <div className="h-2 bg-gray-100 rounded-full overflow-hidden">
                            <div className="h-full bg-primary" style={{ width: `${(worker.xp || 0) % 100}%` }} />
                        </div>
                        <p className="text-[10px] text-gray-400 font-bold mt-1">{(worker.xp || 0) % 100}/100 XP para o próximo nível</p>
                    </div>

                    {/* Earnings */}
                    <div className="bg-white p-4 rounded-2xl border-2 border-black shadow-[4px_4px_0px_0px_rgba(0,0,0,0.1)]">
                        <div className="flex items-center gap-2 mb-2">
                            <TrendingUp size={16} className="text-green-600" />
                            <span className="text-xs font-black uppercase text-gray-400">Ganhos Totais</span>
                        </div>
                        <p className="text-2xl font-black truncate" title={`R$ ${worker.earnings_total}`}>R$ {worker.earnings_total || 0}</p>
                    </div>

                    {/* Rating */}
                    <div className="bg-white p-4 rounded-2xl border-2 border-black shadow-[4px_4px_0px_0px_rgba(0,0,0,0.1)]">
                        <div className="flex items-center gap-2 mb-2">
                            <Star size={16} className="text-yellow-500" />
                            <span className="text-xs font-black uppercase text-gray-400">Sua Nota</span>
                        </div>
                        <p className="text-2xl font-black mb-1">{worker.rating_average ?? '-'}</p>
                        <p className="text-[10px] text-gray-400 font-bold">{worker.completed_jobs_count || 0} turnos realizados</p>
                    </div>
                </div>
            </section>

            {/* --- HISTÓRICO RECENTE --- */}
            <section className="bg-white p-6 rounded-2xl border-2 border-black shadow-sm">
                <h3 className="text-lg font-black uppercase mb-4 flex items-center gap-2">
                    <CheckCircle2 size={18} /> Histórico Recente
                </h3>
                <div className="space-y-3">
                    {history.length > 0 ? history.map((h, i) => (
                        <div key={i} className="flex justify-between items-center p-3 hover:bg-gray-50 rounded-lg transition-colors cursor-pointer border-b border-gray-100 last:border-0">
                            <div>
                                <p className="font-bold text-sm truncate max-w-[200px]" title={h.job.title}>{h.job.title}</p>
                                <p className="text-xs text-gray-400">{new Date(h.created_at).toLocaleDateString()}</p>
                            </div>
                            <span className={`text-[10px] font-black uppercase px-2 py-1 rounded-md ${h.status === 'completed' ? 'text-green-600 bg-green-100' : 'text-red-600 bg-red-100'}`}>
                                {h.status === 'completed' ? 'Sucesso' : 'Cancelado'}
                            </span>
                        </div>
                    )) : (
                        <p className="text-sm text-gray-400 text-center py-4">Sem histórico recente.</p>
                    )}
                </div>
                <button onClick={() => navigate('/my-jobs')} className="w-full mt-4 text-xs font-black uppercase text-gray-500 hover:text-black flex items-center justify-center gap-1">
                    Ver tudo <ChevronRight size={12} />
                </button>
            </section>
        </div>
    );
}
