import type { HTMLAttributes, ReactNode } from 'react'
import { cx } from './cx'

export interface ActionBarProps extends HTMLAttributes<HTMLDivElement> {
  /** UMA ação principal. No celular ocupa a largura que sobra, ao alcance do polegar. */
  primary: ReactNode
  /** Alternativa ou "Voltar". Vem antes da principal no DOM. */
  secondary?: ReactNode
  /** Resumo curto acima dos botões ("4h · R$ 100,00") ou motivo do botão desabilitado. */
  summary?: ReactNode
  /** Rótulos longos: empilha no celular com a principal no topo. */
  stacked?: boolean
  /** Também fixa no rodapé da janela no computador (formulários longos: o botão nunca fica fora da vista). */
  stickyOnDesktop?: boolean
}

/**
 * Conclusão de formulário ou de detalhe longo. É o ÚLTIMO filho do conteúdo da tela.
 *
 * Celular: `sticky` logo ACIMA da barra inferior (`--worki-nav-h`; sem barra, respeita a
 * safe-area). Como é sticky, ocupa o próprio lugar no fluxo: no fim da rolagem não cobre nada,
 * sem precisar de `pb-*` na página. Desktop: estática, alinhada à direita.
 *
 * Nenhum ancestral entre ela e a página pode ter `overflow` diferente de `visible`.
 */
export function ActionBar({ primary, secondary, summary, stacked = false, stickyOnDesktop = false, className, ...rest }: ActionBarProps) {
  return (
    <div
      className={cx(
        'worki-action-bar sticky bottom-[var(--worki-nav-h,0px)] z-30 -mx-4 mt-6 border-t-2 border-black bg-white px-4 py-3',
        'pb-[max(0.75rem,calc(env(safe-area-inset-bottom,0px)-var(--worki-nav-h,0px)))]',
        stickyOnDesktop
          ? 'sm:-mx-6 sm:px-6 md:bottom-0 md:mx-0 md:px-0 md:pb-3'
          : 'sm:-mx-6 sm:px-6 md:static md:mx-0 md:border-0 md:bg-transparent md:px-0 md:pb-0',
        className,
      )}
      {...rest}
    >
      {summary && <div className="mb-2 text-sm text-gray-600 md:text-right">{summary}</div>}
      <div
        className={cx(
          'flex gap-3 md:justify-end',
          stacked
            ? 'flex-col-reverse [&>*]:w-full sm:flex-row sm:[&>*]:w-auto'
            : '[&>*:last-child]:flex-1 md:[&>*:last-child]:flex-none',
        )}
      >
        {secondary}
        {primary}
      </div>
    </div>
  )
}
