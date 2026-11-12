import { useEffect, useState } from 'react';
import ErroDeCarga from '../../components/ErroDeCarga';
import { useParams, useNavigate } from 'react-router-dom';
import { supabase } from '../../lib/supabase';
import { ArrowLeft, MapPin, Clock, Calendar, Users, MoreHorizontal, Edit2, PauseCircle, PlayCircle, Trash2 } from 'lucide-react';
import PageMeta from '../../components/PageMeta';
import { formatDistanceToNow } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import { WalletService } from '../../services/walletService';
import { useToast } from '../../contexts/ToastContext';
import { logError } from '../../lib/logger';
import { formatDateOnly } from '../../lib/dateUtils';
import { getAuthenticatedCompanyId } from '../../services/companyScopeService';
import { Button, Card } from '../../components/ui';

const MENU_ITEM = 'flex min-h-11 w-full items-center gap-2 px-4 py-2.5 text-left text-sm font-semibold hover:bg-gray-50';

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
    const [erroCarga, setErroCarga] = useState(false);
    const { addToast } = useToast();

    // Esc fecha o menu de ações (o clique fora é a camada transparente z-10 abaixo do menu).
    useEffect(() => {
        if (!openMenu) return;
        const onKeyDown = (e: KeyboardEvent) => {
            if (e.key === 'Escape') setOpenMenu(false);
        };
        document.addEventListener('keydown', onKeyDown);
        return () => document.removeEventListener('keydown', onKeyDown);
    }, [openMenu]);

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
                .eq('company_id', await getAuthenticatedCompanyId())
                .single();

            if (error) throw error;

            // Fetch candidate count manually
            const { count } = await supabase
                .from('applications')
                .select('id', { count: 'exact', head: true })
                .eq('job_id', id);

            setJob({ ...data, candidates_count: count || 0 });
        } catch (error) {
            // Falha de rede/RLS nao pode se disfarcar de "turno nao existe" mandando pra lista
            // em silencio — a pessoa perde o contexto sem saber por que (Nielsen #1).
            logError('Error fetching job:', error);
            setErroCarga(true);
        } finally {
            setLoading(false);
        }
    };

    const handleStatusChange = async (newStatus: string) => {
        // .select('id') obrigatório (patterns.md — DELETE/UPDATE sob RLS negado em silêncio):
        // sem isso, um UPDATE negado pela RLS de `jobs` (ligada nesta revisão) devolve 204 sem
        // erro e a UI ficaria presa mostrando o status antigo, sem avisar a empresa do motivo.
        const { data, error } = await supabase.from('jobs').update({ status: newStatus }).eq('id', id).select('id');
        if (error) {
            logError('CompanyJobDetails.handleStatusChange', error);
            addToast('Não foi possível atualizar o turno. Tente novamente.', 'error');
        } else if (!data || data.length === 0) {
            addToast('Não foi possível atualizar o turno: verifique se você ainda tem permissão sobre ele.', 'error');
        } else {
            fetchJobDetails();
        }
        setOpenMenu(false);
    };

    const handleDelete = async () => {
        if (!id) return;

        // 1. Cancel hired workers' applications — efeito colateral em LOTE: 0 linhas é
        // legítimo (turno sem ninguém contratado), não é erro. Usa o retorno só para
        // informar quantos freelas foram de fato notificados.
        const { data: cancelledApps, error: cancelError } = await supabase
            .from('applications')
            .update({ status: 'cancelled' })
            .eq('job_id', id)
            .in('status', ['hired', 'in_progress'])
            .select('id');
        if (cancelError) {
            logError('CompanyJobDetails.handleDelete.cancelApplications', cancelError);
        }
        const cancelledCount = cancelledApps?.length ?? 0;

        // 2. First refund any pending escrow back to the company wallet
        await WalletService.refundEscrow(id, 'Dinheiro retornado do escrow - turno deletado');

        // 3. Then mark the job as deleted — gesto explícito com toast de sucesso: precisa
        // de `.select('id')` para não afirmar "excluído" quando a RLS negou em silêncio.
        const { data: deletedJob, error } = await supabase.from('jobs').update({ status: 'deleted' }).eq('id', id).select('id');
        if (!error && deletedJob && deletedJob.length > 0) {
            addToast(
                cancelledCount > 0
                    ? `Turno excluído com sucesso. ${cancelledCount} freela${cancelledCount > 1 ? 's' : ''} notificado${cancelledCount > 1 ? 's' : ''}.`
                    : 'Turno excluído com sucesso.',
                'success'
            );
            navigate('/company/jobs');
        } else {
            if (error) logError('CompanyJobDetails.handleDelete.deleteJob', error);
            addToast('Não foi possível excluir o turno. Verifique se você ainda tem permissão sobre ele.', 'error');
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
    if (erroCarga && !job) return (
        <div className="max-w-4xl mx-auto p-4 sm:p-8">
            <Button
                variant="ghost"
                onClick={() => navigate('/company/jobs')}
                iconLeft={<ArrowLeft size={16} strokeWidth={3} />}
                className="-ml-3 mb-4"
            >
                Voltar aos turnos
            </Button>
            <ErroDeCarga onRetry={() => { setErroCarga(false); setLoading(true); fetchJobDetails(); }} />
        </div>
    );

    if (!job) return null;

    const unidadePreco = job.budget_type === 'hourly' ? '/ hora' : job.budget_type === 'daily' ? '/ dia' : 'total';
    const statusLabel = job.status === 'open' ? 'Turno ativo' : job.status === 'paused' ? 'Pausado' : 'Fechado';

    return (
        <>
        <PageMeta
          title={job ? job.title : 'Detalhes do Turno'}
          description={job ? (job.description?.slice(0, 160) ?? undefined) : undefined}
        />
        {showDeleteConfirm && (
            <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4 backdrop-blur-sm">
                <Card
                    role="dialog"
                    aria-modal="true"
                    aria-labelledby="excluir-turno-titulo"
                    className="w-full max-w-sm shadow-[6px_6px_0px_0px_rgba(0,0,0,1)]"
                >
                    <h2 id="excluir-turno-titulo" className="mb-2 text-xl font-bold">Excluir turno</h2>
                    <p className="mb-6 text-sm text-gray-600">Tem certeza? O turno será cancelado e os freelas contratados serão notificados.</p>
                    <div className="flex gap-3">
                        <Button variant="secondary" fullWidth onClick={() => setShowDeleteConfirm(false)}>Cancelar</Button>
                        <Button variant="danger" fullWidth onClick={handleDelete}>Excluir</Button>
                    </div>
                </Card>
            </div>
        )}
        <div className="max-w-4xl mx-auto animate-in fade-in slide-in-from-bottom-4 duration-500 pb-20">
            {/* Barra superior: voltar + menu de ações do turno */}
            <div className="mb-4 flex items-center justify-between">
                <Button
                    variant="ghost"
                    onClick={() => navigate('/company/jobs')}
                    iconLeft={<ArrowLeft size={18} />}
                    className="-ml-3"
                >
                    Voltar
                </Button>

                <div className="relative">
                    <Button
                        variant="ghost"
                        onClick={() => setOpenMenu(!openMenu)}
                        aria-label="Mais opções do turno"
                        aria-haspopup="menu"
                        aria-expanded={openMenu}
                        className="w-11 !px-0"
                    >
                        <MoreHorizontal size={20} />
                    </Button>
                    {openMenu && (
                        <>
                        <div className="fixed inset-0 z-10" onClick={() => setOpenMenu(false)} aria-hidden="true" />
                        <div role="menu" aria-label="Ações do turno" className="absolute right-0 top-full z-20 mt-2 w-52 divide-y divide-gray-100 overflow-hidden rounded-xl border-2 border-black bg-white shadow-[4px_4px_0px_0px_rgba(0,0,0,1)]">
                            <button
                                role="menuitem"
                                onClick={() => navigate(`/company/jobs/${id}/edit`)}
                                className={MENU_ITEM}
                            >
                                <Edit2 size={16} /> Editar
                            </button>
                            <button
                                role="menuitem"
                                onClick={() => handleStatusChange(job.status === 'open' ? 'paused' : 'open')}
                                className={MENU_ITEM}
                            >
                                {job.status === 'open' ? <PauseCircle size={16} /> : <PlayCircle size={16} />}
                                {job.status === 'open' ? 'Pausar' : 'Reativar'}
                            </button>
                            <button
                                role="menuitem"
                                onClick={() => { setOpenMenu(false); setShowDeleteConfirm(true); }}
                                className={`${MENU_ITEM} text-red-600 hover:bg-red-50`}
                            >
                                <Trash2 size={16} /> Excluir
                            </button>
                        </div>
                        </>
                    )}
                </div>
            </div>

            <Card padding="lg">
                {/* Cabeçalho do turno: status, título, meta e valor */}
                <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
                    <div className="min-w-0">
                        <span className={`mb-3 inline-block rounded-full border border-black px-3 py-1 text-xs font-semibold ${job.status === 'open' ? 'bg-primary-light text-primary' : 'bg-gray-100 text-gray-700'}`}>
                            {statusLabel}
                        </span>
                        <h1 className="mb-2 text-2xl font-bold tracking-tight sm:text-3xl">{job.title}</h1>
                        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-gray-600">
                            <span className="flex items-center gap-1.5"><MapPin size={16} /> {job.location || 'Local a combinar'}</span>
                            <span className="flex items-center gap-1.5 font-semibold capitalize text-black">
                                <Calendar size={16} /> {job.start_date ? formatDateOnly(job.start_date, "EEEE, dd/MM") : 'Data a definir'}
                            </span>
                            <span className="flex items-center gap-1.5"><Clock size={16} /> Criado {formatDistanceToNow(new Date(job.created_at), { addSuffix: true, locale: ptBR })}</span>
                        </div>
                    </div>
                    <div className="shrink-0 sm:text-right">
                        <div className="text-2xl font-bold tabular-nums">R$ {job.budget}</div>
                        <div className="text-xs text-gray-600">{unidadePreco}</div>
                    </div>
                </div>

                <div className="mt-6 grid grid-cols-1 gap-8 border-t-2 border-gray-100 pt-6 md:grid-cols-3">
                    <div className="space-y-6 md:col-span-2">
                        {job.description && (
                            <section>
                                <h2 className="mb-2 text-lg font-bold">Descrição</h2>
                                <p className="whitespace-pre-wrap text-sm leading-relaxed text-gray-700 sm:text-base">{job.description}</p>
                            </section>
                        )}

                        {job.requirements && (
                            <section>
                                <h2 className="mb-2 text-lg font-bold">Requisitos</h2>
                                <p className="whitespace-pre-wrap text-sm leading-relaxed text-gray-700 sm:text-base">{job.requirements}</p>
                            </section>
                        )}

                        {(job.work_start_time || job.work_end_time) && (
                            <section>
                                <h2 className="mb-2 text-lg font-bold">Horário</h2>
                                <p className="inline-block rounded-xl border-2 border-gray-200 bg-gray-50 px-4 py-3 text-sm font-semibold tabular-nums">
                                    {job.work_start_time?.slice(0, 5)} - {job.work_end_time?.slice(0, 5)}
                                    {job.has_lunch && <span className="ml-2 font-normal text-gray-600">(1h almoço)</span>}
                                </p>
                            </section>
                        )}
                    </div>

                    {/* Resumo + a ação principal do turno */}
                    <aside className="h-fit rounded-xl border-2 border-gray-200 bg-gray-50 p-4">
                        <h2 className="mb-3 text-lg font-bold">Resumo do turno</h2>
                        <div className="space-y-2">
                            {(job.candidates_count || 0) > 0 ? (
                                <button
                                    onClick={() => navigate(`/company/jobs/${id}/candidates`)}
                                    className="-mx-2 flex min-h-11 w-[calc(100%+1rem)] items-center justify-between rounded-xl px-2 text-left transition-colors hover:bg-white"
                                >
                                    <span className="flex items-center gap-2 text-sm font-semibold text-gray-700"><Users size={16} /> Candidatos</span>
                                    <span className="text-xl font-bold tabular-nums">{job.candidates_count}</span>
                                </button>
                            ) : (
                                <div>
                                    <span className="mb-1 flex items-center gap-2 text-sm font-semibold text-gray-700"><Users size={16} /> Candidatos</span>
                                    <p className="mb-3 text-sm text-gray-600">Ninguém convidado para este turno ainda.</p>
                                    <Button variant="dark" fullWidth onClick={() => navigate('/company/team')}>
                                        Convidar freelas do elenco
                                    </Button>
                                </div>
                            )}
                            {activeWorkersCount > 0 ? (
                                <button
                                    onClick={() => navigate(`/company/jobs/${id}/candidates`)}
                                    className="-mx-2 flex min-h-11 w-[calc(100%+1rem)] items-center justify-between rounded-xl px-2 text-left transition-colors hover:bg-white"
                                >
                                    <span className="text-sm font-semibold text-gray-700">Em andamento</span>
                                    <span className="font-bold tabular-nums">{activeWorkersCount}</span>
                                </button>
                            ) : (
                                <div className="flex min-h-11 items-center justify-between">
                                    <span className="text-sm font-semibold text-gray-700">Em andamento</span>
                                    <span className="font-bold tabular-nums">{activeWorkersCount}</span>
                                </div>
                            )}
                        </div>
                    </aside>
                </div>
            </Card>
        </div>
        </>
    );
}
