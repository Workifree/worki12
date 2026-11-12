import { useState, useCallback, useRef } from 'react';
import { useModalDismiss } from '../../hooks/useModalDismiss';
import { Link2, Phone, QrCode, UserPlus } from 'lucide-react';
import { useToast } from '../../contexts/ToastContext';
import { TeamConnectionService } from '../../services/teamConnectionService';
import { QrScannerPane } from './QrScannerPane';
import { UUID_RE, extractInviteToken } from './utils';
import { ModalShell } from './ModalShell';
import { Button, Field } from '../ui';

// ---------------------------------------------------------------------------
// Subcomponent: modal "Adicionar freela"
// ---------------------------------------------------------------------------

type AddMethod = 'link' | 'phone' | 'qr';

export interface AddWorkerModalProps {
  onClose: () => void;
  onAdded: () => void;
  addWorker: (workerId: string, source: 'qr' | 'link' | 'phone') => Promise<boolean>;
}

export function AddWorkerModal({ onClose, onAdded, addWorker }: AddWorkerModalProps) {
  // G1: default é 'phone' (Worki ID) — NÃO monta a câmera (nem pede
  // permissão) ao abrir o modal. QR fica como tab opt-in, só monta o
  // scanner quando o usuário clica na aba QR.
  const [method, setMethod] = useState<AddMethod>('phone');
  const [workerId, setWorkerId] = useState('');
  const [linkInput, setLinkInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [qrProcessing, setQrProcessing] = useState(false);
  const qrLockRef = useRef(false);
  const { addToast } = useToast();

  // A empresa adiciona SEMPRE pelo perfil do freela (QR/Worki ID/link DO
  // freela) — nunca mandando o próprio link da empresa (esse é usado para a
  // empresa SER encontrada/adicionada, não para adicionar alguém).
  const handleLinkSubmit = async () => {
    const token = extractInviteToken(linkInput);
    const targetWorkerId = TeamConnectionService.resolveWorkerInviteToken(token);
    if (!targetWorkerId) {
      addToast('Link inválido. Peça ao freela o link de perfil dele (Perfil → "Copiar meu link").', 'error');
      return;
    }
    setLoading(true);
    const ok = await addWorker(targetWorkerId, 'link');
    setLoading(false);
    if (ok) {
      onAdded();
      onClose();
    }
  };

  const handlePhoneSubmit = async () => {
    const raw = workerId.trim();
    if (!raw) return;

    // Tolerante ao erro comum: colar o LINK/token de perfil no campo do Worki ID.
    // Se não for um UUID cru, tenta resolver como token de convite antes de desistir.
    let target = raw;
    if (!UUID_RE.test(raw)) {
      const resolved = TeamConnectionService.resolveWorkerInviteToken(extractInviteToken(raw));
      if (resolved) {
        target = resolved;
      } else {
        addToast('Worki ID inválido. Cole o Worki ID do freela (Perfil → "Meu QR de Identidade" → "Copiar Worki ID") ou use a aba Link.', 'error');
        return;
      }
    }

    setLoading(true);
    const ok = await addWorker(target, 'phone');
    setLoading(false);
    if (ok) {
      onAdded();
      onClose();
    }
  };

  // A câmera manda frames continuamente; trava para não disparar 2x a mesma leitura.
  const handleQrDecoded = useCallback(
    async (decodedText: string) => {
      if (qrLockRef.current) return;
      const candidate = decodedText.trim();

      if (!UUID_RE.test(candidate)) {
        addToast('QR inválido. Peça ao freela para abrir "Meu QR de Identidade" no perfil dele.', 'error');
        return;
      }

      qrLockRef.current = true;
      setQrProcessing(true);
      const ok = await addWorker(candidate, 'qr');
      setQrProcessing(false);

      if (ok) {
        onAdded();
        onClose();
        return;
      }
      // erro já foi mostrado via toast pelo addWorker — libera pra tentar de novo
      qrLockRef.current = false;
    },
    [addWorker, addToast, onAdded, onClose],
  );

  useModalDismiss(onClose); // so o ESC — o backdrop deles ja fechava


  return (
    <ModalShell
      title="Adicionar freela"
      subtitle="Adicione um freela pelo QR, Worki ID ou pelo link de perfil que ele te enviou."
      onClose={onClose}
    >
      {/* Tabs */}
      <div role="group" aria-label="Como adicionar" className="flex gap-5 mb-5 border-b-2 border-gray-200">
        {([
          { id: 'qr' as AddMethod, icon: QrCode, label: 'QR' },
          { id: 'phone' as AddMethod, icon: Phone, label: 'Worki ID' },
          { id: 'link' as AddMethod, icon: Link2, label: 'Link' },
        ] as const).map((tab) => (
          <button
            key={tab.id}
            type="button"
            onClick={() => setMethod(tab.id)}
            aria-pressed={method === tab.id}
            className={`-mb-0.5 min-h-11 px-1 flex items-center gap-2 text-sm font-bold border-b-4 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-black focus-visible:ring-offset-2 rounded-t-md ${
              method === tab.id
                ? 'border-black text-black'
                : 'border-transparent text-gray-500 hover:text-black'
            }`}
          >
            <tab.icon size={16} /> {tab.label}
          </button>
        ))}
      </div>

      {/* Conteúdo por método */}
      {method === 'link' && (
        <div className="space-y-4">
          <p className="text-sm text-gray-600">
            Cole o <span className="font-bold text-black">link de perfil</span> que o freela te enviou
            (ele encontra em Perfil → "Copiar meu link").
          </p>
          <Field label="Link de perfil do freela">
            <input
              id="worker-link-input"
              type="text"
              value={linkInput}
              onChange={(e) => setLinkInput(e.target.value)}
              placeholder="Cole aqui o link enviado pelo freela"
            />
          </Field>
          <Button
            variant="dark"
            fullWidth
            onClick={handleLinkSubmit}
            disabled={!linkInput.trim()}
            loading={loading}
            iconLeft={<UserPlus size={18} />}
          >
            {loading ? 'Adicionando...' : 'Adicionar pelo Link'}
          </Button>
          <p className="text-xs text-gray-600 text-center">
            O freela aparecerá em "Aguardando" até aceitar o convite.
          </p>
        </div>
      )}

      {method === 'qr' && (
        <div className="space-y-4">
          <p className="text-sm text-gray-600">
            Aponte a câmera para o <span className="font-bold text-black">QR de Identidade</span> do freela
            (ele encontra em Perfil → "Meu QR de Identidade").
          </p>
          <QrScannerPane onDecoded={handleQrDecoded} processing={qrProcessing} />
          <p className="text-xs text-gray-600 text-center">
            O freela aparecerá em "Aguardando" até aceitar o convite.
          </p>
        </div>
      )}

      {method === 'phone' && (
        <div className="space-y-4">
          <p className="text-sm text-gray-600">
            Digite o <span className="font-bold text-black">ID do worker</span> (Worki ID) para adicionar diretamente.
            Peça o Worki ID ao freela (Perfil dele → "Meu QR de Identidade" → "Copiar Worki ID").
          </p>
          <Field label="Worki ID do freela">
            <input
              id="phone-input"
              type="text"
              value={workerId}
              onChange={(e) => setWorkerId(e.target.value)}
              placeholder="Cole o ID do freela aqui"
            />
          </Field>
          <Button
            variant="dark"
            fullWidth
            onClick={handlePhoneSubmit}
            disabled={!workerId.trim()}
            loading={loading}
            iconLeft={<UserPlus size={18} />}
          >
            {loading ? 'Enviando...' : 'Enviar Convite'}
          </Button>
          <p className="text-xs text-gray-600">
            Ainda não é possível buscar por CPF ou telefone — peça o Worki ID ao freela.
          </p>
        </div>
      )}
    </ModalShell>
  );
}
