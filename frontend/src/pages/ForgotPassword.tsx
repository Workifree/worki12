import { useState, useEffect, useRef, useCallback } from 'react';
import { supabase } from '../lib/supabase';
import { ArrowLeft, CheckCircle } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { Button, Card, Field, PageHeader } from '../components/ui';

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
            <div className="min-h-screen bg-[#F4F4F0] flex items-center justify-center p-4">
                <Card padding="lg" className="max-w-md w-full text-center">
                    <div className="w-14 h-14 bg-green-100 border-2 border-black rounded-2xl flex items-center justify-center mx-auto mb-4">
                        <CheckCircle size={28} className="text-green-600" />
                    </div>
                    <h1 className="text-2xl font-bold tracking-tight mb-2">Email Enviado</h1>
                    <p className="text-sm sm:text-base text-gray-600 mb-6">
                        Se o email <strong>{email}</strong> estiver cadastrado, voce recebera um link para redefinir sua senha.
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
                        {error && <p role="alert" className="text-xs font-bold text-red-600">{error}</p>}
                        <Button variant="secondary" size="lg" fullWidth onClick={() => navigate('/login')}>
                            Voltar para Login
                        </Button>
                    </div>
                </Card>
            </div>
        );
    }

    return (
        <div className="min-h-screen bg-[#F4F4F0] flex items-center justify-center p-4">
            <Card padding="lg" className="max-w-md w-full">
                <Button
                    variant="ghost"
                    size="md"
                    onClick={() => navigate('/login')}
                    iconLeft={<ArrowLeft size={16} />}
                    className="-ml-3 mb-4"
                >
                    Voltar
                </Button>

                <PageHeader
                    as="h1"
                    title="Esqueci a Senha"
                    subtitle="Enviaremos um link para seu email"
                    className="sm:mb-6"
                />

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
                    >
                        {cooldown > 0 ? `Aguarde ${cooldown}s` : 'Enviar Link de Recuperação'}
                    </Button>
                </form>
            </Card>
        </div>
    );
}
