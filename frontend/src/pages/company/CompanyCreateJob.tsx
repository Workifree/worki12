import { useState, useEffect } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { supabase } from '../../lib/supabase';
import { ArrowLeft, Check, ChevronRight, Wand2, MapPin, DollarSign, Briefcase, Zap, Calendar, Clock, Globe, Send, Users, Loader2, X } from 'lucide-react';
import { useToast } from '../../contexts/ToastContext';
import { logError } from '../../lib/logger';
import { useCompanyTeam } from '../../hooks/useTeamConnections';
import { useCompanyInvites } from '../../hooks/useShiftInvites';
import type { TeamMember } from '../../types';

export default function CompanyCreateJob() {
    const navigate = useNavigate();
    const { id } = useParams(); // Add useParams
    const isEditing = !!id;
    const { addToast } = useToast();

    const [step, setStep] = useState(1);
    const [loading, setLoading] = useState(false);
    const [categories, setCategories] = useState<{ name: string, slug: string }[]>([]);
    const [createdJobId, setCreatedJobId] = useState<string | null>(null);
    const [showInvitePanel, setShowInvitePanel] = useState(false);
    const [formData, setFormData] = useState({
        title: '',
        category: '',
        type: 'freelance', // freelance, full-time
        description: '',
        requirements: '',
        briefing: '',
        location: '',
        budget: '',
        budget_type: 'daily', // hourly, daily, project — postpago v1 = fixo por turno
        start_date: '',
        scope: 'on-site', // on-site, remote, hybrid
        work_start_time: '',
        work_end_time: '',
        has_lunch: false
    });

    const [predictedCandidates, setPredictedCandidates] = useState(12);

    // Hooks de equipe e convites — carregados após criação do job
    const { teamMembers, loading: teamLoading } = useCompanyTeam();
    const { invite, invitingWorkerId } = useCompanyInvites(createdJobId ?? '');

    useEffect(() => {
        // Fetch Categories
        async function loadCategories() {
            const { data } = await supabase.from('job_categories').select('name, slug');
            if (data && data.length > 0) {
                setCategories(data);
            } else {
                setCategories([
                    { name: 'Tecnologia', slug: 'tech' },
                    { name: 'Varejo', slug: 'retail' },
                    { name: 'Bares e Restaurantes', slug: 'hospitality' },
                    { name: 'Eventos', slug: 'events' },
                    { name: 'Construção Civil', slug: 'construction' },
                    { name: 'Logística', slug: 'logistics' },
                    { name: 'Saúde', slug: 'health' },
                    { name: 'Outro', slug: 'other' }
                ]);
            }
        }
        loadCategories();
    }, []);

    // Fetch Job Data if Editing
    useEffect(() => {
        if (isEditing) {
            fetchJobData();
        }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- fetchJobData usa state setters estaveis, so precisa re-executar quando id muda
    }, [id]);

    const fetchJobData = async () => {
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
            if (data) {
                setFormData({
                    title: data.title,
                    category: data.category,
                    type: data.type,
                    description: data.description,
                    requirements: data.requirements,
                    briefing: data.briefing || '',
                    location: data.location || '',
                    budget: data.budget?.toString() || '',
                    budget_type: data.budget_type,
                    start_date: data.start_date ? data.start_date.split('T')[0] : '',
                    scope: data.scope,
                    work_start_time: data.work_start_time || '',
                    work_end_time: data.work_end_time || '',
                    has_lunch: data.has_lunch || false
                });
            }
        } catch (error) {
            logError('Error fetching job:', error);
            navigate('/company/jobs');
        }
    };

    const calculateHours = (start: string, end: string, lunch: boolean = false) => {
        if (!start || !end) return { total: 0, work: 0 };
        const [startH, startM] = start.split(':').map(Number);
        const [endH, endM] = end.split(':').map(Number);

        let total = (endH + endM / 60) - (startH + startM / 60);
        if (total < 0) total += 24; // Handle overnight

        const work = lunch ? Math.max(0, total - 1) : total;
        return {
            total: total.toFixed(1).replace('.0', ''),
            work: work.toFixed(1).replace('.0', '')
        };
    };

    const updatePrediction = () => {
        setPredictedCandidates(prev => prev + Math.floor(Math.random() * 3));
    };

    const handleNext = () => setStep(step + 1);
    const handleBack = () => setStep(step - 1);

    const handleSubmit = async () => {
        setLoading(true);
        try {
            const { data: { user } } = await supabase.auth.getUser();
            if (!user) throw new Error("Usuário não autenticado");

            const budgetAmount = parseFloat(formData.budget) || 0;

            // Modelo postpago (Slice 1): sem reserva de escrow na criação — apenas inserir o job.
            // A cobrança acontece na conclusão do turno (Slice 2).
            if (!isEditing && budgetAmount <= 0) {
                addToast('Por favor, defina um valor para o turno.', 'error');
                setLoading(false);
                return;
            }

            const payload = {
                company_id: user.id,
                title: formData.title,
                category: formData.category,
                type: formData.type,
                description: formData.description,
                requirements: formData.requirements,
                briefing: formData.briefing,
                location: formData.location,
                budget: budgetAmount,
                budget_type: formData.budget_type,
                start_date: formData.start_date ? new Date(formData.start_date).toISOString() : null,
                scope: formData.scope,
                work_start_time: formData.work_start_time,
                work_end_time: formData.work_end_time,
                has_lunch: formData.has_lunch,
                status: 'open'
            };

            if (isEditing) {
                const { error } = await supabase.from('jobs').update(payload).eq('id', id);
                if (error) throw error;
                addToast('Vaga atualizada com sucesso!', 'success');
                navigate('/company/dashboard');
            } else {
                // Criar turno — SEM reservar escrow (postpago, Slice 2)
                const { data: newJob, error } = await supabase.from('jobs').insert(payload).select().single();
                if (error) throw error;

                addToast('Turno criado! Convide um freela da sua equipe.', 'success');
                setCreatedJobId(newJob.id);
                setShowInvitePanel(true);
            }
        } catch (error: unknown) {
            logError('Error saving job:', error);
            addToast(error instanceof Error ? error.message : 'Erro ao salvar vaga. Verifique os dados.', 'error');
        } finally {
            setLoading(false);
        }
    };

    return (
        <div className="max-w-3xl mx-auto animate-in fade-in slide-in-from-bottom-8 duration-500 pb-20">
            {/* Header */}
            <div className="mb-8 flex items-center justify-between">
                <div>
                    <button onClick={() => navigate(-1)} className="flex items-center gap-2 text-gray-400 font-bold hover:text-black transition-colors mb-2">
                        <ArrowLeft size={16} strokeWidth={3} /> Voltar
                    </button>
                    <h1 className="text-3xl font-black uppercase tracking-tighter">{isEditing ? 'Editar Vaga' : 'Criar Nova Vaga'}</h1>
                </div>
                {/* Progress Indicator */}
                <div className="flex items-center gap-2">
                    {[1, 2, 3].map((s) => (
                        <div key={s} className={`w-3 h-3 rounded-full border border-black transition-all ${step >= s ? 'bg-black' : 'bg-transparent'}`} aria-label={`Etapa ${s}${step >= s ? ' concluída' : ''}`} />
                    ))}
                </div>
            </div>

            <div className="flex gap-8">
                {/* Form Area */}
                <div className="flex-1 bg-white border-2 border-black rounded-2xl p-8 shadow-[8px_8px_0px_0px_rgba(0,0,0,0.1)]">

                    {/* Step 1: Basic Info */}
                    {step === 1 && (
                        <div className="space-y-6 animate-in fade-in slide-in-from-right-4">
                            <h2 className="text-xl font-black uppercase flex items-center gap-2">
                                <Briefcase size={20} /> Informações Básicas
                            </h2>

                            <div className="space-y-2">
                                <label className="text-xs font-bold uppercase tracking-wide">Título da Vaga</label>
                                <input
                                    type="text"
                                    aria-label="Título da Vaga"
                                    className="w-full bg-gray-50 border-2 border-transparent focus:border-black outline-none rounded-xl p-3 font-bold text-lg placeholder:text-gray-300 transition-all"
                                    placeholder="Ex: Designer UI Senior"
                                    value={formData.title}
                                    onChange={(e) => setFormData({ ...formData, title: e.target.value })}
                                />
                            </div>

                            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                                <div className="space-y-2">
                                    <label className="text-xs font-bold uppercase tracking-wide">Categoria</label>
                                    <select
                                        aria-label="Categoria"
                                        className="w-full bg-gray-50 border-2 border-transparent focus:border-black outline-none rounded-xl p-3 font-bold appearance-none"
                                        value={formData.category}
                                        onChange={(e) => setFormData({ ...formData, category: e.target.value })}
                                    >
                                        <option value="">Selecione...</option>
                                        {categories.map(cat => (
                                            <option key={cat.slug} value={cat.slug}>{cat.name}</option>
                                        ))}
                                    </select>
                                </div>
                                <div className="space-y-2">
                                    <label className="text-xs font-bold uppercase tracking-wide">Modelo</label>
                                    <div className="flex bg-gray-50 rounded-xl p-1 border-2 border-transparent">
                                        <button
                                            onClick={() => setFormData({ ...formData, type: 'freelance' })}
                                            className={`flex-1 py-2 rounded-lg text-xs font-black uppercase transition-all ${formData.type === 'freelance' ? 'bg-black text-white shadow-sm' : 'text-gray-400 hover:text-black'}`}
                                        >
                                            Freelance
                                        </button>
                                        <button
                                            onClick={() => setFormData({ ...formData, type: 'full-time' })}
                                            className={`flex-1 py-2 rounded-lg text-xs font-black uppercase transition-all ${formData.type === 'full-time' ? 'bg-black text-white shadow-sm' : 'text-gray-400 hover:text-black'}`}
                                        >
                                            Fixo
                                        </button>
                                    </div>
                                </div>
                            </div>

                            <div className="space-y-2">
                                <label className="text-xs font-bold uppercase tracking-wide">Formato de Trabalho</label>
                                <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                                    {[
                                        { id: 'on-site', label: 'Presencial', icon: MapPin },
                                        { id: 'remote', label: 'Remoto', icon: Globe },
                                        { id: 'hybrid', label: 'Híbrido', icon: Briefcase }
                                    ].map(sc => (
                                        <button
                                            key={sc.id}
                                            onClick={() => setFormData({ ...formData, scope: sc.id })}
                                            className={`flex flex-col items-center justify-center p-3 rounded-xl border-2 transition-all ${formData.scope === sc.id ? 'border-blue-600 bg-blue-50 text-blue-600' : 'border-gray-100 text-gray-400 hover:border-black'}`}
                                        >
                                            <sc.icon size={20} />
                                            <span className="text-[10px] font-black uppercase mt-1">{sc.label}</span>
                                        </button>
                                    ))}
                                </div>
                            </div>
                        </div>
                    )}

                    {/* Step 2: Details */}
                    {step === 2 && (
                        <div className="space-y-6 animate-in fade-in slide-in-from-right-4">
                            <h2 className="text-xl font-black uppercase flex items-center gap-2">
                                <Wand2 size={20} /> Detalhes & Requisitos
                            </h2>

                            <div className="space-y-2">
                                <label className="text-xs font-bold uppercase tracking-wide">Descrição Completa</label>
                                <textarea
                                    aria-label="Descrição Completa"
                                    className="w-full h-32 bg-gray-50 border-2 border-transparent focus:border-black outline-none rounded-xl p-3 font-medium text-sm placeholder:text-gray-300 transition-all resize-none"
                                    placeholder="Descreva o projeto, responsabilidades e objetivos..."
                                    value={formData.description}
                                    onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                                />
                            </div>

                            <div className="space-y-2">
                                <label className="text-xs font-bold uppercase tracking-wide">Requisitos</label>
                                <textarea
                                    aria-label="Requisitos"
                                    className="w-full h-24 bg-gray-50 border-2 border-transparent focus:border-black outline-none rounded-xl p-3 font-medium text-sm placeholder:text-gray-300 transition-all resize-none"
                                    placeholder="- React Native&#10;- TypeScript&#10;- Figma"
                                    value={formData.requirements}
                                    onChange={(e) => {
                                        setFormData({ ...formData, requirements: e.target.value });
                                        if (e.target.value.length % 10 === 0) updatePrediction();
                                    }}
                                />
                            </div>

                            <div className="space-y-2">
                                <label htmlFor="briefing" className="text-xs font-bold uppercase tracking-wide">Briefing do Turno</label>
                                <p className="text-xs text-gray-400 font-bold">Regras da casa, cardápio, procedimentos, dress code — o freela vê isso no convite.</p>
                                <textarea
                                    id="briefing"
                                    aria-label="Briefing do Turno"
                                    className="w-full h-28 bg-gray-50 border-2 border-transparent focus:border-black outline-none rounded-xl p-3 font-medium text-sm placeholder:text-gray-300 transition-all resize-none"
                                    placeholder="Ex: Uniforme preto obrigatório. Cardápio fixo do bar. Início pontual às 18h..."
                                    value={formData.briefing}
                                    onChange={(e) => setFormData({ ...formData, briefing: e.target.value })}
                                />
                            </div>
                        </div>
                    )}

                    {/* Step 3: Logistics */}
                    {step === 3 && (
                        <div className="space-y-6 animate-in fade-in slide-in-from-right-4">
                            <h2 className="text-xl font-black uppercase flex items-center gap-2">
                                <DollarSign size={20} /> Valor & Cronograma
                            </h2>

                            {/* Aviso postpago */}
                            {!isEditing && (
                                <div className="p-4 rounded-xl border-2 bg-blue-50 border-blue-200 flex items-start gap-3">
                                    <DollarSign size={20} className="text-blue-600 flex-shrink-0 mt-0.5" />
                                    <div>
                                        <span className="text-xs font-black uppercase text-blue-700 block mb-1">Pagamento postpago</span>
                                        <p className="text-xs text-blue-600 font-bold">Nenhum depósito antecipado. O freela é pago na conclusão do turno (Slice 2).</p>
                                    </div>
                                </div>
                            )}

                            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                                <div className="space-y-2">
                                    <label className="text-xs font-bold uppercase tracking-wide">Tipo de Pagamento</label>
                                    <select
                                        aria-label="Tipo de Pagamento"
                                        className="w-full bg-gray-50 border-2 border-transparent focus:border-black outline-none rounded-xl p-3 font-bold appearance-none"
                                        value={formData.budget_type}
                                        onChange={(e) => setFormData({ ...formData, budget_type: e.target.value })}
                                    >
                                        <option value="hourly">Por Hora</option>
                                        <option value="daily">Por Dia</option>
                                        <option value="project">Projeto Fixo</option>
                                    </select>
                                </div>
                                <div className="space-y-2">
                                    <label className="text-xs font-bold uppercase tracking-wide">Valor ({formData.budget_type === 'hourly' ? '/h' : formData.budget_type === 'daily' ? '/dia' : 'Total'})</label>
                                    <div className="relative">
                                        <span className="absolute left-4 top-3.5 font-black text-gray-400">R$</span>
                                        <input
                                            type="number"
                                            aria-label="Valor do orçamento"
                                            className={`w-full bg-gray-50 border-2 border-transparent focus:border-black outline-none rounded-xl py-3 pl-10 pr-4 font-bold text-lg placeholder:text-gray-300 transition-all ${isEditing ? 'opacity-50 cursor-not-allowed' : ''}`}
                                            placeholder="0,00"
                                            value={formData.budget}
                                            onChange={(e) => setFormData({ ...formData, budget: e.target.value })}
                                            disabled={isEditing}
                                        />
                                    </div>
                                    {isEditing && (
                                        <p className="text-xs text-orange-600 font-bold mt-1">
                                            O valor não pode ser alterado após a criação.
                                        </p>
                                    )}
                                </div>
                            </div>

                            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                                <div className="space-y-2">
                                    <label className="text-xs font-bold uppercase tracking-wide">Início</label>
                                    <div className="relative">
                                        <Calendar className="absolute left-3 top-3.5 text-gray-400" size={20} />
                                        <input
                                            type="date"
                                            aria-label="Data de início"
                                            className="w-full bg-gray-50 border-2 border-transparent focus:border-black outline-none rounded-xl py-3 pl-10 pr-4 font-bold transition-all"
                                            value={formData.start_date}
                                            onChange={(e) => setFormData({ ...formData, start_date: e.target.value })}
                                        />
                                    </div>
                                </div>
                            </div>

                            {/* Detailed Schedule */}
                            <div className="bg-gray-50 border-2 border-dashed border-gray-200 rounded-xl p-4 space-y-4">
                                <h3 className="text-sm font-black uppercase flex items-center gap-2 text-gray-500">
                                    <Clock size={16} /> Horário de Trabalho
                                </h3>
                                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                                    <div className="space-y-2">
                                        <label className="text-xs font-bold uppercase tracking-wide">Entrada</label>
                                        <input
                                            type="time"
                                            aria-label="Horário de entrada"
                                            className="w-full bg-white border-2 border-transparent focus:border-black outline-none rounded-xl p-3 font-bold transition-all"
                                            value={formData.work_start_time}
                                            onChange={(e) => setFormData({ ...formData, work_start_time: e.target.value })}
                                        />
                                    </div>
                                    <div className="space-y-2">
                                        <label className="text-xs font-bold uppercase tracking-wide">Saída</label>
                                        <input
                                            type="time"
                                            aria-label="Horário de saída"
                                            className="w-full bg-white border-2 border-transparent focus:border-black outline-none rounded-xl p-3 font-bold transition-all"
                                            value={formData.work_end_time}
                                            onChange={(e) => setFormData({ ...formData, work_end_time: e.target.value })}
                                        />
                                    </div>
                                </div>
                                <div className="flex items-center gap-2">
                                    <input
                                        type="checkbox"
                                        id="lunch"
                                        className="w-5 h-5 accent-black rounded"
                                        checked={formData.has_lunch}
                                        onChange={(e) => setFormData({ ...formData, has_lunch: e.target.checked })}
                                    />
                                    <label htmlFor="lunch" className="text-sm font-bold cursor-pointer select-none">
                                        Intervalo de Almoço (1h)
                                    </label>
                                </div>

                                {/* Calculation Display */}
                                {(formData.work_start_time && formData.work_end_time) && (
                                    <div className="bg-gray-200 rounded-lg p-3 text-xs font-bold uppercase text-gray-600 flex justify-between">
                                        <span>Total: {calculateHours(formData.work_start_time, formData.work_end_time).total}h</span>
                                        <span>Trabalho: {calculateHours(formData.work_start_time, formData.work_end_time, formData.has_lunch).work}h</span>
                                        <span className={formData.has_lunch ? 'text-black' : 'text-gray-400'}>Almoço: {formData.has_lunch ? '1h' : '0h'}</span>
                                    </div>
                                )}
                            </div>

                            <div className="space-y-2">
                                <label className="text-xs font-bold uppercase tracking-wide">Localização Específica</label>
                                <div className="relative">
                                    <MapPin className="absolute left-3 top-3.5 text-gray-400" size={20} />
                                    <input
                                        type="text"
                                        aria-label="Localização Específica"
                                        className="w-full bg-gray-50 border-2 border-transparent focus:border-black outline-none rounded-xl py-3 pl-10 pr-4 font-bold placeholder:text-gray-300 transition-all"
                                        placeholder="Ex: São Paulo, SP (ou deixe vazio se remoto)"
                                        value={formData.location}
                                        onChange={(e) => setFormData({ ...formData, location: e.target.value })}
                                    />
                                </div>
                            </div>
                        </div>
                    )}

                    {/* Navigation Buttons */}
                    <div className="mt-8 flex justify-between pt-6 border-t border-gray-100">
                        {step > 1 ? (
                            <button
                                onClick={handleBack}
                                className="px-6 py-3 rounded-xl border-2 border-black font-black uppercase hover:bg-gray-50 transition-colors"
                            >
                                Voltar
                            </button>
                        ) : <div></div>}

                        <button
                            onClick={step === 3 ? handleSubmit : handleNext}
                            disabled={loading}
                            className="bg-black text-white px-8 py-3 rounded-xl font-black uppercase flex items-center gap-2 hover:bg-primary hover:scale-[1.02] transition-all shadow-[4px_4px_0px_0px_rgba(0,0,0,0.2)] disabled:opacity-50"
                        >
                            {loading ? 'Salvando...' : step === 3 ? (isEditing ? 'Salvar Alterações' : 'Publicar Vaga') : 'Próximo'}
                            {!loading && step < 3 && <ChevronRight size={20} />}
                            {!loading && step === 3 && <Check size={20} />}
                        </button>
                    </div>

                </div>

                {/* Side Panel: Prediction */}
                <div className="hidden lg:block w-72 space-y-4">
                    <div className="bg-blue-600 text-white p-6 rounded-2xl border-2 border-black shadow-[6px_6px_0px_0px_rgba(0,0,0,1)] sticky top-8">
                        <div className="flex items-start justify-between mb-4">
                            <Zap className="fill-yellow-400 text-yellow-400" size={32} />
                            <span className="bg-black/20 text-xs font-bold px-2 py-1 rounded">PREVISÃO</span>
                        </div>
                        <h3 className="text-4xl font-black mb-1 leading-none">{predictedCandidates + (formData.title.length > 5 ? 5 : 0)}</h3>
                        <p className="text-blue-100 font-bold uppercase text-sm leading-tight mb-4">Candidatos Potenciais</p>
                        <p className="text-xs opacity-80 border-t border-white/20 pt-4">
                            Com base na sua descrição atual, prevemos um alto interesse.
                        </p>
                    </div>

                    <div className="text-xs text-gray-400 text-center px-4">
                        Dica: Detalhar os requisitos aumenta a qualidade dos candidatos em <span className="font-bold text-black">40%</span>.
                    </div>
                </div>
            </div>

            {/* Painel de convite pós-criação */}
            {showInvitePanel && createdJobId && (
                <div className="fixed inset-0 z-50 bg-black/50 backdrop-blur-sm flex items-center justify-center p-4 animate-in fade-in duration-200">
                    <div className="bg-white rounded-2xl border-2 border-black shadow-[8px_8px_0px_0px_rgba(0,0,0,1)] w-full max-w-md p-6">
                        <div className="flex items-center justify-between mb-6">
                            <h2 className="text-2xl font-black uppercase tracking-tight">Convidar Freela</h2>
                            <button
                                onClick={() => { setShowInvitePanel(false); navigate('/company/dashboard'); }}
                                aria-label="Fechar e ir para dashboard"
                                className="p-2 hover:bg-gray-100 rounded-xl transition-colors"
                            >
                                <X size={20} />
                            </button>
                        </div>

                        <p className="text-sm font-bold text-gray-600 mb-5">
                            Turno criado! Convide um freela da sua equipe para este turno.
                        </p>

                        {teamLoading && (
                            <div className="space-y-3 animate-pulse">
                                {[...Array(3)].map((_, i) => <div key={i} className="h-14 bg-gray-200 rounded-xl" />)}
                            </div>
                        )}

                        {!teamLoading && teamMembers.length === 0 && (
                            <div className="text-center py-8 border-2 border-dashed border-gray-200 rounded-2xl text-gray-400">
                                <Users size={32} className="mx-auto mb-2 opacity-30" />
                                <p className="font-bold text-sm">Sua equipe está vazia.</p>
                                <p className="text-xs mt-1">Adicione freelas em <strong>Minha Equipe</strong> primeiro.</p>
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
                                                onClick={() => invite(member.worker.id)}
                                                disabled={isInviting}
                                                className="bg-black hover:bg-primary text-white px-4 py-2 rounded-xl font-black uppercase text-xs flex items-center gap-1.5 transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex-shrink-0"
                                            >
                                                {isInviting ? <Loader2 className="animate-spin" size={14} /> : <Send size={14} />}
                                                {isInviting ? '...' : 'Convidar'}
                                            </button>
                                        </div>
                                    );
                                })}
                            </div>
                        )}

                        <button
                            onClick={() => { setShowInvitePanel(false); navigate('/company/dashboard'); }}
                            className="w-full mt-5 bg-gray-100 hover:bg-gray-200 text-gray-700 px-6 py-3 rounded-xl font-black uppercase text-sm transition-colors"
                        >
                            Convidar depois
                        </button>
                    </div>
                </div>
            )}
        </div>
    );
}
