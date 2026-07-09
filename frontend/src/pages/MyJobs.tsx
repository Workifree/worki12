
import { useEffect, useState, useCallback } from 'react';
import { supabase } from '../lib/supabase';
import { MapPin, CheckCircle2, Clock, XCircle, Loader2, DollarSign, Star, Play, Square, AlertCircle, Bell, Building2 } from 'lucide-react';
import PageMeta from '../components/PageMeta';
import { useNavigate } from 'react-router-dom';
import { formatDistanceToNow, isToday, parseISO, isWithinInterval, setHours, setMinutes } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import RateModal from '../components/RateModal';
import JobLifecycleStepper from '../components/JobLifecycleStepper';
import { useToast } from '../contexts/ToastContext';
import { logError } from '../lib/logger';
import { useWorkerInvites } from '../hooks/useShiftInvites';
import type { ReviewDirection } from '../types';

type Step = { label: string; status: 'complete' | 'active' | 'pending' }

function computeWorkerSteps(job: JobApplication): Step[] {
    const checkinDone = !!job.worker_checkin_at;
    const checkoutDone = !!job.worker_checkout_at;
    const companyConfirmed = !!job.company_checkout_confirmed_at;

    return [
        {
            label: 'Chegada registrada',
            status: checkinDone ? 'complete' : 'active'
        },
        {
            label: 'Check-out',
            status: checkoutDone
                ? 'complete'
                : checkinDone && !checkoutDone
                    ? 'active'
                    : 'pending'
        },
        {
            label: 'Aguardando empresa',
            status: companyConfirmed
                ? 'complete'
                : checkoutDone && !companyConfirmed
                    ? 'active'
                    : 'pending'
        }
    ];
}

interface JobApplication {
    id: string;
    job_id: string;
    status: string;
    title: string;
    company_id: string;
    company_name: string;
    company_logo: string | null;
    pay: number;
    date: string;
    raw_date: string | null;
    time: string;
    end_time: string | null;
    location: string;
    month: string;
    day: number | string;
    worker_checkin_at: string | null;
    worker_checkout_at: string | null;
    company_checkin_confirmed_at: string | null;
    company_checkout_confirmed_at: string | null;
}

type ActiveTab = 'invites' | 'in_progress' | 'scheduled' | 'history';

