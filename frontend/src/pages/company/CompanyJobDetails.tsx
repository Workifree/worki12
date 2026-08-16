import { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { supabase } from '../../lib/supabase';
import { ArrowLeft, MapPin, Clock, Calendar, Users, Briefcase, MoreHorizontal, Edit2, PauseCircle, PlayCircle, Trash2, Check } from 'lucide-react';
import PageMeta from '../../components/PageMeta';
import { format, formatDistanceToNow } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import { WalletService } from '../../services/walletService';
import { useToast } from '../../contexts/ToastContext';
import { logError } from '../../lib/logger';

// Fuso-safe: mesmo padrão de `ReceiptView.formatDateOnly` / `CompanyJobs.tsx` — "YYYY-MM-DD" é
// interpretado como data LOCAL (não UTC), evitando o off-by-one que faria o turno de amanhã
// aparecer como hoje em BRT.
function formatDateOnly(isoOrDateOnly: string, pattern: string): string {
    const dateStr = isoOrDateOnly.split('T')[0];
    const [y, m, d] = dateStr.split('-').map(Number);
    return format(new Date(y, m - 1, d), pattern, { locale: ptBR });
}

export default function CompanyJobDetails() {
    const { id } = useParams();
    const navigate = useNavigate();
    interface JobDetails {
        id: string;
        title: string;
        description: string;
        requirements: string;
        category: string;
        type: string;
        location?: string;
        budget: number;
        budget_type: string;
        scope: string;
        status: string;
        created_at: string;
        start_date?: string | null;
        views?: number;
        work_start_time?: string;
        work_end_time?: string;
        has_lunch?: boolean;
        candidates_count?: number;
    }

    const [job, setJob] = useState<JobDetails | null>(null);
    const [loading, setLoading] = useState(true);
    const [openMenu, setOpenMenu] = useState(false);
    const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
    const [activeWorkersCount, setActiveWorkersCount] = useState(0);
    const { addToast } = useToast();

    useEffect(() => {
        if (id) fetchJobDetails();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- fetchJobDetails usa state setters estaveis, so precisa re-executar quando id muda
    }, [id]);

    useEffect(() => {
        if (!id) return;
        const fetchActiveWorkers = async () => {
            const { count, error } = await supabase
                .from('applications')
                .select('id', { count: 'exact', head: true })
                .eq('job_id', id)
                .in('status', ['hired', 'in_progress']);
            if (error) {
                logError('Error fetching active workers', error);
                return;
            }
            setActiveWorkersCount(count ?? 0);
        };
        fetchActiveWorkers();
    }, [id]);

    const fetchJobDetails = async () => {
        // G3: guarda de id falsy — evita `jobs?id=eq.null`/`applications?job_id=eq.null`
        // mesmo se essa função for chamada de outro lugar além do useEffect que já checa `if (id)`.
        if (!id) { navigate('/company/jobs'); return; }
        try {
            const { data: { user } } = await supabase.auth.getUser();
            if (!user) { navigate('/login'); return; }

            const { data, error } = await supabase
                .from('jobs')
                .select('*')
                .eq('id', id)
                .eq('company_id', user.id)
                .single();

            if (error) throw error;

            // Fetch candidate count manually
            const { count } = await supabase
                .from('applications')
                .select('id', { count: 'exact', head: true })
                .eq('job_id', id);

            setJob({ ...data, candidates_count: count || 0 });
        } catch (error) {
            logError('Error fetching job:', error);
            navigate('/company/jobs');
        } finally {
            setLoading(false);
        }
    };

    const handleStatusChange = async (newStatus: string) => {
        const { error } = await supabase.from('jobs').update({ status: newStatus }).eq('id', id);
        if (!error) fetchJobDetails();
        setOpenMenu(false);
    };

    const handleDelete = async () => {
        if (!id) return;

        // 1. Cancel hired workers' applications
        await supabase.from('applications').update({ status: 'cancelled' }).eq('job_id', id).in('status', ['hired', 'in_progress']);

        // 2. First refund any pending escrow back to the company wallet
        await WalletService.refundEscrow(id, 'Dinheiro retornado do escrow - turno deletado');

        // 3. Then mark the job as deleted
        const { error } = await supabase.from('jobs').update({ status: 'deleted' }).eq('id', id);
        if (!error) {
            addToast('Turno excluído com sucesso.', 'success');
            navigate('/company/jobs');
        } else {
            addToast('Erro ao excluir turno.', 'error');
        }
        setShowDeleteConfirm(false);
    };

    if (loading) return (
        <div className="p-8 max-w-4xl mx-auto animate-pulse space-y-6">
            <div className="h-10 bg-gray-200 rounded w-1/2" />
            <div className="h-4 bg-gray-200 rounded w-1/3" />
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                {[...Array(4)].map((_, i) => <div key={i} className="h-20 bg-gray-200 rounded-xl" />)}
            </div>
            <div className="h-40 bg-gray-200 rounded-xl" />
        </div>
    );
    if (!job) return null;

    return (
        <>
        <PageMeta
          title={job ? job.title : 'Detalhes do Turno'}
          description={job ? (job.description?.slice(0, 160) ?? undefined) : undefined}
        />
        {showDeleteConfirm && (
            <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4 backdrop-blur-sm">
                <div className="bg-white rounded-2xl w-full max-w-sm p-6 border-2 border-black shadow-[6px_6px_0px_0px_rgba(0,0,0,1)]">
                    <h3 className="text-xl font-black uppercase mb-2">Excluir Turno</h3>
                    <p className="text-sm text-gray-600 mb-6">Tem certeza? O turno será cancelado e os freelas contratados serão notificados.</p>
                    <div className="flex gap-3">
                        <button onClick={() => setShowDeleteConfirm(false)} className="flex-1 px-4 py-3 rounded-xl border-2 border-black font-bold uppercase text-sm hover:bg-gray-50">Cancelar</button>
                        <button onClick={handleDelete} className="flex-1 px-4 py-3 rounded-xl bg-red-600 text-white font-bold uppercase text-sm hover:bg-red-700">Excluir</button>
                    </div>
                </div>
            </div>
        )}
        <div className="max-w-4xl mx-auto animate-in fade-in slide-in-from-bottom-4 duration-500 pb-20">
            {/* Header */}
            <div className="flex items-center justify-between mb-8">
                <button onClick={() => navigate('/company/jobs')} className="flex items-center gap-2 text-gray-400 font-bold hover:text-black transition-colors">
                    <ArrowLeft size={20} /> Voltar
                </button>

                <div className="relative">
                    <button
                        onClick={() => setOpenMenu(!openMenu)}
                        className="p-2 border-2 border-transparent hover:border-black rounded-xl transition-all"
                    >
                        <MoreHorizontal size={20} />
                    </button>
                    {openMenu && (
                        <div className="absolute right-0 top-full mt-2 w-48 bg-white border-2 border-black rounded-xl shadow-[4px_4px_0px_0px_rgba(0,0,0,1)] z-10 overflow-hidden">
                            <button
                                onClick={() => navigate(`/company/jobs/${id}/edit`)}
                                className="w-full text-left px-4 py-3 hover:bg-gray-50 font-bold text-sm flex items-center gap-2"
                            >
                                <Edit2 size={16} /> Editar
                            </button>
                            <button
                                onClick={() => handleStatusChange(job.status === 'open' ? 'paused' : 'open')}
                                className="w-full text-left px-4 py-3 hover:bg-gray-50 font-bold text-sm flex items-center gap-2 border-t border-gray-100"
                            >
                                {job.status === 'open' ? <PauseCircle size={16} /> : <PlayCircle size={16} />}
                                {job.status === 'open' ? 'Pausar' : 'Reativar'}
                            </button>
                            <button
                                onClick={() => { setOpenMenu(false); setShowDeleteConfirm(true); }}
                                className="w-full text-left px-4 py-3 hover:bg-red-50 text-red-600 font-bold text-sm flex items-center gap-2 border-t border-gray-100"
                            >
                                <Trash2 size={16} /> Excluir
                            </button>
                        </div>
                    )}
                </div>
            </div>

            {/* Main Content */}
            <div className="bg-white border-2 border-black rounded-2xl overflow-hidden shadow-[8px_8px_0px_0px_rgba(0,0,0,0.1)]">
                {/* Banner / Status */}
                <div className={`h-2 w-full ${job.status === 'open' ? 'bg-green-500' : 'bg-gray-300'}`} aria-hidden="true" />

                <div className="p-8">
                    <div className="flex justify-between items-start mb-6">
                        <div>
                            <span className={`inline-block px-3 py-1 rounded-full text-[10px] font-black uppercase mb-3 border border-black ${job.status === 'open' ? 'bg-green-400' : 'bg-gray-200'}`}>
                                {job.status === 'open' ? 'Turno Ativo' : job.status === 'paused' ? 'Pausado' : 'Fechado'}
                            </span>
                            <h1 className="text-3xl font-black uppercase tracking-tight mb-2">{job.title}</h1>
                            <div className="flex items-center gap-4 text-sm font-bold text-gray-500 flex-wrap">
                                <span className="flex items-center gap-1"><MapPin size={16} /> {job.location || 'Local a combinar'}</span>
                                <span className="flex items-center gap-1 capitalize text-black">
                                    <Calendar size={16} /> {job.start_date ? formatDateOnly(job.start_date, "EEEE, dd/MM") : 'Data a definir'}
                                </span>
                                <span className="flex items-center gap-1"><Clock size={16} /> Criado {formatDistanceToNow(new Date(job.created_at), { addSuffix: true, locale: ptBR })}</span>
                            </div>
                        </div>
                        <div className="text-right">
                            <div className="text-2xl font-black">R$ {job.budget}</div>
                            <div className="text-xs font-bold uppercase text-gray-400">{job.budget_type === 'hourly' ? '/ hora' : job.budget_type === 'daily' ? '/ dia' : 'total'}</div>
                        </div>
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-3 gap-8 py-8 border-t-2 border-gray-100">
                        <div className="md:col-span-2 space-y-8">
                            <section>
                                <h3 className="text-lg font-black uppercase mb-3 flex items-center gap-2"><Briefcase size={20} /> Descrição</h3>
                                <p className="whitespace-pre-wrap text-gray-600 font-medium leading-relaxed">{job.description}</p>
                            </section>

                            <section>
                                <h3 className="text-lg font-black uppercase mb-3 flex items-center gap-2"><Check size={20} /> Requisitos</h3>
                                <p className="whitespace-pre-wrap text-gray-600 font-medium leading-relaxed">{job.requirements}</p>
                            </section>

                            {(job.work_start_time || job.work_end_time) && (
                                <section>
                                    <h3 className="text-lg font-black uppercase mb-3 flex items-center gap-2"><Clock size={20} /> Horário</h3>
                                    <div className="bg-gray-50 rounded-xl p-4 border-2 border-gray-100 inline-block">
                                        <p className="font-bold">
                                            {job.work_start_time?.slice(0, 5)} - {job.work_end_time?.slice(0, 5)}
                                            {job.has_lunch && <span className="text-gray-400 ml-2">(1h almoço)</span>}
                                        </p>
                                    </div>
                                </section>
                            )}
                        </div>

                        {/* Stats Sidebar */}
                        <div className="space-y-4">
                            <div className="bg-blue-50 border-2 border-blue-100 rounded-xl p-6">
                                <h3 className="font-black uppercase text-blue-800 mb-4">Resumo do Turno</h3>
                                <div className="space-y-4">
                                    {(job.candidates_count || 0) > 0 ? (
                                        <button
                                            onClick={() => navigate(`/company/jobs/${id}/candidates`)}
                                            className="w-full flex items-center justify-between hover:bg-white p-2 rounded-lg transition-all cursor-pointer group"
                                        >
                                            <span className="text-sm font-bold text-blue-600 flex items-center gap-2"><Users size={16} /> Freelas</span>
                                            <span className="text-2xl font-black text-blue-900 group-hover:scale-110 transition-transform">{job.candidates_count}</span>
                                        </button>
                                    ) : (
                                        <div className="p-2">
                                            <span className="text-sm font-bold text-blue-600 flex items-center gap-2 mb-2"><Users size={16} /> Freelas</span>
                                            <p className="text-sm text-gray-500 font-medium">Nenhum freela convidado para este turno ainda.</p>
                                        </div>
                                    )}
                                    <div
                                        className={`flex justify-between items-center rounded-lg p-2 -mx-2 transition-colors ${activeWorkersCount > 0 ? 'cursor-pointer hover:bg-white' : ''}`}
                                        onClick={() => activeWorkersCount > 0 && navigate(`/company/jobs/${id}/candidates`)}
                                    >
                                        <span className="text-sm font-bold text-blue-600">Em andamento</span>
                                        <span className="font-black text-blue-600">{activeWorkersCount}</span>
                                    </div>
                                </div>
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        </div>
        </>
    );
}
