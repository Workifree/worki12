
import { useEffect, useState, useRef, useCallback } from 'react';
import { supabase } from '../lib/supabase';
import { User, MapPin, Briefcase, Star, ShieldCheck, Phone, Edit2, Loader2, Award, Save, X, Camera, CreditCard, Lock, QrCode, Copy, Check, LogOut, Link2, Settings } from 'lucide-react';
import ProfileReviews from '../components/ProfileReviews';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { useToast } from '../contexts/ToastContext';
import { getPasswordStrength } from '../lib/validation';
import { logError } from '../lib/logger';
import { QRCodeSVG } from 'qrcode.react';
import { TeamConnectionService } from '../services/teamConnectionService';

interface WorkerProfile {
    id: string;
    full_name: string;
    city: string;
    phone: string;
    bio: string;
    pix_key: string;
    primary_role: string;
    roles: string[];
    cover_url: string | null;
    avatar_url: string | null;
    verified_identity: boolean;
    level: number | null;
    xp: number | null;
    rating_average: number | null;
    completed_jobs_count: number | null;
    earnings_total: number | null;
    experience_years: string | null;
    availability: string | string[] | null;
    updated_at?: Date;
}

interface FormData {
    full_name: string;
    city: string;
    phone: string;
    bio: string;
    pix_key: string;
    primary_role: string;
    roles: string;
}

