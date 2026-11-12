import { useState, useEffect, useRef, useCallback } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Building2, MapPin, Globe, Mail, Save, Camera, Loader2, Star, Pencil, Lock, LogOut, Link2, Copy, Check, ClipboardList, Settings, ShieldAlert, Share2, Network, HelpCircle, ChevronRight } from 'lucide-react';
import { supabase } from '../../lib/supabase';
import { useAuth } from '../../contexts/AuthContext';
import { useToast } from '../../contexts/ToastContext';
import { getPasswordStrength } from '../../lib/validation';
import { logError } from '../../lib/logger';
import { TeamConnectionService } from '../../services/teamConnectionService';
import { getMyCompanies, pickCurrentCompany, canSeeOrganization } from '../../services/companyScopeService';
import ProfileReviews from '../../components/ProfileReviews';
import { DEFAULT_LINK_RISK_THRESHOLD } from '../../components/company/seriesWeekRisk';
import { Button, Card, Field, FIELD_CONTROL_CLASS, PageHeader } from '../../components/ui';

/** Linha de leitura (modo visualização): rótulo discreto + valor. */
function ReadField({ label, children }: { label: string; children: React.ReactNode }) {
    return (
        <div>
            <p className="text-xs font-semibold text-gray-600 mb-1">{label}</p>
            {children}
        </div>
    );
}

interface Company {
    name: string;
    industry: string;
    description: string;
    website: string;
    email: string;
    address: string;
    default_briefing?: string;
    logo_url?: string;
    cover_url?: string;
    rating_average?: number;
    reviews_count?: number;
    /** F5 (guarda de vínculo) — LM-6: `undefined` (coluna ainda não migrada / não veio no select)
     *  NÃO é `false`. Ler sempre via `!== false`, nunca `if (company.link_risk_alert_enabled)`. */
    link_risk_alert_enabled?: boolean;
    link_risk_alert_threshold?: number;
    [key: string]: string | number | boolean | null | undefined;
}

