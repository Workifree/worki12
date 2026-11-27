import { useNavigate } from 'react-router-dom';
import { Lock } from 'lucide-react';
import PageMeta from './PageMeta';
import { Button, Card } from './ui';

/** Tela única de "sem acesso", com volta. A barreira real é o RLS/seam no banco; isto é UX. */
export default function SemAcesso({
    mensagem = 'Esta área é do Gestor da empresa.',
    voltarPara = '/company/dashboard',
    rotulo = 'Voltar ao Início',
    titulo = 'Você não tem acesso a esta tela',
}: { mensagem?: string; voltarPara?: string; rotulo?: string; titulo?: string }) {
    const navigate = useNavigate();
    return (
        <div className="mx-auto max-w-md py-8">
            <PageMeta title="Sem acesso" noindex />
            <Card padding="lg" className="text-center">
                <Lock size={36} className="mx-auto mb-3 text-gray-500" aria-hidden="true" />
                <h1 className="mb-2 text-xl font-bold">{titulo}</h1>
                <p className="mb-5 text-sm text-gray-700">{mensagem}</p>
                <Button variant="dark" size="lg" fullWidth onClick={() => navigate(voltarPara)}>{rotulo}</Button>
            </Card>
        </div>
    );
}
