
import { useEffect, useState, useRef, useCallback } from 'react';
import { levelProgress } from '../lib/gamification';
import { useModalDismiss } from '../hooks/useModalDismiss';
import { supabase } from '../lib/supabase';
import { User, MapPin, ShieldCheck, Edit2, Award, Save, X, Camera, Lock, QrCode, Copy, Check, LogOut, Link2, Settings, Receipt, ChevronRight, CalendarClock, Star, Share2, HelpCircle } from 'lucide-react';
import { Button, Card, Field } from '../components/ui';
import ProfileReviews from '../components/ProfileReviews';
import MyCertificationsSection from '../components/MyCertificationsSection';
import CompanyBadges from '../components/CompanyBadges';
import ReferralOptOutSection from '../components/ReferralOptOutSection';
import SosDiscoverySection from '../components/SosDiscoverySection';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { useToast } from '../contexts/ToastContext';
import { getPasswordStrength, validateCPFOrCNPJ, EMAIL_REGEX, formatCpfCnpj, normalizePixKeyForStorage, type PixKeyType } from '../lib/validation';
import { logError } from '../lib/logger';
import { QRCodeSVG } from 'qrcode.react';
import { TeamConnectionService } from '../services/teamConnectionService';
import { normalizeAvailabilityGrade } from '../lib/availability';
import type { AvailabilityDays, AvailabilityPeriod, AvailabilityWeekday } from '../types';
import { SHIFT_CATEGORIES } from '../components/company/shiftCategories';

// F7 — grade de disponibilidade: dia (0=domingo..6=sábado, mesma convenção de `job_series.weekdays`)
// × período. Vive em estado PRÓPRIO (fora de `FormData`) porque não é texto — é a mesma estrutura
// `AvailabilityDays` gravada em `workers.availability_days` (DDL `.harness/spec/disponibilidade-freela/ddl-aprovado.md`).
const AVAILABILITY_WEEKDAYS: AvailabilityWeekday[] = ['0', '1', '2', '3', '4', '5', '6'];
const AVAILABILITY_PERIODS: AvailabilityPeriod[] = ['manha', 'tarde', 'noite'];
const AVAILABILITY_WEEKDAY_LABELS: Record<AvailabilityWeekday, string> = {
    '0': 'Dom', '1': 'Seg', '2': 'Ter', '3': 'Qua', '4': 'Qui', '5': 'Sex', '6': 'Sáb',
};
const AVAILABILITY_PERIOD_LABELS: Record<AvailabilityPeriod, string> = {
    manha: 'Manhã', tarde: 'Tarde', noite: 'Noite',
};

// Tipo de chave PIX — não persistido (a coluna `workers.pix_key` guarda só o valor,
// mesmo padrão do `WorkerOnboarding`). Serve só para escolher a máscara/validação
// certa ao editar; o tipo "adivinhado" na carga inicial é só um ponto de partida.
// `PixKeyType` e `normalizePixKeyForStorage` vêm de lib/validation (fonte única, sem
// duplicar entre Profile e WorkerOnboarding).

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

const PIX_UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Melhor palpite de tipo a partir do valor já salvo (o tipo não é persistido). */
function guessPixKeyType(value: string): PixKeyType {
    if (!value) return 'cpf';
    if (PIX_UUID_RE.test(value)) return 'aleatoria';
    if (EMAIL_REGEX.test(value)) return 'email';
    const digits = value.replace(/\D/g, '');
    if (digits.length === 14) return 'cnpj';
    if (digits.length === 11) return 'cpf';
    if (digits.length >= 10) return 'telefone';
    return 'cpf';
}

interface WorkerProfile {
    id: string;
    full_name: string;
    city: string;
    phone: string;
    bio: string;
    cpf: string | null;
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
    availability_days?: AvailabilityDays | null;
    updated_at?: Date;
}

interface FormData {
    full_name: string;
    city: string;
    phone: string;
    bio: string;
    cpf: string;
    pix_key: string;
    primary_role: string;
    roles: string;
}

/**
 * Soma as horas REAIS de turno do freela, a partir do par check-in/check-out de cada
 * `applications` concluida.
 *
 * Antes isso era `completed_jobs_count * 6` -- um chute de seis horas por turno, exibido ao
 * freela sob o rotulo "Horas Totais" como se fosse medida. Um turno de 1 minuto contava 6h.
 * O dado verdadeiro sempre esteve na propria linha (`worker_checkin_at`/`worker_checkout_at`),
 * e o recibo ja o calculava -- as duas telas do mesmo app discordavam sobre a mesma jornada.
 *
 * Turno concluido sem check-in ou sem check-out soma zero: nao ha o que medir, e estimar de novo
 * seria repetir o erro. Falha de leitura devolve 0 em vez de derrubar o perfil.
 */
async function somarHorasRegistradas(workerId: string): Promise<number> {
    try {
        const { data, error } = await supabase
            .from('applications')
            .select('worker_checkin_at, worker_checkout_at')
            .eq('worker_id', workerId)
            .eq('status', 'completed');
        if (error || !data) return 0;

        const ms = data.reduce((total, row) => {
            if (!row.worker_checkin_at || !row.worker_checkout_at) return total;
            const entrada = new Date(row.worker_checkin_at).getTime();
            const saida = new Date(row.worker_checkout_at).getTime();
            if (Number.isNaN(entrada) || Number.isNaN(saida) || saida <= entrada) return total;
            return total + (saida - entrada);
        }, 0);

        return Math.floor(ms / 3_600_000);
    } catch {
        return 0;
    }
}

