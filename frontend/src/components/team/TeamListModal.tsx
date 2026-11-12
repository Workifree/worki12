import { useState, useMemo } from 'react';
import { useModalDismiss } from '../../hooks/useModalDismiss';
import { ListChecks, Search, Check } from 'lucide-react';
import { useToast } from '../../contexts/ToastContext';
import { TeamListService } from '../../services/teamListService';
import type { TeamMember, TeamListWithMembers } from '../../types';
import { ModalShell } from './ModalShell';
import { Button, Field } from '../ui';

// ---------------------------------------------------------------------------
// Modal "Nova lista" / "Editar lista" (F2 — Listas salvas do elenco).
//
// Mesmo modal para criar e editar: se `list` vier preenchido, é edição
// (pré-carrega nome + membros já marcados); se vier `null`/`undefined`, é
// criação. Reaproveita o padrão visual de busca + checklist do
// `ShiftCallModal` (busca por nome/função, checkbox + avatar + nome + função)
// — a mesma gramática que o gerente já usa pra chamar turno, agora pra
// organizar o elenco em grupos por função ("Cozinha", "Salão", "Chapa").
//
// Salvar com zero membros marcados é válido (R6) — a lista pode nascer vazia
// e ser preenchida depois.
// ---------------------------------------------------------------------------

export interface TeamListModalProps {
  /** `null`/`undefined` = modo criação. Preenchido = modo edição. */
  list?: TeamListWithMembers | null;
  /** Elenco aceito da empresa — já carregado pela página, sem query extra. */
  teamMembers: TeamMember[];
  onClose: () => void;
  onSaved: () => void;
}