export default function MyJobs() {
    const navigate = useNavigate();
    const [loading, setLoading] = useState(true);
    const [activeTab, setActiveTab] = useState<ActiveTab>('invites');
    const [jobs, setJobs] = useState<{
        in_progress: JobApplication[],
        scheduled: JobApplication[],
        history: JobApplication[]
    }>({ in_progress: [], scheduled: [], history: [] });

    // Rating State
    const [rateModalOpen, setRateModalOpen] = useState(false);
    const [selectedJobToRate, setSelectedJobToRate] = useState<JobApplication | null>(null);
    const [reviewedJobIds, setReviewedJobIds] = useState<Set<string>>(new Set());
    const [actionLoading, setActionLoading] = useState<string | null>(null);
    const { addToast } = useToast();

    // Hook de convites push
    const { pendingInvites, loading: invitesLoading, respondingId, respond } = useWorkerInvites();

    const fetchJobs = useCallback(async () => {
        const { data: { user } } = await supabase.auth.getUser();
        if (!user) return navigate('/login');

        // Fetch my reviews to know what I've rated
        const { data: myReviews } = await supabase
            .from('reviews')
            .select('job_id')
            .eq('reviewer_id', user.id);

        const reviewedSet = new Set(myReviews?.map(r => r.job_id) || []);
        setReviewedJobIds(reviewedSet);

        const { data, error } = await supabase
            .from('applications')
            .select(`
                id,
                status,
                created_at,
                worker_checkin_at,
                worker_checkout_at,
                company_checkin_confirmed_at,
                company_checkout_confirmed_at,
                job:jobs (
                    id,
                    title,
                    budget,
                    start_date,
                    work_start_time,
                    work_end_time,
                    location,
                    company:companies (
                        id,
                        name,
                        logo_url
                    )
                )
            `)
            .eq('worker_id', user.id)
            // Excluir convites pending — eles ficam na aba Convites via hook
            .not('status', 'eq', 'invited')
            .order('created_at', { ascending: false });

        if (error) {
            logError('Error fetching applications:', error);
        } else {
            const in_progress: JobApplication[] = [];
            const scheduled: JobApplication[] = [];
            const history: JobApplication[] = [];

            const now = new Date();

            interface ApplicationRow {
                id: string;
                status: string;
                created_at: string;
                worker_checkin_at: string | null;
                worker_checkout_at: string | null;
                company_checkin_confirmed_at: string | null;
                company_checkout_confirmed_at: string | null;
                job: {
                    id: string;
                    title: string;
                    budget: number;
                    start_date: string | null;
                    work_start_time: string | null;
                    work_end_time: string | null;
                    location: string | null;
                    company: {
                        id: string;
                        name: string;
                        logo_url: string | null;
                    } | null;
                } | null;
            }

            (data as unknown as ApplicationRow[]).forEach((app) => {
                const application: JobApplication = {
                    id: app.id,
                    job_id: app.job?.id || '',
                    status: app.status,
                    title: app.job?.title || 'Turno',
                    company_id: app.job?.company?.id || '',
                    company_name: app.job?.company?.name || 'Empresa Confidencial',
                    company_logo: app.job?.company?.logo_url ?? null,
                    pay: app.job?.budget || 0,
                    date: app.job?.start_date ? new Date(app.job.start_date).toLocaleDateString('pt-BR') : 'Data a definir',
                    raw_date: app.job?.start_date ?? null,
                    time: app.job?.work_start_time || 'Horário a definir',
                    end_time: app.job?.work_end_time || null,
                    location: app.job?.location || 'Local a definir',
                    month: app.job?.start_date ? new Date(app.job.start_date).toLocaleString('pt-BR', { month: 'short' }).toUpperCase().replace('.', '') : 'MES',
                    day: app.job?.start_date ? new Date(app.job.start_date).getDate() : '00',
                    worker_checkin_at: app.worker_checkin_at,
                    worker_checkout_at: app.worker_checkout_at,
                    company_checkin_confirmed_at: app.company_checkin_confirmed_at,
                    company_checkout_confirmed_at: app.company_checkout_confirmed_at
                };

                const isJobToday = application.raw_date && isToday(parseISO(application.raw_date));
                let isWithinWorkHours = false;

                if (isJobToday && application.time && application.end_time) {
                    try {
                        const [startH, startM] = application.time.split(':').map(Number);
                        const [endH, endM] = application.end_time.split(':').map(Number);

                        const todayDate = new Date();
                        const startTime = setMinutes(setHours(todayDate, startH), startM);
                        let endTime = setMinutes(setHours(todayDate, endH), endM);

                        if (endTime.getTime() <= startTime.getTime()) {
                            endTime = new Date(endTime.getTime() + 24 * 60 * 60 * 1000);
                        }

                        const startBuffer = new Date(startTime.getTime() - 30 * 60 * 1000);
                        const endBuffer = new Date(endTime.getTime() + 60 * 60 * 1000);

                        isWithinWorkHours = isWithinInterval(now, { start: startBuffer, end: endBuffer });
                    } catch (e) {
                        logError('Error parsing work hours:', e);
                    }
                }

                const isInProgress = (app.status === 'hired' && isJobToday && isWithinWorkHours) || app.status === 'in_progress';

                if (isInProgress) {
                    in_progress.push(application);
                } else if (app.status === 'hired') {
                    scheduled.push(application);
                } else if (['completed', 'rejected', 'cancelled', 'declined'].includes(app.status)) {
                    history.push(application);
                }
            });

            setJobs({ in_progress, scheduled, history });
        }
        setLoading(false);
    }, [navigate]);

    useEffect(() => {
        fetchJobs();
    }, [fetchJobs]);

    const handleCheckin = async (appId: string) => {
        setActionLoading(appId);
        try {
            const { error } = await supabase
                .from('applications')
                .update({
                    worker_checkin_at: new Date().toISOString(),
                    status: 'in_progress'
                })
                .eq('id', appId);

            if (error) throw error;
            await fetchJobs();
        } catch (err) {
            logError('Error checking in:', err);
            addToast('Erro ao fazer check-in. Tente novamente.', 'error');
        } finally {
            setActionLoading(null);
        }
    };

    const handleCheckout = async (appId: string) => {
        setActionLoading(appId);
        try {
            const { error } = await supabase
                .from('applications')
                .update({ worker_checkout_at: new Date().toISOString() })
                .eq('id', appId);

            if (error) throw error;
            await fetchJobs();
        } catch (err) {
            logError('Error checking out:', err);
            addToast('Erro ao fazer check-out. Tente novamente.', 'error');
        } finally {
            setActionLoading(null);
        }
    };

    const handleOpenRateModal = (job: JobApplication) => {
        setSelectedJobToRate(job);
        setRateModalOpen(true);
    };

    // Fix R10: direction explícito ('company' quando worker avalia empresa)
    const handleSubmitRate = async (rating: number, comment: string) => {
        if (!selectedJobToRate) return;

        try {
            const { data: { user } } = await supabase.auth.getUser();
            if (!user) throw new Error('Not authenticated');

            // Sem company_id não há quem avaliar (evita review órfã apontando p/ '').
            if (!selectedJobToRate.company_id) {
                addToast('Não foi possível identificar a empresa deste turno.', 'error');
                return;
            }

            const direction: ReviewDirection = 'company';

            // created_at é obrigatório na tabela reviews (sem default) — o insert da empresa
            // (CompanyJobCandidates) já enviava; o do freela não, e por isso falhava silenciosamente.
            const { error } = await supabase.from('reviews').insert({
                job_id: selectedJobToRate.job_id,
                reviewer_id: user.id,
                reviewed_id: selectedJobToRate.company_id, // empresa sendo avaliada
                direction,
                rating,
                comment,
                created_at: new Date().toISOString()
            });

            if (error) throw error;

            setReviewedJobIds(prev => new Set(prev).add(selectedJobToRate.job_id));
            addToast('Avaliação enviada com sucesso!', 'success');
        } catch (error) {
            logError('Error submitting review:', error);
            addToast('Erro ao enviar avaliação.', 'error');
            throw error;
        }
    };

    if (loading) return (
        <div className="flex flex-col gap-6 pb-24 max-w-4xl mx-auto animate-pulse">
            <div className="h-10 bg-gray-200 rounded w-1/3" />
            <div className="flex gap-2">
                {[...Array(5)].map((_, i) => <div key={i} className="h-10 bg-gray-200 rounded-xl w-24" />)}
            </div>
            <div className="space-y-4">
                {[...Array(4)].map((_, i) => (
                    <div key={i} className="h-28 bg-gray-200 rounded-2xl" />
                ))}
            </div>
        </div>
    );

    return (
        <div className="flex flex-col gap-6 pb-24 font-sans text-accent max-w-4xl mx-auto">
            <PageMeta title="Meus Turnos" description="Acompanhe seus convites, turnos agendados e histórico na Worki." />

            <header>
                <h2 className="text-4xl font-black uppercase tracking-tighter">Meus Turnos</h2>
            </header>

            {/* Tabs — Convites PRIMEIRO */}
            <div className="flex gap-2 border-b-2 border-gray-200 pb-1 overflow-x-auto scrollbar-hide">
                {[
                    { id: 'invites' as ActiveTab, label: 'Convites', count: pendingInvites.length, urgent: true },
                    { id: 'in_progress' as ActiveTab, label: 'Em Andamento', count: jobs.in_progress.length },
                    { id: 'scheduled' as ActiveTab, label: 'Agendados', count: jobs.scheduled.length },
                    { id: 'history' as ActiveTab, label: 'Histórico', count: jobs.history.length }
                ].map((tab) => (
                    <button
                        key={tab.id}
                        onClick={() => setActiveTab(tab.id)}
                        className={`
                            px-6 py-2 rounded-t-xl font-bold uppercase transition-all whitespace-nowrap flex items-center gap-2
                            ${activeTab === tab.id
                                ? 'bg-black text-white translate-y-[2px]'
                                : 'text-gray-400 hover:text-black hover:bg-gray-100'}
                        `}
                    >
                        {tab.label}
                        {tab.count > 0 && (
                            <span className={`text-xs px-1.5 py-0.5 rounded-full font-black ${
                                tab.urgent
                                    ? 'bg-primary text-white animate-pulse'
                                    : tab.id === 'in_progress'
                                        ? 'bg-red-500 text-white animate-pulse'
                                        : 'bg-gray-200 text-gray-700'
                            }`}>
                                {tab.count}
                            </span>
                        )}
                    </button>
                ))}
            </div>

            {/* Content */}
            <div className="grid gap-4">

                {/* ── ABA CONVITES ── */}
                {activeTab === 'invites' && (
                    <>
                        {invitesLoading && (
                            <div className="space-y-4 animate-pulse">
                                {[...Array(2)].map((_, i) => (
                                    <div key={i} className="h-32 bg-gray-200 rounded-2xl" />
                                ))}
                            </div>
                        )}

                        {!invitesLoading && pendingInvites.length === 0 && (
                            <div className="text-center py-16 text-gray-400 bg-gray-50 rounded-2xl border-2 border-dashed border-gray-200">
                                <Bell size={48} className="mx-auto mb-4 opacity-30" />
                                <p className="font-bold text-lg">Nenhum convite pendente.</p>
                                <p className="text-sm mt-2">Quando uma empresa te convidar para um turno, aparecerá aqui.</p>
                            </div>
                        )}

                        {!invitesLoading && pendingInvites.map((invite) => {
                            const job = invite.job;
                            const companyName = (job?.company as { name?: string } | undefined)?.name ?? 'Empresa';
                            const companyLogo = (job?.company as { logo_url?: string | null } | undefined)?.logo_url ?? null;
                            const jobTitle = job?.title ?? 'Turno';
                            const budget = job?.budget ?? 0;
                            const startDate = job?.start_date
                                ? new Date(job.start_date).toLocaleDateString('pt-BR')
                                : 'Data a definir';
                            const startTime = job?.work_start_time ?? '';
                            const endTime = job?.work_end_time ?? '';
                            const location = job?.location ?? 'Local a definir';
                            const isResponding = respondingId === invite.id;

                            return (
                                <div key={invite.id} className="bg-white border-2 border-black rounded-2xl p-6 shadow-[4px_4px_0px_0px_rgba(0,166,81,1)]">
                                    {/* Empresa */}
                                    <div className="flex items-center gap-3 mb-4">
                                        <div className="w-10 h-10 rounded-xl border-2 border-black overflow-hidden bg-gray-100 flex-shrink-0">
                                            {companyLogo ? (
                                                <img src={companyLogo} alt={companyName} className="w-full h-full object-cover" />
                                            ) : (
                                                <div className="w-full h-full flex items-center justify-center">
                                                    <Building2 size={20} className="text-gray-400" />
                                                </div>
                                            )}
                                        </div>
                                        <div>
                                            <p className="text-xs font-bold uppercase text-gray-400">Convite de</p>
                                            <p className="font-black uppercase">{companyName}</p>
                                        </div>
                                        <span className="ml-auto bg-primary-light text-primary text-xs font-black uppercase px-2 py-1 rounded-xl border border-green-200">
                                            Novo convite
                                        </span>
                                    </div>

                                    {/* Detalhes do turno */}
                                    <h3 className="font-black text-xl uppercase mb-3">{jobTitle}</h3>
                                    <div className="flex flex-wrap gap-2 mb-4">
                                        <span className="flex items-center gap-1.5 text-xs font-bold bg-gray-100 text-gray-600 px-3 py-1.5 rounded-xl">
                                            <Clock size={14} /> {startDate}{startTime ? ` · ${startTime}${endTime ? `–${endTime}` : ''}` : ''}
                                        </span>
                                        <span className="flex items-center gap-1.5 text-xs font-bold bg-primary-light text-primary px-3 py-1.5 rounded-xl">
                                            <DollarSign size={14} /> R$ {budget.toFixed(2).replace('.', ',')}
                                        </span>
                                        {location && (
                                            <span className="flex items-center gap-1.5 text-xs font-bold bg-blue-50 text-blue-700 px-3 py-1.5 rounded-xl">
                                                <MapPin size={14} /> {location}
                                            </span>
                                        )}
                                    </div>

                                    {/* Briefing */}
                                    {(job?.briefing || job?.description) && (
                                        <div className="bg-gray-50 border-l-4 border-black rounded-r-xl p-3 mb-4">
                                            <p className="text-xs font-bold uppercase text-gray-400 mb-1">Briefing</p>
                                            <p className="text-sm font-medium text-gray-700 line-clamp-3">{job.briefing || job.description}</p>
                                        </div>
                                    )}

                                    {/* Expiração */}
                                    {invite.invitation_expires_at && (
                                        <p className="text-xs font-bold text-yellow-600 mb-4 flex items-center gap-1">
                                            <Clock size={12} />
                                            Expira {formatDistanceToNow(new Date(invite.invitation_expires_at), { addSuffix: true, locale: ptBR })}
                                        </p>
                                    )}

                                    {/* Ações */}
                                    <div className="flex gap-3">
                                        <button
                                            onClick={() => respond(invite.id, 'accepted')}
                                            disabled={isResponding}
                                            className="flex-1 bg-primary hover:bg-black text-white px-6 py-3 rounded-xl font-black uppercase flex items-center justify-center gap-2 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                                        >
                                            {isResponding ? <Loader2 className="animate-spin" size={18} /> : <CheckCircle2 size={18} />}
                                            Aceitar
                                        </button>
                                        <button
                                            onClick={() => respond(invite.id, 'declined')}
                                            disabled={isResponding}
                                            className="flex-1 bg-white hover:bg-gray-50 text-gray-700 px-6 py-3 rounded-xl font-black uppercase border-2 border-gray-300 flex items-center justify-center gap-2 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                                        >
                                            {isResponding ? <Loader2 className="animate-spin" size={18} /> : <XCircle size={18} />}
                                            Recusar
                                        </button>
                                    </div>
                                    <p className="text-xs text-gray-400 text-center mt-2 font-bold">
                                        Recusar não afeta sua reputação.
                                    </p>
                                </div>
                            );
                        })}
                    </>
                )}

                {/* ── ABA EM ANDAMENTO ── */}
                {activeTab === 'in_progress' && jobs.in_progress.length === 0 && (
                    <div className="text-center py-12 text-gray-400 bg-gray-50 rounded-2xl border-2 border-dashed border-gray-200">
                        <AlertCircle size={48} className="mx-auto mb-4 opacity-30" />
                        <p className="font-bold">Nenhum trabalho em andamento.</p>
                        <p className="text-sm mt-2">Trabalhos agendados para hoje aparecerão aqui durante o horário de trabalho.</p>
                    </div>
                )}
                {activeTab === 'in_progress' && jobs.in_progress.map((job) => (
                    <div key={job.id} className="bg-gradient-to-r from-green-50 to-emerald-50 border-2 border-green-500 p-6 rounded-2xl shadow-[6px_6px_0px_0px_rgba(0,166,81,1)]">
                        <div className="flex flex-col md:flex-row justify-between gap-4">
                            <div className="flex gap-4 items-start">
                                <div className="bg-green-600 text-white p-3 rounded-xl min-w-[70px] text-center animate-pulse">
                                    <Play size={24} className="mx-auto" />
                                    <span className="block text-xs font-bold uppercase mt-1">AO VIVO</span>
                                </div>
                                <div>
                                    <h3 className="font-black text-xl uppercase mb-1">{job.title}</h3>
                                    <p className="text-sm font-bold text-gray-600">{job.company_name}</p>
                                    <div className="flex flex-wrap gap-2 mt-2">
                                        <span className="flex items-center gap-1.5 text-xs font-bold bg-white text-gray-600 px-3 py-1.5 rounded-lg border">
                                            <Clock size={14} /> {job.time} - {job.end_time}
                                        </span>
                                        <span className="flex items-center gap-1.5 text-xs font-bold bg-white text-green-700 px-3 py-1.5 rounded-lg border">
                                            <DollarSign size={14} /> R$ {job.pay}
                                        </span>
                                        <span className="flex items-center gap-1.5 text-xs font-bold bg-white text-gray-600 px-3 py-1.5 rounded-lg border">
                                            <MapPin size={14} /> {job.location}
                                        </span>
                                    </div>
                                    {job.status === 'in_progress' && (
                                        <p className="text-xs text-yellow-600 font-bold flex items-center gap-1 mt-1">
                                            Pagamento em garantia até confirmação da empresa
                                        </p>
                                    )}
                                </div>
                            </div>
                        </div>
                        <div className="border-t border-gray-100 mt-3 pt-3">
                            <JobLifecycleStepper steps={computeWorkerSteps(job)} />
                        </div>
                        <div className="flex flex-col gap-3 mt-3">
                            <div className="flex flex-col gap-3 min-w-[200px]">
                                {!job.worker_checkin_at ? (
                                    <button
                                        onClick={() => handleCheckin(job.id)}
                                        disabled={actionLoading === job.id}
                                        className="bg-green-600 hover:bg-green-700 text-white px-4 py-3 rounded-xl font-black uppercase flex items-center justify-center gap-2 transition-colors disabled:opacity-50"
                                    >
                                        {actionLoading === job.id ? (
                                            <Loader2 className="animate-spin" size={20} />
                                        ) : (
                                            <><Play size={20} /> Check-in</>
                                        )}
                                    </button>
                                ) : (
                                    <div className="bg-green-100 text-green-700 px-4 py-2 rounded-xl font-bold text-sm flex items-center gap-2">
                                        <CheckCircle2 size={16} />
                                        Check-in: {formatDistanceToNow(new Date(job.worker_checkin_at), { addSuffix: true, locale: ptBR })}
                                    </div>
                                )}

                                {job.worker_checkin_at && (
                                    <div className={`px-4 py-2 rounded-xl font-bold text-sm flex items-center gap-2 ${job.company_checkin_confirmed_at ? 'bg-blue-100 text-blue-700' : 'bg-yellow-100 text-yellow-700'}`}>
                                        {job.company_checkin_confirmed_at ? (
                                            <><CheckCircle2 size={16} /> Empresa confirmou chegada</>
                                        ) : (
                                            <><Clock size={16} /> Aguardando confirmação da empresa</>
                                        )}
                                    </div>
                                )}

                                {job.worker_checkin_at && !job.worker_checkout_at && (
                                    <button
                                        onClick={() => handleCheckout(job.id)}
                                        disabled={actionLoading === job.id}
                                        className="bg-red-500 hover:bg-red-600 text-white px-4 py-3 rounded-xl font-black uppercase flex items-center justify-center gap-2 transition-colors disabled:opacity-50"
                                    >
                                        {actionLoading === job.id ? (
                                            <Loader2 className="animate-spin" size={20} />
                                        ) : (
                                            <><Square size={20} /> Check-out</>
                                        )}
                                    </button>
                                )}

                                {job.worker_checkout_at && (
                                    <div className="bg-gray-100 text-gray-700 px-4 py-2 rounded-xl font-bold text-sm flex items-center gap-2">
                                        <CheckCircle2 size={16} />
                                        Check-out: {formatDistanceToNow(new Date(job.worker_checkout_at), { addSuffix: true, locale: ptBR })}
                                    </div>
                                )}
                            </div>
                        </div>
                    </div>
                ))}

                {/* ── ABA AGENDADOS ── */}
                {activeTab === 'scheduled' && jobs.scheduled.length === 0 && (
                    <div className="text-center py-12 text-gray-400 bg-gray-50 rounded-2xl border-2 border-dashed border-gray-200">
                        <p className="font-bold">Nenhum turno agendado no momento.</p>
                    </div>
                )}
                {activeTab === 'scheduled' && jobs.scheduled.map((job) => (
                    <div key={job.id} className="bg-white border-2 border-black p-6 rounded-2xl shadow-[4px_4px_0px_0px_rgba(0,166,81,1)] flex flex-col md:flex-row justify-between md:items-center gap-4 group hover:-translate-y-1 transition-transform">
                        <div className="flex gap-4 items-center">
                            <div className="bg-black text-white p-3 rounded-xl border-2 border-black min-w-[70px] text-center group-hover:bg-primary group-hover:border-primary transition-colors">
                                <span className="block text-xs font-bold uppercase">{job.month}</span>
                                <span className="block text-2xl font-black">{job.day}</span>
                            </div>
                            <div>
                                <h3 className="font-black text-xl uppercase mb-1">{job.title}</h3>
                                <span className="flex items-center gap-1.5 text-xs font-bold bg-gray-100 text-gray-600 px-3 py-1.5 rounded-lg uppercase">
                                    <Clock size={14} /> {job.date} • {job.time}
                                </span>
                                <span className="flex items-center gap-1.5 text-xs font-bold bg-green-100 text-green-700 px-3 py-1.5 rounded-lg uppercase ml-2">
                                    <DollarSign size={14} /> R$ {job.pay}
                                </span>
                                <p className="text-sm font-bold text-gray-500 flex items-center gap-1 mt-1">
                                    <MapPin size={14} /> {job.location}
                                </p>
                            </div>
                        </div>
                        <div className="flex items-center justify-between md:justify-end gap-4 border-t md:border-t-0 md:border-l border-gray-100 pt-4 md:pt-0 md:pl-6 w-full md:w-auto">
                            <div>
                                <span className="block text-sm font-bold text-gray-400 uppercase">Receber</span>
                                <span className="block text-2xl font-black text-primary">R$ {job.pay}</span>
                            </div>
                            <span className="bg-green-100 text-green-700 text-xs font-black uppercase px-3 py-1 rounded-full border border-green-200">Contratado</span>
                        </div>
                    </div>
                ))}

                {/* ── ABA HISTÓRICO ── */}
                {activeTab === 'history' && jobs.history.length === 0 && (
                    <div className="text-center py-12 text-gray-400 bg-gray-50 rounded-2xl border-2 border-dashed border-gray-200">
                        <p className="font-bold">Seu histórico está vazio.</p>
                    </div>
                )}
                {activeTab === 'history' && jobs.history.map((job) => (
                    <div key={job.id} className="bg-gray-50 border-2 border-transparent hover:border-black p-6 rounded-2xl flex flex-col md:flex-row justify-between items-start md:items-center transition-all cursor-pointer gap-2">
                        <div>
                            <h3 className="font-black text-lg uppercase mb-1 text-gray-700">{job.title}</h3>
                            <p className="text-sm font-bold text-gray-400">{job.date} • {job.company_name}</p>
                        </div>
                        <div className="flex items-center justify-between w-full md:w-auto gap-4">
                            <span className="block font-black text-gray-600">R$ {job.pay}</span>
                            {job.status === 'completed' ? (
                                <div className="flex items-center gap-2">
                                    <span className="text-xs font-black text-green-600 flex items-center gap-1 uppercase bg-green-100 px-2 py-1 rounded-xl">
                                        <CheckCircle2 size={12} /> Pago
                                    </span>
                                    {!reviewedJobIds.has(job.job_id) ? (
                                        <button
                                            onClick={(e) => { e.stopPropagation(); handleOpenRateModal(job); }}
                                            className="text-xs font-black text-white bg-black hover:bg-yellow-500 hover:text-black flex items-center gap-1 uppercase px-3 py-1.5 rounded-xl transition-colors"
                                        >
                                            <Star size={12} /> Avaliar
                                        </button>
                                    ) : (
                                        <span className="text-xs font-bold text-gray-400 flex items-center gap-1 uppercase">
                                            <Star size={12} fill="currentColor" /> Avaliado
                                        </span>
                                    )}
                                </div>
                            ) : (
                                <span className="text-xs font-black text-red-500 flex items-center gap-1 uppercase bg-red-100 px-2 py-1 rounded-xl">
                                    <XCircle size={12} /> {job.status === 'declined' ? 'Recusado' : 'Cancelado'}
                                </span>
                            )}
                        </div>
                    </div>
                ))}
            </div>

            <RateModal
                isOpen={rateModalOpen}
                onClose={() => setRateModalOpen(false)}
                onSubmit={handleSubmitRate}
                targetName={selectedJobToRate?.company_name || 'Empresa'}
                targetPhotoUrl={selectedJobToRate?.company_logo ?? undefined}
                title="Avaliar Empresa"
                subtitle={selectedJobToRate?.title}
            />

        </div>
    );
}
