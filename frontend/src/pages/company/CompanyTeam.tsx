import { useState, useEffect } from 'react';
import { Users, Clock, UserPlus } from 'lucide-react';
import { useCompanyTeam } from '../../hooks/useTeamConnections';
import { supabase } from '../../lib/supabase';
import { logError } from '../../lib/logger';
import type { TeamMember } from '../../types';
import { MemberCard } from '../../components/team/MemberCard';
import { PendingCard } from '../../components/team/PendingCard';
import { AddWorkerModal } from '../../components/team/AddWorkerModal';
import { InviteToShiftModal } from '../../components/team/InviteToShiftModal';
import { RemoveMemberDialog } from '../../components/team/RemoveMemberDialog';
import type { WorkerHistoryWithCompany } from '../../components/team/types';

// ---------------------------------------------------------------------------
// Página principal: CompanyTeam
//
// Orquestra o "Meu Elenco": lista de freelas aceitos/pendentes, histórico com
// a empresa (batch, sem N+1) e os modais de adicionar/convidar/remover.
// A UI de cada peça vive em `components/team/` — ver ali para os cards e modais.
// ---------------------------------------------------------------------------

export default function CompanyTeam() {
  const { teamMembers, pendingConnections, loading, companyId, addWorker, removeWorker, refresh } = useCompanyTeam();
  const [showAddModal, setShowAddModal] = useState(false);
  const [removingMember, setRemovingMember] = useState<TeamMember | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);
  // R "Convidar direto do elenco": modal por membro + histórico batch (1 query p/ todo o elenco).
  const [invitingMember, setInvitingMember] = useState<TeamMember | null>(null);
  const [historyByWorker, setHistoryByWorker] = useState<Record<string, WorkerHistoryWithCompany>>({});

  const handleConfirmRemove = async () => {
    if (!removingMember) return;
    setIsDeleting(true);
    try {
      await removeWorker(removingMember.worker.id);
      setRemovingMember(null);
    } finally {
      setIsDeleting(false);
    }
  };

  // Histórico com a empresa (turnos concluídos) para TODO o elenco de uma vez — evita N+1.
  useEffect(() => {
    if (!companyId || teamMembers.length === 0) {
      setHistoryByWorker({});
      return;
    }
    let active = true;
    const workerIds = teamMembers.map((m) => m.worker.id);
    void (async () => {
      const { data, error } = await supabase
        .from('applications')
        .select('worker_id, jobs!inner(company_id, start_date)')
        .eq('status', 'completed')
        .eq('jobs.company_id', companyId)
        .in('worker_id', workerIds);

      if (error) {
        logError('CompanyTeam.fetchHistory', error);
        return;
      }
      if (!active) return;

      const map: Record<string, WorkerHistoryWithCompany> = {};
      interface CompletedRow {
        worker_id: string;
        jobs: { start_date: string | null } | { start_date: string | null }[] | null;
      }
      (data as unknown as CompletedRow[] ?? []).forEach((row) => {
        const jobsField = Array.isArray(row.jobs) ? row.jobs[0] : row.jobs;
        const startDate = jobsField?.start_date ?? null;
        const entry = map[row.worker_id] ?? { count: 0, lastDate: null };
        entry.count += 1;
        if (startDate && (!entry.lastDate || startDate > entry.lastDate)) entry.lastDate = startDate;
        map[row.worker_id] = entry;
      });
      setHistoryByWorker(map);
    })();
    return () => { active = false; };
  }, [companyId, teamMembers]);

  if (loading) {
    return (
      <div className="max-w-4xl mx-auto space-y-6 animate-pulse pb-20">
        <div className="h-10 bg-gray-200 rounded-xl w-48" />
        <div className="h-12 bg-gray-200 rounded-xl w-40" />
        <div className="space-y-4">
          {[...Array(3)].map((_, i) => (
            <div key={i} className="h-24 bg-gray-200 rounded-2xl" />
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-4xl mx-auto pb-20 animate-in fade-in slide-in-from-bottom-4 duration-400">
      {/* Header */}
      <div className="flex items-start justify-between mb-8 gap-4 flex-wrap">
        <div>
          <h1 className="text-4xl font-black uppercase tracking-tighter">Meu Elenco</h1>
          <p className="text-gray-500 font-bold mt-1">
            {teamMembers.length} freela{teamMembers.length !== 1 ? 's' : ''} no elenco
            {pendingConnections.length > 0 && (
              <span className="ml-2 text-yellow-600">· {pendingConnections.length} aguardando aceite</span>
            )}
          </p>
        </div>
        <button
          onClick={() => setShowAddModal(true)}
          className="bg-black hover:bg-primary text-white px-6 py-3 rounded-xl font-black uppercase flex items-center gap-2 transition-colors shadow-[4px_4px_0px_0px_rgba(0,166,81,1)]"
        >
          <UserPlus size={20} /> Adicionar Freela
        </button>
      </div>

      {/* Elenco aceito */}
      {teamMembers.length > 0 && (
        <section className="mb-8">
          <h2 className="text-xl font-black uppercase mb-4 flex items-center gap-2">
            <Users size={20} /> Elenco Ativo
          </h2>
          <div className="grid grid-cols-1 gap-4">
            {teamMembers.map((member) => (
              <MemberCard
                key={member.connection.id}
                member={member}
                onRemove={(m) => setRemovingMember(m)}
                onInvite={(m) => setInvitingMember(m)}
                history={historyByWorker[member.worker.id]}
              />
            ))}
          </div>
        </section>
      )}

      {/* Convites pendentes */}
      {pendingConnections.length > 0 && (
        <section className="mb-8">
          <h2 className="text-xl font-black uppercase mb-4 flex items-center gap-2 text-yellow-700">
            <Clock size={20} /> Aguardando Aceite
          </h2>
          <div className="space-y-3">
            {pendingConnections.map((conn) => (
              <PendingCard key={conn.id} connection={conn} />
            ))}
          </div>
        </section>
      )}

      {/* Empty state */}
      {teamMembers.length === 0 && pendingConnections.length === 0 && (
        <div className="text-center py-20 border-2 border-dashed border-gray-200 rounded-2xl bg-gray-50">
          <Users size={48} className="mx-auto mb-4 text-gray-300" />
          <h3 className="text-xl font-black uppercase mb-2">Elenco vazio</h3>
          <p className="text-gray-500 font-bold mb-6 max-w-sm mx-auto">
            Adicione freelas pelo QR de identidade, Worki ID ou pelo link de perfil que eles te enviarem.
            Eles aparecerão aqui após aceitarem.
          </p>
          <button
            onClick={() => setShowAddModal(true)}
            className="bg-black hover:bg-primary text-white px-8 py-3 rounded-xl font-black uppercase inline-flex items-center gap-2 transition-colors"
          >
            <UserPlus size={20} /> Adicionar Primeiro Freela
          </button>
        </div>
      )}

      {/* Modal Adicionar */}
      {showAddModal && (
        <AddWorkerModal
          onClose={() => setShowAddModal(false)}
          onAdded={refresh}
          addWorker={addWorker}
        />
      )}

      {/* Modal "Convidar para turno" — a partir de um freela do elenco */}
      {invitingMember && (
        <InviteToShiftModal
          member={invitingMember}
          onClose={() => setInvitingMember(null)}
          onInvited={refresh}
        />
      )}

      {/* Modal de Confirmação de Remoção */}
      {removingMember && (
        <RemoveMemberDialog
          member={removingMember}
          isDeleting={isDeleting}
          onCancel={() => setRemovingMember(null)}
          onConfirm={() => { void handleConfirmRemove(); }}
        />
      )}
    </div>
  );
}
