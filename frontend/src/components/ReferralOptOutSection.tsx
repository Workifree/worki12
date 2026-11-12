import { useEffect, useState } from 'react';
import ErroDeCarga from './ErroDeCarga';
import { Button, Card } from './ui';
import { Share2 } from 'lucide-react';
import { supabase } from '../lib/supabase';
import { logError } from '../lib/logger';
import { useToast } from '../contexts/ToastContext';
import { ReferralService } from '../services/referralService';

// ---------------------------------------------------------------------------
// "Indicação entre empresas" (F10) — seção de opt-out no perfil do freela.
//
// Vocabulário é requisito: "indicar"/"indicação"/"indicado por". Nunca "trocar",
// "emprestar", "ceder" ou "transferir" (ver ADR-20260821-indicacao-entre-empresas.md D1).
//
// `workers.accepts_referrals` (default true) controla se empresas do próprio elenco
// podem apresentar este freela a outra empresa. Desligar aqui NÃO afeta o elenco atual —
// só impede novas indicações (a criação recusa com o mesmo outcome genérico usado para
// veto/vínculo já existente/teto — LM-3 do ddl-aprovado.md).
// ---------------------------------------------------------------------------

export default function ReferralOptOutSection() {
  const { addToast } = useToast();
  const [accepts, setAccepts] = useState(true);
  const [loading, setLoading] = useState(true);
  const [erroCarga, setErroCarga] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let active = true;
    void (async () => {
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) { setLoading(false); return; }

      const { data, error } = await supabase
        .from('workers')
        .select('accepts_referrals')
        .eq('id', user.id)
        .maybeSingle();

      if (!active) return;
      if (error) {
        logError('ReferralOptOutSection.fetch', error);
        // Sem isto, o default do useState vira "verdade" na tela: gate/preferencia
        // renderizados INVERTIDOS numa falha de rede (achado P2 da heuristica).
        setErroCarga(true);
      } else if (data && typeof data.accepts_referrals === 'boolean') {
        setAccepts(data.accepts_referrals);
      }
      if (!error) setErroCarga(false);
      setLoading(false);
    })();
    return () => {
      active = false;
    };
  }, []);

  const handleToggle = async () => {
    if (saving) return;
    const next = !accepts;
    setSaving(true);
    const result = await ReferralService.setAcceptsReferrals(next);
    setSaving(false);

    if (!result.success) {
      addToast(result.error ?? 'Não foi possível salvar sua preferência.', 'error');
      return;
    }

    setAccepts(next);
    addToast(
      next
        ? 'Você pode ser indicado por empresas do seu elenco a partir de agora.'
        : 'Você não será mais indicado a novas empresas.',
      'success',
    );
  };

  if (erroCarga) {
    return (
      <section className="mt-6">
        <ErroDeCarga onRetry={() => window.location.reload()} mensagem="Não foi possível carregar sua configuração. Recarregue para ver o estado real." />
      </section>
    );
  }

  if (loading) {
    return <div className="h-20 bg-gray-200 rounded-2xl animate-pulse" />;
  }

  return (
    <Card>
      <h3 className="text-lg font-bold mb-1 flex items-center gap-2">
        <Share2 size={20} aria-hidden="true" /> Indicação entre empresas
      </h3>
      <p className="text-sm text-gray-600 mb-4">
        Empresas do seu elenco podem indicar você a outras empresas que confiam nelas. Você
        sempre decide: a empresa que recebe a indicação só te conhece se você aceitar.
      </p>
      <div className="flex items-center justify-between gap-4 bg-gray-50 border-2 border-black rounded-xl p-4">
        <span className="font-bold text-sm">
          {accepts ? 'Aceito ser indicado' : 'Não quero ser indicado'}
        </span>
        <Button
          role="switch"
          aria-checked={accepts}
          aria-label="Aceitar indicações de empresas do meu elenco"
          variant={accepts ? 'primary' : 'secondary'}
          onClick={handleToggle}
          loading={saving}
        >
          {accepts ? 'Ativado' : 'Desativado'}
        </Button>
      </div>
    </Card>
  );
}
