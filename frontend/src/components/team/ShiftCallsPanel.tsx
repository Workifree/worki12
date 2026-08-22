import { Megaphone, Siren, Loader2, Clock, CheckCircle2, XCircle, MinusCircle, Timer } from 'lucide-react';
import { formatDurationShort } from '../../lib/dateUtils';
import { SHIFT_CALL_REASON_LABELS } from '../../types';
import type { ShiftCall, ShiftCallTarget } from '../../types';

// ---------------------------------------------------------------------------
// Painel de chamados do turno (visão da empresa).
//
// Responde as perguntas que o gerente faz olhando o relógio: quem eu chamei, quem já respondeu,
// quanto tempo faz, e quanto tempo levou para preencher. Esse último número é o argumento
// comercial inteiro do produto ("de 2 horas para 6 minutos") — por isso ele aparece na tela da
// operação, não escondido num relatório que ninguém abre.
//
// F11 (SOS) reusa este painel para `origin='sos'`, e é aqui que a membrana da feature (D1 do
// ADR-20260821 — "a empresa nunca vê quem foi chamado") precisa ser respeitada NO CLIENTE
// também, não só na RLS: `call.targets` de um chamado SOS só traz, pela policy
// `shift_call_targets_select`, quem já ACEITOU — nunca é o pool. Por isso, para `origin='sos'`:
//   - a contagem de "quantos foram avisados" usa `call.targets_count` (o número que a RPC
//     devolveu), NUNCA `targets.length` (que aqui é só o tamanho de quem aceitou);
//   - a lista de chips é filtrada explicitamente para `response === 'accepted'` — defesa em
//     profundidade: mesmo que a RLS já garanta isso, o componente nunca assume e nunca
//     renderiza uma linha "Aguardando"/pendente de um alvo de SOS (não há como saber quem são).
// ---------------------------------------------------------------------------

function targetVisual(target: ShiftCallTarget) {
  switch (target.response) {
    case 'accepted':
      return { icon: CheckCircle2, className: 'text-primary', label: 'Aceitou' };
    case 'declined':
      return { icon: XCircle, className: 'text-gray-400', label: 'Recusou' };
    case 'closed':
      // Nunca "perdeu"/"ficou de fora": o freela não fez nada de errado, e essa tela também é
      // lida em voz alta na operação.
      return { icon: MinusCircle, className: 'text-gray-300', label: 'Vaga preenchida' };
    default:
      return { icon: Clock, className: 'text-yellow-600', label: 'Aguardando' };
  }
}

export interface ShiftCallsPanelProps {
  calls: ShiftCall[];
  loading: boolean;
  cancellingId: string | null;
  onCancel: (callId: string) => void;
}

export function ShiftCallsPanel({ calls, loading, cancellingId, onCancel }: ShiftCallsPanelProps) {
  if (loading) {
    return <div className="h-24 bg-gray-100 rounded-2xl animate-pulse mb-6" />;
  }
  if (calls.length === 0) return null;

  return (
    <div className="space-y-3 mb-8">
      {calls.map((call) => {
        const isSos = call.origin === 'sos';
        const rawTargets = call.targets ?? [];
        // F11: para SOS, `rawTargets` já vem filtrado pela RLS a só quem aceitou — não confiar
        // nisso é o que documenta o comentário acima; filtra de novo, explicitamente.
        const targets = isSos ? rawTargets.filter((t) => t.response === 'accepted') : rawTargets;
        const pending = isSos ? 0 : targets.filter((t) => !t.response).length;
        const accepted = targets.filter((t) => t.response === 'accepted').length;
        const isOpen = call.status === 'open';
        // F11: o número que a empresa PODE ver é `targets_count` (devolvido pela RPC), nunca o
        // tamanho do array de alvos carregados no client.
        const notifiedCount = isSos ? call.targets_count : targets.length;

        return (
          <div
            key={call.id}
            className={`rounded-2xl border-2 p-4 ${
              isOpen ? 'border-black bg-yellow-50 shadow-[4px_4px_0px_0px_rgba(0,0,0,1)]' : 'border-gray-200 bg-white'
            }`}
          >
            <div className="flex items-start justify-between gap-3 mb-3">
              <div className="min-w-0">
                <p className="font-black uppercase text-sm flex items-center gap-2">
                  {isSos ? <Siren size={16} /> : <Megaphone size={16} />}
                  {isSos
                    ? isOpen
                      ? 'Chamado de urgência aberto'
                      : 'Chamado de urgência encerrado'
                    : isOpen
                      ? 'Chamado aberto'
                      : 'Chamado encerrado'}
                  <span className="text-[10px] font-black uppercase px-2 py-0.5 rounded-full bg-black text-white">
                    {SHIFT_CALL_REASON_LABELS[call.reason]}
                  </span>
                  {isSos && (
                    <span className="text-[10px] font-black uppercase px-2 py-0.5 rounded-full bg-white border-2 border-black">
                      Fora do Elenco
                    </span>
                  )}
                </p>
                <p className="text-xs font-bold text-gray-500 mt-1">
                  {isSos
                    ? `${notifiedCount ?? 0} avisado${(notifiedCount ?? 0) !== 1 ? 's' : ''} fora do Elenco · ${accepted} aceite${accepted !== 1 ? 's' : ''}`
                    : `${notifiedCount} chamado${notifiedCount !== 1 ? 's' : ''} · ${accepted} aceite${accepted !== 1 ? 's' : ''}${isOpen && pending > 0 ? ` · ${pending} sem responder` : ''}`}
                </p>
              </div>

              {isOpen && (
                <button
                  onClick={() => onCancel(call.id)}
                  disabled={cancellingId === call.id}
                  className="px-3 py-2 rounded-xl border-2 border-black font-black uppercase text-xs hover:bg-black hover:text-white transition-colors disabled:opacity-50 flex items-center gap-1.5 flex-shrink-0"
                >
                  {cancellingId === call.id ? <Loader2 className="animate-spin" size={12} /> : null}
                  Cancelar
                </button>
              )}
            </div>

            {/* A métrica que prova o valor do produto. */}
            {call.first_claim_at && (
              <p className="flex items-center gap-1.5 text-xs font-black text-primary bg-primary-light border border-green-200 rounded-xl px-3 py-2 mb-3">
                <Timer size={14} />
                Primeira vaga preenchida em {formatDurationShort(call.created_at, call.first_claim_at)}
              </p>
            )}

            {isOpen && !call.first_claim_at && (
              <p className="flex items-center gap-1.5 text-xs font-bold text-gray-600 mb-3">
                <Clock size={14} />
                Ninguém aceitou ainda · expira {new Date(call.expires_at).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}
              </p>
            )}

            <div className="flex flex-wrap gap-2">
              {targets.map((target) => {
                const visual = targetVisual(target);
                const Icon = visual.icon;
                return (
                  <span
                    key={target.id}
                    className="inline-flex items-center gap-1.5 text-xs font-bold bg-white border border-gray-200 rounded-xl px-2.5 py-1.5"
                  >
                    <Icon size={12} className={visual.className} />
                    <span className="truncate max-w-[140px]">
                      {target.worker?.full_name ?? 'Freela'}
                    </span>
                    <span className="text-gray-400">· {visual.label}</span>
                  </span>
                );
              })}
            </div>
          </div>
        );
      })}
    </div>
  );
}
