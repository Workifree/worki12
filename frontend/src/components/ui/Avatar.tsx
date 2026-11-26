import { useState } from 'react'
import { cx } from './cx'

export type AvatarSize = 'sm' | 'md' | 'lg'
export type AvatarKind = 'person' | 'company'

export interface AvatarProps {
  /** Nome exibido: dá a inicial e o texto alternativo. */
  name?: string | null
  /** Foto (pessoa) ou logo (empresa). Sem URL, ou se a imagem falhar, mostra a inicial. */
  src?: string | null
  /** person = redondo · company = rounded-xl */
  kind?: AvatarKind
  /** sm 32px (linha densa) · md 40px (linha de lista) · lg 80px (cabeçalho de perfil) */
  size?: AvatarSize
  /** Decorativo quando o nome já aparece ao lado (padrão). */
  decorative?: boolean
  className?: string
}

const SIZES: Record<AvatarSize, string> = {
  sm: 'h-8 w-8 text-xs',
  md: 'h-10 w-10 text-sm',
  lg: 'h-20 w-20 text-2xl',
}

/** Avatar único do app: inicial sobre fundo neutro, pessoa redonda e empresa `rounded-xl`. */
export function Avatar({ name, src, kind = 'person', size = 'md', decorative = true, className }: AvatarProps) {
  const [failed, setFailed] = useState(false)
  const initial = (name?.trim()?.[0] ?? '?').toUpperCase()
  const showImage = !!src && !failed
  return (
    <span
      role={decorative ? undefined : 'img'}
      aria-hidden={decorative || undefined}
      aria-label={decorative ? undefined : name ?? undefined}
      className={cx(
        'inline-flex shrink-0 select-none items-center justify-center overflow-hidden border border-gray-200 bg-gray-100 font-semibold text-gray-700',
        kind === 'person' ? 'rounded-full' : 'rounded-xl',
        SIZES[size],
        className,
      )}
    >
      {showImage ? (
        <img src={src} alt="" className="h-full w-full object-cover" onError={() => setFailed(true)} />
      ) : (
        initial
      )}
    </span>
  )
}

export default Avatar
