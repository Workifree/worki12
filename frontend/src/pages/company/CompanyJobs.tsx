import { Search, PlusCircle, MoreHorizontal, Eye, Users, Edit2, Trash2, PauseCircle, PlayCircle, Send, Loader2, X, UserPlus } from 'lucide-react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useEffect, useState } from 'react';
import { supabase } from '../../lib/supabase';
import PageMeta from '../../components/PageMeta';
import { formatDistanceToNow } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import { WalletService } from '../../services/walletService';
import { useToast } from '../../contexts/ToastContext';
import { useCompanyTeam } from '../../hooks/useTeamConnections';
import { useCompanyInvites } from '../../hooks/useShiftInvites';
import { logError } from '../../lib/logger'
import type { TeamMember } from '../../types';

// ---------------------------------------------------------------------------
// Modelo push (pivô "Meu Elenco"): a vaga não recebe candidatos/visitas — a
// empresa convida um freela do elenco. Derivamos o estado do freela por vaga a
// partir de `applications` (mesma lógica de expiração de CompanyJobCandidates).
// ---------------------------------------------------------------------------

type FreelaState = 'awaiting' | 'confirmed' | 'completed';

interface FreelaSummary {
    name: string;
    avatarUrl: string | null;
    state: FreelaState;
    extraCount: number;
}

interface AppRow {
    status: string;
    invitation_expires_at?: string | null;
    invitation_response?: string | null;
    worker?: { full_name?: string | null; avatar_url?: string | null } | null;
}

// Convite sem resposta cujo prazo venceu — o slot volta a ficar livre (deriva na leitura).
function isExpiredInvite(app: AppRow): boolean {
    const pastDeadline = !!app.invitation_expires_at && new Date(app.invitation_expires_at) < new Date();
    return (
        (app.status === 'invited' && pastDeadline) ||
        (app.status === 'declined' && !app.invitation_response && pastDeadline)
    );
}

const INACTIVE_STATUSES = new Set(['declined', 'rejected', 'cancelled']);
const STATUS_RANK: Record<string, number> = { invited: 1, pending: 1, interview: 1, hired: 2, in_progress: 3, completed: 4 };

function stateForStatus(status: string): FreelaState {
    if (status === 'completed') return 'completed';
    if (status === 'hired' || status === 'in_progress') return 'confirmed';
    return 'awaiting';
}

// Resume o freela "principal" de uma vaga: ignora recusas/expirados e escolhe o de
// status mais avançado. `null` = vaga sem freela ativo (pode convidar).
function summarizeFreela(apps: AppRow[]): FreelaSummary | null {
    const active = apps.filter((a) => !INACTIVE_STATUSES.has(a.status) && !isExpiredInvite(a));
    if (active.length === 0) return null;
    const best = active.reduce((b, a) => ((STATUS_RANK[a.status] ?? 0) > (STATUS_RANK[b.status] ?? 0) ? a : b));
    return {
        name: best.worker?.full_name || 'Freela',
        avatarUrl: best.worker?.avatar_url ?? null,
        state: stateForStatus(best.status),
        extraCount: active.length - 1,
    };
}

