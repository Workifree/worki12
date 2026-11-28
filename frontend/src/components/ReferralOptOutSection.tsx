import { useEffect, useState } from 'react';
import ErroDeCarga from './ErroDeCarga';
import { Card } from './ui';
import WorkerSwitch from './WorkerSwitch';
import { Share2 } from 'lucide-react';
import { supabase } from '../lib/supabase';
import { logError } from '../lib/logger';
import { useToast } from '../contexts/ToastContext';
import { ReferralService } from '../services/referralService';
import { checkSession } from '../lib/authSession';

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
      const session = await checkSession();
      if (session.status !== 'ok') {
        // Sem leitura, o interruptor mostraria o padrão como se fosse a escolha da pessoa.
        if (active) { setErroCarga(true); setLoading(false); }
        return;
      }
      const user = session.user;

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
        ? 'Você pode ser indicado por empresas do seu Elenco a partir de agora.'
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
    return <div className="h-20 bg-gray-200 rounded-2xl animate-pulse" role="status"><span className="sr-only">Carregando</span></div>;
  }

  return (
    <Card>
      <h3 className="text-lg font-bold mb-1 flex items-center gap-2">
        <Share2 size={20} aria-hidden="true" /> Indicação entre empresas
      </h3>
      <p className="text-sm text-gray-600 mb-4">
        Empresas do seu Elenco podem indicar você a outras empresas que confiam nelas. Você
        sempre decide: a empresa que recebe a indicação só te conhece se você aceitar.
      </p>
      <WorkerSwitch
        checked={accepts}
        label="Aceitar indicações de empresas do meu Elenco"
        text={accepts ? 'Aceito ser indicado' : 'Não quero ser indicado'}
        data-copilot="freela.perfil.indicacoes"
        onToggle={() => void handleToggle()}
        disabled={saving}
      />
    </Card>
  );
}
