/**
 * CallsBreakdown — Chamados por status (R10) e por motivo da quebra (R11). Barras nativas
 * (div + largura em %), sem biblioteca de gráfico nova (A14/Non-goal: sem export, sem gráfico
 * com lib externa).
 */
import type { CallsByStatusBlock, CallsByReasonBlock } from '../../../types';
import { SHIFT_CALL_REASON_LABELS } from '../../../types';
import { MetricStateWrapper } from './AnalyticsStates';

const STATUS_LABELS: Record<'open' | 'filled' | 'expired' | 'cancelled', string> = {
  open: 'Em aberto',
  filled: 'Preenchidos',
  expired: 'Expirados (demanda não atendida)',
  cancelled: 'Cancelados',
};

const STATUS_BAR_CLASS: Record<'open' | 'filled' | 'expired' | 'cancelled', string> = {
  open: 'bg-blue-500',
  filled: 'bg-primary',
  expired: 'bg-red-500',
  cancelled: 'bg-gray-400',
};

interface BarProps {
  label: string;
  value: number;
  /** Base usada só para a LARGURA da barra (% de preenchimento visual). */
  widthBase: number;
  colorClass: string;
  /** Quando presente, mostra "value (pct%)" com pct calculado sobre este total (não `widthBase`). */
  percentOfTotal?: number;
}

function Bar({ label, value, widthBase, colorClass, percentOfTotal }: BarProps) {
  const width = widthBase > 0 ? Math.round((value / widthBase) * 100) : 0;
  const pct = percentOfTotal && percentOfTotal > 0 ? Math.round((value / percentOfTotal) * 100) : null;
  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-center justify-between text-xs font-bold">
        <span>{label}</span>
        <span className="tabular-nums">
          {value}
          {pct !== null ? ` (${pct}%)` : ''}
        </span>
      </div>
      <div className="h-3 w-full bg-gray-100 rounded-full border-2 border-black overflow-hidden">
        <div className={`h-full ${colorClass}`} style={{ width: `${width}%` }} />
      </div>
    </div>
  );
}

export function CallsByStatusPanel({ block }: { block: CallsByStatusBlock }) {
  return (
    <div className="bg-white border-2 border-black rounded-2xl p-5 shadow-[6px_6px_0px_0px_rgba(0,0,0,1)] flex flex-col gap-4">
      <p className="text-xs font-black uppercase text-gray-500">Chamados por status</p>
      <MetricStateWrapper block={block} emptyMessage="Nenhum chamado de turno disparado neste período.">
        {(data) => (
          <div className="flex flex-col gap-3">
            {(['open', 'filled', 'expired', 'cancelled'] as const).map((status) => (
              <Bar
                key={status}
                label={STATUS_LABELS[status]}
                value={data[status]}
                widthBase={data.total}
                percentOfTotal={data.total}
                colorClass={STATUS_BAR_CLASS[status]}
              />
            ))}
            <p className="text-[11px] text-gray-400 font-bold">{data.total} chamado(s) no total.</p>
          </div>
        )}
      </MetricStateWrapper>
    </div>
  );
}

export function CallsByReasonPanel({ block }: { block: CallsByReasonBlock }) {
  return (
    <div className="bg-white border-2 border-black rounded-2xl p-5 shadow-[6px_6px_0px_0px_rgba(0,0,0,1)] flex flex-col gap-4">
      <p className="text-xs font-black uppercase text-gray-500">Motivo da quebra</p>
      <MetricStateWrapper block={block} emptyMessage="Nenhum chamado de turno disparado neste período.">
        {(data) => {
          const maxTotal = Math.max(1, ...data.rows.map((r) => r.total));
          return (
            <div className="flex flex-col gap-3">
              {data.rows.map((row) => (
                <Bar
                  key={row.reason}
                  label={`${SHIFT_CALL_REASON_LABELS[row.reason]} · ${row.filled} preenchido(s) / ${row.expired} expirado(s)`}
                  value={row.total}
                  widthBase={maxTotal}
                  colorClass="bg-black"
                />
              ))}
            </div>
          );
        }}
      </MetricStateWrapper>
    </div>
  );
}
