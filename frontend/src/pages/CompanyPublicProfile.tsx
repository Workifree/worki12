import { useEffect, useState } from 'react';
import ErroDeCarga from '../components/ErroDeCarga';
import { useParams, useNavigate } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { ArrowLeft, MapPin, Star, Building2, Globe, ClipboardList, MessageCircle, Loader2 } from 'lucide-react';
import PageMeta from '../components/PageMeta';
import ProfileReviews from '../components/ProfileReviews';
import { logError } from '../lib/logger';
import { useToast } from '../contexts/ToastContext';

interface CompanyPublicData {
    id: string;
    name: string;
    logo_url?: string | null;
    cover_url?: string | null;
    industry?: string | null;
    description?: string | null;
    address?: string | null;
    website?: string | null;
    default_briefing?: string | null;
    rating_average?: number | null;
    reviews_count?: number | null;
}

/**
 * Perfil público da empresa (R2), visto pelo FREELA — rota /empresa/:id, sob MainLayout
 * (papel worker). Fecha o "buraco de confiança" do modelo push: hoje o freela recebe convite
 * vendo só nome, logo e valor; aqui ele pode conferir quem é a empresa, onde fica, o que a casa
 * pede (briefing padrão) e o que outros freelas disseram (ProfileReviews, reviewerRole="worker").
 */
