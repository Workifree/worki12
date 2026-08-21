import { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { supabase } from '../../lib/supabase';
import { ArrowLeft, MapPin, Calendar, Star, Briefcase, Award, Zap, MessageSquare, Phone, Wallet, Copy, Check, Loader2 } from 'lucide-react';
import PageMeta from '../../components/PageMeta';
import { format } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import { logError } from '../../lib/logger'
import { useToast } from '../../contexts/ToastContext';
import { TeamConnectionService } from '../../services/teamConnectionService';
import WorkerCertificationsPanel from '../../components/company/WorkerCertificationsPanel';
import type { TeamConnectionStatus } from '../../types';

export default function WorkerPublicProfile() {
    const { id } = useParams();
    const navigate = useNavigate();
    const { addToast } = useToast();
    interface WorkerProfileData {
        id: string;
        full_name: string;
        bio?: string;
        city?: string;
        level?: number;
        xp?: number;
        completed_jobs_count?: number;
        recommendation_score?: number;
        rating_average?: number;
        reviews_count?: number;
        tags?: string[];
        created_at: string;
        avatar_url?: string;
        location?: string;
        joined_at?: string;
        photo_url?: string;
        completed_jobs?: number;
        phone?: string;
        pix_key?: string;
    }

    interface ReviewData {
        id: string;
        rating: number;
        comment: string;
        reviewer_id: string;
        created_at: string;
        company?: { name: string };
    }

    interface HistoryItem {
        id: string;
        status: string;
        job?: { title: string; company?: { name: string } };
    }

    const [profile, setProfile] = useState<WorkerProfileData | null>(null);
    const [reviews, setReviews] = useState<ReviewData[]>([]);
    const [history, setHistory] = useState<HistoryItem[]>([]);
    const [loading, setLoading] = useState(true);
    // R1.2: application entre ESTA empresa e este freela — habilita o botão "Mensagem"
    // (a Conversation é amarrada a um application_uuid; sem application, não há para onde criar).
    const [applicationId, setApplicationId] = useState<string | null>(null);
    const [chatLoading, setChatLoading] = useState(false);
    const [phoneCopied, setPhoneCopied] = useState(false);
    const [pixCopied, setPixCopied] = useState(false);
    // R1 (visibilidade): telefone/PIX só aparecem se a empresa tiver conexão 'accepted' com
    // este freela — defesa em profundidade, já que a RLS de `workers` hoje é `USING (true)`
    // (achado do harness-security-reviewer; gate de fechamento é do architect). Guardamos o
    // status inteiro (não só um booleano) pra diferenciar "sem vínculo" de "convite pendente"
    // na copy (F-06) — esta tela também é alcançável do `PendingCard`, onde o freela JÁ foi
    // adicionado e só falta aceitar.
    const [connectionStatus, setConnectionStatus] = useState<TeamConnectionStatus | null>(null);
    const hasTeamConnection = connectionStatus === 'accepted';

    useEffect(() => {
        if (id) {
            fetchProfile();
            // Track View
            import('../../services/analytics').then(({ AnalyticsService }) => {
                AnalyticsService.trackProfileView(id);
            });
        }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- fetchProfile usa state setters estaveis, so precisa re-executar quando id muda
    }, [id]);

    const fetchProfile = async () => {
        try {
            // Fetch Profile — .maybeSingle() (não .single()): desde a migration
            // 20260816120000_workers_select_by_relationship.sql a policy de SELECT em `workers`
            // é escopada por vínculo (dono, ou empresa com team_connections/applications já
            // existentes). Um freela genuinamente sem vínculo com esta empresa faz a linha
            // "sumir" pela RLS (sem erro, sem dado) — .single() transformaria isso em
            // PGRST116 e caía na tela de erro genérica; .maybeSingle() deixa a gente
            // renderizar o estado explícito abaixo.
            const { data: profileData, error: profileError } = await supabase
                .from('workers')
                .select('id, full_name, bio, city, level, xp, completed_jobs_count, recommendation_score, rating_average, reviews_count, tags, created_at, avatar_url, phone, pix_key')
                .eq('id', id)
                .maybeSingle();

            if (profileError) throw profileError;

            if (!profileData) {
                // Sem erro, mas sem linha: worker inexistente OU oculto pela RLS de vínculo.
                // Mesma mensagem para os dois casos de propósito — não vazamos se o id existe.
                setProfile(null);
                return;
            }

            // Map fields for UI consistency
            const mappedProfile = {
                ...profileData,
                location: profileData.city,
                joined_at: profileData.created_at,
                photo_url: profileData.avatar_url,
                completed_jobs: profileData.completed_jobs_count
            };

            setProfile(mappedProfile);

            // Fetch Reviews
            const { data: reviewsData } = await supabase
                .from('reviews')
                .select('*')
                .eq('reviewed_id', id)
                .order('created_at', { ascending: false });

            if (reviewsData && reviewsData.length > 0) {
                // Manually fetch company names (as per existing logic)
                const reviewerIds = [...new Set(reviewsData.map(r => r.reviewer_id))];
                const { data: companies } = await supabase
                    .from('companies')
                    .select('id, name')
                    .in('id', reviewerIds);

                const companyMap = new Map((companies || []).map(c => [c.id, c.name]));

                // Attach names
                const enrichedReviews = reviewsData.map(r => ({
                    ...r,
                    company: { name: companyMap.get(r.reviewer_id) || 'Empresa' }
                }));
                setReviews(enrichedReviews);
            } else {
                setReviews([]);
            }

            // Fetch History (Completed Jobs)
            const { data: historyData } = await supabase
                .from('applications')
                .select('*, job:jobs(title, company:companies(name))')
                .eq('worker_id', id)
                .in('status', ['hired', 'completed'])
                .limit(5);
            setHistory(historyData || []);

            // R1.2/R10: application entre a empresa autenticada e este freela — sem isso o
            // botão "Mensagem" não tem para onde criar a Conversation (amarrada a application_uuid).
            // R1 (visibilidade): resolvido na MESMA passada — `companies.id === owner_id === auth.uid()`
            // neste schema (confirmado em CompanyOnboarding/CompanyCreateJob), então não precisamos de
            // uma query extra em `companies` só para achar o company_id antes de checar o vínculo.
            const { data: { user } } = await supabase.auth.getUser();
            if (user && id) {
                // getConnectionStatus (não isWorkerInTeam) — mesma query única de antes, mas
                // devolve o status inteiro pra diferenciar "sem vínculo" de "pending" na copy (F-06).
                const [appsResult, status] = await Promise.all([
                    supabase
                        .from('applications')
                        .select('id, jobs!inner(company_id)')
                        .eq('worker_id', id)
                        .eq('jobs.company_id', user.id)
                        .order('created_at', { ascending: false })
                        .limit(1),
                    TeamConnectionService.getConnectionStatus(user.id, id),
                ]);
                const apps = appsResult.data;
                if (apps && apps.length > 0) setApplicationId(apps[0].id as string);
                setConnectionStatus(status);
            }

        } catch (error) {
            logError('Erro ao carregar perfil do worker:', error);
        } finally {
            setLoading(false);
        }
    };

    // R10: liga o botão "Mensagem" — reusa a mesma lógica de handleChat do
    // CompanyJobCandidates (procura Conversation por application_uuid, cria se não existir).
    const handleChat = async () => {
        if (!applicationId) return;
        setChatLoading(true);
        try {
            const { data: existingConvs } = await supabase
                .from('Conversation')
                .select('id')
                .eq('application_uuid', applicationId)
                .limit(1);

            if (existingConvs && existingConvs.length > 0) {
                navigate(`/company/messages?conversation=${existingConvs[0].id}`);
            } else {
                const newConvId = crypto.randomUUID();
                const { error } = await supabase
                    .from('Conversation')
                    .insert({ id: newConvId, application_uuid: applicationId, islocked: false });

                if (error) throw error;
                navigate(`/company/messages?conversation=${newConvId}`);
            }
        } catch (error) {
            logError('WorkerPublicProfile.handleChat', error);
            addToast('Erro ao iniciar conversa.', 'error');
        } finally {
            setChatLoading(false);
        }
    };

    // R1.2: copiar telefone/chave PIX — mesmo padrão de handleCopyWorkiId (pages/Profile.tsx).
    const handleCopy = async (value: string, kind: 'phone' | 'pix') => {
        try {
            await navigator.clipboard.writeText(value);
            if (kind === 'phone') {
                setPhoneCopied(true);
                setTimeout(() => setPhoneCopied(false), 2500);
            } else {
                setPixCopied(true);
                setTimeout(() => setPixCopied(false), 2500);
            }
            addToast(kind === 'phone' ? 'Telefone copiado!' : 'Chave PIX copiada!', 'success');
        } catch {
            addToast('Não foi possível copiar.', 'error');
        }
    };

    if (loading) return (
        <div className="max-w-4xl mx-auto p-8 animate-pulse">
            <div className="flex items-center gap-6 mb-8">
                <div className="w-20 h-20 bg-gray-200 rounded-full" />
                <div className="flex-1 space-y-3">
                    <div className="h-8 bg-gray-200 rounded w-1/3" />
                    <div className="h-4 bg-gray-200 rounded w-1/2" />
                </div>
            </div>
            <div className="space-y-4">
                {[...Array(3)].map((_, i) => <div key={i} className="h-20 bg-gray-200 rounded-xl" />)}
            </div>
        </div>
    );
    if (!profile) return (
        <div className="p-8 text-center text-gray-400 font-bold">
            Perfil indisponível — este freela não faz parte do seu elenco.
        </div>
    );

    return (
        <div className="max-w-4xl mx-auto animate-in fade-in slide-in-from-bottom-4 duration-500 pb-20">
            <PageMeta
              title={profile ? profile.full_name : 'Perfil do Profissional'}
              description={profile ? `${profile.bio ?? 'Profissional'} | Veja o perfil completo de ${profile.full_name} na Worki.` : undefined}
              ogTitle={profile ? `${profile.full_name} — Worki` : undefined}
            />
            {/* Header / Nav */}
            <button onClick={() => navigate(-1)} className="flex items-center gap-2 text-gray-400 font-bold hover:text-black transition-colors mb-6">
                <ArrowLeft size={16} strokeWidth={3} /> Voltar
            </button>

            {/* Profile Card */}
            <div className="bg-white border-2 border-black rounded-2xl overflow-hidden shadow-[8px_8px_0px_0px_rgba(0,0,0,0.1)] mb-8">
                {/* Banner */}
                <div className="h-32 bg-gradient-to-r from-blue-600 to-purple-600"></div>

                <div className="px-8 pb-8 relative">
                    {/* Avatar */}
                    <div className="absolute -top-16 left-8">
                        <div className="w-32 h-32 rounded-full border-4 border-white bg-black shadow-lg overflow-hidden flex items-center justify-center">
                            {profile.photo_url ? (
                                <img src={profile.photo_url} alt={profile.full_name} className="w-full h-full object-cover" />
                            ) : (
                                <span className="text-4xl text-white font-black">{profile.full_name?.[0]}</span>
                            )}
                        </div>
                    </div>

                    {/* Actions */}
                    <div className="flex justify-end pt-4 gap-4">
                        <button
                            onClick={() => void handleChat()}
                            disabled={!applicationId || chatLoading}
                            title={applicationId ? undefined : 'Ainda não há um turno/candidatura entre sua empresa e este freela.'}
                            className="px-6 py-2 border-2 border-black rounded-xl font-bold uppercase hover:bg-gray-50 transition-colors flex items-center gap-2 disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:bg-white"
                        >
                            {chatLoading ? <Loader2 size={18} className="animate-spin" /> : <MessageSquare size={18} />} Mensagem
                        </button>

                    </div>

                    {/* Basic Info */}
                    <div className="mt-4">
                        <h1 className="text-4xl font-black uppercase tracking-tight">{profile.full_name}</h1>
                        <p className="text-xl font-medium text-gray-500 mt-1">{profile.bio || 'Profissional Worki'}</p>

                        <div className="flex items-center gap-6 mt-4 text-sm font-bold text-gray-600">
                            <span className="flex items-center gap-2"><MapPin size={18} /> {profile.location || 'Localização não definida'}</span>
                            <span className="flex items-center gap-2"><Calendar size={18} /> Desde {profile.joined_at ? format(new Date(profile.joined_at), 'MMMM yyyy', { locale: ptBR }) : 'N/A'}</span>
                        </div>
                    </div>

                    {/* Stats Grid */}
                    <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mt-8">
                        <div className="bg-gray-50 p-4 rounded-xl border-2 border-gray-100">
                            <div className="flex items-center gap-2 text-gray-400 font-bold mb-1 text-xs uppercase"><Zap size={14} /> Nível</div>
                            <div className="text-2xl font-black">{profile.level}</div>
                        </div>
                        <div className="bg-gray-50 p-4 rounded-xl border-2 border-gray-100">
                            <div className="flex items-center gap-2 text-gray-400 font-bold mb-1 text-xs uppercase"><Briefcase size={14} /> Jobs</div>
                            <div className="text-2xl font-black">{profile.completed_jobs} <span className="text-xs text-gray-400">concluídos</span></div>
                        </div>
                        <div className="bg-gray-50 p-4 rounded-xl border-2 border-gray-100">
                            <div className="flex items-center gap-2 text-gray-400 font-bold mb-1 text-xs uppercase"><Star size={14} /> Avaliação</div>
                            <div className="text-2xl font-black text-yellow-500">
                                {(profile.reviews_count ?? 0) > 0 && (profile.rating_average ?? 0) > 0
                                    ? Number(profile.rating_average).toFixed(1)
                                    : '—'}
                            </div>
                            <p className="text-xs text-gray-500">({profile.reviews_count ?? 0} avaliações)</p>
                        </div>
                        <div className="bg-gray-50 p-4 rounded-xl border-2 border-gray-100">
                            <div className="flex items-center gap-2 text-gray-400 font-bold mb-1 text-xs uppercase"><Award size={14} /> XP Total</div>
                            <div className="text-2xl font-black">{profile.xp}</div>
                        </div>
                    </div>

                    {/* Tags */}
                    {profile.tags && (
                        <div className="mt-8">
                            <h3 className="font-bold uppercase text-gray-400 text-sm mb-3">Especialidades</h3>
                            <div className="flex gap-2 flex-wrap">
                                {profile.tags.map((tag: string) => (
                                    <span key={tag} className="px-3 py-1 bg-black text-white rounded-lg text-xs font-bold uppercase">{tag}</span>
                                ))}
                            </div>
                        </div>
                    )}

                    {/* R1.2: Contato e pagamento — o piloto roda no modo A (pagamento por fora,
                        registrado no Worki), então a empresa precisa do telefone e da chave PIX
                        do freela para de fato conseguir pagar. R1 (visibilidade): só exibido para
                        empresa com vínculo 'accepted' — ver harness-security-reviewer HIGH. */}
                    <div className="mt-8 bg-gray-50 p-4 rounded-xl border-2 border-gray-100">
                        <h3 className="font-bold uppercase text-gray-400 text-sm mb-3">Contato e pagamento</h3>
                        {hasTeamConnection ? (
                            <div className="space-y-3">
                                <div className="flex items-center justify-between gap-3 bg-white p-3 rounded-lg border border-gray-200">
                                    <span className="flex items-center gap-2 text-sm font-bold text-gray-700 min-w-0">
                                        <Phone size={16} className="flex-shrink-0 text-gray-400" />
                                        <span className="truncate">{profile.phone || 'Telefone não informado'}</span>
                                    </span>
                                    {profile.phone && (
                                        <button
                                            onClick={() => handleCopy(profile.phone as string, 'phone')}
                                            aria-label="Copiar telefone"
                                            className="p-2 rounded-lg text-gray-400 hover:text-black hover:bg-gray-100 transition-colors flex-shrink-0"
                                        >
                                            {phoneCopied ? <Check size={16} /> : <Copy size={16} />}
                                        </button>
                                    )}
                                </div>
                                <div className="flex items-center justify-between gap-3 bg-white p-3 rounded-lg border border-gray-200">
                                    <span className="flex items-center gap-2 text-sm font-bold text-gray-700 min-w-0">
                                        <Wallet size={16} className="flex-shrink-0 text-gray-400" />
                                        <span className="truncate">{profile.pix_key || 'Chave PIX não informada'}</span>
                                    </span>
                                    {profile.pix_key && (
                                        <button
                                            onClick={() => handleCopy(profile.pix_key as string, 'pix')}
                                            aria-label="Copiar chave PIX"
                                            className="p-2 rounded-lg text-gray-400 hover:text-black hover:bg-gray-100 transition-colors flex-shrink-0"
                                        >
                                            {pixCopied ? <Check size={16} /> : <Copy size={16} />}
                                        </button>
                                    )}
                                </div>
                            </div>
                        ) : (
                            <p className="text-sm font-bold text-gray-500 bg-white p-3 rounded-lg border border-gray-200">
                                {connectionStatus === 'pending'
                                    ? 'Aguardando o freela aceitar o convite para ver os dados de pagamento.'
                                    : 'Adicione este freela ao seu elenco para ver os dados de pagamento.'}
                            </p>
                        )}
                    </div>
                </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
                {/* History */}
                <div>
                    <h3 className="text-xl font-black uppercase mb-4 flex items-center gap-2"><Briefcase size={20} /> Histórico Recente</h3>
                    <div className="space-y-4">
                        {history.length > 0 ? history.map((h) => (
                            <div key={h.id} className="bg-white p-4 rounded-xl border-2 border-gray-100 flex justify-between items-center bg-gray-50/50">
                                <div>
                                    <h4 className="font-bold">{h.job?.title}</h4>
                                    <p className="text-xs text-gray-500 font-bold uppercase">{h.job?.company?.name || 'Empresa Confidencial'}</p>
                                </div>
                                <span className="text-xs font-bold bg-green-100 text-green-700 px-2 py-1 rounded uppercase">Concluído</span>
                            </div>
                        )) : (
                            <p className="text-gray-400 italic font-medium">Nenhum histórico visível.</p>
                        )}
                    </div>
                </div>

                {/* Reviews */}
                <div>
                    <h3 className="text-xl font-black uppercase mb-4 flex items-center gap-2"><MessageSquare size={20} /> Comentários</h3>
                    <div className="space-y-4">
                        {reviews.length > 0 ? reviews.map((r) => (
                            <div key={r.id} className="bg-white p-4 rounded-xl border-2 border-gray-100">
                                <div className="flex justify-between items-start mb-2">
                                    <span className="font-bold text-sm">{r.company?.name || 'Empresa Confidencial'}</span>
                                    <div className="flex text-yellow-400">
                                        {[...Array(5)].map((_, i) => (
                                            <Star key={i} size={12} fill={i < r.rating ? "currentColor" : "none"} strokeWidth={3} className={i < r.rating ? "" : "text-gray-300"} />
                                        ))}
                                    </div>
                                </div>
                                <p className="text-sm text-gray-600 font-medium">"{r.comment || 'Sem comentário'}"</p>
                                <p className="text-xs text-gray-400 mt-1">
                                    {format(new Date(r.created_at), "d 'de' MMM. 'de' yyyy", { locale: ptBR })}
                                </p>
                            </div>
                        )) : (
                            <p className="text-sm text-gray-400 italic text-center py-4">Nenhuma avaliação ainda. Seja o primeiro a avaliar!</p>
                        )}
                    </div>
                </div>
            </div>

            {/* F8 — certificações auto-declaradas do freela + treinamentos internos registrados
                pela empresa. `id` é garantido aqui: `!profile` já retornou acima. */}
            {id && <WorkerCertificationsPanel workerId={id} />}

        </div>
    );
}
