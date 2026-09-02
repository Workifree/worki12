import { useEffect, useState } from 'react';
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

function SectionError({ message, onRetry }: { message: string; onRetry: () => void }) {
    return (
        <div className="p-6 bg-red-50 border-2 border-red-200 rounded-xl text-center">
            <AlertTriangle size={24} className="text-red-400 mx-auto mb-2" />
            <p className="font-bold text-red-700 text-sm mb-3">{message}</p>
            <button
                onClick={onRetry}
                className="inline-flex items-center gap-1.5 px-4 py-2 bg-red-100 text-red-700 rounded-lg font-bold text-xs uppercase hover:bg-red-200 transition-colors border border-red-300"
            >
                <RefreshCw size={14} /> Tentar novamente
            </button>
        </div>
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

            {/* Header */}
            <div className="flex justify-between items-center mb-8">
                <div>
                    <h1 className="text-3xl font-black uppercase tracking-tighter">Dashboard</h1>
                    <p className="text-gray-500 font-medium">Bem-vindo de volta, {companyName || 'Empresa'}</p>
                </div>
                {/* Button Removed as requested */}
            </div>

            {/* KPI Cards */}
            {isErrorJobs ? (
                <div className="mb-12">
                    <SectionError
                        message="Erro ao carregar indicadores. Tente novamente."
                        onRetry={() => { refetchJobs(); }}
                    />
                </div>
            ) : (
                <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-12">
                    {[
                        { title: 'Turnos Ativos', value: stats.activeJobs, icon: Briefcase, color: 'bg-blue-100 text-blue-600', hint: 'Abertos', onClick: () => navigate('/company/jobs?filter=open') },
                        { title: 'Em Andamento', value: inProgressCount, icon: PlayCircle, color: 'bg-green-100 text-green-600', hint: 'Agora', onClick: () => navigate('/company/jobs?filter=andamento') },
                        { title: 'Total de Turnos', value: stats.totalJobs, icon: TrendingUp, color: 'bg-purple-100 text-purple-600', hint: 'Tudo', onClick: () => navigate('/company/jobs') }
                    ].map((stat, i) => (
                        <button key={i} onClick={stat.onClick} className="text-left bg-white border-2 border-black rounded-xl p-6 shadow-[6px_6px_0px_0px_rgba(0,0,0,0.1)] hover:shadow-[8px_8px_0px_0px_rgba(0,0,0,0.15)] hover:-translate-y-0.5 transition-all">
                            <div className="flex items-center justify-between mb-4">
                                <div className={`p-3 rounded-lg ${stat.color} border-2 border-black`}>
                                    <stat.icon size={24} />
                                </div>
                                <span className="text-xs font-black uppercase bg-gray-100 px-2 py-1 rounded">{stat.hint}</span>
                            </div>
                            <h3 className="text-4xl font-black mb-1">{stat.value ?? '-'}</h3>
                            <p className="text-gray-500 font-bold uppercase text-xs">{stat.title}</p>
                        </button>
                    ))}
                </div>
            )}

            {/* Indicações recebidas (F10) — atalho mobile, ver comentário no hook acima. Fica
                visível mesmo com 0 pendentes: é a PORTA para a caixa de entrada, não só um badge. */}
            <button
                type="button"
                onClick={() => navigate('/company/indicacoes')}
                className="w-full text-left bg-white border-2 border-black rounded-2xl p-5 mb-10 flex items-center justify-between gap-4 shadow-[6px_6px_0px_0px_rgba(0,166,81,1)] hover:-translate-y-0.5 transition-all"
            >
                <div className="flex items-center gap-4">
                    <div className="p-3 rounded-lg bg-primary-light text-primary border-2 border-black">
                        <Share2 size={24} />
                    </div>
                    <div>
                        <p className="font-black uppercase">Indicações recebidas</p>
                        <p className="text-xs font-bold text-gray-500 uppercase">
                            {pendingReferralsCount
                                ? `${pendingReferralsCount} freela${pendingReferralsCount > 1 ? 's' : ''} aguardando decisão`
                                : 'Freelas indicados por outras empresas'}
                        </p>
                    </div>
                </div>
                {!!pendingReferralsCount && (
                    <span className="bg-black text-white px-3 py-1 rounded-pill font-black text-sm flex-shrink-0">
                        {pendingReferralsCount}
                    </span>
                )}
            </button>

            {/* Turnos em Andamento / Acompanhamento Direto */}
            {/* PRECISA DE VOCÊ — o rabo do laço do dinheiro, persistente no painel.
                Laranja e no topo: é a triagem do dia. Início = o que precisa de você agora;
                Turnos = a gestão completa. */}
            {pendingPayments.length > 0 && (
                <div className="mb-10">
                    <h2 className="text-xl font-black uppercase flex items-center gap-2 mb-4">
                        <AlertTriangle size={22} className="text-orange-500" /> Precisa de você ({pendingPayments.length})
                    </h2>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        {pendingPayments.slice(0, 4).map((row) => (
                            <button
                                key={`${row.job_id}:${row.worker_id}:${row.tipo}`}
                                onClick={() => navigate(`/company/jobs/${row.job_id}/candidates`)}
                                className="min-h-11 bg-orange-50 border-2 border-black rounded-2xl p-5 shadow-[6px_6px_0px_0px_rgba(234,88,12,1)] hover:-translate-y-0.5 transition-all text-left"
                            >
                                <p className="font-black uppercase text-sm">
                                    {row.tipo === 'registrar' ? 'Registrar pagamento' : 'Efetivar pagamento agendado'}
                                </p>
                                <p className="text-xs font-bold text-gray-600 mt-1 truncate">
                                    {row.tipo === 'registrar'
                                        ? `${row.freela} · ${row.titulo}`
                                        : `${row.titulo}${row.venceuEm ? ` · previsto para ${row.venceuEm.split('-').reverse().join('/')}` : ''}`}
                                </p>
                            </button>
                        ))}
                    </div>
                    {pendingPayments.length > 4 && (
                        <p className="text-xs font-bold text-gray-500 mt-3">
                            +{pendingPayments.length - 4} outros — abra cada turno em Turnos para resolver.
                        </p>
                    )}
                </div>
            )}

            {activeShifts.length > 0 && (
                <div className="mb-10">
                    <div className="flex items-center justify-between mb-4">
                        <h2 className="text-xl font-black uppercase flex items-center gap-2">
                            <PlayCircle size={22} className="text-green-600 animate-pulse" /> Turnos em Andamento ({activeShifts.length})
                        </h2>
                        <button
                            onClick={() => navigate('/company/jobs?filter=andamento')}
                            className="text-xs font-black uppercase text-blue-600 hover:underline"
                        >
                            Ver todos
                        </button>
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
                                <div
                                    key={app.id}
                                    onClick={() => navigate(`/company/jobs/${app.job_id}/candidates`)}
                                    className="bg-white border-2 border-black rounded-2xl p-5 shadow-[6px_6px_0px_0px_rgba(0,166,81,1)] hover:-translate-y-0.5 transition-all cursor-pointer flex flex-col justify-between gap-4"
                                >
                                    <div className="flex items-start justify-between gap-3">
                                        <div className="flex items-center gap-3 min-w-0">
                                            <div className="w-12 h-12 rounded-xl bg-gray-200 border-2 border-black overflow-hidden flex-shrink-0 flex items-center justify-center font-black">
                                                {worker?.avatar_url ? (
                                                    <img src={worker.avatar_url} alt="" className="w-full h-full object-cover" />
                                                ) : (
                                                    worker?.full_name?.[0]?.toUpperCase() ?? 'F'
                                                )}
                                            </div>
                                            <div className="min-w-0">
                                                <h4 className="font-black uppercase text-base truncate">{worker?.full_name || 'Freela'}</h4>
                                                <p className="text-xs font-bold text-gray-500 uppercase truncate">{job?.title || 'Turno'}</p>
                                            </div>
                                        </div>
                                        <span className={`px-2.5 py-1 rounded-full text-[10px] font-black uppercase border border-black flex-shrink-0 ${estadoPresenca.cls}`}>
                                            {estadoPresenca.rotulo}
                                        </span>
                                    </div>

                                    <div className="flex items-center justify-between pt-3 border-t-2 border-gray-100 text-xs font-bold text-gray-500">
                                        <span>{job?.location || 'Local a combinar'}</span>
                                        <button
                                            onClick={(e) => {
                                                e.stopPropagation();
                                                navigate(`/company/jobs/${app.job_id}/candidates`);
                                            }}
                                            className="bg-black hover:bg-primary text-white px-3 py-1.5 rounded-lg font-black uppercase text-xs transition-colors flex items-center gap-1"
                                        >
                                            Presença e Pagamento
                                        </button>
                                    </div>
                                </div>
                            );
                        })}
                    </div>
                </div>
            )}

            {/* Recent Jobs Section */}
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
                {/* Job List */}
                <div className="lg:col-span-2 space-y-6">
                    <div className="flex items-center justify-between">
                        <h2 className="text-xl font-black uppercase flex items-center gap-2">
                            <Briefcase size={20} /> Turnos Recentes
                        </h2>
                    </div>

                    <div className="space-y-4">
                        {isErrorJobs ? (
                            <SectionError
                                message="Erro ao carregar turnos. Tente novamente."
                                onRetry={() => { refetchJobs(); }}
                            />
                        ) : loading || isLoadingJobs ? (
                            <div className="space-y-4 animate-pulse">
                                {[...Array(3)].map((_, i) => (
                                    <div key={i} className="bg-gray-200 rounded-xl h-28" />
                                ))}
                            </div>
                        ) : jobs.length === 0 ? (
                            <div className="text-center py-10 border-2 border-dashed border-gray-300 rounded-xl">
                                <p className="font-bold text-gray-500">Nenhum turno encontrado.</p>
                                <button onClick={() => navigate('/company/create')} className="min-h-11 px-2 -mx-2 inline-flex items-center text-blue-600 font-black text-sm uppercase mt-2 hover:underline">Criar primeiro turno</button>
                            </div>
                        ) : (
                            jobs.slice(0, 5).map((job) => (
                                <div key={job.id} role="button" tabIndex={0} onClick={() => navigate(`/company/jobs/${job.id}/candidates`)} onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); navigate(`/company/jobs/${job.id}/candidates`); } }} className="bg-white border-2 border-black rounded-xl p-5 hover:translate-x-1 hover:-translate-y-1 transition-transform cursor-pointer group">
                                    <div className="flex justify-between items-start mb-3">
                                        <div>
                                            <h3 className="font-black text-lg uppercase group-hover:text-blue-600 transition-colors">{job.title}</h3>
                                            <p className="text-xs font-bold text-gray-400 uppercase">{job.location || 'Presencial'} • {job.type === 'freelance' ? 'Freelance' : 'Fixo'}</p>
                                        </div>
                                        <span className={`px-3 py-1 rounded-full text-[10px] font-black uppercase border border-black ${job.status === 'open' ? 'bg-green-400' : 'bg-gray-200'}`}>
                                            {job.status === 'open' ? 'Ativo' : 'Fechado'}
                                        </span>
                                    </div>
                                    <div className="flex items-center justify-between gap-4 text-sm font-bold border-t-2 border-gray-50 pt-3 mt-3 text-gray-400">
                                        <span>Criado {formatDistanceToNow(new Date(job.created_at as string), { addSuffix: true, locale: ptBR })}</span>
                                        {/* Repetir no ponto de contexto: a pessoa esta OLHANDO o turno
                                            que quer refazer — nao precisa ir ao Criar e reencontra-lo
                                            na vitrine. Mesmo motor do ?repetir= (data em branco). */}
                                        <button
                                            onClick={(e) => { e.stopPropagation(); navigate(`/company/create?repetir=${job.id}`); }}
                                            className="min-h-11 px-3 -my-2 inline-flex items-center gap-1.5 text-blue-600 font-black text-xs uppercase hover:underline flex-shrink-0"
                                        >
                                            <RefreshCw size={13} /> Repetir
                                        </button>
                                    </div>
                                </div>
                            ))
                        )}
                    </div>
                </div>

                {/* Activity Feed */}
                <div className="space-y-6">
                    <h2 className="text-xl font-black uppercase flex items-center gap-2">
                        <Bell size={20} /> Atividade Recente
                    </h2>
                    <div className="bg-gray-50 border-2 border-black rounded-xl p-6 space-y-6">
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
                                            <div className="h-4 bg-gray-200 rounded w-3/4" />
                                            <div className="h-3 bg-gray-200 rounded w-1/3" />
                                        </div>
                                    </div>
                                ))}
                            </div>
                        ) : activities.length === 0 ? (
                            <p className="text-sm text-gray-400 font-bold text-center">Nenhuma atividade recente.</p>
                        ) : (
                            <>
                                {(isErrorJobs || isErrorApps) && (
                                    <div className="flex items-center gap-2 p-2 bg-yellow-50 border border-yellow-200 rounded-lg">
                                        <AlertTriangle size={14} className="text-yellow-500 flex-shrink-0" />
                                        <span className="text-xs font-bold text-yellow-700">Alguns dados podem estar incompletos.</span>
                                    </div>
                                )}
                                {activities.map((activity, i) => (
                                    <div key={i} className="flex gap-3 items-start animate-in fade-in slide-in-from-right-4" style={{ animationDelay: `${i * 100}ms` }}>
                                        <div className={`w-2 h-2 mt-2 rounded-full flex-shrink-0 ${activity.type === 'job_created' ? 'bg-blue-500' : 'bg-green-500'}`} aria-hidden="true" />
                                        <div>
                                            <p className="text-sm font-bold leading-tight">{activity.text}</p>
                                            <p className="text-[10px] font-bold text-gray-400 uppercase mt-1">
                                                {formatDistanceToNow(new Date(activity.time), { addSuffix: true, locale: ptBR })}
                                            </p>
                                        </div>
                                    </div>
                                ))}
                            </>
                        )}
                    </div>

                    <div className="bg-blue-600 text-white border-2 border-black rounded-xl p-6 shadow-[6px_6px_0px_0px_rgba(0,0,0,1)]">
                        <h3 className="font-black uppercase text-lg mb-2">Dica Pro</h3>
                        <p className="text-sm opacity-90 mb-4">Freelas veem seu perfil antes de aceitar o convite. Endereço e briefing padrão preenchidos aceleram a resposta.</p>
                        <button onClick={() => navigate('/company/profile')} className="bg-white text-black w-full min-h-11 py-2 rounded-lg font-bold uppercase text-xs hover:bg-gray-100 transition-colors">
                            Completar Perfil
                        </button>
                    </div>
                </div>
            </div>
        </div>
    );
}
