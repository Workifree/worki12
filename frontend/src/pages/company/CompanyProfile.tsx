import { useState, useEffect, useRef, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { Building2, MapPin, Globe, Mail, Save, Camera, Loader2, Star, LayoutDashboard, Pencil, Lock, LogOut, Link2, Copy, Check, ClipboardList, Settings, ShieldAlert } from 'lucide-react';
import { supabase } from '../../lib/supabase';
import { useAuth } from '../../contexts/AuthContext';
import { useToast } from '../../contexts/ToastContext';
import { getPasswordStrength } from '../../lib/validation';
import { logError } from '../../lib/logger';
import { TeamConnectionService } from '../../services/teamConnectionService';
import ProfileReviews from '../../components/ProfileReviews';
import { DEFAULT_LINK_RISK_THRESHOLD } from '../../components/company/seriesWeekRisk';

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
    const [userId, setUserId] = useState<string | null>(null);
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
                setUserId(user.id);

                const { data } = await supabase
                    .from('companies')
                    .select('*')
                    .eq('id', user.id)
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
        if (!userId) return;
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
                .eq('id', userId)
                .select('id');

            if (error && /link_risk_alert_(enabled|threshold)/i.test(error.message || '')) {
                ({ data, error } = await supabase
                    .from('companies')
                    .update({ ...basePayload, default_briefing: company.default_briefing })
                    .eq('id', userId)
                    .select('id'));
            }

            if (error && /default_briefing/i.test(error.message || '')) {
                ({ data, error } = await supabase.from('companies').update(basePayload).eq('id', userId).select('id'));
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
        if (!e.target.files || !e.target.files[0] || !userId) return;

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
            const fileName = `${userId}/${type}_${Math.random()}.${fileExt}`;
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
                .eq('id', userId)
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
        if (!userId) return;
        const { url } = TeamConnectionService.generateInviteToken(userId);
        try {
            await navigator.clipboard.writeText(url);
            setLinkCopied(true);
            addToast('Link copiado! Envie para um freela ser adicionado ao seu elenco.', 'success');
            setTimeout(() => setLinkCopied(false), 2500);
        } catch {
            addToast('Não foi possível copiar o link.', 'error');
        }
    }, [userId, addToast]);

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
            <div className="max-w-6xl mx-auto px-4 py-8 animate-pulse">
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
        <div className="max-w-6xl mx-auto px-4 py-8 animate-in fade-in slide-in-from-bottom-4 duration-500">
            {/* Page Header */}
            <div className="mb-8 flex flex-col md:flex-row md:items-center justify-between gap-4">
                <div>
                    <h1 className="text-3xl font-black uppercase tracking-tighter flex items-center gap-3 text-gray-900">
                        <LayoutDashboard className="w-8 h-8" />
                        Perfil da Empresa
                    </h1>
                    <p className="text-gray-500 font-medium mt-2">Gerencie as informações públicas da sua organização.</p>
                </div>

                {!isEditing && (
                    <button
                        onClick={() => setIsEditing(true)}
                        className="bg-black text-white px-6 py-2.5 rounded-xl font-bold uppercase flex items-center gap-2 hover:bg-gray-800 transition-colors shadow-lg active:scale-95 duration-200"
                    >
                        <Pencil size={18} />
                        Editar Perfil
                    </button>
                )}
            </div>

            <div className="bg-white border-2 border-black rounded-2xl overflow-hidden shadow-[6px_6px_0px_0px_rgba(0,0,0,1)]">
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
                                className="hidden"
                                onChange={(e) => handleImageUpload(e, 'cover')}
                            />
                            <label
                                htmlFor="cover-upload"
                                className="absolute bottom-4 right-4 bg-white/90 backdrop-blur px-4 py-2 rounded-xl text-xs font-bold uppercase flex items-center gap-2 hover:bg-white hover:scale-105 transition-all shadow-sm cursor-pointer"
                            >
                                <Camera size={14} /> {uploading === 'cover' ? 'Enviando...' : 'Alterar Capa'}
                            </label>
                        </>
                    )}
                </div>

                <div className="px-6 md:px-12 pb-12 relative">
                    {/* Header Section with Logo and Actions logic */}
                    <div className="flex flex-col md:flex-row gap-6 relative -top-12 mb-8 items-start">
                        {/* Logo Container */}
                        <div className="relative shrink-0">
                            <div className="w-24 h-24 sm:w-28 sm:h-28 aspect-square bg-white rounded-2xl border-2 border-black shadow-[4px_4px_0px_0px_rgba(0,166,81,1)] flex items-center justify-center relative group overflow-hidden z-10">
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
                                            className="hidden"
                                            onChange={(e) => handleImageUpload(e, 'logo')}
                                        />
                                        <label
                                            htmlFor="logo-upload"
                                            className="absolute inset-0 bg-black/50 opacity-0 group-hover:opacity-100 flex items-center justify-center transition-opacity cursor-pointer"
                                        >
                                            {uploading === 'logo' ? (
                                                <Loader2 className="animate-spin text-white" size={24} />
                                            ) : (
                                                <Camera className="text-white" size={24} />
                                            )}
                                        </label>
                                    </>
                                )}
                            </div>
                        </div>

                        {/* Title & Stats */}
                        <div className="flex-1 pt-14 md:pt-16 md:pl-2">
                            <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
                                <div>
                                    <h2 className="text-3xl font-black uppercase tracking-tight text-gray-900 leading-none mb-2">
                                        {company.name || 'Nome da Empresa'}
                                    </h2>
                                    <p className="text-lg font-medium text-gray-500 flex items-center gap-2">
                                        {company.industry || 'Setor não definido'}
                                    </p>
                                </div>

                                {/* Review Stats Badge */}
                                <div className="flex items-center gap-2 bg-yellow-50 px-4 py-2 rounded-xl border border-yellow-100 shadow-sm">
                                    <div className="flex items-center gap-1">
                                        <Star size={18} className="text-yellow-500 fill-yellow-500" />
                                        <span className="font-black text-yellow-700 text-lg">{Number(company.rating_average || 5.0).toFixed(1)}</span>
                                    </div>
                                    <div className="w-px h-6 bg-yellow-200 mx-1"></div>
                                    <span className="text-xs font-bold uppercase text-yellow-800/70 tracking-wide">{company.reviews_count || 0} avaliações</span>
                                </div>
                            </div>
                        </div>
                    </div>

                    {/* Edit Actions Bar (Sticky or prominent when editing) */}
                    {isEditing && (
                        <div className="bg-gray-50 border border-gray-200 rounded-xl p-4 mb-8 flex flex-col md:flex-row justify-between items-center gap-4 animate-in fade-in slide-in-from-top-2">
                            <div className="text-sm font-medium text-gray-500 flex items-center gap-2">
                                <Pencil size={16} /> Mode de Edição Ativo
                            </div>
                            <div className="flex items-center gap-3 w-full md:w-auto">
                                <button
                                    onClick={() => {
                                        setIsEditing(false);
                                        // Ideally revert changes here by refetching or keeping previous state
                                    }}
                                    className="flex-1 md:flex-none px-6 py-2.5 rounded-xl font-bold uppercase text-xs border-2 border-transparent hover:bg-gray-200 transition-colors text-gray-600"
                                >
                                    Cancelar
                                </button>
                                <button
                                    onClick={handleSave}
                                    disabled={saving}
                                    className="flex-1 md:flex-none bg-black text-white px-8 py-2.5 rounded-xl font-bold uppercase text-xs flex items-center justify-center gap-2 hover:bg-gray-800 active:scale-95 transition-all disabled:opacity-50 disabled:cursor-not-allowed shadow-lg"
                                >
                                    {saving ? <Loader2 className="animate-spin" size={16} /> : <Save size={16} />}
                                    {saving ? 'Salvando...' : 'Salvar Alterações'}
                                </button>
                            </div>
                        </div>
                    )}

                    {/* Content Grid */}
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-10">
                        {/* Left Column */}
                        <div className="space-y-8">
                            <div className="flex items-center gap-3 border-b-2 border-gray-100 pb-4">
                                <div className="w-10 h-10 rounded-xl bg-blue-50 flex items-center justify-center text-blue-600 shadow-sm border border-blue-100">
                                    <Building2 size={20} />
                                </div>
                                <div>
                                    <h3 className="font-black uppercase tracking-wider text-gray-900 text-sm">Sobre a Empresa</h3>
                                    <p className="text-xs text-gray-400 font-medium mt-0.5">Informações principais</p>
                                </div>
                            </div>

                            <div className="space-y-6">
                                {/* Name Field */}
                                <div className="group">
                                    <label className="block text-[10px] font-bold uppercase tracking-wider text-gray-400 mb-2">Razão Social / Fantasia</label>
                                    {isEditing ? (
                                        <input
                                            name="name"
                                            value={company.name || ''}
                                            onChange={handleChange}
                                            aria-label="Razao social ou nome fantasia"
                                            className="w-full font-bold text-gray-900 border-2 border-gray-200 rounded-xl px-4 py-3 focus:border-black focus:ring-0 outline-none transition-all"
                                            placeholder="Nome da Empresa"
                                        />
                                    ) : (
                                        <p className="text-xl font-bold text-gray-900">{company.name || '—'}</p>
                                    )}
                                </div>

                                {/* Industry Field */}
                                <div className="group">
                                    <label className="block text-[10px] font-bold uppercase tracking-wider text-gray-400 mb-2">Setor</label>
                                    {isEditing ? (
                                        <input
                                            name="industry"
                                            value={company.industry || ''}
                                            onChange={handleChange}
                                            aria-label="Setor"
                                            className="w-full font-bold text-gray-900 border-2 border-gray-200 rounded-xl px-4 py-3 focus:border-black focus:ring-0 outline-none transition-all"
                                            placeholder="Ex: Bar & Restaurante, Cafeteria, Eventos, Hotelaria"
                                        />
                                    ) : (
                                        <p className="text-lg font-medium text-gray-700">{company.industry || '—'}</p>
                                    )}
                                </div>

                                {/* Description Field */}
                                <div className="group">
                                    <label className="block text-[10px] font-bold uppercase tracking-wider text-gray-400 mb-2">Descrição</label>
                                    {isEditing ? (
                                        <textarea
                                            name="description"
                                            value={company.description || ''}
                                            onChange={handleChange}
                                            aria-label="Descricao da empresa"
                                            className="w-full font-medium text-gray-700 border-2 border-gray-200 rounded-xl px-4 py-3 focus:border-black focus:ring-0 outline-none transition-all min-h-[140px] resize-none"
                                            placeholder="Conte sobre sua operação, ambiente e estilo de atendimento..."
                                        />
                                    ) : (
                                        <p className="text-base leading-relaxed text-gray-600 whitespace-pre-wrap">{company.description || 'Nenhuma descrição informada.'}</p>
                                    )}
                                </div>
                            </div>
                        </div>

                        {/* Right Column */}
                        <div className="space-y-8">
                            <div className="flex items-center gap-3 border-b-2 border-gray-100 pb-4">
                                <div className="w-10 h-10 rounded-xl bg-emerald-50 flex items-center justify-center text-emerald-600 shadow-sm border border-emerald-100">
                                    <MapPin size={20} />
                                </div>
                                <div>
                                    <h3 className="font-black uppercase tracking-wider text-gray-900 text-sm">Contato & Endereço</h3>
                                    <p className="text-xs text-gray-400 font-medium mt-0.5">Canais de comunicação</p>
                                </div>
                            </div>

                            <div className="space-y-6">
                                {/* Website */}
                                <div className="group">
                                    <label className="block text-[10px] font-bold uppercase tracking-wider text-gray-400 mb-2">Website</label>
                                    {isEditing ? (
                                        <div className="relative">
                                            <Globe size={18} className="absolute top-1/2 -translate-y-1/2 left-4 text-gray-400" />
                                            <input
                                                name="website"
                                                value={company.website || ''}
                                                onChange={handleChange}
                                                aria-label="Website"
                                                className="w-full font-bold text-gray-900 border-2 border-gray-200 rounded-xl pl-12 pr-4 py-3 focus:border-black focus:ring-0 outline-none transition-all"
                                                placeholder="https://..."
                                            />
                                        </div>
                                    ) : (
                                        company.website ? (
                                            <a href={company.website} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-2 text-blue-600 font-bold hover:underline">
                                                <Globe size={16} /> {company.website.replace(/^https?:\/\//, '')}
                                            </a>
                                        ) : <p className="text-gray-400 font-medium">—</p>
                                    )}
                                </div>

                                {/* Email */}
                                <div className="group">
                                    <label className="block text-[10px] font-bold uppercase tracking-wider text-gray-400 mb-2">Email Corporativo</label>
                                    {isEditing ? (
                                        <div className="relative">
                                            <Mail size={18} className="absolute top-1/2 -translate-y-1/2 left-4 text-gray-400" />
                                            <input
                                                name="email"
                                                value={company.email || ''}
                                                onChange={handleChange}
                                                aria-label="Email corporativo"
                                                className="w-full font-bold text-gray-900 border-2 border-gray-200 rounded-xl pl-12 pr-4 py-3 focus:border-black focus:ring-0 outline-none transition-all"
                                                placeholder="email@empresa.com"
                                            />
                                        </div>
                                    ) : (
                                        company.email ? (
                                            <a href={`mailto:${company.email}`} className="inline-flex items-center gap-2 text-gray-900 font-bold hover:text-blue-600 transition-colors">
                                                <Mail size={16} className="text-gray-400" /> {company.email}
                                            </a>
                                        ) : <p className="text-gray-400 font-medium">—</p>
                                    )}
                                </div>

                                {/* Address */}
                                <div className="group">
                                    <label className="block text-[10px] font-bold uppercase tracking-wider text-gray-400 mb-2">Localização</label>
                                    {isEditing ? (
                                        <div className="relative">
                                            <MapPin size={18} className="absolute top-1/2 -translate-y-1/2 left-4 text-gray-400" />
                                            <input
                                                name="address"
                                                value={company.address || ''}
                                                onChange={handleChange}
                                                aria-label="Localizacao"
                                                className="w-full font-bold text-gray-900 border-2 border-gray-200 rounded-xl pl-12 pr-4 py-3 focus:border-black focus:ring-0 outline-none transition-all"
                                                placeholder="Endereço completo"
                                            />
                                        </div>
                                    ) : (
                                        <div className="flex items-start gap-2">
                                            <MapPin size={18} className="text-gray-400 mt-1 shrink-0" />
                                            <p className="font-medium text-gray-700">{company.address || '—'}</p>
                                        </div>
                                    )}
                                </div>
                            </div>
                        </div>
                    </div>
                </div>
            </div>


            {/* Briefing padrão do negócio — pré-preenchido ao criar um turno */}
            <div className="mt-8 bg-white border-2 border-black rounded-2xl p-6 sm:p-8 shadow-[6px_6px_0px_0px_rgba(0,0,0,1)]">
                <div className="flex items-start justify-between gap-4 mb-2">
                    <h3 className="text-xl font-black uppercase flex items-center gap-2">
                        <ClipboardList size={20} /> Briefing Padrão
                    </h3>
                    {!isEditing && (
                        <button
                            onClick={() => setIsEditing(true)}
                            className="text-xs font-black uppercase text-gray-400 hover:text-black flex items-center gap-1 transition-colors flex-shrink-0"
                        >
                            <Pencil size={14} /> Editar
                        </button>
                    )}
                </div>
                <p className="text-sm text-gray-500 mb-4">
                    Regras da casa, dress code e apresentação — vem pré-preenchido ao criar um turno, e você ajusta por turno.
                </p>
                {isEditing ? (
                    <>
                        <textarea
                            name="default_briefing"
                            value={company.default_briefing || ''}
                            onChange={handleChange}
                            aria-label="Briefing padrão do negócio"
                            className="w-full font-medium text-gray-700 border-2 border-black rounded-xl px-4 py-3 focus:ring-2 focus:ring-primary outline-none transition-all min-h-[120px] resize-none"
                            placeholder="Ex: Calça jeans, camisa branca, cabelo amarrado, barba feita, boa apresentação. Chegar 10 min antes."
                        />
                        <p className="text-xs font-bold text-yellow-700 bg-yellow-50 border-2 border-yellow-200 rounded-xl px-3 py-2 mt-2">
                            Visível para qualquer freela que abrir o perfil da sua empresa — não inclua senhas nem dados internos.
                        </p>
                    </>
                ) : (
                    <p className="text-base leading-relaxed text-gray-600 whitespace-pre-wrap bg-gray-50 border-2 border-gray-100 rounded-xl p-4">
                        {company.default_briefing || 'Nenhum briefing padrão definido ainda.'}
                    </p>
                )}
            </div>

            {/* F5 — Guarda de risco de vínculo trabalhista: aviso configurável, nunca bloqueia
                (decisão do owner). Mesmo padrão de tela/card do Briefing Padrão acima. */}
            <div className="mt-8 bg-white border-2 border-black rounded-2xl p-6 sm:p-8 shadow-[6px_6px_0px_0px_rgba(0,0,0,1)]">
                <div className="flex items-start justify-between gap-4 mb-2">
                    <h3 className="text-xl font-black uppercase flex items-center gap-2">
                        <ShieldAlert size={20} /> Preferências
                    </h3>
                    {!isEditing && (
                        <button
                            onClick={() => setIsEditing(true)}
                            className="text-xs font-black uppercase text-gray-400 hover:text-black flex items-center gap-1 transition-colors flex-shrink-0"
                        >
                            <Pencil size={14} /> Editar
                        </button>
                    )}
                </div>
                <p className="text-sm text-gray-500 mb-4">
                    O Worki nunca decide risco jurídico de terceiro — só avisa um fato. A decisão de
                    chamar continua sua; consulte seu contador/jurídico se tiver dúvida.
                </p>

                {isEditing ? (
                    <>
                        <label className="flex items-center justify-between gap-4 min-h-[44px] py-2 cursor-pointer">
                            <span>
                                <span className="block font-black text-sm uppercase">
                                    Avisar sobre frequência do mesmo freela
                                </span>
                                <span className="block text-xs font-bold text-gray-500 mt-0.5">
                                    Mostra um selo (não bloqueia) quando um freela do elenco passaria do
                                    limite de vezes na mesma semana (dom–sáb).
                                </span>
                            </span>
                            <span
                                className={`relative inline-flex items-center h-7 w-12 rounded-pill border-2 border-black flex-shrink-0 transition-colors ${
                                    company.link_risk_alert_enabled !== false ? 'bg-primary' : 'bg-gray-200'
                                }`}
                            >
                                <input
                                    type="checkbox"
                                    checked={company.link_risk_alert_enabled !== false}
                                    onChange={(e) =>
                                        setCompany(prev => ({ ...prev, link_risk_alert_enabled: e.target.checked }))
                                    }
                                    aria-label="Avisar sobre frequência do mesmo freela"
                                    className="sr-only"
                                />
                                <span
                                    className={`inline-block w-5 h-5 bg-white border-2 border-black rounded-full transform transition-transform ${
                                        company.link_risk_alert_enabled !== false ? 'translate-x-5' : 'translate-x-0.5'
                                    }`}
                                />
                            </span>
                        </label>

                        <div className={`mt-2 ${company.link_risk_alert_enabled === false ? 'opacity-40 pointer-events-none' : ''}`}>
                            <label htmlFor="link-risk-threshold" className="block text-[10px] font-bold uppercase tracking-wider text-gray-400 mb-2">
                                Avisar a partir de quantas vezes por semana
                            </label>
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
                                className="w-24 font-bold text-gray-900 border-2 border-gray-200 rounded-xl px-4 py-3 focus:border-black focus:ring-0 outline-none transition-all disabled:opacity-50 disabled:bg-gray-50"
                            />
                            <p className="text-xs text-gray-500 mt-2">
                                Padrão: {DEFAULT_LINK_RISK_THRESHOLD}. Mínimo 1, máximo 7 vezes na mesma semana (dom–sáb).
                            </p>
                        </div>
                    </>
                ) : (
                    <div className="flex items-center justify-between gap-4 bg-gray-50 border-2 border-gray-100 rounded-xl p-4">
                        <div>
                            <p className="font-black text-sm uppercase">Avisar sobre frequência do mesmo freela</p>
                            <p className="text-xs font-bold text-gray-500 mt-0.5">
                                {company.link_risk_alert_enabled !== false
                                    ? `Avisando a partir de ${company.link_risk_alert_threshold ?? DEFAULT_LINK_RISK_THRESHOLD}x na mesma semana (dom–sáb), contando só turnos da sua empresa.`
                                    : 'Aviso desligado.'}
                            </p>
                        </div>
                        <span
                            className={`px-3 py-1.5 rounded-pill border-2 border-black font-black uppercase text-xs flex-shrink-0 ${
                                company.link_risk_alert_enabled !== false ? 'bg-primary-light text-primary' : 'bg-gray-100 text-gray-500'
                            }`}
                        >
                            {company.link_risk_alert_enabled !== false ? 'Ligado' : 'Desligado'}
                        </span>
                    </div>
                )}
            </div>

            {/* Avaliações recebidas de freelas */}
            {userId && <ProfileReviews reviewedId={userId} reviewerRole="worker" />}

            {/* Meu link de perfil — a empresa compartilha o PRÓPRIO link para ser
                adicionada/conectada por quem abrir (nunca manda o link do freela). */}
            <div className="mt-8 bg-white border-2 border-black rounded-2xl p-6 sm:p-8 shadow-[6px_6px_0px_0px_rgba(0,0,0,1)]">
                <h3 className="text-xl font-black uppercase mb-4 flex items-center gap-2">
                    <Link2 size={20} /> Meu Link de Elenco
                </h3>
                <p className="text-sm text-gray-600 mb-4">
                    Compartilhe este link com um freela (WhatsApp, etc.) para ele te encontrar e entrar
                    para o seu elenco sem precisar de QR ou Worki ID.
                </p>
                <button
                    onClick={handleCopyMyLink}
                    disabled={!userId}
                    className="flex items-center justify-center gap-2 bg-black text-white px-6 py-3 rounded-xl font-black uppercase hover:bg-gray-800 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                >
                    {linkCopied ? <Check size={18} /> : <Copy size={18} />}
                    {linkCopied ? 'Link copiado!' : 'Copiar meu link'}
                </button>
            </div>

            {/* Botão de toggle para as seções sensíveis (Segurança, Sessão, Zona de Perigo) */}
            <div className="mt-8">
                <button
                    onClick={() => setShowAccountSettings(prev => !prev)}
                    aria-expanded={showAccountSettings}
                    className="flex items-center justify-center gap-2 bg-white text-black px-6 py-3 rounded-xl font-black uppercase border-2 border-black hover:bg-black hover:text-white transition-colors"
                >
                    <Settings size={18} />
                    {showAccountSettings ? 'Ocultar Configurações da Conta' : 'Configurações da Conta'}
                </button>
            </div>

            {showAccountSettings && (
                <>
                    {/* Secao Seguranca */}
                    <div className="mt-8 bg-white border-2 border-black rounded-2xl p-6 sm:p-8 shadow-[6px_6px_0px_0px_rgba(0,0,0,1)]">
                        <h3 className="text-xl font-black uppercase mb-4 flex items-center gap-2">
                            <Lock size={20} /> Seguranca
                        </h3>

                        <div className="mb-4">
                            <label htmlFor="new-password" className="block text-sm font-bold uppercase mb-1">Nova Senha</label>
                            <input
                                id="new-password"
                                type="password"
                                value={newPassword}
                                onChange={e => { setNewPassword(e.target.value); setPasswordError(null); }}
                                className="w-full border-2 border-gray-200 rounded-xl p-3 focus:border-black outline-none font-medium"
                            />
                            {newPassword && (() => {
                                const strength = getPasswordStrength(newPassword);
                                return (
                                    <div className="mt-1">
                                        <div className="h-1.5 bg-gray-200 rounded-full overflow-hidden">
                                            <div className={`h-full ${strength.color} rounded-full ${strength.width}`} />
                                        </div>
                                        <p className="text-xs text-gray-500 mt-1">Forca: {strength.label}</p>
                                    </div>
                                );
                            })()}
                        </div>

                        <div className="mb-2">
                            <label htmlFor="confirm-password" className="block text-sm font-bold uppercase mb-1">Confirmar Nova Senha</label>
                            <input
                                id="confirm-password"
                                type="password"
                                value={confirmPassword}
                                onChange={e => { setConfirmPassword(e.target.value); setPasswordError(null); }}
                                className="w-full border-2 border-gray-200 rounded-xl p-3 focus:border-black outline-none font-medium"
                            />
                        </div>

                        {passwordError && (
                            <p className="text-red-600 text-sm font-bold mb-4">{passwordError}</p>
                        )}

                        <button
                            onClick={handleChangePassword}
                            disabled={!newPassword || !confirmPassword || passwordLoading}
                            className="bg-black text-white px-6 py-3 rounded-xl font-black uppercase hover:bg-gray-800 transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
                        >
                            {passwordLoading ? <Loader2 className="animate-spin" size={18} /> : null}
                            Alterar Senha
                        </button>
                    </div>

                    {/* Sessão — logout avulso, acessível no mobile via item "Perfil" do BottomNav (R3) */}
                    <div className="mt-8 bg-white border-2 border-black rounded-2xl p-6 sm:p-8 shadow-[6px_6px_0px_0px_rgba(0,0,0,1)]">
                        <h3 className="text-xl font-black uppercase mb-4 flex items-center gap-2">
                            <LogOut size={20} /> Sessão
                        </h3>
                        <p className="text-sm text-gray-600 mb-4">Sair da sua conta neste dispositivo.</p>
                        <button
                            onClick={handleLogout}
                            disabled={loggingOut}
                            className="flex items-center justify-center gap-2 bg-black text-white px-6 py-3 rounded-xl font-black uppercase hover:bg-gray-800 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                        >
                            {loggingOut ? <Loader2 size={18} className="animate-spin" /> : <LogOut size={18} />}
                            {loggingOut ? 'Saindo...' : 'Sair da conta'}
                        </button>
                    </div>

                    {/* Zona de Perigo */}
                    <div className="mt-8 bg-white border-2 border-red-500 rounded-2xl p-6 sm:p-8 shadow-[6px_6px_0px_0px_rgba(239,68,68,1)]">
                        <h3 className="text-red-600 font-black uppercase text-lg mb-4">Zona de Perigo</h3>
                        <p className="text-sm text-gray-600 mb-4">A exclusão da sua empresa é irreversível. Todos os dados da empresa serão anonimizados.</p>
                        <button
                            onClick={() => setDeleteModalOpen(true)}
                            className="border-2 border-red-500 text-red-500 bg-white hover:bg-red-50 font-bold uppercase px-4 py-2 rounded-xl transition-colors"
                        >
                            Excluir minha empresa
                        </button>
                    </div>
                </>
            )}

        </div>

        {/* Modal de confirmação de exclusão */}
        {deleteModalOpen && (
            <div className="fixed inset-0 bg-black/80 z-50 flex items-center justify-center p-4">
                <div className="bg-white rounded-2xl w-full max-w-md p-6 border-2 border-black shadow-[8px_8px_0px_0px_rgba(0,0,0,1)]">
                    <h2 className="text-xl font-black uppercase tracking-tight mb-4 text-red-600">Tem certeza? Esta ação é irreversível.</h2>
                    <ul className="space-y-2 mb-6 text-sm text-gray-700">
                        <li className="flex items-start gap-2">
                            <span className="font-black text-red-500 mt-0.5">&#8226;</span>
                            Dados da empresa serão anonimizados
                        </li>
                        <li className="flex items-start gap-2">
                            <span className="font-black text-red-500 mt-0.5">&#8226;</span>
                            Todos os turnos e convites serão cancelados
                        </li>
                        <li className="flex items-start gap-2">
                            <span className="font-black text-red-500 mt-0.5">&#8226;</span>
                            Pagamentos pendentes bloqueiam a exclusão
                        </li>
                    </ul>
                    <label className="block text-sm font-bold mb-2">
                        Digite <span className="font-black">EXCLUIR</span> para confirmar:
                    </label>
                    <input
                        type="text"
                        value={deleteConfirmText}
                        onChange={(e) => setDeleteConfirmText(e.target.value)}
                        className="w-full border-2 border-gray-300 rounded-xl px-4 py-2 mb-6 font-bold focus:border-red-500 outline-none"
                        placeholder="EXCLUIR"
                        aria-label="Confirmar exclusao"
                    />
                    <div className="flex gap-3">
                        <button
                            onClick={() => { setDeleteModalOpen(false); setDeleteConfirmText(''); }}
                            className="flex-1 py-3 border-2 border-black font-bold rounded-xl hover:bg-gray-50 transition-colors"
                        >
                            Cancelar
                        </button>
                        <button
                            onClick={handleDeleteAccount}
                            disabled={deleteConfirmText !== 'EXCLUIR' || deleting}
                            className="flex-1 py-3 bg-red-600 text-white font-bold rounded-xl border-2 border-black shadow-[4px_4px_0px_0px_rgba(0,0,0,1)] hover:shadow-none hover:translate-x-1 hover:translate-y-1 transition-all disabled:opacity-50 disabled:cursor-not-allowed"
                        >
                            {deleting ? 'Excluindo...' : 'Confirmar Exclusão'}
                        </button>
                    </div>
                </div>
            </div>
        )}
        </>
    );
}
