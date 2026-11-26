
import { useCallback, useEffect, useState } from 'react';
import { EVENTO_CONVITES } from '../hooks/useShiftInvites';
import { formatBRL } from '../lib/currency';
import { levelProgress } from '../lib/gamification';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '../lib/supabase';
import PageMeta from '../components/PageMeta';
import { Star, ChevronRight, AlertCircle, Send, CalendarClock } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { useWorkerInvites } from '../hooks/useShiftInvites';
import { useWorkerStores } from '../hooks/useTeamConnections';
import { normalizeAvailabilityGrade } from '../lib/availability';
import { logError } from '../lib/logger';
import ErroDeCarga from '../components/ErroDeCarga';
import { Alert, Button, Card, ListRow, PageHeader, StatusBadge } from '../components/ui';
import TodayShiftCard from '../components/TodayShiftCard';
import { useLiveRefresh } from '../hooks/useLiveRefresh';
import { workerShiftSources, workerTeamSources } from '../lib/realtime/liveSources';
import { isTodayShift } from '../lib/checkinWindow';
import { getSessionUserOrThrow } from '../lib/authSession';
import { isOnShift, hasLeftShift } from '../lib/shiftPresence';
import { getMyWorkerProfile } from '../services/workerIdentityService';

interface NextJobData {
    id: string;
    status: string;
    worker_checkin_at: string | null;
    worker_checkout_at: string | null;
    company_checkin_confirmed_at: string | null;
    company_checkout_confirmed_at: string | null;
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
        budget?: number | null;
        presence_mode?: string | null;
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
        networkMode: 'always',
        queryFn: async () => {
            const user = await getSessionUserOrThrow();
            return user;
        },
        staleTime: 300000
    });

    // React Query Hooks
    const { data: worker, isLoading: isLoadingWorker, isLoadingError: erroWorker, refetch: refetchWorker } = useQuery({
        queryKey: ['workerProfile'],
        networkMode: 'always',
        queryFn: async () => {
            const user = await getSessionUserOrThrow();
            // Sem sessão → null (redireciona pro login). Erro de query → throw: isError segura
            // o redirect — falha transitória de rede/RLS não pode expulsar quem está logado.
            if (!user) return null;
            const { data, error } = await getMyWorkerProfile(user.id);
            if (error) throw error;
            return data;
        }
    });

    const { data: shifts, isLoading: carregandoNextJob, isLoadingError: erroNextJob, refetch: refetchNextJob } = useQuery({
        queryKey: ['nextJob'],
        networkMode: 'always',
        queryFn: async () => {
            const user = await getSessionUserOrThrow();
            if (!user) return null;
            const { data, error } = await supabase
                .from('applications')
                .select('id, status, worker_checkin_at, worker_checkout_at, company_checkin_confirmed_at, company_checkout_confirmed_at, job:jobs(*, company:companies(name))')
                .eq('worker_id', user.id)
                .in('status', ['hired', 'in_progress']);
            if (error) throw error;

            const rows = ((data as unknown as NextJobData[] | null) ?? []).filter((r) => !!r.job);

            // Hoje (em curso, janela aberta ou turno do dia) vai para o cartão de presença no topo.
            const todays = rows
                .filter((r) => isTodayShift({
                    ...r,
                    startDate: r.job.start_date,
                    startTime: r.job.work_start_time,
                    endTime: r.job.work_end_time,
                }))
                .sort((a, b) => `${a.job.start_date}${a.job.work_start_time}`.localeCompare(`${b.job.start_date}${b.job.work_start_time}`));

            // PostgREST não ordena de forma confiável por coluna de embed (job.start_date),
            // então ordenamos no cliente e ignoramos linhas sem start_date válido.
            const today = new Date();
            today.setHours(0, 0, 0, 0);

            const upcoming = rows
                .filter(r => !todays.includes(r))
                // Turno com saída registrada já acabou para o freela: não é o "próximo".
                // (`in_progress` sem carimbo nenhum segue aqui, como turno agendado.)
                .filter(r => !hasLeftShift(r))
                .filter(r => {
                    const d = r.job.start_date ? new Date(r.job.start_date) : null;
                    return d instanceof Date && !isNaN(d.getTime()) && d >= today;
                })
                .sort((a, b) => new Date(a.job.start_date).getTime() - new Date(b.job.start_date).getTime());

            return { todays, next: upcoming[0] ?? null };
        },
        enabled: !!worker
    });

    const { data: history = [], isLoading: carregandoHistory, isLoadingError: erroHistory, refetch: refetchHistory } = useQuery({
        queryKey: ['workerHistory'],
        networkMode: 'always',
        queryFn: async () => {
            const user = await getSessionUserOrThrow();
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
    const { pendingInvites, loading: invitesLoading, error: invitesError, refresh: refreshInvites } = useWorkerInvites();

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
    const { data: pendingReceipts = [], isLoadingError: erroReceipts, refetch: refetchReceipts } = useQuery<PendingReceiptRow[]>({
        queryKey: ['pendingReceipts'],
        networkMode: 'always',
        queryFn: async () => {
            const user = await getSessionUserOrThrow();
            if (!user) return [];
            const { data, error } = await supabase
                .from('shift_payments')
                .select('job_id, amount, job:jobs(title, company:companies(name))')
                .eq('worker_id', user.id)
                .eq('status', 'recorded')
                .is('worker_confirmed_at', null);
            if (error) {
                logError('dashboard.pendingReceipts', error);
                // Lança: lista vazia esconderia um pagamento esperando confirmação.
                throw error;
            }
            return (data ?? []) as unknown as PendingReceiptRow[];
        },
        enabled: !!worker
    });

    // "Minhas Empresas" — empresas conectadas (equipe aceita), atalho para /carteira.
    const { myStores, loading: storesLoading, erroCarga: erroStores, refresh: refreshStores } = useWorkerStores();

    // Ao vivo: turnos, convites, pagamentos e empresas. Espera o registro de presença terminar.
    const [busyCards, setBusyCards] = useState(0);
    const trackBusyCard = useCallback((busy: boolean) => setBusyCards((n) => n + (busy ? 1 : -1)), []);
    useLiveRefresh({
        sources: authUser ? [...workerShiftSources(authUser.id), ...workerTeamSources(authUser.id)] : [],
        onRefresh: () => Promise.all([
            refetchNextJob(), refetchHistory(), refetchReceipts(),
            refreshInvites?.({ silent: true }), refreshStores?.({ silent: true }),
        ]),
        paused: !worker || busyCards > 0,
    });

    // Quests Logic (derived from worker data)
    // R: XP só é concedido por foto de perfil (+50) e especialidades (+75) — ver RPC
    // recompute_my_aggregates(). Confirmar email não gera XP, então essa quest não
    // promete XP (xp: 0 e o selo "+XP" só renderiza quando quest.xp > 0).
    const quests = worker ? [
        { id: 1, title: 'Adicionar foto de perfil', xp: 50, done: !!worker.avatar_url, action: '/profile' },
        { id: 2, title: 'Confirmar e-mail', xp: 0, done: !!authUser?.email_confirmed_at, action: '/profile' },
        { id: 3, title: 'Adicionar especialidades', xp: 75, done: (worker.roles && worker.roles.length > 0) || !!worker.primary_role, action: '/profile' },
    ] : [];

    const todays = shifts?.todays ?? [];
    const nextJob = shifts?.next ?? null;

    // Unified Loading State
    const loading = isLoadingWorker;

    // Prefetching logic could go here, or just rely on the queries running
    useEffect(() => {
        // So expulsa quando de fato NAO ha sessao (worker null sem erro). Query que falhou
        // (rede/RLS) segura o freela na tela com estado de erro — nunca /login.
        // `null` = a consulta respondeu "sem sessão". `undefined` = ainda não sabemos.
        if (worker === null && !loading && !erroWorker) {
            navigate('/login');
        }
    }, [worker, loading, erroWorker, navigate]);

    if (erroWorker) return (
        <div className="pb-24 max-w-4xl mx-auto pt-6">
            <ErroDeCarga onRetry={() => refetchWorker()} />
        </div>
    );

    if (loading) return (
        <div className="flex flex-col gap-6 pb-12 font-sans text-accent animate-pulse" role="status"><span className="sr-only">Carregando</span>
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

    const falhaParcial = erroNextJob || erroHistory || erroReceipts || !!invitesError || !!erroStores;
    const tentarDeNovo = () => {
        if (erroNextJob) void refetchNextJob();
        if (erroHistory) void refetchHistory();
        if (erroReceipts) void refetchReceipts();
        if (invitesError) void refreshInvites?.();
        if (erroStores) void refreshStores?.();
    };

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
    const valoresInformados = pendingReceipts.every((r) => r.amount > 0);
    const totalReceipts = pendingReceipts.reduce((sum, r) => sum + (r.amount || 0), 0);
    const primaryInviteCompany = (primaryInvite?.job?.company as { name?: string } | undefined)?.name ?? 'Empresa';
    const primaryInviteTitle = primaryInvite?.job?.title ?? 'Novo turno';

    const firstName = worker.full_name?.split(' ')[0] ?? '';
    const progresso = levelProgress(worker.xp || 0, worker.level || 1);
    const nota = worker.rating_average != null ? Number(worker.rating_average).toFixed(1) : null;
    const temAtencao = pendingReceipts.length > 0 || (!invitesLoading && !!primaryInvite);
    // Uma ação primária por tela: o que está esperando o freela agora ganha o botão cheio; o convite
    // só vira secundário quando um pagamento a confirmar já ocupa o primeiro plano.
    const conviteEhPrimario = pendingReceipts.length === 0;
    const temTurnoHoje = todays.length > 0;
    const semPix = !String(worker.pix_key ?? '').trim();
    const parsedDate = nextJob?.job?.start_date ? new Date(nextJob.job.start_date) : null;
    const hasValidDate = parsedDate instanceof Date && !isNaN(parsedDate.getTime());
    const perfilIncompleto = hasNoDeclaredAvailability || completedQuests < totalQuests;

    const empresasValor = storesLoading ? '…' : erroStores ? '—' : String(myStores.length);
    const realizados = worker.completed_jobs_count || 0;

    return (
        <div className="flex flex-col gap-6 pb-12 font-sans text-accent max-w-5xl mx-auto w-full">
            <PageMeta title="Início" />

            <PageHeader
                className="mb-0"
                title={firstName ? `Fala, ${firstName}!` : 'Fala!'}
                subtitle={temTurnoHoje
                    ? `Você tem ${todays.length === 1 ? '1 turno' : `${todays.length} turnos`} para agora.`
                    : 'Seus turnos, presença e recibos.'}
            />

            {falhaParcial && (
                <ErroDeCarga onRetry={tentarDeNovo} mensagem="Parte das suas informações não carregou. Tente de novo." />
            )}

            {/* --- HOJE: o único cartão em foco da tela --- */}
            {temTurnoHoje && (
                <section aria-label="Hoje" className="flex flex-col gap-3">
                    {todays.map((t) => (
                        <TodayShiftCard
                            key={t.id}
                            heading={isOnShift(t) ? 'Você está no turno agora' : 'Próximo turno'}
                            shift={{
                                applicationId: t.id,
                                status: t.status,
                                title: t.job.title,
                                companyName: t.job.company?.name || 'Empresa',
                                startDate: t.job.start_date,
                                startTime: t.job.work_start_time,
                                endTime: t.job.work_end_time,
                                location: t.job.location,
                                pay: t.job.budget ?? null,
                                presenceMode: t.job.presence_mode,
                                worker_checkin_at: t.worker_checkin_at,
                                worker_checkout_at: t.worker_checkout_at,
                                company_checkin_confirmed_at: t.company_checkin_confirmed_at,
                                company_checkout_confirmed_at: t.company_checkout_confirmed_at,
                            }}
                            onChanged={() => refetchNextJob()}
                            onBusyChange={trackBusyCard}
                        />
                    ))}
                </section>
            )}

            {/* --- PRECISA DA SUA ATENÇÃO (avisos curtos: texto + um botão) ---
                Pagamento vem ANTES do convite: é o fecho de um trabalho JÁ FEITO (a empresa
                declarou que pagou; falta o freela confirmar), enquanto o convite é trabalho futuro. */}
            {temAtencao && (
                <section aria-label="Precisa da sua atenção" className="flex flex-col gap-3">
                    {pendingReceipts.length > 0 && (
                        <div className="rounded-2xl border border-primary/40 bg-primary-light px-4 py-3">
                            <p className="flex items-center gap-1.5 text-sm font-semibold text-primary-ink">
                                <AlertCircle size={14} aria-hidden="true" className="shrink-0" />
                                {valoresInformados ? 'Pagamento para confirmar' : 'Pagamento sem valor'}
                            </p>
                            <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2">
                                <p className="min-w-0 text-xl font-bold tabular-nums [overflow-wrap:anywhere]">
                                    {valoresInformados ? formatBRL(totalReceipts) : 'Valor não informado'}
                                </p>
                                <Button
                                    size="sm"
                                    variant={temTurnoHoje ? 'secondary' : 'primary'}
                                    data-copilot="freela.inicio.confirmar-recebimento"
                                    className="shrink-0"
                                    onClick={() => navigate(pendingReceipts.length === 1 ? `/recibo/${primaryReceipt.job_id}` : '/recebimentos')}
                                >
                                    {valoresInformados ? 'Confirmar recebimento' : pendingReceipts.length === 1 ? 'Ver recibo' : 'Ver recebimentos'}
                                </Button>
                            </div>
                            <p className="mt-1 text-xs text-gray-700 line-clamp-2">
                                {pendingReceipts.length === 1
                                    ? `${primaryReceiptCompany} registrou este pagamento. ${valoresInformados ? 'Confirme que recebeu.' : 'Sem o valor não dá para confirmar: fale com a empresa pelo recibo.'}`
                                    : `${pendingReceipts.length} pagamentos registrados aguardando sua confirmação.`}
                            </p>
                        </div>
                    )}

                    {!invitesLoading && primaryInvite && (
                        <div className="flex flex-wrap items-center gap-x-3 gap-y-2 rounded-2xl border border-gray-200 bg-white p-4">
                            <div className="min-w-0 flex-1 basis-48">
                                <p className="flex items-center gap-1.5 text-sm font-semibold text-gray-600">
                                    <Send size={14} aria-hidden="true" className="shrink-0" /> Convite pendente
                                </p>
                                <h2 className="text-base font-bold truncate">{primaryInviteTitle}</h2>
                                <p className="text-xs text-gray-600 truncate">{primaryInviteCompany} está te chamando para um turno.</p>
                            </div>
                            <Button
                                size="sm"
                                variant={conviteEhPrimario && !temTurnoHoje ? 'primary' : 'secondary'}
                                data-copilot="freela.inicio.ver-convite"
                                className="shrink-0"
                                onClick={() => navigate('/my-jobs')}
                            >
                                Ver Convite{pendingInvites.length > 1 ? `s (${pendingInvites.length})` : ''}
                            </Button>
                        </div>
                    )}
                </section>
            )}

            {/* --- CHAVE PIX: sem ela a empresa não tem como pagar (vem antes de foto e XP) --- */}
            {semPix && (
                <Alert
                    tone="warning"
                    title="Cadastre sua chave PIX"
                    action={(
                        <Button
                            variant="secondary"
                            size="sm"
                            data-copilot="freela.inicio.cadastrar-pix"
                            onClick={() => navigate('/profile?editar=pix')}
                        >
                            Preencher chave PIX
                        </Button>
                    )}
                >
                    As empresas pagam por fora do app, usando a chave do seu perfil.
                </Alert>
            )}

            {/* --- PRÓXIMO TURNO (sem turno hoje) --- */}
            {!temTurnoHoje && (
                <section aria-labelledby="proximo-turno" className="flex flex-col gap-3">
                    <h2 id="proximo-turno" className="text-base font-semibold">Próximo turno</h2>
                    {nextJob ? (
                        <Card padding="sm" className="flex flex-col gap-3">
                            <div className="flex items-start gap-3">
                                <div className="flex-shrink-0 w-14 rounded-xl bg-gray-100 py-2 text-center">
                                    {hasValidDate ? (
                                        <>
                                            <span className="block text-xl font-bold leading-none tabular-nums">{parsedDate!.getDate()}</span>
                                            <span className="block mt-1 text-xs font-semibold text-gray-600">
                                                {parsedDate!.toLocaleString('pt-BR', { month: 'short' }).replace('.', '')}
                                            </span>
                                        </>
                                    ) : (
                                        <span className="block px-1 text-xs font-semibold text-gray-600">Data indefinida</span>
                                    )}
                                </div>
                                <div className="min-w-0 flex-1">
                                    <div className="flex items-start justify-between gap-2">
                                        <p className="min-w-0 font-bold text-base leading-snug line-clamp-2">{nextJob.job.title}</p>
                                        <StatusBadge tone="success" icon={null} className="shrink-0">Agendado</StatusBadge>
                                    </div>
                                    {nextJob.job.company?.name && (
                                        <p className="text-sm text-gray-700 truncate">{nextJob.job.company.name}</p>
                                    )}
                                    <p className="text-xs text-gray-600 mt-0.5 line-clamp-2">
                                        {nextJob.job.work_start_time
                                            ? `${nextJob.job.work_start_time}${nextJob.job.work_end_time ? ` – ${nextJob.job.work_end_time}` : ''}`
                                            : 'Horário indefinido'}
                                        {nextJob.job.location ? ` · ${nextJob.job.location}` : ''}
                                    </p>
                                </div>
                            </div>
                            <Button
                                variant={temAtencao ? 'secondary' : 'primary'}
                                className="w-full sm:w-auto sm:self-start"
                                onClick={() => navigate('/my-jobs')}
                            >
                                Ver detalhes
                            </Button>
                        </Card>
                    ) : carregandoNextJob ? (
                        <div className="h-16 bg-gray-100 rounded-xl animate-pulse" role="status"><span className="sr-only">Carregando</span></div>
                    ) : erroNextJob ? (
                        <p className="rounded-xl bg-red-50 px-4 py-3 text-sm font-semibold text-red-700">
                            Não foi possível carregar.
                        </p>
                    ) : (
                        <p className="rounded-xl bg-gray-100 px-4 py-3 text-sm text-gray-600">
                            Sem próximos turnos marcados.
                        </p>
                    )}
                </section>
            )}

            {/* --- FAIXA DE MÉTRICAS: um número por coluna, sem cartão por número --- */}
            <section aria-label="Seus números" className="flex flex-col gap-2">
                <div className="grid grid-cols-3 divide-x divide-gray-200 rounded-2xl border border-gray-200 bg-white">
                    <div className="min-w-0 px-3 py-3">
                        <p className="text-xs text-gray-600">Ganhos</p>
                        <p className="mt-0.5 text-base font-bold tabular-nums truncate sm:text-xl" title={formatBRL(worker.earnings_total || 0)}>
                            {formatBRL(worker.earnings_total || 0)}
                        </p>
                    </div>
                    <button
                        type="button"
                        onClick={() => navigate('/carteira')}
                        aria-label={`Minhas empresas: ${empresasValor}. Ver empresas`}
                        className="flex min-h-11 min-w-0 flex-col items-start px-3 py-3 text-left transition-colors hover:bg-gray-50 active:bg-gray-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-black"
                    >
                        <span className="flex items-center gap-0.5 text-xs text-gray-600">
                            Empresas <ChevronRight size={12} aria-hidden="true" />
                        </span>
                        <span className="mt-0.5 text-base font-bold tabular-nums sm:text-xl">{empresasValor}</span>
                    </button>
                    <div className="min-w-0 px-3 py-3">
                        <p className="text-xs text-gray-600">Nível</p>
                        <p className="mt-0.5 text-base font-bold tabular-nums sm:text-xl">{worker.level || 1}</p>
                        {progresso && (
                            <div
                                className="mt-1.5 h-1.5 bg-gray-100 rounded-full overflow-hidden"
                                role="progressbar"
                                aria-label="Progresso para o próximo nível"
                                aria-valuemin={0}
                                aria-valuemax={100}
                                aria-valuenow={Math.round(progresso.percent)}
                                title={progresso.faltam > 0 ? `Faltam ${progresso.faltam} XP para o próximo nível` : 'Nível máximo!'}
                            >
                                <div className="h-full bg-primary" style={{ width: `${progresso.percent}%` }} />
                            </div>
                        )}
                    </div>
                </div>
                <p className="inline-flex flex-wrap items-center gap-x-1.5 text-xs text-gray-600">
                    <span>{realizados} turno{realizados === 1 ? '' : 's'} realizado{realizados === 1 ? '' : 's'}</span>
                    <span aria-hidden="true">·</span>
                    <Star size={12} className="text-yellow-500" fill="currentColor" aria-hidden="true" />
                    <span>{nota ? <>Sua nota: <span className="font-bold text-gray-900">{nota}</span></> : 'Ainda sem avaliações'}</span>
                </p>
            </section>

            {/* --- COMPLETAR PERFIL (disponibilidade F7 + quests) como grupo de lista --- */}
            {perfilIncompleto && (
                <section aria-labelledby="complete-perfil" className="flex flex-col gap-3">
                    <h2 id="complete-perfil" className="text-base font-semibold">Complete seu perfil</h2>
                    <ul className="divide-y divide-gray-200 overflow-hidden rounded-2xl border border-gray-200 bg-white">
                        {/* F7 — R14/A10: visível SÓ enquanto o freela nunca declarou disponibilidade. */}
                        {hasNoDeclaredAvailability && (
                            <li>
                                <ListRow
                                    leading={<CalendarClock size={20} aria-hidden="true" className="shrink-0 text-primary-ink" />}
                                    title="Declarar disponibilidade"
                                    meta="Declare sua disponibilidade para receber chamados mais certeiros."
                                    onActivate={() => navigate('/profile')}
                                />
                            </li>
                        )}
                        {completedQuests < totalQuests && quests.filter(q => !q.done).slice(0, 2).map(quest => (
                            <li key={quest.id}>
                                <ListRow
                                    title={quest.title}
                                    meta={quest.xp > 0 ? `+${quest.xp} XP e mais confiança para as empresas` : 'Verificação da conta'}
                                    onActivate={() => navigate('/profile')}
                                />
                            </li>
                        ))}
                    </ul>
                </section>
            )}

            {/* --- HISTÓRICO RECENTE (grupo de lista) --- */}
            <section aria-labelledby="historico-recente" className="flex flex-col gap-2">
                <div className="flex items-center justify-between gap-3">
                    <h2 id="historico-recente" className="text-base font-semibold">Histórico recente</h2>
                    <Button variant="ghost" size="sm" className="-mr-2 shrink-0 !px-2" onClick={() => navigate('/my-jobs')}>
                        Ver tudo
                    </Button>
                </div>
                {history.length > 0 ? (
                    <ul className="divide-y divide-gray-200 overflow-hidden rounded-2xl border border-gray-200 bg-white">
                        {history.map((h) => (
                            <li key={h.id}>
                                <ListRow
                                    title={<span title={h.job.title}>{h.job.title}</span>}
                                    meta={new Date(h.created_at).toLocaleDateString('pt-BR')}
                                    trailing={<StatusBadge domain="application" status={h.status} />}
                                    onActivate={() => navigate('/my-jobs')}
                                />
                            </li>
                        ))}
                    </ul>
                ) : carregandoHistory ? (
                    <div className="h-12 bg-gray-100 rounded-xl animate-pulse" role="status"><span className="sr-only">Carregando</span></div>
                ) : erroHistory ? (
                    <p className="rounded-xl bg-red-50 px-4 py-3 text-sm font-semibold text-red-700">Não foi possível carregar o histórico.</p>
                ) : (
                    <p className="rounded-xl bg-gray-100 px-4 py-3 text-sm text-gray-600">Sem histórico recente.</p>
                )}
            </section>
        </div>
    );
}
