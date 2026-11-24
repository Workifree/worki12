import { useState } from 'react';
import { Bell, Send } from 'lucide-react';
import ModalShell from '../ModalShell';
import { Button } from '../ui';
import { reassignJobs, reassignMessage } from '../../services/shiftOperationService';

export interface PassDestination {
  userId: string;
  label: string;
}

interface PassJobsModalProps {
  jobIds: string[];
  destinations: PassDestination[];
  onClose: () => void;
  onDone: (message: string, moved: number) => void;
}

/**
 * "Passar para..." (R18/A14): transfere 1 ou vários turnos para outra pessoa que opera a empresa.
 * Só opcional: remover alguém nunca depende disto. O destino é avisado (o texto abaixo é a
 * informação que a pessoa precisa antes de confirmar).
 */
export default function PassJobsModal({ jobIds, destinations, onClose, onDone }: PassJobsModalProps) {
  const [to, setTo] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const total = jobIds.length;
  const target = destinations.find((d) => d.userId === to);

  const confirm = async () => {
    if (!to) return;
    setBusy(true);
    setError(null);
    const result = await reassignJobs(jobIds, to);
    setBusy(false);
    if (result.outcome === 'ok') {
      onDone(reassignMessage(result), result.moved);
      return;
    }
    setError(reassignMessage(result));
  };

  return (
    <ModalShell labelledBy="pass-jobs-title" onClose={() => { if (!busy) onClose(); }}>
      <h2 id="pass-jobs-title" className="text-xl font-black">
        Passar {total === 1 ? 'turno' : `${total} turnos`} para...
      </h2>
      <p className="mt-1 text-sm text-gray-700">Escolha quem vai responder {total === 1 ? 'por esse turno' : 'por esses turnos'}.</p>

      <div role="group" aria-label="Quem recebe" className="mt-4 flex flex-col gap-2">
        {destinations.map((d) => {
          const selected = d.userId === to;
          return (
            <button
              key={d.userId}
              type="button"
              aria-pressed={selected}
              disabled={busy}
              onClick={() => setTo(d.userId)}
              className={`min-h-14 w-full rounded-xl border-2 px-4 py-3 text-left text-base font-bold transition-colors disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-black focus-visible:ring-offset-2 ${
                selected ? 'border-black bg-black text-white' : 'border-gray-300 bg-white hover:border-black'
              }`}
            >
              {d.label}
            </button>
          );
        })}
      </div>

      <div className="mt-4 flex items-start gap-2 rounded-xl border-2 border-black bg-blue-50 p-3 text-sm">
        <Bell size={16} className="mt-0.5 shrink-0" aria-hidden="true" />
        <p>
          {target ? <strong>{target.label}</strong> : 'A pessoa escolhida'} será notificada. Quem passou também
          recebe o registro.
        </p>
      </div>

      {error && (
        <p role="alert" className="mt-3 text-sm font-semibold text-red-700">{error}</p>
      )}

      <div className="mt-5 flex flex-col gap-3">
        <Button variant="dark" size="lg" fullWidth disabled={!to} loading={busy} iconLeft={<Send size={18} />} onClick={() => { void confirm(); }}>
          Passar {total === 1 ? 'o turno' : `os ${total} turnos`}
        </Button>
        <Button variant="secondary" size="lg" fullWidth disabled={busy} onClick={onClose}>Voltar</Button>
      </div>
    </ModalShell>
  );
}
