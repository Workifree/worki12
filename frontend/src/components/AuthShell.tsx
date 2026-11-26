import type { ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { ArrowLeft } from 'lucide-react'
import { cx } from './ui/cx'
import { BrandMark, BrandStripe, type BrandRole } from './BrandMark'

export interface AuthShellProps {
  /** Título da tela (h1). */
  title: ReactNode
  /** Uma frase abaixo do título. */
  subtitle?: ReactNode
  /** Destino do "Voltar" (link de ícone no topo). Sem valor, não há "Voltar". */
  backTo?: string
  /** Rótulo acessível e visível do "Voltar". */
  backLabel?: string
  /** Rodapé (troca entre entrar/cadastrar, links institucionais). Fica fora do bloco do formulário. */
  footer?: ReactNode
  children: ReactNode
  className?: string
  /** Papel em foco: dá a cor da faixa de marca (verde freela, azul empresa). */
  role?: BrandRole
}

/**
 * Casca única das telas de acesso (entrar, cadastrar, esqueci e nova senha).
 *
 * Celular: a página É o formulário. Fundo branco, sem cartão, sem sombra, sem moldura dupla.
 * A partir de `sm`: um painel branco com borda fina cinza sobre o fundo, ainda sem sombra.
 * "Voltar" é um link de ícone com 44px de toque no topo, nunca um botão solto com sombra.
 */
export function AuthShell({
  title,
  subtitle,
  backTo,
  backLabel = 'Voltar',
  footer,
  children,
  className,
  role = 'work',
}: AuthShellProps) {
  return (
    <div className="min-h-screen bg-white sm:bg-canvas">
      <BrandStripe role={role} />
      <div className="mx-auto flex min-h-screen w-full max-w-md flex-col px-4 pb-6 pt-2 sm:justify-center sm:py-10">
        {backTo && (
          <div className="mb-2">
            <Link
              to={backTo}
              className="-ml-2 inline-flex min-h-11 items-center gap-1.5 rounded-xl px-2 text-sm font-semibold text-gray-700 hover:bg-gray-100 hover:text-black focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-black"
            >
              <ArrowLeft size={20} aria-hidden="true" />
              {backLabel}
            </Link>
          </div>
        )}
        <main
          className={cx(
            'w-full sm:rounded-2xl sm:border sm:border-gray-200 sm:bg-white sm:p-8',
            className,
          )}
        >
          <header className="mb-6">
            <BrandMark role={role} className="mb-4" />
            <h1 className="text-2xl font-bold tracking-tight text-gray-900">{title}</h1>
            {subtitle && <p className="mt-1 text-sm text-gray-600 sm:text-base">{subtitle}</p>}
          </header>
          {children}
        </main>
        {footer && <div className="mt-4 w-full">{footer}</div>}
      </div>
    </div>
  )
}

export default AuthShell
