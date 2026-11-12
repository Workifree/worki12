import { useState } from 'react';
import { supabase } from '../lib/supabase';
import { CheckCircle, Eye, EyeOff } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { getPasswordStrength } from '../lib/validation';
import { Button, Card, Field, PageHeader } from '../components/ui';

export default function ResetPassword() {
    const navigate = useNavigate();
    const [password, setPassword] = useState('');
    const [confirm, setConfirm] = useState('');
    const [loading, setLoading] = useState(false);
    const [success, setSuccess] = useState(false);
    const [error, setError] = useState('');
    const [mostrarSenha, setMostrarSenha] = useState(false);

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
            if (msg.includes('expired') || msg.includes('Token has expired')) {
                setError('Link expirado. Solicite um novo link de recuperação.');
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

    if (success) {
        return (
            <div className="min-h-screen bg-[#F4F4F0] flex items-center justify-center p-4">
                <Card padding="lg" className="max-w-md w-full text-center">
                    <div className="w-14 h-14 bg-green-100 border-2 border-black rounded-2xl flex items-center justify-center mx-auto mb-4">
                        <CheckCircle size={28} className="text-green-600" />
                    </div>
                    <h1 className="text-2xl font-bold tracking-tight mb-2">Senha Redefinida</h1>
                    <p className="text-sm sm:text-base text-gray-600 mb-6">Sua senha foi alterada com sucesso.</p>
                    <Button variant="dark" size="lg" fullWidth onClick={() => navigate('/login')}>
                        Ir para Login
                    </Button>
                </Card>
            </div>
        );
    }

    return (
        <div className="min-h-screen bg-[#F4F4F0] flex items-center justify-center p-4">
            <Card padding="lg" className="max-w-md w-full">
                <PageHeader
                    as="h1"
                    title="Nova Senha"
                    subtitle="Escolha uma senha segura"
                    className="sm:mb-6"
                />

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
                        size="sm"
                        aria-pressed={mostrarSenha}
                        onClick={() => setMostrarSenha(v => !v)}
                        iconLeft={mostrarSenha ? <EyeOff size={16} /> : <Eye size={16} />}
                        className="-ml-3"
                    >
                        {mostrarSenha ? 'Ocultar senhas' : 'Mostrar senhas'}
                    </Button>

                    {error && (
                        <p role="alert" className="text-sm font-bold text-red-600">{error}</p>
                    )}

                    <Button
                        type="submit"
                        variant="dark"
                        size="lg"
                        fullWidth
                        loading={loading}
                        disabled={!password || !confirm}
                    >
                        Redefinir Senha
                    </Button>
                </form>
            </Card>
        </div>
    );
}
