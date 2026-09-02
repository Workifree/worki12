import { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Share2, Inbox, Send, Star, X, Loader2, Building2 } from 'lucide-react';
import { supabase } from '../../lib/supabase';
import { logError } from '../../lib/logger';
import { useToast } from '../../contexts/ToastContext';
import { useCompanyTeam } from '../../hooks/useTeamConnections';
import { ReferralService } from '../../services/referralService';
import type { WorkerReferral, WorkerReferralCard } from '../../types';
import CreateReferralModal from '../../components/company/CreateReferralModal';

// ---------------------------------------------------------------------------
// "Indicações" (F10) — lado da empresa. Duas caixas:
//
//  - RECEBIDAS: indicações que outras empresas do elenco do freela fizeram para NÓS (A).
//    LM-1/LM-2 do ddl-aprovado.md: isto vem SEMPRE de `list_worker_referral_cards()` (RPC,
//    sem parâmetro), NUNCA de `from('worker_referrals')`. `card.worker_id` vem `null`
//    enquanto a indicação está pendente — NÃO existe caminho nesta tela que dependa dele
//    antes do aceite (sem link de perfil, sem chat, sem convite a partir daqui).
//  - ENVIADAS: indicações que NÓS (B) fizemos para outras empresas. B lê a própria linha
//    por RLS direta (`wr_select_referring_company`) — aqui sim é `from('worker_referrals')`.
//
// Vocabulário: "indicação"/"indicado por". Nunca "troca"/"emprestar"/"ceder"/"transferir".
// ---------------------------------------------------------------------------

type Tab = 'received' | 'sent';

interface SentReferralRow extends WorkerReferral {
  requestingCompanyName?: string;
  workerName?: string;
}

const STATUS_LABELS: Record<string, string> = {
  awaiting_worker: 'Aguardando o freela',
  accepted: 'Aceita',
  declined: 'Não avançou',
  cancelled: 'Cancelada',
  expired: 'Expirada',
};

const STATUS_CLASSES: Record<string, string> = {
  awaiting_worker: 'bg-yellow-50 text-yellow-700',
  accepted: 'bg-primary-light text-primary',
  declined: 'bg-gray-100 text-gray-700',
  cancelled: 'bg-gray-100 text-gray-700',
  expired: 'bg-gray-100 text-gray-700',
};

function StatusBadge({ status }: { status: string }) {
  const cls = STATUS_CLASSES[status] ?? 'bg-gray-100 text-gray-700';
  return (
    <span className={`px-3 py-1 rounded-pill font-black uppercase text-[10px] ${cls}`}>
      {STATUS_LABELS[status] ?? status}
    </span>
  );
}

function ReceivedCard({ item }: { item: WorkerReferralCard }) {
  // A regra que NÃO pode quebrar: enquanto pendente, `item.worker_id` é `null` — este
  // componente jamais deve construir link/ação que dependa dele antes do aceite.
  return (
    <div className="bg-white border-2 border-black rounded-2xl p-6 hover:shadow-[6px_6px_0px_0px_rgba(0,0,0,1)] transition-all">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div className="flex items-center gap-4">
          <div className="w-14 h-14 rounded-xl bg-gray-100 border-2 border-black overflow-hidden flex items-center justify-center">
            {item.card.avatar_url ? (
              <img src={item.card.avatar_url} alt={item.card.full_name} className="w-full h-full object-cover" />
            ) : (
              <span className="font-black text-lg">{item.card.full_name.charAt(0)}</span>
            )}
          </div>
          <div>
            <p className="font-black uppercase">{item.card.full_name}</p>
            {item.card.primary_role && (
              <span className="bg-blue-50 text-blue-700 px-2 py-0.5 rounded-pill text-xs font-bold uppercase inline-block mt-1">
                {item.card.primary_role}
              </span>
            )}
            {typeof item.card.rating_average === 'number' && (
              <p className="text-xs text-gray-500 font-bold mt-1 flex items-center gap-1">
                <Star size={12} className="fill-yellow-400 text-yellow-400" />
                {item.card.rating_average.toFixed(1)} ({item.card.reviews_count ?? 0})
              </p>
            )}
          </div>
        </div>
        <StatusBadge status={item.status} />
      </div>

      <p className="text-sm text-gray-600 font-bold mt-4">
        Indicado por <span className="font-black">{item.referring_company.name}</span>
      </p>
      {item.message && <p className="text-sm text-gray-500 mt-2 italic">"{item.message}"</p>}
      {item.status === 'awaiting_worker' && (
        <p className="text-xs text-gray-400 font-bold mt-3">
          Aguardando o freela decidir. Você será avisado se ele aceitar.
        </p>
      )}
    </div>
  );
}

