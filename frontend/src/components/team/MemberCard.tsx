import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Check, Star, Briefcase, Wallet, Copy, Send, History, Share2, Trash2 } from 'lucide-react';
import { useToast } from '../../contexts/ToastContext';
import { TeamConnectionService } from '../../services/teamConnectionService';
import type { TeamMember } from '../../types';
import type { WorkerHistoryWithCompany } from './types';
import { Button, Card, IconButton, Menu } from '../ui';
import { formatHistoryDate } from './utils';
import { roleLabel } from '../../lib/statusLabels';

// ---------------------------------------------------------------------------
// Subcomponent: card de membro da equipe
// ---------------------------------------------------------------------------

export interface MemberCardProps {
  member: TeamMember;
  onRemove: (member: TeamMember) => void;
  /**
   * Modo do Encarregado: só ver e convidar para turno. Sem remover, repassar link, histórico da
   * empresa (seriam turnos alheios) nem abrir o perfil (leitura de PII que ele não tem).
   */
  restricted?: boolean;
  /** Histórico de turnos concluídos com ESTA empresa (batch, sem N+1). */
  history?: WorkerHistoryWithCompany;
  /** A consulta do histórico falhou: não afirmar "nenhum turno". */
  historyUnavailable?: boolean;
  /** A consulta ainda não voltou: não afirmar "nenhum turno". */
  historyLoading?: boolean;
  /** Abre o modal "Convidar para turno" para este freela. */
  onInvite: (member: TeamMember) => void;
}

export function MemberCard({ member, onRemove, history, historyUnavailable = false, historyLoading = false, onInvite, restricted = false }: MemberCardProps) {
  const { worker } = member;
  const avatarUrl = worker.avatar_url ?? worker.photo_url ?? null;
  const { addToast } = useToast();
  const navigate = useNavigate();
  const [pixCopied, setPixCopied] = useState(false);

  // Link transitivo: já tenho esse freela no elenco → posso repassar o link
  // dele pra outra empresa se conectar, sem pedir de novo ao freela.
  const handleShareLink = async () => {
    const { url } = TeamConnectionService.generateWorkerInviteToken(worker.id);
    try {
      await navigator.clipboard.writeText(url);
      addToast('Link do freela copiado! Repasse para outra empresa.', 'success');
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
      padding="sm"
      onActivate={restricted ? undefined : goToProfile}
      className="flex flex-col gap-3"
    >
      <div className="flex items-start gap-3">
        {/* Avatar */}
        <div className="w-12 h-12 rounded-xl border-2 border-black overflow-hidden bg-gray-100 flex-shrink-0">
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
            <p className="text-sm text-gray-600 truncate">{roleLabel(worker.primary_role)}</p>
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
            {restricted || historyUnavailable ? null : history && history.count > 0 ? (
              <span className="flex items-center gap-1 text-xs font-semibold bg-primary-light text-primary-dark px-2.5 py-1 rounded-pill">
                <History size={12} /> {history.count} turno{history.count !== 1 ? 's' : ''} com você
                {history.lastDate ? ` · último em ${formatHistoryDate(history.lastDate)}` : ''}
              </span>
            ) : (
              <span className="flex items-center gap-1 text-xs font-semibold bg-gray-100 text-gray-600 px-2.5 py-1 rounded-pill">
                <History size={12} /> {historyLoading ? 'Carregando histórico...' : 'Nenhum turno ainda com você'}
              </span>
            )}
          </div>

          {/* R1.3: chave PIX — bloco com botão de copiar, pra empresa pagar por fora */}
          {/* Modo restrito (encarregado) não lê PII: nada de campo PIX, nem vazio. */}
          {!restricted && worker.pix_key?.trim() && (
            <div
              data-copilot-private
              onClick={(e) => e.stopPropagation()}
              className="flex items-center justify-between gap-2 mt-3 bg-gray-50 border border-gray-200 rounded-xl pl-3 pr-1 py-1 max-w-sm"
            >
              <span className="flex items-center gap-2 text-xs text-gray-700 min-w-0">
                <Wallet size={14} className="flex-shrink-0 text-gray-500" />
                <span className="truncate">{worker.pix_key}</span>
              </span>
              <IconButton
                onClick={(e) => { e.stopPropagation(); void handleCopyPix(); }}
                aria-label={`Copiar chave PIX de ${worker.full_name}`}
                title="Copiar chave PIX"
              >
                {pixCopied ? <Check size={14} /> : <Copy size={14} />}
              </IconButton>
            </div>
          )}
        </div>
      </div>

      {/* Uma ação por card; repassar link e remover ficam no menu, longe do toque principal. */}
      <div className="flex items-center gap-2 border-t border-gray-200 pt-3">
        <Button
          variant="secondary"
          className="flex-1 sm:flex-none"
          onClick={(e) => { e.stopPropagation(); onInvite(member); }}
          iconLeft={<Send size={16} />}
          data-copilot="empresa.elenco.convidar-turno"
        >
          Convidar para turno
        </Button>
        {!restricted && (
          <Menu
            className="ml-auto"
            label={`Mais opções de ${worker.full_name}`}
            items={[
              { label: 'Copiar link para outra empresa', icon: Share2, onSelect: () => void handleShareLink() },
              // Destrutivo por último; a confirmação é o RemoveMemberDialog.
              { label: 'Remover do elenco', icon: Trash2, onSelect: () => onRemove(member), danger: true },
            ]}
          />
        )}
      </div>
    </Card>
  );
}
