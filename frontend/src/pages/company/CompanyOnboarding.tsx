import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '../../lib/supabase';
import { Loader2, ArrowRight, ArrowLeft, Building2, Briefcase, Target } from 'lucide-react';
import { useToast } from '../../contexts/ToastContext';
import { WalletService } from '../../services/walletService';
import { validateCNPJ } from '../../lib/validation';
import PageMeta from '../../components/PageMeta';
import { logError } from '../../lib/logger'

export default function CompanyOnboarding() {
    const navigate = useNavigate();
    const [loading, setLoading] = useState(false);
    const { addToast } = useToast();
    const [step, setStep] = useState(1);
    const [cnpjError, setCnpjError] = useState('');
    const [userId, setUserId] = useState<string | null>(null);
    const [tosAccepted, setTosAccepted] = useState(false);

    const TOTAL_STEPS = 2;

    // Form Data
    const [formData, setFormData] = useState({
        name: '',
        cnpj: '',
        companyType: '',
        industry: '',
        city: '',
        hiringGoal: '',
        hiringVolume: '',
    });

    const [categories, setCategories] = useState<{ name: string, slug: string }[]>([]);

    const companyTypes = [
        { label: 'MEI (Microempreendedor Individual)', value: 'MEI' },
        { label: 'Limitada (LTDA)', value: 'LIMITED' },
        { label: 'Individual (EI)', value: 'INDIVIDUAL' },
        { label: 'Associação', value: 'ASSOCIATION' },
    ];

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

        // Get current user
        supabase.auth.getUser().then(({ data }) => {
            if (data.user) {
                setUserId(data.user.id);
            } else {
                navigate('/login');
            }
        });
    }, [navigate]);

    // CNPJ mask
    const formatCnpj = (value: string) => {
        const digits = value.replace(/\D/g, '').slice(0, 14);
        return digits
            .replace(/(\d{2})(\d)/, '$1.$2')
            .replace(/(\d{3})(\d)/, '$1.$2')
            .replace(/(\d{3})(\d)/, '$1/$2')
            .replace(/(\d{4})(\d{1,2})$/, '$1-$2');
    };

    const canProceed = () => {
        switch (step) {
            case 1: return formData.name && formData.cnpj.replace(/\D/g, '').length === 14 && formData.companyType && formData.industry && formData.city;
            case 2: return formData.hiringGoal && formData.hiringVolume && tosAccepted;
            default: return true;
        }
    };

    const handleNext = async (e: React.FormEvent) => {
        e.preventDefault();
        if (step === 1) {
            if (!validateCNPJ(formData.cnpj)) {
                setCnpjError('CNPJ invalido. Verifique os digitos e tente novamente.');
                return;
            }
            setCnpjError('');
        }
        if (step < TOTAL_STEPS) {
            setStep(step + 1);
        } else {
            await handleSubmit();
        }
    };

    const handleSubmit = async () => {
        if (!userId) return;

        setLoading(true);
        try {
            const { error } = await supabase
                .from('companies')
                .upsert({
                    id: userId,
                    owner_id: userId,
                    name: formData.name,
                    cnpj: formData.cnpj.replace(/\D/g, ''),
                    company_type: formData.companyType,
                    industry: formData.industry,
                    city: formData.city,
                    size: formData.hiringVolume,
                    onboarding_completed: true,
                    accepted_tos: true,
                    tos_version: 'v1',
                    tos_accepted_at: new Date().toISOString()
                });

            if (error) throw error;

            // Create wallet for the company
            await WalletService.getOrCreateWallet(userId, 'company');

            // Full page reload to reset ProtectedRoute state after onboarding completion
            window.location.href = '/company/dashboard';
        } catch (err: unknown) {
            logError('Error saving company profile:', err);
            addToast(err instanceof Error ? err.message : 'Erro ao salvar perfil. Tente novamente.', 'error');
        } finally {
            setLoading(false);
        }
    };

    const stepLabels = ['Dados', 'Objetivos'];

    return (
        <div className="min-h-screen bg-[#F4F4F0] flex flex-col items-center justify-center p-6 font-sans">
            <PageMeta title="Criar Conta" />

            <div className="w-full max-w-2xl">
                {/* Exit button */}
                <div className="flex justify-end mb-4">
                    <button
                        onClick={async () => {
                            await supabase.auth.signOut();
                            window.location.href = '/';
                        }}
                        className="text-sm font-bold text-gray-400 hover:text-black transition-colors flex items-center gap-1"
                    >
                        <ArrowLeft size={14} /> Sair e voltar
                    </button>
                </div>

                {/* Header */}
                <div className="text-center mb-10">
                    <h1 className="text-4xl font-black uppercase tracking-tighter mb-2">Primeiro Acesso</h1>
                    <p className="text-gray-500 font-medium">Vamos configurar sua empresa para montar seu elenco e organizar os turnos.</p>
                </div>

                {/* Progress Bar */}
                <div className="flex items-center justify-center mb-12 gap-4">
                    {Array.from({ length: TOTAL_STEPS }, (_, i) => i + 1).map((s) => (
                        <div key={s} className="flex items-center gap-2">
                            <div className={`w-8 h-8 rounded-full flex items-center justify-center font-black border-2 ${step >= s ? 'bg-black text-white border-black' : 'bg-transparent border-gray-300'}`}>{s}</div>
                            <span className={`font-bold uppercase text-sm ${step >= s ? 'text-black' : 'text-gray-300'}`}>{stepLabels[s - 1]}</span>
                            {s < TOTAL_STEPS && <div className={`h-1 w-16 ${step > s ? 'bg-black' : 'bg-gray-300'}`} />}
                        </div>
                    ))}
                </div>

                {/* Form Card */}
                <div className="bg-white border-2 border-black rounded-2xl p-8 shadow-[8px_8px_0px_0px_rgba(0,0,0,1)] relative overflow-hidden">

                    <form onSubmit={handleNext} className="space-y-6 relative z-10">

                        {/* Step 1: Company Data */}
                        {step === 1 && (
                            <div className="space-y-6 animate-in slide-in-from-right duration-500">
                                <h2 className="text-2xl font-black uppercase flex items-center gap-2">
                                    <Building2 className="text-blue-600" /> Sobre a Empresa
                                </h2>

                                <div className="space-y-4">
                                    <div>
                                        <label className="block text-xs font-bold uppercase mb-1">Nome da Empresa *</label>
                                        <input
                                            type="text"
                                            required
                                            value={formData.name}
                                            onChange={e => setFormData({ ...formData, name: e.target.value })}
                                            aria-label="Nome da empresa"
                                            className="w-full bg-gray-50 border-2 border-transparent focus:border-black rounded-xl p-3 font-bold outline-none transition-all"
                                            placeholder="Ex: Tech Solutions Ltda"
                                        />
                                    </div>
                                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                        <div>
                                            <label className="block text-xs font-bold uppercase mb-1">CNPJ *</label>
                                            <input
                                                type="text"
                                                required
                                                value={formData.cnpj}
                                                onChange={e => setFormData({ ...formData, cnpj: formatCnpj(e.target.value) })}
                                                aria-label="CNPJ"
                                                className="w-full bg-gray-50 border-2 border-transparent focus:border-black rounded-xl p-3 font-bold outline-none transition-all"
                                                placeholder="00.000.000/0001-00"
                                            />
                                            {cnpjError && <p className="text-red-600 text-xs font-bold mt-1">{cnpjError}</p>}
                                        </div>
                                        <div>
                                            <label className="block text-xs font-bold uppercase mb-1">Tipo de Empresa *</label>
                                            <select
                                                required
                                                value={formData.companyType}
                                                onChange={e => setFormData({ ...formData, companyType: e.target.value })}
                                                aria-label="Tipo de empresa"
                                                className="w-full bg-gray-50 border-2 border-transparent focus:border-black rounded-xl p-3 font-bold outline-none transition-all"
                                            >
                                                <option value="">Selecione...</option>
                                                {companyTypes.map(ct => (
                                                    <option key={ct.value} value={ct.value}>{ct.label}</option>
                                                ))}
                                            </select>
                                        </div>
                                    </div>
                                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                        <div>
                                            <label className="block text-xs font-bold uppercase mb-1">Setor *</label>
                                            <select
                                                required
                                                value={formData.industry}
                                                onChange={e => setFormData({ ...formData, industry: e.target.value })}
                                                aria-label="Setor"
                                                className="w-full bg-gray-50 border-2 border-transparent focus:border-black rounded-xl p-3 font-bold outline-none transition-all"
                                            >
                                                <option value="">Selecione...</option>
                                                {categories.map(cat => (
                                                    <option key={cat.slug} value={cat.name}>{cat.name}</option>
                                                ))}
                                            </select>
                                        </div>
                                        <div>
                                            <label className="block text-xs font-bold uppercase mb-1">Cidade *</label>
                                            <input
                                                type="text"
                                                required
                                                value={formData.city}
                                                onChange={e => setFormData({ ...formData, city: e.target.value })}
                                                aria-label="Cidade"
                                                className="w-full bg-gray-50 border-2 border-transparent focus:border-black rounded-xl p-3 font-bold outline-none transition-all"
                                                placeholder="Ex: São Paulo"
                                            />
                                        </div>
                                    </div>
                                </div>
                            </div>
                        )}

                        {/* Step 2: Goals */}
                        {step === 2 && (
                            <div className="space-y-6 animate-in slide-in-from-right duration-500">
                                <h2 className="text-2xl font-black uppercase flex items-center gap-2">
                                    <Target className="text-green-600" /> Como você usa freelas
                                </h2>

                                <div className="space-y-6">
                                    <div>
                                        <label className="block text-xs font-bold uppercase mb-3">Como você monta seus turnos?</label>
                                        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                                            {['Turnos pontuais (eventos/picos)', 'Escala recorrente (mesma equipe)', 'Reforço de fim de semana', 'Cobertura de faltas'].map(opt => (
                                                <label key={opt} className={`border-2 rounded-xl p-4 cursor-pointer transition-all flex items-center gap-3 font-bold ${formData.hiringGoal === opt ? 'border-black bg-black/5' : 'border-gray-200 hover:border-black'}`}>
                                                    <input
                                                        type="radio"
                                                        name="goal"
                                                        value={opt}
                                                        aria-label={opt}
                                                        checked={formData.hiringGoal === opt}
                                                        onChange={e => setFormData({ ...formData, hiringGoal: e.target.value })}
                                                        className="accent-black w-5 h-5"
                                                    />
                                                    {opt}
                                                </label>
                                            ))}
                                        </div>
                                    </div>

                                    <div>
                                        <label className="block text-xs font-bold uppercase mb-3">Turnos por mês (estimativa)</label>
                                        <div className="flex gap-4">
                                            {['1-5', '6-20', '20+'].map(opt => (
                                                <label key={opt} className={`flex-1 border-2 rounded-xl p-4 cursor-pointer transition-all flex flex-col items-center justify-center font-bold text-center ${formData.hiringVolume === opt ? 'border-black bg-black text-white' : 'border-gray-200 hover:border-black'}`}>
                                                    <input type="radio" name="volume" value={opt} aria-label={`${opt} turnos por mês`} checked={formData.hiringVolume === opt} onChange={e => setFormData({ ...formData, hiringVolume: e.target.value })} className="hidden" />
                                                    <span className="text-lg">{opt}</span>
                                                    <span className="text-[10px] uppercase font-normal opacity-70">Turnos</span>
                                                </label>
                                            ))}
                                        </div>
                                    </div>

                                    <div className="flex items-start gap-3 mt-6">
                                        <input
                                            type="checkbox"
                                            id="tos"
                                            checked={tosAccepted}
                                            onChange={e => setTosAccepted(e.target.checked)}
                                            className="w-5 h-5 border-2 border-black rounded accent-primary mt-0.5 flex-shrink-0"
                                        />
                                        <label htmlFor="tos" className="text-sm text-gray-700">
                                            Li e aceito os{' '}
                                            <a href="/termos" target="_blank" rel="noopener noreferrer" className="text-primary underline font-bold">Termos de Uso</a>
                                            {' '}e a{' '}
                                            <a href="/privacidade" target="_blank" rel="noopener noreferrer" className="text-primary underline font-bold">Política de Privacidade</a>
                                        </label>
                                    </div>
                                </div>
                            </div>
                        )}

                        <div className="pt-6 flex justify-between items-center border-t-2 border-gray-100 mt-8">
                            {step > 1 ? (
                                <button
                                    type="button"
                                    onClick={() => setStep(step - 1)}
                                    className="font-bold flex items-center gap-1 text-gray-600 hover:text-black transition-colors"
                                >
                                    <ArrowLeft size={18} /> Voltar
                                </button>
                            ) : (
                                <div />
                            )}

                            <div className="flex flex-col items-end gap-1">
                                <button
                                    type="submit"
                                    disabled={loading || !canProceed()}
                                    className="bg-black text-white px-8 py-3 rounded-xl font-black uppercase flex items-center gap-2 hover:bg-primary hover:scale-105 transition-all disabled:opacity-50 disabled:cursor-not-allowed"
                                >
                                    {loading ? (
                                        <Loader2 className="animate-spin" />
                                    ) : (
                                        <>
                                            {step === TOTAL_STEPS ? 'Finalizar' : 'Próximo'} <ArrowRight size={20} />
                                        </>
                                    )}
                                </button>
                                {step === 2 && !canProceed() && (
                                    <p className="text-xs text-red-500 font-medium">Selecione o objetivo e o volume de contratacao</p>
                                )}
                            </div>
                        </div>

                    </form>

                    {/* Decorative Watermark */}
                    <Briefcase className="absolute -bottom-10 -right-10 text-gray-50 opacity-50 rotate-[-15deg]" size={200} />
                </div>
            </div>
        </div>
    );
}
