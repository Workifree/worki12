import { useNavigate } from 'react-router-dom';
import { ArrowLeft } from 'lucide-react';

export default function NotFound() {
    const navigate = useNavigate();

    return (
        <div className="min-h-screen bg-[#F4F4F0] flex items-center justify-center p-6 font-sans">
            <div className="bg-white border-2 border-black rounded-2xl p-8 max-w-md w-full text-center shadow-[6px_6px_0px_0px_rgba(0,0,0,1)]">
                <div className="text-8xl font-black mb-4">404</div>
                <h2 className="text-2xl font-black uppercase mb-2">Página não encontrada</h2>
                <p className="text-gray-500 font-medium mb-6">
                    A página que você procura não existe ou foi movida.
                </p>
                <button
                    onClick={() => navigate(-1)}
                    className="bg-black text-white px-6 py-3 rounded-xl font-black uppercase flex items-center gap-2 mx-auto hover:bg-primary transition-colors"
                >
                    <ArrowLeft size={18} /> Voltar
                </button>
            </div>
        </div>
    );
}
