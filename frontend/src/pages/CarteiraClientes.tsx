import { useState, type MouseEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { Building2, Star, MapPin, CheckCircle2, XCircle, Loader2, Users, Clock, LogOut, Share2, Check } from 'lucide-react';
import PageMeta from '../components/PageMeta';
import { useWorkerStores } from '../hooks/useTeamConnections';
import { useToast } from '../contexts/ToastContext';
import { TeamConnectionService } from '../services/teamConnectionService';
import type { MyStore, TeamConnection } from '../types';

// ---------------------------------------------------------------------------
// Subcomponent: card de loja/cliente aceito
// ---------------------------------------------------------------------------

interface StoreCardProps {
  store: MyStore;
  onLeave: (connectionId: string) => void;
  leaving: boolean;
}

function StoreCard({ store, onLeave, leaving }: StoreCardProps) {
  const { company, connection } = store;
  const name = company.name ?? 'Empresa';
  const { addToast } = useToast();
  const navigate = useNavigate();
  const [linkCopied, setLinkCopied] = useState(false);

  // Link transitivo: já sou conectado a essa empresa → posso repassar o link
  // dela pra outro freela se conectar, sem precisar pedir à empresa.
  const handleShareLink = async (e: MouseEvent) => {
    e.stopPropagation();
    // `connection.company_id` é a FK garantida (não-nula); `company.id` no
    // embed é opcional no tipo (CompanyProfile.id?), então preferimos a FK.
    const gerado = await TeamConnectionService.generateInviteToken(connection.company_id);
    if (!gerado) {
      addToast('Não foi possível obter o link desta empresa agora.', 'error');
      return;
    }
    const { url } = gerado;
    try {
      await navigator.clipboard.writeText(url);
      setLinkCopied(true);
      addToast('Link da empresa copiado! Repasse para outro freela.', 'success');
      setTimeout(() => setLinkCopied(false), 2500);
    } catch {
      addToast('Não foi possível copiar o link.', 'error');
    }
  };

  const handleOpenProfile = () => navigate(`/empresa/${connection.company_id}`);

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={handleOpenProfile}
      onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); handleOpenProfile(); } }}
      className="bg-white border-2 border-black rounded-2xl p-5 flex items-start gap-4 hover:shadow-[6px_6px_0px_0px_rgba(0,166,81,1)] hover:-translate-y-1 transition-all cursor-pointer"
    >
      {/* Logo */}
      <div className="w-14 h-14 rounded-xl border-2 border-black overflow-hidden bg-gray-100 flex-shrink-0">
        {company.logo_url ? (
          <img src={company.logo_url} alt={name} className="w-full h-full object-cover" />
        ) : (
          <div className="w-full h-full flex items-center justify-center bg-black text-white font-black text-xl">
            {name[0]?.toUpperCase() ?? '?'}
          </div>
        )}
      </div>

      {/* Info */}
      <div className="flex-1 min-w-0">
        <h3 className="font-black uppercase text-base truncate">{name}</h3>
        {company.industry && (
          <p className="text-sm font-bold text-gray-500 uppercase truncate">{company.industry}</p>
        )}
        <div className="flex flex-wrap gap-2 mt-2">
          {typeof company.rating_average === 'number' && (
            <span className="flex items-center gap-1 text-xs font-bold bg-yellow-50 text-yellow-700 px-2 py-1 rounded-xl border border-yellow-200">
              <Star size={12} fill="currentColor" /> {company.rating_average.toFixed(1)}
              {typeof company.reviews_count === 'number' && ` (${company.reviews_count})`}
            </span>
          )}
          {company.address && (
            <span className="flex items-center gap-1 text-xs font-bold bg-blue-50 text-blue-700 px-2 py-1 rounded-xl">
              <MapPin size={12} /> {company.address}
            </span>
          )}
        </div>
      </div>

      {/* Ações: repassar link / sair-bloquear */}
      <div className="flex flex-col gap-1 flex-shrink-0">
        <button
          onClick={handleShareLink}
          aria-label={`Repassar link da empresa ${name}`}
          title="Repassar link desta empresa para outro freela"
          className="p-2 rounded-xl text-gray-400 hover:text-primary hover:bg-primary-light transition-colors"
        >
          {linkCopied ? <Check size={20} /> : <Share2 size={20} />}
        </button>
        <button
          onClick={(e) => { e.stopPropagation(); onLeave(connection.id); }}
          disabled={leaving}
          aria-label={`Sair do cliente ${name}`}
          title="Sair / bloquear cliente"
          className="p-2 rounded-xl text-gray-400 hover:text-red-600 hover:bg-red-50 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {leaving ? <Loader2 className="animate-spin" size={20} /> : <LogOut size={20} />}
        </button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Subcomponent: card de convite pendente
