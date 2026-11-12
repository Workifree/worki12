import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Check, Star, Briefcase, Wallet, Copy, Send, History, Share2, Trash2 } from 'lucide-react';
import { useToast } from '../../contexts/ToastContext';
import { TeamConnectionService } from '../../services/teamConnectionService';
import type { TeamMember } from '../../types';
import type { WorkerHistoryWithCompany } from './types';
import { Button, Card } from '../ui';
import { formatHistoryDate } from './utils';

// ---------------------------------------------------------------------------
// Subcomponent: card de membro da equipe
// ---------------------------------------------------------------------------

export interface MemberCardProps {
  member: TeamMember;
  onRemove: (member: TeamMember) => void;
  /** Histórico de turnos concluídos com ESTA empresa (batch, sem N+1). */
  history?: WorkerHistoryWithCompany;
  /** Abre o modal "Convidar para turno" para este freela. */
  onInvite: (member: TeamMember) => void;
}

export function MemberCard({ member, onRemove, history, onInvite }: MemberCardProps) {
  const { worker } = member;
  const avatarUrl = worker.avatar_url ?? worker.photo_url ?? null;
  const { addToast } = useToast();
  const navigate = useNavigate();
  const [linkCopied, setLinkCopied] = useState(false);
  const [pixCopied, setPixCopied] = useState(false);

  // Link transitivo: já tenho esse freela no elenco → posso repassar o link
  // dele pra outra empresa se conectar, sem pedir de novo ao freela.
  const handleShareLink = async () => {
    const { url } = TeamConnectionService.generateWorkerInviteToken(worker.id);
    try {
      await navigator.clipboard.writeText(url);
      setLinkCopied(true);
      addToast('Link do freela copiado! Repasse para outra empresa.', 'success');
      setTimeout(() => setLinkCopied(false), 2500);
    } catch {
      addToast('Não foi possível copiar o link.', 'error');
    }
  };

  // R1.3: chave PIX do freela — para a empresa pagar por fora (modo A) sem sair do app.
  const handleCopyPix = async () => {
    if (!worker.pix_key) return;
    try {
      await navigator.clipboard.writeText(worker.pix_key);
      setPixCopied(true);
      addToast('Chave PIX copiada!', 'success');
      setTimeout(() => setPixCopied(false), 2500);
    } catch {
      addToast('Não foi possível copiar a chave PIX.', 'error');
    }
  };

  // R5: card clicável → abre o perfil do freela. Botões internos usam
  // e.stopPropagation() para não disparar a navegação do card.
  const goToProfile = () => navigate(`/company/worker/${worker.id}`);

  return (
    <Card
      interactive
      role="button"
      tabIndex={0}
      onClick={goToProfile}
      onKeyDown={(e) => {
        // Só o próprio card ativa a navegação: Enter/Espaço num botão interno
        // não pode borbulhar e ter a ação cancelada pelo preventDefault.
        if (e.target !== e.currentTarget) return;
        if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); goToProfile(); }
      }}
      className="flex flex-col gap-4 cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-black focus-visible:ring-offset-2"
    >
      <div className="flex items-start gap-4">
        {/* Avatar */}
        <div className="w-14 h-14 rounded-xl border-2 border-black overflow-hidden bg-gray-100 flex-shrink-0">
          {avatarUrl ? (
            <img src={avatarUrl} alt={worker.full_name} className="w-full h-full object-cover" />
          ) : (
            <div className="w-full h-full flex items-center justify-center bg-black text-white font-bold text-xl">
              {worker.full_name?.[0]?.toUpperCase() ?? '?'}
            </div>
          )}
        </div>

        {/* Info */}
        <div className="flex-1 min-w-0">
          <h3 className="font-bold text-base truncate">{worker.full_name}</h3>
          {worker.primary_role && (
            <p className="text-sm text-gray-600 truncate">{worker.primary_role}</p>
          )}
          <div className="flex flex-wrap gap-2 mt-2">
            {typeof worker.rating_average === 'number' && (
              <span className="flex items-center gap-1 text-xs font-semibold bg-yellow-50 text-yellow-700 px-2.5 py-1 rounded-pill">
                <Star size={12} fill="currentColor" /> {worker.rating_average.toFixed(1)}
              </span>
            )}
            {typeof worker.completed_jobs_count === 'number' && (
              <span className="flex items-center gap-1 text-xs font-semibold bg-gray-100 text-gray-700 px-2.5 py-1 rounded-pill">
                <Briefcase size={12} /> {worker.completed_jobs_count}{' '}
                {worker.completed_jobs_count === 1 ? 'turno no total' : 'turnos no total'}
              </span>
            )}
            {worker.city && (
              <span className="text-xs font-semibold bg-blue-50 text-blue-700 px-2.5 py-1 rounded-pill">
                {worker.city}
              </span>
            )}
            {/* Histórico com esta empresa — o dado que ajuda a decidir "chamo esse ou outro?". */}
            {history && history.count > 0 ? (
              <span className="flex items-center gap-1 text-xs font-semibold bg-primary-light text-primary px-2.5 py-1 rounded-pill">
                <History size={12} /> {history.count} turno{history.count !== 1 ? 's' : ''} com você
                {history.lastDate ? ` · último em ${formatHistoryDate(history.lastDate)}` : ''}
              </span>
            ) : (
              <span className="flex items-center gap-1 text-xs font-semibold bg-gray-100 text-gray-500 px-2.5 py-1 rounded-pill">
                <History size={12} /> Nenhum turno ainda com você
              </span>
            )}
          </div>

          {/* R1.3: chave PIX — bloco com botão de copiar, pra empresa pagar por fora */}
          {worker.pix_key && (
            <div
              onClick={(e) => e.stopPropagation()}
              className="flex items-center justify-between gap-2 mt-3 bg-gray-50 border border-gray-200 rounded-xl pl-3 pr-1 py-1 max-w-sm"
            >
              <span className="flex items-center gap-2 text-xs text-gray-700 min-w-0">
                <Wallet size={14} className="flex-shrink-0 text-gray-500" />
                <span className="truncate">{worker.pix_key}</span>
              </span>
              <Button
                variant="ghost"
                onClick={(e) => { e.stopPropagation(); void handleCopyPix(); }}
                aria-label={`Copiar chave PIX de ${worker.full_name}`}
                title="Copiar chave PIX"
                className="h-11 w-11 !px-0 flex-shrink-0"
              >
                {pixCopied ? <Check size={14} /> : <Copy size={14} />}
              </Button>
            </div>
          )}
        </div>
      </div>

      {/* Ação principal (convidar para turno) + ações secundárias só-ícone na mesma linha:
          uma ação primária por card, o resto não compete com ela. */}
      <div className="border-t-2 border-gray-100 pt-4 flex items-center gap-2">
        <Button
          variant="dark"
          fullWidth
          onClick={(e) => { e.stopPropagation(); onInvite(member); }}
          iconLeft={<Send size={16} />}
        >
          Convidar para turno
        </Button>
        <Button
          variant="secondary"
          onClick={(e) => { e.stopPropagation(); void handleShareLink(); }}
          aria-label={`Repassar link do freela ${worker.full_name}`}
          title="Repassar link deste freela para outra empresa"
          className="h-11 w-11 !px-0 flex-shrink-0"
        >
          {linkCopied ? <Check size={16} /> : <Share2 size={16} />}
        </Button>
        <Button
          variant="secondary"
          onClick={(e) => { e.stopPropagation(); onRemove(member); }}
          aria-label={`Remover freela ${worker.full_name} do elenco`}
          title="Remover este freela do seu elenco"
          className="h-11 w-11 !px-0 flex-shrink-0 !text-red-600"
        >
          <Trash2 size={16} />
        </Button>
      </div>
    </Card>
  );
}
