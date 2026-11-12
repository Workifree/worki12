import { useEffect, useState } from 'react';
import type { KeyboardEvent, ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import { Briefcase, TrendingUp, Bell, AlertTriangle, RefreshCw, PlayCircle, Share2 } from 'lucide-react';
import { supabase } from '../../lib/supabase';
import PageMeta from '../../components/PageMeta';
import { useQuery } from '@tanstack/react-query';
import { formatDistanceToNow } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import { ReferralService } from '../../services/referralService';
import { logError } from '../../lib/logger';
import { getAuthenticatedCompanyId } from '../../services/companyScopeService';
import { Button, Card, PageHeader } from '../../components/ui';

function SectionError({ message, onRetry }: { message: string; onRetry: () => void }) {
    return (
        <div role="alert" className="p-5 bg-red-50 border-2 border-red-200 rounded-2xl text-center">
            <AlertTriangle size={24} className="text-red-500 mx-auto mb-2" aria-hidden="true" />
            <p className="font-semibold text-red-700 text-sm mb-3">{message}</p>
            <Button variant="secondary" size="sm" onClick={onRetry} iconLeft={<RefreshCw size={14} />}>
                Tentar novamente
            </Button>
        </div>
    );
}

// Card inteiro clicável (teclado incluso) para cards SEM botão aninhado.
function ClickableCard({ onClick, className, children }: { onClick: () => void; className?: string; children: ReactNode }) {
    const onKeyDown = (e: KeyboardEvent<HTMLElement>) => {
        if (e.target !== e.currentTarget) return;
        if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            onClick();
        }
    };
    return (
        <Card
            interactive
            role="button"
            tabIndex={0}
            onClick={onClick}
            onKeyDown={onKeyDown}
            className={`cursor-pointer text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-black focus-visible:ring-offset-2 ${className ?? ''}`}
        >
            {children}
        </Card>
    );
}

