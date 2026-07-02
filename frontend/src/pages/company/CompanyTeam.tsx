import { useState, useEffect, useRef, useCallback } from 'react';
import { Users, Link2, Phone, QrCode, Check, Clock, Star, Briefcase, X, Loader2, UserPlus, Share2, CameraOff } from 'lucide-react';
import { Html5Qrcode, Html5QrcodeSupportedFormats, Html5QrcodeScannerState } from 'html5-qrcode';
import { useCompanyTeam } from '../../hooks/useTeamConnections';
import { useToast } from '../../contexts/ToastContext';
import { TeamConnectionService } from '../../services/teamConnectionService';
import { logError } from '../../lib/logger';
import type { TeamMember, TeamConnection } from '../../types';

// UUID "solto" — mesmo formato usado como Worki ID (auth.uid()). O QR de
// identidade (Profile.tsx) codifica o workerId cru, sem prefixo/URL.
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Extrai o token de convite de um texto colado pelo usuário.
 *
 * O freela pode colar a URL completa (`https://.../convite/w_xxxx`) ou só o
 * token (`w_xxxx`). Se `raw` for uma URL válida, pega o último segmento do
 * path; caso contrário, assume que já é o token puro.
 */
function extractInviteToken(raw: string): string {
  const trimmed = raw.trim();
  if (!trimmed) return '';
  try {
    const url = new URL(trimmed);
    const segments = url.pathname.split('/').filter(Boolean);
    return segments[segments.length - 1] ?? trimmed;
  } catch {
    return trimmed;
  }
}

// ---------------------------------------------------------------------------
// Subcomponent: card de membro da equipe
// ---------------------------------------------------------------------------

interface MemberCardProps {
  member: TeamMember;
}

