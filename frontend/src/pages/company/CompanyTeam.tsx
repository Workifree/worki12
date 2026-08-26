import { useState, useEffect, useCallback } from 'react';
import { Users, Clock, UserPlus, ListChecks, Plus, Pencil, Trash2, AlertTriangle, Loader2 } from 'lucide-react';
import { useCompanyTeam } from '../../hooks/useTeamConnections';
import { supabase } from '../../lib/supabase';
import { logError } from '../../lib/logger';
import { useToast } from '../../contexts/ToastContext';
import { TeamListService } from '../../services/teamListService';
import type { TeamMember, TeamListWithMembers } from '../../types';
import { MemberCard } from '../../components/team/MemberCard';
import { PendingCard } from '../../components/team/PendingCard';
import { AddWorkerModal } from '../../components/team/AddWorkerModal';
import { InviteToShiftModal } from '../../components/team/InviteToShiftModal';
import { RemoveMemberDialog } from '../../components/team/RemoveMemberDialog';
import { TeamListModal } from '../../components/team/TeamListModal';
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
  const { addToast } = useToast();
  const [showAddModal, setShowAddModal] = useState(false);
  const [removingMember, setRemovingMember] = useState<TeamMember | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);
  // R "Convidar direto do elenco": modal por membro + histórico batch (1 query p/ todo o elenco).
  const [invitingMember, setInvitingMember] = useState<TeamMember | null>(null);
  const [historyByWorker, setHistoryByWorker] = useState<Record<string, WorkerHistoryWithCompany>>({});

  // F2: Listas salvas do elenco — CRUD organizacional, não toca team_connections/saldo.
  const [lists, setLists] = useState<TeamListWithMembers[]>([]);
  const [loadingLists, setLoadingLists] = useState(true);
  const [showListModal, setShowListModal] = useState(false);
  const [editingList, setEditingList] = useState<TeamListWithMembers | null>(null);
  const [deletingList, setDeletingList] = useState<TeamListWithMembers | null>(null);
  const [isDeletingList, setIsDeletingList] = useState(false);

  const refreshLists = useCallback(async () => {
    setLoadingLists(true);
    const data = await TeamListService.listLists();
    setLists(data);
    setLoadingLists(false);
  }, []);

  useEffect(() => {
    void refreshLists();
  }, [refreshLists]);

  const handleConfirmDeleteList = async () => {
    if (!deletingList) return;
    setIsDeletingList(true);
    const result = await TeamListService.deleteList(deletingList.id);
    setIsDeletingList(false);
    if (!result.success) {
      addToast(result.error ?? 'Não foi possível excluir a lista.', 'error');
      return;
    }
    addToast('Lista excluída.', 'success');
    setDeletingList(null);
    void refreshLists();
  };

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

      {/* Listas do Elenco (F2) — atalhos por função pra chamar o grupo inteiro de uma vez */}
      <section className="mb-8">
        <div className="flex items-center justify-between mb-4 gap-3 flex-wrap">
          <h2 className="text-xl font-black uppercase flex items-center gap-2">
            <ListChecks size={20} /> Listas do Elenco
          </h2>
          <button
            onClick={() => setShowListModal(true)}
            className="bg-black hover:bg-primary text-white min-h-11 px-4 py-2 rounded-xl font-black uppercase text-xs inline-flex items-center gap-2 transition-colors"
          >
            <Plus size={16} /> Nova Lista
          </button>
        </div>

        {loadingLists && (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 animate-pulse">
            {[...Array(2)].map((_, i) => (
              <div key={i} className="h-20 bg-gray-200 rounded-2xl" />
            ))}
          </div>
        )}

        {/* Grid diverge de propósito do "Elenco Ativo" (grid-cols-1 puro): card de lista é
            bem mais leve (só nome + contagem + 2 ações), sem avatar/rating/histórico, então
            2 colunas em telas >=sm ainda respeitam o touch target sem apertar o layout. */}
        {!loadingLists && lists.length > 0 && (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            {lists.map((list) => (
              <div
                key={list.id}
                className="bg-white border-2 border-black rounded-2xl p-4 flex items-center justify-between gap-3"
              >
                <div className="min-w-0">
                  <p className="font-black uppercase truncate">{list.name}</p>
                  <p className="text-xs font-bold text-gray-500">
                    {list.memberIds.length} {list.memberIds.length === 1 ? 'membro' : 'membros'}
                  </p>
                </div>
                <div className="flex gap-2 flex-shrink-0">
                  <button
                    onClick={() => setEditingList(list)}
                    aria-label={`Editar lista ${list.name}`}
                    className="p-2 rounded-xl border-2 border-black hover:bg-gray-100 transition-colors"
                  >
                    <Pencil size={16} />
                  </button>
                  <button
                    onClick={() => setDeletingList(list)}
                    aria-label={`Excluir lista ${list.name}`}
                    className="p-2 rounded-xl border-2 border-black hover:bg-red-50 text-red-600 transition-colors"
                  >
                    <Trash2 size={16} />
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}

        {!loadingLists && lists.length === 0 && (
          <p className="text-sm font-bold text-gray-400">
            Nenhuma lista ainda. Crie atalhos por função (ex.: "Cozinha", "Salão") para chamar o time
            inteiro de uma vez ao abrir um turno.
          </p>
        )}
      </section>

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

      {/* Modal Nova Lista / Editar Lista (F2) */}
      {(showListModal || editingList) && (
        <TeamListModal
          list={editingList}
          teamMembers={teamMembers}
          onClose={() => {
            setShowListModal(false);
            setEditingList(null);
          }}
          onSaved={() => void refreshLists()}
        />
      )}

      {/* Modal de Confirmação de Exclusão de Lista (F2/R7) */}
      {deletingList && (
        <div
          className="fixed inset-0 z-50 bg-black/50 backdrop-blur-sm flex items-center justify-center p-4 animate-in fade-in duration-200"
          onClick={(e) => {
            if (e.target === e.currentTarget && !isDeletingList) setDeletingList(null);
          }}
        >
          <div className="bg-white rounded-2xl border-2 border-black shadow-[8px_8px_0px_0px_rgba(0,0,0,1)] w-full max-w-sm p-6 text-center">
            <div className="w-12 h-12 rounded-full bg-red-100 border-2 border-red-300 text-red-600 flex items-center justify-center mx-auto mb-4">
              <AlertTriangle size={24} />
            </div>
            <h3 className="text-xl font-black uppercase mb-2">Excluir Lista?</h3>
            <p className="text-sm font-bold text-gray-600 mb-2">
              Tem certeza que deseja excluir <span className="text-black font-black">{deletingList.name}</span>?
            </p>
            <p className="text-xs font-bold text-gray-400 mb-6">
              Excluir esta lista não remove ninguém do Elenco.
            </p>
            <div className="flex gap-3">
              <button
                onClick={() => setDeletingList(null)}
                disabled={isDeletingList}
                className="flex-1 bg-gray-100 hover:bg-gray-200 text-black py-3 rounded-xl font-black uppercase text-xs transition-colors disabled:opacity-50"
              >
                Cancelar
              </button>
              <button
                onClick={() => void handleConfirmDeleteList()}
                disabled={isDeletingList}
                className="flex-1 bg-red-600 hover:bg-red-700 text-white py-3 rounded-xl font-black uppercase text-xs transition-colors flex items-center justify-center gap-1.5 disabled:opacity-50"
              >
                {isDeletingList ? <Loader2 size={16} className="animate-spin" /> : <Trash2 size={16} />}
                {isDeletingList ? 'Excluindo...' : 'Excluir'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