export function TeamListModal({ list, teamMembers, onClose, onSaved }: TeamListModalProps) {
  const { addToast } = useToast();
  const isEditing = Boolean(list);
  const [name, setName] = useState(list?.name ?? '');
  const [selected, setSelected] = useState<Set<string>>(new Set(list?.memberIds ?? []));
  const [search, setSearch] = useState('');
  const [saving, setSaving] = useState(false);
    // ESC com a mesma guarda do clique no fundo: nunca fechar no meio de uma gravacao.
    useModalDismiss(() => { if (!saving) onClose(); });

  const visible = useMemo(() => {
    const term = search.trim().toLowerCase();
    if (!term) return teamMembers;
    return teamMembers.filter((member) => {
      const memberName = (member.worker.full_name ?? '').toLowerCase();
      const role = (member.worker.primary_role ?? '').toLowerCase();
      return memberName.includes(term) || role.includes(term);
    });
  }, [teamMembers, search]);

  const toggle = (workerId: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(workerId)) next.delete(workerId);
      else next.add(workerId);
      return next;
    });
  };

  const trimmedName = name.trim();
  const canSave = trimmedName.length > 0 && !saving;

  const handleSave = async () => {
    if (!canSave) return;
    setSaving(true);
    const workerIds = Array.from(selected);

    if (isEditing && list) {
      if (trimmedName !== list.name) {
        const renameResult = await TeamListService.renameList(list.id, trimmedName);
        if (!renameResult.success) {
          setSaving(false);
          addToast(renameResult.error ?? 'Não foi possível renomear a lista.', 'error');
          return;
        }
      }
      const membersResult = await TeamListService.setMembers(list.id, workerIds);
      setSaving(false);
      if (!membersResult.success) {
        addToast(membersResult.error ?? 'Não foi possível atualizar os membros da lista.', 'error');
        // O rename (se houve) já foi persistido no banco — e `setMembers` pode ter avançado
        // parte do diff antes de falhar. Reconcilia o pai com o banco mesmo no erro (o modal
        // continua aberto pro usuário tentar de novo); sem isso o card ficaria mostrando o
        // nome/membros antigos enquanto o banco já mudou por baixo.
        onSaved();
        return;
      }
      addToast('Lista atualizada.', 'success');
      onSaved();
      onClose();
      return;
    }

    const result = await TeamListService.createList(trimmedName, workerIds);
    setSaving(false);
    if (!result.list) {
      addToast(result.error ?? 'Não foi possível criar a lista.', 'error');
      return;
    }
    addToast('Lista criada.', 'success');
    onSaved();
    onClose();
  };


  return (
    <ModalShell
      title={
        <>
          <ListChecks size={20} /> {isEditing ? 'Editar Lista' : 'Nova Lista'}
        </>
      }
      subtitle="Agrupe freelas do elenco para chamar todos de uma vez em um turno."
      onClose={onClose}
      locked={saving}
      size="lg"
      footer={
        <Button
          variant="dark"
          size="lg"
          fullWidth
          onClick={() => void handleSave()}
          disabled={!canSave}
          loading={saving}
          iconLeft={<Check size={18} />}
        >
          {saving
            ? 'Salvando...'
            : `Salvar${selected.size > 0 ? ` (${selected.size} membro${selected.size !== 1 ? 's' : ''})` : ''}`}
        </Button>
      }
    >
      {/* Nome da lista */}
      <Field label="Nome da lista" className="mb-5">
        <input
          id="list-name"
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Ex.: Cozinha, Salão, Chapa"
          disabled={saving}
          maxLength={60}
        />
      </Field>

      {/* Busca */}
      <div className="relative mb-3">
        <label htmlFor="team-list-search" className="sr-only">
          Buscar por nome ou função
        </label>
        <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500" />
        <input
          id="team-list-search"
          type="text"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Buscar por nome ou função"
          disabled={saving}
          className="w-full h-11 border-2 border-gray-300 focus:border-black rounded-xl pl-9 pr-3 text-sm outline-none transition-colors disabled:opacity-50"
        />
      </div>

      {/* Checklist do elenco */}
      {teamMembers.length === 0 && (
        <div className="text-center py-8 px-4 border-2 border-dashed border-gray-300 rounded-2xl text-gray-600">
          <ListChecks size={32} className="mx-auto mb-2 text-gray-400" />
          <p className="font-semibold text-sm">Nenhum freela aceito no elenco ainda.</p>
          <p className="text-xs mt-1">Você pode salvar a lista vazia e adicionar membros depois.</p>
        </div>
      )}

      {teamMembers.length > 0 && visible.length === 0 && (
        <p className="text-center py-6 text-sm text-gray-600">
          Nenhum freela encontrado para "{search}".
        </p>
      )}

      {visible.map((member) => {
        const isSelected = selected.has(member.worker.id);
        return (
          <label
            key={member.worker.id}
            className={`flex items-center gap-3 min-h-14 p-3 mb-2 rounded-xl border-2 cursor-pointer transition-colors ${
              isSelected ? 'border-black bg-primary-light' : 'border-gray-200 hover:border-black'
            }`}
          >
            <input
              type="checkbox"
              checked={isSelected}
              onChange={() => toggle(member.worker.id)}
              disabled={saving}
              className="w-5 h-5 accent-black flex-shrink-0"
            />
            <div className="w-9 h-9 rounded-xl border-2 border-black overflow-hidden bg-gray-100 flex-shrink-0">
              {member.worker.avatar_url ? (
                <img
                  src={member.worker.avatar_url}
                  alt={member.worker.full_name ?? ''}
                  className="w-full h-full object-cover"
                />
              ) : (
                <div className="w-full h-full flex items-center justify-center text-xs font-bold text-gray-500">
                  {(member.worker.full_name ?? '?').charAt(0).toUpperCase()}
                </div>
              )}
            </div>
            <div className="min-w-0 flex-1">
              <p className="font-bold text-sm truncate">{member.worker.full_name}</p>
              {member.worker.primary_role && (
                <p className="text-xs text-gray-600 truncate">
                  {member.worker.primary_role}
                </p>
              )}
            </div>
          </label>
        );
      })}
    </ModalShell>
  );
}
