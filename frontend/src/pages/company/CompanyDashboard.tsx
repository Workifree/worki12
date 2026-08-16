import { useNavigate } from 'react-router-dom';
import { Briefcase, TrendingUp, Search, Filter, Bell, AlertTriangle, RefreshCw, PlayCircle } from 'lucide-react';
import { supabase } from '../../lib/supabase';
import PageMeta from '../../components/PageMeta';
import { useQuery } from '@tanstack/react-query';
import { formatDistanceToNow } from 'date-fns';
import { ptBR } from 'date-fns/locale';

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
    // React Query Hooks
    const { data: company, isLoading: isLoadingCompany, isError: isErrorCompany, refetch: refetchCompany } = useQuery({
        queryKey: ['companyProfile'],
        queryFn: async () => {
            const { data: { user } } = await supabase.auth.getUser();
            if (!user) throw new Error('No user');
            const { data } = await supabase.from('companies').select('name').eq('id', user.id).single();
            return data;
        }
    });

    const { data: jobs = [], isLoading: isLoadingJobs, isError: isErrorJobs, refetch: refetchJobs } = useQuery({
        queryKey: ['companyJobs'],
        queryFn: async () => {
            const { data: { user } } = await supabase.auth.getUser();
            if (!user) return [];
            const { data } = await supabase
                .from('jobs')
                .select('*, views')
                .eq('company_id', user.id)
                .order('created_at', { ascending: false });
            return data || [];
        },
        enabled: !!company
    });

    const { data: applications = [], isLoading: isLoadingApps, isError: isErrorApps, refetch: refetchApps } = useQuery({
        queryKey: ['companyApplications'],
        queryFn: async () => {
            const { data: { user } } = await supabase.auth.getUser();
            if (!user) return [];
            const { data } = await supabase
                .from('applications')
                .select('*, jobs!inner(title, company_id)')
                .eq('jobs.company_id', user.id)
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
            const { data: { user } } = await supabase.auth.getUser();
            if (!user) return 0;
            const { data } = await supabase
                .from('applications')
                .select('job_id, jobs!inner(company_id)')
                .eq('jobs.company_id', user.id)
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
        created_at: string;
        worker: ActiveShiftWorker | ActiveShiftWorker[] | null;
        jobs: ActiveShiftJob | ActiveShiftJob[] | null;
    }

    // Detalhes dos turnos ativos/em andamento para acesso direto de acompanhamento
    const { data: activeShifts = [] } = useQuery<ActiveShiftRow[]>({
        queryKey: ['companyActiveShifts'],
        queryFn: async () => {
            const { data: { user } } = await supabase.auth.getUser();
            if (!user) return [];
            const { data } = await supabase
                .from('applications')
                .select(`
                    id,
                    job_id,
                    status,
                    worker_checkin_at,
                    company_checkin_confirmed_at,
                    created_at,
                    worker:workers(id, full_name, avatar_url, primary_role),
                    jobs!inner(id, title, location, work_start_time, work_end_time, company_id)
                `)
                .eq('jobs.company_id', user.id)
                .in('status', ['hired', 'in_progress'])
                .order('created_at', { ascending: false });
            return (data ?? []) as unknown as ActiveShiftRow[];
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

            {/* Turnos em Andamento / Acompanhamento Direto */}
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
                            const checkinDone = !!app.company_checkin_confirmed_at;

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
                                        <span className={`px-2.5 py-1 rounded-full text-[10px] font-black uppercase border border-black flex-shrink-0 ${checkinDone ? 'bg-green-100 text-green-700' : 'bg-yellow-100 text-yellow-800'}`}>
                                            {checkinDone ? 'Presença OK' : 'Aguardando Chegada'}
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
                                            Acompanhar / Presença
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
                        <div className="flex gap-2">
                            <button className="p-2 hover:bg-gray-100 rounded-lg transition-colors border-2 border-transparent hover:border-black">
                                <Search size={18} />
                            </button>
                            <button className="p-2 hover:bg-gray-100 rounded-lg transition-colors border-2 border-transparent hover:border-black">
                                <Filter size={18} />
                            </button>
                        </div>
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
                                <button onClick={() => navigate('/company/create')} className="text-blue-600 font-black text-sm uppercase mt-2 hover:underline">Criar primeiro turno</button>
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
                                    <div className="flex items-center gap-4 text-sm font-bold border-t-2 border-gray-50 pt-3 mt-3 text-gray-400">
                                        <span>Criado {formatDistanceToNow(new Date(job.created_at as string), { addSuffix: true, locale: ptBR })}</span>
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
                        <p className="text-sm opacity-90 mb-4">Empresas com perfis completos engajam 3x mais freelas qualificados.</p>
                        <button onClick={() => navigate('/company/profile')} className="bg-white text-black w-full py-2 rounded-lg font-bold uppercase text-xs hover:bg-gray-100 transition-colors">
                            Completar Perfil
                        </button>
                    </div>
                </div>
            </div>
        </div>
    );
}
