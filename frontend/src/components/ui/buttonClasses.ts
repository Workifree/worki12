import { cx } from './cx'

/**
 * Hierarquia: primário (`primary` freela · `dark` empresa, no máximo 1 visível por contexto) ·
 * secundário (`secondary`) · terciário (`ghost`) · destrutivo (`danger` só na confirmação final;
 * `dangerOutline` no botão que abre a confirmação).
 */
export type ButtonVariant = 'primary' | 'dark' | 'secondary' | 'ghost' | 'danger' | 'dangerOutline'
export type ButtonSize = 'sm' | 'md' | 'lg'

const BASE =
  'inline-flex items-center justify-center gap-2 rounded-xl font-semibold text-sm leading-tight select-none ' +
  'transition-[transform,box-shadow,background-color,color] duration-fast ease-standard active:duration-press ' +
  'motion-reduce:transition-none motion-reduce:transform-none ' +
  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 ' +
  'focus-visible:ring-black disabled:cursor-not-allowed disabled:opacity-50'

// Primário: borda 1,5px + sombra curta (`brutal-xs`) que "afunda" no toque. É o ÚNICO com sombra.
const RAISED =
  'border-ink border-black shadow-brutal-xs ' +
  'enabled:active:translate-x-[2px] enabled:active:translate-y-[2px] enabled:active:shadow-none ' +
  'disabled:shadow-none'

// Secundário e destrutivo: planos (sem sombra), só a borda de controle.
const FLAT = 'border-ink enabled:active:scale-[.97]'

const VARIANTS: Record<ButtonVariant, string> = {
  // primary-dark (#008840) → texto branco 4,57:1 (AA); o verde de marca #00A651 dá só 3,19:1.
  primary: `${RAISED} bg-primary-dark text-white enabled:hover:bg-black`,
  dark: `${RAISED} bg-black text-white enabled:hover:bg-gray-800`,
  secondary: `${FLAT} border-black bg-white text-black enabled:hover:bg-gray-50 enabled:active:bg-gray-100`,
  ghost:
    'border-ink border-transparent bg-transparent text-black enabled:hover:bg-gray-100 ' +
    'enabled:active:bg-gray-200 enabled:active:scale-[.97]',
  danger: `${FLAT} border-red-700 bg-red-600 text-white enabled:hover:bg-red-700`,
  dangerOutline: `${FLAT} border-red-700 bg-white text-red-700 enabled:hover:bg-red-50 enabled:active:bg-red-100`,
}

const SIZES: Record<ButtonSize, string> = {
  // min-h (não altura fixa): rótulo que quebra em duas linhas não é cortado.
  sm: 'min-h-9 px-3 py-1.5 [@media(pointer:coarse)]:min-h-11',
  md: 'min-h-11 px-5 py-2',
  lg: 'min-h-12 px-6 py-2.5',
}

export interface ButtonClassOptions {
  variant?: ButtonVariant
  size?: ButtonSize
  fullWidth?: boolean
  uppercase?: boolean
  className?: string
}

export function buttonClasses({
  variant = 'primary',
  size = 'md',
  fullWidth = false,
  uppercase = false,
  className,
}: ButtonClassOptions = {}): string {
  return cx(
    BASE,
    VARIANTS[variant],
    SIZES[size],
    fullWidth && 'w-full',
    uppercase && 'uppercase tracking-wide',
    className,
  )
}

/** Mesma aparência em `<a>`: o pseudo `:enabled` não casa com link, então sai. */
export function linkButtonClasses(options: ButtonClassOptions = {}): string {
  return buttonClasses(options).replace(/enabled:/g, '')
}
