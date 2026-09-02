
import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '../../lib/supabase';
import { Loader2, ArrowRight, ArrowLeft, User, Briefcase, Star, Clock, Target } from 'lucide-react';
import { useToast } from '../../contexts/ToastContext';
import { WalletService } from '../../services/walletService';
import PageMeta from '../../components/PageMeta';
import { logError } from '../../lib/logger'
import { validateCPFOrCNPJ, EMAIL_REGEX, formatCpfCnpj, normalizePixKeyForStorage, type PixKeyType } from '../../lib/validation';

import type { AvailabilityDays, AvailabilityPeriod, AvailabilityWeekday } from '../../types';

/**
 * Converte os cinco chips rápidos do cadastro na grade dia×período do F7.
 *
 * Os chips e a grade eram DOIS conceitos com o mesmo nome ("Disponibilidade"): o cadastro gravava
 * só `workers.availability` (array de rótulos), que nenhuma tela de empresa lê e nenhuma RPC usa,
 * enquanto o casamento com chamados de turno depende de `workers.availability_days`. Agora a mesma
 * resposta alimenta as duas — o array continua para o histórico, a grade é o que vale.
 *
 * Regras, e por quê:
 *  - "Madrugada" vira `noite`. A grade do F7 só tem manhã/tarde/noite, e a convenção do produto
 *    (ver `periodOfDay` em `lib/availability.ts`) já dobra 00:00–04:59 em `noite`.
 *  - "Fim de Semana" é eixo de DIA, não de período: restringe a grade a domingo (0) e sábado (6).
 *  - Só "Fim de Semana", sem período: assume os três períodos nesses dois dias.
 *  - Nada marcado: devolve `null` — que é "não declarou", diferente de `{}` (LM-8 do DDL do F7:
 *    os dois não podem coexistir).
 */
function gradeAPartirDosChips(chips: string[]): AvailabilityDays | null {
    if (!chips || chips.length === 0) return null;

    const periodos: AvailabilityPeriod[] = [];
    if (chips.includes('Manhã')) periodos.push('manha');
    if (chips.includes('Tarde')) periodos.push('tarde');
    if (chips.includes('Noite') || chips.includes('Madrugada')) periodos.push('noite');

    const soFimDeSemana = chips.includes('Fim de Semana');
    const dias: AvailabilityWeekday[] = soFimDeSemana ? ['0', '6'] : ['0', '1', '2', '3', '4', '5', '6'];
    const periodosFinais: AvailabilityPeriod[] = periodos.length > 0 ? periodos : ['manha', 'tarde', 'noite'];

    const grade: AvailabilityDays = {};
    for (const dia of dias) grade[dia] = [...periodosFinais];
    return grade;
}

const PIX_KEY_LABELS: Record<PixKeyType, string> = {
    cpf: 'CPF',
    cnpj: 'CNPJ',
    email: 'E-mail',
    telefone: 'Telefone',
    aleatoria: 'Aleatória',
};

