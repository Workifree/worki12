import { AlertTriangle, MapPinCheck, UserCheck } from 'lucide-react';
import { StatusBadge } from '../ui';
import { presenceSummary } from '../../lib/presence';
import type { PresenceCheck } from '../../lib/presence';

const LOOK = {
    verified: { tone: 'success', icon: MapPinCheck },
    manual: { tone: 'info', icon: UserCheck },
    unverified: { tone: 'warning', icon: AlertTriangle },
} as const;

export interface PresenceBadgeProps {
    /** Linhas de `presence_checks` de UMA candidatura. Passe só em turno `qr_gps`. */
    checks: Pick<PresenceCheck, 'kind' | 'result' | 'reason'>[];
    /** A saída já foi registrada. */
    departureDone?: boolean;
    className?: string;
}

/** Selo de presença para recibo e modal de pagamento. Informa; nunca bloqueia o pagamento. */
export function PresenceBadge({ checks, departureDone, className }: PresenceBadgeProps) {
    const { seal, label } = presenceSummary(checks, departureDone);
    return (
        <StatusBadge tone={LOOK[seal].tone} icon={LOOK[seal].icon} className={className}>
            {label}
        </StatusBadge>
    );
}
