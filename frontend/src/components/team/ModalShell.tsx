import { useId } from 'react';
import type { ReactNode } from 'react';
import { X } from 'lucide-react';
import { IconButton } from '../ui';
import { Dialog } from '../ui/Dialog';

// ---------------------------------------------------------------------------
// Casca única dos modais do Elenco (overlay + caixa + cabeçalho + corpo + rodapé).
//
// Antes, cada modal repetia overlay, caixa, título e botão "Fechar" com classes soltas e
// tamanhos diferentes. Aqui fica o contrato visual refinado (11/2026): borda preta 2px,
// sombra offset curta, título `text-xl font-bold` sem caixa-alta, fechar com alvo de 44px.
// Camadas: nav z-50 < modal z-[70] < toast z-[80] (ver design-system.md).
// Esc, foco e top layer vêm da casca única (`ui/Dialog`); `locked` é a guarda de "salvando".
// ---------------------------------------------------------------------------

type ModalSize = 'sm' | 'md' | 'lg';

const SIZE_CLASS: Record<ModalSize, string> = {
  sm: 'max-w-sm',
  md: 'max-w-md',
  lg: 'max-w-lg',
};

export interface ModalShellProps {
  title: ReactNode;
  subtitle?: ReactNode;
  onClose: () => void;
  /** true enquanto uma gravação roda: fundo e botão Fechar não fecham o modal. */
  locked?: boolean;
  size?: ModalSize;
  /** Rodapé fixo (ação primária). Fica fora da área rolável. */
  footer?: ReactNode;
  children: ReactNode;
}

export function ModalShell({
  title,
  subtitle,
  onClose,
  locked = false,
  size = 'md',
  footer,
  children,
}: ModalShellProps) {
  const titleId = useId();

  return (
    <Dialog
      labelledBy={titleId}
      onClose={onClose}
      locked={locked}
      initialFocus="panel"
      className={`${SIZE_CLASS[size]} flex flex-col !overflow-hidden !p-0`}
    >
      <div className="px-5 sm:px-6 pt-5 sm:pt-6 pb-4 flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 id={titleId} className="text-xl font-bold tracking-tight flex items-center gap-2">
            {title}
          </h2>
          {subtitle && <p className="mt-1 text-sm text-gray-600">{subtitle}</p>}
        </div>
        <IconButton aria-label="Fechar" onClick={onClose} disabled={locked} className="-mt-1 -mr-2">
          <X size={20} />
        </IconButton>
      </div>

      <div className="px-5 sm:px-6 pb-5 sm:pb-6 overflow-y-auto overscroll-contain flex-1 min-h-0">{children}</div>

      {footer && <div className="px-5 sm:px-6 py-4 border-t-2 border-black">{footer}</div>}
    </Dialog>
  );
}

export default ModalShell;
