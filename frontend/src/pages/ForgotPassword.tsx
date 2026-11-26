import { useState, useEffect, useRef, useCallback } from 'react';
import { supabase } from '../lib/supabase';
import { CheckCircle } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { Button, Field } from '../components/ui';
import { AuthShell } from '../components/AuthShell';

export default function ForgotPassword() {
    const navigate = useNavigate();
    const [email, setEmail] = useState('');
    const [loading, setLoading] = useState(false);
    const [sent, setSent] = useState(false);
    const [error, setError] = useState('');
    const [cooldown, setCooldown] = useState(0);
    const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

    const startCooldown = useCallback(() => {
        setCooldown(60);
        timerRef.current = setInterval(() => {
            setCooldown(prev => {
                if (prev <= 1) {
                    if (timerRef.current) clearInterval(timerRef.current);
                    return 0;
                }
                return prev - 1;
            });
        }, 1000);
    }, []);

    useEffect(() => {
        return () => {
            if (timerRef.current) clearInterval(timerRef.current);
        };
    }, []);

    // Envio real do link — reutilizado pelo submit E pelo botao "Reenviar Email".
    const enviarLink = useCallback(async (emailStr: string) => {
        setLoading(true);
        const { error: resetError } = await supabase.auth.resetPasswordForEmail(emailStr, {
            redirectTo: `${window.location.origin}/redefinir-senha`,
        });
        setLoading(false);

        if (resetError) {
            const msg = resetError.message || '';
            if (msg.includes('rate limit') || msg.includes('too many')) {
                setError('Muitas tentativas. Aguarde alguns minutos e tente novamente.');
                return false;
            }
            if (msg.includes('invalid') && msg.includes('email')) {
                setError('Informe um e-mail válido.');
                return false;
            }
            // "user not found" e afins: mostra sucesso mesmo assim (nao revela se o email existe).
        }
        setSent(true);
        startCooldown();
        return true;
    }, [startCooldown]);

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        setError('');
        if (!email.trim() || !email.includes('@')) {
            setError('Informe um e-mail válido.');
            return;
        }
        await enviarLink(email.trim());
    };

    if (sent) {
        return (
            <AuthShell backTo="/login" backLabel="Voltar para o login" title="Email Enviado">
                <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-xl bg-green-50">
                    <CheckCircle size={24} className="text-primary-dark" aria-hidden="true" />
                </div>
                <p className="mb-6 text-sm text-gray-700 sm:text-base">
                    Se o e-mail <strong className="break-all">{email}</strong> estiver cadastrado, você receberá um link para redefinir sua senha.
                </p>
                <div className="flex flex-col gap-3">
                    <Button
                        variant="dark"
                        size="lg"
                        fullWidth
                        onClick={() => { setError(''); void enviarLink(email.trim()); }}
                        disabled={cooldown > 0 || loading}
                    >
                        {loading ? 'Enviando...' : cooldown > 0 ? `Reenviar em ${cooldown}s` : 'Reenviar Email'}
                    </Button>
                    {error && <p role="alert" className="text-sm font-bold text-red-700">{error}</p>}
                    <Button variant="secondary" size="lg" fullWidth onClick={() => navigate('/login')}>
                        Voltar para Login
                    </Button>
                </div>
            </AuthShell>
        );
    }

    return (
        <AuthShell backTo="/login" title="Esqueci a Senha" subtitle="Enviaremos um link para seu e-mail">
            <form onSubmit={handleSubmit} className="space-y-4">
                <Field label="Email" error={error || undefined}>
                    <input
                        type="email"
                        value={email}
                        onChange={e => setEmail(e.target.value)}
                        placeholder="seu@email.com"
                        autoFocus
                    />
                </Field>

                <Button
                    type="submit"
                    variant="dark"
                    size="lg"
                    fullWidth
                    loading={loading}
                    disabled={!email.trim() || cooldown > 0}
                    data-copilot="publico.recuperar-senha.enviar-link"
                >
                    {cooldown > 0 ? `Aguarde ${cooldown}s` : 'Enviar Link de Recuperação'}
                </Button>
            </form>
        </AuthShell>
    );
}
