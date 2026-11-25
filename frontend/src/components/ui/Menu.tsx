import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState } from 'react'
import type { KeyboardEvent } from 'react'
import { MoreHorizontal } from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import { IconButton } from './IconButton'
import type { IconButtonVariant } from './IconButton'
import { cx } from './cx'
import { placeMenu } from './menuPosition'

export interface MenuItem {
  label: string
  icon?: LucideIcon
  onSelect: () => void
  /** Destrutivo: vermelho, separado dos demais. Declare por último. */
  danger?: boolean
  disabled?: boolean
}

export interface MenuProps {
  /** Nome do botão "..." com o objeto ("Mais opções do turno"). */
  label: string
  /** Nome do menu aberto (padrão: o mesmo do botão). */
  menuLabel?: string
  items: Array<MenuItem | false | null | undefined>
  triggerVariant?: IconButtonVariant
  className?: string
}

const ENABLED_ITEMS = '[role="menuitem"]:not(:disabled)'

/** Topo da barra inferior, quando ela está visível: o menu não pode passar daí. */
function bottomLimit(): number {
  const nav = document.querySelector('[data-bottom-nav]')?.getBoundingClientRect()
  return nav && nav.height > 0 ? nav.top : window.innerHeight
}

/**
 * Menu "..." na TOP LAYER (`popover`): fica acima de cartões, cabeçalho e barra inferior e não é
 * cortado por `overflow`. Vira para cima quando falta espaço e rola se nem assim couber.
 * Teclado: setas, Home, End, Esc (devolve o foco), Tab fecha.
 */
export function Menu({ label, menuLabel, items, triggerVariant = 'ghost', className }: MenuProps) {
  const [open, setOpen] = useState(false)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const menuRef = useRef<HTMLDivElement>(null)
  const startAtEnd = useRef(false)
  const menuId = useId()
  const visible = items.filter((item): item is MenuItem => Boolean(item))

  const close = useCallback((restoreFocus: boolean) => {
    setOpen(false)
    if (restoreFocus) triggerRef.current?.focus()
  }, [])

  const reposition = useCallback(() => {
    const menu = menuRef.current
    const trigger = triggerRef.current
    if (!menu || !trigger) return
    menu.style.maxHeight = 'none'
    const header = document.querySelector('.worki-layout > header')?.getBoundingClientRect()
    const place = placeMenu(
      trigger.getBoundingClientRect(),
      { width: menu.offsetWidth, height: menu.scrollHeight + (menu.offsetHeight - menu.clientHeight) },
      {
        width: document.documentElement.clientWidth || window.innerWidth,
        top: header && header.height > 0 ? Math.max(0, header.bottom) : 0,
        bottom: bottomLimit(),
      },
    )
    menu.style.top = `${place.top}px`
    menu.style.left = `${place.left}px`
    menu.style.maxHeight = `${place.maxHeight}px`
    menu.dataset.side = place.opensUp ? 'top' : 'bottom'
  }, [])

  useLayoutEffect(() => {
    if (!open) return
    const menu = menuRef.current
    if (!menu) return
    // Navegador sem Popover API: o `position: fixed` + z-index continuam valendo.
    if (typeof menu.showPopover === 'function') menu.showPopover()
    else menu.removeAttribute('popover')
    reposition()
    const options = menu.querySelectorAll<HTMLButtonElement>(ENABLED_ITEMS)
    options[startAtEnd.current ? options.length - 1 : 0]?.focus({ preventScroll: true })
    startAtEnd.current = false
  }, [open, reposition])

  useEffect(() => {
    if (!open) return
    const onPointerDown = (e: Event) => {
      const target = e.target as Node
      if (menuRef.current?.contains(target) || triggerRef.current?.contains(target)) return
      close(false)
    }
    document.addEventListener('pointerdown', onPointerDown, true)
    window.addEventListener('resize', reposition)
    window.addEventListener('scroll', reposition, true)
    return () => {
      document.removeEventListener('pointerdown', onPointerDown, true)
      window.removeEventListener('resize', reposition)
      window.removeEventListener('scroll', reposition, true)
    }
  }, [open, close, reposition])

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key === 'Escape') {
      // preventDefault: um Dialog por baixo não pode fechar junto.
      e.preventDefault()
      e.stopPropagation()
      close(true)
      return
    }
    if (e.key === 'Tab') {
      close(true)
      return
    }
    const options = Array.from(menuRef.current?.querySelectorAll<HTMLButtonElement>(ENABLED_ITEMS) ?? [])
    if (options.length === 0) return
    const index = options.indexOf(document.activeElement as HTMLButtonElement)
    const next: Record<string, number> = {
      ArrowDown: (index + 1) % options.length,
      ArrowUp: (index <= 0 ? options.length : index) - 1,
      Home: 0,
      End: options.length - 1,
    }
    if (!(e.key in next)) return
    e.preventDefault()
    options[next[e.key]].focus()
  }

  if (visible.length === 0) return null

  return (
    <div className={cx('shrink-0', className)} onClick={(e) => e.stopPropagation()}>
      <IconButton
        ref={triggerRef}
        variant={triggerVariant}
        aria-label={label}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        onClick={() => setOpen((value) => !value)}
        onKeyDown={(e) => {
          if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
            e.preventDefault()
            startAtEnd.current = e.key === 'ArrowUp'
            setOpen(true)
          } else if (e.key === 'Escape' && open) {
            e.preventDefault()
            close(true)
          }
        }}
      >
        <MoreHorizontal size={20} />
      </IconButton>
      {open && (
        <div
          ref={menuRef}
          id={menuId}
          popover="manual"
          role="menu"
          aria-label={menuLabel ?? label}
          onKeyDown={onKeyDown}
          className="fixed bottom-auto right-auto z-[60] m-0 w-60 max-w-[calc(100vw-1rem)] overflow-y-auto overscroll-contain rounded-xl border-2 border-black bg-white p-0 text-left shadow-brutal"
        >
          {visible.map((item, index) => (
            <button
              key={item.label}
              type="button"
              role="menuitem"
              tabIndex={-1}
              disabled={item.disabled}
              onClick={() => {
                // Foco volta ao gatilho ANTES da ação: um Dialog aberto por ela o devolve para cá.
                close(true)
                item.onSelect()
              }}
              className={cx(
                'flex min-h-12 w-full items-center gap-3 px-4 py-2 text-left text-sm font-semibold text-black',
                'hover:bg-gray-100 active:bg-gray-200 focus-visible:bg-gray-100 focus-visible:outline-none',
                'focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-black',
                'disabled:cursor-not-allowed disabled:opacity-50',
                index > 0 && 'border-t border-gray-200',
                item.danger && 'text-red-700 hover:bg-red-50 focus-visible:bg-red-50',
                index > 0 && item.danger && !visible[index - 1].danger && 'border-t-2 border-black',
              )}
            >
              {item.icon && <item.icon size={16} aria-hidden="true" className="shrink-0" />}
              <span className="min-w-0">{item.label}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
