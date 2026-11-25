import { useEffect, useRef, useState } from 'react';

import { Megaphone, Siren, Clock, CheckCircle2, XCircle, MinusCircle, Timer } from 'lucide-react';
import { formatDurationShort } from '../../lib/dateUtils';
import { SHIFT_CALL_REASON_LABELS } from '../../types';
import type { ShiftCall, ShiftCallTarget } from '../../types';
import { Button, Card, DialogActions, DialogHeader } from '../ui';
import { Dialog } from '../ui/Dialog';

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

function targetVisual(target: ShiftCallTarget, callStatus?: ShiftCall['status']) {
  switch (target.response) {
    case 'accepted':
      return { icon: CheckCircle2, className: 'text-primary', label: 'Aceitou' };
    case 'declined':
      return { icon: XCircle, className: 'text-gray-500', label: 'Recusou' };
    case 'closed': {
      // `closed` só diz "esta tentativa terminou sem resposta desta pessoa" -- e isso acontece
      // por motivos diferentes. O rótulo fixo "Vaga preenchida" mentia quando a EMPRESA cancelava
      // o chamado: ela via "vaga preenchida" num turno onde ninguém foi contratado (conferido:
      // call cancelled, zero applications). Painel que mente uma vez deixa de ser consultado.
      //
      // Nunca "perdeu"/"ficou de fora": o freela não fez nada de errado, e essa tela também é
      // lida em voz alta na operação.
      const label =
        callStatus === 'cancelled' ? 'Chamado cancelado'
        : callStatus === 'expired' ? 'Expirou sem resposta'
        : 'Vaga preenchida';
      return { icon: MinusCircle, className: 'text-gray-400', label };
    }
    default:
      // Chamado já vencido ou encerrado sem a resposta desta pessoa nunca diz "Aguardando".
      if (callStatus && callStatus !== 'open') {
        const label = callStatus === 'cancelled' ? 'Chamado cancelado' : callStatus === 'filled' ? 'Vaga preenchida' : 'Não respondeu a tempo';
        return { icon: MinusCircle, className: 'text-gray-400', label };
      }
      return { icon: Clock, className: 'text-yellow-700', label: 'Aguardando' };
  }
}

export interface ShiftCallsPanelProps {
  calls: ShiftCall[];
  loading: boolean;
  cancellingId: string | null;
  onCancel: (callId: string) => void;
  /** "open" = só o chamado vivo (topo da tela); "history" = só os encerrados, recolhidos. */
  part?: 'all' | 'open' | 'history';
}

