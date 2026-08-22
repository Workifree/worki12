/**
 * FillTimeHighlight — tempo médio de preenchimento do chamado (`first_claim_at - created_at`).
 *
 * PRD G2/regra #5 do briefing: é o número que prova o ROI ("de 2 horas para 6 minutos") — recebe
 * o lugar de DESTAQUE na página (hero, não uma linha de tabela entre outras).
 */
import { Zap } from 'lucide-react';
import type { FillTimeStatsBlock } from '../../../types';
import { EmptyState, InsufficientState } from './AnalyticsStates';

export function FillTimeHighlight({ block }: { block: FillTimeStatsBlock }) {
  return (
    <div className="bg-black text-white border-2 border-black rounded-2xl p-6 md:p-8 shadow-[8px_8px_0px_0px_rgba(37,99,235,1)] flex flex-col gap-3">
      <div className="flex items-center gap-2 text-blue-400">
        <Zap size={20} strokeWidth={3} />
        <p className="text-xs font-black uppercase tracking-tight">Tempo médio de preenchimento do chamado</p>
      </div>

      {block.state === 'sem-fonte' ? (
        <EmptyState message="Nenhum chamado de turno disparado neste período." />
      ) : block.state === 'amostra-insuficiente' ? (
        <InsufficientState message="Chamados disparados, mas nenhum foi aceito ainda neste período." />
      ) : (
        <div className="flex flex-col gap-1">
          <p className="text-4xl md:text-5xl font-black tabular-nums">{block.averageLabel}</p>
          <p className="text-sm font-bold text-gray-300">
            Média sobre {block.sampleCount} chamado(s) aceito(s) no período — do disparo ao primeiro aceite.
          </p>
        </div>
      )}
    </div>
  );
}
