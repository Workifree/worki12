import { useNavigate } from 'react-router-dom';
import { ArrowRight } from 'lucide-react';
import { Button, Card } from '../components/ui';

export default function NotFound() {
    const navigate = useNavigate();

    return (
        <div className="min-h-screen bg-white sm:bg-canvas flex items-start sm:items-center justify-center p-4 pt-8 sm:p-6 font-sans">
            <Card padding="lg" className="max-w-md w-full text-center max-sm:border-0 max-sm:p-0">
                <p className="text-7xl font-bold tracking-tight mb-4" aria-hidden="true">404</p>
                <h1 className="text-2xl font-bold tracking-tight mb-2">Página não encontrada</h1>
                <p className="text-sm sm:text-base text-gray-600 mb-6">
                    A página que você procura não existe ou foi movida.
                </p>
                <Button
                    variant="dark"
                    size="lg"
                    onClick={() => navigate('/')}
                    iconRight={<ArrowRight size={18} />}
                >
                    Ir para o início
                </Button>
            </Card>
        </div>
    );
}
