import { BrandMark, BrandStripe } from '../../components/BrandMark';
import { useState, useEffect } from 'react';
import { flushSync } from 'react-dom';
import { focusFirstInvalid } from '../../lib/formErrors';
import { useNavigate } from 'react-router-dom';
import { supabase } from '../../lib/supabase';
import { leaveDevice } from '../../lib/leaveDevice';
import { ArrowRight, ArrowLeft } from 'lucide-react';
import { useToast } from '../../contexts/ToastContext';
import { WalletService } from '../../services/walletService';
import { validateCPF, validateCNPJ, formatCpfCnpj } from '../../lib/validation';
import PageMeta from '../../components/PageMeta';
import { ActionBar, Button, Field, PageHeader } from '../../components/ui';
import { logError } from '../../lib/logger'
import { checkSession } from '../../lib/authSession';
import ErroDeCarga from '../../components/ErroDeCarga';

type CampoEmpresa = 'name' | 'cnpj' | 'companyType' | 'industry' | 'city' | 'hiringGoal' | 'hiringVolume' | 'tos';

export default function CompanyOnboarding() {
    const navigate = useNavigate();
    const [loading, setLoading] = useState(false);
    const { addToast } = useToast();
    const [step, setStep] = useState(1);
    const [tentou, setTentou] = useState(false);
    const [userId, setUserId] = useState<string | null>(null);
    const [tosAccepted, setTosAccepted] = useState(false);
    const [saidaArmada, setSaidaArmada] = useState(false);
    const [erroSalvar, setErroSalvar] = useState(false);

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

    }, []);

    const [erroSessao, setErroSessao] = useState(false);
    const [tentativa, setTentativa] = useState(0);
    useEffect(() => {
        let active = true;
        void checkSession().then((session) => {
            if (!active) return;
            if (session.status === 'ok') setUserId(session.user.id);
            else if (session.status === 'signed_out') navigate('/login');
            else setErroSessao(true);
        });
        return () => { active = false; };
    }, [navigate, tentativa]);

    const documentoErro = (): string | undefined => {
        const doc = formData.cnpj.replace(/\D/g, '');
        if (!doc) return 'Informe o CNPJ ou o CPF.';
        if (doc.length === 11) return validateCPF(doc) ? undefined : 'CPF inválido. Verifique os dígitos e tente novamente.';
        if (doc.length === 14) return validateCNPJ(doc) ? undefined : 'CNPJ inválido. Verifique os dígitos e tente novamente.';
        return 'Informe um CPF (11 dígitos) ou CNPJ (14 dígitos) válido.';
    };

    const errosDoPasso = (): Partial<Record<CampoEmpresa, string>> => {
        const erros: Partial<Record<CampoEmpresa, string>> = {};
        if (step === 1) {
            if (!formData.name.trim()) erros.name = 'Informe o nome da empresa.';
            const doc = documentoErro();
            if (doc) erros.cnpj = doc;
            if (!formData.companyType) erros.companyType = 'Escolha o tipo de empresa.';
            if (!formData.industry) erros.industry = 'Escolha o setor.';
            if (!formData.city.trim()) erros.city = 'Informe a cidade.';
        } else {
            if (!formData.hiringGoal) erros.hiringGoal = 'Escolha como você monta seus turnos.';
            if (!formData.hiringVolume) erros.hiringVolume = 'Escolha a estimativa de turnos por mês.';
            if (!tosAccepted) erros.tos = 'Aceite os Termos de Uso para continuar.';
        }
        return erros;
    };

    const erros = tentou ? errosDoPasso() : {};

    const handleNext = async (e: React.FormEvent<HTMLFormElement>) => {
        e.preventDefault();
        if (loading) return;
        if (Object.keys(errosDoPasso()).length > 0) {
            const form = e.currentTarget;
            flushSync(() => setTentou(true));
            focusFirstInvalid(form);
            return;
        }
        setTentou(false);
        if (step < TOTAL_STEPS) {
            setStep(step + 1);
        } else {
            await handleSubmit();
        }
    };

    const handleSubmit = async () => {
        if (!userId) return;

        setLoading(true);
        setErroSalvar(false);
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
            setErroSalvar(true);
            addToast(err instanceof Error ? err.message : 'Erro ao salvar perfil. Tente novamente.', 'error');
        } finally {
            setLoading(false);
        }
    };

    const stepLabels = ['Dados', 'Objetivos'];
    const pendencias = (step === 1
        ? [
            !formData.name.trim() && 'o nome da empresa',
            !!documentoErro() && 'um CNPJ ou CPF válido',
            !formData.companyType && 'o tipo de empresa',
            !formData.industry && 'o setor',
            !formData.city.trim() && 'a cidade',
        ]
        : [
            !formData.hiringGoal && 'o objetivo',
            !formData.hiringVolume && 'o volume de contratação',
            !tosAccepted && 'o aceite dos Termos',
        ]
    ).filter(Boolean);

    return (
        <div className="min-h-screen bg-white sm:bg-canvas flex flex-col items-center px-4 pt-4 sm:py-10 font-sans">
            <PageMeta title="Criar Conta" />
            {/* Um acento de marca por tela: faixa azul de 4px + selo "W." */}
            <BrandStripe role="hire" className="fixed inset-x-0 top-0 z-10" />

            <div className="w-full max-w-2xl">
                <BrandMark role="hire" className="mb-4" />
                {erroSessao && (
                    <div className="mb-4">
                        <ErroDeCarga
                            onRetry={() => { setErroSessao(false); setTentativa((n) => n + 1); }}
                            mensagem="Sem conexão para verificar seu acesso. O que você digitou continua aqui."
                        />
                    </div>
                )}

                {/* Exit button */}
                <div className="flex justify-end mb-2">
                    <button
                        onClick={async () => {
                            if (!saidaArmada) { setSaidaArmada(true); setTimeout(() => setSaidaArmada(false), 4000); return; }
                            await leaveDevice();
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
                <div className="sm:rounded-2xl sm:border sm:border-gray-200 sm:bg-white sm:p-8">

                    <form onSubmit={handleNext} noValidate className="space-y-6">

                        {/* Step 1: Company Data */}
                        {step === 1 && (
                            <div className="space-y-5">
                                <h2 className="text-lg font-bold">Sobre a empresa</h2>

                                <div className="space-y-4">
                                    <Field label="Nome da empresa" error={erros.name}>
                                        <input
                                            type="text"
                                            required
                                            value={formData.name}
                                            onChange={e => setFormData({ ...formData, name: e.target.value })}
                                            name="organization"
                                            autoComplete="organization"
                                            aria-label="Nome da empresa"
                                            placeholder="Ex: Tech Solutions Ltda"
                                        />
                                    </Field>
                                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                        <Field label="CNPJ ou CPF" error={erros.cnpj}>
                                            <input
                                                type="text"
                                                required
                                                value={formData.cnpj}
                                                onChange={e => setFormData({ ...formData, cnpj: formatCpfCnpj(e.target.value) })}
                                                name="document"
                                                autoComplete="off"
                                                inputMode="numeric"
                                                aria-label="CNPJ ou CPF"
                                                placeholder="00.000.000/0001-00 ou 000.000.000-00"
                                            />
                                        </Field>
                                        <Field label="Tipo de empresa" error={erros.companyType}>
                                            <select
                                                required
                                                value={formData.companyType}
                                                onChange={e => setFormData({ ...formData, companyType: e.target.value })}
                                                name="companyType"
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
                                        <Field label="Setor" error={erros.industry}>
                                            <select
                                                required
                                                value={formData.industry}
                                                onChange={e => setFormData({ ...formData, industry: e.target.value })}
                                                name="industry"
                                                aria-label="Setor"
                                            >
                                                <option value="">Selecione...</option>
                                                {categories.map(cat => (
                                                    <option key={cat.slug} value={cat.name}>{cat.name}</option>
                                                ))}
                                            </select>
                                        </Field>
                                        <Field label="Cidade" error={erros.city}>
                                            <input
                                                type="text"
                                                required
                                                value={formData.city}
                                                onChange={e => setFormData({ ...formData, city: e.target.value })}
                                                name="city"
                                                autoComplete="address-level2"
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
                            <div className="space-y-5">
                                <h2 className="text-lg font-bold">Como você usa freelas</h2>

                                <div className="space-y-5">
                                    <fieldset>
                                        <legend className="text-sm font-bold mb-2">Como você monta seus turnos?</legend>
                                        <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                                            {['Turnos pontuais (eventos/picos)', 'Escala recorrente (mesma equipe)', 'Reforço de fim de semana', 'Cobertura de faltas'].map(opt => (
                                                <label key={opt} className={`border-ink rounded-xl min-h-11 px-4 py-3 cursor-pointer transition-colors flex items-center gap-3 text-sm font-semibold ${formData.hiringGoal === opt ? 'border-black bg-gray-100 text-black' : 'border-gray-300 hover:border-black text-gray-700'}`}>
                                                    <input
                                                        type="radio"
                                                        name="goal"
                                                        value={opt}
                                                        aria-invalid={erros.hiringGoal ? true : undefined}
                                                        aria-describedby={erros.hiringGoal ? 'goal-error' : undefined}
                                                        aria-label={opt}
                                                        checked={formData.hiringGoal === opt}
                                                        onChange={e => setFormData({ ...formData, hiringGoal: e.target.value })}
                                                        className="accent-black w-5 h-5"
                                                    />
                                                    {opt}
                                                </label>
                                            ))}
                                        </div>
                                        {erros.hiringGoal && <p id="goal-error" role="alert" className="mt-2 text-xs font-bold text-red-600">{erros.hiringGoal}</p>}
                                    </fieldset>

                                    <fieldset>
                                        <legend className="text-sm font-bold mb-2">Turnos por mês (estimativa)</legend>
                                        <div className="flex gap-2" data-invalid={erros.hiringVolume ? 'true' : undefined} tabIndex={-1}>
                                            {['1-5', '6-20', '20+'].map(opt => (
                                                <label key={opt} className={`min-w-0 flex-1 border-ink rounded-xl min-h-11 px-1 sm:px-3 py-3 cursor-pointer transition-colors flex flex-col items-center justify-center text-center focus-within:ring-2 focus-within:ring-black focus-within:ring-offset-2 ${formData.hiringVolume === opt ? 'border-black bg-black text-white' : 'border-gray-300 hover:border-black text-gray-700'}`}>
                                                    <input type="radio" name="volume" aria-invalid={erros.hiringVolume ? true : undefined} aria-describedby={erros.hiringVolume ? 'volume-error' : undefined} value={opt} aria-label={`${opt} turnos por mês`} checked={formData.hiringVolume === opt} onChange={e => setFormData({ ...formData, hiringVolume: e.target.value })} className="sr-only" />
                                                    <span className="text-lg font-bold">{opt}</span>
                                                    <span className="text-xs opacity-80">turnos</span>
                                                </label>
                                            ))}
                                        </div>
                                        {erros.hiringVolume && <p id="volume-error" role="alert" className="mt-2 text-xs font-bold text-red-600">{erros.hiringVolume}</p>}
                                    </fieldset>

                                    {/* Linha inteira clicável, 44px; os links da frase também têm 44px de altura. */}
                                    <div className="flex min-h-11 items-start gap-3">
                                        <input
                                            type="checkbox"
                                            id="tos"
                                            aria-invalid={erros.tos ? true : undefined}
                                            aria-describedby={erros.tos ? 'tos-error' : undefined}
                                            checked={tosAccepted}
                                            onChange={e => setTosAccepted(e.target.checked)}
                                            className="mt-3 h-5 w-5 flex-shrink-0 rounded border-ink border-black accent-primary"
                                        />
                                        <label htmlFor="tos" className="min-h-11 py-2.5 text-sm leading-6 text-gray-700">
                                            Li e aceito os{' '}
                                            <a href="/termos" target="_blank" rel="noopener noreferrer" className="text-primary-dark underline font-bold inline-flex min-h-11 items-center align-middle">Termos de Uso</a>
                                            {' '}e a{' '}
                                            <a href="/privacidade" target="_blank" rel="noopener noreferrer" className="text-primary-dark underline font-bold inline-flex min-h-11 items-center align-middle">Política de Privacidade</a>
                                        </label>
                                    </div>
                                    {erros.tos && <p id="tos-error" role="alert" className="mt-2 text-xs font-bold text-red-600">{erros.tos}</p>}
                                </div>
                            </div>
                        )}

                        {pendencias.length > 0 && (
                            <p
                                role="status"
                                aria-live="polite"
                                className="text-sm text-gray-700 bg-gray-50 border border-gray-200 rounded-xl p-3"
                            >
                                Falta: {pendencias.join(', ')}.
                            </p>
                        )}

                        {erroSalvar && (
                            <p role="alert" className="text-sm font-bold text-red-600">
                                Não foi possível salvar. O que você preencheu continua na tela: tente de novo.
                            </p>
                        )}

                        <ActionBar
                            secondary={step > 1 ? (
                                <Button variant="secondary" onClick={() => setStep(step - 1)} iconLeft={<ArrowLeft size={18} />}>
                                    Voltar
                                </Button>
                            ) : undefined}
                            primary={
                                <Button
                                    type="submit"
                                    variant="dark"
                                    loading={loading}
                                    data-copilot="empresa.cadastro.avancar"
                                    iconRight={<ArrowRight size={18} />}
                                    size="lg"
                                                                    >
                                    {step === TOTAL_STEPS ? 'Finalizar' : 'Próximo'}
                                </Button>
                            }
                        />

                    </form>
                </div>
            </div>
        </div>
    );
}
