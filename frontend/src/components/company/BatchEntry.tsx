import { CalendarRange, History } from 'lucide-react';
import { isLoteEnabled } from '../../lib/features';
import { ButtonLink } from '../ui';

/** Atalhos da criação em lote. Desligada, não renderiza nada. */
export default function BatchEntry({ className = '' }: { className?: string }) {
    if (!isLoteEnabled()) return null;
    return (
        <div className={`flex flex-wrap gap-2 ${className}`}>
            <ButtonLink variant="secondary" size="sm" to="/company/create">
                <CalendarRange size={16} aria-hidden="true" /> Vários de uma vez
            </ButtonLink>
            <ButtonLink variant="secondary" size="sm" to="/company/create?copiar=fim-de-semana">
                <History size={16} aria-hidden="true" /> Copiar fim de semana
            </ButtonLink>
        </div>
    );
}
