import { useState } from 'react';
import { useSearchParams, useNavigate } from 'react-router-dom';
import { ArrowLeft, Lock, ArrowRight, Mail, Loader2 } from 'lucide-react';
import { supabase } from '../lib/supabase';
import { getPasswordStrength } from '../lib/validation';
import { logError } from '../lib/logger';
import PageMeta from '../components/PageMeta';
import { PENDING_INVITE_TOKEN_KEY } from '../lib/inviteToken';
import { PENDING_MANAGER_INVITE_TOKEN_KEY } from '../lib/managerInviteToken';

/**
 * Subtítulo da tela de acesso da EMPRESA.
 *
 * Dizia "Acesse 10k+ profissionais avaliados." — e em 22/08/2026 havia **16** freelas cadastrados.
 * Era a primeira frase que um cliente do piloto lia, e prometia o produto errado: o Worki não é
 * um pool aberto onde a empresa garimpa desconhecidos, é elenco próprio montado por convite, com
 * chamado 1→N para quem ela já confia. Número inflado atrai a expectativa que o produto não
 * entrega e afunda a que ele entrega.
 */
const SUBTITULO_EMPRESA = 'Monte seu elenco e preencha turnos com quem você já confia.';

/**
 * Rede de segurança do item 11 (GTM): se o freela chegou ao login sem o ?redirect=
 * (ex.: confirmou email em outra aba e voltou pro /login "seco"), ainda tentamos
 * recuperar o convite pendente guardado pelo InviteAccept em sessionStorage.
 *
 * F13 (R8/R9): mesma rede para o convite de gerente — chave própria
 * (`PENDING_MANAGER_INVITE_TOKEN_KEY`) para não colidir com o convite de equipe.
 */
function resolvePendingInviteRedirect(explicitRedirect: string | null): string | null {
    if (explicitRedirect && explicitRedirect.startsWith('/')) return explicitRedirect;
    try {
        const pendingManagerToken = sessionStorage.getItem(PENDING_MANAGER_INVITE_TOKEN_KEY);
        if (pendingManagerToken) return `/convite-gerente/${pendingManagerToken}`;
        const pendingToken = sessionStorage.getItem(PENDING_INVITE_TOKEN_KEY);
        if (pendingToken) return `/convite/${pendingToken}`;
    } catch {
        // sessionStorage indisponível — sem rede de segurança, segue fluxo padrão
    }
    return null;
}

/** Rótulo humano do papel da conta ('work' | 'hire') para mensagens de erro/aviso. */
function roleLabel(userType: string | undefined | null): string {
    return userType === 'hire' ? 'empresa' : 'freelancer';
}

