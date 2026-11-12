
import { useEffect } from 'react';
import { EVENTO_CONVITES } from '../hooks/useShiftInvites';
import { formatBRL } from '../lib/currency';
import { levelProgress } from '../lib/gamification';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '../lib/supabase';
import PageMeta from '../components/PageMeta';
import {
    Clock, Star, TrendingUp, Award,
    ChevronRight, CheckCircle2, AlertCircle, Send, Building2, ArrowRight, CalendarClock
} from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { useWorkerInvites } from '../hooks/useShiftInvites';
import { useWorkerStores } from '../hooks/useTeamConnections';
import { normalizeAvailabilityGrade } from '../lib/availability';
import { logError } from '../lib/logger';
import ErroDeCarga from '../components/ErroDeCarga';
import { Button, Card, PageHeader } from '../components/ui';

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
    id: string;
    status: string;
    created_at: string;
    job: {
        title: string;
    };
}

export default function Dashboard() {
    const navigate = useNavigate();
    const queryClient = useQueryClient();

    // Aceitar/recusar convite pelo takeover dispara EVENTO_CONVITES (useShiftInvites), mas as
    // queries do dashboard nao sabiam: o hero fechava e "PROXIMO TURNO" continuava dizendo
    // "Sem proximos turnos" ate remontar — a tela negava o resultado da acao (Nielsen #1).
    useEffect(() => {
        const aoMudarConvites = () => {
            queryClient.invalidateQueries({ queryKey: ['nextJob'] });
            queryClient.invalidateQueries({ queryKey: ['workerHistory'] });
        };
        window.addEventListener(EVENTO_CONVITES, aoMudarConvites);
        return () => window.removeEventListener(EVENTO_CONVITES, aoMudarConvites);
    }, [queryClient]);

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
                .select('id, status, created_at, job:jobs(title)')
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

    // "Minhas Empresas" — empresas conectadas (equipe aceita), atalho para /carteira.
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

    const firstName = worker.full_name?.split(' ')[0] ?? '';
    const progresso = levelProgress(worker.xp || 0);
    const nota = worker.rating_average != null ? Number(worker.rating_average).toFixed(1) : null;
    const temAtencao = pendingReceipts.length > 0 || (!invitesLoading && !!primaryInvite);
    // Uma ação primária por tela: o que está esperando o freela agora ganha o botão cheio; o convite
    // só vira secundário quando um pagamento a confirmar já ocupa o primeiro plano.
    const conviteEhPrimario = pendingReceipts.length === 0;
    const parsedDate = nextJob?.job?.start_date ? new Date(nextJob.job.start_date) : null;
    const hasValidDate = parsedDate instanceof Date && !isNaN(parsedDate.getTime());
    const perfilIncompleto = hasNoDeclaredAvailability || completedQuests < totalQuests;

    return (
        <div className="flex flex-col gap-8 pb-12 font-sans text-accent max-w-5xl mx-auto w-full">
            <PageMeta title="Dashboard" />

            <PageHeader
                className="!mb-0"
                title={firstName ? `Fala, ${firstName}!` : 'Fala!'}
                subtitle="Pronto para faturar hoje?"
            />

            {/* --- PRECISA DA SUA ATENÇÃO (ação pendente, persistente) ---
                Pagamento vem ANTES do convite: é o fecho de um trabalho JÁ FEITO (a empresa
                declarou que pagou; falta o freela confirmar), enquanto o convite é trabalho futuro. */}
            {temAtencao && (
                <section aria-label="Precisa da sua atenção" className="flex flex-col gap-4">
                    {pendingReceipts.length > 0 && (
                        <Card padding="sm" className="shadow-[4px_4px_0px_0px_rgba(0,166,81,1)] flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                            <div className="min-w-0">
                                <span className="inline-flex items-center gap-1.5 bg-primary-light text-primary text-xs font-bold px-3 py-1 rounded-pill mb-2">
                                    <AlertCircle size={12} /> Pagamento para confirmar
                                </span>
                                <p className="text-2xl font-bold tabular-nums truncate">
                                    {totalReceipts.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}
                                </p>
                                <p className="text-sm text-gray-600">
                                    {pendingReceipts.length === 1
                                        ? `${primaryReceiptCompany} registrou este pagamento. Confirme que recebeu.`
                                        : `${pendingReceipts.length} pagamentos registrados aguardando sua confirmação.`}
                                </p>
                            </div>
                            <Button
                                variant="primary"
                                className="sm:flex-shrink-0 w-full sm:w-auto"
                                onClick={() => navigate(pendingReceipts.length === 1 ? `/recibo/${primaryReceipt.job_id}` : '/recebimentos')}
                            >
                                Confirmar recebimento
                            </Button>
                        </Card>
                    )}

                    {!invitesLoading && primaryInvite && (
                        <Card padding="sm" className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                            <div className="min-w-0">
                                <span className="inline-flex items-center gap-1.5 bg-gray-100 text-gray-700 text-xs font-bold px-3 py-1 rounded-pill mb-2">
                                    <Send size={12} /> Convite pendente
                                </span>
                                <h2 className="text-lg font-bold truncate">{primaryInviteTitle}</h2>
                                <p className="text-sm text-gray-600 truncate">{primaryInviteCompany} está te chamando para um turno.</p>
                            </div>
                            <Button
                                variant={conviteEhPrimario ? 'primary' : 'secondary'}
                                className="sm:flex-shrink-0 w-full sm:w-auto"
                                onClick={() => navigate('/my-jobs')}
                            >
                                Ver Convite{pendingInvites.length > 1 ? `s (${pendingInvites.length})` : ''}
                            </Button>
                        </Card>
                    )}
                </section>
            )}

            {/* --- PRÓXIMO TURNO + GANHOS (a resposta de relance) --- */}
            <section className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <Card className="md:col-span-2 flex flex-col">
                    <h2 className="text-lg font-bold mb-4 flex items-center gap-2">
                        <Clock size={18} className="text-primary" /> {nextJob?.status === 'in_progress' ? 'Você está no turno agora' : 'Próximo turno'}
                    </h2>
                    {nextJob ? (
                        <>
                            <div className="flex items-start gap-4 mb-5">
                                <div className="flex-shrink-0 w-16 rounded-xl border-2 border-black bg-gray-50 py-2 text-center">
                                    {hasValidDate ? (
                                        <>
                                            <span className="block text-2xl font-bold leading-none tabular-nums">{parsedDate!.getDate()}</span>
                                            <span className="block mt-1 text-xs font-semibold uppercase tracking-wide text-gray-600">
                                                {parsedDate!.toLocaleString('pt-BR', { month: 'short' }).replace('.', '')}
                                            </span>
                                        </>
                                    ) : (
                                        <span className="block px-1 text-xs font-semibold text-gray-600">Data indefinida</span>
                                    )}
                                </div>
                                <div className="min-w-0 flex-1">
                                    <span className="inline-block mb-1 bg-primary-light text-primary text-xs font-bold px-2.5 py-0.5 rounded-pill">
                                        {nextJob.status === 'in_progress' ? 'Em andamento' : 'Agendado'}
                                    </span>
                                    <p className="font-bold text-lg leading-tight">{nextJob.job.title}</p>
                                    {nextJob.job.company?.name && (
                                        <p className="text-sm text-gray-700">{nextJob.job.company.name}</p>
                                    )}
                                    <p className="text-sm text-gray-600 mt-1">
                                        {nextJob.job.work_start_time
                                            ? `${nextJob.job.work_start_time}${nextJob.job.work_end_time ? ` – ${nextJob.job.work_end_time}` : ''}`
                                            : 'Horário indefinido'}
                                        {nextJob.job.location ? ` · ${nextJob.job.location}` : ''}
                                    </p>
                                </div>
                            </div>
                            <Button
                                variant={temAtencao ? 'secondary' : 'primary'}
                                className="mt-auto w-full sm:w-auto sm:self-start"
                                onClick={() => navigate('/my-jobs')}
                            >
                                Ver Detalhes
                            </Button>
                        </>
                    ) : carregandoNextJob ? (
                        <div className="h-16 bg-gray-100 rounded-xl animate-pulse" />
                    ) : erroNextJob ? (
                        <div className="text-center py-6 text-red-600 text-sm font-bold bg-red-50 rounded-xl border border-red-200">
                            Não foi possível carregar. Recarregue a página.
                        </div>
                    ) : (
                        <div className="text-center py-6 text-sm text-gray-600 bg-gray-50 rounded-xl border border-gray-200">
                            Sem próximos turnos marcados.
                        </div>
                    )}
                </Card>

                <Card className="flex flex-col">
                    <h2 className="text-lg font-bold mb-4 flex items-center gap-2">
                        <TrendingUp size={18} className="text-primary" /> Ganhos
                    </h2>
                    <p className="text-3xl font-bold tabular-nums truncate" title={formatBRL(worker.earnings_total || 0)}>
                        {formatBRL(worker.earnings_total || 0)}
                    </p>
                    <p className="text-sm text-gray-600 mt-1">
                        {worker.completed_jobs_count || 0} turno{(worker.completed_jobs_count || 0) === 1 ? '' : 's'} realizado{(worker.completed_jobs_count || 0) === 1 ? '' : 's'}
                    </p>
                    <p className="mt-auto pt-4 inline-flex items-center gap-1.5 text-sm text-gray-700">
                        <Star size={14} className="text-yellow-500" fill="currentColor" aria-hidden="true" />
                        <span>Sua nota: <span className="font-bold">{nota ?? '—'}</span></span>
                    </p>
                </Card>
            </section>

            {/* --- EMPRESAS + NÍVEL (contexto, sem competir com o que é urgente) --- */}
            <section className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <Card padding="sm" className="flex flex-col justify-between gap-4">
                    <div>
                        <h2 className="text-lg font-bold flex items-center gap-2 mb-2">
                            <Building2 size={16} /> Minhas Empresas
                        </h2>
                        {storesLoading ? (
                            <div className="h-9 bg-gray-100 rounded-xl animate-pulse" />
                        ) : myStores.length > 0 ? (
                            <>
                                <p className="text-3xl font-bold tabular-nums">{myStores.length}</p>
                                <p className="text-sm text-gray-600">
                                    empresa{myStores.length > 1 ? 's' : ''} confiando no seu trabalho.
                                </p>
                            </>
                        ) : (
                            <p className="text-sm text-gray-600">Você ainda não tem empresas conectadas.</p>
                        )}
                    </div>
                    <Button
                        variant="secondary"
                        className="w-full sm:w-auto sm:self-start"
                        onClick={() => navigate('/carteira')}
                        iconRight={<ArrowRight size={16} />}
                    >
                        Ver Empresas
                    </Button>
                </Card>

                <Card padding="sm">
                    <h2 className="text-lg font-bold flex items-center gap-2 mb-2">
                        <Award size={16} className="text-primary" /> Nível
                    </h2>
                    <p className="text-3xl font-bold tabular-nums mb-3">{worker.level || 1}</p>
                    <div
                        className="h-2 bg-gray-100 rounded-full overflow-hidden border border-gray-200"
                        role="progressbar"
                        aria-label="Progresso para o próximo nível"
                        aria-valuemin={0}
                        aria-valuemax={100}
                        aria-valuenow={Math.round(progresso.percent)}
                    >
                        <div className="h-full bg-primary" style={{ width: `${progresso.percent}%` }} />
                    </div>
                    <p className="text-xs text-gray-600 mt-2">
                        {progresso.faltam > 0 ? `Faltam ${progresso.faltam} XP para o próximo nível` : 'Nível máximo!'}
                    </p>
                </Card>
            </section>

            {/* --- COMPLETAR PERFIL (disponibilidade F7 + quests; um bloco só, sem competir com o resto) --- */}
            {perfilIncompleto && (
                <section aria-label="Complete seu perfil">
                    <Card padding="sm" className="bg-[#F4F4F0] flex flex-col gap-4">
                        <h2 className="text-lg font-bold flex items-center gap-2">
                            <AlertCircle size={18} className="text-primary" /> Complete seu perfil
                        </h2>

                        {/* F7 — R14/A10: visível SÓ enquanto o freela nunca declarou disponibilidade. */}
                        {hasNoDeclaredAvailability && (
                            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 bg-white rounded-xl border-2 border-black p-3">
                                <div className="flex items-center gap-3 min-w-0">
                                    <CalendarClock size={20} className="text-primary flex-shrink-0" />
                                    <p className="text-sm text-gray-700 min-w-0">
                                        Declare sua disponibilidade para receber chamados mais certeiros.
                                    </p>
                                </div>
                                <Button variant="secondary" className="w-full sm:w-auto sm:flex-shrink-0" onClick={() => navigate('/profile')}>
                                    Declarar agora
                                </Button>
                            </div>
                        )}

                        {completedQuests < totalQuests && (
                            <div className="flex flex-col gap-2">
                                <p className="text-sm text-gray-600">
                                    Ganhe <span className="font-bold text-black">XP</span> e passe mais confiança para as empresas.
                                </p>
                                {quests.filter(q => !q.done).slice(0, 2).map(quest => (
                                    <button
                                        key={quest.id}
                                        onClick={() => navigate('/profile')}
                                        className="flex items-center justify-between gap-3 w-full min-h-11 bg-white px-3 py-2 rounded-xl border-2 border-gray-300 hover:border-black transition-colors text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-black"
                                    >
                                        <span className="text-sm font-semibold text-gray-800">{quest.title}</span>
                                        {quest.xp > 0 ? (
                                            <span className="text-xs font-bold bg-primary-light text-primary px-2.5 py-1 rounded-pill flex-shrink-0">
                                                +{quest.xp} XP
                                            </span>
                                        ) : (
                                            <span className="text-xs font-bold bg-gray-100 text-gray-700 px-2.5 py-1 rounded-pill flex-shrink-0">
                                                Verificação
                                            </span>
                                        )}
                                    </button>
                                ))}
                            </div>
                        )}
                    </Card>
                </section>
            )}

            {/* --- HISTÓRICO RECENTE --- */}
            <Card as="section">
                <h2 className="text-lg font-bold mb-3 flex items-center gap-2">
                    <CheckCircle2 size={18} /> Histórico recente
                </h2>
                <div>
                    {history.length > 0 ? history.map((h) => (
                        <button
                            type="button"
                            key={h.id}
                            onClick={() => navigate('/my-jobs')}
                            className="flex w-full justify-between items-center gap-3 min-h-14 px-2 -mx-2 py-2 text-left hover:bg-gray-50 rounded-xl transition-colors cursor-pointer border-b border-gray-100 last:border-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-black"
                        >
                            <div className="min-w-0">
                                <p className="font-semibold text-sm truncate" title={h.job.title}>{h.job.title}</p>
                                <p className="text-xs text-gray-600">{new Date(h.created_at).toLocaleDateString('pt-BR')}</p>
                            </div>
                            <span className={`flex-shrink-0 text-xs font-semibold px-2.5 py-1 rounded-pill ${h.status === 'completed' ? 'text-green-700 bg-green-100' : 'text-red-700 bg-red-100'}`}>
                                {h.status === 'completed' ? 'Concluído' : h.status === 'rejected' ? 'Não selecionado' : 'Cancelado'}
                            </span>
                        </button>
                    )) : carregandoHistory ? (
                        <div className="h-12 bg-gray-100 rounded-xl animate-pulse" />
                    ) : erroHistory ? (
                        <p className="text-sm text-red-600 font-bold text-center py-4">Não foi possível carregar o histórico.</p>
                    ) : (
                        <p className="text-sm text-gray-600 text-center py-4">Sem histórico recente.</p>
                    )}
                </div>
                <Button variant="ghost" fullWidth className="mt-3" onClick={() => navigate('/my-jobs')} iconRight={<ChevronRight size={14} />}>
                    Ver tudo
                </Button>
            </Card>
        </div>
    );
}
