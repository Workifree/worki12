/**
 * Próximo passo de presença em turno `qr_gps`: o freela registra com QR e localização; quem opera
 * mostra o QR e, se precisar, confirma por exceção. Não há confirmação direta (o banco recusa).
 */
import { useState } from 'react';
import { QrCode } from 'lucide-react';
import { PresenceExceptionPanel } from '../presence/PresenceExceptionPanel';
import { Button, ButtonLink } from '../ui';
import { kindLabel, pendingExceptionRequests, type PresenceCheck, type PresenceKind, type PresenceQrMode } from '../../lib/presence';

export interface QrPresenceStepProps {
    jobId: string;
    applicationId: string;
    workerName: string;
    kind: PresenceKind;
    qrMode: PresenceQrMode;
    /** `null` = falha de leitura dos registros. */
    checks: PresenceCheck[] | null;
    primary: boolean;
    onDecided: () => void;
}

export default function QrPresenceStep({
    jobId, applicationId, workerName, kind, qrMode, checks, primary, onDecided,
}: QrPresenceStepProps) {
    const [open, setOpen] = useState(false);
    const request = pendingExceptionRequests((checks ?? []).filter((c) => c.application_id === applicationId))
        .find((c) => c.kind === kind);

    return (
        <div className="space-y-2">
            {qrMode === 'rotating' ? (
                <ButtonLink variant={primary ? 'dark' : 'secondary'} fullWidth to={`/company/jobs/${jobId}/qr`}>
                    <QrCode size={16} aria-hidden="true" /> Mostrar QR do turno
                </ButtonLink>
            ) : (
                <p className="text-sm text-gray-600">O freela lê o cartaz do QR impresso no local.</p>
            )}
            {open || request ? (
                // O pedido pode chegar depois do painel aberto: a chave recarrega o motivo.
                <div data-copilot-risk="D">
                    <PresenceExceptionPanel
                        key={`${kind}:${request?.id ?? ''}`}
                        applicationId={applicationId}
                        kind={kind}
                        workerName={workerName}
                        requestedReason={request?.reason}
                        onDecided={() => { setOpen(false); onDecided(); }}
                    />
                </div>
            ) : (
                <Button variant="ghost" fullWidth data-copilot-risk="D" onClick={() => setOpen(true)}>
                    Confirmar {kindLabel(kind)} sem QR
                </Button>
            )}
        </div>
    );
}
