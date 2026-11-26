import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { MODAL_LAYER, useStackedModal } from '../../hooks/useModalDismiss'
import { closeDialog, showDialog } from '../../lib/dialogElement'
import { cx } from './cx'

const FOCUSABLE =
  'a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]):not([type="hidden"]), select:not([disabled]), [tabindex]:not([tabindex="-1"])'

const INITIAL =
  'input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled]), button:not([disabled])'

export interface DialogProps {
  /** Pedido de fechamento (Esc, toque no fundo, voltar do Android). */
  onClose: () => void
  /** true enquanto uma gravação roda: Esc e fundo não fecham. */
  locked?: boolean
  /** false = gate (Termos, convite pós-criação): só fecha pelos botões do conteúdo. */
  dismissable?: boolean
  role?: 'dialog' | 'alertdialog'
  labelledBy?: string
  /** Muda quando o conteúdo troca de etapa: leva o foco de volta ao primeiro controle. */
  focusKey?: string
  /** 'panel' foca o cartão (um Enter distraído não aciona nada). */
  initialFocus?: 'first' | 'panel'
  layer?: number
  /** Classes do cartão (largura, sombra). */
  className?: string
  /** Classes do fundo escurecido. */
  overlayClassName?: string
  children: ReactNode
}

/**
 * Casca ÚNICA de modal: `<dialog>` + `showModal()` (top layer, resto da página inerte), foco
 * inicial, Tab preso, retorno do foco, Esc pela pilha de modais, rolagem contida e altura limitada
 * à viewport dinâmica com safe-area (`.worki-dialog` em index.css). Monte só enquanto aberto.
 * Linha de ações que deve ficar sempre visível: `className="worki-dialog-actions ..."`.
 */
export function Dialog({
  onClose,
  locked = false,
  dismissable = true,
  role = 'dialog',
  labelledBy,
  focusKey,
  initialFocus = 'first',
  layer = MODAL_LAYER.dialog,
  className,
  overlayClassName,
  children,
}: DialogProps) {
  const dialogRef = useRef<HTMLDialogElement>(null)
  const panelRef = useRef<HTMLDivElement>(null)
  const pressedOutsideRef = useRef(true)
  // Capturado no render, antes de qualquer autoFocus do conteúdo.
  const [opener] = useState(() => document.activeElement as HTMLElement | null)

  const requestClose = () => {
    if (!locked && dismissable) onClose()
  }
  const { isTop } = useStackedModal(requestClose, true, layer, dialogRef)

  const focusInitial = useCallback(() => {
    const panel = panelRef.current
    if (!panel) return
    const target =
      panel.querySelector<HTMLElement>('[data-autofocus]') ??
      (initialFocus === 'first' ? panel.querySelector<HTMLElement>(INITIAL) : null)
    ;(target ?? panel).focus()
  }, [initialFocus])

  useLayoutEffect(() => {
    const element = dialogRef.current
    if (!element) return
    showDialog(element)
    return () => {
      closeDialog(element)
      if (opener && opener !== document.body && opener.isConnected) opener.focus()
    }
  }, [opener])

  const lastFocusKey = useRef(focusKey)
  useEffect(() => {
    if (!isTop) return
    const stepChanged = lastFocusKey.current !== focusKey
    lastFocusKey.current = focusKey
    const active = document.activeElement
    if (stepChanged || !active || !panelRef.current?.contains(active)) focusInitial()
  }, [isTop, focusKey, focusInitial])

  const trapTab = (e: React.KeyboardEvent<HTMLDialogElement>) => {
    if (e.key !== 'Tab' || !dialogRef.current) return
    const items = dialogRef.current.querySelectorAll<HTMLElement>(FOCUSABLE)
    if (items.length === 0) {
      e.preventDefault()
      return
    }
    const first = items[0]
    const last = items[items.length - 1]
    const active = document.activeElement
    if (e.shiftKey && (active === first || active === panelRef.current)) {
      e.preventDefault()
      last.focus()
    } else if (!e.shiftKey && active === last) {
      e.preventDefault()
      first.focus()
    }
  }

  return (
    <dialog
      ref={dialogRef}
      role={role}
      aria-modal="true"
      aria-labelledby={labelledBy}
      inert={!isTop}
      className={cx('worki-dialog', overlayClassName)}
      onKeyDown={trapTab}
      onPointerDown={(e) => {
        // Seleção de texto que começa no cartão e termina no fundo não pode fechar o modal.
        pressedOutsideRef.current = e.target === e.currentTarget
      }}
      onClick={(e) => {
        const outside = pressedOutsideRef.current
        pressedOutsideRef.current = true
        if (outside && e.target === e.currentTarget) requestClose()
      }}
      onCancel={(e) => {
        e.preventDefault()
        requestClose()
      }}
      onClose={(e) => {
        // Fechamento forçado pelo navegador (ex.: segundo Esc do Chrome): o estado manda.
        const element = e.currentTarget
        if (e.target !== element || element.open || !element.isConnected) return
        showDialog(element)
        requestClose()
      }}
    >
      <div
        ref={panelRef}
        tabIndex={-1}
        className={cx(
          'worki-dialog-panel w-full max-w-md rounded-2xl border-ink border-black bg-white p-5 sm:p-6 shadow-overlay focus:outline-none',
          className,
        )}
      >
        {children}
      </div>
    </dialog>
  )
}

export default Dialog
