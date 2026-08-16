import { Loader2, AlertTriangle, Trash2 } from 'lucide-react';
import type { TeamMember } from '../../types';

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
    <div
      className="fixed inset-0 z-50 bg-black/50 backdrop-blur-sm flex items-center justify-center p-4 animate-in fade-in duration-200"
      onClick={(e) => { if (e.target === e.currentTarget && !isDeleting) onCancel(); }}
    >
      <div className="bg-white rounded-2xl border-2 border-black shadow-[8px_8px_0px_0px_rgba(0,0,0,1)] w-full max-w-sm p-6 text-center">
        <div className="w-12 h-12 rounded-full bg-red-100 border-2 border-red-300 text-red-600 flex items-center justify-center mx-auto mb-4">
          <AlertTriangle size={24} />
        </div>
        <h3 className="text-xl font-black uppercase mb-2">Remover do Elenco?</h3>
        <p className="text-sm font-bold text-gray-600 mb-6">
          Tem certeza que deseja remover <span className="text-black font-black">{member.worker.full_name}</span> do seu elenco? Você poderá convidá-lo novamente depois.
        </p>
        <div className="flex gap-3">
          <button
            onClick={onCancel}
            disabled={isDeleting}
            className="flex-1 bg-gray-100 hover:bg-gray-200 text-black py-3 rounded-xl font-black uppercase text-xs transition-colors disabled:opacity-50"
          >
            Cancelar
          </button>
          <button
            onClick={onConfirm}
            disabled={isDeleting}
            className="flex-1 bg-red-600 hover:bg-red-700 text-white py-3 rounded-xl font-black uppercase text-xs transition-colors flex items-center justify-center gap-1.5 disabled:opacity-50"
          >
            {isDeleting ? <Loader2 size={16} className="animate-spin" /> : <Trash2 size={16} />}
            {isDeleting ? 'Removendo...' : 'Remover'}
          </button>
        </div>
      </div>
    </div>
  );
}