export default function CompanyPublicProfile() {
    const { id } = useParams();
    const navigate = useNavigate();
    const { addToast } = useToast();
    const [company, setCompany] = useState<CompanyPublicData | null>(null);
    const [loading, setLoading] = useState(true);
    const [notFound, setNotFound] = useState(false);
  const [erroCarga, setErroCarga] = useState(false);
    // "Falar com a empresa": só existe canal se houver uma application do freela
    // autenticado com um turno desta empresa (Conversation é amarrada a application_uuid).
    const [applicationId, setApplicationId] = useState<string | null>(null);
    const [chatLoading, setChatLoading] = useState(false);

    useEffect(() => {
        let active = true;

        if (!id) {
            setLoading(false);
            setNotFound(true);
            return;
        }

        void (async () => {
            setLoading(true);
            setNotFound(false);
            try {
                const { data, error } = await supabase
                    .from('companies')
                    .select('id, name, logo_url, cover_url, industry, description, address, website, default_briefing, rating_average, reviews_count')
                    .eq('id', id)
                    .single();

                if (error) throw error;
                if (!active) return;
                setCompany(data as CompanyPublicData);

                // Relação existente? Reusa a MESMA application (mais recente) que WorkerPublicProfile
                // usa do lado da empresa — sem ela não há para onde amarrar a Conversation.
                const { data: { user } } = await supabase.auth.getUser();
                if (user && active) {
                    const { data: apps } = await supabase
                        .from('applications')
                        .select('id, jobs!inner(company_id)')
                        .eq('worker_id', user.id)
                        .eq('jobs.company_id', id)
                        .order('created_at', { ascending: false })
                        .limit(1);
                    if (active && apps && apps.length > 0) setApplicationId(apps[0].id as string);
                }
            } catch (error) {
                logError('CompanyPublicProfile.fetch', error);
                // "Nao encontrada" e afirmacao sobre o MUNDO; erro de rede e sobre a CARGA.
                // Colapsar os dois faria o freela desistir de um convite por causa de um timeout.
                const code = (error as { code?: string } | null)?.code;
                if (active) {
                    if (code === 'PGRST116') setNotFound(true);
                    else setErroCarga(true);
                }
            } finally {
                if (active) setLoading(false);
            }
        })();

        return () => { active = false; };
    }, [id]);

    // Espelha handleChat do lado da empresa (CompanyJobCandidates/WorkerPublicProfile):
    // procura Conversation por application_uuid, cria se não existir.
    const handleChat = async () => {
        if (!applicationId) return;
        setChatLoading(true);
        try {
            const { data: existingConvs, error: convError } = await supabase
                .from('Conversation')
                .select('id')
                .eq('application_uuid', applicationId)
                .limit(1);
            // Erro aqui NAO significa "nao existe" — cair no ramo de criar duplicaria a conversa.
            if (convError) throw convError;

            if (existingConvs && existingConvs.length > 0) {
                navigate(`/messages?conversation=${existingConvs[0].id}`);
            } else {
                const newConvId = crypto.randomUUID();
                const { error } = await supabase
                    .from('Conversation')
                    .insert({ id: newConvId, application_uuid: applicationId, islocked: false });

                if (error) throw error;
                navigate(`/messages?conversation=${newConvId}`);
            }
        } catch (error) {
            logError('CompanyPublicProfile.handleChat', error);
            addToast('Erro ao iniciar conversa.', 'error');
        } finally {
            setChatLoading(false);
        }
    };

    if (loading) {
        return (
            <div className="max-w-4xl mx-auto pb-24 animate-pulse">
                <div className="h-6 w-24 bg-gray-200 rounded-lg mb-6" />
                <div className="h-48 bg-gray-200 rounded-2xl mb-8" />
                <div className="space-y-4">
                    {[...Array(3)].map((_, i) => <div key={i} className="h-24 bg-gray-200 rounded-xl" />)}
                </div>
            </div>
        );
    }

    if (erroCarga && !company) {
        return (
            <div className="max-w-4xl mx-auto pb-24 pt-6">
                <PageMeta title="Erro ao carregar" />
                <ErroDeCarga onRetry={() => window.location.reload()} />
            </div>
        );
    }

    if (notFound || !company) {
        return (
            <div className="max-w-4xl mx-auto pb-24">
                <PageMeta title="Empresa não encontrada" />
                <div className="text-center py-20 border-2 border-dashed border-gray-200 rounded-2xl bg-gray-50">
                    <Building2 size={48} className="mx-auto mb-4 text-gray-300" />
                    <h1 className="text-xl font-black uppercase mb-2">Empresa não encontrada</h1>
                    <p className="text-gray-500 font-bold mb-6">Não conseguimos localizar este perfil.</p>
                    <button
                        onClick={() => navigate(-1)}
                        className="inline-flex items-center gap-2 bg-primary hover:bg-black text-white px-6 py-3 rounded-xl font-black uppercase transition-colors"
                    >
                        <ArrowLeft size={16} strokeWidth={3} /> Voltar
                    </button>
                </div>
            </div>
        );
    }

    const hasRating = (company.reviews_count ?? 0) > 0 && (company.rating_average ?? 0) > 0;
    const websiteHref = company.website
        ? (company.website.startsWith('http') ? company.website : `https://${company.website}`)
        : null;

    return (
        <div className="max-w-4xl mx-auto pb-24 font-sans text-accent animate-in fade-in slide-in-from-bottom-4 duration-400">
            <PageMeta
                title={company.name}
                description={company.description || `Conheça ${company.name} na Worki antes de aceitar o convite.`}
                ogTitle={`${company.name} — Worki`}
                ogImage={company.logo_url || undefined}
            />

            <button
                onClick={() => navigate(-1)}
                className="flex items-center gap-2 text-gray-400 font-bold hover:text-black transition-colors mb-6"
            >
                <ArrowLeft size={16} strokeWidth={3} /> Voltar
            </button>

            {/* Card principal */}
            <div className="bg-white border-2 border-black rounded-2xl overflow-hidden shadow-[8px_8px_0px_0px_rgba(0,166,81,1)] mb-8">
                <div className="h-32 sm:h-48 bg-black relative">
                    {company.cover_url && (
                        <img src={company.cover_url} alt="" className="absolute inset-0 w-full h-full object-cover" />
                    )}
                </div>

                <div className="px-6 sm:px-8 pb-8">
                    <div className="relative -top-12 mb-[-2.5rem] sm:mb-[-2rem]">
                        <div className="w-24 h-24 sm:w-28 sm:h-28 aspect-square bg-white rounded-2xl border-2 border-black shadow-[4px_4px_0px_0px_rgba(0,166,81,1)] flex items-center justify-center overflow-hidden">
                            {company.logo_url ? (
                                <img src={company.logo_url} alt={company.name} className="w-full h-full object-cover" />
                            ) : (
                                <Building2 size={48} className="text-gray-300" />
                            )}
                        </div>
                    </div>

                    <h1 className="text-3xl sm:text-4xl font-black uppercase tracking-tighter">{company.name}</h1>
                    {company.industry && (
                        <p className="text-lg font-bold text-gray-500 mt-1 uppercase">{company.industry}</p>
                    )}

                    <div className="flex flex-wrap items-center gap-2 mt-4 text-sm font-bold text-gray-600">
                        {company.address && (
                            <a
                                href={`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(company.address)}`}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="flex items-center gap-1.5 bg-blue-50 text-blue-700 px-3 py-1.5 rounded-xl hover:bg-blue-100 underline decoration-blue-300 underline-offset-2"
                            >
                                <MapPin size={16} /> {company.address}
                            </a>
                        )}
                        <span className="flex items-center gap-1.5 bg-yellow-50 text-yellow-700 px-3 py-1.5 rounded-xl">
                            <Star size={16} className={hasRating ? 'fill-yellow-500' : ''} />
                            {hasRating ? Number(company.rating_average).toFixed(1) : '—'}
                            <span className="text-yellow-600 font-medium">({company.reviews_count ?? 0})</span>
                        </span>
                        {websiteHref && (
                            <a
                                href={websiteHref}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="flex items-center gap-1.5 bg-gray-100 text-gray-700 px-3 py-1.5 rounded-xl hover:bg-gray-200 transition-colors"
                            >
                                <Globe size={16} /> Site
                            </a>
                        )}
                    </div>

                    {company.description && (
                        <p className="text-base text-gray-600 font-medium mt-6 leading-relaxed whitespace-pre-wrap">
                            {company.description}
                        </p>
                    )}

                    {/* "Falar com a empresa" — só aparece se houver relação (uma application
                        do freela com um turno desta empresa); sem isso não há canal para criar. */}
                    {applicationId && (
                        <button
                            onClick={() => void handleChat()}
                            disabled={chatLoading}
                            className="mt-6 inline-flex items-center gap-2 bg-primary hover:bg-black text-white px-6 py-3 rounded-xl font-black uppercase transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                        >
                            {chatLoading ? <Loader2 size={18} className="animate-spin" /> : <MessageCircle size={18} />}
                            Falar com a empresa
                        </button>
                    )}
                </div>
            </div>

            {/* Briefing padrão — regras da casa, dress code, apresentação */}
            <div className="bg-white border-2 border-black rounded-2xl p-6 sm:p-8 shadow-[6px_6px_0px_0px_rgba(0,166,81,1)] mb-8">
                <h2 className="text-xl font-black uppercase mb-1 flex items-center gap-2">
                    <ClipboardList size={20} /> Regras da casa
                </h2>
                <p className="text-sm text-gray-500 font-bold mb-4">
                    O que esta empresa costuma pedir dos freelas antes do turno.
                </p>
                {company.default_briefing ? (
                    <p className="text-base leading-relaxed text-accent whitespace-pre-wrap bg-primary-light border-2 border-primary rounded-xl p-4 font-bold">
                        {company.default_briefing}
                    </p>
                ) : (
                    <p className="text-sm text-gray-400 italic font-bold bg-gray-50 border-2 border-dashed border-gray-200 rounded-xl p-4 text-center">
                        Esta empresa ainda não definiu um briefing padrão.
                    </p>
                )}
            </div>

            {/* Avaliações de outros freelas sobre esta empresa — título explícito: quem vê
                aqui é um freela TERCEIRO (não o dono do perfil), então o fallback padrão do
                componente ("Avaliações sobre sua empresa") seria falso. */}
            <ProfileReviews
                reviewedId={company.id}
                reviewerRole="worker"
                title={`Avaliações de freelas sobre ${company.name}`}
            />
        </div>
    );
}