const PIX_KEY_PLACEHOLDERS: Record<PixKeyType, string> = {
    cpf: '000.000.000-00',
    cnpj: '00.000.000/0000-00',
    email: 'seuemail@exemplo.com',
    telefone: '(00) 00000-0000',
    aleatoria: 'xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx',
};

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default function WorkerOnboarding() {
    const navigate = useNavigate();
    const [loading, setLoading] = useState(false);
    // Sair descarta o formulario inteiro — primeiro toque arma o aviso, segundo executa (4s).
    const [saidaArmada, setSaidaArmada] = useState(false);
    const { addToast } = useToast();
    const [step, setStep] = useState(1);
    const [userId, setUserId] = useState<string | null>(null);
    const [tosAccepted, setTosAccepted] = useState(false);

    const TOTAL_STEPS = 3;

    // Form Data
    const [formData, setFormData] = useState({
        fullName: '',
        phone: '',
        city: '',
        cpf: '',
        birthDate: '',
        pixKeyType: 'cpf' as PixKeyType,
        pixKey: '',
        roles: [] as string[],
        experienceYears: '',
        bio: '',
        availability: [] as string[],
        goal: '',
    });

    const rolesList = [
        'Garçom', 'Atendente', 'Barista', 'Bartender', 'Cozinheiro',
        'Auxiliar de Cozinha', 'Cumim', 'Recepcionista', 'Caixa',
        'Copeiro', 'Limpeza / Steward', 'Segurança'
    ];

    const availabilityOptions = [
        'Manhã', 'Tarde', 'Noite', 'Madrugada', 'Fim de Semana'
    ];

    useEffect(() => {
        supabase.auth.getUser().then(({ data }) => {
            if (data.user) {
                setUserId(data.user.id);
                checkIfOnboardingComplete(data.user.id);
            } else {
                navigate('/login');
            }
        });
    // eslint-disable-next-line react-hooks/exhaustive-deps -- carrega dados iniciais apenas no mount, navigate estavel
    }, [navigate]);

    const checkIfOnboardingComplete = async (uid: string) => {
        const { data } = await supabase
            .from('workers')
            .select('onboarding_completed')
            .eq('id', uid)
            .single();

        if (data?.onboarding_completed) {
            navigate('/dashboard');
        }
    };

    const handleRoleToggle = (role: string) => {
        setFormData(prev => {
            const current = prev.roles;
            if (current.includes(role)) {
                return { ...prev, roles: current.filter(item => item !== role) };
            } else {
                return { ...prev, roles: [...current, role] };
            }
        });
    };

    const handleAvailabilityToggle = (option: string) => {
        setFormData(prev => {
            const current = prev.availability;
            if (current.includes(option)) {
                return { ...prev, availability: current.filter(item => item !== option) };
            } else {
                return { ...prev, availability: [...current, option] };
            }
        });
    };

    // CPF mask
    const formatCpf = (value: string) => {
        const digits = value.replace(/\D/g, '').slice(0, 11);
        return digits
            .replace(/(\d{3})(\d)/, '$1.$2')
            .replace(/(\d{3})(\d)/, '$1.$2')
            .replace(/(\d{3})(\d{1,2})$/, '$1-$2');
    };

    // Phone mask
    const formatPhone = (value: string) => {
        const digits = value.replace(/\D/g, '').slice(0, 11);
        if (digits.length <= 10) {
            return digits.replace(/(\d{2})(\d{4})(\d{0,4})/, '($1) $2-$3');
        }
        return digits.replace(/(\d{2})(\d{5})(\d{0,4})/, '($1) $2-$3');
    };

    // Formata a chave PIX conforme o tipo escolhido (reusa as mascaras ja existentes).
    const formatPixKey = (type: PixKeyType, value: string) => {
        if (type === 'cpf' || type === 'cnpj') return formatCpfCnpj(value);
        if (type === 'telefone') return formatPhone(value);
        return value;
    };

    // Valida a chave PIX conforme o tipo — reusa lib/validation (validateCPFOrCNPJ, EMAIL_REGEX),
    // sem reescrever validacao nova.
    const isValidPixKey = () => {
        const key = formData.pixKey.trim();
        if (!key) return false;
        switch (formData.pixKeyType) {
            case 'cpf':
                return key.replace(/\D/g, '').length === 11 && validateCPFOrCNPJ(key);
            case 'cnpj':
                return key.replace(/\D/g, '').length === 14 && validateCPFOrCNPJ(key);
            case 'email':
                return EMAIL_REGEX.test(key);
            case 'telefone':
                return key.replace(/\D/g, '').length >= 10;
            case 'aleatoria':
                return UUID_RE.test(key);
            default:
                return false;
        }
    };

    /**
     * O que ainda falta no passo atual, em português, na ordem em que aparece na tela.
     *
     * Antes, o botão simplesmente ficava `disabled` e a pessoa não tinha **como saber qual campo
     * estava faltando** — testando o cadastro no navegador em 22/08/2026 eu mesmo fiquei preso
     * nesse estado, com todos os campos visivelmente preenchidos e o botão morto (o que faltava
     * era o tipo da chave PIX, que o `<select>` exibia como "CPF" sem ter valor no estado).
     *
     * Esta lista é a FONTE ÚNICA: `canProceed()` deriva dela. Ter as duas regras separadas era o
     * risco real — a mensagem diria uma coisa e o botão obedeceria outra.
     */
    const camposFaltantes = (): string[] => {
        switch (step) {
            case 1: {
                const falta: string[] = [];
                if (!formData.fullName.trim()) falta.push('nome completo');
                if (formData.cpf.replace(/\D/g, '').length !== 11) falta.push('CPF (11 dígitos)');
                if (!formData.birthDate) falta.push('data de nascimento');
                if (!formData.phone.trim()) falta.push('celular');
                if (!formData.city.trim()) falta.push('cidade');
                if (!formData.pixKeyType) falta.push('tipo da chave PIX');
                else if (!isValidPixKey()) {
                    falta.push(formData.pixKey.trim()
                        ? `chave PIX válida para o tipo "${PIX_KEY_LABELS[formData.pixKeyType]}"`
                        : 'chave PIX');
                }
                return falta;
            }
            case 2: {
                const falta: string[] = [];
                if (formData.roles.length === 0) falta.push('ao menos uma especialidade');
                if (!formData.experienceYears) falta.push('tempo de experiência');
                return falta;
            }
            case 3: {
                const falta: string[] = [];
                if (formData.availability.length === 0) falta.push('ao menos um período de disponibilidade');
                if (!tosAccepted) falta.push('aceite dos Termos de Uso');
                return falta;
            }
            default: return [];
        }
    };

    const canProceed = () => camposFaltantes().length === 0;

    const handleNext = async (e: React.FormEvent) => {
        e.preventDefault();
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
                .from('workers')
                .upsert({
                    id: userId,
                    full_name: formData.fullName,
                    phone: formData.phone,
                    city: formData.city,
                    cpf: formData.cpf.replace(/\D/g, ''),
                    birth_date: formData.birthDate,
                    pix_key: normalizePixKeyForStorage(formData.pixKeyType, formData.pixKey),
                    roles: formData.roles,
                    // A empresa NUNCA vê `roles`. Todas as telas dela — cartão do Elenco
                    // (MemberCard/PendingCard), ShiftCallModal, InviteSeriesModal,
                    // CompanyCreateJob, CompanyJobCandidates, CompanyDashboard — exibem
                    // `primary_role`, e até 22/08/2026 o onboarding não o gravava: só a página de
                    // Perfil escrevia. Efeito medido em produção nesse dia: 11 dos 16 freelas
                    // tinham declarado a especialidade aqui e apareciam SEM FUNÇÃO para a empresa,
                    // inclusive sumindo da busca por função do ShiftCallModal (que filtra por
                    // `primary_role`). A pergunta "QUAIS SUAS ESPECIALIDADES?" era coletada e
                    // jogada fora.
                    // A primeira especialidade marcada vira a principal; o freela troca depois no
                    // Perfil, que continua sendo o único lugar de edição.
                    primary_role: formData.roles[0] ?? null,
                    experience_years: formData.experienceYears,
                    bio: formData.bio,
                    availability: formData.availability,
                    // A MESMA resposta também preenche a grade do F7 (`availability_days`).
                    //
                    // Antes eram dois conceitos com o mesmo nome: o cadastro perguntava
                    // "DISPONIBILIDADE" e gravava só este array — que NENHUMA tela de empresa lê e
                    // NENHUMA RPC usa. Quem casa o freela com um chamado de turno é
                    // `availability_days`, preenchida apenas no Perfil. Resultado testado no
                    // navegador em 22/08/2026: a pessoa declarava disponibilidade no cadastro e
                    // caía no dashboard lendo "Declare sua disponibilidade" — como se o que ela
                    // acabara de responder não valesse. E, do lado da empresa, não valia mesmo.
                    //
                    // Em vez de encher o cadastro com a grade de 21 botões (fricção no pior
                    // momento), os cinco chips ALIMENTAM a grade. O freela refina depois no Perfil,
                    // que continua sendo o lugar de edição fina.
                    availability_days: gradeAPartirDosChips(formData.availability),
                    goal: formData.goal,
                    onboarding_completed: true,
                    accepted_tos: true,
                    tos_version: 'v1',
                    tos_accepted_at: new Date().toISOString()
                });

            if (error) throw error;

            // Create wallet for the worker
            await WalletService.getOrCreateWallet(userId, 'worker');

            // Full page reload to reset ProtectedRoute state after onboarding completion
            window.location.href = '/dashboard';
        } catch (err: unknown) {
            logError('Error saving worker profile:', err);
            addToast(err instanceof Error ? err.message : 'Erro ao salvar perfil. Tente novamente.', 'error');
        } finally {
            setLoading(false);
        }
    };

    const stepLabels = ['Dados', 'Profissão', 'Objetivos'];

    return (
        <div className="min-h-screen bg-[#F4F4F0] flex flex-col items-center justify-center p-6 font-sans text-accent">
            <PageMeta title="Criar Conta" />

            <div className="w-full max-w-2xl">
                {/* Exit button */}
                <div className="flex justify-end mb-4">
                    <button
                        onClick={async () => {
                            if (!saidaArmada) {
                                setSaidaArmada(true);
                                setTimeout(() => setSaidaArmada(false), 4000);
                                return;
                            }
                            await supabase.auth.signOut();
                            window.location.href = '/';
                        }}
                        className={`min-h-11 px-2 -mx-2 inline-flex items-center justify-center text-sm font-bold transition-colors gap-1 ${
                            saidaArmada ? 'text-red-600' : 'text-gray-400 hover:text-black'
                        }`}
                    >
                        <ArrowLeft size={14} /> {saidaArmada ? 'O que você digitou será perdido — toque de novo' : 'Sair e voltar'}
                    </button>
                </div>

                {/* Header */}
                <div className="text-center mb-10">
                    <h1 className="text-4xl font-black uppercase tracking-tighter mb-2">Bem-vindo ao Worki</h1>
                    <p className="text-gray-500 font-medium">Vamos criar seu perfil pra empresas te chamarem pros turnos.</p>
                </div>

                {/* Progress Bar */}
                <div className="flex items-center justify-center mb-12 gap-2">
                    {Array.from({ length: TOTAL_STEPS }, (_, i) => i + 1).map((s) => (
                        <div key={s} className="flex items-center gap-1">
                            <div className={`
                                w-8 h-8 rounded-full flex items-center justify-center font-black border-2 transition-colors text-sm
                                ${step >= s ? 'bg-black text-white border-black' : 'bg-transparent text-gray-300 border-gray-300'}
                            `}>
                                {s}
                            </div>
                            <span className={`font-bold uppercase text-[10px] hidden md:inline ${step >= s ? 'text-black' : 'text-gray-300'}`}>
                                {stepLabels[s - 1]}
                            </span>
                            {s < TOTAL_STEPS && <div className={`h-0.5 w-4 md:w-6 ${step > s ? 'bg-black' : 'bg-gray-300'}`} />}
                        </div>
                    ))}
                </div>

                {/* Form Card */}
                <div className="bg-white border-2 border-black rounded-2xl p-8 shadow-[8px_8px_0px_0px_rgba(0,166,81,1)] relative overflow-hidden">

                    <form onSubmit={handleNext} className="space-y-6 relative z-10">

                        {/* Step 1: Personal Data */}
                        {step === 1 && (
                            <div className="space-y-6 animate-in slide-in-from-right duration-500">
                                <h2 className="text-2xl font-black uppercase flex items-center gap-2">
                                    <User className="text-primary" /> Quem é você?
                                </h2>

                                <div className="space-y-4">
                                    <div>
                                        <label className="block text-xs font-bold uppercase mb-1">Nome Completo *</label>
                                        <input
                                            type="text"
                                            required
                                            value={formData.fullName}
                                            onChange={e => setFormData({ ...formData, fullName: e.target.value })}
                                            aria-label="Nome completo"
                                            className="w-full bg-gray-50 border-2 border-transparent focus:border-black rounded-xl p-3 font-bold outline-none transition-all"
                                            placeholder="Seu nome completo"
                                        />
                                    </div>
                                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                        <div>
                                            <label className="block text-xs font-bold uppercase mb-1">CPF *</label>
                                            <input
                                                type="text"
                                                required
                                                value={formData.cpf}
                                                onChange={e => setFormData({ ...formData, cpf: formatCpf(e.target.value) })}
                                                aria-label="CPF"
                                                className="w-full bg-gray-50 border-2 border-transparent focus:border-black rounded-xl p-3 font-bold outline-none transition-all"
                                                placeholder="000.000.000-00"
                                            />
                                        </div>
                                        <div>
                                            <label className="block text-xs font-bold uppercase mb-1">Data de Nascimento *</label>
                                            <input
                                                type="date"
                                                required
                                                value={formData.birthDate}
                                                onChange={e => setFormData({ ...formData, birthDate: e.target.value })}
                                                aria-label="Data de nascimento"
                                                className="w-full bg-gray-50 border-2 border-transparent focus:border-black rounded-xl p-3 font-bold outline-none transition-all"
                                            />
                                        </div>
                                    </div>
                                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                        <div>
                                            <label className="block text-xs font-bold uppercase mb-1">Celular / WhatsApp *</label>
                                            <input
                                                type="tel"
                                                required
                                                value={formData.phone}
                                                onChange={e => setFormData({ ...formData, phone: formatPhone(e.target.value) })}
                                                aria-label="Celular ou WhatsApp"
                                                className="w-full bg-gray-50 border-2 border-transparent focus:border-black rounded-xl p-3 font-bold outline-none transition-all"
                                                placeholder="(00) 00000-0000"
                                            />
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
                                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                        <div>
                                            <label className="block text-xs font-bold uppercase mb-1">Tipo de Chave PIX *</label>
                                            <select
                                                required
                                                value={formData.pixKeyType}
                                                onChange={e => setFormData({ ...formData, pixKeyType: e.target.value as PixKeyType, pixKey: '' })}
                                                aria-label="Tipo de chave PIX"
                                                className="w-full bg-gray-50 border-2 border-transparent focus:border-black rounded-xl p-3 font-bold outline-none transition-all"
                                            >
                                                {(Object.keys(PIX_KEY_LABELS) as PixKeyType[]).map(type => (
                                                    <option key={type} value={type}>{PIX_KEY_LABELS[type]}</option>
                                                ))}
                                            </select>
                                        </div>
                                        <div>
                                            <label className="block text-xs font-bold uppercase mb-1">Chave PIX *</label>
                                            <input
                                                type="text"
                                                required
                                                value={formData.pixKey}
                                                onChange={e => setFormData({ ...formData, pixKey: formatPixKey(formData.pixKeyType, e.target.value) })}
                                                aria-label="Chave PIX"
                                                className="w-full bg-gray-50 border-2 border-transparent focus:border-black rounded-xl p-3 font-bold outline-none transition-all"
                                                placeholder={PIX_KEY_PLACEHOLDERS[formData.pixKeyType]}
                                            />
                                        </div>
                                    </div>
                                    <p className="text-xs text-gray-500">
                                        É assim que a empresa vai te pagar por fora do Worki (PIX). Escolha o tipo e informe a chave correspondente.
                                    </p>
                                </div>
                            </div>
                        )}

                        {/* Step 2: Professional */}
                        {step === 2 && (
                            <div className="space-y-6 animate-in slide-in-from-right duration-500">
                                <h2 className="text-2xl font-black uppercase flex items-center gap-2">
                                    <Briefcase className="text-blue-500" /> Profissão
                                </h2>

                                <div className="space-y-4">
                                    <div>
                                        <label className="block text-xs font-bold uppercase mb-2">Quais suas especialidades? *</label>
                                        <div className="grid grid-cols-2 md:grid-cols-3 gap-2">
                                            {rolesList.map(role => (
                                                <button
                                                    key={role}
                                                    type="button"
                                                    onClick={() => handleRoleToggle(role)}
                                                    className={`
                                                        p-3 rounded-xl border-2 font-bold text-sm text-center transition-all
                                                        ${formData.roles.includes(role)
                                                            ? 'bg-black text-white border-black'
                                                            : 'bg-white border-gray-200 hover:border-black text-gray-600'}
                                                    `}
                                                >
                                                    {role}
                                                </button>
                                            ))}
                                        </div>
                                    </div>

                                    <div>
                                        <label className="block text-xs font-bold uppercase mb-1">Tempo de Experiência *</label>
                                        <select
                                            required
                                            value={formData.experienceYears}
                                            onChange={e => setFormData({ ...formData, experienceYears: e.target.value })}
                                            aria-label="Tempo de experiencia"
                                            className="w-full bg-gray-50 border-2 border-transparent focus:border-black rounded-xl p-3 font-bold outline-none transition-all"
                                        >
                                            <option value="">Selecione...</option>
                                            <option value="Sem experiência">Sem experiência (Estou começando)</option>
                                            <option value="1-2 anos">1 a 2 anos</option>
                                            <option value="3-5 anos">3 a 5 anos</option>
                                            <option value="+5 anos">+5 anos (Expert)</option>
                                        </select>
                                    </div>

                                    <div>
                                        <label className="block text-xs font-bold uppercase mb-1">Bio Curta (Opcional)</label>
                                        <textarea
                                            value={formData.bio}
                                            onChange={e => setFormData({ ...formData, bio: e.target.value })}
                                            aria-label="Bio curta"
                                            className="w-full bg-gray-50 border-2 border-transparent focus:border-black rounded-xl p-3 font-bold outline-none transition-all resize-none h-20"
                                            placeholder="Conte um pouco sobre você..."
                                        />
                                    </div>
                                </div>
                            </div>
                        )}

                        {/* Step 3: Goals & Availability */}
                        {step === 3 && (
                            <div className="space-y-6 animate-in slide-in-from-right duration-500">
                                <h2 className="text-2xl font-black uppercase flex items-center gap-2">
                                    <Target className="text-red-500" /> Objetivos
                                </h2>

                                <div className="space-y-6">
                                    <div>
                                        <label className="block text-xs font-bold uppercase mb-3">O que você procura como freela?</label>
                                        <div className="grid grid-cols-1 gap-3">
                                            {['Renda extra com quem já confio', 'Mais turnos / mais trabalho', 'Construir minha reputação e histórico'].map(opt => (
                                                <label key={opt} className={`border-2 rounded-xl p-4 cursor-pointer transition-all flex items-center gap-3 font-bold ${formData.goal === opt ? 'border-primary bg-primary/5 text-primary' : 'border-gray-200 hover:border-black'}`}>
                                                    <input
                                                        type="radio"
                                                        name="goal"
                                                        value={opt}
                                                        aria-label={opt}
                                                        checked={formData.goal === opt}
                                                        onChange={e => setFormData({ ...formData, goal: e.target.value })}
                                                        className="accent-black w-5 h-5"
                                                    />
                                                    {opt}
                                                </label>
                                            ))}
                                        </div>
                                    </div>

                                    <div>
                                        <label className="block text-xs font-bold uppercase mb-3 flex items-center gap-2">
                                            <Clock size={16} /> Disponibilidade
                                        </label>
                                        <div className="flex flex-wrap gap-2">
                                            {availabilityOptions.map(opt => (
                                                <button
                                                    key={opt}
                                                    type="button"
                                                    onClick={() => handleAvailabilityToggle(opt)}
                                                    className={`
                                                        min-h-11 px-4 py-2 rounded-full border-2 font-bold text-sm transition-all
                                                        ${formData.availability.includes(opt)
                                                            ? 'bg-black text-white border-black'
                                                            : 'bg-white border-gray-200 hover:border-black text-gray-500'}
                                                    `}
                                                >
                                                    {opt}
                                                </button>
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
                                            <a href="/termos" target="_blank" rel="noopener noreferrer" className="text-primary underline font-bold inline-block py-2">Termos de Uso</a>
                                            {' '}e a{' '}
                                            <a href="/privacidade" target="_blank" rel="noopener noreferrer" className="text-primary underline font-bold inline-block py-2">Política de Privacidade</a>
                                        </label>
                                    </div>
                                </div>
                            </div>
                        )}

                        {/* Diz o que falta, em vez de deixar o botão morto sem explicação. Só
                            aparece quando há pendência — não polui quem preencheu tudo. */}
                        {camposFaltantes().length > 0 && (
                            <p
                                role="status"
                                aria-live="polite"
                                className="mt-6 text-sm font-bold text-gray-500 bg-gray-50 border-2 border-gray-200 rounded-xl p-3"
                            >
                                Falta preencher: {camposFaltantes().join(', ')}.
                            </p>
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
                                <div /> /* Spacer */
                            )}

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
                        </div>

                    </form>

                    {/* Decorative Watermark */}
                    <Star className="absolute -bottom-10 -right-10 text-gray-50 opacity-50 rotate-[-15deg]" size={200} />
                </div>
            </div>
        </div>
    );
}
