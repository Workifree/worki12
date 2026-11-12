import { useState } from 'react';
import { useSearchParams, useNavigate, Link } from 'react-router-dom';
import { ArrowLeft } from 'lucide-react';
import { supabase } from '../lib/supabase';
import { getPasswordStrength } from '../lib/validation';
import { logError } from '../lib/logger';
import PageMeta from '../components/PageMeta';
import { Button, Card, Field } from '../components/ui';
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

    // Os CTAs "Cadastrar como…" da landing e do onboarding levavam para ca em modo ENTRAR:
    // quem chegava novo digitava e recebia "Email ou senha incorretos", como se tivesse
    // errado a senha de uma conta que nem existe. O link agora declara a intencao.
    const [isSignUp, setIsSignUp] = useState(searchParams.get('cadastro') === '1');
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
        if (loading) return; // trava de reentrada: Enter repetido nao dispara outra chamada de auth
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
            } else if (/failed to fetch|networkerror|network request failed|load failed/i.test(msg)) {
                setError('Sem conexão com a internet. Verifique sua rede e tente novamente.');
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
            <Button
                variant="secondary"
                size="md"
                onClick={() => navigate('/')}
                iconLeft={<ArrowLeft size={16} strokeWidth={2.5} />}
                className="absolute top-4 left-4 sm:top-6 sm:left-6"
            >
                Voltar
            </Button>

            {/* Main Card */}
            <Card
                padding="lg"
                className={`w-full max-w-md ${isHire
                    ? 'shadow-[6px_6px_0px_0px_rgba(0,166,81,1)]'
                    : 'shadow-[6px_6px_0px_0px_rgba(0,0,0,1)]'}`}
            >
                <div className="text-center mb-6">
                    <h1 className="text-2xl sm:text-3xl font-bold tracking-tight mb-2">
                        {isSignUp
                            ? 'Criar Conta'
                            : (isHire ? 'Contratar Talentos' : 'Começar a Trabalhar')}
                    </h1>
                    <p className="text-sm sm:text-base text-gray-600">
                        {isSignUp
                            ? 'Preencha os dados para se cadastrar.'
                            : (isHire ? SUBTITULO_EMPRESA : 'Ganhe dinheiro no seu próprio horário.')}
                    </p>
                </div>

                {reason === 'session_expired' && !error && !successMessage && (
                    <div role="status" className="mb-4 p-3 bg-yellow-50 border-2 border-yellow-400 text-yellow-900 rounded-xl text-sm font-medium">
                        Sua sessao expirou. Faca login novamente para continuar.
                    </div>
                )}

                {error && (
                    <div role="alert" className="mb-4 p-3 bg-red-50 border-2 border-red-500 text-red-700 rounded-xl text-sm font-medium">
                        {error}
                    </div>
                )}

                {roleMismatch && (
                    <div className="mb-4 p-4 bg-amber-50 border-2 border-amber-400 text-amber-900 rounded-xl text-sm font-medium space-y-3">
                        <p>
                            Este e-mail já está cadastrado como <strong className="font-bold">{roleLabel(roleMismatch.actualType)}</strong>.
                            {' '}Não é possível entrar como {roleLabel(explicitType)} com esta conta.
                        </p>
                        <div className="flex flex-col gap-2">
                            <Button variant="dark" fullWidth onClick={handleGoToCorrectDashboard}>
                                Ir para o dashboard de {roleLabel(roleMismatch.actualType)}
                            </Button>
                            <Button variant="secondary" fullWidth onClick={handleUseAnotherEmail}>
                                Usar outro e-mail
                            </Button>
                        </div>
                    </div>
                )}

                {successMessage && (
                    <div role="status" className="mb-4 p-3 bg-green-50 border-2 border-green-500 text-green-800 rounded-xl text-sm font-medium">
                        {successMessage}
                    </div>
                )}

                <form className="space-y-4" onSubmit={handleSubmit}>
                    <Field label="Email">
                        <input
                            type="email"
                            autoComplete="email"
                            value={email}
                            onChange={(e) => setEmail(e.target.value)}
                            required
                            placeholder="nome@exemplo.com"
                        />
                    </Field>

                    <div>
                        <Field label="Senha">
                            <input
                                type="password"
                                autoComplete={isSignUp ? "new-password" : "current-password"}
                                value={password}
                                onChange={(e) => setPassword(e.target.value)}
                                required
                                minLength={8}
                                placeholder="••••••••"
                            />
                        </Field>
                        {isSignUp && password.length > 0 && (() => {
                            const strength = getPasswordStrength(password);
                            return (
                                <div className="mt-2">
                                    <div className="h-1.5 bg-gray-200 rounded-full overflow-hidden">
                                        <div className={`h-full ${strength.color} ${strength.width} transition-all duration-300 rounded-full`} />
                                    </div>
                                    <p className="text-xs text-gray-600 mt-1">Força: {strength.label}</p>
                                </div>
                            );
                        })()}
                    </div>

                    <Button
                        type="submit"
                        variant={isHire ? 'dark' : 'primary'}
                        size="lg"
                        fullWidth
                        loading={loading}
                        className="mt-2"
                    >
                        {isSignUp ? 'Criar Conta' : 'Entrar'}
                    </Button>

                    {!isSignUp && (
                        <div className="text-center">
                            <a href="/esqueci-senha" className="inline-flex items-center min-h-11 px-2 text-sm font-semibold text-gray-600 hover:text-black transition-colors">
                                Esqueci minha senha
                            </a>
                        </div>
                    )}
                </form>

                <div className="mt-4 pt-4 border-t-2 border-gray-100 text-center text-sm text-gray-600">
                    {isSignUp ? 'Já tem uma conta?' : 'Não tem uma conta?'}{' '}
                    <button
                        type="button"
                        onClick={() => {
                            setIsSignUp(!isSignUp);
                            setError(null);
                            setSuccessMessage(null);
                            setRoleMismatch(null);
                        }}
                        className="inline-flex items-center min-h-11 px-1 underline decoration-2 underline-offset-2 font-bold text-black hover:text-primary transition-colors"
                    >
                        {isSignUp ? 'Fazer Login' : 'Cadastre-se'}
                    </button>
                </div>

                <nav aria-label="Links institucionais" className="mt-2 flex flex-wrap justify-center gap-x-4 text-xs font-semibold text-gray-600">
                    <Link to="/sobre" className="inline-flex items-center min-h-11 hover:text-black transition-colors">Sobre a Worki</Link>
                    <Link to="/termos" className="inline-flex items-center min-h-11 hover:text-black transition-colors">Termos</Link>
                    <Link to="/privacidade" className="inline-flex items-center min-h-11 hover:text-black transition-colors">Privacidade</Link>
                    <Link to="/ajuda" className="inline-flex items-center min-h-11 hover:text-black transition-colors">Ajuda</Link>
                </nav>
            </Card>
        </div>
    );
}
