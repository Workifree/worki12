import { useEffect, useState } from 'react';
import { QRCodeSVG } from 'qrcode.react';
import { Printer, RefreshCw } from 'lucide-react';
import { Alert, Button, Card, DialogActions, DialogHeader, ErrorState, Spinner } from '../ui';
import { Dialog } from '../ui/Dialog';
import { presenceMessage } from '../../lib/presence';
import { getSiteStaticQr, rotateSiteSecret } from '../../services/presenceService';
import type { PresenceQr } from '../../services/presenceService';

// Na impressão só o cartaz aparece, seja qual for a casca da página.
const PRINT_CSS = `@media print {
  body * { visibility: hidden !important; }
  .presence-poster, .presence-poster * { visibility: visible !important; }
  .presence-poster { position: fixed; inset: 0; border: 0 !important; display: flex; flex-direction: column; align-items: center; justify-content: center; }
  @page { size: A4; margin: 15mm; }
}`;

/** Cartaz A4 do QR fixo do local (só Gestor). Gerado no navegador; "Salvar como PDF" é do próprio sistema. */
export function SiteQrPrint({ siteId }: { siteId: string }) {
    const [reload, setReload] = useState(0);
    // A resposta vale só para o pedido que a gerou: trocar de local ou renovar volta a carregar.
    const [loaded, setLoaded] = useState<{ key: string; data: PresenceQr } | null>(null);
    const key = `${siteId}:${reload}`;
    const qr = loaded?.key === key ? loaded.data : null;
    const [confirming, setConfirming] = useState(false);
    const [rotating, setRotating] = useState(false);
    const [rotateError, setRotateError] = useState<string | null>(null);

    useEffect(() => {
        let active = true;
        void getSiteStaticQr(siteId).then((data) => { if (active) setLoaded({ key: `${siteId}:${reload}`, data }); });
        return () => { active = false; };
    }, [siteId, reload]);

    const rotate = async () => {
        setRotating(true);
        const result = await rotateSiteSecret(siteId);
        setRotating(false);
        setConfirming(false);
        if (result.outcome === 'rotated') {
            setRotateError(null);
            setReload((n) => n + 1);
        } else {
            setRotateError(presenceMessage(result.outcome));
        }
    };

    if (!qr) return <Spinner label="Carregando o QR" />;
    if (qr.outcome === 'error') return <ErrorState onRetry={() => setReload((n) => n + 1)} />;
    if (qr.outcome !== 'ok' || !qr.token) return <Alert tone="warning">{presenceMessage(qr.outcome)}</Alert>;

    return (
        <div className="space-y-4">
            <style>{PRINT_CSS}</style>
            <Alert tone="warning" title="O QR impresso pode ser fotografado">
                Ele só vale em turnos marcados como "QR impresso". Neles, quem confirma que a pessoa está no local é a
                localização, que pode ser falsificada. Se houver alguém no local, prefira o QR da tela.
            </Alert>
            {rotateError && <Alert tone="danger" role="alert">{rotateError}</Alert>}
            <Card className="presence-poster text-center">
                <h2 className="text-2xl font-bold text-black">{qr.site_name}</h2>
                {qr.address_text && <p className="mt-1 text-sm text-gray-600">{qr.address_text}</p>}
                <div role="img" aria-label="QR fixo do local" className="mx-auto my-6 w-full max-w-sm bg-white p-3">
                    <QRCodeSVG value={qr.token} level="M" marginSize={0} className="h-auto w-full" />
                </div>
                <p className="text-base font-bold text-black">Freela: leia este código no Workyn ao chegar e ao sair.</p>
            </Card>
            <div className="flex flex-col gap-3 sm:flex-row sm:justify-end">
                <Button variant="dangerOutline" onClick={() => setConfirming(true)} iconLeft={<RefreshCw size={16} aria-hidden="true" />}>
                    Gerar novo código
                </Button>
                <Button variant="dark" onClick={() => window.print()} iconLeft={<Printer size={16} aria-hidden="true" />}>
                    Imprimir cartaz
                </Button>
            </div>
            {confirming && (
                <Dialog labelledBy="rotate-qr-title" role="alertdialog" onClose={() => setConfirming(false)} locked={rotating}>
                    <DialogHeader titleId="rotate-qr-title" title="Gerar um novo código?" />
                    <p className="text-sm text-black">
                        Todo cartaz já impresso deste local para de funcionar, e os códigos de tela em aberto são renovados.
                    </p>
                    <DialogActions>
                        <Button variant="secondary" onClick={() => setConfirming(false)} disabled={rotating}>Voltar</Button>
                        <Button variant="danger" onClick={rotate} loading={rotating}>Gerar novo</Button>
                    </DialogActions>
                </Dialog>
            )}
        </div>
    );
}
