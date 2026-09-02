import { useState, useEffect, useRef, useCallback } from 'react';
import { supabase } from '../lib/supabase';
import { ArrowLeft, Mail, Loader2, CheckCircle } from 'lucide-react';
import { useNavigate } from 'react-router-dom';

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
                <div className="bg-white rounded-2xl border-2 border-black p-8 max-w-md w-full text-center">
                    <div className="w-16 h-16 bg-green-100 rounded-full flex items-center justify-center mx-auto mb-4">
                        <CheckCircle size={32} className="text-green-600" />
                    </div>
                    <h1 className="text-2xl font-black uppercase mb-2">Email Enviado</h1>
                    <p className="text-gray-600 mb-6">
                        Se o email <strong>{email}</strong> estiver cadastrado, voce recebera um link para redefinir sua senha.
                    </p>
                    <button
                        onClick={() => { setError(''); void enviarLink(email.trim()); }}
                        disabled={cooldown > 0 || loading}
                        className="w-full bg-black text-white py-3 rounded-xl font-bold uppercase hover:bg-gray-800 transition-colors disabled:opacity-50 mb-3"
                    >
                        {loading ? 'Enviando...' : cooldown > 0 ? `Reenviar em ${cooldown}s` : 'Reenviar Email'}
                    </button>
                    {error && <p className="text-sm font-bold text-red-500 mb-3">{error}</p>}
                    <button
                        onClick={() => navigate('/login')}
                        className="w-full border-2 border-black text-black py-3 rounded-xl font-bold uppercase hover:bg-gray-100 transition-colors"
                    >
                        Voltar para Login
                    </button>
                </div>
            </div>
        );
    }

    return (
        <div className="min-h-screen bg-[#F4F4F0] flex items-center justify-center p-4">
            <div className="bg-white rounded-2xl border-2 border-black p-8 max-w-md w-full">
                <button onClick={() => navigate('/login')} className="flex items-center gap-2 text-gray-500 mb-6 hover:text-black">
                    <ArrowLeft size={20} /> Voltar
                </button>

                <div className="flex items-center gap-3 mb-6">
                    <div className="w-12 h-12 bg-blue-100 rounded-xl flex items-center justify-center">
                        <Mail size={24} className="text-blue-600" />
                    </div>
                    <div>
                        <h1 className="text-2xl font-black uppercase">Esqueci a Senha</h1>
                        <p className="text-sm text-gray-500">Enviaremos um link para seu email</p>
                    </div>
                </div>

                <form onSubmit={handleSubmit} className="space-y-4">
                    <div>
                        <label className="text-xs font-bold uppercase block mb-1">Email</label>
                        <input
                            type="email"
                            value={email}
                            onChange={e => setEmail(e.target.value)}
                            aria-label="Email"
                            className="w-full border-2 border-gray-200 rounded-xl p-3 focus:border-black outline-none"
                            placeholder="seu@email.com"
                            autoFocus
                        />
                    </div>

                    {error && (
                        <p className="text-red-600 text-sm font-bold">{error}</p>
                    )}

                    <button
                        type="submit"
                        disabled={loading || !email.trim() || cooldown > 0}
                        className="w-full bg-black text-white py-3 rounded-xl font-bold uppercase hover:bg-gray-800 transition-colors disabled:opacity-50 flex items-center justify-center gap-2"
                    >
                        {loading ? <Loader2 className="animate-spin" size={20} /> : cooldown > 0 ? `Aguarde ${cooldown}s` : 'Enviar Link de Recuperação'}
                    </button>
                </form>
            </div>
        </div>
    );
}
