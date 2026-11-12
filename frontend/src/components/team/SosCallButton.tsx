import { useEffect, useState } from 'react';
import { Siren, AlertTriangle } from 'lucide-react';
import { SosService } from '../../services/sosService';
import { useToast } from '../../contexts/ToastContext';
import { SHIFT_CALL_REASON_LABELS } from '../../types';
import type { ShiftCallReason } from '../../types';
import { Button, Field } from '../ui';
import { ModalShell } from './ModalShell';

// ---------------------------------------------------------------------------
// Botão + modal "Chamar fora do Elenco" (F11 — SOS: descoberta em urgência).
//
// O fallback do F1: só faz sentido quando o Elenco já esgotou e o turno começa em poucas
// horas — `sos_call_eligibility` reverifica as três condições (elenco tentado e esgotado,
// urgência <4h, vaga aberta) e é isso que liga/desliga o botão. MAS o botão é só UX: a RPC
// `create_sos_call` reverifica tudo de novo, então mesmo com o botão habilitado o disparo pode
// ser recusado — cada outcome de recusa tem mensagem específica (contrato §4.5 do
// ddl-aprovado.md), nunca um genérico "não foi possível".
//
// A PROMESSA CENTRAL (D1 do ADR-20260821): a empresa nunca vê quem foi chamado, só quantos
// foram avisados (`targets_count`) e, depois, quem aceitou. Este componente não lê nem monta
// nenhuma lista de alvos — ele só dispara a RPC e mostra a contagem que ela devolve.
// ---------------------------------------------------------------------------

export interface SosCallButtonProps {
  jobId: string;
  /** Muda quando o estado do turno muda (ex.: chamados ao Elenco fecham/expiram) — força
   *  reconsulta da elegibilidade sem precisar de um efeito extra no componente pai. */
  refreshKey?: string | number;
  onDispatched: (targetsCount: number) => void;
}

const ELIGIBILITY_REASON_LABELS: Record<string, string> = {
  ok: '',
  unauthenticated: 'Sessão expirada. Atualize a página.',
  forbidden: 'Você não pode abrir um SOS para este turno.',
  not_found: 'Turno não encontrado.',
  job_deleted: 'Este turno foi removido.',
  job_started: 'Este turno já começou.',
  not_urgent: 'O SOS só libera quando o turno começa em menos de 4 horas.',
  already_filled: 'Este turno já está com todas as vagas preenchidas.',
  team_not_tried: 'Chame primeiro o seu Elenco — o SOS só abre depois que esgotar.',
  team_call_still_open: 'Ainda há um chamado ao Elenco em aberto para este turno.',
  quota_open: 'Você já tem um SOS aberto. Aguarde ele encerrar.',
  quota_week: 'Você atingiu o limite de 3 SOS a cada 7 dias.',
  error: 'Não foi possível verificar se o SOS está disponível agora.',
};

function eligibilityMessage(reason: string): string {
  return ELIGIBILITY_REASON_LABELS[reason] ?? 'O SOS não está disponível para este turno agora.';
}