export default function CompanyDashboard() {
    const navigate = useNavigate();

    // Indicações recebidas (F10) — atalho de mobile-reachability. `/company/indicacoes` não
    // está no BottomNav (as duas listas já têm 6 itens, cheias) e nenhuma notificação aponta pra
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
    const { data: company, isLoading: isLoadingCompany, isError: isErrorCompany, refetch: refetchCompany } = useQuery({
        queryKey: ['companyProfile'],
        queryFn: async () => {
            // Gerente de unidade (F13) NAO tem linha em `companies` com o proprio id: o
            // `user.id` aqui trazia null e o cabecalho dizia "Bem-vindo de volta, Empresa".
            const companyId = await getAuthenticatedCompanyId();
            const { data } = await supabase.from('companies').select('name').eq('id', companyId).single();
            return data;
        }
    });

    const { data: jobs = [], isLoading: isLoadingJobs, isError: isErrorJobs, refetch: refetchJobs } = useQuery({
        queryKey: ['companyJobs'],
        queryFn: async () => {
            const companyId = await getAuthenticatedCompanyId();
            // F3 (Escala Recorrente) pode gerar até 60 turnos por série: sem este filtro, uma
            // série cancelada em massa (soft delete, status='deleted') ficava inteira aqui —
            // cosmético antes, inutilizante agora (ADR-20260817).
            const { data } = await supabase
                .from('jobs')
                .select('*, views')
                .eq('company_id', companyId)
                .neq('status', 'deleted')
                .order('created_at', { ascending: false });
            return data || [];
        },
        enabled: !!company
    });

    const { data: applications = [], isLoading: isLoadingApps, isError: isErrorApps, refetch: refetchApps } = useQuery({
        queryKey: ['companyApplications'],
        queryFn: async () => {
            const companyId = await getAuthenticatedCompanyId();
            const { data } = await supabase
                .from('applications')
                .select('*, jobs!inner(title, company_id)')
                .eq('jobs.company_id', companyId)
                .order('created_at', { ascending: false })
                .limit(5);
            return data || [];
        },
        enabled: !!company
    });

    // Turnos "em andamento" (freela contratado/atuando agora) — distinto de turnos só abertos.
    const { data: inProgressCount = 0 } = useQuery({
        queryKey: ['companyInProgress'],
        queryFn: async () => {
            const companyId = await getAuthenticatedCompanyId();
            const { data } = await supabase
                .from('applications')
                .select('job_id, jobs!inner(company_id)')
                .eq('jobs.company_id', companyId)
                .in('status', ['hired', 'in_progress']);
            return new Set((data || []).map((r: { job_id: string }) => r.job_id)).size;
        },
        enabled: !!company
    });

    // PostgREST tipa embeds de relação como array; normalizamos para objeto no render.
    interface ActiveShiftWorker { id: string; full_name: string | null; avatar_url: string | null; primary_role: string | null }
    interface ActiveShiftJob { id: string; title: string | null; location: string | null; work_start_time: string | null; work_end_time: string | null }
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
    const { data: activeShifts = [] } = useQuery<ActiveShiftRow[]>({
        queryKey: ['companyActiveShifts'],
        queryFn: async () => {
            const companyId = await getAuthenticatedCompanyId();
            const { data } = await supabase
                .from('applications')
                .select(`
                    id,
                    job_id,
                    status,
                    worker_checkin_at,
                    company_checkin_confirmed_at,
                    worker_checkout_at,
                    company_checkout_confirmed_at,
                    created_at,
                    worker:workers(id, full_name, avatar_url, primary_role),
                    jobs!inner(id, title, location, work_start_time, work_end_time, company_id)
                `)
                .eq('jobs.company_id', companyId)
                .in('status', ['hired', 'in_progress'])
                .order('created_at', { ascending: false });
            return (data ?? []) as unknown as ActiveShiftRow[];
        },
        enabled: !!company
    });

    // ── PRECISA DE VOCÊ: o rabo do laço do dinheiro ─────────────────────────────────────────
    // O freela tem casa persistente para "pagamento registrado — confirme"; o lado da EMPRESA
    // não tinha nenhuma: turno concluído sem pagamento registrado e agendamento vencido só
    // apareciam se ela abrisse exatamente o turno certo em /company/jobs. Notificação é
    // transitória e fácil de perder; ação pendente pede indicador PERSISTENTE onde a pessoa já
    // está (NN/g, "Indicators, Validations, and Notifications"). Best-effort: em erro, loga e
    // some — o dashboard nunca quebra por causa da triagem.
    interface PendingPayRow {
        job_id: string;
        worker_id: string;
        titulo: string;
        freela: string;
        tipo: 'registrar' | 'efetivar';
        venceuEm?: string;
    }
    const { data: pendingPayments = [] } = useQuery<PendingPayRow[]>({
        queryKey: ['companyPendingPayments'],
        queryFn: async () => {
            try {
                const companyId = await getAuthenticatedCompanyId();
                const [{ data: concluidos }, { data: marcadores }] = await Promise.all([
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
                const um = <T,>(v: T | T[] | null): T | null => (Array.isArray(v) ? v[0] ?? null : v);
                // 1 marcador ativo por (turno, freela) — o UNIQUE parcial do banco garante.
                const comMarcador = new Set((marcadores ?? []).map((m) => `${m.job_id}:${m.worker_id}`));
                const rows: PendingPayRow[] = [];
                for (const a of (concluidos ?? []) as unknown as Array<{ job_id: string; worker_id: string; worker: { full_name: string | null } | { full_name: string | null }[] | null; jobs: { title: string | null } | { title: string | null }[] | null }>) {
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
                return [];
            }
        },
        enabled: !!company
    });

    // Derived State
    const companyName = company?.name || '';
    const loading = isLoadingCompany;

    const stats = {
        activeJobs: isErrorJobs ? null : jobs.filter(j => j.status === 'open').length,
        totalJobs: isErrorJobs ? null : jobs.length,
    };

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

    return (
        <div className="max-w-7xl mx-auto animate-in fade-in slide-in-from-bottom-4 duration-500">
            <PageMeta title="Dashboard da Empresa" />
            {/* Critical error: company profile failed */}
            {isErrorCompany && (
                <div className="mb-6">
                    <SectionError
                        message="Erro ao carregar dados da empresa. Tente novamente."
                        onRetry={() => { refetchCompany(); }}
                    />
                </div>
            )}

            <PageHeader title="Dashboard" subtitle={`Bem-vindo de volta, ${companyName || 'Empresa'}`} />

            <div className="space-y-8">
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
                                <ClickableCard
                                    key={`${row.job_id}:${row.worker_id}:${row.tipo}`}
                                    onClick={() => navigate(`/company/jobs/${row.job_id}/candidates`)}
                                    className="min-h-11 border-l-8 border-l-orange-500"
                                >
                                    <p className="font-bold text-sm">
                                        {row.tipo === 'registrar' ? 'Registrar pagamento' : 'Efetivar pagamento agendado'}
                                    </p>
                                    <p className="text-xs text-gray-600 mt-1 truncate">
                                        {row.tipo === 'registrar'
                                            ? `${row.freela} · ${row.titulo}`
                                            : `${row.titulo}${row.venceuEm ? ` · previsto para ${row.venceuEm.split('-').reverse().join('/')}` : ''}`}
                                    </p>
                                </ClickableCard>
                            ))}
                        </div>
                        {pendingPayments.length > 4 && (
                            <p className="text-xs text-gray-600 mt-3">
                                +{pendingPayments.length - 4} outros — abra cada turno em Turnos para resolver.
                            </p>
                        )}
                    </section>
                )}

                {/* KPI Cards */}
                {isErrorJobs ? (
                    <SectionError
                        message="Erro ao carregar indicadores. Tente novamente."
                        onRetry={() => { refetchJobs(); }}
                    />
                ) : (
                    <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                        {[
                            { title: 'Turnos ativos', value: stats.activeJobs, icon: Briefcase, onClick: () => navigate('/company/jobs?filter=open') },
                            { title: 'Em andamento', value: inProgressCount, icon: PlayCircle, onClick: () => navigate('/company/jobs?filter=andamento') },
                            { title: 'Total de turnos', value: stats.totalJobs, icon: TrendingUp, onClick: () => navigate('/company/jobs') }
                        ].map((stat) => (
                            <ClickableCard key={stat.title} onClick={stat.onClick}>
                                <div className="flex items-center gap-2 text-gray-600 mb-3">
                                    <stat.icon size={18} aria-hidden="true" />
                                    <p className="text-sm font-semibold">{stat.title}</p>
                                </div>
                                <p className="text-4xl font-bold tabular-nums">{stat.value ?? '-'}</p>
                            </ClickableCard>
                        ))}
                    </div>
                )}

                {/* Turnos em Andamento / Acompanhamento Direto */}
                {activeShifts.length > 0 && (
                    <section aria-label="Turnos em andamento">
                        <div className="flex items-center justify-between gap-3 mb-4">
                            <h2 className="text-lg font-bold flex items-center gap-2">
                                <PlayCircle size={20} className="text-green-600 animate-pulse" aria-hidden="true" /> Turnos em andamento ({activeShifts.length})
                            </h2>
                            <Button variant="ghost" size="sm" onClick={() => navigate('/company/jobs?filter=andamento')}>
                                Ver todos
                            </Button>
                        </div>
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                            {activeShifts.slice(0, 4).map((app) => {
                                const worker = Array.isArray(app.worker) ? app.worker[0] : app.worker;
                                const job = Array.isArray(app.jobs) ? app.jobs[0] : app.jobs;
                                // Quatro estados, nao dois: "Aguardando Chegada" pintava IGUAL o freela
                                // que ainda nao veio e o que JA registrou chegada e so espera a empresa
                                // confirmar — escondendo justamente o passo que e da empresa (NN/g #1,
                                // visibilidade do estado do sistema). Laranja = a acao e SUA.
                                const chegouConfirme = !!app.worker_checkin_at && !app.company_checkin_confirmed_at;
                                const saiuConfirme = !!app.company_checkin_confirmed_at && !!app.worker_checkout_at && !app.company_checkout_confirmed_at;
                                const estadoPresenca = saiuConfirme
                                    ? { rotulo: 'Saiu — confirme', cls: 'bg-orange-100 text-orange-800' }
                                    : chegouConfirme
                                        ? { rotulo: 'Chegou — confirme', cls: 'bg-orange-100 text-orange-800' }
                                        : app.company_checkin_confirmed_at
                                            ? { rotulo: 'Presença OK', cls: 'bg-green-100 text-green-700' }
                                            : { rotulo: 'Aguardando chegada', cls: 'bg-yellow-100 text-yellow-800' };

                                return (
                                    <Card
                                        key={app.id}
                                        interactive
                                        onClick={() => navigate(`/company/jobs/${app.job_id}/candidates`)}
                                        className="cursor-pointer flex flex-col justify-between gap-4"
                                    >
                                        <div className="flex items-start justify-between gap-3">
                                            <div className="flex items-center gap-3 min-w-0">
                                                <div className="w-12 h-12 rounded-xl bg-gray-200 border-2 border-black overflow-hidden flex-shrink-0 flex items-center justify-center font-bold">
                                                    {worker?.avatar_url ? (
                                                        <img src={worker.avatar_url} alt="" className="w-full h-full object-cover" />
                                                    ) : (
                                                        worker?.full_name?.[0]?.toUpperCase() ?? 'F'
                                                    )}
                                                </div>
                                                <div className="min-w-0">
                                                    <h3 className="font-bold text-base truncate">{worker?.full_name || 'Freela'}</h3>
                                                    <p className="text-xs text-gray-600 truncate">{job?.title || 'Turno'}</p>
                                                </div>
                                            </div>
                                            <span className={`px-2.5 py-1 rounded-pill text-xs font-semibold border border-black flex-shrink-0 ${estadoPresenca.cls}`}>
                                                {estadoPresenca.rotulo}
                                            </span>
                                        </div>

                                        <div className="flex items-center justify-between gap-3 pt-4 border-t-2 border-gray-100">
                                            <span className="text-xs text-gray-600 min-w-0 truncate">{job?.location || 'Local a combinar'}</span>
                                            <Button
                                                variant="dark"
                                                onClick={(e) => {
                                                    e.stopPropagation();
                                                    navigate(`/company/jobs/${app.job_id}/candidates`);
                                                }}
                                                className="flex-shrink-0"
                                            >
                                                Presença e Pagamento
                                            </Button>
                                        </div>
                                    </Card>
                                );
                            })}
                        </div>
                    </section>
                )}

                {/* Indicações recebidas (F10) — atalho mobile, ver comentário no hook acima. Fica
                    visível mesmo com 0 pendentes: é a PORTA para a caixa de entrada, não só um badge. */}
                <ClickableCard onClick={() => navigate('/company/indicacoes')}>
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
                </ClickableCard>

                {/* Recent Jobs Section */}
                <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
                    {/* Job List */}
                    <section className="lg:col-span-2 space-y-4" aria-label="Turnos recentes">
                        <h2 className="text-lg font-bold flex items-center gap-2">
                            <Briefcase size={20} aria-hidden="true" /> Turnos recentes
                        </h2>

                        <div className="space-y-4">
                            {isErrorJobs ? (
                                <SectionError
                                    message="Erro ao carregar turnos. Tente novamente."
                                    onRetry={() => { refetchJobs(); }}
                                />
                            ) : loading || isLoadingJobs ? (
                                <div className="space-y-4 animate-pulse">
                                    {[...Array(3)].map((_, i) => (
                                        <div key={i} className="bg-gray-200 rounded-2xl h-28" />
                                    ))}
                                </div>
                            ) : jobs.length === 0 ? (
                                <div className="text-center py-10 px-4 border-2 border-dashed border-gray-300 rounded-2xl">
                                    <p className="font-semibold text-gray-600 mb-4">Nenhum turno encontrado.</p>
                                    <Button variant="dark" onClick={() => navigate('/company/create')}>Criar primeiro turno</Button>
                                </div>
                            ) : (
                                jobs.slice(0, 5).map((job) => (
                                    <Card
                                        key={job.id}
                                        interactive
                                        role="button"
                                        tabIndex={0}
                                        onClick={() => navigate(`/company/jobs/${job.id}/candidates`)}
                                        onKeyDown={(e) => { if (e.target === e.currentTarget && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); navigate(`/company/jobs/${job.id}/candidates`); } }}
                                        className="cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-black focus-visible:ring-offset-2"
                                    >
                                        <div className="flex justify-between items-start gap-3">
                                            <div className="min-w-0">
                                                <h3 className="font-bold text-base truncate">{job.title}</h3>
                                                <p className="text-xs text-gray-600 mt-1">{job.location || 'Presencial'} • {job.type === 'freelance' ? 'Freelance' : 'Fixo'}</p>
                                            </div>
                                            <span className={`px-3 py-1 rounded-pill text-xs font-semibold flex-shrink-0 ${job.status === 'open' ? 'bg-primary-light text-primary' : 'bg-gray-100 text-gray-700'}`}>
                                                {job.status === 'open' ? 'Ativo' : 'Fechado'}
                                            </span>
                                        </div>
                                        <div className="flex items-center justify-between gap-4 text-xs text-gray-600 border-t-2 border-gray-100 pt-3 mt-4">
                                            <span>Criado {formatDistanceToNow(new Date(job.created_at as string), { addSuffix: true, locale: ptBR })}</span>
                                            {/* Repetir no ponto de contexto: a pessoa esta OLHANDO o turno
                                                que quer refazer — nao precisa ir ao Criar e reencontra-lo
                                                na vitrine. Mesmo motor do ?repetir= (data em branco). */}
                                            <Button
                                                variant="ghost"
                                                onClick={(e) => { e.stopPropagation(); navigate(`/company/create?repetir=${job.id}`); }}
                                                iconLeft={<RefreshCw size={14} />}
                                                className="-my-2 flex-shrink-0"
                                            >
                                                Repetir
                                            </Button>
                                        </div>
                                    </Card>
                                ))
                            )}
                        </div>
                    </section>

                    {/* Activity Feed */}
                    <section className="space-y-4" aria-label="Atividade recente">
                        <h2 className="text-lg font-bold flex items-center gap-2">
                            <Bell size={20} aria-hidden="true" /> Atividade recente
                        </h2>
                        <Card className="space-y-5">
                            {hasActivityError ? (
                                <SectionError
                                    message="Erro ao carregar atividades. Tente novamente."
                                    onRetry={() => { refetchJobs(); refetchApps(); }}
                                />
                            ) : loading || isLoadingJobs || isLoadingApps ? (
                                <div className="space-y-4 animate-pulse">
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
                                        <div key={i} className="flex gap-3 items-start animate-in fade-in slide-in-from-right-4" style={{ animationDelay: `${i * 100}ms` }}>
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

                        <Card>
                            <h3 className="font-bold text-base mb-2">Dica</h3>
                            <p className="text-sm text-gray-600 mb-4">Freelas veem seu perfil antes de aceitar o convite. Endereço e briefing padrão preenchidos aceleram a resposta.</p>
                            <Button variant="secondary" fullWidth onClick={() => navigate('/company/profile')}>
                                Completar Perfil
                            </Button>
                        </Card>
                    </section>
                </div>
            </div>
        </div>
    );
}