export default function CompanyProfile() {
    const navigate = useNavigate();
    const { signOut } = useAuth();
    const { addToast } = useToast();
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);
    const [isEditing, setIsEditing] = useState(false);
    const [companyId, setCompanyId] = useState<string | null>(null);
    // R16: mesma regra do Sidebar (canSeeOrganization) — só sócio/operador vê Organização.
    const [showOrganizationShortcut, setShowOrganizationShortcut] = useState(false);
    const [deleteModalOpen, setDeleteModalOpen] = useState(false);
    const [deleteConfirmText, setDeleteConfirmText] = useState('');
    const [deleting, setDeleting] = useState(false);
    const [loggingOut, setLoggingOut] = useState(false);
    // "Meu link de perfil" — a EMPRESA compartilha o PRÓPRIO link (nunca o do
    // freela) para ser encontrada/adicionada por quem abrir (InviteAccept →
    // addToTeamByToken). Espelha o "meu link" do worker em Profile.tsx.
    const [linkCopied, setLinkCopied] = useState(false);
    // Seções sensíveis (Segurança, Sessão, Zona de Perigo) ficam ocultas por padrão
    const [showAccountSettings, setShowAccountSettings] = useState(false);
    const [company, setCompany] = useState<Company>({
        name: '',
        industry: '',
        description: '',
        website: '',
        email: '',
        address: '',
    });

    // Track initial company data for dirty detection
    const initialCompanyRef = useRef<Company>({
        name: '',
        industry: '',
        description: '',
        website: '',
        email: '',
        address: '',
    });

    const editableFields = [
        'name', 'industry', 'description', 'website', 'email', 'address', 'default_briefing',
        'link_risk_alert_enabled', 'link_risk_alert_threshold',
    ] as const;
    const isDirty = isEditing && editableFields.some(
        field => (company[field] || '') !== (initialCompanyRef.current[field] || '')
    );

    // Warn user about unsaved changes before leaving
    const handleBeforeUnload = useCallback((e: BeforeUnloadEvent) => {
        e.preventDefault();
    }, []);

    useEffect(() => {
        if (isDirty) {
            window.addEventListener('beforeunload', handleBeforeUnload);
        }
        return () => {
            window.removeEventListener('beforeunload', handleBeforeUnload);
        };
    }, [isDirty, handleBeforeUnload]);

    useEffect(() => {
        const getProfile = async () => {
            try {
                const { data: { user } } = await supabase.auth.getUser();
                if (!user) return;

                // F13 (R12) — `get_my_companies()` é o único resolvedor de escopo de empresa:
                // um gerente (`company_members` ativo) não tem linha própria em `companies`
                // (`id = user.id` nunca casa), então esta tela ficava em branco/erro para ele.
                // Resolve a unidade CORRENTE (respeita o seletor, R13) e usa o `company_id`
                // dela — nunca mais `user.id` — para ler/editar/upload/link/reviews.
                const companies = await getMyCompanies();
                const current = pickCurrentCompany(companies);
                if (!current) {
                    addToast('Perfil de empresa não encontrado.', 'error');
                    return;
                }
                setCompanyId(current.company_id);
                setShowOrganizationShortcut(canSeeOrganization(current));

                const { data } = await supabase
                    .from('companies')
                    .select('*')
                    .eq('id', current.company_id)
                    .single();

                if (data) {
                    setCompany(data);
                    initialCompanyRef.current = { ...data };
                }
            } catch (error: unknown) {
                logError('Error loading profile:', error);
                addToast('Erro ao carregar perfil.', 'error');
            } finally {
                setLoading(false);
            }
        };

        getProfile();
    }, [addToast]);

    const handleSave = async () => {
        if (!companyId) return;
        setSaving(true);
        try {
            const basePayload = {
                name: company.name,
                industry: company.industry,
                description: company.description,
                website: company.website,
                email: company.email,
                address: company.address,
            };

            // F5 (guarda de vínculo): CHECK real mora no banco (1..7) — este clamp é só UX,
            // nunca a validação de verdade.
            const clampedThreshold = Math.min(
                7,
                Math.max(1, Math.round(company.link_risk_alert_threshold ?? DEFAULT_LINK_RISK_THRESHOLD)),
            );
            const riskPayload = {
                link_risk_alert_enabled: company.link_risk_alert_enabled !== false,
                link_risk_alert_threshold: clampedThreshold,
            };

            // Tenta salvar com o briefing padrão + a config da guarda de vínculo (F5); se
            // alguma dessas colunas ainda não foi migrada no banco, refaz em camadas cada vez
            // mais "básicas" (deploy do frontend nunca quebra a edição do perfil INTEIRO —
            // LM-5: um deploy adiantado da guarda de vínculo não pode derrubar logo/capa/endereço).
            // .select('id') obrigatório (patterns.md — UPDATE sob RLS negado em silêncio).
            let { data, error } = await supabase
                .from('companies')
                .update({ ...basePayload, default_briefing: company.default_briefing, ...riskPayload })
                .eq('id', companyId)
                .select('id');

            if (error && /link_risk_alert_(enabled|threshold)/i.test(error.message || '')) {
                ({ data, error } = await supabase
                    .from('companies')
                    .update({ ...basePayload, default_briefing: company.default_briefing })
                    .eq('id', companyId)
                    .select('id'));
            }

            if (error && /default_briefing/i.test(error.message || '')) {
                ({ data, error } = await supabase.from('companies').update(basePayload).eq('id', companyId).select('id'));
            }

            if (error) throw error;
            if (!data || data.length === 0) {
                throw new Error('Não foi possível salvar o perfil: verifique se você ainda tem permissão para editar.');
            }
            initialCompanyRef.current = { ...company };
            addToast('Perfil atualizado com sucesso!', 'success');
            setIsEditing(false);
        } catch (error: unknown) {
            logError('Error updating profile:', error);
            addToast('Erro ao atualizar perfil.', 'error');
        } finally {
            setSaving(false);
        }
    };

    // Password Change State
    const [newPassword, setNewPassword] = useState('');
    const [confirmPassword, setConfirmPassword] = useState('');
    const [passwordLoading, setPasswordLoading] = useState(false);
    const [passwordError, setPasswordError] = useState<string | null>(null);

    const handleChangePassword = async () => {
        if (newPassword.length < 8) {
            setPasswordError('A senha deve ter pelo menos 8 caracteres.');
            return;
        }
        if (newPassword !== confirmPassword) {
            setPasswordError('As senhas não coincidem.');
            return;
        }
        setPasswordLoading(true);
        setPasswordError(null);
        const { error: pwError } = await supabase.auth.updateUser({ password: newPassword });
        setPasswordLoading(false);
        if (pwError) {
            logError('Erro ao alterar senha', pwError);
            addToast('Senha muito fraca. Use pelo menos 8 caracteres com letras e números.', 'error');
            return;
        }
        addToast('Senha alterada com sucesso.', 'success');
        setNewPassword('');
        setConfirmPassword('');
    };

    const [uploading, setUploading] = useState<'logo' | 'cover' | null>(null);

    // ... existing status state ...

    const handleImageUpload = async (e: React.ChangeEvent<HTMLInputElement>, type: 'logo' | 'cover') => {
        if (!e.target.files || !e.target.files[0] || !companyId) return;

        const file = e.target.files[0];

        const allowedTypes = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];
        if (!allowedTypes.includes(file.type)) {
            addToast('Formato não suportado. Use JPG, PNG, WebP ou GIF.', 'error');
            return;
        }
        if (file.size > 5 * 1024 * 1024) {
            addToast('Arquivo muito grande. Máximo 5MB.', 'error');
            return;
        }

        setUploading(type);

        try {
            const fileExt = file.name.split('.').pop();
            const fileName = `${companyId}/${type}_${Math.random()}.${fileExt}`;
            const filePath = `${fileName}`;

            // Upload directly to 'avatars' bucket (assuming it's public)
            const { error: uploadError } = await supabase.storage
                .from('avatars')
                .upload(filePath, file);

            if (uploadError) throw uploadError;

            // Get Public URL
            const { data: { publicUrl } } = supabase.storage
                .from('avatars')
                .getPublicUrl(filePath);

            // Update local state temporarily
            const field = type === 'logo' ? 'logo_url' : 'cover_url';
            setCompany(prev => ({ ...prev, [field]: publicUrl }));

            // Save to DB immediately to persist — .select('id') obrigatório (patterns.md —
            // UPDATE sob RLS negado em silêncio).
            const { data: dbData, error: dbError } = await supabase
                .from('companies')
                .update({ [field]: publicUrl })
                .eq('id', companyId)
                .select('id');

            if (dbError) throw dbError;
            if (!dbData || dbData.length === 0) {
                throw new Error('Não foi possível salvar a imagem: verifique se você ainda tem permissão para editar este perfil.');
            }

            addToast(`${type === 'logo' ? 'Logo' : 'Capa'} atualizada com sucesso!`, 'success');

        } catch (error: unknown) {
            logError('Error uploading image:', error);
            addToast('Erro ao fazer upload da imagem.', 'error');
        } finally {
            setUploading(null);
        }
    };

    const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
        setCompany({ ...company, [e.target.name]: e.target.value });
    };

    const handleCopyMyLink = useCallback(async () => {
        if (!companyId) return;
        const gerado = await TeamConnectionService.generateInviteToken(companyId);
        if (!gerado) {
            addToast('Não foi possível obter o link do seu elenco agora.', 'error');
            return;
        }
        const { url } = gerado;
        try {
            await navigator.clipboard.writeText(url);
            setLinkCopied(true);
            addToast('Link copiado! Envie para um freela ser adicionado ao seu elenco.', 'success');
            setTimeout(() => setLinkCopied(false), 2500);
        } catch {
            addToast('Não foi possível copiar o link.', 'error');
        }
    }, [companyId, addToast]);

    // R3/R4: logout acessível no mobile (via item "Perfil" do BottomNav) — fonte única
    // AuthContext.signOut, com try/catch + toast de erro + estado de loading (A3/A4).
    const handleLogout = async () => {
        if (loggingOut) return;
        setLoggingOut(true);
        try {
            await signOut();
            navigate('/login');
        } catch (error) {
            logError('CompanyProfile.handleLogout', error);
            addToast('Não foi possível sair. Tente novamente.', 'error');
        } finally {
            setLoggingOut(false);
        }
    };

    const handleDeleteAccount = async () => {
        setDeleting(true);
        const { error } = await supabase.functions.invoke('delete-account', { body: {} });
        if (error) {
            let msg = error.message || 'Erro ao excluir conta. Tente novamente.';
            if (error.context && typeof error.context.json === 'function') {
                try {
                    const errData = await error.context.json();
                    msg = errData.error || msg;
                } catch { /* parse error ignorado */ }
            }
            logError(error, 'CompanyProfile.handleDeleteAccount');
            addToast(msg, 'error');
            setDeleting(false);
            return;
        }
        await supabase.auth.signOut();
        navigate('/login');
    };

    if (loading) {
        return (
            <div className="max-w-6xl mx-auto px-4 py-6 sm:py-8 animate-pulse">
                <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 mb-8">
                    <div className="h-10 bg-gray-200 rounded w-1/3" />
                    <div className="h-10 bg-gray-200 rounded w-32" />
                </div>
                <div className="grid grid-cols-1 md:grid-cols-[280px_1fr] gap-8">
                    <div className="space-y-4">
                        <div className="h-40 bg-gray-200 rounded-2xl" />
                        <div className="h-8 bg-gray-200 rounded w-2/3 mx-auto" />
                    </div>
                    <div className="space-y-4">
                        {[...Array(5)].map((_, i) => (
                            <div key={i} className="h-14 bg-gray-200 rounded-xl" />
                        ))}
                    </div>
                </div>
            </div>
        );
    }

    return (
        <>
        <div className="max-w-6xl mx-auto px-4 py-6 sm:py-8 animate-in fade-in slide-in-from-bottom-4 duration-500">
            {/* Page Header — a única ação primária da tela é "Editar Perfil" */}
            <PageHeader
                title="Perfil da Empresa"
                subtitle="Gerencie as informações públicas da sua organização."
                action={
                    !isEditing ? (
                        <Button variant="dark" onClick={() => setIsEditing(true)} iconLeft={<Pencil size={16} />}>
                            Editar Perfil
                        </Button>
                    ) : undefined
                }
            />

            <Card padding="none" className="overflow-hidden">
                {/* Cover Image */}
                <div className="h-32 sm:h-48 bg-black relative group">
                    {company.cover_url && (
                        <img src={company.cover_url} alt="Cover" className="absolute inset-0 w-full h-full object-cover" />
                    )}

                    {isEditing && (
                        <>
                            <input
                                type="file"
                                accept="image/*"
                                id="cover-upload"
                                aria-label="Upload foto de capa"
                                className="peer sr-only"
                                onChange={(e) => handleImageUpload(e, 'cover')}
                            />
                            <label
                                htmlFor="cover-upload"
                                className="absolute bottom-3 right-3 bg-white border-2 border-black h-11 px-3 rounded-xl text-sm font-bold flex items-center gap-2 hover:bg-gray-50 transition-colors cursor-pointer peer-focus-visible:ring-2 peer-focus-visible:ring-primary"
                            >
                                <Camera size={14} /> {uploading === 'cover' ? 'Enviando...' : 'Alterar Capa'}
                            </label>
                        </>
                    )}
                </div>

                <div className="px-5 sm:px-8 md:px-12 pb-8 relative">
                    {/* Logo + título (o logo sobrepõe a capa) */}
                    <div className="flex flex-col md:flex-row gap-4 md:gap-6 -mt-12 mb-6 items-start">
                        {/* Logo Container */}
                        <div className="relative shrink-0">
                            <div className="w-24 h-24 sm:w-28 sm:h-28 aspect-square bg-white rounded-2xl border-2 border-black shadow-[3px_3px_0px_0px_rgba(0,0,0,1)] flex items-center justify-center relative group overflow-hidden z-10">
                                {company.logo_url ? (
                                    <img src={company.logo_url} alt="Logo" className="w-full h-full object-cover" />
                                ) : (
                                    <Building2 size={48} className="text-gray-300" />
                                )}
                                {isEditing && (
                                    <>
                                        <input
                                            type="file"
                                            accept="image/*"
                                            id="logo-upload"
                                            aria-label="Upload logo da empresa"
                                            className="peer sr-only"
                                            onChange={(e) => handleImageUpload(e, 'logo')}
                                        />
                                        {/* Gatilho sempre visivel (no toque nao existe hover) e alcancavel por teclado
                                            via input sr-only + peer-focus-visible. */}
                                        <label
                                            htmlFor="logo-upload"
                                            title="Trocar logo"
                                            className="absolute bottom-1 right-1 inline-flex h-11 w-11 items-center justify-center rounded-full border-2 border-black bg-white text-black transition-colors hover:bg-gray-100 cursor-pointer peer-focus-visible:ring-2 peer-focus-visible:ring-primary sm:h-9 sm:w-9"
                                        >
                                            {uploading === 'logo' ? (
                                                <Loader2 className="animate-spin" size={16} />
                                            ) : (
                                                <Camera size={16} />
                                            )}
                                            <span className="sr-only">Trocar logo da empresa</span>
                                        </label>
                                    </>
                                )}
                            </div>
                        </div>

                        {/* Title & Stats */}
                        <div className="flex-1 w-full md:pt-14">
                            <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-3">
                                <div className="min-w-0">
                                    <h2 className="text-2xl font-bold tracking-tight text-gray-900 mb-1">
                                        {company.name || 'Nome da Empresa'}
                                    </h2>
                                    <p className="text-sm sm:text-base text-gray-600">
                                        {company.industry || 'Setor não definido'}
                                    </p>
                                </div>

                                {/* Review Stats Badge */}
                                <div className="flex items-center gap-2 bg-yellow-50 px-3 py-2 rounded-xl border-2 border-yellow-200">
                                    {/* `|| 5.0` mostrava nota cheia para empresa sem nenhuma avaliação --
                                        e este selo e a prova social que o freela le antes de aceitar convite. */}
                                    <div className="flex items-center gap-1">
                                        <Star size={18} className={(company.reviews_count || 0) > 0 ? 'text-yellow-500 fill-yellow-500' : 'text-yellow-500/40'} />
                                        <span className="font-bold tabular-nums text-yellow-700 text-lg">
                                            {(company.reviews_count || 0) > 0 ? Number(company.rating_average).toFixed(1) : '—'}
                                        </span>
                                    </div>
                                    <div className="w-px h-5 bg-yellow-300 mx-1"></div>
                                    <span className="text-xs font-semibold text-yellow-800">{company.reviews_count === 1 ? '1 avaliação' : `${company.reviews_count || 0} avaliações`}</span>
                                </div>
                            </div>
                        </div>
                    </div>

                    {/* Barra de edição: só Cancelar (secundário) e Salvar (primário) */}
                    {isEditing && (
                        <div className="bg-gray-50 border-2 border-gray-200 rounded-xl p-3 mb-6 flex flex-col-reverse sm:flex-row sm:justify-end gap-3 animate-in fade-in slide-in-from-top-2">
                            <Button
                                variant="secondary"
                                onClick={() => {
                                    setIsEditing(false);
                                    // Ideally revert changes here by refetching or keeping previous state
                                }}
                            >
                                Cancelar
                            </Button>
                            <Button
                                variant="dark"
                                onClick={handleSave}
                                loading={saving}
                                iconLeft={<Save size={16} />}
                            >
                                {saving ? 'Salvando...' : 'Salvar Alterações'}
                            </Button>
                        </div>
                    )}

                    {/* Content Grid */}
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-8 md:gap-12">
                        {/* Left Column */}
                        <div className="space-y-5">
                            <div className="border-b-2 border-gray-200 pb-3">
                                <h3 className="text-lg font-bold text-gray-900">Sobre a Empresa</h3>
                                <p className="text-sm text-gray-600">Informações principais</p>
                            </div>

                            {isEditing ? (
                                <div className="space-y-5">
                                    <Field label="Razão Social / Fantasia">
                                        <input
                                            name="name"
                                            value={company.name || ''}
                                            onChange={handleChange}
                                            placeholder="Nome da Empresa"
                                        />
                                    </Field>
                                    <Field label="Setor">
                                        <input
                                            name="industry"
                                            value={company.industry || ''}
                                            onChange={handleChange}
                                            placeholder="Ex: Bar & Restaurante, Cafeteria, Eventos, Hotelaria"
                                        />
                                    </Field>
                                    <Field label="Descrição">
                                        <textarea
                                            name="description"
                                            value={company.description || ''}
                                            onChange={handleChange}
                                            className="min-h-[140px] py-3 leading-relaxed resize-none"
                                            placeholder="Conte sobre sua operação, ambiente e estilo de atendimento..."
                                        />
                                    </Field>
                                </div>
                            ) : (
                                <div className="space-y-5">
                                    <ReadField label="Razão Social / Fantasia">
                                        <p className="text-lg font-bold text-gray-900">{company.name || '—'}</p>
                                    </ReadField>
                                    <ReadField label="Setor">
                                        <p className="text-base text-gray-700">{company.industry || '—'}</p>
                                    </ReadField>
                                    <ReadField label="Descrição">
                                        <p className="text-sm sm:text-base leading-relaxed text-gray-700 whitespace-pre-wrap">{company.description || 'Nenhuma descrição informada.'}</p>
                                    </ReadField>
                                </div>
                            )}
                        </div>

                        {/* Right Column */}
                        <div className="space-y-5">
                            <div className="border-b-2 border-gray-200 pb-3">
                                <h3 className="text-lg font-bold text-gray-900">Contato & Endereço</h3>
                                <p className="text-sm text-gray-600">Canais de comunicação</p>
                            </div>

                            {isEditing ? (
                                <div className="space-y-5">
                                    <Field label="Website">
                                        <input
                                            name="website"
                                            value={company.website || ''}
                                            onChange={handleChange}
                                            placeholder="https://..."
                                        />
                                    </Field>
                                    <Field label="Email Corporativo">
                                        <input
                                            name="email"
                                            value={company.email || ''}
                                            onChange={handleChange}
                                            placeholder="email@empresa.com"
                                        />
                                    </Field>
                                    <Field label="Localização">
                                        <input
                                            name="address"
                                            value={company.address || ''}
                                            onChange={handleChange}
                                            placeholder="Endereço completo"
                                        />
                                    </Field>
                                </div>
                            ) : (
                                <div className="space-y-5">
                                    <ReadField label="Website">
                                        {company.website ? (
                                            <a href={company.website} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-2 text-blue-600 font-semibold hover:underline">
                                                <Globe size={16} /> {company.website.replace(/^https?:\/\//, '')}
                                            </a>
                                        ) : <p className="text-gray-600">—</p>}
                                    </ReadField>
                                    <ReadField label="Email Corporativo">
                                        {company.email ? (
                                            <a href={`mailto:${company.email}`} className="min-h-11 inline-flex items-center gap-2 text-gray-900 font-semibold hover:text-blue-600 transition-colors">
                                                <Mail size={16} className="text-gray-500" /> {company.email}
                                            </a>
                                        ) : <p className="text-gray-600">—</p>}
                                    </ReadField>
                                    <ReadField label="Localização">
                                        <div className="flex items-start gap-2">
                                            <MapPin size={18} className="text-gray-500 mt-0.5 shrink-0" />
                                            <p className="text-gray-700">{company.address || '—'}</p>
                                        </div>
                                    </ReadField>
                                </div>
                            )}
                        </div>
                    </div>
                </div>
            </Card>

            {/* Briefing padrão do negócio — pré-preenchido ao criar um turno */}
            <Card className="mt-6">
                <h3 className="text-lg font-bold flex items-center gap-2 mb-1">
                    <ClipboardList size={20} /> Briefing Padrão
                </h3>
                <p className="text-sm text-gray-600 mb-4">
                    Regras da casa, dress code e apresentação — vem pré-preenchido ao criar um turno, e você ajusta por turno.
                </p>
                {isEditing ? (
                    <>
                        <textarea
                            name="default_briefing"
                            value={company.default_briefing || ''}
                            onChange={handleChange}
                            aria-label="Briefing padrão do negócio"
                            className={`${FIELD_CONTROL_CLASS} min-h-[120px] py-3 leading-relaxed resize-none`}
                            placeholder="Ex: Calça jeans, camisa branca, cabelo amarrado, barba feita, boa apresentação. Chegar 10 min antes."
                        />
                        <p className="text-xs font-semibold text-yellow-800 bg-yellow-50 border-2 border-yellow-200 rounded-xl px-3 py-2 mt-2">
                            Visível para qualquer freela que abrir o perfil da sua empresa — não inclua senhas nem dados internos.
                        </p>
                    </>
                ) : (
                    <p className="text-sm sm:text-base leading-relaxed text-gray-700 whitespace-pre-wrap bg-gray-50 border-2 border-gray-200 rounded-xl p-4">
                        {company.default_briefing || 'Nenhum briefing padrão definido ainda.'}
                    </p>
                )}
            </Card>

            {/* F5 — Guarda de risco de vínculo trabalhista: aviso configurável, nunca bloqueia
                (decisão do owner). Mesmo padrão de tela/card do Briefing Padrão acima. */}
            <Card className="mt-6">
                <h3 className="text-lg font-bold flex items-center gap-2 mb-1">
                    <ShieldAlert size={20} /> Preferências
                </h3>
                <p className="text-sm text-gray-600 mb-4">
                    O Worki nunca decide risco jurídico de terceiro — só avisa um fato. A decisão de
                    chamar continua sua; consulte seu contador/jurídico se tiver dúvida.
                </p>

                {isEditing ? (
                    <>
                        <label className="flex items-center justify-between gap-4 min-h-[44px] py-2 cursor-pointer">
                            <span>
                                <span className="block font-bold text-sm">
                                    Avisar sobre frequência do mesmo freela
                                </span>
                                <span className="block text-xs text-gray-600 mt-0.5">
                                    Mostra um selo (não bloqueia) quando um freela do elenco passaria do
                                    limite de vezes na mesma semana (dom–sáb).
                                </span>
                            </span>
                            <span className="relative inline-flex flex-shrink-0">
                                <input
                                    type="checkbox"
                                    role="switch"
                                    checked={company.link_risk_alert_enabled !== false}
                                    onChange={(e) =>
                                        setCompany(prev => ({ ...prev, link_risk_alert_enabled: e.target.checked }))
                                    }
                                    aria-label="Avisar sobre frequência do mesmo freela"
                                    className="peer sr-only"
                                />
                                <span
                                    aria-hidden="true"
                                    className={`inline-flex items-center h-7 w-12 rounded-pill border-2 border-black transition-colors peer-focus-visible:ring-2 peer-focus-visible:ring-primary peer-focus-visible:ring-offset-2 ${
                                        company.link_risk_alert_enabled !== false ? 'bg-primary' : 'bg-gray-200'
                                    }`}
                                >
                                    <span
                                        className={`inline-block w-5 h-5 bg-white border-2 border-black rounded-full transform transition-transform ${
                                            company.link_risk_alert_enabled !== false ? 'translate-x-5' : 'translate-x-0.5'
                                        }`}
                                    />
                                </span>
                            </span>
                        </label>

                        <div className={`mt-3 ${company.link_risk_alert_enabled === false ? 'opacity-40 pointer-events-none' : ''}`}>
                            <Field
                                label="Avisar quando passar de quantas vezes por semana"
                                hint={`Padrão: ${DEFAULT_LINK_RISK_THRESHOLD} — o selo aparece a partir da ${DEFAULT_LINK_RISK_THRESHOLD + 1}ª vez. Mínimo 1, máximo 7 (dom–sáb).`}
                            >
                                <input
                                    id="link-risk-threshold"
                                    name="link_risk_alert_threshold"
                                    type="number"
                                    inputMode="numeric"
                                    min={1}
                                    max={7}
                                    step={1}
                                    value={company.link_risk_alert_threshold ?? DEFAULT_LINK_RISK_THRESHOLD}
                                    onChange={(e) => {
                                        const raw = Number(e.target.value);
                                        const clamped = Number.isFinite(raw) ? Math.min(7, Math.max(1, Math.round(raw))) : 1;
                                        setCompany(prev => ({ ...prev, link_risk_alert_threshold: clamped }));
                                    }}
                                    disabled={company.link_risk_alert_enabled === false}
                                    className="max-w-[7rem] tabular-nums"
                                />
                            </Field>
                        </div>
                    </>
                ) : (
                    <div className="flex items-center justify-between gap-4 bg-gray-50 border-2 border-gray-200 rounded-xl p-4">
                        <div>
                            <p className="font-bold text-sm">Avisar sobre frequência do mesmo freela</p>
                            <p className="text-xs text-gray-600 mt-0.5">
                                {company.link_risk_alert_enabled !== false
                                    ? `Avisando quando passar de ${company.link_risk_alert_threshold ?? DEFAULT_LINK_RISK_THRESHOLD}x na mesma semana (dom–sáb), contando só turnos da sua empresa.`
                                    : 'Aviso desligado.'}
                            </p>
                        </div>
                        <span
                            className={`px-3 py-1 rounded-pill border-2 border-black font-semibold text-xs flex-shrink-0 ${
                                company.link_risk_alert_enabled !== false ? 'bg-primary-light text-primary' : 'bg-gray-100 text-gray-600'
                            }`}
                        >
                            {company.link_risk_alert_enabled !== false ? 'Ligado' : 'Desligado'}
                        </span>
                    </div>
                )}
            </Card>

            {/* Avaliações recebidas de freelas */}
            {companyId && <ProfileReviews reviewedId={companyId} reviewerRole="worker" />}

            {/* Meu link de perfil — a empresa compartilha o PRÓPRIO link para ser
                adicionada/conectada por quem abrir (nunca manda o link do freela). */}
            <Card className="mt-6">
                <h3 className="text-lg font-bold mb-1 flex items-center gap-2">
                    <Link2 size={20} /> Meu Link de Elenco
                </h3>
                <p className="text-sm text-gray-600 mb-4">
                    Compartilhe este link com um freela (WhatsApp, etc.) para ele te encontrar e entrar
                    para o seu elenco sem precisar de QR ou Worki ID.
                </p>
                <Button
                    variant="secondary"
                    onClick={handleCopyMyLink}
                    disabled={!companyId}
                    iconLeft={linkCopied ? <Check size={18} /> : <Copy size={18} />}
                >
                    {linkCopied ? 'Link copiado!' : 'Copiar meu link'}
                </Button>
            </Card>

            {/* Atalhos — paridade de navegacao mobile (R6): o BottomNav nao comporta estes destinos. */}
            <nav aria-labelledby="empresa-atalhos" className="mt-6">
                <h3 id="empresa-atalhos" className="text-xs font-semibold uppercase tracking-wide text-gray-600">Atalhos</h3>
                <ul className="mt-2 divide-y-2 divide-gray-200 overflow-hidden rounded-xl border-2 border-black bg-white">
                    {[
                        { to: '/company/indicacoes', label: 'Indicações', icon: <Share2 size={18} />, show: true },
                        { to: '/company/organization', label: 'Organização', icon: <Network size={18} />, show: showOrganizationShortcut },
                        { to: '/ajuda', label: 'Ajuda', icon: <HelpCircle size={18} />, show: true },
                    ].filter(item => item.show).map(item => (
                        <li key={item.to}>
                            <Link
                                to={item.to}
                                className="flex min-h-[44px] items-center justify-between gap-3 px-4 py-2 text-sm font-bold transition-colors hover:bg-gray-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary"
                            >
                                <span className="inline-flex items-center gap-2">{item.icon}{item.label}</span>
                                <ChevronRight size={18} aria-hidden="true" />
                            </Link>
                        </li>
                    ))}
                </ul>
            </nav>

            {/* Botão de toggle para as seções sensíveis (Segurança, Sessão, Zona de Perigo) */}
            <div className="mt-6">
                <Button
                    variant="secondary"
                    onClick={() => setShowAccountSettings(prev => !prev)}
                    aria-expanded={showAccountSettings}
                    iconLeft={<Settings size={18} />}
                >
                    {showAccountSettings ? 'Ocultar Configurações da Conta' : 'Configurações da Conta'}
                </Button>
            </div>

            {showAccountSettings && (
                <>
                    {/* Secao Seguranca */}
                    <Card className="mt-6">
                        <h3 className="text-lg font-bold mb-4 flex items-center gap-2">
                            <Lock size={20} /> Seguranca
                        </h3>

                        <div className="space-y-4">
                            <div>
                                <Field label="Nova Senha">
                                    <input
                                        id="new-password"
                                        type="password"
                                        value={newPassword}
                                        onChange={e => { setNewPassword(e.target.value); setPasswordError(null); }}
                                    />
                                </Field>
                                {newPassword && (() => {
                                    const strength = getPasswordStrength(newPassword);
                                    return (
                                        <div className="mt-2">
                                            <div className="h-1.5 bg-gray-200 rounded-full overflow-hidden">
                                                <div className={`h-full ${strength.color} rounded-full ${strength.width}`} />
                                            </div>
                                            <p className="text-xs text-gray-600 mt-1">Força: {strength.label}</p>
                                        </div>
                                    );
                                })()}
                            </div>

                            <Field label="Confirmar Nova Senha">
                                <input
                                    id="confirm-password"
                                    type="password"
                                    value={confirmPassword}
                                    onChange={e => { setConfirmPassword(e.target.value); setPasswordError(null); }}
                                />
                            </Field>

                            {passwordError && (
                                <p role="alert" className="text-xs font-bold text-red-600">{passwordError}</p>
                            )}

                            <Button
                                variant="dark"
                                onClick={handleChangePassword}
                                disabled={!newPassword || !confirmPassword}
                                loading={passwordLoading}
                            >
                                Alterar Senha
                            </Button>
                        </div>
                    </Card>

                    {/* Sessão — logout avulso, acessível no mobile via item "Perfil" do BottomNav (R3) */}
                    <Card className="mt-6">
                        <h3 className="text-lg font-bold mb-1 flex items-center gap-2">
                            <LogOut size={20} /> Sessão
                        </h3>
                        <p className="text-sm text-gray-600 mb-4">Sair da sua conta neste dispositivo.</p>
                        <Button
                            variant="secondary"
                            onClick={handleLogout}
                            loading={loggingOut}
                            iconLeft={<LogOut size={18} />}
                        >
                            {loggingOut ? 'Saindo...' : 'Sair da conta'}
                        </Button>
                    </Card>

                    {/* Zona de Perigo */}
                    <Card className="mt-6 !border-red-500 shadow-[3px_3px_0px_0px_rgba(239,68,68,1)]">
                        <h3 className="text-red-600 font-bold text-lg mb-1">Zona de Perigo</h3>
                        <p className="text-sm text-gray-600 mb-4">A exclusão da sua empresa é irreversível. Todos os dados da empresa serão anonimizados.</p>
                        <Button variant="danger" onClick={() => setDeleteModalOpen(true)}>
                            Excluir minha empresa
                        </Button>
                    </Card>
                </>
            )}

        </div>

        {/* Modal de confirmação de exclusão */}
        {deleteModalOpen && (
            <div
                className="fixed inset-0 bg-black/50 backdrop-blur-sm z-[70] flex items-center justify-center p-4"
                role="dialog"
                aria-modal="true"
                aria-labelledby="delete-company-title"
            >
                <div className="bg-white rounded-2xl w-full max-w-md p-6 border-2 border-black shadow-[8px_8px_0px_0px_rgba(0,0,0,1)]">
                    <h2 id="delete-company-title" className="text-lg font-bold mb-4 text-red-600">Tem certeza? Esta ação é irreversível.</h2>
                    <ul className="space-y-2 mb-6 text-sm text-gray-700">
                        <li className="flex items-start gap-2">
                            <span className="font-bold text-red-500 mt-0.5">&#8226;</span>
                            Dados da empresa serão anonimizados
                        </li>
                        <li className="flex items-start gap-2">
                            <span className="font-bold text-red-500 mt-0.5">&#8226;</span>
                            Todos os turnos e convites serão cancelados
                        </li>
                        <li className="flex items-start gap-2">
                            <span className="font-bold text-red-500 mt-0.5">&#8226;</span>
                            Pagamentos pendentes bloqueiam a exclusão
                        </li>
                    </ul>
                    <Field label="Digite EXCLUIR para confirmar" className="mb-6">
                        <input
                            type="text"
                            value={deleteConfirmText}
                            onChange={(e) => setDeleteConfirmText(e.target.value)}
                            placeholder="EXCLUIR"
                        />
                    </Field>
                    <div className="flex gap-3">
                        <Button
                            variant="secondary"
                            className="flex-1"
                            onClick={() => { setDeleteModalOpen(false); setDeleteConfirmText(''); }}
                        >
                            Cancelar
                        </Button>
                        <Button
                            variant="danger"
                            className="flex-1"
                            onClick={handleDeleteAccount}
                            disabled={deleteConfirmText !== 'EXCLUIR'}
                            loading={deleting}
                        >
                            {deleting ? 'Excluindo...' : 'Confirmar Exclusão'}
                        </Button>
                    </div>
                </div>
            </div>
        )}
        </>
    );
}