export default function Profile() {
    const navigate = useNavigate();
    const { signOut } = useAuth();
    const [loading, setLoading] = useState(true);
    const [salvando, setSalvando] = useState(false);
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
        cpf: '',
        pix_key: '',
        primary_role: '',
        roles: '' // comma separated string for editing
    });

    // Tipo de chave PIX selecionado na edição — não persistido, só orienta máscara/validação.
    const [pixKeyType, setPixKeyType] = useState<PixKeyType>('cpf');

    // --- CPF -------------------------------------------------------------------------------
    // O termo de prestação (F6) exige CPF. Sem ele, `acceptServiceTerm` devolve `missing_cpf` e o
    // freela fica sem saída: já trabalhou, a empresa já registrou o pagamento, e não havia tela
    // onde ele pudesse resolver isso sozinho — só "fale com a empresa ou o suporte". Conferido em
    // produção: 4 dos 15 freelas estavam nessa situação.
    //
    // Editável SÓ enquanto está vazio. Depois de preenchido, o CPF é o que identifica a pessoa nos
    // termos já assinados; deixá-lo como campo livre seria vetor de fraude, não conveniência.
    // Correção de um CPF já gravado continua sendo caminho humano, de propósito.
    const cpfJaCadastrado = !!(profile?.cpf && String(profile.cpf).trim());
    const cpfDigitado = formData.cpf.replace(/\D/g, '');
    const cpfValido = cpfDigitado.length === 11 && validateCPFOrCNPJ(formData.cpf);

    // F7 — grade de disponibilidade em edição. `{}` é só o estado transitório do formulário;
    // NUNCA é o que se grava (ver `handleSave` — `normalizeAvailabilityGrade` poda para `null`
    // quando vazia, LM-8 do DDL: `null` e `{}` não podem coexistir como "não declarou").
    const [availabilityGrade, setAvailabilityGrade] = useState<AvailabilityDays>({});
    const initialAvailabilityGradeRef = useRef<AvailabilityDays>({});

    // Track initial form data for dirty detection
    const initialFormDataRef = useRef<FormData>({
        full_name: '',
        city: '',
        phone: '',
        bio: '',
        cpf: '',
        pix_key: '',
        primary_role: '',
        roles: ''
    });

    const isDirty = isEditing && (
        formData.full_name !== initialFormDataRef.current.full_name ||
        formData.city !== initialFormDataRef.current.city ||
        formData.phone !== initialFormDataRef.current.phone ||
        formData.bio !== initialFormDataRef.current.bio ||
        formData.cpf !== initialFormDataRef.current.cpf ||
        formData.pix_key !== initialFormDataRef.current.pix_key ||
        formData.primary_role !== initialFormDataRef.current.primary_role ||
        formData.roles !== initialFormDataRef.current.roles ||
        JSON.stringify(availabilityGrade) !== JSON.stringify(initialAvailabilityGradeRef.current)
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
    // Saida de emergencia do modal do QR (heuristica #3) — mesmo contrato dos demais modais.
    const fecharExclusaoPeloFundo = useModalDismiss(() => {
        if (deleteModalOpen) { setDeleteModalOpen(false); setDeleteConfirmText(''); }
        else if (qrModalOpen) setQrModalOpen(false);
    });
    const fecharQrPeloFundo = (e: React.MouseEvent<HTMLElement>) => {
        if (e.target === e.currentTarget) setQrModalOpen(false);
    };
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
                    cpf: formatCpfCnpj(data.cpf || ''),
                    pix_key: data.pix_key || '',
                    primary_role: data.primary_role || '',
                    roles: data.roles ? data.roles.join(', ') : ''
                };
                setFormData(loadedFormData);
                initialFormDataRef.current = loadedFormData;
                setPixKeyType(guessPixKeyType(loadedFormData.pix_key));
                const loadedGrade: AvailabilityDays = data.availability_days ?? {};
                setAvailabilityGrade(loadedGrade);
                initialAvailabilityGradeRef.current = loadedGrade;
                setStats({
                    completedJobs: data.completed_jobs_count || 0,
                    totalEarnings: data.earnings_total || 0,
                    hoursWorked: await somarHorasRegistradas(user.id),
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
                const horasReais = await somarHorasRegistradas(profileId);
                setStats(prev => ({
                    ...prev,
                    completedJobs: data.completed_jobs_count ?? prev.completedJobs,
                    totalEarnings: data.earnings_total ?? prev.totalEarnings,
                    hoursWorked: horasReais
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

            // .select('id') obrigatório (patterns.md — UPDATE sob RLS negado em silêncio):
            // sem isso, um UPDATE negado devolveria 204 sem erro e a UI afirmaria sucesso.
            const { data: updateData, error: updateError } = await supabase
                .from('workers')
                .update(updates)
                .eq('id', profile.id)
                .select('id');

            if (updateError) throw updateError;
            if (!updateData || updateData.length === 0) {
                throw new Error('Não foi possível salvar a imagem: verifique se você ainda tem permissão para editar este perfil.');
            }

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

    // Formata a chave PIX conforme o tipo escolhido — mesmas máscaras do WorkerOnboarding.
    const formatPixKey = (type: PixKeyType, value: string) => {
        if (type === 'cpf' || type === 'cnpj') return formatCpfCnpj(value);
        if (type === 'telefone') {
            const digits = value.replace(/\D/g, '').slice(0, 11);
            if (digits.length <= 10) return digits.replace(/(\d{2})(\d{4})(\d{0,4})/, '($1) $2-$3');
            return digits.replace(/(\d{2})(\d{5})(\d{0,4})/, '($1) $2-$3');
        }
        return value;
    };

    // Valida a chave PIX conforme o tipo — reusa lib/validation, mesmo padrão do WorkerOnboarding.
    const isValidPixKey = () => {
        const key = formData.pix_key.trim();
        if (!key) return true; // campo opcional na edição — vazio é permitido (freela ainda não configurou)
        switch (pixKeyType) {
            case 'cpf':
                return key.replace(/\D/g, '').length === 11 && validateCPFOrCNPJ(key);
            case 'cnpj':
                return key.replace(/\D/g, '').length === 14 && validateCPFOrCNPJ(key);
            case 'email':
                return EMAIL_REGEX.test(key);
            case 'telefone':
                return key.replace(/\D/g, '').length >= 10;
            case 'aleatoria':
                return PIX_UUID_RE.test(key);
            default:
                return false;
        }
    };

    // F7 — liga/desliga um único slot (dia × período) da grade em edição. Poda a chave do dia
    // quando o último período dela é removido, para o objeto local nunca acumular `{ "2": [] }"
    // (a poda final para NULL acontece em `handleSave`, via `normalizeAvailabilityGrade`).
    const toggleAvailabilitySlot = (day: AvailabilityWeekday, period: AvailabilityPeriod) => {
        setAvailabilityGrade(prev => {
            const current = prev[day] ?? [];
            const nextPeriods = current.includes(period)
                ? current.filter(p => p !== period)
                : [...current, period];
            const next = { ...prev };
            if (nextPeriods.length === 0) delete next[day];
            else next[day] = nextPeriods;
            return next;
        });
    };

    const handleCancelEdit = () => {
        // Cancelar = descartar (N3): restaura o baseline salvo.
        setFormData({ ...initialFormDataRef.current });
        setAvailabilityGrade({ ...initialAvailabilityGradeRef.current });
        setPixKeyType(guessPixKeyType(initialFormDataRef.current.pix_key));
        setIsEditing(false);
    };

    const handleSave = async () => {
        if (!profile) return;
        // Só valida a chave PIX se o freela de fato mexeu nela nesta edição. Um valor legado
        // (ex.: telefone salvo antes de existir o campo de tipo) pode não bater com o tipo
        // "adivinhado" por guessPixKeyType — sem essa guarda, isso travaria o salvamento do
        // resto do perfil (bio, foto, etc.) mesmo quando o freela nunca tocou no PIX.
        const pixKeyTouched = formData.pix_key !== initialFormDataRef.current.pix_key;
        if (pixKeyTouched && !isValidPixKey()) {
            addToast(`Chave PIX inválida para o tipo "${PIX_KEY_LABELS[pixKeyType]}". Corrija antes de salvar.`, 'error');
            return;
        }
        try {
            // Estado proprio: reusar o `loading` da pagina trocava o formulario inteiro pelo
            // skeleton durante o request — parecia recarga/perda do que foi digitado (N1).
            setSalvando(true);
            const rolesArray = formData.roles.split(',').map(r => r.trim()).filter(r => r.length > 0);

            // F7 — `normalizeAvailabilityGrade` poda dias sem período e devolve `null` (SQL NULL)
            // quando a grade fica vazia — NUNCA `{}` (LM-8 do DDL: duas representações de "vazio"
            // quebrariam o CTA `availability_days IS NULL` do Dashboard).
            const updates = {
                full_name: formData.full_name,
                city: formData.city,
                phone: formData.phone,
                bio: formData.bio,
                pix_key: normalizePixKeyForStorage(pixKeyType, formData.pix_key),
                // Só entra no payload quando ainda não havia CPF — nunca sobrescreve um já gravado.
                ...(!cpfJaCadastrado && cpfValido ? { cpf: cpfDigitado } : {}),
                primary_role: formData.primary_role,
                roles: rolesArray,
                availability_days: normalizeAvailabilityGrade(availabilityGrade),
                updated_at: new Date()
            };

            // .select('id') obrigatório (patterns.md — UPDATE sob RLS negado em silêncio):
            // "Perfil atualizado com sucesso!" não pode mentir quando a RLS negou o UPDATE.
            const { data, error } = await supabase
                .from('workers')
                .update(updates)
                .eq('id', profile.id)
                .select('id');

            if (error) throw error;
            if (!data || data.length === 0) {
                throw new Error('Não foi possível salvar o perfil: verifique se você ainda tem permissão para editar.');
            }

            setProfile({ ...profile, ...updates });
            initialFormDataRef.current = { ...formData };
            // F7 — a grade em edição vira o novo "baseline" (não o valor normalizado gravado:
            // `{}` local continua representando "nada marcado" na UI de edição; a poda para
            // `null` só importa no que vai pro banco, feita acima em `updates`).
            initialAvailabilityGradeRef.current = { ...availabilityGrade };
            setIsEditing(false);
            addToast('Perfil atualizado com sucesso!', 'success');

            await refreshAggregates(profile.id);
        } catch (error) {
            addToast('Erro ao atualizar perfil!', 'error');
            logError('Erro inesperado', error);
        } finally {
            setSalvando(false);
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
            // O minimo de 8 ja foi validado acima — culpar a senha em falha de rede/sessao
            // manda o freela "consertar" o que nao esta quebrado (N9).
            addToast(
                pwError.message?.toLowerCase().includes('weak') || pwError.message?.toLowerCase().includes('password')
                    ? 'Senha muito fraca. Use letras e números.'
                    : 'Não foi possível alterar a senha agora. Verifique sua conexão e tente de novo.',
                'error'
            );
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
        <div className="mx-auto max-w-3xl animate-pulse space-y-6 pb-12" aria-busy="true">
            <div className="h-28 rounded-2xl bg-gray-200" />
            <div className="space-y-4">
                {[...Array(4)].map((_, i) => (
                    <div key={i} className="h-24 rounded-2xl bg-gray-200" />
                ))}
            </div>
        </div>
    );

    if (!profile) return <div className="text-center p-8">Erro ao carregar perfil.</div>;

    // Pares Cancelar/Salvar: UMA definição, renderizada no hero (desktop) e na barra fixa (mobile).
    // CTA único de salvar — mesmo texto, mesma variante, mesmo estado de loading nos dois lugares.
    const editActions = (
        <>
            <Button variant="secondary" onClick={handleCancelEdit} iconLeft={<X size={16} />}>
                Cancelar
            </Button>
            <Button variant="primary" onClick={handleSave} loading={salvando} iconLeft={<Save size={16} />}>
                Salvar
            </Button>
        </>
    );

    const nivel = levelProgress(profile.xp || 0);
    const gradeDeclarada = Object.keys(profile.availability_days ?? {}).length > 0;

    return (
        <>
        <div className="mx-auto max-w-3xl space-y-6 pb-12 font-sans text-accent">
            {/* Como a empresa te encontra — link e Worki ID no topo (pedido dos usuarios: o link
                do freela precisa estar bem visivel). Mesmos handlers do modal do QR; nenhuma logica nova. */}
            {!isEditing && (
                <Card
                    as="section"
                    aria-label="Compartilhar meu perfil com empresas"
                    className="shadow-[4px_4px_0px_0px_rgba(0,166,81,1)]"
                >
                    <div className="flex items-start gap-3">
                        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-primary-light text-primary">
                            <Link2 size={20} />
                        </span>
                        <div className="min-w-0">
                            <h2 className="text-lg font-bold leading-tight">Me adicionar a uma empresa</h2>
                            <p className="mt-1 text-sm text-gray-600">
                                Link: a empresa abre e te adiciona. Worki ID: ela digita no app.
                            </p>
                        </div>
                    </div>
                    <div className="mt-4 flex flex-col gap-2 sm:flex-row">
                        <Button
                            variant="primary"
                            onClick={handleCopyMyLink}
                            disabled={!workerId}
                            iconLeft={linkCopied ? <Check size={18} /> : <Copy size={18} />}
                            className="w-full sm:w-auto"
                        >
                            {linkCopied ? 'Link copiado!' : 'Copiar meu link'}
                        </Button>
                        <Button
                            variant="secondary"
                            onClick={handleCopyWorkiId}
                            disabled={!workerId}
                            iconLeft={idCopied ? <Check size={18} /> : <Copy size={18} />}
                            className="w-full sm:w-auto"
                        >
                            {idCopied ? 'Worki ID copiado!' : 'Copiar Worki ID'}
                        </Button>
                    </div>
                </Card>
            )}

            {/* Identidade: capa + avatar + nome. Em edicao, nome/cidade viram campos na secao "Dados". */}
            <Card as="section" padding="none" aria-label="Identidade" className="overflow-hidden">
                <div className="relative h-28 bg-gray-900 sm:h-36">
                    {profile.cover_url ? (
                        <img src={profile.cover_url} alt="Foto de capa do perfil" className="h-full w-full object-cover" />
                    ) : (
                        <div className="h-full w-full bg-gradient-to-r from-gray-900 to-black" />
                    )}
                    <div className="absolute right-3 top-3">
                        <Button
                            variant="secondary"
                            onClick={() => coverInputRef.current?.click()}
                            disabled={uploading}
                            aria-label="Trocar foto de capa"
                            iconLeft={<Camera size={18} />}
                        />
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

                <div className="px-5 pb-5 sm:px-6 sm:pb-6">
                    <div className="relative -mt-12 h-24 w-24 shrink-0 rounded-full border-2 border-black bg-white p-1 shadow-[3px_3px_0px_0px_rgba(0,0,0,1)] sm:-mt-14 sm:h-28 sm:w-28">
                        <div className="flex h-full w-full items-center justify-center overflow-hidden rounded-full bg-gray-200">
                            {profile.avatar_url ? (
                                <img src={profile.avatar_url} alt={profile.full_name} className="h-full w-full object-cover" />
                            ) : (
                                <User size={48} className="text-gray-400" />
                            )}
                        </div>
                        {/* Um unico gatilho de troca de foto, sempre visivel (no touch nao existe hover). */}
                        <button
                            type="button"
                            aria-label="Trocar foto de perfil"
                            onClick={() => fileInputRef.current?.click()}
                            disabled={uploading}
                            className="absolute -bottom-1 -right-1 inline-flex h-11 w-11 items-center justify-center rounded-full border-2 border-black bg-white text-black transition-colors hover:bg-gray-100 disabled:cursor-not-allowed disabled:opacity-50 sm:h-9 sm:w-9"
                        >
                            <Camera size={16} />
                        </button>
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

                    <div className="mt-3 min-w-0">
                        <h1 className="break-words text-2xl font-bold tracking-tight text-black sm:text-3xl">{profile.full_name}</h1>
                        <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-2 text-sm text-gray-600">
                            {profile.city && (
                                <span className="inline-flex items-center gap-1">
                                    <MapPin size={14} />
                                    {profile.city}
                                </span>
                            )}
                            {profile.verified_identity && (
                                <span
                                    title="Identidade Verificada"
                                    className="inline-flex items-center gap-1 rounded-pill bg-blue-50 px-2.5 py-1 text-xs font-bold text-blue-700"
                                >
                                    <ShieldCheck size={14} />
                                    Identidade verificada
                                </span>
                            )}
                        </div>
                    </div>

                    <div className={isEditing ? 'mt-4 hidden gap-2 sm:flex' : 'mt-4 flex gap-2'}>
                        {isEditing ? (
                            editActions
                        ) : (
                            <>
                                <Button
                                    variant="secondary"
                                    onClick={() => setIsEditing(true)}
                                    iconLeft={<Edit2 size={16} />}
                                    className="flex-1 sm:flex-none"
                                >
                                    Editar perfil
                                </Button>
                                <Button
                                    variant="secondary"
                                    onClick={() => setQrModalOpen(true)}
                                    aria-label="Ver meu QR de identidade"
                                    iconLeft={<QrCode size={18} />}
                                >
                                    QR
                                </Button>
                            </>
                        )}
                    </div>
                </div>
            </Card>

            {/* Resumo: nivel + numeros que importam + atalho dos recebimentos */}
            <Card as="section" aria-label="Resumo">
                <div className="flex items-center gap-4">
                    <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl border-2 border-black bg-primary-light text-primary">
                        <Award size={24} />
                    </span>
                    <div className="min-w-0 flex-1">
                        <div className="flex items-baseline justify-between gap-3">
                            <p className="text-lg font-bold">Nível {profile.level || 1}</p>
                            <p className="text-xs text-gray-600 tabular-nums">{profile.xp || 0} XP no total</p>
                        </div>
                        <div className="mt-2 h-2 w-full overflow-hidden rounded-full bg-gray-200">
                            <div className="h-full rounded-full bg-primary" style={{ width: `${nivel.percent}%` }} />
                        </div>
                    </div>
                </div>

                <dl className="mt-5 grid grid-cols-3 gap-3 text-center">
                    <div className="rounded-xl border border-gray-200 bg-gray-50 px-2 py-3">
                        <dd className="text-xl font-bold tabular-nums">{stats.completedJobs}</dd>
                        <dt className="mt-0.5 text-xs text-gray-600">Turnos</dt>
                    </div>
                    <div className="rounded-xl border border-gray-200 bg-gray-50 px-2 py-3">
                        <dd className="text-xl font-bold tabular-nums">{stats.hoursWorked}h</dd>
                        <dt className="mt-0.5 text-xs text-gray-600">Horas</dt>
                    </div>
                    <div className="rounded-xl border border-gray-200 bg-gray-50 px-2 py-3">
                        <dd className="flex items-center justify-center gap-1 text-xl font-bold tabular-nums">
                            <Star size={16} className="text-yellow-500" fill="currentColor" />
                            {profile.rating_average || '-'}
                        </dd>
                        <dt className="mt-0.5 text-xs text-gray-600">Avaliação</dt>
                    </div>
                </dl>

                {/* Atalho: Meus Recebimentos — histórico de pagamentos registrados (shift_payments) */}
                <div className="mt-5 border-t-2 border-gray-100 pt-5">
                    <Button
                        variant="secondary"
                        fullWidth
                        onClick={() => navigate('/recebimentos')}
                        iconLeft={<Receipt size={18} />}
                        iconRight={<ChevronRight size={18} />}
                    >
                        Meus recebimentos
                    </Button>
                    <p className="mt-2 text-center text-xs text-gray-600">Pagamentos registrados pelas empresas</p>
                </div>
            </Card>

            {/* DADOS — contato, documento, PIX e apresentação profissional num só bloco. */}
            <Card as="section" aria-labelledby="perfil-dados">
                <h2 id="perfil-dados" className="text-lg font-bold">Dados</h2>
                <p className="mt-1 text-sm text-gray-600">
                    {isEditing
                        ? 'Edite o que precisar e salve no fim.'
                        : 'É o que as empresas veem quando você entra no elenco delas.'}
                </p>

                {isEditing ? (
                    <div className="mt-5 grid grid-cols-1 gap-4 sm:grid-cols-2">
                        <Field label="Nome completo">
                            <input
                                type="text"
                                value={formData.full_name}
                                onChange={(e) => setFormData({ ...formData, full_name: e.target.value })}
                                autoComplete="name"
                            />
                        </Field>
                        <Field label="Cidade">
                            <input
                                type="text"
                                value={formData.city}
                                onChange={(e) => setFormData({ ...formData, city: e.target.value })}
                                autoComplete="address-level2"
                            />
                        </Field>
                        <Field label="Telefone">
                            <input
                                type="tel"
                                value={formData.phone}
                                onChange={(e) => setFormData({ ...formData, phone: e.target.value })}
                                placeholder="(00) 00000-0000"
                                autoComplete="tel"
                            />
                        </Field>

                        {/* CPF — exigido pelo termo de prestação (F6). Editável só enquanto vazio. */}
                        {cpfJaCadastrado ? (
                            <div className="flex flex-col gap-1.5">
                                <span className="text-sm font-bold text-black">CPF</span>
                                <p className="flex h-11 items-center rounded-xl border-2 border-gray-200 bg-gray-50 px-4 text-sm text-gray-700">
                                    {formatCpfCnpj(String(profile.cpf))}
                                </p>
                                <p className="text-xs text-gray-600">
                                    Já cadastrado. Para corrigir, fale com o suporte — o CPF identifica você nos
                                    termos que já assinou.
                                </p>
                            </div>
                        ) : (
                            <Field
                                label="CPF"
                                error={formData.cpf.trim() && !cpfValido ? 'CPF inválido.' : undefined}
                                hint="Necessário para assinar o termo de prestação e receber o recibo do turno. Depois de salvo, só o suporte consegue alterar."
                            >
                                <input
                                    type="text"
                                    inputMode="numeric"
                                    value={formData.cpf}
                                    onChange={(e) => setFormData({ ...formData, cpf: formatCpfCnpj(e.target.value) })}
                                    placeholder="000.000.000-00"
                                />
                            </Field>
                        )}

                        {/* Chave PIX — como a empresa paga o freela por fora do Worki (modo A) */}
                        <Field label="Tipo de chave PIX">
                            <select
                                value={pixKeyType}
                                onChange={(e) => {
                                    const nextType = e.target.value as PixKeyType;
                                    setPixKeyType(nextType);
                                    // Preserva o valor digitado — é o gesto de correção (ex.: CPF errado -> Telefone
                                    // com o número já digitado), só reaplica a máscara do tipo novo.
                                    setFormData({ ...formData, pix_key: formatPixKey(nextType, formData.pix_key) });
                                }}
                            >
                                {(Object.keys(PIX_KEY_LABELS) as PixKeyType[]).map(type => (
                                    <option key={type} value={type}>{PIX_KEY_LABELS[type]}</option>
                                ))}
                            </select>
                        </Field>
                        <Field
                            label="Chave PIX"
                            error={formData.pix_key.trim() && !isValidPixKey() ? 'Chave inválida para o tipo selecionado.' : undefined}
                            hint="É assim que as empresas vão te pagar por fora do Worki (PIX)."
                        >
                            <input
                                type="text"
                                value={formData.pix_key}
                                onChange={(e) => setFormData({ ...formData, pix_key: formatPixKey(pixKeyType, e.target.value) })}
                                placeholder={PIX_KEY_PLACEHOLDERS[pixKeyType]}
                            />
                        </Field>

                        {/* Função principal é ESCOLHIDA, não digitada.
                            Era `<input type="text"` livre, e em 22/08/2026 a produção
                            tinha um freela com o próprio E-MAIL gravado como função, e
                            "Garcom" convivendo com "Garçom" — a busca por função do
                            ShiftCallModal compara texto, então quem digitou sem cedilha
                            não era encontrado por quem buscava com.
                            A lista é a mesma de SHIFT_CATEGORIES (função do turno), para
                            o que o freela declara e o que a empresa pede falarem a mesma
                            língua.
                            O valor atual entra como opção mesmo se estiver fora da lista:
                            um `<select>` estrito APAGARIA a função de quem já tem uma
                            legada assim que salvasse qualquer outra coisa no perfil. */}
                        <Field label="Função principal" className="sm:col-span-2">
                            <select
                                value={formData.primary_role}
                                onChange={(e) => setFormData({ ...formData, primary_role: e.target.value })}
                            >
                                <option value="">Selecione sua função principal...</option>
                                {SHIFT_CATEGORIES.map(cat => (
                                    <option key={cat.slug} value={cat.name}>{cat.name}</option>
                                ))}
                                {formData.primary_role
                                    && !SHIFT_CATEGORIES.some(c => c.name === formData.primary_role) && (
                                    <option value={formData.primary_role}>
                                        {formData.primary_role} (atual)
                                    </option>
                                )}
                            </select>
                        </Field>
                        <Field
                            label="Especialidades"
                            hint="Separe as especialidades por vírgula."
                            className="sm:col-span-2"
                        >
                            <textarea
                                value={formData.roles}
                                onChange={(e) => setFormData({ ...formData, roles: e.target.value })}
                                placeholder="Outras habilidades (ex: Atendente, Barista, Caixa, Cumim)"
                                className="h-24 py-3"
                            />
                        </Field>
                        <Field label="Sobre você" className="sm:col-span-2">
                            <textarea
                                value={formData.bio}
                                onChange={(e) => setFormData({ ...formData, bio: e.target.value })}
                                placeholder="Conte um pouco sobre sua experiência em salão, bar, cafeteria ou cozinha..."
                                className="h-32 py-3"
                            />
                        </Field>
                    </div>
                ) : (
                    <div className="mt-5 space-y-6">
                        <dl className="grid grid-cols-1 gap-x-6 gap-y-4 sm:grid-cols-2">
                            <DataRow label="Telefone">{profile.phone || 'Não informado'}</DataRow>
                            <DataRow label="Chave PIX">{profile.pix_key || 'Não informada'}</DataRow>
                            <DataRow label="CPF">
                                {cpfJaCadastrado ? (
                                    <>
                                        {formatCpfCnpj(String(profile.cpf))}
                                        <span className="mt-1 block text-xs font-normal text-gray-600">
                                            Já cadastrado. Para corrigir, fale com o suporte — o CPF identifica você nos
                                            termos que já assinou.
                                        </span>
                                    </>
                                ) : (
                                    <>
                                        Não informado
                                        <span className="mt-1 block text-xs font-normal text-gray-600">
                                            Sem CPF você não consegue assinar o termo do turno nem confirmar o recibo.
                                        </span>
                                        <Button
                                            variant="secondary"
                                            onClick={() => setIsEditing(true)}
                                            className="mt-3"
                                        >
                                            Cadastrar CPF
                                        </Button>
                                    </>
                                )}
                            </DataRow>
                            <DataRow label="Experiência">{profile.experience_years || 'Iniciante'}</DataRow>
                            <DataRow label="Regime">
                                <span title={Array.isArray(profile.availability) ? profile.availability.join(', ') : profile.availability || undefined}>
                                    {Array.isArray(profile.availability) && profile.availability.length > 0 ? profile.availability[0] + (profile.availability.length > 1 ? ` +${profile.availability.length - 1}` : '') : (profile.availability || 'N/A')}
                                </span>
                            </DataRow>
                        </dl>

                        <div>
                            <h3 className="text-xs font-semibold uppercase tracking-wide text-gray-600">Especialidades</h3>
                            <div className="mt-2 flex flex-wrap gap-2">
                                {profile.roles && (Array.isArray(profile.roles) ? profile.roles : [profile.primary_role]).map((role: string, i: number) => (
                                    <span key={i} className="inline-flex h-8 items-center rounded-pill border-2 border-black bg-white px-3 text-sm font-semibold">
                                        {role}
                                    </span>
                                ))}
                                {(!profile.roles || profile.roles.length === 0) && !profile.primary_role && (
                                    <span className="text-sm italic text-gray-600">Nenhuma especialidade listada.</span>
                                )}
                            </div>
                        </div>

                        <div>
                            <h3 className="text-xs font-semibold uppercase tracking-wide text-gray-600">Sobre</h3>
                            <p className="mt-2 text-sm leading-relaxed text-gray-700 sm:text-base">
                                {profile.bio || 'Este profissional ainda não adicionou uma biografia.'}
                            </p>
                        </div>
                    </div>
                )}
            </Card>

            {/* DISPONIBILIDADE — F7: grade dia × período. É SINAL, NUNCA TRAVA
                (DDL §1): só ordena quem a empresa vê primeiro no Chamado de Turno, nunca
                filtra nem bloqueia ninguém. Distinta do campo legado "Regime" em Dados
                (sem dia da semana, write-once do onboarding) — só esta grade
                responde "disponível nesta terça de manhã?". */}
            <Card as="section" aria-labelledby="perfil-disponibilidade">
                <h2 id="perfil-disponibilidade" className="flex items-center gap-2 text-lg font-bold">
                    <CalendarClock size={20} /> Disponibilidade da semana
                </h2>
                <p className="mt-1 text-sm text-gray-600">
                    Marque os dias e períodos em que você topa trabalhar. As empresas do seu
                    elenco te veem primeiro nos chamados de turno que casam com sua grade.
                </p>

                {isEditing ? (
                    <div className="mt-5 space-y-2">
                        {AVAILABILITY_WEEKDAYS.map((day) => (
                            <div
                                key={day}
                                className="flex items-center gap-3"
                                role="group"
                                aria-label={`Disponibilidade de ${AVAILABILITY_WEEKDAY_LABELS[day]}`}
                            >
                                <span className="w-10 shrink-0 text-sm font-bold text-gray-700">
                                    {AVAILABILITY_WEEKDAY_LABELS[day]}
                                </span>
                                <div className="flex flex-1 gap-2">
                                    {AVAILABILITY_PERIODS.map((period) => {
                                        const active = (availabilityGrade[day] ?? []).includes(period);
                                        return (
                                            <button
                                                key={period}
                                                type="button"
                                                onClick={() => toggleAvailabilitySlot(day, period)}
                                                aria-pressed={active}
                                                aria-label={`${AVAILABILITY_WEEKDAY_LABELS[day]} — ${AVAILABILITY_PERIOD_LABELS[period]}`}
                                                className={`h-11 flex-1 rounded-xl border-2 text-sm font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-black focus-visible:ring-offset-2 ${
                                                    active
                                                        ? 'border-black bg-primary text-white'
                                                        : 'border-gray-300 bg-white text-gray-700 hover:border-black'
                                                }`}
                                            >
                                                {AVAILABILITY_PERIOD_LABELS[period]}
                                            </button>
                                        );
                                    })}
                                </div>
                            </div>
                        ))}
                        <p className="pt-2 text-xs text-gray-600">
                            Deixe um dia sem nenhum período marcado se você não sabe ainda — isso é
                            diferente de "indisponível".
                        </p>
                    </div>
                ) : gradeDeclarada ? (
                    <div className="mt-5 flex flex-wrap gap-2">
                        {AVAILABILITY_WEEKDAYS.filter((day) => (profile.availability_days?.[day]?.length ?? 0) > 0).map((day) => (
                            <span
                                key={day}
                                className="inline-flex h-8 items-center rounded-pill bg-primary-light px-3 text-sm font-semibold text-primary"
                            >
                                {AVAILABILITY_WEEKDAY_LABELS[day]}: {(profile.availability_days?.[day] ?? [])
                                    .map((p) => AVAILABILITY_PERIOD_LABELS[p])
                                    .join(', ')}
                            </span>
                        ))}
                    </div>
                ) : (
                    <div className="mt-5 flex flex-col items-start gap-3 rounded-xl border-2 border-dashed border-gray-300 bg-gray-50 p-4">
                        <p className="text-sm text-gray-700">
                            Você ainda não declarou sua disponibilidade. Declare para aparecer
                            primeiro nos chamados de turno do seu elenco.
                        </p>
                        <Button variant="secondary" onClick={() => setIsEditing(true)}>
                            Declarar disponibilidade
                        </Button>
                    </div>
                )}
            </Card>

            {/* CERTIFICAÇÕES — F8: o freela cadastra/edita/remove a própria certificação externa.
                v1 SEM ARQUIVO (ADR-20260821) — só metadado + número de registro. */}
            <MyCertificationsSection />

            {/* Avaliações recebidas de empresas */}
            {workerId && <ProfileReviews reviewedId={workerId} reviewerRole="company" />}

            {/* PREFERÊNCIAS — como você aparece e como pode ser encontrado. Cada bloco é um
                opt-in/opt-out independente (F10 indicação, F11 SOS, F12 selos). */}
            <section aria-labelledby="perfil-preferencias" className="space-y-6">
                <div className="mt-2">
                    <h2 id="perfil-preferencias" className="text-lg font-bold">Preferências</h2>
                    <p className="mt-1 text-sm text-gray-600">
                        Você decide como aparece para as empresas e quando pode ser chamado.
                    </p>
                </div>

                {/* F10 — opt-out de indicação entre empresas (workers.accepts_referrals). */}
                <ReferralOptOutSection />

                {/* F11 — opt-in de descoberta em urgência (workers.discoverable_for_sos).
                    Adjacente à Disponibilidade (F7): só aparece com availability_days
                    declarado — ver ddl-aprovado.md §5. */}
                <SosDiscoverySection />

                {/* F12 — selos das empresas onde já trabalhou (o dono gerencia visibilidade). */}
                {workerId && <CompanyBadges workerId={workerId} mode="manage" />}
            </section>

            {/* ATALHOS — paridade de navegacao mobile (R6): destinos que o BottomNav nao comporta. */}
            <nav aria-labelledby="perfil-atalhos" className="border-t-2 border-gray-200 pt-6">
                <h2 id="perfil-atalhos" className="text-xs font-semibold uppercase tracking-wide text-gray-600">Atalhos</h2>
                <ul className="mt-2 divide-y-2 divide-gray-200 overflow-hidden rounded-xl border-2 border-black bg-white">
                    {[
                        { to: '/indicacoes', label: 'Quem te indicou', icon: <Share2 size={18} /> },
                        { to: '/ajuda', label: 'Ajuda', icon: <HelpCircle size={18} /> },
                    ].map(item => (
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

            {/* CONTA — recolhida por padrão: Segurança, Sessão e exclusão ficam fora do caminho. */}
            <section aria-labelledby="perfil-conta" className="border-t-2 border-gray-200 pt-6">
                <h2 id="perfil-conta" className="text-lg font-bold">Conta</h2>
                <p className="mt-1 text-sm text-gray-600">Senha, sessão e exclusão da conta.</p>
                <Button
                    variant="secondary"
                    onClick={() => setShowAccountSettings(prev => !prev)}
                    aria-expanded={showAccountSettings}
                    iconLeft={<Settings size={18} />}
                    className="mt-4"
                >
                    {showAccountSettings ? 'Ocultar configurações da conta' : 'Configurações da conta'}
                </Button>

                {showAccountSettings && (
                    <div className="mt-6 space-y-6">
                        {/* Segurança */}
                        <Card as="section" aria-labelledby="perfil-seguranca">
                            <h3 id="perfil-seguranca" className="flex items-center gap-2 text-base font-bold">
                                <Lock size={18} /> Segurança
                            </h3>
                            <div className="mt-4 space-y-4">
                                <div>
                                    <Field label="Nova senha">
                                        <input
                                            id="new-password"
                                            type="password"
                                            value={newPassword}
                                            onChange={e => { setNewPassword(e.target.value); setPasswordError(null); }}
                                            autoComplete="new-password"
                                        />
                                    </Field>
                                    {newPassword && (() => {
                                        const strength = getPasswordStrength(newPassword);
                                        return (
                                            <div className="mt-2">
                                                <div className="h-1.5 overflow-hidden rounded-full bg-gray-200">
                                                    <div className={`h-full ${strength.color} rounded-full ${strength.width}`} />
                                                </div>
                                                <p className="mt-1 text-xs text-gray-600">Força: {strength.label}</p>
                                            </div>
                                        );
                                    })()}
                                </div>

                                <Field label="Confirmar nova senha">
                                    <input
                                        id="confirm-password"
                                        type="password"
                                        value={confirmPassword}
                                        onChange={e => { setConfirmPassword(e.target.value); setPasswordError(null); }}
                                        autoComplete="new-password"
                                    />
                                </Field>

                                {passwordError && (
                                    <p role="alert" className="text-xs font-bold text-red-600">{passwordError}</p>
                                )}

                                <Button
                                    variant="secondary"
                                    onClick={handleChangePassword}
                                    disabled={!newPassword || !confirmPassword}
                                    loading={passwordLoading}
                                >
                                    Alterar senha
                                </Button>
                            </div>
                        </Card>

                        {/* Sessão — logout avulso, acessível no mobile via item "Perfil" do BottomNav (R3) */}
                        <Card as="section" aria-labelledby="perfil-sessao">
                            <h3 id="perfil-sessao" className="flex items-center gap-2 text-base font-bold">
                                <LogOut size={18} /> Sessão
                            </h3>
                            <p className="mt-1 text-sm text-gray-600">Sair da sua conta neste dispositivo.</p>
                            <Button
                                variant="secondary"
                                onClick={handleLogout}
                                loading={loggingOut}
                                iconLeft={<LogOut size={18} />}
                                className="mt-4"
                            >
                                {loggingOut ? 'Saindo...' : 'Sair da conta'}
                            </Button>
                        </Card>

                        {/* Zona de perigo — discreta de propósito: sem moldura, só texto vermelho.
                            O peso fica no modal de confirmação, não no atalho. */}
                        <div className="flex flex-col gap-1 border-t-2 border-red-100 pt-6 sm:flex-row sm:items-center sm:justify-between sm:gap-4">
                            <div className="min-w-0">
                                <h3 className="text-sm font-bold text-red-600">Zona de perigo</h3>
                                <p className="mt-1 text-xs text-gray-600">
                                    A exclusão da sua conta é irreversível. Todos os seus dados pessoais serão anonimizados.
                                </p>
                            </div>
                            <Button
                                variant="ghost"
                                onClick={() => setDeleteModalOpen(true)}
                                className="shrink-0 self-start text-red-600 sm:self-auto"
                            >
                                Excluir minha conta
                            </Button>
                        </div>
                    </div>
                )}
            </section>

        </div>

        {isEditing && (
            /* Barra de acao fixa no mobile: os campos editaveis longos (especialidades, bio,
               grade de disponibilidade) ficam muito abaixo do par Salvar/Cancelar do hero —
               no celular a pessoa terminava a edicao e nao tinha como salvar dali (KLM/Fitts).
               z-[60] fica ACIMA do BottomNav (z-50); com z-40 a barra nascia escondida atras dele.
               So mobile: no desktop o par do hero ja fica visivel. */
            <div className="sm:hidden fixed bottom-0 left-0 right-0 z-[60] flex gap-3 border-t-2 border-black bg-white px-4 pt-3 pb-[calc(0.75rem+env(safe-area-inset-bottom))] [&>*]:flex-1">
                {editActions}
            </div>
        )}

        {/* Modal QR de identidade */}
        {qrModalOpen && workerId && (
            <div
                className="fixed inset-0 z-[70] flex animate-in fade-in items-center justify-center bg-black/50 p-4 backdrop-blur-sm duration-200"
                onClick={fecharQrPeloFundo}
            >
                <div
                    role="dialog"
                    aria-modal="true"
                    aria-labelledby="perfil-qr-titulo"
                    className="w-full max-w-sm rounded-2xl border-2 border-black bg-white p-6 shadow-[8px_8px_0px_0px_rgba(0,0,0,1)]"
                >
                    <div className="mb-2 flex items-center justify-between gap-3">
                        <h2 id="perfil-qr-titulo" className="text-lg font-bold">Meu QR de identidade</h2>
                        <button
                            onClick={() => setQrModalOpen(false)}
                            aria-label="Fechar"
                            className="inline-flex h-11 w-11 items-center justify-center rounded-xl transition-colors hover:bg-gray-100"
                        >
                            <X size={20} />
                        </button>
                    </div>
                    <p className="mb-5 text-sm text-gray-600">
                        Mostre este QR para uma empresa te adicionar ao elenco dela. Ele identifica você pelo seu Worki ID.
                    </p>
                    <div className="mb-5 flex justify-center">
                        <div className="rounded-2xl border-2 border-black bg-white p-4 shadow-[4px_4px_0px_0px_rgba(0,0,0,1)]">
                            <QRCodeSVG
                                value={workerId}
                                size={200}
                                level="M"
                                includeMargin={false}
                            />
                        </div>
                    </div>
                    <div className="rounded-xl border-2 border-gray-200 bg-gray-50 p-3 text-center">
                        <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-gray-600">Worki ID</p>
                        <p className="break-all font-mono text-xs font-bold text-gray-700">{workerId}</p>
                    </div>
                    <div className="mt-4 flex flex-col gap-2">
                        <Button
                            variant="primary"
                            fullWidth
                            onClick={handleCopyWorkiId}
                            iconLeft={idCopied ? <Check size={18} /> : <Copy size={18} />}
                        >
                            {idCopied ? 'Worki ID copiado!' : 'Copiar Worki ID'}
                        </Button>
                        <Button
                            variant="secondary"
                            fullWidth
                            onClick={handleCopyMyLink}
                            iconLeft={linkCopied ? <Check size={18} /> : <Copy size={18} />}
                        >
                            {linkCopied ? 'Link copiado!' : 'Copiar meu link'}
                        </Button>
                    </div>
                    <p className="mt-3 text-center text-xs text-gray-600">
                        Cole o <span className="font-bold">Worki ID</span> quando a empresa pedir, ou envie o link direto (WhatsApp, etc.) para ela te adicionar ao elenco.
                    </p>
                </div>
            </div>
        )}

        {/* Modal de confirmação de exclusão */}
        {deleteModalOpen && (
            <div
                className="fixed inset-0 z-[70] flex animate-in fade-in items-center justify-center bg-black/50 p-4 backdrop-blur-sm duration-200"
                onClick={fecharExclusaoPeloFundo}
            >
                <div
                    role="dialog"
                    aria-modal="true"
                    aria-labelledby="perfil-exclusao-titulo"
                    className="w-full max-w-md rounded-2xl border-2 border-black bg-white p-6 shadow-[8px_8px_0px_0px_rgba(0,0,0,1)]"
                >
                    <h2 id="perfil-exclusao-titulo" className="mb-4 text-lg font-bold text-red-600">Tem certeza? Esta ação é irreversível.</h2>
                    <ul className="mb-6 space-y-2 text-sm text-gray-700">
                        <li className="flex items-start gap-2">
                            <span className="mt-0.5 font-bold text-red-500">•</span>
                            Seu perfil e dados pessoais serão anonimizados
                        </li>
                        <li className="flex items-start gap-2">
                            <span className="mt-0.5 font-bold text-red-500">•</span>
                            Turnos e convites ativos serão cancelados
                        </li>
                    </ul>
                    <Field label="Digite EXCLUIR para confirmar">
                        <input
                            type="text"
                            value={deleteConfirmText}
                            onChange={(e) => setDeleteConfirmText(e.target.value)}
                            placeholder="EXCLUIR"
                            autoComplete="off"
                        />
                    </Field>
                    <div className="mt-6 flex gap-3 [&>*]:flex-1">
                        <Button
                            variant="secondary"
                            onClick={() => { setDeleteModalOpen(false); setDeleteConfirmText(''); }}
                        >
                            Cancelar
                        </Button>
                        <Button
                            variant="danger"
                            onClick={handleDeleteAccount}
                            disabled={deleteConfirmText !== 'EXCLUIR' || deleting}
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

/** Linha de leitura (rótulo em micro-caixa-alta + valor) usada no resumo de "Dados". */
function DataRow({ label, children }: { label: string; children: React.ReactNode }) {
    return (
        <div className="min-w-0">
            <dt className="text-xs font-semibold uppercase tracking-wide text-gray-600">{label}</dt>
            <dd className="mt-1 break-words text-sm font-medium text-black">{children}</dd>
        </div>
    );
}
