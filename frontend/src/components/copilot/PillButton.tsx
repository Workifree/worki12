import type { ButtonHTMLAttributes, ReactNode, Ref } from 'react'

export type PillTone = 'primary' | 'dark' | 'light' | 'ghost'

/** Receitas do laboratório visual: `.btn`, `.btn--primary`, `seg` pressionado (tinta) e fantasma. Estilos em copilot.css. */
const TONES: Record<PillTone, string> = {
  primary: 'wk-btn wk-btn--primary',
  dark: 'wk-btn wk-btn--ink',
  light: 'wk-btn',
  ghost: 'min-h-11 rounded-[10px] border-0 bg-transparent px-3 text-[13px] font-semibold text-[#0f1720] hover:bg-[#eef3ff]',
}

/** Botão do copiloto, com alvo de toque de 44px ou mais. */
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
      className={`inline-flex select-none items-center justify-center gap-2 leading-tight transition-colors active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-50 motion-reduce:transition-none motion-reduce:active:scale-100 ${TONES[tone]} ${className}`}
      {...rest}
    >
      {icon}
      {children}
    </button>
  )
}
