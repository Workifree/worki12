import { useState } from 'react';
import { Users, Link2, Phone, QrCode, Copy, Check, Clock, Star, Briefcase, X, Loader2, UserPlus } from 'lucide-react';
import { useCompanyTeam } from '../../hooks/useTeamConnections';
import { TeamConnectionService } from '../../services/teamConnectionService';
import type { TeamMember, TeamConnection } from '../../types';

// ---------------------------------------------------------------------------
// Subcomponent: card de membro da equipe
// ---------------------------------------------------------------------------

interface MemberCardProps {
  member: TeamMember;
}

function MemberCard({ member }: MemberCardProps) {
  const { worker } = member;
  const avatarUrl = worker.avatar_url ?? worker.photo_url ?? null;

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

      {/* Status badge */}
      <span className="flex-shrink-0 bg-primary-light text-primary text-xs font-black uppercase px-2 py-1 rounded-xl border border-green-200">
        Equipe
      </span>
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
// Subcomponent: modal "Adicionar freela"
// ---------------------------------------------------------------------------

type AddMethod = 'link' | 'phone';

interface AddWorkerModalProps {
  companyId: string;
  onClose: () => void;
  onAdded: () => void;
  addWorker: (workerId: string, source: 'qr' | 'link' | 'phone') => Promise<boolean>;
}

function AddWorkerModal({ companyId, onClose, onAdded, addWorker }: AddWorkerModalProps) {
  const [method, setMethod] = useState<AddMethod>('link');
  const [phone, setPhone] = useState('');
  const [workerId, setWorkerId] = useState('');
  const [loading, setLoading] = useState(false);
  const [copied, setCopied] = useState(false);

  const { url: inviteUrl } = TeamConnectionService.generateInviteToken(companyId);

  const handleCopyLink = async () => {
    try {
      await navigator.clipboard.writeText(inviteUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 2500);
    } catch {
      // fallback: selecionar o texto
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

  return (
    <div
      className="fixed inset-0 z-50 bg-black/50 backdrop-blur-sm flex items-center justify-center p-4 animate-in fade-in duration-200"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div className="bg-white rounded-2xl border-2 border-black shadow-[8px_8px_0px_0px_rgba(0,0,0,1)] w-full max-w-md p-6">
        {/* Header */}
        <div className="flex items-center justify-between mb-6">
          <h2 className="text-2xl font-black uppercase tracking-tight">Adicionar Freela</h2>
          <button onClick={onClose} aria-label="Fechar" className="p-2 hover:bg-gray-100 rounded-xl transition-colors">
            <X size={20} />
          </button>
        </div>

        {/* Tabs */}
        <div className="flex gap-2 mb-6 border-b-2 border-gray-200 pb-1">
          {([
            { id: 'link' as AddMethod, icon: Link2, label: 'Link' },
            { id: 'phone' as AddMethod, icon: Phone, label: 'Telefone' },
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
          {/* QR: destaque como "em breve" */}
          <button
            disabled
            className="flex items-center gap-2 px-4 py-2 rounded-t-xl font-black uppercase text-sm text-gray-300 cursor-not-allowed"
            title="Scanner QR disponível na v1.1"
          >
            <QrCode size={16} /> QR (v1.1)
          </button>
        </div>

        {/* Conteúdo por método */}
        {method === 'link' && (
          <div className="space-y-4">
            <p className="text-sm font-bold text-gray-600">
              Compartilhe este link com o freela. Ele abrirá o Worki e aceitará o convite de entrada na sua equipe.
            </p>
            <div className="bg-gray-50 border-2 border-black rounded-xl p-4 flex items-center gap-3 font-mono text-xs break-all text-gray-700">
              <span className="flex-1">{inviteUrl}</span>
            </div>
            <button
              onClick={handleCopyLink}
              className="w-full bg-black hover:bg-primary text-white px-6 py-3 rounded-xl font-black uppercase flex items-center justify-center gap-2 transition-colors"
            >
              {copied ? <Check size={18} /> : <Copy size={18} />}
              {copied ? 'Copiado!' : 'Copiar Link'}
            </button>
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
  const { teamMembers, pendingConnections, loading, companyId, addWorker, refresh } = useCompanyTeam();
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
          <h1 className="text-4xl font-black uppercase tracking-tighter">Minha Equipe</h1>
          <p className="text-gray-500 font-bold mt-1">
            {teamMembers.length} freela{teamMembers.length !== 1 ? 's' : ''} na equipe
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

      {/* Equipe aceita */}
      {teamMembers.length > 0 && (
        <section className="mb-8">
          <h2 className="text-xl font-black uppercase mb-4 flex items-center gap-2">
            <Users size={20} /> Equipe Ativa
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
          <h3 className="text-xl font-black uppercase mb-2">Equipe vazia</h3>
          <p className="text-gray-500 font-bold mb-6 max-w-sm mx-auto">
            Adicione freelas via link de convite, Worki ID ou QR (em breve). Eles aparecerão aqui após aceitarem.
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
          companyId={companyId}
          onClose={() => setShowAddModal(false)}
          onAdded={refresh}
          addWorker={addWorker}
        />
      )}
    </div>
  );
}
