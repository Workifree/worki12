import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Check, Briefcase, Wallet, Copy, Send, Share2, Trash2 } from 'lucide-react';
import { useToast } from '../../contexts/ToastContext';
import { TeamConnectionService } from '../../services/teamConnectionService';
import type { TeamMember } from '../../types';
import type { WorkerHistoryWithCompany } from './types';
import { Button, IconButton, Menu } from '../ui';
import { cx } from '../ui/cx';
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

  // Mesmo comportamento do antigo card clicável: linha inteira abre o perfil, controles internos não.
  const INTERNO = 'button,a,input,[role="menu"],[role="menuitem"]';
  const ativar = restricted
    ? undefined
    : (e: React.MouseEvent<HTMLLIElement>) => {
        if ((e.target as HTMLElement).closest(INTERNO)) return;
        goToProfile();
      };

  const historico = restricted || historyUnavailable
    ? null
    : history && history.count > 0
      ? `${history.count} turno${history.count !== 1 ? 's' : ''} com você${history.lastDate ? ` · último em ${formatHistoryDate(history.lastDate)}` : ''}`
      : historyLoading ? 'Carregando histórico...' : 'Nenhum turno ainda com você';

  return (
    // Linha de lista (≈64-72px): avatar, nome, uma linha de contexto; uma ação visível + menu.
    <li
      onClick={ativar}
      className={cx('flex min-h-16 items-center gap-3 px-4 py-3', !restricted && 'cursor-pointer hover:bg-gray-50')}
    >
      <div className="h-10 w-10 flex-shrink-0 overflow-hidden rounded-full bg-gray-100">
        {avatarUrl ? (
          <img src={avatarUrl} alt="" className="h-full w-full object-cover" />
        ) : (
          <div aria-hidden="true" className="flex h-full w-full items-center justify-center bg-gray-900 text-sm font-bold text-white">
            {worker.full_name?.[0]?.toUpperCase() ?? '?'}
          </div>
        )}
      </div>

      <div className="min-w-0 flex-1">
        {restricted ? (
          <h3 className="line-clamp-2 text-sm font-semibold text-gray-900 [overflow-wrap:anywhere]">{worker.full_name}</h3>
        ) : (
          <h3 className="text-sm font-semibold text-gray-900">
            {/* Alvo de 44px na largura inteira da coluna; nome quebra em até 2 linhas em vez de cortar. */}
            <button
              type="button"
              onClick={goToProfile}
              className="flex min-h-11 w-full items-center rounded text-left hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-black"
            >
              <span className="line-clamp-2 [overflow-wrap:anywhere]">{worker.full_name}</span>
            </button>
          </h3>
        )}
        <p className="truncate text-xs text-gray-600 sm:text-sm">
          {[
            worker.primary_role ? roleLabel(worker.primary_role) : null,
            typeof worker.rating_average === 'number' ? `★ ${worker.rating_average.toFixed(1)}` : null,
          ].filter(Boolean).join(' · ')}
          {historico && (
            <>
              {(worker.primary_role || typeof worker.rating_average === 'number') && ' · '}
              <span className={history && history.count > 0 ? 'text-primary-ink' : undefined}>{historico}</span>
            </>
          )}
        </p>
        {/* Detalhe só a partir do tablet: no celular a linha fica curta e o PIX sai da vista (fica no menu). */}
        <div className="mt-1 hidden flex-wrap items-center gap-x-3 gap-y-1 text-xs text-gray-600 sm:flex">
          {typeof worker.completed_jobs_count === 'number' && (
            <span className="inline-flex items-center gap-1">
              <Briefcase size={12} aria-hidden="true" /> {worker.completed_jobs_count}{' '}
              {worker.completed_jobs_count === 1 ? 'turno no total' : 'turnos no total'}
            </span>
          )}
          {worker.city && <span>{worker.city}</span>}
          {!restricted && worker.pix_key?.trim() && (
            <span data-copilot-private className="inline-flex min-w-0 items-center gap-1">
              <Wallet size={12} className="flex-shrink-0" aria-hidden="true" />
              <span className="max-w-48 truncate">{worker.pix_key}</span>
              <IconButton
                onClick={(e) => { e.stopPropagation(); void handleCopyPix(); }}
                aria-label={`Copiar chave PIX de ${worker.full_name}`}
                title="Copiar chave PIX"
              >
                {pixCopied ? <Check size={14} /> : <Copy size={14} />}
              </IconButton>
            </span>
          )}
        </div>
      </div>

      <div className="flex flex-shrink-0 items-center gap-1">
        <Button
          variant="secondary"
          size="sm"
          aria-label="Convidar para turno"
          onClick={(e) => { e.stopPropagation(); onInvite(member); }}
          className="max-sm:min-w-11 max-sm:px-2.5"
          data-copilot="empresa.elenco.convidar-turno"
        >
          {/* No celular só o ícone (44px de toque): o nome do freela precisa do espaço. */}
          <Send size={16} aria-hidden="true" />
          <span className="hidden sm:inline">Convidar</span>
        </Button>
        {!restricted && (
          <Menu
            label={`Mais opções de ${worker.full_name}`}
            items={[
              ...(worker.pix_key?.trim()
                ? [{ label: 'Copiar chave PIX', icon: Wallet, onSelect: () => void handleCopyPix() }]
                : []),
              { label: 'Copiar link para outra empresa', icon: Share2, onSelect: () => void handleShareLink() },
              // Destrutivo por último; a confirmação é o RemoveMemberDialog.
              { label: 'Remover do elenco', icon: Trash2, onSelect: () => onRemove(member), danger: true },
            ]}
          />
        )}
      </div>
    </li>
  );
}
