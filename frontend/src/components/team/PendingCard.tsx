import { useNavigate } from 'react-router-dom';
import { Clock } from 'lucide-react';
import type { TeamConnection } from '../../types';

// ---------------------------------------------------------------------------
// Subcomponent: card de conexão pendente
// ---------------------------------------------------------------------------

export interface PendingCardProps {
  connection: TeamConnection;
}

export function PendingCard({ connection }: PendingCardProps) {
  const workerData = connection.worker;
  const name = workerData?.full_name ?? 'Freela';
  const navigate = useNavigate();
  const workerId = connection.worker_id;

  // R5: também clicável — abre o perfil do freela ainda pendente de aceite.
  const goToProfile = () => navigate(`/company/worker/${workerId}`);

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={goToProfile}
      onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); goToProfile(); } }}
      className="bg-gray-50 border-2 border-dashed border-gray-300 rounded-2xl p-4 flex items-center gap-3 cursor-pointer hover:border-black transition-colors"
    >
      <div className="w-10 h-10 rounded-xl bg-gray-200 border-2 border-gray-300 flex items-center justify-center font-black text-gray-500">
        {name[0]?.toUpperCase() ?? '?'}
      </div>
      <div className="flex-1 min-w-0">
        <p className="font-black uppercase text-sm truncate">{name}</p>
        {workerData?.primary_role && (
          <p className="text-xs font-bold text-gray-400 uppercase">{workerData.primary_role}</p>
        )}
      </div>
      <div className="flex items-center gap-1 text-xs font-bold text-yellow-700 bg-yellow-50 px-2 py-1 rounded-xl border border-yellow-200">
        <Clock size={12} /> Aguardando
      </div>
    </div>
  );
}