export default function CompanyJobs() {
    const navigate = useNavigate();
    interface Job {
        id: string;
        title: string;
        type: string;
        status: string;
        location?: string;
        created_at: string;
        freela?: FreelaSummary | null;
    }

    const [jobs, setJobs] = useState<Job[]>([]);
    const [loading, setLoading] = useState(true);
    const [searchParams, setSearchParams] = useSearchParams();
    // Filtro inicial vem do deep-link (?filter=andamento vindo do dashboard, etc.).
    const initialFilter = (['all', 'open', 'closed', 'andamento'] as const).find(f => f === searchParams.get('filter')) ?? 'all';
    const [filter, setFilter] = useState<'all' | 'open' | 'closed' | 'andamento'>(initialFilter);
    const [search, setSearch] = useState('');
    const [debouncedSearch, setDebouncedSearch] = useState('');
    const [openMenu, setOpenMenu] = useState<string | null>(null);
    const [deleteJobId, setDeleteJobId] = useState<string | null>(null);
    // Vaga alvo do modal "Convidar Freela" (atrelar freela a uma vaga já criada).
    const [inviteJobId, setInviteJobId] = useState<string | null>(null);
    const { addToast } = useToast();

    // Elenco da empresa + action de convite reaproveitados (mesmos de CompanyCreateJob).
    const { teamMembers, loading: teamLoading } = useCompanyTeam();
    const { invite, invitingWorkerId } = useCompanyInvites(inviteJobId);

    useEffect(() => {
        fetchJobs();
    }, []);

    // Debounce search input
    useEffect(() => {
        const timer = setTimeout(() => setDebouncedSearch(search), 300);
        return () => clearTimeout(timer);
    }, [search]);

    const fetchJobs = async () => {
        try {
            const { data: { user } } = await supabase.auth.getUser();
            if (!user) return;

            const { data: jobsData } = await supabase
                .from('jobs')
                .select('*')
                .eq('company_id', user.id)
                .neq('status', 'deleted') // Filter out deleted jobs
                .order('created_at', { ascending: false });

            if (jobsData) {
                // Batch fetch das candidaturas/convites (1 query) para derivar o estado do freela por vaga.
                const jobIds = jobsData.map(j => j.id);
                const { data: apps } = await supabase
                    .from('applications')
                    .select('job_id, status, invitation_expires_at, invitation_response, worker:workers(full_name, avatar_url)')
                    .in('job_id', jobIds);

                const byJob: Record<string, AppRow[]> = {};
                (apps || []).forEach((a) => {
                    // PostgREST tipa o embed `worker` como array (relação); normalizamos p/ objeto.
                    const w = Array.isArray(a.worker) ? a.worker[0] : a.worker;
                    (byJob[a.job_id] ||= []).push({
                        status: a.status,
                        invitation_expires_at: a.invitation_expires_at,
                        invitation_response: a.invitation_response,
                        worker: w ?? null,
                    });
                });

                const jobsWithFreela = jobsData.map(job => ({
                    ...job,
                    freela: summarizeFreela(byJob[job.id] || [])
                }));

                setJobs(jobsWithFreela);
            }
        } catch (error) {
            logError('Erro ao carregar vagas', error);
        } finally {
            setLoading(false);
        }
    };

    const handleStatusChange = async (id: string, newStatus: string) => {
        setOpenMenu(null);
        const { error } = await supabase.from('jobs').update({ status: newStatus }).eq('id', id);
        if (!error) fetchJobs();
    };

    const handleDelete = async (jobId: string) => {
        // 1. Cancel hired workers
        await supabase.from('applications').update({ status: 'cancelled' }).eq('job_id', jobId).in('status', ['hired', 'in_progress']);

        // 2. Refund escrow
        await WalletService.refundEscrow(jobId, 'Dinheiro retornado do escrow - turno deletado');

        // 3. Mark deleted
        const { error } = await supabase.from('jobs').update({ status: 'deleted' }).eq('id', jobId);
        if (!error) {
            addToast('Turno excluído com sucesso.', 'success');
            fetchJobs();
        } else {
            addToast('Erro ao excluir turno.', 'error');
        }
        setDeleteJobId(null);
    };

    // Atrela um freela do elenco a uma vaga já criada (convite push).
    const handleInvite = async (workerId: string) => {
        const ok = await invite(workerId);
        if (ok) {
            setInviteJobId(null);
            fetchJobs();
        }
    };

    // Muda o filtro e reflete no URL (mantém deep-link/back consistentes).
    const changeFilter = (next: 'all' | 'open' | 'closed' | 'andamento') => {
        setFilter(next);
        setSearchParams(next === 'all' ? {} : { filter: next }, { replace: true });
    };

    const filteredJobs = jobs.filter(job => {
        const matchesSearch = job.title.toLowerCase().includes(debouncedSearch.toLowerCase());
        const matchesFilter =
            filter === 'all' ? true
                : filter === 'open' ? job.status === 'open'
                    : filter === 'andamento' ? job.freela?.state === 'confirmed' // freela contratado/atuando agora
                        : job.status !== 'open';
        return matchesSearch && matchesFilter;
    });

    return (
        <>
        <PageMeta title="Meus Turnos" />
        {deleteJobId && (
            <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4 backdrop-blur-sm">
                <div className="bg-white rounded-2xl w-full max-w-sm p-6 border-2 border-black shadow-[6px_6px_0px_0px_rgba(0,0,0,1)]">
                    <h3 className="text-xl font-black uppercase mb-2">Excluir Turno</h3>
                    <p className="text-sm text-gray-600 mb-6">Tem certeza? O turno será cancelado e os freelas contratados serão notificados.</p>
                    <div className="flex gap-3">
                        <button onClick={() => setDeleteJobId(null)} className="flex-1 px-4 py-3 rounded-xl border-2 border-black font-bold uppercase text-sm hover:bg-gray-50">Cancelar</button>
                        <button onClick={() => handleDelete(deleteJobId)} className="flex-1 px-4 py-3 rounded-xl bg-red-600 text-white font-bold uppercase text-sm hover:bg-red-700">Excluir</button>
                    </div>
                </div>
            </div>
        )}
        <div className="animate-in fade-in slide-in-from-bottom-4 duration-500">
            <div className="flex justify-between items-center mb-8">
                <div>
                    <h1 className="text-3xl font-black uppercase tracking-tighter">Meus Turnos</h1>
                    <p className="text-gray-500 font-medium">Gerencie seus turnos ativos.</p>
                </div>
                <button
                    onClick={() => navigate('/company/create')}
                    className="flex items-center gap-2 bg-black text-white px-5 py-2.5 rounded-xl font-bold uppercase text-sm hover:bg-blue-600 transition-colors"
                >
                    <PlusCircle size={18} strokeWidth={3} /> Novo Turno
                </button>
            </div>

            {/* Filters */}
            <div className="flex gap-4 mb-6">
                <div className="relative flex-1 max-w-md">
                    <Search className="absolute left-3 top-3 text-gray-400" size={20} />
                    <input
                        type="text"
                        placeholder="Buscar turnos..."
                        value={search}
                        onChange={(e) => setSearch(e.target.value)}
                        className="w-full bg-white border-2 border-transparent focus:border-black rounded-xl py-2.5 pl-10 pr-4 font-medium outline-none transition-all placeholder:font-medium text-sm"
                    />
                </div>
                <button
                    onClick={() => changeFilter('all')}
                    className={`px-4 py-2 border-2 rounded-xl font-bold uppercase text-xs transition-all ${filter === 'all' ? 'bg-black text-white border-black' : 'bg-white border-transparent hover:border-black'}`}
                >
                    Todos
                </button>
                <button
                    onClick={() => changeFilter('open')}
                    className={`px-4 py-2 border-2 rounded-xl font-bold uppercase text-xs transition-all ${filter === 'open' ? 'bg-black text-white border-black' : 'bg-white border-transparent hover:border-black'}`}
                >
                    Abertos
                </button>
                <button
                    onClick={() => changeFilter('andamento')}
                    className={`px-4 py-2 border-2 rounded-xl font-bold uppercase text-xs transition-all ${filter === 'andamento' ? 'bg-black text-white border-black' : 'bg-white border-transparent hover:border-black'}`}
                >
                    Em Andamento
                </button>
                <button
                    onClick={() => changeFilter('closed')}
                    className={`px-4 py-2 border-2 rounded-xl font-bold uppercase text-xs transition-all ${filter === 'closed' ? 'bg-black text-white border-black' : 'bg-white border-transparent hover:border-black'}`}
                >
                    Finalizados
                </button>
            </div>

            {/* Jobs List */}
            <div className="space-y-4">
                {loading ? (
                    <div className="space-y-4 animate-pulse">
                        {[...Array(4)].map((_, i) => (
                            <div key={i} className="bg-gray-200 rounded-xl h-28" />
                        ))}
                    </div>
                ) : filteredJobs.length === 0 ? (
                    <div className="text-center py-10 font-bold text-gray-400 border-2 border-dashed border-gray-200 rounded-xl">
                        Nenhum turno encontrado.
                    </div>
                ) : (
                    filteredJobs.map((job) => (
                        <div key={job.id} className="bg-white border-2 border-gray-100 hover:border-black rounded-xl p-6 transition-all group shadow-sm hover:shadow-md">
                            <div className="flex flex-col md:flex-row justify-between md:items-center gap-4">

                                <div>
                                    <div className="flex items-center gap-3 mb-1">
                                        <h3 className="font-bold text-lg">{job.title}</h3>
                                        <span className={`text-[10px] font-black uppercase px-2 py-0.5 rounded ${job.status === 'open' ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-500'}`}>
                                            {job.status === 'open' ? 'Ativa' : 'Fechada'}
                                        </span>
                                    </div>
                                    <div className="flex items-center gap-4 text-xs text-gray-500 font-medium">
                                        <span className="bg-gray-50 px-2 py-1 rounded uppercase font-bold">{job.type === 'freelance' ? 'Freelance' : 'Fixo'}</span>
                                        <span>Publicado {formatDistanceToNow(new Date(job.created_at), { addSuffix: true, locale: ptBR })}</span>
                                        {job.location && <span>• {job.location}</span>}
                                    </div>
                                </div>

                                <div className="flex items-center gap-4 border-t md:border-t-0 pt-4 md:pt-0 border-gray-100">
                                    {/* Estado do freela (modelo push) — no lugar de Candidatos/Visitas */}
                                    {job.freela ? (
                                        <button
                                            onClick={() => navigate(`/company/jobs/${job.id}/candidates`)}
                                            className="flex items-center gap-2 text-left hover:opacity-80 transition-opacity"
                                        >
                                            <div className="w-9 h-9 rounded-xl border-2 border-black overflow-hidden bg-gray-100 flex-shrink-0">
                                                {job.freela.avatarUrl ? (
                                                    <img src={job.freela.avatarUrl} alt={job.freela.name} className="w-full h-full object-cover" />
                                                ) : (
                                                    <div className="w-full h-full flex items-center justify-center bg-black text-white font-black text-sm">
                                                        {job.freela.name[0]?.toUpperCase()}
                                                    </div>
                                                )}
                                            </div>
                                            <div className="flex flex-col">
                                                <span className="font-bold text-sm truncate max-w-[140px]">
                                                    {job.freela.name}{job.freela.extraCount > 0 ? ` +${job.freela.extraCount}` : ''}
                                                </span>
                                                <span className={`text-[10px] font-black uppercase ${job.freela.state === 'confirmed' ? 'text-green-600' :
                                                    job.freela.state === 'completed' ? 'text-blue-600' : 'text-orange-500'
                                                    }`}>
                                                    {job.freela.state === 'confirmed' ? 'Confirmado' : job.freela.state === 'completed' ? 'Finalizado' : 'Aguardando resposta'}
                                                </span>
                                            </div>
                                            {job.freela.state === 'confirmed' && (
                                                <span className="ml-1 bg-green-600 hover:bg-green-700 text-white px-2.5 py-1 rounded-lg font-black uppercase text-[10px] flex items-center gap-1 transition-colors">
                                                    <PlayCircle size={12} /> Presença
                                                </span>
                                            )}
                                        </button>
                                    ) : (job.status === 'open' || job.status === 'paused') ? (
                                        <button
                                            onClick={(e) => { e.stopPropagation(); setInviteJobId(job.id); }}
                                            className="flex items-center gap-2 bg-black text-white px-4 py-2 rounded-xl font-black uppercase text-xs hover:bg-blue-600 transition-colors"
                                        >
                                            <UserPlus size={16} strokeWidth={3} /> Convidar Freela
                                        </button>
                                    ) : (
                                        <span className="text-xs font-bold uppercase text-gray-400">Sem freela</span>
                                    )}

                                    <div className="relative">
                                        <button
                                            onClick={(e) => {
                                                e.stopPropagation();
                                                setOpenMenu(openMenu === job.id ? null : job.id);
                                            }}
                                            className="p-2 hover:bg-gray-100 rounded-lg transition-colors"
                                        >
                                            <MoreHorizontal size={20} className="text-gray-400" />
                                        </button>

                                        {openMenu === job.id && (
                                            <div className="absolute right-0 top-full mt-2 w-48 bg-white border-2 border-black rounded-xl shadow-[4px_4px_0px_0px_rgba(0,0,0,1)] z-10 overflow-hidden">
                                                <button
                                                    onClick={(e) => { e.stopPropagation(); navigate(`/company/jobs/${job.id}/candidates`); }}
                                                    className="w-full text-left px-4 py-3 hover:bg-gray-50 font-bold text-sm flex items-center gap-2 border-b border-gray-100"
                                                >
                                                    <Users size={16} /> Gerenciar Freelas
                                                </button>
                                                <button
                                                    onClick={(e) => { e.stopPropagation(); navigate(`/company/jobs/${job.id}`); }}
                                                    className="w-full text-left px-4 py-3 hover:bg-gray-50 font-bold text-sm flex items-center gap-2"
                                                >
                                                    <Eye size={16} /> Ver Detalhes
                                                </button>
                                                <button
                                                    onClick={(e) => { e.stopPropagation(); navigate(`/company/jobs/${job.id}/edit`); }}
                                                    className="w-full text-left px-4 py-3 hover:bg-gray-50 font-bold text-sm flex items-center gap-2 border-t border-gray-100"
                                                >
                                                    <Edit2 size={16} /> Editar
                                                </button>
                                                <button
                                                    onClick={(e) => {
                                                        e.stopPropagation();
                                                        handleStatusChange(job.id, job.status === 'open' ? 'paused' : 'open');
                                                    }}
                                                    className="w-full text-left px-4 py-3 hover:bg-gray-50 font-bold text-sm flex items-center gap-2 border-t border-gray-100"
                                                >
                                                    {job.status === 'open' ? <PauseCircle size={16} /> : <PlayCircle size={16} />}
                                                    {job.status === 'open' ? 'Pausar' : 'Reativar'}
                                                </button>
                                                <button
                                                    onClick={(e) => {
                                                        e.stopPropagation();
                                                        setOpenMenu(null);
                                                        setDeleteJobId(job.id);
                                                    }}
                                                    className="w-full text-left px-4 py-3 hover:bg-red-50 text-red-600 font-bold text-sm flex items-center gap-2 border-t border-gray-100"
                                                >
                                                    <Trash2 size={16} /> Excluir
                                                </button>
                                            </div>
                                        )}
                                    </div>
                                </div>

                            </div>
                        </div>
                    ))
                )}
            </div>
        </div>

        {/* Modal "Convidar Freela" — atrela um freela do elenco a uma vaga já criada */}
        {inviteJobId && (
            <div className="fixed inset-0 z-50 bg-black/50 backdrop-blur-sm flex items-center justify-center p-4 animate-in fade-in duration-200">
                <div className="bg-white rounded-2xl border-2 border-black shadow-[8px_8px_0px_0px_rgba(0,0,0,1)] w-full max-w-md p-6">
                    <div className="flex items-center justify-between mb-4">
                        <h2 className="text-2xl font-black uppercase tracking-tight">Convidar Freela</h2>
                        <button
                            onClick={() => setInviteJobId(null)}
                            aria-label="Fechar"
                            className="p-2 hover:bg-gray-100 rounded-xl transition-colors"
                        >
                            <X size={20} />
                        </button>
                    </div>
                    <p className="text-sm font-bold text-gray-600 mb-5">
                        Escolha um freela do seu elenco para atrelar a este turno.
                    </p>

                    {teamLoading && (
                        <div className="space-y-3 animate-pulse">
                            {[...Array(3)].map((_, i) => <div key={i} className="h-14 bg-gray-200 rounded-xl" />)}
                        </div>
                    )}

                    {!teamLoading && teamMembers.length === 0 && (
                        <div className="text-center py-8 border-2 border-dashed border-gray-200 rounded-2xl text-gray-400">
                            <Users size={32} className="mx-auto mb-2 opacity-30" />
                            <p className="font-bold text-sm">Seu elenco está vazio.</p>
                            <p className="text-xs mt-1">Adicione freelas em <strong>Meu Elenco</strong> antes de convidar.</p>
                            <button
                                onClick={() => { setInviteJobId(null); navigate('/company/team'); }}
                                className="mt-4 bg-black hover:bg-blue-600 text-white px-4 py-2 rounded-xl font-black uppercase text-xs transition-colors"
                            >
                                Ir para Meu Elenco
                            </button>
                        </div>
                    )}

                    {!teamLoading && teamMembers.length > 0 && (
                        <div className="space-y-3 max-h-72 overflow-y-auto">
                            {teamMembers.map((member: TeamMember) => {
                                const avatarUrl = member.worker.avatar_url ?? member.worker.photo_url ?? null;
                                const isInviting = invitingWorkerId === member.worker.id;
                                return (
                                    <div key={member.connection.id} className="flex items-center gap-3 p-3 rounded-xl border-2 border-gray-100 hover:border-black transition-all">
                                        <div className="w-10 h-10 rounded-xl border-2 border-black overflow-hidden bg-gray-100 flex-shrink-0">
                                            {avatarUrl ? (
                                                <img src={avatarUrl} alt={member.worker.full_name} className="w-full h-full object-cover" />
                                            ) : (
                                                <div className="w-full h-full flex items-center justify-center bg-black text-white font-black">
                                                    {member.worker.full_name[0]?.toUpperCase()}
                                                </div>
                                            )}
                                        </div>
                                        <div className="flex-1 min-w-0">
                                            <p className="font-black uppercase text-sm truncate">{member.worker.full_name}</p>
                                            {member.worker.primary_role && (
                                                <p className="text-xs font-bold text-gray-400 uppercase truncate">{member.worker.primary_role}</p>
                                            )}
                                        </div>
                                        <button
                                            onClick={() => handleInvite(member.worker.id)}
                                            disabled={isInviting}
                                            className="bg-black hover:bg-blue-600 text-white px-4 py-2 rounded-xl font-black uppercase text-xs flex items-center gap-1.5 transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex-shrink-0"
                                        >
                                            {isInviting ? <Loader2 className="animate-spin" size={14} /> : <Send size={14} />}
                                            {isInviting ? '...' : 'Convidar'}
                                        </button>
                                    </div>
                                );
                            })}
                        </div>
                    )}
                </div>
            </div>
        )}
        </>
    );
}
