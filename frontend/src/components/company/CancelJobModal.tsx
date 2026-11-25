import { useState } from 'react';
import { Alert, Button, DialogActions, DialogHeader, Field } from '../ui';
import { Dialog } from '../ui/Dialog';
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
    <Dialog labelledBy="cancel-job-title" onClose={() => { if (!busy) onClose(); }} locked={busy} focusKey={refusal ? 'recusa' : 'confirmar'} initialFocus="panel">
      <DialogHeader
        titleId="cancel-job-title"
        title="Cancelar este turno?"
        subtitle={`${job.title}${job.dateLabel ? ` · ${job.dateLabel}` : ''}`}
      />

      {refusal ? (
        <div className="space-y-3">
          <Alert tone="warning" role="alert">{cancelJobMessage(refusal, role)}</Alert>
          {cancelJobWasRefused(refusal.outcome) && (
            <p className="text-xs text-gray-600">Nada foi alterado: o turno continua como estava.</p>
          )}
          <DialogActions>
            <Button variant="dark" data-autofocus onClick={onClose}>Entendi</Button>
          </DialogActions>
        </div>
      ) : (
        <div className="space-y-4">
          <ul className="space-y-2 text-sm text-gray-700">
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
          <DialogActions>
            <Button variant="secondary" disabled={busy} onClick={onClose}>
              Voltar
            </Button>
            <Button variant="danger" data-copilot="empresa.turno.cancelar-confirmar" data-copilot-risk="D" loading={busy} onClick={() => { void confirm(); }}>
              Cancelar turno
            </Button>
          </DialogActions>
        </div>
      )}
    </Dialog>
  );
}