export default function CompanyReferrals() {
  const navigate = useNavigate();
  const { addToast } = useToast();
  const { teamMembers, companyId } = useCompanyTeam();

  const [tab, setTab] = useState<Tab>('received');
  const [received, setReceived] = useState<WorkerReferralCard[]>([]);
  const [loadingReceived, setLoadingReceived] = useState(true);
  const [sent, setSent] = useState<SentReferralRow[]>([]);
  const [loadingSent, setLoadingSent] = useState(true);
  const [erroSent, setErroSent] = useState(false);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [cancellingId, setCancellingId] = useState<string | null>(null);

  const loadReceived = useCallback(async () => {
    setLoadingReceived(true);
    const result = await ReferralService.listReceivedCards();
    if (result.outcome === 'unauthenticated') {
      navigate('/login');
      return;
    }
    setReceived(result.items);
    setLoadingReceived(false);
  }, [navigate]);

  const loadSent = useCallback(async () => {
    if (!companyId) return;
    setLoadingSent(true);
    setErroSent(false);
    const rows = await ReferralService.listMyReferrals(companyId);

    const companyIds = Array.from(new Set(rows.map((r) => r.requesting_company_id)));
    let names: Record<string, string> = {};
    if (companyIds.length > 0) {
      const { data, error } = await supabase.from('companies').select('id, name').in('id', companyIds);
      if (error) {
        logError('CompanyReferrals.loadSent', error);
        setErroSent(true);
      } else {
        names = Object.fromEntries((data ?? []).map((c: { id: string; name: string }) => [c.id, c.name]));
      }
    }

    setSent(
      rows.map((r) => ({
        ...r,
        requestingCompanyName: names[r.requesting_company_id],
        workerName: teamMembers.find((m) => m.worker.id === r.worker_id)?.worker.full_name,
      })),
    );
    setLoadingSent(false);
  }, [companyId, teamMembers]);

  useEffect(() => {
    void loadReceived();
  }, [loadReceived]);

  useEffect(() => {
    void loadSent();
  }, [loadSent]);

  const handleCancel = async (referralId: string) => {
    setCancellingId(referralId);
    const result = await ReferralService.cancelReferral(referralId);
    setCancellingId(null);

    if (result.outcome === 'cancelled') {
      addToast('Indicação cancelada.', 'success');
      void loadSent();
      return;
    }
    addToast(result.error ?? 'Não foi possível cancelar a indicação.', 'error');
  };

  return (
    <div className="max-w-4xl mx-auto pb-20 animate-in fade-in slide-in-from-bottom-4 duration-400">
      <div className="flex items-start justify-between mb-8 gap-4 flex-wrap">
        <div>
          <h1 className="text-4xl font-black uppercase tracking-tighter flex items-center gap-3">
            <Share2 size={32} /> Indicações
          </h1>
          <p className="text-gray-500 font-bold mt-1">
            Apresente freelas de confiança a outras empresas, ou veja quem te indicaram.
          </p>
        </div>
        <button
          type="button"
          onClick={() => setShowCreateModal(true)}
          className="bg-black hover:bg-primary text-white px-6 py-3 rounded-xl font-black uppercase flex items-center gap-2 transition-colors shadow-[4px_4px_0px_0px_rgba(0,166,81,1)]"
        >
          <Send size={20} /> Indicar Freela
        </button>
      </div>

      <div className="flex gap-2 mb-6 border-b-2 border-black">
        <button
          type="button"
          onClick={() => setTab('received')}
          className={`px-6 py-3 font-black uppercase text-sm border-2 border-b-0 rounded-t-xl flex items-center gap-2 min-h-11 ${
            tab === 'received' ? 'bg-black text-white border-black' : 'bg-white text-gray-500 border-transparent hover:text-black'
          }`}
        >
          <Inbox size={16} /> Recebidas
        </button>
        <button
          type="button"
          onClick={() => setTab('sent')}
          className={`px-6 py-3 font-black uppercase text-sm border-2 border-b-0 rounded-t-xl flex items-center gap-2 min-h-11 ${
            tab === 'sent' ? 'bg-black text-white border-black' : 'bg-white text-gray-500 border-transparent hover:text-black'
          }`}
        >
          <Send size={16} /> Enviadas
        </button>
      </div>

      {tab === 'received' && (
        <section aria-label="Indicações recebidas">
          {loadingReceived && (
            <div className="space-y-4 animate-pulse">
              {[...Array(2)].map((_, i) => (
                <div key={i} className="h-28 bg-gray-200 rounded-2xl" />
              ))}
            </div>
          )}
          {!loadingReceived && received.length === 0 && (
            <div className="bg-gray-50 border-2 border-dashed border-gray-200 rounded-2xl p-8 text-center">
              <p className="text-sm font-bold text-gray-500">
                Nenhuma indicação recebida ainda.
              </p>
            </div>
          )}
          <div className="grid grid-cols-1 gap-4">
            {received.map((item) => (
              <ReceivedCard key={item.referral_id} item={item} />
            ))}
          </div>
        </section>
      )}

      {tab === 'sent' && (
        <section aria-label="Indicações enviadas">
          {loadingSent && (
            <div className="space-y-4 animate-pulse">
              {[...Array(2)].map((_, i) => (
                <div key={i} className="h-24 bg-gray-200 rounded-2xl" />
              ))}
            </div>
          )}
          {!loadingSent && erroSent && (
            <div className="bg-red-50 border-2 border-red-200 rounded-2xl p-6 text-center">
              <p className="text-sm font-bold text-red-600 mb-3">Não foi possível carregar suas indicações.</p>
              <button onClick={() => void loadSent()} className="bg-black text-white font-black uppercase text-xs px-4 min-h-11 rounded-xl hover:bg-primary transition-colors">Tentar de novo</button>
            </div>
          )}
          {!loadingSent && !erroSent && sent.length === 0 && (
            <div className="bg-gray-50 border-2 border-dashed border-gray-200 rounded-2xl p-8 text-center">
              <p className="text-sm font-bold text-gray-500">Você ainda não indicou nenhum freela.</p>
            </div>
          )}
          <div className="grid grid-cols-1 gap-4">
            {sent.map((r) => (
              <div key={r.id} className="bg-white border-2 border-black rounded-2xl p-6 flex items-start justify-between gap-4 flex-wrap">
                <div>
                  <p className="font-black uppercase flex items-center gap-2 flex-wrap">
                    <span>{r.workerName ?? 'Freela'}</span>
                    <span className="text-gray-400 font-bold normal-case">→</span>
                    <Building2 size={16} />
                    <span>{r.requestingCompanyName ?? 'Empresa'}</span>
                  </p>
                  {r.message && <p className="text-sm text-gray-500 mt-2 italic">"{r.message}"</p>}
                </div>
                <div className="flex items-center gap-3">
                  <StatusBadge status={r.status} />
                  {r.status === 'awaiting_worker' && (
                    <button
                      type="button"
                      onClick={() => void handleCancel(r.id)}
                      disabled={cancellingId === r.id}
                      aria-label="Cancelar indicação"
                      className="min-h-11 min-w-11 flex items-center justify-center rounded-xl border-2 border-black hover:bg-gray-100 disabled:opacity-50"
                    >
                      {cancellingId === r.id ? <Loader2 size={16} className="animate-spin" /> : <X size={16} />}
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>
        </section>
      )}

      {showCreateModal && (
        <CreateReferralModal
          open={showCreateModal}
          onClose={() => setShowCreateModal(false)}
          referringCompanyId={companyId}
          teamMembers={teamMembers}
          onCreated={() => void loadSent()}
        />
      )}
    </div>
  );
}
