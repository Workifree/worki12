import type { KeyboardEvent } from 'react'
import { nextTabIndex } from '../../lib/tabsKeyboard'
import { cx } from './cx'

export interface TabItem<T extends string> {
  id: T
  label: string
  count?: number
}

export interface TabsProps<T extends string> {
  label: string
  tabs: ReadonlyArray<TabItem<T>>
  value: T
  onChange: (id: T) => void
  /** `id` do painel controlado, quando existir. */
  panelId?: string
  className?: string
}

/** Abas de UMA linha (rolam se faltar largura). Setas, Home e End trocam de aba. */
export function Tabs<T extends string>({ label, tabs, value, onChange, panelId, className }: TabsProps<T>) {
  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    const next = nextTabIndex(e.key, tabs.findIndex((tab) => tab.id === value), tabs.length)
    if (next === null) return
    e.preventDefault()
    onChange(tabs[next].id)
    e.currentTarget.querySelectorAll<HTMLButtonElement>('[role="tab"]')[next]?.focus()
  }

  return (
    <div
      role="tablist"
      aria-label={label}
      onKeyDown={onKeyDown}
      className={cx('worki-scroll-row flex gap-1 overflow-x-auto border-b border-gray-200', className)}
    >
      {tabs.map((tab) => {
        const selected = tab.id === value
        return (
          <button
            key={tab.id}
            type="button"
            role="tab"
            aria-selected={selected}
            aria-controls={panelId}
            tabIndex={selected ? 0 : -1}
            onClick={() => onChange(tab.id)}
            className={cx(
              '-mb-px inline-flex min-h-11 flex-auto shrink-0 items-center justify-center gap-1.5 whitespace-nowrap border-b-2 px-3 text-sm',
              'transition-colors duration-fast active:bg-gray-100',
              'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-black',
              selected ? 'border-black font-semibold text-black' : 'border-transparent font-medium text-gray-600 hover:text-black',
            )}
          >
            {tab.label}
            {typeof tab.count === 'number' && tab.count > 0 && (
              <span className="rounded-pill bg-gray-200 px-1.5 text-xs font-semibold tabular-nums text-gray-700">
                {tab.count}
              </span>
            )}
          </button>
        )
      })}
    </div>
  )
}
