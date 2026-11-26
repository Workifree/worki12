import { Suspense, lazy, useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { MapPin, QrCode } from 'lucide-react';
import { Alert, Button, Spinner } from '../ui';
import { kindLabel, presenceMessage } from '../../lib/presence';
import type { PresenceExceptionReason, PresenceKind } from '../../lib/presence';
import { GEO_FAILURE_MESSAGES, getDevicePosition } from '../../lib/presenceGeo';
import type { DevicePosition, GeoFailure } from '../../lib/presenceGeo';
import {
    registerDepartureUnverified, requestPresenceException, verifyPresence,
} from '../../services/presenceService';

// O leitor (html5-qrcode) é pesado: só baixa quando a câmera vai abrir. Ele entrega o texto cru,
// que segue sem interpretação para o servidor.
const QrScannerPane = lazy(() => import('../team/QrScannerPane').then((m) => ({ default: m.QrScannerPane })));

/** Posição mais velha que isto é lida de novo antes do envio. */
const STALE_POSITION_MS = 60_000;

type Step =
    | { name: 'intro' }
    | { name: 'locating' }
    | { name: 'geo_failed'; failure: GeoFailure }
    | { name: 'scanning' }
    | { name: 'sending' }
    | { name: 'rejected'; outcome: string; distance?: number | null; radius?: number | null }
    | { name: 'done'; message: string; tone: 'success' | 'info' };

/** Desfechos em que tentar de novo não muda nada. */
const FINAL = new Set(['already_verified', 'already_registered', 'not_owner', 'not_qr_gps', 'invalid_status', 'no_arrival', 'outside_window']);

function reasonFor(step: Step): PresenceExceptionReason {
    if (step.name === 'geo_failed') return step.failure === 'denied' ? 'gps_negado' : 'sem_sinal_gps';
    if (step.name === 'scanning') return 'qr_ilegivel';
    if (step.name === 'rejected') {
        if (step.outcome.startsWith('qr_')) return 'qr_ilegivel';
        if (step.outcome === 'gps_low_accuracy') return 'sem_sinal_gps';
        if (step.outcome === 'gps_out_of_range') return 'local_mudou';
    }
    return 'outro';
}

export interface PresenceCheckFlowProps {
    applicationId: string;
    kind: PresenceKind;
    /** Chamado quando algo foi gravado (verificado, ou saída sem verificação): recarregar o turno. */
    onRegistered: () => void;
    onClose?: () => void;
}

/**
 * Fluxo do freela: aviso → localização → QR → servidor decide. A alternativa "Pedir confirmação ao
 * responsável" fica sempre à mão: negar a localização não impede trabalhar nem receber.
 */
export function PresenceCheckFlow({ applicationId, kind, onRegistered, onClose }: PresenceCheckFlowProps) {
    const [step, setStep] = useState<Step>({ name: 'intro' });
    const [help, setHelp] = useState<{ sending: boolean; message: string | null }>({ sending: false, message: null });
    const [registering, setRegistering] = useState(false);
    const position = useRef<DevicePosition | null>(null);
    // O leitor dispara a cada quadro: só o primeiro envia.
    const submitting = useRef(false);
    const alive = useRef(true);
    useEffect(() => {
        alive.current = true;
        return () => { alive.current = false; };
    }, []);

    const locate = async () => {
        setHelp({ sending: false, message: null });
        setStep({ name: 'locating' });
        const result = await getDevicePosition();
        if (!alive.current) return;
        if (!result.ok) {
            setStep({ name: 'geo_failed', failure: result.failure });
            return;
        }
        position.current = result.position;
        submitting.current = false;
        setStep({ name: 'scanning' });
    };

    const submit = async (qr: string) => {
        if (submitting.current || !position.current) return;
        submitting.current = true;
        setStep({ name: 'sending' });
        let current = position.current;
        if (Date.now() - current.takenAt > STALE_POSITION_MS) {
            const fresh = await getDevicePosition();
            if (!alive.current) return;
            if (!fresh.ok) {
                setStep({ name: 'geo_failed', failure: fresh.failure });
                return;
            }
            current = fresh.position;
        }
        const result = await verifyPresence(applicationId, kind, qr, current);
        position.current = null;
        if (!alive.current) return;
        if (result.outcome === 'verified') {
            setStep({ name: 'done', tone: 'success', message: `${presenceMessage('verified')} ${kind === 'arrival' ? 'Chegada' : 'Saída'} registrada.` });
            onRegistered();
        } else {
            setStep({ name: 'rejected', outcome: result.outcome, distance: result.distance_m, radius: result.radius_m });
        }
    };

    const askForHelp = async () => {
        const reason = reasonFor(step);
        setHelp({ sending: true, message: null });
        const result = await requestPresenceException(applicationId, kind, reason);
        if (alive.current) setHelp({ sending: false, message: presenceMessage(result.outcome) });
    };

    const leaveUnverified = async () => {
        setRegistering(true);
        const result = await registerDepartureUnverified(applicationId);
        if (!alive.current) return;
        setRegistering(false);
        if (result.outcome === 'registered') {
            setStep({ name: 'done', tone: 'info', message: presenceMessage('registered') });
            onRegistered();
        } else {
            setHelp({ sending: false, message: presenceMessage(result.outcome) });
        }
    };

    const offerHelp = step.name === 'geo_failed' || step.name === 'scanning'
        || (step.name === 'rejected' && !FINAL.has(step.outcome)) || step.name === 'intro';

    return (
        <div className="space-y-4">
            <div aria-live="polite" className="space-y-4">
                {step.name === 'intro' && (
                    <>
                        <p className="text-sm text-black">
                            Para registrar a {kindLabel(kind)}, vamos pedir sua localização uma vez e ler o QR do local.
                        </p>
                        <Alert tone="info" title="Sobre sua localização">
                            Ela serve só para conferir se você está no local agora. Guardamos o resultado, a distância e a
                            precisão, não as coordenadas. Não acompanhamos você. Se preferir não compartilhar, peça a
                            confirmação ao responsável.{' '}
                            <Link to="/privacidade" className="font-bold underline">Política de Privacidade</Link>
                        </Alert>
                        <Button variant="primary" fullWidth onClick={locate} iconLeft={<MapPin size={18} aria-hidden="true" />}>
                            Continuar
                        </Button>
                    </>
                )}

                {(step.name === 'locating' || step.name === 'sending') && (
                    <div className="flex items-center gap-3 py-4 text-sm font-bold text-black">
                        <Spinner label="" />
                        {step.name === 'locating' ? 'Buscando sua localização…' : 'Conferindo…'}
                    </div>
                )}

                {step.name === 'geo_failed' && (
                    <Alert tone="warning" title="Sem localização">{GEO_FAILURE_MESSAGES[step.failure]}</Alert>
                )}

                {step.name === 'scanning' && (
                    <p className="flex items-center gap-2 text-sm font-bold text-black">
                        <QrCode size={18} aria-hidden="true" /> Aponte a câmera para o QR do local.
                    </p>
                )}

                {step.name === 'rejected' && (
                    <Alert tone="warning" title="Não foi possível verificar">
                        {presenceMessage(step.outcome)}
                        {step.outcome === 'gps_out_of_range' && step.distance != null && step.radius != null
                            && ` Distância calculada: cerca de ${step.distance} m (área de ${step.radius} m).`}
                    </Alert>
                )}

                {step.name === 'done' && <Alert tone={step.tone}>{step.message}</Alert>}
            </div>

            {step.name === 'scanning' && (
                <Suspense fallback={<Spinner label="Abrindo a câmera" />}>
                    <QrScannerPane onDecoded={submit} processing={false} />
                </Suspense>
            )}

            {(step.name === 'geo_failed' || (step.name === 'rejected' && !FINAL.has(step.outcome))) && (
                <Button variant="primary" fullWidth onClick={locate}>Tentar de novo</Button>
            )}

            {offerHelp && (
                <div className="space-y-2">
                    <Button variant="secondary" fullWidth onClick={askForHelp} loading={help.sending}>
                        Pedir confirmação ao responsável
                    </Button>
                    {kind === 'departure' && (
                        <Button variant="ghost" fullWidth onClick={leaveUnverified} loading={registering}>
                            Registrar saída sem verificação
                        </Button>
                    )}
                    {kind === 'departure' && (
                        <p className="text-xs text-gray-600">
                            Sem verificação, a saída fica marcada como não verificada. Isso não impede o pagamento.
                        </p>
                    )}
                </div>
            )}

            <p role="status" className="text-sm font-semibold text-black">{help.message}</p>

            {onClose && (step.name === 'done' || (step.name === 'rejected' && FINAL.has(step.outcome))) && (
                <Button variant="secondary" fullWidth onClick={onClose}>Fechar</Button>
            )}
        </div>
    );
}
