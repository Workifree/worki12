import { useEffect, useState } from 'react';
import { checkSession } from '../lib/authSession';
import { logError } from '../lib/logger';
import { supabase } from '../lib/supabase';
import { CheckCircle, Eye, EyeOff } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { getPasswordStrength } from '../lib/validation';
import { Button, Field } from '../components/ui';
import { AuthShell } from '../components/AuthShell';

export default function ResetPassword() {
    const navigate = useNavigate();
    const [password, setPassword] = useState('');
    const [confirm, setConfirm] = useState('');
    const [loading, setLoading] = useState(false);
    const [success, setSuccess] = useState(false);
    const [error, setError] = useState('');
    const [mostrarSenha, setMostrarSenha] = useState(false);

    // Sem a sessão que o link de recuperação abre, o formulário não tem como funcionar.
    const [linkMorto, setLinkMorto] = useState(false);

    useEffect(() => {
        let active = true;
        checkSession()
            .then((session) => { if (active && session.status === 'signed_out') setLinkMorto(true); })
            .catch((err: unknown) => logError('ResetPassword.session', err));
        return () => { active = false; };
    }, []);

    const strength = getPasswordStrength(password);

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        setError('');

        if (password.length < 8) {
            setError('A senha deve ter pelo menos 8 caracteres.');
            return;
        }
        if (password !== confirm) {
            setError('As senhas não coincidem.');
            return;
        }

        setLoading(true);
        const { error: updateError } = await supabase.auth.updateUser({ password });
        setLoading(false);

        if (updateError) {
            const msg = updateError.message || '';
            if (msg.includes('expired') || msg.includes('session missing')) {
                setLinkMorto(true);
            } else if (msg.includes('invalid') || msg.includes('Invalid token') || msg.includes('not found')) {
                setError('Link inválido. Solicite um novo link de recuperação.');
            } else if (msg.includes('weak') || msg.includes('too short') || msg.includes('at least')) {
                setError('Senha muito fraca. Use no mínimo 8 caracteres, com letras e números.');
            } else {
                setError('Erro ao redefinir senha. Tente novamente ou solicite um novo link.');
            }
            return;
        }

        setSuccess(true);
    };

    if (linkMorto) {
        return (
            <AuthShell title="Este link expirou" subtitle="Links de redefinição valem por pouco tempo e só uma vez. Peça um novo.">
                <div className="flex flex-col gap-3">
                    <Button variant="dark" size="lg" fullWidth onClick={() => navigate('/esqueci-senha')} data-copilot="publico.redefinir-senha.pedir-novo-link">
                        Pedir novo link
                    </Button>
                    <Button variant="secondary" size="lg" fullWidth onClick={() => navigate('/login')}>
                        Ir para o login
                    </Button>
                </div>
            </AuthShell>
        );
    }

    if (success) {
        return (
            <AuthShell title="Senha Redefinida" subtitle="Sua senha foi alterada com sucesso.">
                <div className="mb-6 flex h-12 w-12 items-center justify-center rounded-xl bg-green-50">
                    <CheckCircle size={24} className="text-primary-dark" aria-hidden="true" />
                </div>
                <Button variant="dark" size="lg" fullWidth onClick={() => navigate('/login')}>
                    Ir para Login
                </Button>
            </AuthShell>
        );
    }

    return (
        <AuthShell title="Nova Senha" subtitle="Escolha uma senha segura">
            <form onSubmit={handleSubmit} className="space-y-4">
                <div>
                    <Field label="Nova senha">
                        <input
                            type={mostrarSenha ? 'text' : 'password'}
                            value={password}
                            onChange={e => setPassword(e.target.value)}
                            placeholder="Mínimo 8 caracteres"
                            autoComplete="new-password"
                            autoFocus
                        />
                    </Field>
                    {password.length > 0 && (
                        <div className="mt-2">
                            <div className="h-1.5 bg-gray-200 rounded-full overflow-hidden">
                                <div className={`h-full ${strength.color} ${strength.width} transition-all duration-300 rounded-full`} />
                            </div>
                            <p className="text-xs text-gray-600 mt-1">Força: {strength.label}</p>
                        </div>
                    )}
                </div>

                <Field label="Confirmar senha">
                    <input
                        type={mostrarSenha ? 'text' : 'password'}
                        value={confirm}
                        onChange={e => setConfirm(e.target.value)}
                        placeholder="Repita a senha"
                        autoComplete="new-password"
                    />
                </Field>

                <Button
                    variant="ghost"
                    size="md"
                    aria-pressed={mostrarSenha}
                    onClick={() => setMostrarSenha(v => !v)}
                    iconLeft={mostrarSenha ? <EyeOff size={16} /> : <Eye size={16} />}
                    className="-ml-3"
                >
                    {mostrarSenha ? 'Ocultar senhas' : 'Mostrar senhas'}
                </Button>

                {error && (
                    <p role="alert" className="text-sm font-bold text-red-700">{error}</p>
                )}

                <Button
                    type="submit"
                    variant="dark"
                    size="lg"
                    fullWidth
                    loading={loading}
                    disabled={!password || !confirm}
                    data-copilot="publico.redefinir-senha.salvar"
                >
                    Redefinir Senha
                </Button>
            </form>
        </AuthShell>
    );
}