export function ShiftCallsPanel({ calls, loading, cancellingId, onCancel, part = 'all' }: ShiftCallsPanelProps) {
  // `Date.now()` no corpo do render e chamada impura: o mesmo componente, com as mesmas props,
  // renderiza diferente conforme a hora -- e o React Compiler recusa (lint error, Article 3).
  // Trocar por relogio em estado corrige junto um resquicio da propria derivacao de expiracao:
  // sem tick, o chamado que vence as 16:23 segue pintado de ABERTO ate alguem recarregar a
  // pagina, que e exatamente a mentira que essa derivacao existe para evitar. 30s e resolucao de
  // sobra para um campo que mostra minuto.
  const [agora, setAgora] = useState(() => Date.now());
  // Cancelar um chamado não tem volta (quem foi chamado perde o convite): pede confirmação.
  const [confirmingId, setConfirmingId] = useState<string | null>(null);
  const confirmLock = useRef(false);
  const askCancel = (callId: string) => {
    confirmLock.current = false;
    setConfirmingId(callId);
  };
  const confirmCancel = () => {
    if (!confirmingId || confirmLock.current) return;
    confirmLock.current = true;
    onCancel(confirmingId);
    setConfirmingId(null);
  };
  useEffect(() => {
    const id = setInterval(() => setAgora(Date.now()), 30_000);
    return () => clearInterval(id);
  }, []);

  if (loading) {
    if (part === 'history') return null;
    return <div className="h-24 bg-gray-100 rounded-2xl animate-pulse motion-reduce:animate-none mb-6" role="status"><span className="sr-only">Carregando</span></div>;
  }
  if (calls.length === 0) return null;

  // Encerrado = não está mais aberto, inclusive o que venceu sem ninguém marcar no banco.
  const isLive = (call: ShiftCall) =>
    call.status === 'open' && !(!!call.expires_at && new Date(call.expires_at).getTime() <= agora);

  const renderCall = (call: ShiftCall) => {
        const isSos = call.origin === 'sos';
        const rawTargets = call.targets ?? [];
        // F11: para SOS, `rawTargets` já vem filtrado pela RLS a só quem aceitou — não confiar
        // nisso é o que documenta o comentário acima; filtra de novo, explicitamente.
        const targets = isSos ? rawTargets.filter((t) => t.response === 'accepted') : rawTargets;
        const pending = isSos ? 0 : targets.filter((t) => !t.response).length;
        const accepted = targets.filter((t) => t.response === 'accepted').length;
        // `shift_calls` NAO tem quem marque 'expired': o edge function `expire-invites` so mexe
        // em `applications`, e nao ha cron para chamados. Sem derivar aqui, um chamado que morreu
        // as 16h continua exibido como ABERTO -- com botao de cancelar e "expira 16:23" no
        // passado. A empresa abre o app de manha e espera por um chamado que ja acabou, que e
        // exatamente a falha que o produto existe para evitar. Mesma tecnica que a tela de
        // candidatos ja usa para convite: expiracao deriva na LEITURA, sem escrever no banco.
        const jaVenceu = !!call.expires_at && new Date(call.expires_at).getTime() <= agora;
        const isOpen = call.status === 'open' && !jaVenceu;
        // F11: o número que a empresa PODE ver é `targets_count` (devolvido pela RPC), nunca o
        // tamanho do array de alvos carregados no client.
        const notifiedCount = isSos ? call.targets_count : targets.length;

        const effectiveStatus: ShiftCall['status'] = call.status === 'open' && jaVenceu ? 'expired' : call.status;
        const allDeclined = isOpen && !isSos && targets.length > 0 && targets.every((t) => t.response === 'declined');

        return (
          <Card
            key={call.id}
            padding="sm"
            tone={isOpen ? 'default' : 'nested'}
          >
            <div className="flex items-start justify-between gap-3 mb-3">
              <div className="min-w-0">
                <p className="font-bold text-sm flex items-center gap-2 flex-wrap">
                  {isSos ? <Siren size={16} /> : <Megaphone size={16} />}
                  {isSos
                    ? isOpen
                      ? 'Chamado de urgência aberto'
                      : 'Chamado de urgência encerrado'
                    : isOpen
                      ? 'Chamado aberto'
                      : jaVenceu && call.status === 'open'
                        ? 'Chamado expirou'
                        : 'Chamado encerrado'}
                  <span className="text-xs font-normal text-gray-600">Motivo: {SHIFT_CALL_REASON_LABELS[call.reason]}</span>
                  {isSos && (
                    <span className="text-xs font-semibold px-2.5 py-0.5 rounded-pill bg-white border-2 border-black">
                      Fora do Elenco
                    </span>
                  )}
                </p>
                <p className="text-xs text-gray-600 mt-1">
                  {isSos
                    ? `${notifiedCount ?? 0} avisado${(notifiedCount ?? 0) !== 1 ? 's' : ''} fora do Elenco · ${accepted} aceite${accepted !== 1 ? 's' : ''}`
                    : `${notifiedCount} chamado${notifiedCount !== 1 ? 's' : ''} · ${accepted} aceite${accepted !== 1 ? 's' : ''}${isOpen && pending > 0 ? ` · ${pending} sem responder` : ''}`}
                </p>
              </div>

              {isOpen && (
                <Button
                  variant="secondary"
                  onClick={() => askCancel(call.id)}
                  disabled={cancellingId === call.id}
                  loading={cancellingId === call.id}
                  className="flex-shrink-0"
                  data-copilot="empresa.presenca.encerrar-chamado"
                >
                  Encerrar chamado
                </Button>
              )}
            </div>

            {/* A métrica que prova o valor do produto. */}
            {call.first_claim_at && (
              <p className="flex items-center gap-1.5 text-xs font-bold text-primary-dark bg-primary-light rounded-xl px-3 py-2 mb-3">
                <Timer size={14} />
                Primeira vaga preenchida em {formatDurationShort(call.created_at, call.first_claim_at)}
              </p>
            )}

            {allDeclined && <p className="mb-3 text-sm font-bold">Todos recusaram. Encerre e chame mais gente.</p>}

            {!call.first_claim_at && (isOpen || (jaVenceu && call.status === 'open')) && (
              <p className="flex items-center gap-1.5 text-xs text-gray-700 mb-3">
                <Clock size={14} />
                {isOpen
                  ? `Ninguém aceitou ainda · expira ${new Date(call.expires_at).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}`
                  : `Expirou às ${new Date(call.expires_at).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })} sem ninguém aceitar — chame de novo`}
              </p>
            )}

            <div className="flex flex-wrap gap-2">
              {targets.map((target) => {
                const visual = targetVisual(target, effectiveStatus);
                const Icon = visual.icon;
                return (
                  <span
                    key={target.id}
                    className="inline-flex items-center gap-1.5 text-xs font-semibold bg-white border border-gray-200 rounded-pill px-2.5 py-1.5"
                  >
                    <Icon size={12} className={visual.className} />
                    <span className="truncate max-w-[140px]">
                      {target.worker?.full_name ?? 'Freela'}
                    </span>
                    <span className="font-normal text-gray-600">· {visual.label}</span>
                  </span>
                );
              })}
            </div>
          </Card>
        );
  };

  const live = calls.filter(isLive);
  const closed = calls.filter((call) => !isLive(call));
  const showLive = part !== 'history' && live.length > 0;
  const showClosed = part !== 'open' && closed.length > 0;
  if (!showLive && !showClosed) return null;

  return (
    <div className="space-y-4 mb-6">
      {showLive && live.map(renderCall)}

      {showClosed && (
        <details className="rounded-2xl border-2 border-gray-200 bg-white">
          <summary className="flex min-h-11 cursor-pointer items-center px-4 text-sm font-bold">
            Histórico de chamados ({closed.length})
          </summary>
          <div className="space-y-3 px-3 pb-3">{closed.map(renderCall)}</div>
        </details>
      )}

      {confirmingId && (
        <Dialog labelledBy="cancelar-chamado-titulo" onClose={() => setConfirmingId(null)}>
          <DialogHeader titleId="cancelar-chamado-titulo" title="Encerrar este chamado?" />
          <p className="text-sm text-gray-600">
            Quem ainda não respondeu deixa de poder aceitar e é avisado. Quem já aceitou continua no turno.
          </p>
          <DialogActions stacked>
            <Button variant="secondary" data-autofocus onClick={() => setConfirmingId(null)}>
              Voltar
            </Button>
            <Button variant="danger" onClick={confirmCancel}>Encerrar chamado</Button>
          </DialogActions>
        </Dialog>
      )}
    </div>
  );
}
