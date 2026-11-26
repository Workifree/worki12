import { useEffect, useState } from 'react';
import { QRCodeSVG } from 'qrcode.react';
import { Alert, Card, Spinner } from '../ui';
import { presenceMessage } from '../../lib/presence';
import { getPresenceQr } from '../../services/presenceService';

const REFRESH_MS = 20_000;
/** O servidor aceita no máximo 60s: depois de 50s sem renovar, o código sai da tela. */
const MAX_AGE_MS = 50_000;
const FATAL = new Set(['forbidden', 'not_qr_gps', 'static_mode', 'unauthenticated']);

/** Tela "Mostrar QR do turno", exibida por quem opera o turno. O código vem pronto do servidor. */
export function ShowShiftQr({ jobId }: { jobId: string }) {
    const [qr, setQr] = useState<{ token: string; site?: string; at: number } | null>(null);
    const [problem, setProblem] = useState<string | null>(null);

    useEffect(() => {
        let active = true;
        let lastOk = 0;
        const refresh = async () => {
            const result = await getPresenceQr(jobId);
            if (!active) return;
            if (result.outcome === 'ok' && result.token) {
                lastOk = Date.now();
                setQr({ token: result.token, site: result.site_name, at: lastOk });
                setProblem(null);
                return;
            }
            setProblem(result.outcome);
            if (FATAL.has(result.outcome)) {
                setQr(null);
                clearInterval(timer);
            } else if (Date.now() - lastOk >= MAX_AGE_MS) {
                setQr(null);
            }
        };
        // Celular que volta do bloqueio: renova na hora, sem mostrar código vencido.
        const onVisible = () => {
            if (document.visibilityState !== 'visible') return;
            if (Date.now() - lastOk >= MAX_AGE_MS) setQr(null);
            void refresh();
        };
        const timer = setInterval(refresh, REFRESH_MS);
        void refresh();
        document.addEventListener('visibilitychange', onVisible);
        return () => {
            active = false;
            clearInterval(timer);
            document.removeEventListener('visibilitychange', onVisible);
        };
    }, [jobId]);

    return (
        <Card className="flex flex-col items-center gap-4 text-center">
            {qr ? (
                <>
                    {qr.site && <p className="text-base font-bold text-black">{qr.site}</p>}
                    <div role="img" aria-label="QR do turno" className="w-full max-w-xs bg-white p-3">
                        <QRCodeSVG value={qr.token} level="M" marginSize={0} className="h-auto w-full" />
                    </div>
                    <p className="text-sm text-gray-600">
                        Peça para o freela ler este código na chegada e na saída. Ele muda sozinho: não adianta fotografar.
                    </p>
                </>
            ) : !problem ? (
                <Spinner label="Gerando o QR" />
            ) : null}
            {problem && (
                <Alert tone="warning" role="alert" className="text-left">
                    {FATAL.has(problem)
                        ? presenceMessage(problem)
                        : 'Sem conexão para renovar o código. Tentando de novo…'}
                </Alert>
            )}
        </Card>
    );
}
