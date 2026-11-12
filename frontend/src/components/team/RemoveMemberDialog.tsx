import { AlertTriangle, Trash2 } from 'lucide-react';
import { useModalDismiss } from '../../hooks/useModalDismiss';
import type { TeamMember } from '../../types';
import { Button } from '../ui';

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
  // ESC com a mesma guarda do clique no fundo: nao fechar durante a remocao.
  useModalDismiss(() => { if (!isDeleting) onCancel(); });

  return (
    <div
      className="fixed inset-0 z-50 bg-black/50 backdrop-blur-sm flex items-center justify-center p-4 animate-in fade-in duration-200"
      onClick={(e) => { if (e.target === e.currentTarget && !isDeleting) onCancel(); }}
    >
      <div
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="remove-member-title"
        className="bg-white rounded-2xl border-2 border-black shadow-[6px_6px_0px_0px_rgba(0,0,0,1)] w-full max-w-sm p-6 text-center"
      >
        <div className="w-12 h-12 rounded-full bg-red-100 border-2 border-red-300 text-red-600 flex items-center justify-center mx-auto mb-4">
          <AlertTriangle size={24} />
        </div>
        <h3 id="remove-member-title" className="text-xl font-bold mb-2">Remover do Elenco?</h3>
        <p className="text-sm text-gray-600 mb-6">
          Tem certeza que deseja remover <span className="text-black font-bold">{member.worker.full_name}</span> do seu elenco? Você poderá convidá-lo novamente depois.
        </p>
        <div className="flex flex-col-reverse sm:flex-row gap-3">
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
      </div>
    </div>
  );
}
