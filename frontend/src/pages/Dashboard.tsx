
import { useEffect } from 'react';
import { levelProgress } from '../lib/gamification';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '../lib/supabase';
import PageMeta from '../components/PageMeta';
import {
    Clock, Star, TrendingUp, Award, Zap,
    ChevronRight, CheckCircle2, AlertCircle, Send, Building2, ArrowRight, CalendarClock
} from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { useWorkerInvites } from '../hooks/useShiftInvites';
import { useWorkerStores } from '../hooks/useTeamConnections';
import { normalizeAvailabilityGrade } from '../lib/availability';
import { logError } from '../lib/logger';
import ErroDeCarga from '../components/ErroDeCarga';

interface NextJobData {
    status: string;
    job: {
        title: string;
        start_date: string;
        // A tabela `jobs` NAO tem coluna `start_time`. Esta interface declarava que tinha, e o
        // cast `as unknown as NextJobData[]` impedia o TypeScript de reclamar: o campo vinha
        // sempre `undefined` e o cartao "PROXIMO TURNO" dizia "Horario indefinido" para todo
        // freela, sempre -- inclusive para turnos com horario preenchido.
        work_start_time: string | null;
        work_end_time: string | null;
        location: string | null;
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
    const { data: worker, isLoading: isLoadingWorker, isError: erroWorker, refetch: refetchWorker } = useQuery({
        queryKey: ['workerProfile'],
        queryFn: async () => {
            const { data: { user } } = await supabase.auth.getUser();
            // Sem sessão → null (redireciona pro login). Erro de query → throw: isError segura
            // o redirect — falha transitória de rede/RLS não pode expulsar quem está logado.
            if (!user) return null;
            const { data, error } = await supabase.from('workers').select('*').eq('id', user.id).single();
            if (error) throw error;
            return data;
        }
    });

    const { data: nextJob, isLoading: carregandoNextJob, isError: erroNextJob } = useQuery({
        queryKey: ['nextJob'],
        queryFn: async () => {
            const { data: { user } } = await supabase.auth.getUser();
            if (!user) return null;
            const { data, error } = await supabase
                .from('applications')
                .select('status, job:jobs(*, company:companies(name))')
                .eq('worker_id', user.id)
                .in('status', ['hired', 'in_progress']);
            if (error) throw error;

            const rows = (data as unknown as NextJobData[] | null) ?? [];
            if (rows.length === 0) return null;

            // Turno em andamento tem prioridade sobre qualquer "próximo" agendado.
            const inProgress = rows.find(r => r.status === 'in_progress');
            if (inProgress) return inProgress;

            // PostgREST não ordena de forma confiável por coluna de embed (job.start_date),
            // então ordenamos no cliente e ignoramos linhas sem start_date válido.
            const today = new Date();
            today.setHours(0, 0, 0, 0);

            const upcoming = rows
                .filter(r => r.status === 'hired')
                .filter(r => {
                    const d = r.job?.start_date ? new Date(r.job.start_date) : null;
                    return d instanceof Date && !isNaN(d.getTime()) && d >= today;
                })
                .sort((a, b) => new Date(a.job.start_date).getTime() - new Date(b.job.start_date).getTime());

            return upcoming[0] ?? null;
        },
        enabled: !!worker
    });

    const { data: history = [], isLoading: carregandoHistory, isError: erroHistory } = useQuery({
        queryKey: ['workerHistory'],
        queryFn: async () => {
            const { data: { user } } = await supabase.auth.getUser();
            if (!user) return [];
            const { data, error } = await supabase
                .from('applications')
                .select('status, created_at, job:jobs(title)')
                .eq('worker_id', user.id)
                .in('status', ['completed', 'rejected', 'cancelled'])
                .order('created_at', { ascending: false })
                .limit(3);
            if (error) throw error;
            return (data as unknown as HistoryItem[]) || [];
        },
        enabled: !!worker
    });

    // Convites de turno pendentes (push, Slice 1) — mesmo hook do InviteTakeover/MyJobs.
    const { pendingInvites, loading: invitesLoading } = useWorkerInvites();

    // ── Pagamento registrado aguardando MINHA confirmação ───────────────────────────────────
    // "Pagamento registrado — confirme" só existia como notificação — e notificação é
    // transitória: quando a informação é chave, "uma notificação passiva fácil de ignorar é
    // problemática" (NN/g, Indicators/Validations/Notifications). Ação pendente pede indicador
    // PERSISTENTE onde a pessoa já está. /recebimentos já lista tudo; este card é o elo entre o
    // Início e lá. Best-effort: em erro, loga e some — o dashboard nunca quebra por causa disto.
    interface PendingReceiptRow {
        job_id: string;
        amount: number;
        job: { title: string | null; company: { name: string | null } | { name: string | null }[] | null } |
             { title: string | null; company: { name: string | null } | { name: string | null }[] | null }[] | null;
    }
    const { data: pendingReceipts = [] } = useQuery<PendingReceiptRow[]>({
        queryKey: ['pendingReceipts'],
        queryFn: async () => {
            const { data: { user } } = await supabase.auth.getUser();
            if (!user) return [];
            const { data, error } = await supabase
                .from('shift_payments')
                .select('job_id, amount, job:jobs(title, company:companies(name))')
                .eq('worker_id', user.id)
                .eq('status', 'recorded')
                .is('worker_confirmed_at', null);
            if (error) {
                logError('dashboard.pendingReceipts', error);
                return [];
            }
            return (data ?? []) as unknown as PendingReceiptRow[];
        },
        enabled: !!worker
    });

    // "Meus clientes" — empresas conectadas (equipe aceita), atalho para a Carteira.
    const { myStores, loading: storesLoading } = useWorkerStores();

    // Quests Logic (derived from worker data)
    // R: XP só é concedido por foto de perfil (+50) e especialidades (+75) — ver RPC
    // recompute_my_aggregates(). Confirmar email não gera XP, então essa quest não
    // promete XP (xp: 0 e o selo "+XP" só renderiza quando quest.xp > 0).
    const quests = worker ? [
        { id: 1, title: 'Adicionar Foto de Perfil', xp: 50, done: !!worker.avatar_url, action: '/profile' },
        { id: 2, title: 'Confirmar Email', xp: 0, done: !!authUser?.email_confirmed_at, action: '/profile' },
        { id: 3, title: 'Adicionar Especialidades', xp: 75, done: (worker.roles && worker.roles.length > 0) || !!worker.primary_role, action: '/profile' },
    ] : [];

    // Unified Loading State
    const loading = isLoadingWorker;

    // Prefetching logic could go here, or just rely on the queries running
    useEffect(() => {
        // So expulsa quando de fato NAO ha sessao (worker null sem erro). Query que falhou
        // (rede/RLS) segura o freela na tela com estado de erro — nunca /login.
        if (!worker && !loading && !erroWorker) {
            navigate('/login');
        }
    }, [worker, loading, erroWorker, navigate]);

    if (erroWorker) return (
        <div className="pb-24 max-w-4xl mx-auto pt-6">
            <ErroDeCarga onRetry={() => refetchWorker()} />
        </div>
    );

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

    // F7 — R14/A10: CTA de adoção da grade de disponibilidade, visível SÓ enquanto o freela nunca
    // declarou nada. `normalizeAvailabilityGrade` (não uma checagem ingênua `=== null`) é o único
    // jeito correto de responder isso: o CHECK do banco aceita `{}` (containment de objeto vazio
    // é sempre verdadeiro — achado do security-reviewer), então uma grade gravada como `{}` por
    // qualquer caminho tem de contar como "nunca declarou", igual a `null` literal. A função já
    // poda dias sem nenhum período marcado e devolve `null` nesse caso (mesma regra usada para
    // decidir o que é gravado no banco em `Profile.tsx`), então reusá-la aqui garante que CTA e
    // gravação nunca discordem sobre o que é "vazio".
    const hasNoDeclaredAvailability = normalizeAvailabilityGrade(worker.availability_days) === null;

    const primaryInvite = pendingInvites[0];
    const umOuArray = <T,>(v: T | T[] | null | undefined): T | null => (Array.isArray(v) ? v[0] ?? null : v ?? null);
    const primaryReceipt = pendingReceipts[0];
    const primaryReceiptJob = umOuArray(primaryReceipt?.job);
    const primaryReceiptCompany = umOuArray(primaryReceiptJob?.company)?.name ?? 'Uma empresa';
    const totalReceipts = pendingReceipts.reduce((sum, r) => sum + (r.amount || 0), 0);
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

            {/* --- INDICADOR PERSISTENTE: PAGAMENTO AGUARDANDO CONFIRMAÇÃO ---
                Vem ANTES do convite: é o fecho de um trabalho JÁ FEITO (a empresa declarou que
                pagou; falta o freela confirmar), enquanto o convite é trabalho futuro. --- */}
            {pendingReceipts.length > 0 && (
                <section className="bg-black text-white p-6 rounded-2xl border-2 border-black shadow-[6px_6px_0px_0px_rgba(0,166,81,1)] flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
                    <div className="min-w-0">
                        <span className="inline-flex items-center gap-1.5 bg-primary text-white text-[10px] font-black uppercase px-3 py-1 rounded-pill mb-2">
                            <AlertCircle size={12} /> Pagamento para confirmar
                        </span>
                        <h2 className="text-xl font-black uppercase truncate">
                            {totalReceipts.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}
                        </h2>
                        <p className="text-sm font-bold text-white/80 truncate">
                            {pendingReceipts.length === 1
                                ? `${primaryReceiptCompany} registrou este pagamento. Confirme que recebeu.`
                                : `${pendingReceipts.length} pagamentos registrados aguardando sua confirmação.`}
                        </p>
                    </div>
                    <button
                        onClick={() => navigate(pendingReceipts.length === 1 ? `/recibo/${primaryReceipt.job_id}` : '/recebimentos')}
                        className="bg-primary hover:bg-white hover:text-black text-white px-6 py-3 rounded-xl font-black uppercase transition-colors whitespace-nowrap flex-shrink-0"
                    >
                        Confirmar recebimento
                    </button>
                </section>
            )}

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

            {/* --- CTA: DECLARAR DISPONIBILIDADE (F7 — R14/A10) --- */}
            {hasNoDeclaredAvailability && (
                <section className="bg-white p-4 rounded-2xl border-2 border-black shadow-[4px_4px_0px_0px_rgba(0,166,81,1)] flex items-center justify-between gap-4 flex-wrap">
                    <div className="flex items-center gap-3 min-w-0">
                        <CalendarClock size={20} className="text-primary flex-shrink-0" />
                        <p className="text-sm font-bold text-gray-700 min-w-0">
                            Declare sua disponibilidade para receber chamados mais certeiros.
                        </p>
                    </div>
                    <button
                        onClick={() => navigate('/profile')}
                        className="bg-primary hover:bg-black text-white px-6 py-3 rounded-xl font-black uppercase text-xs transition-colors whitespace-nowrap flex-shrink-0"
                    >
                        Declarar agora
                    </button>
                </section>
            )}

            {/* --- PRÓXIMO TURNO + MEUS CLIENTES --- */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">

                {/* Próximo Turno */}
                <div className="bg-black text-white p-6 rounded-2xl border-2 border-black shadow-[4px_4px_0px_0px_rgba(0,0,0,0.3)]">
                    <h3 className="text-lg font-black uppercase mb-4 flex items-center gap-2">
                        <Clock size={18} className="text-primary" /> {nextJob?.status === 'in_progress' ? 'Você está no turno agora' : 'Próximo Turno'}
                    </h3>
                    {nextJob ? (
                        <>
                            <div className="bg-white/10 p-4 rounded-xl border border-white/10 mb-4">
                                <div className="flex justify-between items-start mb-2">
                                    {(() => {
                                        const parsedDate = nextJob.job?.start_date ? new Date(nextJob.job.start_date) : null;
                                        const hasValidDate = parsedDate instanceof Date && !isNaN(parsedDate.getTime());
                                        return hasValidDate ? (
                                            <span className="text-2xl font-black">{parsedDate!.getDate()} {parsedDate!.toLocaleString('pt-BR', { month: 'short' }).toUpperCase()}</span>
                                        ) : (
                                            <span className="text-sm font-black text-gray-400 uppercase">Data indefinida</span>
                                        );
                                    })()}
                                    <span className="bg-primary text-black text-[10px] font-bold px-2 py-0.5 rounded-full uppercase">
                                        {nextJob.status === 'in_progress' ? 'Em andamento' : 'Agendado'}
                                    </span>
                                </div>
                                <p className="font-bold text-lg leading-tight">{nextJob.job.title}</p>
                                {nextJob.job.company?.name && (
                                    <p className="text-sm font-bold text-gray-300">{nextJob.job.company.name}</p>
                                )}
                                {nextJob.job.location && (
                                    <p className="text-xs text-gray-400 truncate">{nextJob.job.location}</p>
                                )}
                                <p className="text-sm text-gray-400">
                                    {nextJob.job.work_start_time
                                        ? `${nextJob.job.work_start_time}${nextJob.job.work_end_time ? ` – ${nextJob.job.work_end_time}` : ''}`
                                        : 'Horário indefinido'}
                                </p>
                            </div>
                            <button onClick={() => navigate('/my-jobs')} className="w-full bg-white text-black font-black uppercase py-3 rounded-xl hover:bg-primary hover:text-white transition-colors">
                                Ver Detalhes
                            </button>
                        </>
                    ) : carregandoNextJob ? (
                        <div className="h-16 bg-white/5 rounded-xl animate-pulse" />
                    ) : erroNextJob ? (
                        <div className="text-center py-6 text-red-300 font-bold bg-white/5 rounded-xl border border-red-400/30">
                            Não foi possível carregar. Recarregue a página.
                        </div>
                    ) : (
                        <div className="text-center py-6 text-gray-500 font-bold bg-white/5 rounded-xl border border-white/5">
                            Sem próximos turnos marcados.
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
                                    {quest.xp > 0 ? (
                                        <span className="text-xs font-black bg-primary text-white px-2 py-1 rounded-md group-hover:scale-110 transition-transform">
                                            +{quest.xp} XP
                                        </span>
                                    ) : (
                                        <span className="text-xs font-black bg-gray-200 text-gray-600 px-2 py-1 rounded-md group-hover:scale-110 transition-transform">
                                            Verificação
                                        </span>
                                    )}
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
                            <div className="h-full bg-primary" style={{ width: `${levelProgress(worker.xp || 0).percent}%` }} />
                        </div>
                        <p className="text-[10px] text-gray-400 font-bold mt-1">{levelProgress(worker.xp || 0).faltam > 0 ? `Faltam ${levelProgress(worker.xp || 0).faltam} XP para o próximo nível` : 'Nível máximo!'}</p>
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
                                <p className="text-xs text-gray-400">{new Date(h.created_at).toLocaleDateString('pt-BR')}</p>
                            </div>
                            <span className={`text-[10px] font-black uppercase px-2 py-1 rounded-md ${h.status === 'completed' ? 'text-green-600 bg-green-100' : 'text-red-600 bg-red-100'}`}>
                                {h.status === 'completed' ? 'Sucesso' : h.status === 'rejected' ? 'Não selecionado' : 'Cancelado'}
                            </span>
                        </div>
                    )) : carregandoHistory ? (
                        <div className="h-12 bg-gray-100 rounded-xl animate-pulse" />
                    ) : erroHistory ? (
                        <p className="text-sm text-red-500 font-bold text-center py-4">Não foi possível carregar o histórico.</p>
                    ) : (
                        <p className="text-sm text-gray-400 text-center py-4">Sem histórico recente.</p>
                    )}
                </div>
                <button onClick={() => navigate('/my-jobs')} className="min-h-11 px-2 -mx-2 inline-flex items-center w-full mt-4 text-xs font-black uppercase text-gray-500 hover:text-black flex items-center justify-center gap-1">
                    Ver tudo <ChevronRight size={12} />
                </button>
            </section>
        </div>
    );
}
