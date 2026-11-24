import { Clock } from 'lucide-react';

/**
 * Selo de conflito (R14): só informa que a pessoa já está em outro turno nesse horário. Nunca diz
 * qual turno, de quem, nem bloqueia — quem decide é quem convoca. Contorno (nunca fill), como os
 * demais sinais da linha do freela.
 */
export function BusyWorkerBadge() {
  return (
    <span
      className="inline-flex items-center gap-1 flex-shrink-0 text-xs font-semibold text-orange-700 bg-orange-50 border border-orange-300 rounded-pill px-2 py-0.5"
      title="Esta pessoa está em outro turno da sua empresa nesse horário. Você ainda pode convocar."
    >
      <Clock size={10} aria-hidden="true" /> Já está em outro turno nesse horário
    </span>
  );
}
