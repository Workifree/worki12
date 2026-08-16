import { useState, useCallback, useRef } from 'react';
import { Link2, Phone, QrCode, X, Loader2, UserPlus } from 'lucide-react';
import { useToast } from '../../contexts/ToastContext';
import { TeamConnectionService } from '../../services/teamConnectionService';
import { QrScannerPane } from './QrScannerPane';
import { UUID_RE, extractInviteToken } from './utils';

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
  const [phone, setPhone] = useState('');
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

  return (
    <div
      className="fixed inset-0 z-50 bg-black/50 backdrop-blur-sm flex items-center justify-center p-4 animate-in fade-in duration-200"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div className="bg-white rounded-2xl border-2 border-black shadow-[8px_8px_0px_0px_rgba(0,0,0,1)] w-full max-w-md p-6">
        {/* Header */}
        <div className="flex items-center justify-between mb-2">
          <h2 className="text-2xl font-black uppercase tracking-tight">Adicionar Freela</h2>
          <button onClick={onClose} aria-label="Fechar" className="p-2 hover:bg-gray-100 rounded-xl transition-colors">
            <X size={20} />
          </button>
        </div>
        <p className="text-sm font-bold text-gray-500 mb-6">
          Adicione um freela pelo QR, Worki ID ou pelo link de perfil que ele te enviou.
        </p>

        {/* Tabs */}
        <div className="flex gap-2 mb-6 border-b-2 border-gray-200 pb-1">
          {([
            { id: 'qr' as AddMethod, icon: QrCode, label: 'QR' },
            { id: 'phone' as AddMethod, icon: Phone, label: 'Worki ID' },
            { id: 'link' as AddMethod, icon: Link2, label: 'Link' },
          ] as const).map((tab) => (
            <button
              key={tab.id}
              onClick={() => setMethod(tab.id)}
              className={`flex items-center gap-2 px-4 py-2 rounded-t-xl font-black uppercase text-sm transition-all ${
                method === tab.id
                  ? 'bg-black text-white translate-y-[2px]'
                  : 'text-gray-400 hover:text-black hover:bg-gray-100'
              }`}
            >
              <tab.icon size={16} /> {tab.label}
            </button>
          ))}
        </div>

        {/* Conteúdo por método */}
        {method === 'link' && (
          <div className="space-y-4">
            <p className="text-sm font-bold text-gray-600">
              Cole o <span className="font-black">link de perfil</span> que o freela te enviou
              (ele encontra em Perfil → "Copiar meu link").
            </p>
            <div className="space-y-2">
              <label htmlFor="worker-link-input" className="text-xs font-bold uppercase tracking-wide">
                Link de perfil do freela
              </label>
              <input
                id="worker-link-input"
                type="text"
                value={linkInput}
                onChange={(e) => setLinkInput(e.target.value)}
                placeholder="Cole aqui o link enviado pelo freela"
                className="w-full border-2 border-black rounded-xl px-4 py-3 font-bold focus:ring-2 focus:ring-primary outline-none"
              />
            </div>
            <button
              onClick={handleLinkSubmit}
              disabled={loading || !linkInput.trim()}
              className="w-full bg-black hover:bg-primary text-white px-6 py-3 rounded-xl font-black uppercase flex items-center justify-center gap-2 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {loading ? <Loader2 className="animate-spin" size={18} /> : <UserPlus size={18} />}
              {loading ? 'Adicionando...' : 'Adicionar pelo Link'}
            </button>
            <p className="text-xs text-gray-400 text-center">
              O freela aparecerá em "Aguardando" até aceitar o convite.
            </p>
          </div>
        )}

        {method === 'qr' && (
          <div className="space-y-4">
            <p className="text-sm font-bold text-gray-600">
              Aponte a câmera para o <span className="font-black">QR de Identidade</span> do freela
              (ele encontra em Perfil → "Meu QR de Identidade").
            </p>
            <QrScannerPane onDecoded={handleQrDecoded} processing={qrProcessing} />
            <p className="text-xs text-gray-400 text-center">
              O freela aparecerá em "Aguardando" até aceitar o convite.
            </p>
          </div>
        )}

        {method === 'phone' && (
          <div className="space-y-4">
            <p className="text-sm font-bold text-gray-600">
              Digite o <span className="font-black">ID do worker</span> (Worki ID) para adicionar diretamente.
              Peça o Worki ID ao freela (Perfil dele → "Meu QR de Identidade" → "Copiar Worki ID").
            </p>
            <div className="space-y-2">
              <label htmlFor="phone-input" className="text-xs font-bold uppercase tracking-wide">
                Worki ID do freela
              </label>
              <input
                id="phone-input"
                type="text"
                value={phone}
                onChange={(e) => { setPhone(e.target.value); setWorkerId(e.target.value); }}
                placeholder="Cole o ID do freela aqui"
                className="w-full border-2 border-black rounded-xl px-4 py-3 font-bold focus:ring-2 focus:ring-primary outline-none"
              />
            </div>
            <button
              onClick={handlePhoneSubmit}
              disabled={loading || !workerId.trim()}
              className="w-full bg-black hover:bg-primary text-white px-6 py-3 rounded-xl font-black uppercase flex items-center justify-center gap-2 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {loading ? <Loader2 className="animate-spin" size={18} /> : <UserPlus size={18} />}
              {loading ? 'Enviando...' : 'Enviar Convite'}
            </button>
            <p className="text-xs text-gray-400">
              Ainda não é possível buscar por CPF ou telefone — peça o Worki ID ao freela.
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