function MemberCard({ member }: MemberCardProps) {
  const { worker } = member;
  const avatarUrl = worker.avatar_url ?? worker.photo_url ?? null;
  const { addToast } = useToast();
  const [linkCopied, setLinkCopied] = useState(false);

  // Link transitivo: já tenho esse freela no elenco → posso repassar o link
  // dele pra outra empresa se conectar, sem pedir de novo ao freela.
  const handleShareLink = async () => {
    const { url } = TeamConnectionService.generateWorkerInviteToken(worker.id);
    try {
      await navigator.clipboard.writeText(url);
      setLinkCopied(true);
      addToast('Link do freela copiado! Repasse para outra empresa.', 'success');
      setTimeout(() => setLinkCopied(false), 2500);
    } catch {
      addToast('Não foi possível copiar o link.', 'error');
    }
  };

  return (
    <div className="bg-white border-2 border-black rounded-2xl p-5 flex items-start gap-4 hover:shadow-[6px_6px_0px_0px_rgba(0,0,0,1)] hover:-translate-y-0.5 transition-all">
      {/* Avatar */}
      <div className="w-14 h-14 rounded-xl border-2 border-black overflow-hidden bg-gray-100 flex-shrink-0">
        {avatarUrl ? (
          <img src={avatarUrl} alt={worker.full_name} className="w-full h-full object-cover" />
        ) : (
          <div className="w-full h-full flex items-center justify-center bg-black text-white font-black text-xl">
            {worker.full_name?.[0]?.toUpperCase() ?? '?'}
          </div>
        )}
      </div>

      {/* Info */}
      <div className="flex-1 min-w-0">
        <h3 className="font-black uppercase text-base truncate">{worker.full_name}</h3>
        {worker.primary_role && (
          <p className="text-sm font-bold text-gray-500 uppercase truncate">{worker.primary_role}</p>
        )}
        <div className="flex flex-wrap gap-2 mt-2">
          {typeof worker.rating_average === 'number' && (
            <span className="flex items-center gap-1 text-xs font-bold bg-yellow-50 text-yellow-700 px-2 py-1 rounded-xl border border-yellow-200">
              <Star size={12} fill="currentColor" /> {worker.rating_average.toFixed(1)}
            </span>
          )}
          {typeof worker.completed_jobs_count === 'number' && (
            <span className="flex items-center gap-1 text-xs font-bold bg-gray-100 text-gray-600 px-2 py-1 rounded-xl">
              <Briefcase size={12} /> {worker.completed_jobs_count} jobs
            </span>
          )}
          {worker.city && (
            <span className="text-xs font-bold bg-blue-50 text-blue-700 px-2 py-1 rounded-xl">
              {worker.city}
            </span>
          )}
        </div>
      </div>

      {/* Status badge + repassar link */}
      <div className="flex flex-col items-end gap-2 flex-shrink-0">
        <span className="bg-primary-light text-primary text-xs font-black uppercase px-2 py-1 rounded-xl border border-green-200">
          Elenco
        </span>
        <button
          onClick={handleShareLink}
          aria-label={`Repassar link do freela ${worker.full_name}`}
          title="Repassar link deste freela para outra empresa"
          className="p-1.5 rounded-xl text-gray-400 hover:text-black hover:bg-gray-100 transition-colors"
        >
          {linkCopied ? <Check size={16} /> : <Share2 size={16} />}
        </button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Subcomponent: card de conexão pendente
// ---------------------------------------------------------------------------

interface PendingCardProps {
  connection: TeamConnection;
}

function PendingCard({ connection }: PendingCardProps) {
  const workerData = connection.worker;
  const name = workerData?.full_name ?? 'Freela';

  return (
    <div className="bg-gray-50 border-2 border-dashed border-gray-300 rounded-2xl p-4 flex items-center gap-3">
      <div className="w-10 h-10 rounded-xl bg-gray-200 border-2 border-gray-300 flex items-center justify-center font-black text-gray-500">
        {name[0]?.toUpperCase() ?? '?'}
      </div>
      <div className="flex-1 min-w-0">
        <p className="font-black uppercase text-sm truncate">{name}</p>
        {workerData?.primary_role && (
          <p className="text-xs font-bold text-gray-400 uppercase">{workerData.primary_role}</p>
        )}
      </div>
      <div className="flex items-center gap-1 text-xs font-bold text-yellow-700 bg-yellow-50 px-2 py-1 rounded-xl border border-yellow-200">
        <Clock size={12} /> Aguardando
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Subcomponent: scanner de câmera QR (lê o QR de identidade do worker)
// ---------------------------------------------------------------------------

const QR_READER_ELEMENT_ID = 'add-worker-qr-reader';

interface QrScannerPaneProps {
  /** Chamado com o texto decodificado do QR (deve ser um Worki ID / UUID). */
  onDecoded: (decodedText: string) => void;
  /** true enquanto a última leitura está sendo processada (pausa a câmera). */
  processing: boolean;
}

function QrScannerPane({ onDecoded, processing }: QrScannerPaneProps) {
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

// ---------------------------------------------------------------------------
// Subcomponent: modal "Adicionar freela"
// ---------------------------------------------------------------------------

type AddMethod = 'link' | 'phone' | 'qr';

interface AddWorkerModalProps {
  onClose: () => void;
  onAdded: () => void;
  addWorker: (workerId: string, source: 'qr' | 'link' | 'phone') => Promise<boolean>;
}

function AddWorkerModal({ onClose, onAdded, addWorker }: AddWorkerModalProps) {
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
    if (!workerId.trim()) return;
    setLoading(true);
    const ok = await addWorker(workerId.trim(), 'phone');
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
              Busca por telefone disponível na v1.1.
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
              Busca por CPF/telefone disponível na v1.1. Por enquanto, peça o Worki ID ao freela.
            </p>
          </div>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Página principal: CompanyTeam
// ---------------------------------------------------------------------------

export default function CompanyTeam() {
  const { teamMembers, pendingConnections, loading, addWorker, refresh } = useCompanyTeam();
  const [showAddModal, setShowAddModal] = useState(false);

  if (loading) {
    return (
      <div className="max-w-4xl mx-auto space-y-6 animate-pulse pb-20">
        <div className="h-10 bg-gray-200 rounded-xl w-48" />
        <div className="h-12 bg-gray-200 rounded-xl w-40" />
        <div className="space-y-4">
          {[...Array(3)].map((_, i) => (
            <div key={i} className="h-24 bg-gray-200 rounded-2xl" />
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-4xl mx-auto pb-20 animate-in fade-in slide-in-from-bottom-4 duration-400">
      {/* Header */}
      <div className="flex items-start justify-between mb-8 gap-4 flex-wrap">
        <div>
          <h1 className="text-4xl font-black uppercase tracking-tighter">Meu Elenco</h1>
          <p className="text-gray-500 font-bold mt-1">
            {teamMembers.length} freela{teamMembers.length !== 1 ? 's' : ''} no elenco
            {pendingConnections.length > 0 && (
              <span className="ml-2 text-yellow-600">· {pendingConnections.length} aguardando aceite</span>
            )}
          </p>
        </div>
        <button
          onClick={() => setShowAddModal(true)}
          className="bg-black hover:bg-primary text-white px-6 py-3 rounded-xl font-black uppercase flex items-center gap-2 transition-colors shadow-[4px_4px_0px_0px_rgba(0,166,81,1)]"
        >
          <UserPlus size={20} /> Adicionar Freela
        </button>
      </div>

      {/* Elenco aceito */}
      {teamMembers.length > 0 && (
        <section className="mb-8">
          <h2 className="text-xl font-black uppercase mb-4 flex items-center gap-2">
            <Users size={20} /> Elenco Ativo
          </h2>
          <div className="grid grid-cols-1 gap-4">
            {teamMembers.map((member) => (
              <MemberCard key={member.connection.id} member={member} />
            ))}
          </div>
        </section>
      )}

      {/* Convites pendentes */}
      {pendingConnections.length > 0 && (
        <section className="mb-8">
          <h2 className="text-xl font-black uppercase mb-4 flex items-center gap-2 text-yellow-700">
            <Clock size={20} /> Aguardando Aceite
          </h2>
          <div className="space-y-3">
            {pendingConnections.map((conn) => (
              <PendingCard key={conn.id} connection={conn} />
            ))}
          </div>
        </section>
      )}

      {/* Empty state */}
      {teamMembers.length === 0 && pendingConnections.length === 0 && (
        <div className="text-center py-20 border-2 border-dashed border-gray-200 rounded-2xl bg-gray-50">
          <Users size={48} className="mx-auto mb-4 text-gray-300" />
          <h3 className="text-xl font-black uppercase mb-2">Elenco vazio</h3>
          <p className="text-gray-500 font-bold mb-6 max-w-sm mx-auto">
            Adicione freelas pelo QR de identidade, Worki ID ou pelo link de perfil que eles te enviarem.
            Eles aparecerão aqui após aceitarem.
          </p>
          <button
            onClick={() => setShowAddModal(true)}
            className="bg-black hover:bg-primary text-white px-8 py-3 rounded-xl font-black uppercase inline-flex items-center gap-2 transition-colors"
          >
            <UserPlus size={20} /> Adicionar Primeiro Freela
          </button>
        </div>
      )}

      {/* Modal Adicionar */}
      {showAddModal && (
        <AddWorkerModal
          onClose={() => setShowAddModal(false)}
          onAdded={refresh}
          addWorker={addWorker}
        />
      )}
    </div>
  );
}
