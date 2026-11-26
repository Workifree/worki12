import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Briefcase, Bell, AlertTriangle, RefreshCw, PlayCircle, Share2 } from 'lucide-react';
import { supabase } from '../../lib/supabase';
import PageMeta from '../../components/PageMeta';
import { useQuery } from '@tanstack/react-query';
import { formatDistanceToNow } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import { ReferralService } from '../../services/referralService';
import { logError } from '../../lib/logger';
import { getJobScope, canSeeJob } from '../../services/jobScopeService';
import { fillMissingWorkers } from '../../services/workerCardsService';
import { getAuthenticatedCompanyId } from '../../services/companyScopeService';
import { useCurrentCompany } from '../../hooks/useCurrentCompany';
import { useCompanyNavContext } from '../../hooks/useCompanyNavContext';
import SectionTabs from '../../components/SectionTabs';
import TrailShortcutCard from '../../components/company/TrailShortcutCard';
import { Button, ButtonLink, Card, EmptyState, ErrorState, IconButton, ListRow, PageHeader, SkeletonList, StatusBadge } from '../../components/ui';
import { applicationStep, occupancy, shiftWhen } from '../../lib/nextAction';
import CreateShiftLink from '../../components/company/CreateShiftLink';
import BatchEntry from '../../components/company/BatchEntry';
import { GuideChecklist } from '../../components/guide/GuideChecklist';
import { isJobActive, isShiftInProgress } from '../../lib/shiftProgress';
import { useLiveRefresh } from '../../hooks/useLiveRefresh';
import { companyShiftSources } from '../../lib/realtime/liveSources';