export default function Login() {
    const [searchParams] = useSearchParams();
    // 'explicitType' só existe quando o usuário chegou por um link que declara a intenção
    // (ex.: card "Quero Trabalhar"/"Quero Contratar"). Convites (?redirect=...) não trazem
    // 'type' — nesse caso não há intenção explícita de papel a comparar (R1).
    const explicitType = searchParams.get('type');
    // Convite de GERENTE exige conta de empresa. Quando o token vem do sessionStorage (o
    // usuario voltou ao /login "seco"), nao ha `type` na URL para declarar isso — sem esta
    // deducao a tela recebe o convidado com a copy de freela e ele cria a conta errada.
    const destinoPendente = resolvePendingInviteRedirect(searchParams.get('redirect'));
    const type = explicitType
        || (destinoPendente?.startsWith('/convite-gerente/') ? 'hire' : 'work');
    const reason = searchParams.get('reason');
    // Preserva o destino pretendido (ex.: /convite/<token>) quando o usuário chega ao
    // login vindo de um link que exigia sessão — ver InviteAccept.tsx (item 11 do GTM).
    const redirectTo = searchParams.get('redirect');
    const navigate = useNavigate();

    const [isSignUp, setIsSignUp] = useState(false);
    const [email, setEmail] = useState('');
    const [password, setPassword] = useState('');
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [successMessage, setSuccessMessage] = useState<string | null>(null);
    // R1: quando a conta autenticada tem um papel diferente do 'type' que trouxe o usuário
    // até aqui, guardamos o papel REAL da conta e mostramos um aviso em vez de redirecionar
    // silenciosamente para o dashboard errado.
    const [roleMismatch, setRoleMismatch] = useState<{ actualType: 'work' | 'hire' } | null>(null);

    const isHire = type === 'hire';

    const handleGoToCorrectDashboard = () => {
        if (!roleMismatch) return;
        navigate(roleMismatch.actualType === 'hire' ? '/company/dashboard' : '/dashboard');
    };

    const handleUseAnotherEmail = async () => {
        // A conta logada não é a que o usuário queria acessar — encerra a sessão pra
        // permitir tentar de novo com outro e-mail sem ficar "preso" no papel errado.
        try {
            await supabase.auth.signOut();
        } catch (err) {
            // Best-effort: mesmo se o signOut falhar, seguimos limpando o formulário local.
            logError('Login.handleUseAnotherEmail', err);
        }
        setRoleMismatch(null);
        setEmail('');
        setPassword('');
        setError(null);
    };

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        setLoading(true);
        setError(null);
        setSuccessMessage(null);
        setRoleMismatch(null);

        try {
            if (isSignUp) {
                if (password.length < 8) {
                    setError('A senha deve ter pelo menos 8 caracteres.');
                    setLoading(false);
                    return;
                }
                // Sign Up
                const { data, error: signUpError } = await supabase.auth.signUp({
                    email,
                    password,
                    options: {
                        data: {
                            user_type: type, // 'work' or 'hire'
                        },
                    },
                });

                if (signUpError) throw signUpError;

                // R2: o Supabase tem proteção anti-enumeração — signUp de um e-mail JÁ
                // existente e confirmado retorna "sucesso" ofuscado (sem erro, sem sessão).
                // O único sinal client-side é `identities` vazio (nenhuma identidade nova
                // criada). Sem isso, a UI mostraria "Conta criada!" para uma conta que já existe.
                if (data.user && data.user.identities && data.user.identities.length === 0) {
                    setError('Este e-mail já tem uma conta. Faça login (ou use outro e-mail).');
                } else if (data.user && data.session) {
                    // Auto-confirmed: redirect immediately
                    const pendingRedirect = resolvePendingInviteRedirect(redirectTo);
                    if (pendingRedirect) {
                        navigate(pendingRedirect);
                    } else {
                        const userType = data.user.user_metadata?.user_type;
                        if (userType === 'hire') {
                            navigate('/company/dashboard');
                        } else {
                            navigate('/dashboard');
                        }
                    }
                } else if (data.user) {
                    // Email confirmation required
                    setSuccessMessage('Conta criada! Verifique seu email para confirmar.');
                }
            } else {
                // Sign In
                const { data, error: signInError } = await supabase.auth.signInWithPassword({
                    email,
                    password,
                });

                if (signInError) throw signInError;

                if (data.user) {
                    const pendingRedirect = resolvePendingInviteRedirect(redirectTo);
                    const userType = data.user.user_metadata?.user_type;

                    if (pendingRedirect) {
                        navigate(pendingRedirect);
                    } else if (
                        explicitType &&
                        (userType === 'work' || userType === 'hire') &&
                        userType !== explicitType
                    ) {
                        // R1: o e-mail pertence a uma conta do OUTRO papel — nunca redirecionar
                        // silenciosamente. Mostra aviso claro com ação pra ir ao dashboard
                        // correto ou usar outro e-mail (A1).
                        setRoleMismatch({ actualType: userType });
                    } else if (userType === 'hire') {
                        navigate('/company/dashboard');
                    } else {
                        navigate('/dashboard');
                    }
                }
            }
        } catch (err: unknown) {
            const msg = err instanceof Error ? err.message : '';
            if (msg.includes('Invalid login credentials')) {
                setError('Email ou senha incorretos.');
            } else if (msg.includes('Email not confirmed')) {
                setError('Por favor, verifique seu email antes de fazer login.');
            } else if (msg.includes('User already registered')) {
                // R2: mensagem específica (não o genérico "Erro ao fazer login") — a causa mais
                // comum desse erro no cadastro é o e-mail já ter conta com o OUTRO papel (A2).
                const oppositeType = type === 'hire' ? 'work' : 'hire';
                setError(
                    `Este e-mail já tem conta cadastrada como ${roleLabel(oppositeType)}. Entre por lá ou use outro e-mail.`
                );
            } else if (msg.includes('rate_limit') || msg.includes('429') || msg.includes('over_email_send_rate_limit') || (err && typeof err === 'object' && 'status' in err && (err as { status: number }).status === 429)) {
                setError('Muitas tentativas. Aguarde alguns minutos e tente novamente.');
            } else {
                setError('Erro ao fazer login. Tente novamente.');
            }
        } finally {
            setLoading(false);
        }
    };

    return (
        <div className={`min-h-screen flex flex-col items-center justify-center p-4 transition-colors duration-500
                    ${isHire ? 'bg-accent' : 'bg-[#F4F4F0]'}`}>
            <PageMeta title="Entrar" description="Entre na sua conta Worki para acessar vagas e gerenciar seus freelancers." />

            {/* Back Button */}
            <button
                onClick={() => navigate('/')}
                className={`absolute top-6 left-6 flex items-center gap-2 font-bold px-4 py-2 rounded-full border-2 transition-all
                   ${isHire ? 'text-white border-white hover:bg-white hover:text-black' : 'text-black border-black hover:bg-black hover:text-white'}`}
            >
                <ArrowLeft size={18} strokeWidth={3} />
                VOLTAR
            </button>

            {/* Main Card */}
            <div className="w-full max-w-md relative">
                {/* Brutalist Shadow Box */}
                <div className={`absolute inset-0 translate-x-3 translate-y-3 rounded-2xl border-2 border-black
                        ${isHire ? 'bg-primary' : 'bg-black'}`} />

                <div className="relative bg-white border-2 border-black rounded-2xl p-8 md:p-10 shadow-xl">

                    <div className="text-center mb-8">
                        <h2 className="text-4xl font-black uppercase tracking-tighter mb-2">
                            {isSignUp
                                ? 'Criar Conta'
                                : (isHire ? 'Contratar Talentos' : 'Começar a Trabalhar')}
                        </h2>
                        <p className="font-medium text-gray-500">
                            {isSignUp
                                ? 'Preencha os dados para se cadastrar.'
                                : (isHire ? SUBTITULO_EMPRESA : 'Ganhe dinheiro no seu próprio horário.')}
                        </p>
                    </div>

                    {reason === 'session_expired' && !error && !successMessage && (
                        <div className="mb-4 p-3 bg-yellow-100 border border-yellow-300 text-yellow-800 rounded-xl text-sm font-medium">
                            Sua sessao expirou. Faca login novamente para continuar.
                        </div>
                    )}

                    {error && (
                        <div className="mb-4 p-3 bg-red-100 border border-red-300 text-red-700 rounded-xl text-sm font-medium">
                            {error}
                        </div>
                    )}

                    {roleMismatch && (
                        <div className="mb-4 p-4 bg-amber-50 border-2 border-amber-400 text-amber-900 rounded-xl text-sm font-medium space-y-3">
                            <p>
                                Este e-mail já está cadastrado como <strong className="font-black">{roleLabel(roleMismatch.actualType)}</strong>.
                                {' '}Não é possível entrar como {roleLabel(explicitType)} com esta conta.
                            </p>
                            <div className="flex flex-col sm:flex-row gap-2">
                                <button
                                    type="button"
                                    onClick={handleGoToCorrectDashboard}
                                    className="flex-1 bg-black text-white font-black uppercase text-xs py-2.5 rounded-lg hover:bg-primary transition-colors"
                                >
                                    Ir para o dashboard de {roleLabel(roleMismatch.actualType)}
                                </button>
                                <button
                                    type="button"
                                    onClick={handleUseAnotherEmail}
                                    className="flex-1 border-2 border-amber-600 text-amber-900 font-black uppercase text-xs py-2.5 rounded-lg hover:bg-amber-100 transition-colors"
                                >
                                    Usar outro e-mail
                                </button>
                            </div>
                        </div>
                    )}

                    {successMessage && (
                        <div className="mb-4 p-3 bg-green-100 border border-green-300 text-green-700 rounded-xl text-sm font-medium">
                            {successMessage}
                        </div>
                    )}

                    <form className="space-y-4" onSubmit={handleSubmit}>
                        <div className="space-y-1">
                            <label className="text-xs font-bold uppercase tracking-wide">Email</label>
                            <div className="relative">
                                <Mail className="absolute left-3 top-3.5 text-black" size={20} strokeWidth={2.5} />
                                <input
                                    type="email"
                                    autoComplete="email"
                                    value={email}
                                    onChange={(e) => setEmail(e.target.value)}
                                    required
                                    aria-label="Email"
                                    className="w-full bg-gray-100 border-2 border-transparent focus:border-black focus:bg-white outline-none rounded-xl py-3 pl-10 pr-4 font-bold transition-all placeholder:font-medium"
                                    placeholder="nome@exemplo.com"
                                />
                            </div>
                        </div>

                        <div className="space-y-1">
                            <label className="text-xs font-bold uppercase tracking-wide">Senha</label>
                            <div className="relative">
                                <Lock className="absolute left-3 top-3.5 text-black" size={20} strokeWidth={2.5} />
                                <input
                                    type="password"
                                    autoComplete={isSignUp ? "new-password" : "current-password"}
                                    value={password}
                                    onChange={(e) => setPassword(e.target.value)}
                                    required
                                    minLength={8}
                                    aria-label="Senha"
                                    className="w-full bg-gray-100 border-2 border-transparent focus:border-black focus:bg-white outline-none rounded-xl py-3 pl-10 pr-4 font-bold transition-all placeholder:font-medium"
                                    placeholder="••••••••"
                                />
                            </div>
                            {isSignUp && password.length > 0 && (() => {
                                const strength = getPasswordStrength(password);
                                return (
                                    <div className="mt-2">
                                        <div className="h-1.5 bg-gray-200 rounded-full overflow-hidden">
                                            <div className={`h-full ${strength.color} ${strength.width} transition-all duration-300 rounded-full`} />
                                        </div>
                                        <p className="text-xs text-gray-500 mt-1">Forca: {strength.label}</p>
                                    </div>
                                );
                            })()}
                        </div>

                        <button
                            type="submit"
                            disabled={loading}
                            className="w-full bg-black text-white font-black uppercase text-lg py-4 rounded-xl hover:bg-primary hover:scale-[1.02] active:scale-[0.98] transition-all flex items-center justify-center gap-2 mt-6 disabled:opacity-50 disabled:cursor-not-allowed"
                        >
                            {loading ? (
                                <Loader2 size={20} className="animate-spin" />
                            ) : (
                                <>
                                    {isSignUp ? 'Criar Conta' : 'Entrar'} <ArrowRight size={20} strokeWidth={3} />
                                </>
                            )}
                        </button>

                        {!isSignUp && (
                            <div className="text-center mt-3">
                                <a href="/esqueci-senha" className="text-sm font-bold text-gray-500 hover:text-black transition-colors">
                                    Esqueci minha senha
                                </a>
                            </div>
                        )}
                    </form>

                    <div className="mt-8 text-center text-sm font-medium">
                        {isSignUp ? 'Já tem uma conta?' : 'Não tem uma conta?'}{' '}
                        <button
                            onClick={() => {
                                setIsSignUp(!isSignUp);
                                setError(null);
                                setSuccessMessage(null);
                                setRoleMismatch(null);
                            }}
                            className="underline decoration-2 hover:text-primary transition-colors font-bold"
                        >
                            {isSignUp ? 'Fazer Login' : 'Cadastre-se'}
                        </button>
                    </div>

                    <div className="mt-6 flex justify-center gap-4 text-xs font-bold text-gray-400">
                        <a href="/sobre" className="hover:text-black transition-colors">Sobre a Worki</a>
                        <span>•</span>
                        <a href="/termos" className="hover:text-black transition-colors">Termos</a>
                        <span>•</span>
                        <a href="/privacidade" className="hover:text-black transition-colors">Privacidade</a>
                        <span>•</span>
                        <a href="/ajuda" className="hover:text-black transition-colors">Ajuda</a>
                    </div>

                </div>
            </div>

        </div>
    );
}
