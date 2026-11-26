import type { ButtonHTMLAttributes, ReactNode, Ref } from 'react'

export type PillTone = 'dark' | 'green' | 'light' | 'ghost' | 'danger'

const TONES: Record<PillTone, string> = {
  dark: 'bg-black text-white hover:bg-gray-800',
  green: 'bg-primary-dark text-white hover:bg-black',
  light: 'bg-white text-black ring-1 ring-inset ring-black/15 hover:bg-gray-50',
  ghost: 'bg-transparent text-black hover:bg-black/5',
  danger: 'bg-red-600 text-white shadow-md shadow-red-600/30 hover:bg-red-700',
}

/** Botão do copiloto: botão `rounded-xl` do sistema (sem a moldura brutalista), alvo de toque de 48px. */
export function PillButton({
  tone = 'light',
  icon,
  className = '',
  type = 'button',
  children,
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & { tone?: PillTone; icon?: ReactNode; ref?: Ref<HTMLButtonElement> }) {
  return (
    <button
      type={type}
      className={`inline-flex min-h-12 select-none items-center justify-center gap-2 rounded-xl px-5 text-sm font-bold leading-tight transition-colors active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-black focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50 motion-reduce:transition-none motion-reduce:active:scale-100 ${TONES[tone]} ${className}`}
      {...rest}
    >
      {icon}
      {children}
    </button>
  )
}