// ---------------------------------------------------------------------------

interface PendingCardProps {
  connection: TeamConnection;
  onAccept: (connectionId: string) => void;
  onDecline: (connectionId: string) => void;
  respondingId: string | null;
}

function PendingCard({ connection, onAccept, onDecline, respondingId }: PendingCardProps) {
  const company = connection.company;
  const name = company?.name ?? 'Empresa';
  const isResponding = respondingId === connection.id;

  return (
    <div className="bg-white border-2 border-black rounded-2xl p-5 shadow-[4px_4px_0px_0px_rgba(0,166,81,1)]">
      <div className="flex items-center gap-3 mb-4">
        <div className="w-10 h-10 rounded-xl border-2 border-black overflow-hidden bg-gray-100 flex-shrink-0">
          {company?.logo_url ? (
            <img src={company.logo_url} alt={name} className="w-full h-full object-cover" />
          ) : (
            <div className="w-full h-full flex items-center justify-center">
              <Building2 size={20} className="text-gray-400" />
            </div>
          )}
        </div>
        <div className="min-w-0">
          <p className="text-xs font-bold uppercase text-gray-400">Convite de</p>
          <p className="font-black uppercase truncate">{name}</p>
        </div>
        <span className="ml-auto flex-shrink-0 bg-primary-light text-primary text-xs font-black uppercase px-2 py-1 rounded-xl border border-green-200">
          Novo
        </span>
      </div>

      <div className="flex gap-3">
        <button
          onClick={() => onAccept(connection.id)}
          disabled={isResponding}
          className="flex-1 bg-primary hover:bg-black text-white px-6 py-3 rounded-xl font-black uppercase flex items-center justify-center gap-2 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {isResponding ? <Loader2 className="animate-spin" size={18} /> : <CheckCircle2 size={18} />}
          Aceitar
        </button>
        <button
          onClick={() => onDecline(connection.id)}
          disabled={isResponding}
          className="flex-1 bg-white hover:bg-gray-50 text-gray-700 px-6 py-3 rounded-xl font-black uppercase border-2 border-gray-300 flex items-center justify-center gap-2 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {isResponding ? <Loader2 className="animate-spin" size={18} /> : <XCircle size={18} />}
          Recusar
        </button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Página principal: CarteiraClientes
// ---------------------------------------------------------------------------

export default function CarteiraClientes() {
  const { myStores, pendingConnections, loading, acceptConnection, blockConnection } = useWorkerStores();
  const [respondingId, setRespondingId] = useState<string | null>(null);
  const [confirmLeaveId, setConfirmLeaveId] = useState<string | null>(null);

  const handleAccept = async (connectionId: string) => {
    setRespondingId(connectionId);
    await acceptConnection(connectionId);
    setRespondingId(null);
  };

  const handleDecline = async (connectionId: string) => {
    setRespondingId(connectionId);
    await blockConnection(connectionId);
    setRespondingId(null);
  };

  const handleConfirmLeave = async () => {
    if (!confirmLeaveId) return;
    const id = confirmLeaveId;
    setConfirmLeaveId(null);
    setRespondingId(id);
    await blockConnection(id);
    setRespondingId(null);
  };

  if (loading) {
    return (
      <div className="max-w-4xl mx-auto space-y-6 animate-pulse pb-24">
        <div className="h-10 bg-gray-200 rounded-xl w-64" />
        <div className="space-y-4">
          {[...Array(3)].map((_, i) => (
            <div key={i} className="h-24 bg-gray-200 rounded-2xl" />
          ))}
        </div>
      </div>
    );
  }

  const isEmpty = myStores.length === 0 && pendingConnections.length === 0;

  return (
    <div className="max-w-4xl mx-auto pb-24 font-sans text-accent animate-in fade-in slide-in-from-bottom-4 duration-400">
      <PageMeta
        title="Carteira de Clientes"
        description="Acompanhe os clientes que fazem parte da sua carteira e responda a convites de novas empresas."
      />

      {/* Header */}
      <header className="mb-8">
        <h1 className="text-4xl font-black uppercase tracking-tighter">Carteira de Clientes</h1>
        <p className="text-gray-500 font-bold mt-1">
          {myStores.length} cliente{myStores.length !== 1 ? 's' : ''}
          {pendingConnections.length > 0 && (
            <span className="ml-2 text-yellow-600">· {pendingConnections.length} convite{pendingConnections.length !== 1 ? 's' : ''} pendente{pendingConnections.length !== 1 ? 's' : ''}</span>
          )}
        </p>
      </header>

      {/* Convites pendentes */}
      {pendingConnections.length > 0 && (
        <section className="mb-8">
          <h2 className="text-xl font-black uppercase mb-4 flex items-center gap-2 text-yellow-700">
            <Clock size={20} /> Convites Pendentes
          </h2>
          <div className="grid grid-cols-1 gap-4">
            {pendingConnections.map((conn) => (
              <PendingCard
                key={conn.id}
                connection={conn}
                onAccept={handleAccept}
                onDecline={handleDecline}
                respondingId={respondingId}
              />
            ))}
          </div>
        </section>
      )}

      {/* Clientes aceitos */}
      {myStores.length > 0 && (
        <section className="mb-8">
          <h2 className="text-xl font-black uppercase mb-4 flex items-center gap-2">
            <Users size={20} /> Meus Clientes
          </h2>
          <div className="grid grid-cols-1 gap-4">
            {myStores.map((store) => (
              <StoreCard
                key={store.connection.id}
                store={store}
                onLeave={setConfirmLeaveId}
                leaving={respondingId === store.connection.id}
              />
            ))}
          </div>
        </section>
      )}

      {/* Empty state */}
      {isEmpty && (
        <div className="text-center py-20 border-2 border-dashed border-gray-200 rounded-2xl bg-gray-50">
          <Users size={48} className="mx-auto mb-4 text-gray-300" />
          <h3 className="text-xl font-black uppercase mb-2">Você ainda não tem clientes</h3>
          <p className="text-gray-500 font-bold max-w-sm mx-auto">
            Aceite um convite de uma empresa ou compartilhe seu link de perfil para começar a construir sua carteira de clientes.
          </p>
        </div>
      )}

      {/* Modal de confirmação: sair/bloquear */}
      {confirmLeaveId && (
        <div className="fixed inset-0 z-50 bg-black/50 backdrop-blur-sm flex items-center justify-center p-4 animate-in fade-in duration-200">
          <div className="bg-white rounded-2xl border-2 border-black shadow-[8px_8px_0px_0px_rgba(0,0,0,1)] w-full max-w-sm p-6">
            <h3 className="text-xl font-black uppercase mb-2">Sair deste cliente?</h3>
            <p className="text-sm font-bold text-gray-500 mb-6">
              Você não fará mais parte da carteira dessa empresa. Esta ação não pode ser desfeita.
            </p>
            <div className="flex gap-3">
              <button
                onClick={() => setConfirmLeaveId(null)}
                className="flex-1 px-4 py-3 rounded-xl border-2 border-black font-black uppercase text-sm hover:bg-gray-100 transition-colors"
              >
                Voltar
              </button>
              <button
                onClick={handleConfirmLeave}
                className="flex-1 px-4 py-3 rounded-xl bg-red-600 hover:bg-red-700 text-white font-black uppercase text-sm transition-colors"
              >
                Sair
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
