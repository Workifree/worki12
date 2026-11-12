import { useState, useEffect, useCallback } from 'react';
import { Users, Clock, UserPlus, ListChecks, Plus, Pencil, Trash2, AlertTriangle, Link2, Copy, Check } from 'lucide-react';
import { useCompanyTeam } from '../../hooks/useTeamConnections';
import { supabase } from '../../lib/supabase';
import { logError } from '../../lib/logger';
import { useToast } from '../../contexts/ToastContext';
import { TeamListService } from '../../services/teamListService';
import { TeamConnectionService } from '../../services/teamConnectionService';
import type { TeamMember, TeamListWithMembers } from '../../types';
import { MemberCard } from '../../components/team/MemberCard';
import { PendingCard } from '../../components/team/PendingCard';
import { AddWorkerModal } from '../../components/team/AddWorkerModal';
import { InviteToShiftModal } from '../../components/team/InviteToShiftModal';
import { RemoveMemberDialog } from '../../components/team/RemoveMemberDialog';
import { TeamListModal } from '../../components/team/TeamListModal';
import type { WorkerHistoryWithCompany } from '../../components/team/types';
import { Button, Card, PageHeader } from '../../components/ui';

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
  const [linkCopied, setLinkCopied] = useState(false);
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

  // Link do elenco: mesmo caminho do Perfil Empresa (token estável via serviço, falha tratada).
  const handleCopyTeamLink = async () => {
    if (!companyId) return;
    const gerado = await TeamConnectionService.generateInviteToken(companyId);
    if (!gerado) {
      addToast('Não foi possível obter o link do seu elenco agora.', 'error');
      return;
    }
    try {
      await navigator.clipboard.writeText(gerado.url);
      setLinkCopied(true);
      addToast('Link copiado! Envie para um freela ser adicionado ao seu elenco.', 'success');
      setTimeout(() => setLinkCopied(false), 2500);
    } catch {
      addToast('Não foi possível copiar o link.', 'error');
    }
  };

  if (loading) {
    return (
      <div className="max-w-4xl mx-auto space-y-6 animate-pulse pb-20">
        <div className="h-9 bg-gray-200 rounded-xl w-48" />
        <div className="h-11 bg-gray-200 rounded-xl w-40" />
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
      <PageHeader
        title="Meu Elenco"
        subtitle={`${teamMembers.length} freela${teamMembers.length !== 1 ? 's' : ''} no elenco${
          pendingConnections.length > 0 ? ` · ${pendingConnections.length} aguardando aceite` : ''
        }`}
        action={
          <Button variant="dark" size="md" onClick={() => setShowAddModal(true)} iconLeft={<UserPlus size={18} aria-hidden="true" />}>
            Adicionar Freela
          </Button>
        }
      />

      {/* Link do elenco — antes só existia dentro do Perfil Empresa. Discreto: secundário, sem competir com a ação principal. */}
      <Card as="section" padding="sm" aria-label="Link do elenco" className="mb-8 flex flex-col sm:flex-row sm:items-center gap-3">
        <div className="flex-1 min-w-0">
          <p className="font-bold text-sm flex items-center gap-2"><Link2 size={16} aria-hidden="true" /> Link do seu elenco</p>
          <p className="text-xs text-gray-600 mt-1">
            Mande por WhatsApp: o freela abre o link e entra no seu elenco.
          </p>
        </div>
        <Button
          variant="secondary"
          size="md"
          onClick={handleCopyTeamLink}
          disabled={!companyId}
          iconLeft={linkCopied ? <Check size={16} aria-hidden="true" /> : <Copy size={16} aria-hidden="true" />}
        >
          {linkCopied ? 'Link copiado!' : 'Copiar link'}
        </Button>
      </Card>

      {/* Elenco aceito */}
      {teamMembers.length > 0 && (
        <section className="mb-8">
          <h2 className="text-lg font-bold mb-4 flex items-center gap-2">
            <Users size={20} aria-hidden="true" /> Elenco ativo
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
          <h2 className="text-lg font-bold flex items-center gap-2">
            <ListChecks size={20} aria-hidden="true" /> Listas do elenco
          </h2>
          <Button variant="secondary" size="md" onClick={() => setShowListModal(true)} iconLeft={<Plus size={16} aria-hidden="true" />}>
            Nova lista
          </Button>
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
              <Card
                key={list.id}
                padding="sm"
                className="flex items-center justify-between gap-3"
              >
                <div className="min-w-0">
                  <p className="font-bold truncate">{list.name}</p>
                  <p className="text-xs text-gray-600">
                    {list.memberIds.length} {list.memberIds.length === 1 ? 'membro' : 'membros'}
                  </p>
                </div>
                <div className="flex gap-1 shrink-0">
                  <button
                    type="button"
                    onClick={() => setEditingList(list)}
                    aria-label={`Editar lista ${list.name}`}
                    className="h-11 w-11 inline-flex items-center justify-center rounded-xl hover:bg-gray-100 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-black"
                  >
                    <Pencil size={16} aria-hidden="true" />
                  </button>
                  <button
                    type="button"
                    onClick={() => setDeletingList(list)}
                    aria-label={`Excluir lista ${list.name}`}
                    className="h-11 w-11 inline-flex items-center justify-center rounded-xl hover:bg-red-50 text-red-600 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-black"
                  >
                    <Trash2 size={16} aria-hidden="true" />
                  </button>
                </div>
              </Card>
            ))}
          </div>
        )}

        {!loadingLists && lists.length === 0 && (
          <p className="text-sm text-gray-600">
            Nenhuma lista ainda. Crie atalhos por função (ex.: "Cozinha", "Salão") para chamar o time
            inteiro de uma vez ao abrir um turno.
          </p>
        )}
      </section>

      {/* Convites pendentes */}
      {pendingConnections.length > 0 && (
        <section className="mb-8">
          <h2 className="text-lg font-bold mb-4 flex items-center gap-2 text-yellow-700">
            <Clock size={20} aria-hidden="true" /> Aguardando aceite
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
        <div className="text-center py-16 px-4 border-2 border-dashed border-gray-300 rounded-2xl bg-gray-50">
          <Users size={44} className="mx-auto mb-4 text-gray-300" aria-hidden="true" />
          <h3 className="text-lg font-bold mb-2">Elenco vazio</h3>
          <p className="text-sm text-gray-600 mb-6 max-w-sm mx-auto">
            Adicione freelas pelo QR de identidade, Worki ID ou pelo link de perfil que eles te enviarem.
            Eles aparecerão aqui após aceitarem.
          </p>
          <Button variant="dark" size="lg" onClick={() => setShowAddModal(true)} iconLeft={<UserPlus size={18} aria-hidden="true" />}>
            Adicionar primeiro freela
          </Button>
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
          <div role="dialog" aria-modal="true" aria-labelledby="delete-list-title" className="bg-white rounded-2xl border-2 border-black shadow-[6px_6px_0px_0px_rgba(0,0,0,1)] w-full max-w-sm p-6 text-center">
            <div className="w-12 h-12 rounded-full bg-red-100 border-2 border-red-300 text-red-600 flex items-center justify-center mx-auto mb-4">
              <AlertTriangle size={24} />
            </div>
            <h3 id="delete-list-title" className="text-lg font-bold mb-2">Excluir lista?</h3>
            <p className="text-sm text-gray-600 mb-2">
              Tem certeza que deseja excluir <span className="text-black font-bold">{deletingList.name}</span>?
            </p>
            <p className="text-xs text-gray-600 mb-6">
              Excluir esta lista não remove ninguém do Elenco.
            </p>
            <div className="flex gap-3">
              <Button variant="secondary" fullWidth onClick={() => setDeletingList(null)} disabled={isDeletingList}>
                Cancelar
              </Button>
              <Button
                variant="danger"
                fullWidth
                loading={isDeletingList}
                onClick={() => void handleConfirmDeleteList()}
                iconLeft={<Trash2 size={16} aria-hidden="true" />}
              >
                {isDeletingList ? 'Excluindo...' : 'Excluir'}
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
