import { useState } from 'react';
import ErroDeCarga from '../components/ErroDeCarga';
import { useNavigate } from 'react-router-dom';
import { Building2, Star, MapPin, CheckCircle2, XCircle, Users, Clock, LogOut, Share2, Check, Copy } from 'lucide-react';
import PageMeta from '../components/PageMeta';
import { Button, Card, Menu, PageHeader } from '../components/ui';
import SectionTabs from '../components/SectionTabs';
import { useWorkerStores } from '../hooks/useTeamConnections';
import { useLiveRefresh } from '../hooks/useLiveRefresh';
import { workerTeamSources } from '../lib/realtime/liveSources';
import { useToast } from '../contexts/ToastContext';
import { useAuth } from '../contexts/AuthContext';
import { TeamConnectionService } from '../services/teamConnectionService';
import type { MyStore, TeamConnection } from '../types';
import { Dialog } from '../components/ui/Dialog';

// ---------------------------------------------------------------------------
// Subcomponent: card de empresa aceita
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
  const handleShareLink = async () => {
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
    <Card
      as="article"
      padding="sm"
      interactive
      role="button"
      tabIndex={0}
      onClick={handleOpenProfile}
      onKeyDown={(e) => {
        // Só o próprio card abre o perfil; Enter/Espaço nos botões internos seguem a ação deles.
        if (e.target !== e.currentTarget) return;
        if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); handleOpenProfile(); }
      }}
      className="flex items-center gap-4 cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-black focus-visible:ring-offset-2"
    >
      {/* Logo */}
      <div className="w-14 h-14 rounded-xl border-2 border-black overflow-hidden bg-gray-100 flex-shrink-0">
        {company.logo_url ? (
          <img src={company.logo_url} alt={name} className="w-full h-full object-cover" />
        ) : (
          <div className="w-full h-full flex items-center justify-center bg-black text-white font-bold text-xl">
            {name[0]?.toUpperCase() ?? '?'}
          </div>
        )}
      </div>

      {/* Info */}
      <div className="flex-1 min-w-0">
        <h3 className="font-bold text-base truncate">{name}</h3>
        {company.industry && (
          <p className="text-sm text-gray-600 truncate">{company.industry}</p>
        )}
        <div className="flex flex-wrap gap-2 mt-2">
          {/* Empresa sem nenhuma avaliação exibia "5.0 (0)" -- nota cheia onde não há dado.
              Este selo é prova social: o freela lê antes de aceitar convite daquela empresa. */}
          {typeof company.rating_average === 'number' && (company.reviews_count ?? 0) > 0 ? (
            <span className="inline-flex items-center gap-1 text-xs font-semibold bg-yellow-50 text-yellow-700 px-2.5 py-1 rounded-pill border border-yellow-200">
              <Star size={12} fill="currentColor" /> {company.rating_average.toFixed(1)}
              {` (${company.reviews_count})`}
            </span>
          ) : (
            <span className="inline-flex items-center gap-1 text-xs font-semibold bg-gray-50 text-gray-600 px-2.5 py-1 rounded-pill border border-gray-200">
              <Star size={12} /> Sem avaliações
            </span>
          )}
          {company.address && (
            <span className="inline-flex items-center gap-1 text-xs font-semibold bg-blue-50 text-blue-700 px-2.5 py-1 rounded-pill max-w-full">
              <MapPin size={12} className="flex-shrink-0" /> <span className="truncate">{company.address}</span>
            </span>
          )}
        </div>
      </div>

      {/* Ações: a destrutiva fica no menu, nunca exposta no cartão. */}
      <div className="flex-shrink-0">
        <Menu
          label={`Mais opções de ${name}`}
          items={[
            { label: 'Compartilhar link da empresa', icon: linkCopied ? Check : Share2, onSelect: () => void handleShareLink() },
            { label: 'Sair da empresa', icon: LogOut, onSelect: () => onLeave(connection.id), danger: true, disabled: leaving },
          ]}
        />
      </div>
    </Card>
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
    <Card as="article" padding="sm" className="shadow-[4px_4px_0px_0px_rgba(0,166,81,1)]">
      <div className="flex items-center gap-3 mb-4">
        <div className="w-11 h-11 rounded-xl border-2 border-black overflow-hidden bg-gray-100 flex-shrink-0">
          {company?.logo_url ? (
            <img src={company.logo_url} alt={name} className="w-full h-full object-cover" />
          ) : (
            <div className="w-full h-full flex items-center justify-center">
              <Building2 size={20} className="text-gray-600" />
            </div>
          )}
        </div>
        <div className="min-w-0">
          <p className="text-xs text-gray-600">Convite de</p>
          <p className="font-bold truncate">{name}</p>
        </div>
        <span className="ml-auto flex-shrink-0 bg-primary-light text-primary-dark text-xs font-bold px-2.5 py-1 rounded-pill">
          Novo
        </span>
      </div>

      <div className="flex gap-3">
        <Button
          variant="primary"
          className="flex-1"
          onClick={() => onAccept(connection.id)}
          loading={isResponding}
          iconLeft={<CheckCircle2 size={18} />}
        >
          Aceitar
        </Button>
        <Button
          variant="secondary"
          className="flex-1"
          onClick={() => onDecline(connection.id)}
          disabled={isResponding}
          iconLeft={<XCircle size={18} />}
        >
          Recusar
        </Button>
      </div>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Página principal: CarteiraClientes
// ---------------------------------------------------------------------------

