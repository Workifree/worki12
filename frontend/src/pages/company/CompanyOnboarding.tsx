import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '../../lib/supabase';
import { ArrowRight, ArrowLeft } from 'lucide-react';
import { useToast } from '../../contexts/ToastContext';
import { WalletService } from '../../services/walletService';
import { validateCPF, validateCNPJ, formatCpfCnpj } from '../../lib/validation';
import PageMeta from '../../components/PageMeta';
import { Button, Card, Field, PageHeader } from '../../components/ui';
import { logError } from '../../lib/logger'

export default function CompanyOnboarding() {
    const navigate = useNavigate();
    const [loading, setLoading] = useState(false);
    const { addToast } = useToast();
    const [step, setStep] = useState(1);
    const [cnpjError, setCnpjError] = useState('');
    const [userId, setUserId] = useState<string | null>(null);
    const [tosAccepted, setTosAccepted] = useState(false);
    const [saidaArmada, setSaidaArmada] = useState(false);

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
        { label: 'Pessoa Física / Autônomo', value: 'INDIVIDUAL_PERSON' },
        { label: 'Limitada (LTDA)', value: 'LIMITED' },
        { label: 'Individual (EI)', value: 'INDIVIDUAL' },
        { label: 'Associação', value: 'ASSOCIATION' },
        { label: 'Outro', value: 'OTHER' },
    ];

    useEffect(() => {
        // Fetch Categories
        async function loadCategories() {
            const { data } = await supabase.from('job_categories').select('name, slug');
            if (data && data.length > 0) {
                setCategories(data);
            } else {
                setCategories([
                    { name: 'Bares e Restaurantes', slug: 'hospitality' },
                    { name: 'Cafeterias e Confeitarias', slug: 'cafes' },
                    { name: 'Buffets e Eventos', slug: 'events' },
                    { name: 'Hotéis e Pousadas', slug: 'hotels' },
                    { name: 'Casas Noturnas e Lounges', slug: 'nightlife' },
                    { name: 'Hamburguerias e Lanchonetes', slug: 'fastfood' },
                    { name: 'Padarias e Empórios', slug: 'bakeries' },
                    { name: 'Outro (Hospitality)', slug: 'other' }
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

    const canProceed = () => {
        switch (step) {
            case 1: {
                const cleanDoc = formData.cnpj.replace(/\D/g, '');
                return Boolean(
                    formData.name &&
                    (cleanDoc.length === 11 || cleanDoc.length === 14) &&
                    formData.companyType &&
                    formData.industry &&
                    formData.city
                );
            }
            case 2: return Boolean(formData.hiringGoal && formData.hiringVolume && tosAccepted);
            default: return true;
        }
    };

    const handleNext = async (e: React.FormEvent) => {
        e.preventDefault();
        if (step === 1) {
            const cleanDoc = formData.cnpj.replace(/\D/g, '');
            if (cleanDoc.length === 11) {
                if (!validateCPF(cleanDoc)) {
                    setCnpjError('CPF inválido. Verifique os dígitos e tente novamente.');
                    return;
                }
            } else if (cleanDoc.length === 14) {
                if (!validateCNPJ(cleanDoc)) {
                    setCnpjError('CNPJ inválido. Verifique os dígitos e tente novamente.');
                    return;
                }
            } else {
                setCnpjError('Informe um CPF (11 dígitos) ou CNPJ (14 dígitos) válido.');
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
    const pendenciasStep2 = [
        !formData.hiringGoal && 'o objetivo',
        !formData.hiringVolume && 'o volume de contratação',
        !tosAccepted && 'o aceite dos Termos',
    ].filter(Boolean);

    return (
        <div className="min-h-screen bg-[#F4F4F0] flex flex-col items-center justify-center px-4 py-6 sm:py-10 font-sans">
            <PageMeta title="Criar Conta" />

            <div className="w-full max-w-2xl">
                {/* Exit button */}
                <div className="flex justify-end mb-2">
                    <button
                        onClick={async () => {
                            if (!saidaArmada) { setSaidaArmada(true); setTimeout(() => setSaidaArmada(false), 4000); return; }
                            await supabase.auth.signOut();
                            window.location.href = '/';
                        }}
                        className={`min-h-11 px-2 -mx-2 inline-flex items-center justify-center text-sm font-semibold transition-colors gap-1 ${saidaArmada ? 'text-red-600' : 'text-gray-600 hover:text-black'}`}
                    >
                        <ArrowLeft size={14} /> {saidaArmada ? 'Sair descarta o cadastro — toque de novo' : 'Sair e voltar'}
                    </button>
                    <span role="status" aria-live="polite" className="sr-only">
                        {saidaArmada ? 'Toque de novo em sair para confirmar. O cadastro será descartado.' : ''}
                    </span>
                </div>

                <PageHeader
                    title="Primeiro acesso"
                    subtitle="Vamos configurar sua empresa para montar seu elenco e organizar os turnos."
                />

                {/* Progresso: uma linha de texto + barra segmentada (substitui os círculos numerados) */}
                <div className="mb-4">
                    <p className="text-xs text-gray-600 mb-2">
                        Passo {step} de {TOTAL_STEPS} · <span className="font-bold text-black">{stepLabels[step - 1]}</span>
                    </p>
                    <div className="flex gap-2" aria-hidden="true">
                        {Array.from({ length: TOTAL_STEPS }, (_, i) => i + 1).map((s) => (
                            <div key={s} className={`h-1.5 flex-1 rounded-full ${step >= s ? 'bg-black' : 'bg-gray-300'}`} />
                        ))}
                    </div>
                </div>

                {/* Form Card */}
                <Card padding="lg" className="shadow-[4px_4px_0px_0px_rgba(0,0,0,1)]">

                    <form onSubmit={handleNext} className="space-y-6">

                        {/* Step 1: Company Data */}
                        {step === 1 && (
                            <div className="space-y-5 animate-in slide-in-from-right duration-500">
                                <h2 className="text-lg font-bold">Sobre a empresa</h2>

                                <div className="space-y-4">
                                    <Field label="Nome da empresa" required>
                                        <input
                                            type="text"
                                            required
                                            value={formData.name}
                                            onChange={e => setFormData({ ...formData, name: e.target.value })}
                                            aria-label="Nome da empresa"
                                            placeholder="Ex: Tech Solutions Ltda"
                                        />
                                    </Field>
                                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                        <Field label="CNPJ ou CPF" required error={cnpjError || undefined}>
                                            <input
                                                type="text"
                                                required
                                                value={formData.cnpj}
                                                onChange={e => {
                                                    setFormData({ ...formData, cnpj: formatCpfCnpj(e.target.value) });
                                                    if (cnpjError) setCnpjError('');
                                                }}
                                                aria-label="CNPJ ou CPF"
                                                placeholder="00.000.000/0001-00 ou 000.000.000-00"
                                            />
                                        </Field>
                                        <Field label="Tipo de empresa" required>
                                            <select
                                                required
                                                value={formData.companyType}
                                                onChange={e => setFormData({ ...formData, companyType: e.target.value })}
                                                aria-label="Tipo de empresa"
                                            >
                                                <option value="">Selecione...</option>
                                                {companyTypes.map(ct => (
                                                    <option key={ct.value} value={ct.value}>{ct.label}</option>
                                                ))}
                                            </select>
                                        </Field>
                                    </div>
                                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                        <Field label="Setor" required>
                                            <select
                                                required
                                                value={formData.industry}
                                                onChange={e => setFormData({ ...formData, industry: e.target.value })}
                                                aria-label="Setor"
                                            >
                                                <option value="">Selecione...</option>
                                                {categories.map(cat => (
                                                    <option key={cat.slug} value={cat.name}>{cat.name}</option>
                                                ))}
                                            </select>
                                        </Field>
                                        <Field label="Cidade" required>
                                            <input
                                                type="text"
                                                required
                                                value={formData.city}
                                                onChange={e => setFormData({ ...formData, city: e.target.value })}
                                                aria-label="Cidade"
                                                placeholder="Ex: São Paulo"
                                            />
                                        </Field>
                                    </div>
                                </div>
                            </div>
                        )}

                        {/* Step 2: Goals */}
                        {step === 2 && (
                            <div className="space-y-5 animate-in slide-in-from-right duration-500">
                                <h2 className="text-lg font-bold">Como você usa freelas</h2>

                                <div className="space-y-5">
                                    <fieldset>
                                        <legend className="text-sm font-bold mb-2">Como você monta seus turnos?</legend>
                                        <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                                            {['Turnos pontuais (eventos/picos)', 'Escala recorrente (mesma equipe)', 'Reforço de fim de semana', 'Cobertura de faltas'].map(opt => (
                                                <label key={opt} className={`border-2 rounded-xl min-h-11 px-4 py-3 cursor-pointer transition-colors flex items-center gap-3 text-sm font-semibold ${formData.hiringGoal === opt ? 'border-black bg-gray-100 text-black' : 'border-gray-300 hover:border-black text-gray-700'}`}>
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
                                    </fieldset>

                                    <fieldset>
                                        <legend className="text-sm font-bold mb-2">Turnos por mês (estimativa)</legend>
                                        <div className="flex gap-2">
                                            {['1-5', '6-20', '20+'].map(opt => (
                                                <label key={opt} className={`flex-1 border-2 rounded-xl min-h-11 px-3 py-3 cursor-pointer transition-colors flex flex-col items-center justify-center text-center focus-within:ring-2 focus-within:ring-black focus-within:ring-offset-2 ${formData.hiringVolume === opt ? 'border-black bg-black text-white' : 'border-gray-300 hover:border-black text-gray-700'}`}>
                                                    <input type="radio" name="volume" value={opt} aria-label={`${opt} turnos por mês`} checked={formData.hiringVolume === opt} onChange={e => setFormData({ ...formData, hiringVolume: e.target.value })} className="sr-only" />
                                                    <span className="text-lg font-bold">{opt}</span>
                                                    <span className="text-[10px] uppercase tracking-wide opacity-70">Turnos</span>
                                                </label>
                                            ))}
                                        </div>
                                    </fieldset>

                                    <div className="flex items-start gap-3">
                                        <input
                                            type="checkbox"
                                            id="tos"
                                            checked={tosAccepted}
                                            onChange={e => setTosAccepted(e.target.checked)}
                                            className="w-5 h-5 border-2 border-black rounded accent-primary mt-0.5 flex-shrink-0"
                                        />
                                        <label htmlFor="tos" className="text-sm text-gray-700">
                                            Li e aceito os{' '}
                                            <a href="/termos" target="_blank" rel="noopener noreferrer" className="text-primary-dark underline font-bold inline-block py-2">Termos de Uso</a>
                                            {' '}e a{' '}
                                            <a href="/privacidade" target="_blank" rel="noopener noreferrer" className="text-primary-dark underline font-bold inline-block py-2">Política de Privacidade</a>
                                        </label>
                                    </div>
                                </div>
                            </div>
                        )}

                        {step === 2 && pendenciasStep2.length > 0 && (
                            <p
                                role="status"
                                aria-live="polite"
                                className="text-sm text-gray-700 bg-gray-50 border-2 border-gray-200 rounded-xl p-3"
                            >
                                Falta: {pendenciasStep2.join(', ')}.
                            </p>
                        )}

                        <div className="pt-5 flex justify-between items-center border-t-2 border-gray-100">
                            {step > 1 ? (
                                <Button
                                    variant="ghost"
                                    onClick={() => setStep(step - 1)}
                                    iconLeft={<ArrowLeft size={18} />}
                                >
                                    Voltar
                                </Button>
                            ) : (
                                <div />
                            )}

                            <Button
                                type="submit"
                                variant="dark"
                                size="lg"
                                loading={loading}
                                disabled={!canProceed()}
                                iconRight={<ArrowRight size={18} />}
                            >
                                {step === TOTAL_STEPS ? 'Finalizar' : 'Próximo'}
                            </Button>
                        </div>

                    </form>
                </Card>
            </div>
        </div>
    );
}
