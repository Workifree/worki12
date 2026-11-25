import { Trash2 } from 'lucide-react';
import type { TeamMember } from '../../types';
import { Button, DialogActions, DialogHeader } from '../ui';
import { Dialog } from '../ui/Dialog';

// ---------------------------------------------------------------------------
// Subcomponent: modal de confirmação de remoção de um membro do elenco
// ---------------------------------------------------------------------------

export interface RemoveMemberDialogProps {
  member: TeamMember;
  isDeleting: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}

export function RemoveMemberDialog({ member, isDeleting, onCancel, onConfirm }: RemoveMemberDialogProps) {

  return (
    <Dialog
        role="alertdialog"
        labelledBy="remove-member-title"
        onClose={onCancel}
        locked={isDeleting}
        className="max-w-sm"
    >
        <DialogHeader titleId="remove-member-title" title="Remover do Elenco?" />
        <p className="text-sm text-gray-600">
          Tem certeza que deseja remover <span className="text-black font-bold">{member.worker.full_name}</span> do seu elenco? Você poderá convidá-lo novamente depois.
        </p>
        <DialogActions>
          <Button variant="secondary" data-autofocus onClick={onCancel} disabled={isDeleting}>
            Voltar
          </Button>
          <Button
            variant="danger"
            onClick={onConfirm}
            loading={isDeleting}
            iconLeft={<Trash2 size={16} />}
          >
            {isDeleting ? 'Removendo...' : 'Remover'}
          </Button>
        </DialogActions>
    </Dialog>
  );
}