export default function CarteiraClientes() {
  const navigate = useNavigate();
  const { addToast } = useToast();
  const { user } = useAuth();
  const [myLinkCopied, setMyLinkCopied] = useState(false);
  const { myStores, pendingConnections, loading, erroCarga, acceptConnection, blockConnection, declineConnection, refresh } = useWorkerStores();
  const [respondingId, setRespondingId] = useState<string | null>(null);
  const [confirmLeaveId, setConfirmLeaveId] = useState<string | null>(null);

  useLiveRefresh({
    sources: user ? workerTeamSources(user.id) : [],
    onRefresh: () => refresh({ silent: true }),
    paused: loading || !!respondingId || !!confirmLeaveId,
  });

  const handleAccept = async (connectionId: string) => {
    setRespondingId(connectionId);
    await acceptConnection(connectionId);
    setRespondingId(null);
  };

  const handleDecline = async (connectionId: string) => {
    // Recusa NEUTRA (P1 da heuristica): apagava... nao — BLOQUEAVA. "Recusar" gravava o veto
    // permanente porque era a unica acao que a RLS permitia ao worker. Agora e delete da linha
    // pendente (policy 20260902000100): o convite some e a empresa pode reconvidar — mesmo
    // principio do "Recusar nao afeta sua reputacao" do convite de turno.
    setRespondingId(connectionId);
    await declineConnection(connectionId);
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

  // Atalho: mesmo serviço do Perfil (link do freela → empresa abre e adiciona ao elenco).
  const handleCopyMyLink = async () => {
    if (!user) return;
    const { url } = TeamConnectionService.generateWorkerInviteToken(user.id);
    try {
      await navigator.clipboard.writeText(url);
      setMyLinkCopied(true);
      addToast('Link copiado! Envie para uma empresa te adicionar ao Elenco.', 'success');
      setTimeout(() => setMyLinkCopied(false), 2500);
    } catch {
      addToast('Não foi possível copiar o link.', 'error');
    }
  };

  if (erroCarga && !loading) {
    return (
      <div className="max-w-4xl mx-auto pb-24 pt-6">
        <ErroDeCarga onRetry={() => { void refresh(); }} />
      </div>
    );
  }

  if (loading) {
    return (
      <div className="max-w-4xl mx-auto space-y-6 animate-pulse pb-24" role="status"><span className="sr-only">Carregando</span>
        <div className="h-9 bg-gray-200 rounded-xl w-56" />
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
    <div className="max-w-4xl mx-auto pb-24 font-sans text-accent">
      <PageMeta
        title="Minhas empresas"
        description="Acompanhe as empresas que têm você no Elenco e responda a convites de novas empresas."
      />

      <SectionTabs section="empresas" role="worker" />
      <PageHeader
        title="Minhas empresas"
        subtitle={
          `${myStores.length} empresa${myStores.length !== 1 ? 's' : ''}` +
          (pendingConnections.length > 0
            ? ` · ${pendingConnections.length} convite${pendingConnections.length !== 1 ? 's' : ''} pendente${pendingConnections.length !== 1 ? 's' : ''}`
            : '')
        }
        action={
          <Button
            variant="secondary"
            onClick={handleCopyMyLink}
            disabled={!user}
            iconLeft={myLinkCopied ? <Check size={18} /> : <Copy size={18} />}
          >
            {myLinkCopied ? 'Link copiado!' : 'Copiar meu link'}
          </Button>
        }
      />

      {/* Convites pendentes */}
      {pendingConnections.length > 0 && (
        <section className="mb-8">
          <h2 className="text-lg font-bold mb-3 flex items-center gap-2">
            <Clock size={18} className="text-yellow-700" /> Convites pendentes
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

      {/* Empresas aceitas */}
      {myStores.length > 0 && (
        <section className="mb-8">
          {/* A página já se chama "Minhas empresas": o título da seção só entra quando há
              convites pendentes acima, para separar os dois grupos. */}
          {pendingConnections.length > 0 && (
            <h2 className="text-lg font-bold mb-3 flex items-center gap-2">
              <Users size={18} /> No Elenco delas
            </h2>
          )}
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
        <div className="text-center py-16 px-4 border-2 border-dashed border-gray-300 rounded-2xl bg-gray-50">
          <Users size={40} className="mx-auto mb-4 text-gray-400" />
          <h3 className="text-lg font-bold mb-2">Você ainda não tem empresas</h3>
          <p className="text-sm text-gray-600 max-w-sm mx-auto">
            Aceite um convite de uma empresa ou compartilhe seu link de perfil para começar a montar sua lista de empresas.
          </p>
          <Button variant="primary" size="lg" className="mt-6" onClick={() => navigate('/profile')}>
            Ver meu link de perfil
          </Button>
        </div>
      )}

      {/* Modal de confirmação: sair/bloquear */}
      {confirmLeaveId && (
        <Dialog
            labelledBy="sair-empresa-titulo"
            onClose={() => setConfirmLeaveId(null)}
            className="max-w-sm"
        >
            <h3 id="sair-empresa-titulo" className="text-lg font-bold mb-2 [overflow-wrap:anywhere]">
              Sair de {myStores.find((s) => s.connection.id === confirmLeaveId)?.company.name ?? 'esta empresa'}?
            </h3>
            <p className="text-sm text-gray-600 mb-6">
              Você deixa o Elenco e não recebe novos convites dela. Seus recibos continuam em Recebimentos.
              Esta ação não pode ser desfeita.
            </p>
            <div className="flex gap-3">
              <Button variant="secondary" className="flex-1" onClick={() => setConfirmLeaveId(null)}>
                Voltar
              </Button>
              <Button variant="danger" className="flex-1" onClick={handleConfirmLeave}>
                Sair da empresa
              </Button>
            </div>
        </Dialog>
      )}
    </div>
  );
}
