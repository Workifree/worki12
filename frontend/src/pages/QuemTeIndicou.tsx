import { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Share2, Loader2, Building2, Check, X } from 'lucide-react';
import { supabase } from '../lib/supabase';
import { logError } from '../lib/logger';
import { useToast } from '../contexts/ToastContext';
import { ReferralService } from '../services/referralService';
import type { WorkerReferral } from '../types';

// ---------------------------------------------------------------------------
// "Quem te indicou" (F10) — o freela decide sobre indicações que empresas do seu
// elenco fizeram para outras empresas.
//
// Vocabulário: "indicou"/"indicação". NUNCA "trocaram você"/"emprestaram você".
//
// Antes de aceitar, a tela precisa deixar claro o que o freela está concordando: a
// empresa destino passa a poder ver o perfil dele e convidá-lo para turnos — sem
// juridiquês, sem esconder a consequência (requisito #4 do spec de UI).
//
// A recusa é NEUTRA (precedente `decline_shift_call`, F1): nenhuma cor de alerta,
// nenhum "recusado" em vermelho, nenhuma contagem — recusar uma indicação não é
// diferente, aos olhos desta tela, de simplesmente não ter respondido ainda.
// ---------------------------------------------------------------------------

interface PendingReferralRow extends WorkerReferral {
  referringCompanyName?: string;
  referringCompanyLogo?: string | null;
}

export default function QuemTeIndicou() {
  const navigate = useNavigate();
  const { addToast } = useToast();
  const [items, setItems] = useState<PendingReferralRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [respondingId, setRespondingId] = useState<string | null>(null);

  const load = useCallback(async () => {
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) {
      navigate('/login');
      return;
    }

    setLoading(true);
    const referrals = await ReferralService.listMyPendingReferrals();

    const companyIds = Array.from(new Set(referrals.map((r) => r.referring_company_id)));
    let companies: Record<string, { name: string; logo_url?: string | null }> = {};
    if (companyIds.length > 0) {
      const { data, error } = await supabase
        .from('companies')
        .select('id, name, logo_url')
        .in('id', companyIds);
      if (error) {
        logError('QuemTeIndicou.load', error);
      } else {
        companies = Object.fromEntries(
          (data ?? []).map((c: { id: string; name: string; logo_url?: string | null }) => [
            c.id,
            { name: c.name, logo_url: c.logo_url },
          ]),
        );
      }
    }

    setItems(
      referrals.map((r) => ({
        ...r,
        referringCompanyName: companies[r.referring_company_id]?.name,
        referringCompanyLogo: companies[r.referring_company_id]?.logo_url,
      })),
    );
    setLoading(false);
  }, [navigate]);

  useEffect(() => {
    void load();
  }, [load]);

  const handleAccept = async (referralId: string) => {
    setRespondingId(referralId);
    const result = await ReferralService.acceptReferral(referralId);
    setRespondingId(null);

    if (result.outcome === 'accepted' || result.outcome === 'already_connected') {
      addToast('Conexão aceita. A empresa já pode te ver e te convidar para turnos.', 'success');
      setItems((prev) => prev.filter((i) => i.id !== referralId));
      return;
    }
    addToast(result.error ?? 'Não foi possível aceitar a indicação.', 'error');
  };

  const handleDecline = async (referralId: string) => {
    setRespondingId(referralId);
    const result = await ReferralService.declineReferral(referralId);
    setRespondingId(null);

    if (result.outcome === 'declined') {
      // Recusa neutra — sem "você recusou X" em destaque, tom igual ao de aceite.
      addToast('Tudo certo. A indicação foi encerrada.', 'success');
      setItems((prev) => prev.filter((i) => i.id !== referralId));
      return;
    }
    addToast(result.error ?? 'Não foi possível recusar a indicação.', 'error');
  };

  if (loading) {
    return (
      <div className="max-w-2xl mx-auto pb-20 space-y-4 animate-pulse">
        <div className="h-10 bg-gray-200 rounded-xl w-56" />
        {[...Array(2)].map((_, i) => (
          <div key={i} className="h-40 bg-gray-200 rounded-2xl" />
        ))}
      </div>
    );
  }

  return (
    <div className="max-w-2xl mx-auto pb-20 animate-in fade-in slide-in-from-bottom-4 duration-400">
      <h1 className="text-4xl font-black uppercase tracking-tighter flex items-center gap-3 mb-2">
        <Share2 size={32} /> Quem te indicou
      </h1>
      <p className="text-gray-500 font-bold mb-8">
        Empresas do seu elenco podem te indicar para outras empresas. Você decide se aceita.
      </p>

      {items.length === 0 && (
        <div className="bg-gray-50 border-2 border-dashed border-gray-200 rounded-2xl p-8 text-center">
          <p className="text-sm font-bold text-gray-500">Nenhuma indicação pendente no momento.</p>
        </div>
      )}

      <div className="grid grid-cols-1 gap-4">
        {items.map((item) => (
          <div key={item.id} className="bg-white border-2 border-black rounded-2xl p-6">
            <div className="flex items-center gap-4">
              <div className="w-14 h-14 rounded-xl bg-gray-100 border-2 border-black overflow-hidden flex items-center justify-center">
                {item.referringCompanyLogo ? (
                  <img
                    src={item.referringCompanyLogo}
                    alt={item.referringCompanyName ?? 'Empresa'}
                    className="w-full h-full object-cover"
                  />
                ) : (
                  <Building2 size={24} />
                )}
              </div>
              <div>
                <p className="font-black uppercase">{item.referringCompanyName ?? 'Uma empresa do seu elenco'}</p>
                <p className="text-xs text-gray-500 font-bold uppercase">indicou você</p>
              </div>
            </div>

            {item.message && <p className="text-sm text-gray-600 italic mt-4">"{item.message}"</p>}

            <div className="bg-primary-light text-primary rounded-xl p-4 mt-4 text-sm font-bold">
              Se aceitar, a empresa indicada passa a te ver e pode te chamar para turnos —
              assim como qualquer empresa do seu elenco hoje. Se recusar, nada muda: você
              continua no elenco de quem te indicou normalmente.
            </div>

            <div className="flex gap-3 mt-4">
              <button
                type="button"
                onClick={() => void handleDecline(item.id)}
                disabled={respondingId === item.id}
                className="flex-1 px-6 py-3 rounded-xl font-black uppercase border-2 border-black hover:bg-gray-100 transition-colors disabled:opacity-50 flex items-center justify-center gap-2 min-h-11"
              >
                {respondingId === item.id ? <Loader2 size={18} className="animate-spin" /> : <X size={18} />}
                Recusar
              </button>
              <button
                type="button"
                onClick={() => void handleAccept(item.id)}
                disabled={respondingId === item.id}
                className="flex-1 bg-primary hover:bg-black text-white px-6 py-3 rounded-xl font-black uppercase transition-colors disabled:opacity-50 flex items-center justify-center gap-2 min-h-11"
              >
                {respondingId === item.id ? <Loader2 size={18} className="animate-spin" /> : <Check size={18} />}
                Aceitar
              </button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
