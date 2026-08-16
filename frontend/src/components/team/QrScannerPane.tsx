import { useState, useEffect, useRef } from 'react';
import { Loader2, CameraOff } from 'lucide-react';
import { Html5Qrcode, Html5QrcodeSupportedFormats, Html5QrcodeScannerState } from 'html5-qrcode';
import { logError } from '../../lib/logger';

// ---------------------------------------------------------------------------
// Subcomponent: scanner de câmera QR (lê o QR de identidade do worker)
// ---------------------------------------------------------------------------

const QR_READER_ELEMENT_ID = 'add-worker-qr-reader';

export interface QrScannerPaneProps {
  /** Chamado com o texto decodificado do QR (deve ser um Worki ID / UUID). */
  onDecoded: (decodedText: string) => void;
  /** true enquanto a última leitura está sendo processada (pausa a câmera). */
  processing: boolean;
}

export function QrScannerPane({ onDecoded, processing }: QrScannerPaneProps) {
  const [cameraError, setCameraError] = useState<string | null>(null);
  const scannerRef = useRef<Html5Qrcode | null>(null);
  const onDecodedRef = useRef(onDecoded);

  useEffect(() => {
    onDecodedRef.current = onDecoded;
  }, [onDecoded]);

  useEffect(() => {
    let cancelled = false;
    const scanner = new Html5Qrcode(QR_READER_ELEMENT_ID, {
      formatsToSupport: [Html5QrcodeSupportedFormats.QR_CODE],
      verbose: false,
    });
    scannerRef.current = scanner;

    scanner
      .start(
        { facingMode: 'environment' },
        { fps: 10, qrbox: { width: 220, height: 220 } },
        (decodedText) => {
          if (cancelled) return;
          onDecodedRef.current(decodedText);
        },
        () => {
          // Frame sem QR detectado — esperado a cada tick, não é erro real.
        },
      )
      .catch((err) => {
        if (cancelled) return;
        logError('CompanyTeam.qrScanner.start', err);
        setCameraError('Não foi possível acessar a câmera. Verifique a permissão do navegador para este site.');
      });

    return () => {
      cancelled = true;
      const instance = scannerRef.current;
      if (!instance) return;
      // G1: instance.stop() pode lançar SINCRONAMENTE (não é promise rejection)
      // quando o scanner nunca chegou a iniciar (ex.: desktop sem webcam ou
      // permissão negada) — isso derrubava a tela inteira no unmount. Por
      // isso todo o cleanup vai dentro de um try/catch defensivo, e só
      // chamamos stop() se o estado indicar que a câmera está de fato rodando.
      try {
        const state = instance.getState?.();
        const isRunning =
          state === Html5QrcodeScannerState.SCANNING || state === Html5QrcodeScannerState.PAUSED;
        if (!isRunning) {
          // Nunca iniciou (ou já parou) — nada a interromper, só limpa o DOM.
          instance.clear();
          return;
        }
        instance
          .stop()
          .then(() => instance.clear())
          .catch(() => {
            // câmera pode já ter sido interrompida (unmount rápido) — seguro ignorar
          });
      } catch {
        // stop()/getState()/clear() lançou de forma síncrona — nunca deixar
        // isso escapar do cleanup do unmount.
      }
    };
  }, []);

  if (cameraError) {
    return (
      <div className="bg-red-50 border-2 border-red-200 rounded-xl p-6 text-center flex flex-col items-center gap-2">
        <CameraOff className="text-red-500" size={28} />
        <p className="text-sm font-bold text-red-600">{cameraError}</p>
      </div>
    );
  }

  return (
    <div className="relative">
      <div
        id={QR_READER_ELEMENT_ID}
        className="rounded-xl overflow-hidden border-2 border-black bg-black [&_video]:w-full [&_video]:rounded-xl"
      />
      {processing && (
        <div className="absolute inset-0 bg-black/60 rounded-xl flex items-center justify-center">
          <Loader2 className="animate-spin text-white" size={32} />
        </div>
      )}
    </div>
  );
}
