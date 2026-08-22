/**
 * AnalyticsStates — helpers de renderização dos estados de bloco (D6 do PRD F9).
 *
 * `MetricBlock<T>` (types/index.ts) carrega só TRÊS estados explícitos no tipo:
 * 'sem-fonte' | 'amostra-insuficiente' | 'ok'. O quarto estado de D6 ('loading') não vem do
 * tipo — é responsabilidade da UI (o service não fica "em voo" no próprio retorno) e é tratado
 * no componente de página com um `loading: boolean` separado.
 *
 * REGRA DE OURO (R18/D6): 'sem-fonte' e 'zero-real' NUNCA podem parecer a mesma coisa.
 * 'zero-real' não é um estado do tipo — é simplesmente `state: 'ok'` com um valor 0. Por isso
 * `MetricStateWrapper` só cuida de 'sem-fonte'/'amostra-insuficiente'; quando o bloco está 'ok',
 * quem desenha o "0 no-shows em 12 turnos" é o `children` de cada card (ele tem o contexto —
 * o total de turnos — para dar significado ao zero).
 */
import type { ReactNode } from 'react';
import type { MetricBlock } from '../../../types';

interface EmptyStateProps {
  message: string;
  cta?: ReactNode;
}

/** `sem-fonte` — zero linhas na fonte. NUNCA renderizar "0"/"R$ 0,00"/gráfico vazio aqui. */
export function EmptyState({ message, cta }: EmptyStateProps) {
  return (
    <div className="flex flex-col items-center justify-center gap-3 py-8 text-center">
      <p className="text-sm font-bold text-gray-500 max-w-xs">{message}</p>
      {cta}
    </div>
  );
}

interface InsufficientStateProps {
  message: string;
}

/** `amostra-insuficiente` — há linhas, mas abaixo do mínimo estatístico (ex.: < 2 casos). */
export function InsufficientState({ message }: InsufficientStateProps) {
  return (
    <div className="flex flex-col items-center justify-center gap-1 py-8 text-center">
      <p className="text-3xl font-black text-gray-300">—</p>
      <p className="text-xs font-bold text-gray-400 max-w-xs">{message}</p>
    </div>
  );
}

/** Skeleton neo-brutalista (design-system regra 9) — nunca mostrar "0" enquanto carrega. */
export function AnalyticsSkeleton({ rows = 3 }: { rows?: number }) {
  return (
    <div className="animate-pulse space-y-4" role="status" aria-label="Carregando métricas">
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} className="h-20 bg-gray-200 rounded-xl" />
      ))}
    </div>
  );
}

interface MetricStateWrapperProps<T> {
  block: MetricBlock<T>;
  emptyMessage: string;
  emptyCta?: ReactNode;
  insufficientMessage?: string;
  children: (data: T) => ReactNode;
}

/**
 * Wrapper genérico para os blocos `MetricBlock<T>`: cuida de 'sem-fonte'/'amostra-insuficiente'
 * e devolve o controle ao chamador só quando `state === 'ok'` (onde mora o eventual zero legítimo).
 */
export function MetricStateWrapper<T>({
  block,
  emptyMessage,
  emptyCta,
  insufficientMessage,
  children,
}: MetricStateWrapperProps<T>) {
  if (block.state === 'sem-fonte') {
    return <EmptyState message={emptyMessage} cta={emptyCta} />;
  }
  if (block.state === 'amostra-insuficiente') {
    return <InsufficientState message={insufficientMessage ?? 'Amostra insuficiente para calcular (mínimo 2 casos).'} />;
  }
  // eslint-disable-next-line @typescript-eslint/no-unused-vars -- destructure só para excluir `state` de `data`
  const { state, ...data } = block;
  return <>{children(data as T)}</>;
}
