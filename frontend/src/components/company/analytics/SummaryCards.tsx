/**
 * SummaryCards — os quatro números que a empresa hoje monta na mão (PRD G1): gasto absoluto,
 * contratações, custo por hora, razão horas realizadas ÷ previstas. Cada card trata os estados
 * de `MetricBlock` e nunca mostra "R$ 0,00"/"0%" quando a fonte está vazia (R18/D6).
 */
import type { ReactNode } from 'react';
import { ArrowDownRight, ArrowUpRight, Minus } from 'lucide-react';
import type {
  SpendSummaryBlock,
  HiresSummaryBlock,
  CostPerHourSummaryBlock,
  HoursRatioSummaryBlock,
} from '../../../types';
import { MetricStateWrapper } from './AnalyticsStates';
import { formatBRL, formatDelta, formatHours, formatPercent } from './format';

function DeltaBadge({ delta }: { delta: { current: number; previous: number | null; percentChange: number | null } }) {
  const { label, direction } = formatDelta(delta);
  const Icon = direction === 'up' ? ArrowUpRight : direction === 'down' ? ArrowDownRight : Minus;
  const colorClass =
    direction === 'up' ? 'text-primary' : direction === 'down' ? 'text-red-600' : 'text-gray-400';
  return (
    <p className={`flex items-center gap-1 text-xs font-bold ${colorClass}`}>
      <Icon size={14} strokeWidth={3} />
      {label}
    </p>
  );
}

function CardShell({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="bg-white border-2 border-black rounded-2xl p-5 shadow-[6px_6px_0px_0px_rgba(0,0,0,1)] flex flex-col gap-2 min-h-[140px]">
      <p className="text-xs font-black uppercase text-gray-500 tracking-tight">{label}</p>
      {children}
    </div>
  );
}

export function SpendCard({ block }: { block: SpendSummaryBlock }) {
  return (
    <CardShell label="Gasto no período">
      <MetricStateWrapper
        block={block}
        emptyMessage="Nenhum pagamento registrado neste período."
      >
        {(data) => (
          <div className="flex flex-col gap-1">
            <p className="text-2xl font-black tabular-nums">{formatBRL(data.totalAmount)}</p>
            <DeltaBadge delta={data.delta} />
            {data.conflictingRowsCount > 0 && (
              <p className="text-[11px] font-bold text-yellow-700">
                {data.conflictingRowsCount} registro(s) vieram de duas fontes — considerado só o pagamento
                declarado (modo A).
              </p>
            )}
          </div>
        )}
      </MetricStateWrapper>
    </CardShell>
  );
}

export function HiresCard({ block }: { block: HiresSummaryBlock }) {
  return (
    <CardShell label="Contratações no período">
      <MetricStateWrapper block={block} emptyMessage="Nenhum turno programado para este período.">
        {(data) => (
          <div className="flex flex-col gap-1">
            <p className="text-2xl font-black tabular-nums">{data.count}</p>
            <DeltaBadge delta={data.delta} />
            <p className="text-[11px] text-gray-500">
              de {data.jobsCreatedCount} turno(s) no período
            </p>
          </div>
        )}
      </MetricStateWrapper>
    </CardShell>
  );
}

export function CostPerHourCard({ block }: { block: CostPerHourSummaryBlock }) {
  return (
    <CardShell label="Custo por hora">
      <MetricStateWrapper block={block} emptyMessage="Nenhum turno concluído neste período.">
        {(data) => (
          <div className="flex flex-col gap-1">
            <p className="text-2xl font-black tabular-nums">
              {data.costPerHour === null ? '—' : `${formatBRL(data.costPerHour)}/h`}
            </p>
            <DeltaBadge delta={data.delta} />
            {data.estimatedHoursShiftsCount > 0 && (
              <p className="text-[11px] font-bold text-yellow-700">
                {data.estimatedHoursShiftsCount} de {data.shiftsCount} turno(s) usaram a hora ESTIMADA
                (sem checkout registrado).
              </p>
            )}
            {data.inconsistentDurationShiftsCount > 0 && (
              <p className="text-[11px] font-bold text-red-600">
                {data.inconsistentDurationShiftsCount} turno(s) com marcação inconsistente foram descartados
                do cálculo.
              </p>
            )}
            {data.noHoursSourceShiftsCount > 0 && (
              <p className="text-[11px] font-bold text-red-600">
                {data.noHoursSourceShiftsCount} turno(s) concluído(s) sem marcação de ponto nem hora estimada
                {data.costPerHour === null ? ' — por isso o "—" acima.' : ' (excluído(s) do cálculo).'}
              </p>
            )}
          </div>
        )}
      </MetricStateWrapper>
    </CardShell>
  );
}

export function HoursRatioCard({ block }: { block: HoursRatioSummaryBlock }) {
  return (
    <CardShell label="Horas realizadas ÷ previstas">
      <MetricStateWrapper block={block} emptyMessage="Nenhum turno concluído neste período.">
        {(data) => (
          <div className="flex flex-col gap-1">
            <p className="text-2xl font-black tabular-nums">
              {data.ratio === null ? '—' : formatPercent(data.ratio)}
            </p>
            <DeltaBadge delta={data.delta} />
            <p className="text-[11px] text-gray-500">
              {formatHours(data.realizedHours)} realizadas de {formatHours(data.estimatedHours)} previstas
            </p>
            {(data.excludedNoEstimateCount > 0 || data.excludedNoAttendanceCount > 0) && (
              <p className="text-[11px] font-bold text-yellow-700">
                {data.excludedNoEstimateCount} sem estimativa cadastrada · {data.excludedNoAttendanceCount} sem
                marcação de ponto (excluídos do cálculo)
              </p>
            )}
          </div>
        )}
      </MetricStateWrapper>
    </CardShell>
  );
}