export default function Profile() {
    const navigate = useNavigate();
    const { signOut } = useAuth();
    const [loading, setLoading] = useState(true);
    const [profile, setProfile] = useState<WorkerProfile | null>(null);
    const [isEditing, setIsEditing] = useState(false);
    const [uploading, setUploading] = useState(false);
    const [loggingOut, setLoggingOut] = useState(false);
    const fileInputRef = useRef<HTMLInputElement>(null);
    const coverInputRef = useRef<HTMLInputElement>(null);
    const { addToast } = useToast();

    // Password Change State
    const [newPassword, setNewPassword] = useState('');
    const [confirmPassword, setConfirmPassword] = useState('');
    const [passwordLoading, setPasswordLoading] = useState(false);
    const [passwordError, setPasswordError] = useState<string | null>(null);

    // Editing State
    const [formData, setFormData] = useState<FormData>({
        full_name: '',
        city: '',
        phone: '',
        bio: '',
        pix_key: '',
        primary_role: '',
        roles: '' // comma separated string for editing
    });

    // Track initial form data for dirty detection
    const initialFormDataRef = useRef<FormData>({
        full_name: '',
        city: '',
        phone: '',
        bio: '',
        pix_key: '',
        primary_role: '',
        roles: ''
    });

    const isDirty = isEditing && (
        formData.full_name !== initialFormDataRef.current.full_name ||
        formData.city !== initialFormDataRef.current.city ||
        formData.phone !== initialFormDataRef.current.phone ||
        formData.bio !== initialFormDataRef.current.bio ||
        formData.pix_key !== initialFormDataRef.current.pix_key ||
        formData.primary_role !== initialFormDataRef.current.primary_role ||
        formData.roles !== initialFormDataRef.current.roles
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

    const [stats, setStats] = useState({
        completedJobs: 0,
        totalEarnings: 0,
        hoursWorked: 0
    });

    // Account deletion states
    const [deleteModalOpen, setDeleteModalOpen] = useState(false);
    const [deleteConfirmText, setDeleteConfirmText] = useState('');
    const [deleting, setDeleting] = useState(false);

    // QR de identidade + "meu link" (link transitivo)
    const [qrModalOpen, setQrModalOpen] = useState(false);
    const [workerId, setWorkerId] = useState<string | null>(null);
    const [linkCopied, setLinkCopied] = useState(false);
    const [idCopied, setIdCopied] = useState(false);

    // Seções sensíveis (Segurança, Sessão, Zona de Perigo) ficam ocultas por padrão
    const [showAccountSettings, setShowAccountSettings] = useState(false);

    const handleCopyMyLink = useCallback(async () => {
        if (!workerId) return;
        const { url } = TeamConnectionService.generateWorkerInviteToken(workerId);
        try {
            await navigator.clipboard.writeText(url);
            setLinkCopied(true);
            addToast('Link copiado! Envie para uma empresa te adicionar ao elenco.', 'success');
            setTimeout(() => setLinkCopied(false), 2500);
        } catch {
            addToast('Não foi possível copiar o link.', 'error');
        }
    }, [workerId, addToast]);

    // Copia o Worki ID CRU (UUID) — é o que a empresa cola em "Adicionar Freela → Worki ID".
    // Distinto de handleCopyMyLink (que copia a URL do convite).
    const handleCopyWorkiId = useCallback(async () => {
        if (!workerId) return;
        try {
            await navigator.clipboard.writeText(workerId);
            setIdCopied(true);
            addToast('Worki ID copiado! Envie para a empresa te adicionar ao elenco.', 'success');
            setTimeout(() => setIdCopied(false), 2500);
        } catch {
            addToast('Não foi possível copiar o Worki ID.', 'error');
        }
    }, [workerId, addToast]);

    useEffect(() => {
        const fetchProfile = async () => {
            const { data: { user } } = await supabase.auth.getUser();
            if (!user) return navigate('/login');

            setWorkerId(user.id);

            const { data, error } = await supabase
                .from('workers')
                .select('*')
                .eq('id', user.id)
                .single();

            if (error) {
                logError('Error fetching profile:', error);
            } else {
                setProfile(data);
                const loadedFormData: FormData = {
                    full_name: data.full_name || '',
                    city: data.city || '',
                    phone: data.phone || '',
                    bio: data.bio || '',
                    pix_key: data.pix_key || '',
                    primary_role: data.primary_role || '',
                    roles: data.roles ? data.roles.join(', ') : ''
                };
                setFormData(loadedFormData);
                initialFormDataRef.current = loadedFormData;
                setStats({
                    completedJobs: data.completed_jobs_count || 0,
                    totalEarnings: data.earnings_total || 0,
                    hoursWorked: Math.floor((data.completed_jobs_count || 0) * 6)
                });
            }
            setLoading(false);
        };

        fetchProfile();
    }, [navigate]);

    // Best-effort: recomputa XP/nível/ganhos/turnos via RPC (recompute_my_aggregates,
    // SECURITY DEFINER, usa auth.uid()) e mescla o resultado no state do perfil, para a
    // UI refletir o novo XP/nível na hora (sem esperar um reload). Erro aqui não deve
    // quebrar o fluxo de salvar perfil / upload de foto.
    const refreshAggregates = async (profileId: string) => {
        try {
            const { error: rpcError } = await supabase.rpc('recompute_my_aggregates');
            if (rpcError) throw rpcError;

            const { data, error: fetchError } = await supabase
                .from('workers')
                .select('xp, level, earnings_total, completed_jobs_count')
                .eq('id', profileId)
                .maybeSingle();
            if (fetchError) throw fetchError;

            if (data) {
                setProfile(prev => prev ? { ...prev, ...data } : prev);
                setStats(prev => ({
                    ...prev,
                    completedJobs: data.completed_jobs_count ?? prev.completedJobs,
                    totalEarnings: data.earnings_total ?? prev.totalEarnings,
                    hoursWorked: Math.floor((data.completed_jobs_count ?? prev.completedJobs) * 6)
                }));
            }
        } catch (error) {
            logError('Profile.refreshAggregates', error);
        }
    };

    const handleUpload = async (event: React.ChangeEvent<HTMLInputElement>, type: 'avatar' | 'cover') => {
        if (!profile) return;
        try {
            setUploading(true);
            if (!event.target.files || event.target.files.length === 0) {
                return;
            }

            const file = event.target.files[0];
            const allowedTypes = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];
            if (!allowedTypes.includes(file.type)) {
                addToast('Formato não suportado. Use JPG, PNG, WebP ou GIF.', 'error');
                return;
            }
            if (file.size > 5 * 1024 * 1024) {
                addToast('Arquivo muito grande. Máximo 5MB.', 'error');
                return;
            }
            const fileExt = file.name.split('.').pop();
            const fileName = `${profile.id}/${type}_${Date.now()}.${fileExt}`;

            // Upload to 'avatars' bucket (used for both for now, or use 'covers' if exists)
            // Using 'avatars' for simplicity as confirmed it exists
            const { error: uploadError } = await supabase.storage
                .from('avatars')
                .upload(fileName, file, { upsert: true });

            if (uploadError) throw uploadError;

            const { data: { publicUrl } } = supabase.storage.from('avatars').getPublicUrl(fileName);

            const updates: Partial<Pick<WorkerProfile, 'avatar_url' | 'cover_url'>> = {};
            if (type === 'avatar') updates.avatar_url = publicUrl;
            else updates.cover_url = publicUrl;

            const { error: updateError } = await supabase
                .from('workers')
                .update(updates)
                .eq('id', profile.id);

            if (updateError) throw updateError;

            setProfile({ ...profile, ...updates } as WorkerProfile);
            addToast(`${type === 'avatar' ? 'Foto de perfil' : 'Capa'} atualizada!`, 'success');

            if (type === 'avatar') {
                await refreshAggregates(profile.id);
            }
        } catch (error) {
            addToast('Erro ao fazer upload!', 'error');
            logError('Erro inesperado', error);
        } finally {
            setUploading(false);
        }
    };

    const handleSave = async () => {
        if (!profile) return;
        try {
            setLoading(true);
            const rolesArray = formData.roles.split(',').map(r => r.trim()).filter(r => r.length > 0);

            const updates = {
                full_name: formData.full_name,
                city: formData.city,
                phone: formData.phone,
                bio: formData.bio,
                pix_key: formData.pix_key,
                primary_role: formData.primary_role,
                roles: rolesArray,
                updated_at: new Date()
            };

            const { error } = await supabase
                .from('workers')
                .update(updates)
                .eq('id', profile.id);

            if (error) throw error;

            setProfile({ ...profile, ...updates });
            initialFormDataRef.current = { ...formData };
            setIsEditing(false);
            addToast('Perfil atualizado com sucesso!', 'success');

            await refreshAggregates(profile.id);
        } catch (error) {
            addToast('Erro ao atualizar perfil!', 'error');
            logError('Erro inesperado', error);
        } finally {
            setLoading(false);
        }
    };

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

    // R3/R4: logout acessível no mobile (via item "Perfil" do BottomNav) — fonte única
    // AuthContext.signOut, com try/catch + toast de erro + estado de loading (A3/A4).
    const handleLogout = async () => {
        if (loggingOut) return;
        setLoggingOut(true);
        try {
            await signOut();
            navigate('/login');
        } catch (error) {
            logError('Profile.handleLogout', error);
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
            logError(error, 'Profile.handleDeleteAccount');
            addToast(msg, 'error');
            setDeleting(false);
            return;
        }
        await supabase.auth.signOut();
        navigate('/login');
    };

    if (loading) return (
        <div className="flex flex-col gap-8 pb-12 max-w-4xl mx-auto animate-pulse">
            <div className="flex items-center gap-6">
                <div className="w-24 h-24 bg-gray-200 rounded-full" />
                <div className="flex-1 space-y-3">
                    <div className="h-8 bg-gray-200 rounded w-1/3" />
                    <div className="h-4 bg-gray-200 rounded w-1/2" />
                </div>
            </div>
            <div className="space-y-4">
                {[...Array(4)].map((_, i) => (
                    <div key={i} className="h-14 bg-gray-200 rounded-xl" />
                ))}
            </div>
        </div>
    );

    if (!profile) return <div className="text-center p-8">Erro ao carregar perfil.</div>;

    return (
        <>
        <div className="flex flex-col gap-8 pb-12 font-sans text-accent max-w-4xl mx-auto">

            {/* Header / Cover */}
            <div className="relative mb-32 sm:mb-12 group">
                <div className="h-48 bg-gray-900 rounded-3xl border-2 border-black overflow-hidden relative">
                    {profile.cover_url ? (
                        <img src={profile.cover_url} alt="Foto de capa do perfil" className="w-full h-full object-cover" />
                    ) : (
                        <div className="w-full h-full bg-gradient-to-r from-gray-900 to-black"></div>
                    )}

                    {/* Cover Upload Button */}
                    <div className="absolute top-4 right-4 opacity-0 group-hover:opacity-100 transition-opacity">
                        <button onClick={() => coverInputRef.current?.click()} className="bg-black/50 text-white p-2 rounded-lg backdrop-blur-sm hover:bg-black transition-colors">
                            <Camera size={20} />
                        </button>
                    </div>
                </div>
                <input
                    type="file"
                    ref={coverInputRef}
                    className="hidden"
                    accept="image/*"
                    aria-label="Upload foto de capa"
                    onChange={(e) => handleUpload(e, 'cover')}
                    disabled={uploading}
                />

                {/* Profile Card Overlay */}
                <div className="absolute -bottom-12 left-6 right-6 flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
                    <div className="flex items-end gap-4 min-w-0">
                        <div className="w-28 h-28 sm:w-32 sm:h-32 shrink-0 aspect-square bg-white rounded-full border-4 border-black p-1 relative shadow-[4px_4px_0px_0px_rgba(0,166,81,1)] group">
                            {/* Avatar Placeholder or Image */}
                            <div className="w-full h-full bg-gray-200 rounded-full flex items-center justify-center overflow-hidden relative">
                                {profile.avatar_url ? (
                                    <img src={profile.avatar_url} alt={profile.full_name} className="w-full h-full object-cover" />
                                ) : (
                                    <User size={64} className="text-gray-400" />
                                )}

                                {/* Camera Overlay for Upload */}
                                <div className="absolute inset-0 bg-black/50 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity cursor-pointer" onClick={() => fileInputRef.current?.click()}>
                                    <Camera className="text-white" size={24} />
                                </div>
                                <input
                                    type="file"
                                    ref={fileInputRef}
                                    className="hidden"
                                    accept="image/*"
                                    aria-label="Upload foto de perfil"
                                    onChange={(e) => handleUpload(e, 'avatar')}
                                    disabled={uploading}
                                />
                            </div>
                            {profile.verified_identity && (
                                <div className="absolute bottom-0 right-0 bg-blue-500 text-white p-1 rounded-full border-2 border-white" title="Identidade Verificada">
                                    <ShieldCheck size={16} strokeWidth={3} />
                                </div>
                            )}
                        </div>
                        <div className="mb-2">
                            {isEditing ? (
                                <input
                                    type="text"
                                    value={formData.full_name}
                                    onChange={(e) => setFormData({ ...formData, full_name: e.target.value })}
                                    aria-label="Nome completo"
                                    className="text-2xl sm:text-3xl font-black uppercase tracking-tight text-white [text-shadow:_0_1px_3px_rgba(0,0,0,0.9)] bg-transparent border-b border-white mb-2 w-full outline-none"
                                />
                            ) : (
                                <h1 className="text-2xl sm:text-3xl font-black uppercase tracking-tight text-white [text-shadow:_0_1px_3px_rgba(0,0,0,0.9)] break-words">{profile.full_name}</h1>
                            )}

                            <div className="flex items-center gap-2 text-white/80 font-bold text-sm bg-black/50 px-2 py-1 rounded-lg backdrop-blur-sm w-fit">
                                <MapPin size={14} />
                                {isEditing ? (
                                    <input
                                        type="text"
                                        value={formData.city}
                                        onChange={(e) => setFormData({ ...formData, city: e.target.value })}
                                        aria-label="Cidade"
                                        className="bg-transparent border-b border-white/50 text-white w-24 outline-none"
                                    />
                                ) : (
                                    profile.city
                                )}
                            </div>
                        </div>
                    </div>

                    <div className="flex gap-2 mb-2">
                        {isEditing ? (
                            <>
                                <button onClick={() => setIsEditing(false)} className="bg-white text-black px-4 py-2 rounded-xl font-bold uppercase text-sm border-2 border-black hover:bg-gray-100 transition-all">
                                    <X size={16} className="inline mr-1" /> Cancelar
                                </button>
                                <button onClick={handleSave} className="bg-primary text-white px-6 py-2 rounded-xl font-black uppercase text-sm border-2 border-black hover:bg-green-600 transition-all shadow-[2px_2px_0px_0px_rgba(0,0,0,1)]">
                                    <Save size={16} className="inline mr-1" /> Salvar
                                </button>
                            </>
                        ) : (
                            <>
                                <button
                                    onClick={() => setQrModalOpen(true)}
                                    aria-label="Ver meu QR de identidade"
                                    className="bg-white text-black p-2 rounded-xl border-2 border-black hover:bg-gray-100 transition-all shadow-[2px_2px_0px_0px_rgba(0,0,0,1)]"
                                >
                                    <QrCode size={18} />
                                </button>
                                <button onClick={() => setIsEditing(true)} className="bg-white text-black px-6 py-2 rounded-xl font-black uppercase text-sm border-2 border-black hover:bg-primary hover:text-white transition-all shadow-[2px_2px_0px_0px_rgba(0,0,0,1)]">
                                    <Edit2 size={16} className="inline mr-2" /> Editar Perfil
                                </button>
                            </>
                        )}
                    </div>
                </div>
            </div>

            {/* Main Info Grid */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-8 mt-4">

                {/* Left Column: Stats & Skills */}
                <div className="space-y-6">

                    {/* Level Card */}
                    <div className="bg-black text-white p-6 rounded-2xl border-2 border-black shadow-[4px_4px_0px_0px_rgba(0,0,0,0.2)]">
                        <div className="flex justify-between items-start mb-4">
                            <div>
                                <span className="text-xs font-bold uppercase text-primary tracking-widest">Nível</span>
                                <h2 className="text-5xl font-black italic">LVL {profile.level || 1}</h2>
                            </div>
                            <Award className="text-primary" size={32} />
                        </div>
                        <div className="w-full bg-white/20 h-2 rounded-full overflow-hidden">
                            {/* Mock progress based on XP - assuming 100XP per level */}
                            <div className="bg-primary h-full" style={{ width: `${(profile.xp || 0) % 100}%` }}></div>
                        </div>
                        <p className="text-xs font-bold text-gray-400 mt-2">{profile.xp || 0} XP Total</p>
                    </div>

                    {/* Stats */}
                    <div className="bg-white p-6 rounded-2xl border-2 border-black shadow-[4px_4px_0px_0px_rgba(0,0,0,0.08)]">
                        <h3 className="text-lg font-black uppercase mb-4">Estatísticas</h3>
                        <div className="space-y-4">
                            <div className="flex justify-between items-center border-b border-gray-100 pb-2">
                                <span className="text-sm font-bold text-gray-500">Turnos Realizados</span>
                                <span className="text-lg font-black">{stats.completedJobs}</span>
                            </div>
                            <div className="flex justify-between items-center border-b border-gray-100 pb-2">
                                <span className="text-sm font-bold text-gray-500">Horas Totais</span>
                                <span className="text-lg font-black">{stats.hoursWorked}h</span>
                            </div>
                            <div className="flex justify-between items-center">
                                <span className="text-sm font-bold text-gray-500">Avaliação</span>
                                <span className="flex items-center gap-1 text-lg font-black text-yellow-500">
                                    <Star size={18} fill="currentColor" /> {profile.rating_average || '-'}
                                </span>
                            </div>
                        </div>
                    </div>

                    {/* Payments */}
                    <div className="bg-white p-6 rounded-2xl border-2 border-black shadow-[4px_4px_0px_0px_rgba(0,0,0,0.08)]">
                        <div className="flex justify-between items-center mb-4">
                            <h3 className="text-lg font-black uppercase flex items-center gap-2">
                                <CreditCard size={20} /> Recebimento
                            </h3>
                        </div>
                        <p className="text-sm text-gray-500 mb-4">Gerencie seus ganhos e saques na sua carteira.</p>

                        <button
                            onClick={() => navigate('/wallet')}
                            className="w-full bg-black text-white py-3 rounded-xl font-bold hover:bg-gray-800 transition-all flex justify-center items-center gap-2"
                        >
                            Ir para Carteira
                        </button>
                    </div>

                    {/* Contact Info */}
                    <div className="bg-white p-6 rounded-2xl border-2 border-black shadow-[4px_4px_0px_0px_rgba(0,0,0,0.08)]">
                        <h3 className="text-lg font-black uppercase mb-4">Contato</h3>
                        <div className="space-y-4 text-sm font-bold text-gray-600">
                            <div className="flex items-center gap-2">
                                <Phone size={16} />
                                {isEditing ? (
                                    <input
                                        type="tel"
                                        value={formData.phone}
                                        onChange={(e) => setFormData({ ...formData, phone: e.target.value })}
                                        aria-label="Telefone"
                                        className="border-b border-gray-300 w-full outline-none focus:border-black"
                                        placeholder="(00) 00000-0000"
                                    />
                                ) : (
                                    profile.phone || "Não informado"
                                )}
                            </div>
                        </div>
                    </div>

                </div>

                {/* Right Column: Roles, Bio, Reviews */}
                <div className="md:col-span-2 space-y-8">

                    {/* Roles & Bio */}
                    <div className="bg-white p-8 rounded-2xl border-2 border-black shadow-[6px_6px_0px_0px_rgba(0,0,0,0.1)]">
                        <div className="mb-6">
                            <h3 className="text-xl font-black uppercase mb-3 flex items-center gap-2">
                                <Briefcase size={20} /> Especialidades
                            </h3>

                            {isEditing ? (
                                <div className="space-y-2">
                                    <input
                                        type="text"
                                        value={formData.primary_role}
                                        onChange={(e) => setFormData({ ...formData, primary_role: e.target.value })}
                                        placeholder="Função Principal (ex: Bartender)"
                                        aria-label="Funcao principal"
                                        className="w-full border-2 border-black rounded-xl px-4 py-3 focus:ring-2 focus:ring-primary outline-none"
                                    />
                                    <textarea
                                        value={formData.roles}
                                        onChange={(e) => setFormData({ ...formData, roles: e.target.value })}
                                        placeholder="Outras habilidades (separe por vírgula)"
                                        aria-label="Especialidades"
                                        className="w-full border-2 border-black rounded-xl px-4 py-3 focus:ring-2 focus:ring-primary outline-none h-20"
                                    />
                                    <p className="text-xs text-gray-400">Separe as especialidades por vírgula.</p>
                                </div>
                            ) : (
                                <div className="flex flex-wrap gap-2">
                                    {profile.roles && (Array.isArray(profile.roles) ? profile.roles : [profile.primary_role]).map((role: string, i: number) => (
                                        <span key={i} className="bg-black text-white px-4 py-2 rounded-lg font-bold uppercase text-sm border-2 border-black hover:bg-white hover:text-black transition-colors">
                                            {role}
                                        </span>
                                    ))}
                                    {(!profile.roles || profile.roles.length === 0) && !profile.primary_role && (
                                        <span className="text-gray-400 italic font-medium">Nenhuma especialidade listada.</span>
                                    )}
                                </div>
                            )}
                        </div>

                        <div className="mb-6">
                            <h3 className="text-xl font-black uppercase mb-3">Sobre</h3>
                            {isEditing ? (
                                <textarea
                                    value={formData.bio}
                                    onChange={(e) => setFormData({ ...formData, bio: e.target.value })}
                                    aria-label="Sobre voce"
                                    className="w-full border-2 border-black rounded-xl px-4 py-3 focus:ring-2 focus:ring-primary outline-none h-32"
                                    placeholder="Conte um pouco sobre sua experiência..."
                                />
                            ) : (
                                <p className="text-gray-600 font-medium leading-relaxed">
                                    {profile.bio || "Este profissional ainda não adicionou uma biografia."}
                                </p>
                            )}
                        </div>

                        <div className="grid grid-cols-2 gap-4">
                            <div className="bg-gray-50 p-4 rounded-xl border border-gray-200">
                                <span className="block text-xs font-bold uppercase text-gray-400 mb-1">Experiência</span>
                                <span className="block text-lg font-black">{profile.experience_years || "Iniciante"}</span>
                            </div>
                            <div className="bg-gray-50 p-4 rounded-xl border border-gray-200">
                                <span className="block text-xs font-bold uppercase text-gray-400 mb-1">Disponibilidade</span>
                                <span className="block text-lg font-black truncate" title={Array.isArray(profile.availability) ? profile.availability.join(', ') : profile.availability || undefined}>
                                    {Array.isArray(profile.availability) && profile.availability.length > 0 ? profile.availability[0] + (profile.availability.length > 1 ? ` +${profile.availability.length - 1}` : '') : (profile.availability || "N/A")}
                                </span>
                            </div>
                        </div>
                    </div>

                    {/* Avaliações recebidas de empresas */}
                    {workerId && <ProfileReviews reviewedId={workerId} reviewerRole="company" />}

                </div>

            </div>

            {/* Meu link de perfil — seção top-level (G2). Espelha a seção equivalente
                do CompanyProfile.tsx. O botão dentro do modal QR foi mantido também. */}
            <div className="border-t-2 border-gray-200 pt-8 mt-8">
                <h3 className="text-xl font-black uppercase mb-4 flex items-center gap-2">
                    <Link2 size={20} /> Meu Link de Perfil
                </h3>
                <p className="text-sm text-gray-600 mb-4">
                    Compartilhe este link com uma empresa (WhatsApp, etc.) para ela te adicionar ao elenco
                    sem precisar de QR ou Worki ID.
                </p>
                <button
                    onClick={handleCopyMyLink}
                    disabled={!workerId}
                    className="flex items-center justify-center gap-2 bg-black text-white px-6 py-3 rounded-xl font-black uppercase hover:bg-gray-800 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                >
                    {linkCopied ? <Check size={18} /> : <Copy size={18} />}
                    {linkCopied ? 'Link copiado!' : 'Copiar meu link'}
                </button>
            </div>

            {/* Botão de toggle para as seções sensíveis (Segurança, Sessão, Zona de Perigo) */}
            <div className="border-t-2 border-gray-200 pt-8 mt-8">
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
                    <div className="border-t-2 border-gray-200 pt-8 mt-8">
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
                    <div className="border-t-2 border-gray-200 pt-8 mt-8">
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
                    <div className="border-t-2 border-red-200 pt-8 mt-8">
                        <h3 className="text-red-600 font-black uppercase text-lg mb-4">Zona de Perigo</h3>
                        <p className="text-sm text-gray-600 mb-4">A exclusão da sua conta é irreversível. Todos os seus dados pessoais serão anonimizados.</p>
                        <button
                            onClick={() => setDeleteModalOpen(true)}
                            className="border-2 border-red-500 text-red-500 bg-white hover:bg-red-50 font-bold uppercase px-4 py-2 rounded-xl transition-colors"
                        >
                            Excluir minha conta
                        </button>
                    </div>
                </>
            )}

        </div>

        {/* Modal QR de identidade */}
        {qrModalOpen && workerId && (
            <div className="fixed inset-0 bg-black/80 z-50 flex items-center justify-center p-4 animate-in fade-in duration-200">
                <div className="bg-white rounded-2xl w-full max-w-sm p-6 border-2 border-black shadow-[8px_8px_0px_0px_rgba(0,166,81,1)]">
                    <div className="flex items-center justify-between mb-4">
                        <h2 className="text-xl font-black uppercase tracking-tight">Meu QR de Identidade</h2>
                        <button onClick={() => setQrModalOpen(false)} aria-label="Fechar" className="p-2 hover:bg-gray-100 rounded-xl transition-colors">
                            <X size={20} />
                        </button>
                    </div>
                    <p className="text-sm font-bold text-gray-600 mb-5 text-center">
                        Mostre este QR para uma empresa te adicionar ao elenco dela. Cada scan é único para você.
                    </p>
                    <div className="flex justify-center mb-5">
                        <div className="p-4 border-2 border-black rounded-2xl bg-white shadow-[4px_4px_0px_0px_rgba(0,166,81,1)]">
                            <QRCodeSVG
                                value={workerId}
                                size={200}
                                level="M"
                                includeMargin={false}
                            />
                        </div>
                    </div>
                    <div className="bg-gray-50 border-2 border-gray-200 rounded-xl p-3 text-center">
                        <p className="text-xs font-bold uppercase text-gray-400 mb-1">Worki ID</p>
                        <p className="font-mono text-xs font-bold text-gray-700 break-all">{workerId}</p>
                    </div>
                    <button
                        onClick={handleCopyWorkiId}
                        className="w-full mt-3 bg-black hover:bg-primary text-white px-6 py-3 rounded-xl font-black uppercase text-sm flex items-center justify-center gap-2 transition-colors"
                    >
                        {idCopied ? <Check size={18} /> : <Copy size={18} />}
                        {idCopied ? 'Worki ID copiado!' : 'Copiar Worki ID'}
                    </button>
                    <button
                        onClick={handleCopyMyLink}
                        className="w-full mt-2 bg-white hover:bg-gray-50 text-black border-2 border-black px-6 py-3 rounded-xl font-black uppercase text-sm flex items-center justify-center gap-2 transition-colors"
                    >
                        {linkCopied ? <Check size={18} /> : <Copy size={18} />}
                        {linkCopied ? 'Link copiado!' : 'Copiar meu link'}
                    </button>
                    <p className="text-xs text-gray-400 text-center mt-3 font-bold">
                        Cole o <span className="font-black">Worki ID</span> quando a empresa pedir, ou envie o link direto (WhatsApp, etc.) para ela te adicionar ao elenco.
                    </p>
                </div>
            </div>
        )}

        {/* Modal de confirmação de exclusão */}
        {deleteModalOpen && (
            <div className="fixed inset-0 bg-black/80 z-50 flex items-center justify-center p-4">
                <div className="bg-white rounded-2xl w-full max-w-md p-6 border-2 border-black shadow-[8px_8px_0px_0px_rgba(0,0,0,1)]">
                    <h2 className="text-xl font-black uppercase tracking-tight mb-4 text-red-600">Tem certeza? Esta ação é irreversível.</h2>
                    <ul className="space-y-2 mb-6 text-sm text-gray-700">
                        <li className="flex items-start gap-2">
                            <span className="font-black text-red-500 mt-0.5">•</span>
                            Seu perfil e dados pessoais serão anonimizados
                        </li>
                        <li className="flex items-start gap-2">
                            <span className="font-black text-red-500 mt-0.5">•</span>
                            Turnos e convites ativos serão cancelados
                        </li>
                        <li className="flex items-start gap-2">
                            <span className="font-black text-red-500 mt-0.5">•</span>
                            Seu saldo restante na carteira será perdido
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
                        aria-label="Confirmar exclusão"
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