export function SosCallButton({ jobId, refreshKey, onDispatched }: SosCallButtonProps) {
  const { addToast } = useToast();
  const [eligible, setEligible] = useState(false);
  const [reasonBlocked, setReasonBlocked] = useState('checking');
  const [checking, setChecking] = useState(true);
  const [modalOpen, setModalOpen] = useState(false);
  const [reason, setReason] = useState<ShiftCallReason>('falta');
  const [message, setMessage] = useState('');
  const [dispatching, setDispatching] = useState(false);

  useEffect(() => {
    let active = true;
    setChecking(true);
    void (async () => {
      const result = await SosService.checkEligibility(jobId);
      if (!active) return;
      setEligible(result.eligible);
      setReasonBlocked(result.reason);
      setChecking(false);
    })();
    return () => {
      active = false;
    };
  }, [jobId, refreshKey]);

  const handleOpen = () => {
    setMessage('');
    setReason('falta');
    setModalOpen(true);
  };

  const handleConfirm = async () => {
    setDispatching(true);
    const result = await SosService.createSosCall(jobId, {
      reason,
      message: message.trim() ? message.trim() : undefined,
    });
    setDispatching(false);

    if (!result.success) {
      addToast(result.error ?? 'Não foi possível abrir o chamado de urgência.', 'error');
      return;
    }

    // O SOS de UM alvo e comum (cidade pequena, pool apertado): o painel logo abaixo ja
    // flexionava certo, so o toast dizia "1 profissionais".
    const avisados = result.targetsCount ?? 0;
    addToast(
      avisados === 1
        ? '1 profissional fora do seu Elenco foi avisado. Você verá se ele aceitar.'
        : `${avisados} profissionais fora do seu Elenco foram avisados. Você verá quem aceitar.`,
      'success',
    );
    setModalOpen(false);
    onDispatched(result.targetsCount ?? 0);
  };

  return (
    <>
      <Button
        variant="secondary"
        onClick={handleOpen}
        disabled={checking || !eligible}
        title={!checking && !eligible ? eligibilityMessage(reasonBlocked) : undefined}
        iconLeft={<Siren size={16} />}
        className="flex-shrink-0"
      >
        SOS: fora do Elenco
      </Button>

      {!checking && !eligible && (
        <p className="sr-only">{eligibilityMessage(reasonBlocked)}</p>
      )}

      {modalOpen && (
        <SosModal
          reason={reason}
          message={message}
          dispatching={dispatching}
          onReasonChange={setReason}
          onMessageChange={setMessage}
          onClose={() => setModalOpen(false)}
          onConfirm={() => void handleConfirm()}
        />
      )}
    </>
  );
}

interface SosModalProps {
  reason: ShiftCallReason;
  message: string;
  dispatching: boolean;
  onReasonChange: (reason: ShiftCallReason) => void;
  onMessageChange: (message: string) => void;
  onClose: () => void;
  onConfirm: () => void;
}

function SosModal({ reason, message, dispatching, onReasonChange, onMessageChange, onClose, onConfirm }: SosModalProps) {
  return (
    <ModalShell
      title={
        <>
          <Siren size={20} /> Chamar fora do Elenco
        </>
      }
      subtitle="Seu Elenco esgotou e o turno começa em breve. Avisamos profissionais da sua cidade que ativaram a descoberta em urgência."
      onClose={onClose}
      locked={dispatching}
      footer={
        <Button
          variant="dark"
          size="lg"
          fullWidth
          onClick={onConfirm}
          loading={dispatching}
          iconLeft={<Siren size={18} />}
        >
          {dispatching ? 'Enviando...' : 'Chamar fora do Elenco'}
        </Button>
      }
    >
      <div className="space-y-4">
        {/* A membrana da feature — nunca escondida em texto pequeno. */}
        <div className="flex items-start gap-2 text-sm text-black bg-yellow-50 border-2 border-black rounded-xl p-3">
          <AlertTriangle size={16} className="flex-shrink-0 mt-0.5" />
          <span>
            Você não vai ver quem foi chamado — só quantos foram avisados, e depois quem
            aceitar. É assim que a descoberta em urgência funciona.
          </span>
        </div>

        <Field label="Motivo">
          <select
            id="sos-reason"
            value={reason}
            onChange={(e) => onReasonChange(e.target.value as ShiftCallReason)}
            disabled={dispatching}
          >
            {(Object.keys(SHIFT_CALL_REASON_LABELS) as ShiftCallReason[]).map((key) => (
              <option key={key} value={key}>
                {SHIFT_CALL_REASON_LABELS[key]}
              </option>
            ))}
          </select>
        </Field>

        <Field label="Recado (opcional)">
          <textarea
            id="sos-message"
            value={message}
            onChange={(e) => onMessageChange(e.target.value)}
            disabled={dispatching}
            rows={2}
            className="!h-auto py-3"
            placeholder="Ex.: precisamos de alguém agora até o fechamento"
          />
        </Field>
      </div>
    </ModalShell>
  );
}
