import { useEffect, useState } from 'react';
import ErroDeCarga from './ErroDeCarga';
import { Siren, Loader2 } from 'lucide-react';
import { supabase } from '../lib/supabase';
import { logError } from '../lib/logger';
import { useToast } from '../contexts/ToastContext';
import { SosService } from '../services/sosService';

// ---------------------------------------------------------------------------
// "Descoberta em urgência" (F11) — seção de opt-in no perfil do freela.
//
// `workers.discoverable_for_sos` (default FALSE — o oposto de `accepts_referrals`, F10: aqui
// ninguém entra sem pedir). Ligar coloca o freela no pool que `create_sos_call` pode alcançar
// quando o Elenco de uma empresa esgota e o turno começa em menos de 4 horas.
//
// O TEXTO DE CONSENTIMENTO (§5 do ddl-aprovado.md) É REQUISITO, NÃO COPY: é a PRIMEIRA vez no
// produto que uma empresa SEM NENHUM vínculo prévio ganha acesso à linha completa do freela
// (telefone, CPF, data de nascimento e chave PIX — `can_view_worker_profile` é row-level, não
// libera só telefone/PIX), no instante em que ele aceita um chamado. Por isso o texto fica
// SEMPRE visível — nunca atrás de tooltip, "saiba mais" ou depois do toggle — e o componente
// NUNCA liga o toggle sem ele estar renderizado no DOM (ver teste). ADR-20260821 D3.
//
// Gate (DDL §5): só aparece quando `availability_days IS NOT NULL` (F7 já foi declarada) — o
// SOS pressupõe que o freela já decidiu quando topa trabalhar; sem isso, mostrar o toggle
// venderia um alcance que a plataforma ainda não sabe quando usar.
// ---------------------------------------------------------------------------

export default function SosDiscoverySection() {
  const { addToast } = useToast();
  const [discoverable, setDiscoverableState] = useState(false);
  const [hasAvailability, setHasAvailability] = useState(false);
  const [loading, setLoading] = useState(true);
  const [erroCarga, setErroCarga] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let active = true;
    void (async () => {
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) return;

      const { data, error } = await supabase
        .from('workers')
        .select('discoverable_for_sos, availability_days')
        .eq('id', user.id)
        .maybeSingle();

      if (!active) return;
      if (error) {
        logError('SosDiscoverySection.fetch', error);
        // Sem isto, o default do useState vira "verdade" na tela: gate/preferencia
        // renderizados INVERTIDOS numa falha de rede (achado P2 da heuristica).
        setErroCarga(true);
      } else if (data) {
        setDiscoverableState(Boolean(data.discoverable_for_sos));
        setHasAvailability(Boolean(data.availability_days && Object.keys(data.availability_days).length > 0));
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
    const next = !discoverable;
    setSaving(true);
    const result = await SosService.setDiscoverable(next);
    setSaving(false);

    if (!result.success) {
      addToast(result.error ?? 'Não foi possível salvar a preferência.', 'error');
      return;
    }

    setDiscoverableState(next);
    addToast(
      next
        ? 'Você está visível para chamados de urgência fora do seu Elenco.'
        : 'Você não vai mais receber chamados de urgência de empresas fora do seu Elenco.',
      'success',
    );
  };

  if (loading) {
    return <div className="h-20 bg-gray-200 rounded-2xl animate-pulse" />;
  }

  if (erroCarga) {
    return (
      <section className="mt-6">
        <ErroDeCarga onRetry={() => window.location.reload()} mensagem="Não foi possível carregar sua configuração. Recarregue para ver o estado real." />
      </section>
    );
  }

  if (!hasAvailability) {
    // Sem grade de disponibilidade declarada (F7), o toggle nem aparece — não é reticência, é
    // pré-requisito de produto (DDL §5). Zero texto de consentimento aqui: nada foi oferecido
    // ainda, então não há nada a consentir.
    return (
      <div className="bg-white border-2 border-dashed border-gray-300 rounded-2xl p-6">
        <h3 className="text-xl font-black uppercase mb-2 flex items-center gap-2 text-gray-400">
          <Siren size={20} /> Descoberta em urgência
        </h3>
        <p className="text-sm font-bold text-gray-400">
          Declare sua disponibilidade da semana acima para poder ativar este recurso.
        </p>
      </div>
    );
  }

  return (
    <div className="bg-white border-2 border-black rounded-2xl p-6">
      <h3 className="text-xl font-black uppercase mb-2 flex items-center gap-2">
        <Siren size={20} /> Descoberta em urgência
      </h3>

      {/* Texto de consentimento — sempre visível, nunca em tooltip/"saiba mais"/depois do
          toggle (contrato §5 do ddl-aprovado.md). A lista de dados expostos é a lista REAL
          (can_view_worker_profile libera a linha inteira de workers, não só telefone/PIX). */}
      <p className="text-sm text-gray-600 font-medium mb-2">
        Empresas que você ainda não conhece podem te chamar para turnos que começam em menos de 4
        horas, na sua cidade, no máximo 2 chamados por semana.
      </p>
      <p className="text-sm font-bold text-black bg-yellow-50 border-2 border-black rounded-xl p-3 mb-4">
        Se você aceitar um desses chamados, a empresa passa a ver seus dados de contratação —
        telefone, CPF, data de nascimento e chave PIX — para poder te pagar. Recusar não tem
        nenhum efeito no seu perfil. Você pode desligar isto a qualquer momento.
      </p>

      <div className="flex items-center justify-between gap-4 bg-gray-50 border-2 border-black rounded-xl p-4">
        <span className="font-black uppercase text-sm">
          {discoverable ? 'Descoberta ativada' : 'Descoberta desativada'}
        </span>
        <button
          type="button"
          role="switch"
          aria-checked={discoverable}
          aria-label="Ativar descoberta em urgência para empresas fora do meu Elenco"
          onClick={() => void handleToggle()}
          disabled={saving}
          className={`min-h-11 min-w-11 px-4 py-2 rounded-xl font-black uppercase text-xs transition-colors flex items-center justify-center gap-2 border-2 border-black ${
            discoverable ? 'bg-primary hover:bg-black text-white' : 'bg-white hover:bg-gray-100 text-black'
          } disabled:opacity-50 disabled:cursor-not-allowed`}
        >
          {saving ? <Loader2 size={16} className="animate-spin" /> : discoverable ? 'Ativado' : 'Desativado'}
        </button>
      </div>
    </div>
  );
}