export default function CompanyDashboard() {
    const navigate = useNavigate();
    // Com equipe, esta tela é a aba "Visão geral" do Início; dono único vê só "Início", sem abas.
    const { hasTeam, isEncarregado } = useCompanyNavContext(useCurrentCompany());
    const pageTitle = hasTeam ? 'Visão geral' : 'Início';

    // Indicações recebidas (F10) — atalho direto: nenhuma notificação aponta pra
    // lá do lado de A (a de aceite vai para `/company/team`) — sem isto, a aba "Recebidas" só
    // existe para quem abre a URL direto ou usa desktop. Padrão useState/useEffect (Article 5),
    // isolado do bloco de useQuery abaixo (não migra o arquivo inteiro, só esta peça nova).
    const [pendingReferralsCount, setPendingReferralsCount] = useState<number | null>(null);
    useEffect(() => {
        let active = true;
        (async () => {
            const result = await ReferralService.listReceivedCards();
            if (!active) return;
            if (result.outcome !== 'ok') {
                if (result.outcome === 'unauthenticated') return;
                logError('CompanyDashboard.pendingReferrals', new Error(result.outcome));
                return;
            }
            setPendingReferralsCount(result.items.filter((i) => i.status === 'awaiting_worker').length);
        })();
        return () => { active = false; };
    }, []);

    // React Query Hooks
    const { data: company, isLoading: isLoadingCompany, isLoadingError: isErrorCompany, refetch: refetchCompany } = useQuery({
        queryKey: ['companyProfile'],
        queryFn: async () => {
            // Gerente de unidade (F13) NAO tem linha em `companies` com o proprio id: o
            // `user.id` aqui trazia null e o cabecalho dizia "Bem-vindo de volta, Empresa".
            const companyId = await getAuthenticatedCompanyId();
            const { data, error } = await supabase.from('companies').select('name').eq('id', companyId).single();
            if (error) throw error;
            return data;
        }
    });

    const { data: jobs = [], isLoading: isLoadingJobs, isLoadingError: isErrorJobs, refetch: refetchJobs } = useQuery({
        queryKey: ['companyJobs'],
        queryFn: async () => {
            const scope = await getJobScope();
            // F3 (Escala Recorrente) pode gerar até 60 turnos por série: sem este filtro, uma
            // série cancelada em massa (soft delete, status='deleted') ficava inteira aqui —
            // cosmético antes, inutilizante agora (ADR-20260817).
            const { data, error } = await supabase
                .from('jobs')
                .select('*, views, applications(status)')
                .eq('company_id', scope.companyId)
                .neq('status', 'deleted')
                .order('created_at', { ascending: false });
            // Falha NUNCA vira lista vazia (e daí "0 turnos").
            if (error) throw error;
            return (data || []).filter((job) => canSeeJob(scope, job));
        },
        enabled: !!company
    });

    const { data: applications = [], isLoading: isLoadingApps, isLoadingError: isErrorApps, refetch: refetchApps } = useQuery({
        queryKey: ['companyApplications'],
        queryFn: async () => {
            const companyId = await getAuthenticatedCompanyId();
            const { data, error } = await supabase
                .from('applications')
                .select('*, jobs!inner(title, company_id)')
                .eq('jobs.company_id', companyId)
                .order('created_at', { ascending: false })
                .limit(5);
            if (error) throw error;
            return data || [];
        },
        enabled: !!company
    });

    // PostgREST tipa embeds de relação como array; normalizamos para objeto no render.
    interface ActiveShiftWorker { id: string; full_name: string | null; avatar_url: string | null; primary_role: string | null }
    interface ActiveShiftJob { id: string; title: string | null; location: string | null; start_date: string | null; work_start_time: string | null; work_end_time: string | null }
    interface ActiveShiftRow {
        id: string;
        job_id: string;
        status: string;
        worker_checkin_at: string | null;
        company_checkin_confirmed_at: string | null;
        worker_checkout_at: string | null;
        company_checkout_confirmed_at: string | null;
        created_at: string;
        worker: ActiveShiftWorker | ActiveShiftWorker[] | null;
        jobs: ActiveShiftJob | ActiveShiftJob[] | null;
    }

    // Detalhes dos turnos ativos/em andamento para acesso direto de acompanhamento
    const { data: activeShifts = [], isLoading: isLoadingShifts, isLoadingError: isErrorShifts, refetch: refetchShifts } = useQuery<ActiveShiftRow[]>({
        queryKey: ['companyActiveShifts'],
        queryFn: async () => {
            const companyId = await getAuthenticatedCompanyId();
            const { data, error } = await supabase
                .from('applications')
                .select(`
                    id,
                    job_id,
                    worker_id,
                    status,
                    worker_checkin_at,
                    company_checkin_confirmed_at,
                    worker_checkout_at,
                    company_checkout_confirmed_at,
                    created_at,
                    worker:workers(id, full_name, avatar_url, primary_role),
                    jobs!inner(id, title, location, start_date, work_start_time, work_end_time, company_id)
                `)
                .eq('jobs.company_id', companyId)
                .in('status', ['hired', 'in_progress'])
                .order('created_at', { ascending: false });
            if (error) throw error;
            return (await fillMissingWorkers(data ?? [])) as unknown as ActiveShiftRow[];
        },
        enabled: !!company
    });

    // ── PRECISA DE VOCÊ: o rabo do laço do dinheiro ─────────────────────────────────────────
    // O freela tem casa persistente para "pagamento registrado — confirme"; o lado da EMPRESA
    // não tinha nenhuma: turno concluído sem pagamento registrado e agendamento vencido só
    // apareciam se ela abrisse exatamente o turno certo em /company/jobs. Notificação é
    // transitória e fácil de perder; ação pendente pede indicador PERSISTENTE onde a pessoa já
    // está (NN/g, "Indicators, Validations, and Notifications"). Best-effort: em erro, loga e
    // vira aviso com "Tentar de novo": sumir calado diria que não há nada a pagar.
    interface PendingPayRow {
        job_id: string;
        worker_id: string;
        titulo: string;
        freela: string;
        tipo: 'registrar' | 'efetivar';
        venceuEm?: string;
    }
    const { data: pendingPayments = [], isLoadingError: isErrorPending, refetch: refetchPending } = useQuery<PendingPayRow[]>({
        queryKey: ['companyPendingPayments'],
        queryFn: async () => {
            try {
                const companyId = await getAuthenticatedCompanyId();
                const [{ data: concluidos, error: erroConcluidos }, { data: marcadores, error: erroMarcadores }] = await Promise.all([
                    supabase
                        .from('applications')
                        .select('job_id, worker_id, worker:workers(full_name), jobs!inner(title, company_id)')
                        .eq('jobs.company_id', companyId)
                        .eq('status', 'completed'),
                    supabase
                        .from('shift_payments')
                        .select('job_id, worker_id, status, scheduled_for, jobs!inner(title)')
                        .eq('company_id', companyId)
                        .in('status', ['scheduled', 'recorded']),
                ]);
                if (erroConcluidos || erroMarcadores) throw erroConcluidos ?? erroMarcadores;
                const um = <T,>(v: T | T[] | null): T | null => (Array.isArray(v) ? v[0] ?? null : v);
                // 1 marcador ativo por (turno, freela) — o UNIQUE parcial do banco garante.
                const comMarcador = new Set((marcadores ?? []).map((m) => `${m.job_id}:${m.worker_id}`));
                const rows: PendingPayRow[] = [];
                for (const a of (await fillMissingWorkers(concluidos ?? [])) as unknown as Array<{ job_id: string; worker_id: string; worker: { full_name: string | null } | { full_name: string | null }[] | null; jobs: { title: string | null } | { title: string | null }[] | null }>) {
                    if (comMarcador.has(`${a.job_id}:${a.worker_id}`)) continue;
                    rows.push({
                        job_id: a.job_id,
                        worker_id: a.worker_id,
                        titulo: um(a.jobs)?.title ?? 'Turno',
                        freela: um(a.worker)?.full_name ?? 'Freela',
                        tipo: 'registrar',
                    });
                }
                // Agendamento cuja data prevista chegou: falta EFETIVAR (scheduled → recorded).
                const d = new Date();
                const pad = (n: number) => String(n).padStart(2, '0');
                const hoje = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
                for (const m of (marcadores ?? []) as unknown as Array<{ job_id: string; worker_id: string; status: string; scheduled_for: string | null; jobs: { title: string | null } | { title: string | null }[] | null }>) {
                    if (m.status !== 'scheduled' || !m.scheduled_for || m.scheduled_for > hoje) continue;
                    rows.push({
                        job_id: m.job_id,
                        worker_id: m.worker_id,
                        titulo: um(m.jobs)?.title ?? 'Turno',
                        freela: '',
                        tipo: 'efetivar',
                        venceuEm: m.scheduled_for,
                    });
                }
                return rows;
            } catch (e) {
                logError('companyDashboard.pendingPayments', e);
                throw e;
            }
        },
        enabled: !!company
    });

    const liveCompany = useCurrentCompany();
    useLiveRefresh({
        sources: liveCompany ? companyShiftSources(liveCompany.company_id) : [],
        onRefresh: () => Promise.all([refetchJobs(), refetchApps(), refetchShifts(), refetchPending()]),
        paused: !company,
    });

    // Derived State
    const companyName = company?.name || '';
    const loading = isLoadingCompany;
    // Enquanto os dados não chegaram, nada de "0" nem "Nenhum turno": a query de turnos só liga
    // depois da empresa, e nesse intervalo `jobs` é [] sem estar carregado.
    const jobsPending = loading || isLoadingJobs || (!company && !isErrorCompany);

    // Contratado não é "em andamento": só conta quem já chegou e não teve a saída confirmada.
    const shiftsInProgress = activeShifts.filter(isShiftInProgress);
    const shiftsContracted = activeShifts.filter((row) => !isShiftInProgress(row));
    const inProgressCount = new Set(shiftsInProgress.map((row) => row.job_id)).size;
    const kpiPending = jobsPending || isLoadingShifts;

    const activeJobList = jobs.filter(j => isJobActive(j, j.applications));
    const filledOf = (apps: Array<{ status: string }> | null | undefined) =>
        (apps ?? []).filter((a) => ['hired', 'in_progress', 'completed'].includes(a.status)).length;
    const withoutPeople = activeJobList.filter((j) => occupancy(j.slots, filledOf(j.applications)).needsPeople).length;

    // Blend Activities (only from successfully loaded data)
    const activities = [
        ...(isErrorJobs ? [] : jobs.slice(0, 5).map(job => ({
            type: 'job_created',
            text: `Turno criado: "${job.title}"`,
            time: job.created_at as string,
            id: job.id as string
        }))),
        ...(isErrorApps ? [] : applications.map(app => ({
            type: 'application',
            text: `Novo freela para "${(app.jobs as Record<string, unknown>).title}"`,
            time: app.created_at as string,
            id: app.id as string
        })))
    ].sort((a, b) => new Date(b.time).getTime() - new Date(a.time).getTime()).slice(0, 5);

    // Check if activity feed has any errors
    const hasActivityError = isErrorJobs && isErrorApps;

    const todayLabel = new Intl.DateTimeFormat('pt-BR', { weekday: 'long', day: '2-digit', month: 'long' }).format(new Date());

    // Sem a empresa nenhuma outra consulta roda: mostrar o erro, e nenhum número.
    if (isErrorCompany) {
        return (
            <div className="max-w-7xl mx-auto">
                <PageMeta title={pageTitle} />
                <PageHeader title={pageTitle} />
                <ErrorState title="Não conseguimos carregar os dados da empresa." onRetry={() => { void refetchCompany(); }} />
            </div>
        );
    }

    return (
        <div className="max-w-7xl mx-auto">
            <PageMeta title={pageTitle} />
            {hasTeam && <SectionTabs section="inicio" />}

            <PageHeader title={pageTitle} subtitle={[todayLabel, companyName].filter(Boolean).join(' · ')} action={<CreateShiftLink />} inlineAction />

            <div className="space-y-8">
                <GuideChecklist ocultavel />
                <BatchEntry />
                <TrailShortcutCard />

                {isErrorPending && (
                    <ErrorState
                        title="Não conseguimos conferir os pagamentos pendentes."
                        message="Isso não quer dizer que não há nada a pagar. Tente de novo."
                        onRetry={() => { void refetchPending(); }}
                    />
                )}

                {/* PRECISA DE VOCÊ — o rabo do laço do dinheiro, persistente no painel.
                    No topo: é a triagem do dia. Início = o que precisa de você agora;
                    Turnos = a gestão completa. */}
                {pendingPayments.length > 0 && (
                    <section aria-label="Precisa de você">
                        <h2 className="text-lg font-bold flex items-center gap-2 mb-4">
                            <AlertTriangle size={20} className="text-orange-500" aria-hidden="true" /> Precisa de você ({pendingPayments.length})
                        </h2>
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                            {pendingPayments.slice(0, 4).map((row) => (
                                <Card
                                    key={`${row.job_id}:${row.worker_id}:${row.tipo}`}
                                    padding="sm"
                                    data-copilot="empresa.inicio.resolver-pagamento"
                                    onActivate={() => navigate(`/company/jobs/${row.job_id}/candidates`)}
                                    className="min-h-11 border-l-8 border-l-orange-500 text-left"
                                >
                                    <p className="font-bold text-sm">
                                        {row.tipo === 'registrar' ? 'Registrar pagamento' : 'Efetivar pagamento agendado'}
                                    </p>
                                    <p className="text-xs text-gray-600 mt-1 truncate">
                                        {row.tipo === 'registrar'
                                            ? `${row.freela} · ${row.titulo}`
                                            : `${row.titulo}${row.venceuEm ? ` · previsto para ${row.venceuEm.split('-').reverse().join('/')}` : ''}`}
                                    </p>
                                </Card>
                            ))}
                        </div>
                        {pendingPayments.length > 4 && (
                            <p className="text-xs text-gray-600 mt-3">
                                +{pendingPayments.length - 4} outros — abra cada turno em Turnos para resolver.
                            </p>
                        )}
                    </section>
                )}

                {/* Faixa compacta: cada número leva à lista correspondente. */}
                {isErrorJobs || isErrorShifts ? (
                    <ErrorState
                        title="Não conseguimos carregar seus turnos."
                        onRetry={() => { void refetchJobs(); void refetchShifts(); }}
                    />
                ) : kpiPending ? (
                    <div className="grid grid-cols-3 gap-2 sm:gap-4" role="status" aria-label="Carregando indicadores">
                        {[0, 1, 2].map((i) => <div key={i} className="h-20 bg-gray-200 rounded-2xl animate-pulse motion-reduce:animate-none" />)}
                    </div>
                ) : (
                    <div className="grid grid-cols-3 gap-2 sm:gap-4">
                        {[
                            { title: 'Sem freela', value: withoutPeople, to: '/company/jobs?filter=open' },
                            { title: 'Turnos ativos', value: activeJobList.length, to: '/company/jobs?filter=open' },
                            { title: 'Em andamento', value: inProgressCount, to: '/company/jobs?filter=andamento' },
                        ].map((stat) => (
                            <Card key={stat.title} padding="none" className="p-3" onActivate={() => navigate(stat.to)}>
                                <p className="text-2xl font-bold tabular-nums">{stat.value}</p>
                                <p className="text-xs font-semibold text-gray-600">{stat.title}</p>
                            </Card>
                        ))}
                    </div>
                )}

                {/* Turnos em Andamento / Acompanhamento Direto */}
                {!isErrorShifts && [
                    { key: 'andamento', title: 'Turnos em andamento', rows: shiftsInProgress, link: '/company/jobs?filter=andamento' },
                    { key: 'contratados', title: 'Contratados', rows: shiftsContracted, link: '/company/jobs' },
                ].filter((group) => group.rows.length > 0).map((group, groupIndex) => (
                    <section key={group.key} aria-label={group.title}>
                        <div className="flex items-center justify-between gap-3 mb-3">
                            <h2 className="text-lg font-bold flex items-center gap-2">
                                <PlayCircle size={20} className="text-gray-600" aria-hidden="true" /> {group.title} ({group.rows.length})
                            </h2>
                            <ButtonLink variant="ghost" to={group.link}>
                                Ver todos
                            </ButtonLink>
                        </div>
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                            {group.rows.slice(0, 4).map((app, rowIndex) => {
                                const worker = Array.isArray(app.worker) ? app.worker[0] : app.worker;
                                const job = Array.isArray(app.jobs) ? app.jobs[0] : app.jobs;
                                // Quatro estados, nao dois: "Aguardando Chegada" pintava IGUAL o freela
                                // que ainda nao veio e o que JA registrou chegada e so espera a empresa
                                // confirmar — escondendo justamente o passo que e da empresa (NN/g #1,
                                // visibilidade do estado do sistema). Âmbar = a acao e SUA.
                                const chegouConfirme = !!app.worker_checkin_at && !app.company_checkin_confirmed_at;
                                const saiuConfirme = !!app.company_checkin_confirmed_at && !!app.worker_checkout_at && !app.company_checkout_confirmed_at;
                                const estadoPresenca = saiuConfirme
                                    ? { rotulo: 'Saiu — confirme', tone: 'warning' as const }
                                    : chegouConfirme
                                        ? { rotulo: 'Chegou — confirme', tone: 'warning' as const }
                                        : app.company_checkout_confirmed_at
                                            ? { rotulo: 'Saída confirmada', tone: 'neutral' as const }
                                            : app.company_checkin_confirmed_at
                                                ? { rotulo: 'Presença OK', tone: 'success' as const }
                                                : { rotulo: 'Aguardando chegada', tone: 'warning' as const };
                                // Pagamento não é lido aqui: sem o marcador, o rótulo não oferece pagar.
                                const step = applicationStep(app);
                                const stepLabel = step.kind === 'view' ? 'Presença e pagamento' : step.label;

                                return (
                                    <Card
                                        key={app.id}
                                        padding="sm"
                                        className="flex flex-col justify-between gap-3"
                                    >
                                        <div className="flex items-start gap-3">
                                            <div className="w-12 h-12 rounded-full bg-gray-200 border-2 border-black overflow-hidden flex-shrink-0 flex items-center justify-center font-bold">
                                                {worker?.avatar_url ? (
                                                    <img src={worker.avatar_url} alt="" className="w-full h-full object-cover" />
                                                ) : (
                                                    worker?.full_name?.[0]?.toUpperCase() ?? 'F'
                                                )}
                                            </div>
                                            <div className="min-w-0 flex-1">
                                                <h3 className="font-bold text-base line-clamp-2 break-words">{worker?.full_name || 'Freela'}</h3>
                                                <p className="text-sm font-semibold">{shiftWhen(job?.start_date, job?.work_start_time, job?.work_end_time)}</p>
                                                <p className="text-xs text-gray-600 line-clamp-2 break-words">
                                                    {[job?.title || 'Turno', job?.location].filter(Boolean).join(' · ')}
                                                </p>
                                                <StatusBadge tone={estadoPresenca.tone} className="mt-1.5">{estadoPresenca.rotulo}</StatusBadge>
                                            </div>
                                        </div>
                                        <Button
                                            variant={groupIndex === 0 && rowIndex === 0 ? 'dark' : 'secondary'}
                                            fullWidth
                                            data-copilot={step.kind === 'checkin' ? 'empresa.inicio.registrar-chegada' : step.kind === 'checkout' ? 'empresa.inicio.registrar-saida' : 'empresa.inicio.abrir-presenca'}
                                            onClick={() => navigate(`/company/jobs/${app.job_id}/candidates`)}
                                        >
                                            {stepLabel}
                                        </Button>
                                    </Card>
                                );
                            })}
                        </div>
                    </section>
                ))}

                {/* Indicações recebidas (F10) — atalho mobile, ver comentário no hook acima. Fica
                    visível mesmo com 0 pendentes: é a PORTA para a caixa de entrada, não só um badge. */}
                {!isEncarregado && (
                <Card onActivate={() => navigate('/company/indicacoes')}>
                    <div className="flex items-center justify-between gap-4">
                        <div className="flex items-center gap-4 min-w-0">
                            <div className="p-3 rounded-xl bg-primary-light text-primary border-2 border-black flex-shrink-0">
                                <Share2 size={20} aria-hidden="true" />
                            </div>
                            <div className="min-w-0">
                                <p className="font-bold">Indicações recebidas</p>
                                <p className="text-xs text-gray-600">
                                    {pendingReferralsCount
                                        ? `${pendingReferralsCount} freela${pendingReferralsCount > 1 ? 's' : ''} aguardando decisão`
                                        : 'Freelas indicados por outras empresas'}
                                </p>
                            </div>
                        </div>
                        {!!pendingReferralsCount && (
                            <span className="bg-black text-white px-3 py-1 rounded-pill font-bold text-sm tabular-nums flex-shrink-0">
                                {pendingReferralsCount}
                            </span>
                        )}
                    </div>
                </Card>
                )}

                {/* Recent Jobs Section */}
                <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
                    {/* Job List */}
                    <section className="lg:col-span-2 space-y-4" aria-label="Turnos recentes">
                        <div className="flex items-center justify-between gap-3">
                            <h2 className="text-lg font-bold flex items-center gap-2">
                                <Briefcase size={20} aria-hidden="true" /> Turnos recentes
                            </h2>
                            <ButtonLink variant="ghost" to="/company/jobs">Ver todos</ButtonLink>
                        </div>

                        {isErrorJobs ? (
                            <p className="text-sm text-gray-600">A lista aparece quando o carregamento acima funcionar.</p>
                        ) : jobsPending ? (
                            <SkeletonList count={3} itemClassName="h-20" />
                        ) : jobs.length === 0 ? (
                            <EmptyState
                                title="Você ainda não tem turnos."
                                description="Monte seu elenco, crie um turno e chame quem você quer."
                                action={<Button variant="dark" data-copilot="empresa.inicio.criar-turno" onClick={() => navigate('/company/create')}>Criar primeiro turno</Button>}
                            />
                        ) : (
                            <Card padding="none" className="overflow-hidden">
                                <ul className="divide-y divide-gray-200">
                                    {jobs.slice(0, 3).map((job) => (
                                        <li key={job.id}>
                                            <ListRow
                                                title={job.title}
                                                meta={`${shiftWhen(job.start_date, job.work_start_time, job.work_end_time)} · ${isJobActive(job, job.applications) ? 'Ativo' : job.status === 'open' ? 'Concluído' : 'Fechado'}`}
                                                to={`/company/jobs/${job.id}/candidates`}
                                                trailing={
                                                    // Repetir no ponto de contexto: mesmo motor do ?repetir= (data em branco).
                                                    <IconButton
                                                        aria-label={`Repetir o turno ${job.title}`}
                                                        data-copilot="empresa.inicio.repetir-turno"
                                                        onClick={() => navigate(`/company/create?repetir=${job.id}`)}
                                                    >
                                                        <RefreshCw size={18} />
                                                    </IconButton>
                                                }
                                            />
                                        </li>
                                    ))}
                                </ul>
                            </Card>
                        )}
                    </section>

                    {/* Activity Feed */}
                    <section className="hidden space-y-4 lg:block" aria-label="Atividade recente">
                        <h2 className="text-lg font-bold flex items-center gap-2">
                            <Bell size={20} aria-hidden="true" /> Atividade recente
                        </h2>
                        <Card className="space-y-5">
                            {hasActivityError ? (
                                <ErrorState
                                    title="Não conseguimos carregar as atividades."
                                    onRetry={() => { void refetchJobs(); void refetchApps(); }}
                                />
                            ) : loading || isLoadingJobs || isLoadingApps ? (
                                <div className="space-y-4 animate-pulse" role="status"><span className="sr-only">Carregando</span>
                                    {[...Array(4)].map((_, i) => (
                                        <div key={i} className="flex gap-3 items-start">
                                            <div className="w-2 h-2 mt-2 rounded-full bg-gray-200 flex-shrink-0" aria-hidden="true" />
                                            <div className="flex-1 space-y-2">
                                                <div className="h-4 bg-gray-200 rounded-xl w-3/4" />
                                                <div className="h-3 bg-gray-200 rounded-xl w-1/3" />
                                            </div>
                                        </div>
                                    ))}
                                </div>
                            ) : activities.length === 0 ? (
                                <p className="text-sm text-gray-600 text-center">Nenhuma atividade recente.</p>
                            ) : (
                                <>
                                    {(isErrorJobs || isErrorApps) && (
                                        <div className="flex items-center gap-2 p-2 bg-yellow-50 border border-yellow-200 rounded-xl">
                                            <AlertTriangle size={14} className="text-yellow-500 flex-shrink-0" aria-hidden="true" />
                                            <span className="text-xs font-semibold text-yellow-700">Alguns dados podem estar incompletos.</span>
                                        </div>
                                    )}
                                    {activities.map((activity, i) => (
                                        <div key={i} className="flex gap-3 items-start">
                                            <div className={`w-2 h-2 mt-2 rounded-full flex-shrink-0 ${activity.type === 'job_created' ? 'bg-blue-500' : 'bg-green-500'}`} aria-hidden="true" />
                                            <div>
                                                <p className="text-sm font-semibold leading-snug">{activity.text}</p>
                                                <p className="text-xs text-gray-600 mt-1">
                                                    {formatDistanceToNow(new Date(activity.time), { addSuffix: true, locale: ptBR })}
                                                </p>
                                            </div>
                                        </div>
                                    ))}
                                </>
                            )}
                        </Card>

                        {!isEncarregado && (
                        <Card>
                            <h3 className="font-bold text-base mb-2">Dica</h3>
                            <p className="text-sm text-gray-600 mb-4">Freelas veem seu perfil antes de aceitar o convite. Endereço e briefing padrão preenchidos aceleram a resposta.</p>
                            <ButtonLink variant="secondary" fullWidth to="/company/profile">
                                Completar perfil
                            </ButtonLink>
                        </Card>
                        )}
                    </section>
                </div>
            </div>
        </div>
    );
}
