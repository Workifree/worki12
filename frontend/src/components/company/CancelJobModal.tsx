import { useState } from 'react';
import { AlertTriangle, XCircle } from 'lucide-react';
import ModalShell from '../ModalShell';
import { Button, Field } from '../ui';
import {
  cancelJob,
  cancelJobMessage,
  cancelJobWasRefused,
  type CancelJobResult,
  type ViewerRole,
} from '../../services/shiftOperationService';

interface CancelJobModalProps {
  job: { id: string; title: string; dateLabel?: string };
  /** Papel de quem cancela: muda a orientação quando há pagamento ativo. */
  role?: ViewerRole;
  onClose: () => void;
  /** Chamado quando o turno foi mesmo cancelado (ou já estava). A tela recarrega a lista. */
  onCancelled: (result: CancelJobResult) => void;
}

/**
 * Cancelar o turno INTEIRO (R27). O modal é informativo: diz o que acontece (quem está no turno é
 * avisado; o Elenco não é penalizado) e traduz cada recusa do banco em português claro, sem
 * alterar nada. A autorização e as recusas vivem em `cancel_job`; aqui é só UX.
 */
export default function CancelJobModal({ job, role = 'gestor', onClose, onCancelled }: CancelJobModalProps) {
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [refusal, setRefusal] = useState<CancelJobResult | null>(null);

  const confirm = async () => {
    setBusy(true);
    const result = await cancelJob(job.id, reason);
    setBusy(false);
    if (result.outcome === 'cancelled' || result.outcome === 'already_cancelled') {
      onCancelled(result);
      return;
    }
    setRefusal(result);
    // "Não encontrado" = a lista está velha: recarrega por trás.
    if (result.outcome === 'not_found') onCancelled(result);
  };

  return (
    <ModalShell labelledBy="cancel-job-title" onClose={() => { if (!busy) onClose(); }} focusKey={refusal ? 'recusa' : 'confirmar'}>
      <div className="flex items-start gap-3">
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border-2 border-black bg-red-50">
          <XCircle size={20} aria-hidden="true" />
        </div>
        <div className="min-w-0">
          <h2 id="cancel-job-title" className="text-xl font-black">Cancelar turno</h2>
          <p className="mt-1 text-sm font-bold break-words">{job.title}{job.dateLabel ? ` · ${job.dateLabel}` : ''}</p>
        </div>
      </div>

      {refusal ? (
        <div className="mt-4 space-y-4">
          <div role="alert" className="flex items-start gap-3 rounded-xl border-2 border-black bg-yellow-50 p-4">
            <AlertTriangle size={18} className="mt-0.5 shrink-0" aria-hidden="true" />
            <p className="text-sm font-semibold">{cancelJobMessage(refusal, role)}</p>
          </div>
          {cancelJobWasRefused(refusal.outcome) && (
            <p className="text-xs text-gray-600">Nada foi alterado: o turno continua como estava.</p>
          )}
          <Button variant="dark" size="lg" fullWidth data-autofocus onClick={onClose}>Entendi</Button>
        </div>
      ) : (
        <div className="mt-4 space-y-4">
          <ul className="space-y-2 text-sm text-gray-800">
            <li>Quem está no turno, convidado ou contratado, é avisado do cancelamento.</li>
            <li>Chamados abertos para esse turno são encerrados.</li>
            <li>O Elenco não muda: ninguém é penalizado por causa do cancelamento.</li>
            <li>O Gestor e quem responde pelo turno recebem o registro.</li>
          </ul>
          <Field label="Motivo (opcional)" hint="Até 200 caracteres. Não escreva dados pessoais ou de saúde.">
            <input
              type="text"
              maxLength={200}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              disabled={busy}
              placeholder="Ex.: evento remarcado"
            />
          </Field>
          <div className="flex flex-col gap-3">
            <Button variant="danger" size="lg" fullWidth loading={busy} onClick={() => { void confirm(); }}>
              Cancelar o turno
            </Button>
            <Button variant="secondary" size="lg" fullWidth disabled={busy} onClick={onClose} data-autofocus>
              Manter o turno
            </Button>
          </div>
        </div>
      )}
    </ModalShell>
  );
}
