import { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { supabase } from '../../lib/supabase';
import { WalletService } from '../../services/walletService';
import { logError } from '../../lib/logger';
import { ArrowLeft, Star, MapPin, Clock, ChevronRight, CheckCircle, XCircle, MessageSquare, Play, Square, Loader2 } from 'lucide-react';
import { formatDistanceToNow } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import { useToast } from '../../contexts/ToastContext';
import JobLifecycleStepper from '../../components/JobLifecycleStepper';
import EscrowStatusBadge from '../../components/EscrowStatusBadge';
import type { Application } from '../../types';

export default function CompanyJobCandidates() {
    const { id } = useParams();
    const navigate = useNavigate();

    const [candidates, setCandidates] = useState<Application[]>([]);
    const [jobTitle, setJobTitle] = useState('');
    const [loading, setLoading] = useState(true);
    const [ratingModalOpen, setRatingModalOpen] = useState(false);
    const [selectedApp, setSelectedApp] = useState<Application | null>(null);
    const [rating, setRating] = useState(5);
    const [comment, setComment] = useState('');
    const [submittingReview, setSubmittingReview] = useState(false);
    const [confirmingCheckin, setConfirmingCheckin] = useState<string | null>(null);
    const [companyBalance, setCompanyBalance] = useState<number | null>(null);
    const [confirmDeliveryApp, setConfirmDeliveryApp] = useState<Application | null>(null);
    const [releasing, setReleasing] = useState(false);
    const [escrowStatusMap, setEscrowStatusMap] = useState<Record<string, 'reserved' | 'released'>>({});
    const { addToast } = useToast();

    useEffect(() => {
        if (id) fetchCandidates();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- fetchCandidates usa state setters estaveis, so precisa re-executar quando id muda
    }, [id]);

    const fetchCandidates = async () => {
        try {
            const { data: { user } } = await supabase.auth.getUser();
            if (!user) { navigate('/login'); return; }

            // Fetch Job Title (only if owned by this company)
            const { data: job, error: jobError } = await supabase.from('jobs').select('title').eq('id', id).eq('company_id', user.id).single();
            if (jobError || !job) { navigate('/company/jobs'); return; }
            setJobTitle(job.title);

            // Fetch Applications with Worker Profile (using 'workers' table now)
            const { data, error } = await supabase
                .from('applications')
                .select(`
                    *,
                    worker:workers(*),
                    worker_checkin_at,
                    worker_checkout_at,
                    company_checkin_confirmed_at,
                    company_checkout_confirmed_at
                `)
                .eq('job_id', id)
                .order('created_at', { ascending: false });

            if (error) throw error;
            setCandidates(data || []);

            // Fetch escrow status per application for this job
            const { data: escrowRows } = await supabase
                .from('escrow_transactions')
                .select('application_id, status')
                .eq('job_id', id);
            const statusMap: Record<string, 'reserved' | 'released'> = {};
            (escrowRows || []).forEach((row) => {
                if (row.application_id && (row.status === 'reserved' || row.status === 'released')) {
                    statusMap[row.application_id] = row.status;
                }
            });
            setEscrowStatusMap(statusMap);

            // Fetch company balance to guard the "Contratar" button (AC-7)
            const wallet = await WalletService.getOrCreateWallet(user.id, 'company');
            setCompanyBalance(wallet ? wallet.balance : null);
        } catch (error) {
            logError('CompanyJobCandidates', error);
        } finally {
            setLoading(false);
        }
    };

    const handleUpdateStatus = async (appId: string, newStatus: string) => {
        const { error } = await supabase.from('applications').update({ status: newStatus }).eq('id', appId);

        if (error) {
            logError('CompanyJobCandidates: handleUpdateStatus', error);
            addToast('Erro ao atualizar status do candidato.', 'error');
            return;
        }

        if (newStatus === 'hired') {
            addToast('Candidato contratado! O job agora está em andamento.', 'success');
        }
        fetchCandidates();
    };

    const handleConfirmDelivery = async (app: Application) => {
        setReleasing(true);
        // Slice 2: ramifica por escrow.kind — postpaid captura o hold no cartao; prepaid libera escrow legado.
        const result = await WalletService.releaseOrCaptureEscrow(app.job_id, app.worker_id);
        if (!result.success) {
            addToast('Erro ao liberar pagamento. Tente novamente.', 'error');
            setReleasing(false);
            return;
        }
        const { error: updateError } = await supabase.from('applications').update({ status: 'completed' }).eq('id', app.id);
        if (updateError) {
            addToast('Pagamento liberado, mas houve erro ao atualizar status. Contate o suporte.', 'error');
            setReleasing(false);
            setConfirmDeliveryApp(null);
            fetchCandidates();
            return;
        }
        setConfirmDeliveryApp(null);
        setReleasing(false);
        addToast('Entrega confirmada! Pagamento liberado ao profissional.', 'success');
        fetchCandidates();
    };

    const handleSubmitReview = async () => {
        if (!selectedApp) return;
        setSubmittingReview(true);

        try {
            const { data: { user } } = await supabase.auth.getUser();
            if (!user) throw new Error('Not authenticated');

            // Update Application Status to reviewed (best-effort, already completed)
            const { error: appError } = await supabase
                .from('applications')
                .update({ status: 'completed' })
                .eq('id', selectedApp.id);

            if (appError) {
                logError('CompanyJobCandidates: app status update failed', appError);
            }

            // Create Review (non-critical, best-effort)
            const { error: reviewError } = await supabase.from('reviews').insert({
                job_id: selectedApp.job_id,
                reviewer_id: user.id,
                reviewed_id: selectedApp.worker_id,
                rating: rating,
                comment: comment,
                created_at: new Date().toISOString()
            });

            if (reviewError) {
                logError('CompanyJobCandidates: review error', reviewError);
                if (reviewError.code === '23505') {
                    addToast('Você já avaliou este profissional para este job.', 'error');
                } else {
                    addToast('Erro ao salvar avaliação. Tente novamente.', 'error');
                }
                setSubmittingReview(false);
                setRatingModalOpen(false);
                fetchCandidates();
                return;
            }

            addToast('Avaliação enviada com sucesso!', 'success');

            setRatingModalOpen(false);
            setRating(5);
            setComment('');
            fetchCandidates();

        } catch (error) {
            logError('CompanyJobCandidates', error);
            addToast('Erro ao enviar avaliação.', 'error');
        } finally {
            setSubmittingReview(false);
        }
    };

    const handleChat = async (app: Application) => {
        try {
            // Check if conversation exists
            const { data: existingConvs } = await supabase
                .from('Conversation')
                .select('id')
                .eq('application_uuid', app.id)
                .limit(1);

            if (existingConvs && existingConvs.length > 0) {
                navigate(`/company/messages?conversation=${existingConvs[0].id}`);
            } else {
                // Create new conversation
                const newConvId = crypto.randomUUID();
                const { error } = await supabase
                    .from('Conversation')
                    .insert({
                        id: newConvId,
                        application_uuid: app.id,
                        islocked: false
                    });

                if (error) throw error;
                navigate(`/company/messages?conversation=${newConvId}`);
            }
        } catch (error) {
            logError('CompanyJobCandidates', error);
            addToast('Erro ao iniciar conversa.', 'error');
        }
    };

    const handleConfirmCheckin = async (appId: string) => {
        setConfirmingCheckin(appId);
        try {
            const { error } = await supabase
                .from('applications')
                .update({ company_checkin_confirmed_at: new Date().toISOString() })
                .eq('id', appId);

            if (error) throw error;
            fetchCandidates();
        } catch (error) {
            logError('CompanyJobCandidates', error);
            addToast('Erro ao confirmar check-in.', 'error');
        } finally {
            setConfirmingCheckin(null);
        }
    };

    const handleConfirmCheckout = async (appId: string) => {
        setConfirmingCheckin(appId);
        try {
            const { error } = await supabase
                .from('applications')
                .update({ company_checkout_confirmed_at: new Date().toISOString() })
                .eq('id', appId);

            if (error) throw error;
            fetchCandidates();
        } catch (error) {
            logError('CompanyJobCandidates', error);
            addToast('Erro ao confirmar check-out.', 'error');
        } finally {
            setConfirmingCheckin(null);
        }
    };

    const computeSteps = (app: Application) => {
        const checkinComplete = !!(app.worker_checkin_at && app.company_checkin_confirmed_at);
        const checkinActive = !!(app.worker_checkin_at && !app.company_checkin_confirmed_at);
        const checkoutComplete = !!(app.worker_checkout_at && app.company_checkout_confirmed_at);
        const checkoutActive = !!(app.worker_checkout_at && !app.company_checkout_confirmed_at);

        return [
            { label: 'Contratado', status: 'complete' as const },
            {
                label: 'Chegada',
                status: checkinComplete ? 'complete' as const : checkinActive ? 'active' as const : 'pending' as const
            },
            {
                label: 'Saída',
                status: checkoutComplete ? 'complete' as const : checkoutActive ? 'active' as const : 'pending' as const
            },
            {
                label: 'Entrega',
                status: app.status === 'completed' ? 'complete' as const : 'pending' as const
            }
        ];
    };

    return (
        <div className="max-w-4xl mx-auto animate-in fade-in slide-in-from-bottom-4 duration-500 pb-20">
            {/* Header */}
            <div className="flex items-center justify-between mb-8">
                <div>
                    <button onClick={() => navigate('/company/jobs')} className="flex items-center gap-2 text-gray-400 font-bold hover:text-black transition-colors mb-2">
                        <ArrowLeft size={16} strokeWidth={3} /> Voltar para Vagas
                    </button>
                    <h1 className="text-3xl font-black uppercase tracking-tighter">Candidatos</h1>
                    <p className="text-gray-500 font-bold">{jobTitle} • {candidates.length} aplicações</p>
                </div>
            </div>

            {/* Candidates List */}
            <div className="space-y-4">
                {loading ? (
                    <div className="space-y-4 animate-pulse">
                        {[...Array(3)].map((_, i) => (
                            <div key={i} className="bg-gray-200 rounded-xl h-32" />
                        ))}
                    </div>
                ) : candidates.length === 0 ? (
                    <div className="text-center py-16">
                        <p className="text-gray-500 text-lg font-bold">Nenhum candidato encontrado.</p>
                        <p className="text-gray-400 text-sm mt-2">Ainda não há candidatos para esta vaga.</p>
                    </div>
                ) : (
                    candidates.map((app) => (
                        <div key={app.id} role="button" tabIndex={0} className="bg-white border-2 border-gray-100 hover:border-black rounded-xl p-6 transition-all group hover:shadow-[4px_4px_0px_0px_rgba(0,0,0,1)] cursor-pointer" onClick={() => navigate(`/company/worker/${app.worker_id}`)} onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); navigate(`/company/worker/${app.worker_id}`); } }}>
                            <div className="flex flex-col md:flex-row gap-6">
                                {/* Avatar */}
                                <div className="flex-shrink-0">
                                    <div className="w-16 h-16 rounded-full bg-gray-200 border-2 border-black overflow-hidden relative">
                                        {app.worker?.avatar_url ? (
                                            <img src={app.worker.avatar_url} alt={app.worker.full_name} className="w-full h-full object-cover" />
                                        ) : (
                                            <div className="w-full h-full flex items-center justify-center bg-black text-white font-black text-xl">
                                                {app.worker?.full_name?.[0] || '?'}
                                            </div>
                                        )}
                                    </div>
                                </div>

                                {/* Info */}
                                <div className="flex-1">
                                    <div className="flex justify-between items-start">
                                        <div>
                                            <h3 className="font-black text-xl flex items-center gap-2">
                                                {app.worker?.full_name || 'Usuário Worki'}
                                                <span className="bg-black text-white text-[10px] px-2 py-0.5 rounded-full uppercase">Lvl {app.worker?.level || 1}</span>
                                            </h3>
                                            <div className="flex items-center gap-4 text-xs font-bold text-gray-500 mt-1">
                                                <span className="flex items-center gap-1"><MapPin size={12} /> {app.worker?.city || 'Não informado'}</span>
                                                <span className="flex items-center gap-1">
                                                    <Star size={12} className="text-yellow-500 fill-yellow-500" />
                                                    {app.worker?.rating_average ? Number(app.worker.rating_average).toFixed(1) : '5.0'}
                                                    <span className="text-gray-400 font-medium ml-1">({app.worker?.reviews_count || 0} avaliações)</span>
                                                </span>
                                                <span className="flex items-center gap-1"><Clock size={12} /> Aplicou {app.created_at ? formatDistanceToNow(new Date(app.created_at), { addSuffix: true, locale: ptBR }) : '—'}</span>
                                            </div>
                                        </div>

                                        <div className="flex items-center gap-2 flex-wrap justify-end">
                                            {/* Escrow Status Badge — per-candidate status */}
                                            <EscrowStatusBadge escrowStatus={escrowStatusMap[app.id] ?? null} />

                                            <button
                                                onClick={(e) => { e.stopPropagation(); handleChat(app); }}
                                                className="p-2 hover:bg-blue-50 text-gray-300 hover:text-blue-500 rounded-lg transition-colors"
                                                title="Chat"
                                                aria-label="Abrir chat com candidato"
                                            >
                                                <MessageSquare size={24} />
                                            </button>
                                            {app.status === 'pending' && (
                                                <>
                                                    <button
                                                        onClick={(e) => { e.stopPropagation(); handleUpdateStatus(app.id, 'rejected'); }}
                                                        className="p-2 hover:bg-red-50 text-gray-300 hover:text-red-500 rounded-lg transition-colors"
                                                        title="Descartar"
                                                        aria-label="Descartar candidato"
                                                    >
                                                        <XCircle size={24} />
                                                    </button>
                                                    <button
                                                        onClick={(e) => { e.stopPropagation(); handleUpdateStatus(app.id, 'interview'); }}
                                                        className="p-2 hover:bg-green-50 text-gray-300 hover:text-green-600 rounded-lg transition-colors"
                                                        title="Aprovar para Entrevista"
                                                        aria-label="Aprovar candidato para entrevista"
                                                    >
                                                        <CheckCircle size={24} />
                                                    </button>
                                                </>
                                            )}
                                            {app.status !== 'pending' && (
                                                <div className="flex items-center gap-2 flex-wrap">
                                                    <span className={`text-xs font-black uppercase px-3 py-1 rounded-lg border-2 ${app.status === 'hired' ? 'bg-green-100 border-green-200 text-green-700' :
                                                        app.status === 'in_progress' ? 'bg-orange-100 border-orange-200 text-orange-700' :
                                                        app.status === 'completed' ? 'bg-blue-100 border-blue-200 text-blue-700' :
                                                            app.status === 'rejected' ? 'bg-red-50 border-red-100 text-red-500' :
                                                                'bg-blue-50 border-blue-100 text-blue-600'
                                                        }`}>
                                                        {app.status === 'interview' ? 'Em Entrevista' : app.status === 'hired' ? 'Contratado' : app.status === 'in_progress' ? 'Em Andamento' : app.status === 'completed' ? 'Finalizado' : 'Descartado'}
                                                    </span>

                                                    {app.status === 'interview' && (
                                                        <>
                                                            <button
                                                                onClick={(e) => { e.stopPropagation(); handleChat(app); }}
                                                                className="p-1 px-3 bg-blue-500 text-white rounded-lg text-xs font-bold uppercase hover:bg-blue-600 transition-colors flex items-center gap-1"
                                                            >
                                                                <MessageSquare size={14} /> Chat
                                                            </button>
                                                            <div className="flex flex-col items-end">
                                                                <button
                                                                    onClick={(e) => {
                                                                        e.stopPropagation();
                                                                        if (companyBalance !== null && companyBalance <= 0) {
                                                                            addToast('Saldo insuficiente. Deposite fundos na sua carteira para contratar.', 'error');
                                                                            return;
                                                                        }
                                                                        handleUpdateStatus(app.id, 'hired');
                                                                    }}
                                                                    className={`p-1 px-3 bg-black text-white rounded-lg text-xs font-bold uppercase hover:bg-green-600 transition-colors ${companyBalance !== null && companyBalance <= 0 ? 'opacity-50 cursor-not-allowed' : ''}`}
                                                                    title={companyBalance !== null && companyBalance <= 0 ? 'Saldo insuficiente para contratar' : undefined}
                                                                >
                                                                    Contratar
                                                                </button>
                                                                {companyBalance !== null && companyBalance <= 0 && (
                                                                    <p className="text-xs text-red-500 mt-1">Saldo insuficiente para contratar</p>
                                                                )}
                                                            </div>
                                                        </>
                                                    )}

                                                    {(app.status === 'hired' || app.status === 'in_progress') && (
                                                        <>
                                                            {/* Show check-in status */}
                                                            {app.worker_checkin_at && !app.company_checkin_confirmed_at && (
                                                                <button
                                                                    onClick={(e) => { e.stopPropagation(); handleConfirmCheckin(app.id); }}
                                                                    disabled={confirmingCheckin === app.id}
                                                                    className="p-1 px-3 bg-blue-500 text-white rounded-lg text-xs font-bold uppercase hover:bg-blue-600 transition-colors flex items-center gap-1 disabled:opacity-50"
                                                                >
                                                                    {confirmingCheckin === app.id ? <Loader2 size={14} className="animate-spin" /> : <Play size={14} />}
                                                                    Confirmar Chegada
                                                                </button>
                                                            )}
                                                            {app.company_checkin_confirmed_at && (
                                                                <span className="text-xs font-bold text-blue-600 bg-blue-50 px-2 py-1 rounded flex items-center gap-1">
                                                                    <CheckCircle size={12} /> Chegada OK
                                                                </span>
                                                            )}

                                                            {/* Show check-out status */}
                                                            {app.worker_checkout_at && !app.company_checkout_confirmed_at && (
                                                                <button
                                                                    onClick={(e) => { e.stopPropagation(); handleConfirmCheckout(app.id); }}
                                                                    disabled={confirmingCheckin === app.id}
                                                                    className="p-1 px-3 bg-purple-500 text-white rounded-lg text-xs font-bold uppercase hover:bg-purple-600 transition-colors flex items-center gap-1 disabled:opacity-50"
                                                                >
                                                                    {confirmingCheckin === app.id ? <Loader2 size={14} className="animate-spin" /> : <Square size={14} />}
                                                                    Confirmar Saída
                                                                </button>
                                                            )}
                                                            {app.company_checkout_confirmed_at && (
                                                                <span className="text-xs font-bold text-purple-600 bg-purple-50 px-2 py-1 rounded flex items-center gap-1">
                                                                    <CheckCircle size={12} /> Saída OK
                                                                </span>
                                                            )}

                                                            {/* Confirmar Entrega button — replaces old "Finalizar Job" */}
                                                            {app.company_checkin_confirmed_at && app.company_checkout_confirmed_at && (
                                                                <button
                                                                    onClick={(e) => { e.stopPropagation(); setConfirmDeliveryApp(app); }}
                                                                    className="p-1 px-3 bg-black text-white border-2 border-black rounded-lg text-xs font-bold uppercase hover:bg-primary transition-colors flex items-center gap-1"
                                                                >
                                                                    Confirmar Entrega
                                                                </button>
                                                            )}
                                                        </>
                                                    )}

                                                    {/* Botão Avaliar — apenas para candidatos já finalizados */}
                                                    {app.status === 'completed' && (
                                                        <button
                                                            onClick={(e) => { e.stopPropagation(); setSelectedApp(app); setRatingModalOpen(true); }}
                                                            className="p-1 px-3 bg-black text-white rounded-lg text-xs font-bold uppercase hover:bg-gray-800 transition-colors"
                                                        >
                                                            Avaliar
                                                        </button>
                                                    )}
                                                </div>
                                            )}
                                        </div>
                                    </div>

                                    {/* Job Lifecycle Stepper */}
                                    {['hired', 'in_progress', 'completed'].includes(app.status) && (
                                        <div className="border-t border-gray-100 mt-4 pt-4">
                                            <JobLifecycleStepper steps={computeSteps(app)} />
                                        </div>
                                    )}

                                    {/* Cover Letter Snippet */}
                                    <div className="mt-4 bg-gray-50 p-3 rounded-xl border-l-4 border-gray-300">
                                        <p className="text-sm font-medium text-gray-600 italic line-clamp-2">
                                            "{app.cover_letter || 'Sem carta de apresentação...'}"
                                        </p>
                                    </div>

                                    {/* Tags */}
                                    {app.worker?.tags && (
                                        <div className="flex gap-2 mt-4 flex-wrap">
                                            {app.worker.tags.map((tag: string) => (
                                                <span key={tag} className="text-[10px] font-bold uppercase bg-gray-100 px-2 py-1 rounded text-gray-600">
                                                    {tag}
                                                </span>
                                            ))}
                                        </div>
                                    )}
                                </div>

                                <div className="flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity">
                                    <ChevronRight size={24} className="text-gray-400" />
                                </div>
                            </div>
                        </div>
                    ))
                )}
            </div>

            {/* Modal de Confirmação de Entrega */}
            {confirmDeliveryApp && (
                <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4 backdrop-blur-sm animate-in fade-in duration-200">
                    <div className="bg-white rounded-2xl w-full max-w-md p-6 border-2 border-black shadow-[8px_8px_0px_0px_rgba(0,0,0,1)]">
                        <h2 className="text-xl font-black uppercase tracking-tight mb-4">Confirmar Entrega</h2>
                        <p className="text-gray-600 font-medium mb-6">
                            Tem certeza que deseja confirmar a entrega? O pagamento será liberado imediatamente ao profissional.
                        </p>
                        <div className="flex gap-3 mt-6">
                            <button
                                onClick={() => setConfirmDeliveryApp(null)}
                                disabled={releasing}
                                className="flex-1 py-3 border-2 border-black font-bold rounded-xl hover:bg-gray-50 transition-colors disabled:opacity-50"
                            >
                                Cancelar
                            </button>
                            <button
                                onClick={() => handleConfirmDelivery(confirmDeliveryApp)}
                                disabled={releasing}
                                className="flex-1 py-3 bg-black text-white font-bold rounded-xl border-2 border-black shadow-[4px_4px_0px_0px_rgba(0,0,0,1)] hover:bg-primary hover:shadow-none hover:translate-x-1 hover:translate-y-1 transition-all disabled:opacity-50 flex items-center justify-center gap-2"
                            >
                                {releasing ? <><Loader2 size={16} className="animate-spin" /> Processando...</> : 'Confirmar'}
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {/* Rating Modal */}
            {ratingModalOpen && (
                <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4 backdrop-blur-sm animate-in fade-in duration-200">
                    <div className="bg-white rounded-2xl w-full max-w-md p-6 border-2 border-black shadow-[8px_8px_0px_0px_rgba(0,0,0,1)]">
                        <div className="flex justify-between items-center mb-6">
                            <h3 className="text-2xl font-black uppercase tracking-tight">Avaliar Freelancer</h3>
                            <button onClick={() => setRatingModalOpen(false)} className="p-2 hover:bg-gray-100 rounded-full transition-colors">
                                <XCircle size={24} />
                            </button>
                        </div>

                        <div className="flex flex-col items-center mb-6">
                            <div className="w-20 h-20 rounded-full bg-gray-200 border-2 border-black overflow-hidden mb-3">
                                {selectedApp?.worker?.avatar_url ? (
                                    <img src={selectedApp.worker.avatar_url} alt="" className="w-full h-full object-cover" />
                                ) : (
                                    <div className="w-full h-full flex items-center justify-center bg-black text-white font-black text-2xl">
                                        {selectedApp?.worker?.full_name?.[0]}
                                    </div>
                                )}
                            </div>
                            <h4 className="font-bold text-lg">{selectedApp?.worker?.full_name}</h4>
                            <p className="text-sm text-gray-500 font-bold uppercase">{selectedApp?.job?.title}</p>
                        </div>

                        <div className="flex justify-center gap-2 mb-6">
                            {[1, 2, 3, 4, 5].map((star) => (
                                <button
                                    key={star}
                                    onClick={() => setRating(star)}
                                    className="transform hover:scale-110 transition-transform"
                                >
                                    <Star
                                        size={32}
                                        fill={star <= rating ? "#fbbf24" : "none"}
                                        className={star <= rating ? "text-yellow-500" : "text-gray-300"}
                                        strokeWidth={2}
                                    />
                                </button>
                            ))}
                        </div>

                        <div className="mb-6">
                            <label htmlFor="review-comment" className="block text-sm font-bold uppercase mb-2">Comentário (Opcional)</label>
                            <textarea
                                id="review-comment"
                                value={comment}
                                onChange={(e) => setComment(e.target.value)}
                                placeholder="Como foi a experiência?"
                                className="w-full border-2 border-gray-200 rounded-xl p-3 focus:outline-none focus:border-black transition-colors font-medium h-24 resize-none"
                            />
                        </div>

                        <button
                            onClick={handleSubmitReview}
                            disabled={submittingReview}
                            className="w-full bg-black text-white py-4 rounded-xl font-black uppercase tracking-wide hover:bg-green-600 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                        >
                            {submittingReview ? 'Enviando...' : 'Enviar Avaliação'}
                        </button>
                    </div>
                </div>
            )}
        </div>
    );
}
