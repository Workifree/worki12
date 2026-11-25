import { useState } from 'react';
import type { FormEvent } from 'react';
import { Alert, Button, Card, Field } from '../ui';
import { EXCEPTION_REASONS, NOTE_MAX, kindLabel, presenceMessage } from '../../lib/presence';
import type { PresenceExceptionReason, PresenceKind } from '../../lib/presence';
import { recordPresenceException, registerDepartureUnverified } from '../../services/presenceService';

export interface PresenceExceptionPanelProps {
    applicationId: string;
    kind: PresenceKind;
    workerName: string;
    /** Motivo informado pelo freela, quando ele pediu ajuda. */
    requestedReason?: PresenceExceptionReason | null;
    onDecided: () => void;
}

/** Confirmação manual por quem opera o turno. Fica marcada no recibo, com o motivo. */
export function PresenceExceptionPanel({
    applicationId, kind, workerName, requestedReason, onDecided,
}: PresenceExceptionPanelProps) {
    const [reason, setReason] = useState<PresenceExceptionReason | ''>(requestedReason ?? '');
    const [note, setNote] = useState('');
    const [reasonError, setReasonError] = useState<string>();
    const [failure, setFailure] = useState<string | null>(null);
    const [busy, setBusy] = useState<'confirm' | 'unverified' | null>(null);

    const finish = (outcome: string, success: string) => {
        setBusy(null);
        if (outcome === success || outcome === 'already_verified') onDecided();
        else setFailure(presenceMessage(outcome));
    };

    const confirm = async (event: FormEvent) => {
        event.preventDefault();
        if (!reason) {
            setReasonError('Escolha o motivo.');
            return;
        }
        setBusy('confirm');
        setFailure(null);
        const result = await recordPresenceException(applicationId, kind, reason, note);
        finish(result.outcome, 'recorded');
    };

    const unverified = async () => {
        setBusy('unverified');
        setFailure(null);
        const result = await registerDepartureUnverified(applicationId);
        finish(result.outcome, 'registered');
    };

    return (
        <Card tone="nested" padding="sm">
            <form noValidate onSubmit={confirm} className="space-y-3">
                <div>
                    <h3 className="text-base font-bold text-black">Confirmar {kindLabel(kind)} de {workerName}</h3>
                    {requestedReason && (
                        <p className="text-sm text-gray-600">Pediu confirmação: {EXCEPTION_REASONS[requestedReason]}.</p>
                    )}
                    <p className="text-xs text-gray-600">
                        Confirme só se você sabe que a pessoa está (ou esteve) no local. O recibo mostrará que foi manual.
                    </p>
                </div>
                <Field label="Motivo" required error={reasonError}>
                    <select
                        value={reason}
                        onChange={(e) => {
                            setReason(e.target.value as PresenceExceptionReason | '');
                            setReasonError(undefined);
                        }}
                    >
                        <option value="">Escolha…</option>
                        {Object.entries(EXCEPTION_REASONS).map(([value, label]) => (
                            <option key={value} value={value}>{label}</option>
                        ))}
                    </select>
                </Field>
                <Field label="Observação (opcional)" hint="O freela pode ler. Não escreva dados de saúde nem documentos.">
                    <input value={note} maxLength={NOTE_MAX} onChange={(e) => setNote(e.target.value)} />
                </Field>
                {failure && <Alert tone="danger" role="alert">{failure}</Alert>}
                <Button type="submit" variant="dark" fullWidth loading={busy === 'confirm'} disabled={busy !== null}>
                    Confirmar {kindLabel(kind)} manualmente
                </Button>
                {kind === 'departure' && (
                    <Button variant="ghost" fullWidth onClick={unverified} loading={busy === 'unverified'} disabled={busy !== null}>
                        Confirmar saída sem verificação
                    </Button>
                )}
            </form>
        </Card>
    );
}
