import { useNavigate } from 'react-router-dom';
import { Clock } from 'lucide-react';
import type { TeamConnection } from '../../types';
import { roleLabel } from '../../lib/statusLabels';

// ---------------------------------------------------------------------------
// Subcomponent: card de conexão pendente
// ---------------------------------------------------------------------------

export interface PendingCardProps {
  connection: TeamConnection;
  /** Modo do Encarregado: o cartão não abre o perfil do freela. */
  restricted?: boolean;
}

export function PendingCard({ connection, restricted = false }: PendingCardProps) {
  const workerData = connection.worker;
  const name = workerData?.full_name ?? 'Freela';
  const navigate = useNavigate();
  const workerId = connection.worker_id;

  // R5: também clicável — abre o perfil do freela ainda pendente de aceite.
  const goToProfile = () => navigate(`/company/worker/${workerId}`);

  return (
    <li className="flex min-h-16 items-center">
      <div
        role={restricted ? undefined : 'button'}
        tabIndex={restricted ? undefined : 0}
        onClick={restricted ? undefined : goToProfile}
        onKeyDown={restricted ? undefined : (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); goToProfile(); } }}
        className="flex min-h-16 w-full items-center gap-3 px-4 py-3 transition-colors [&[role=button]]:cursor-pointer [&[role=button]]:hover:bg-gray-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-black"
      >
        <div aria-hidden="true" className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-gray-100 text-sm font-bold text-gray-600">
          {name[0]?.toUpperCase() ?? '?'}
        </div>
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-semibold text-gray-900">{name}</p>
          {workerData?.primary_role && (
            <p className="truncate text-xs text-gray-600 sm:text-sm">{roleLabel(workerData.primary_role)}</p>
          )}
        </div>
        <div className="flex shrink-0 items-center gap-1 rounded-pill bg-yellow-50 px-2.5 py-1 text-xs font-semibold text-yellow-800">
          <Clock size={12} aria-hidden="true" /> Aguardando
        </div>
      </div>
    </li>
  );
}
