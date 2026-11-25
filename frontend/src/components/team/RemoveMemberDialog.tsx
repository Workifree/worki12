import { AlertTriangle, Trash2 } from 'lucide-react';
import type { TeamMember } from '../../types';
import { Button } from '../ui';
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
        className="max-w-sm text-center"
    >
        <div className="w-12 h-12 rounded-full bg-red-100 border-2 border-red-300 text-red-600 flex items-center justify-center mx-auto mb-4">
          <AlertTriangle size={24} />
        </div>
        <h3 id="remove-member-title" className="text-xl font-bold mb-2">Remover do Elenco?</h3>
        <p className="text-sm text-gray-600 mb-6">
          Tem certeza que deseja remover <span className="text-black font-bold">{member.worker.full_name}</span> do seu elenco? Você poderá convidá-lo novamente depois.
        </p>
        <div className="worki-dialog-actions flex flex-col-reverse sm:flex-row gap-3">
          <Button variant="secondary" fullWidth onClick={onCancel} disabled={isDeleting}>
            Cancelar
          </Button>
          <Button
            variant="danger"
            fullWidth
            onClick={onConfirm}
            loading={isDeleting}
            iconLeft={<Trash2 size={16} />}
          >
            {isDeleting ? 'Removendo...' : 'Remover'}
          </Button>
        </div>
    </Dialog>
  );
}
