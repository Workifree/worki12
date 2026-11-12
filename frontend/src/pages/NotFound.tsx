import { useNavigate } from 'react-router-dom';
import { ArrowLeft } from 'lucide-react';
import { Button, Card } from '../components/ui';

export default function NotFound() {
    const navigate = useNavigate();

    return (
        <div className="min-h-screen bg-[#F4F4F0] flex items-center justify-center p-4 sm:p-6 font-sans">
            <Card padding="lg" className="max-w-md w-full text-center shadow-[4px_4px_0px_0px_rgba(0,0,0,1)]">
                <p className="text-7xl font-bold tracking-tight mb-4" aria-hidden="true">404</p>
                <h1 className="text-2xl font-bold tracking-tight mb-2">Página não encontrada</h1>
                <p className="text-sm sm:text-base text-gray-600 mb-6">
                    A página que você procura não existe ou foi movida.
                </p>
                <Button
                    variant="dark"
                    size="lg"
                    onClick={() => navigate(-1)}
                    iconLeft={<ArrowLeft size={18} />}
                >
                    Voltar
                </Button>
            </Card>
        </div>
    );
}
