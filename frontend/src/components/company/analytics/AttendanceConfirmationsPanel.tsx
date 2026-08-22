/**
 * AttendanceConfirmationsPanel — bloco AGREGADO de confirmação de véspera (F4).
 *
 * D4 do PRD: só entra como agregado de operação nesta v1, NUNCA como coluna por freela —
 * sem `pg_cron` verificado ativo em produção, "não respondeu" significaria "ninguém perguntou"
 * (acusaria o freela por falha de infraestrutura, não por comportamento).
 */
import type { AttendanceConfirmationsBlock } from '../../../types';
import { MetricStateWrapper } from './AnalyticsStates';

export function AttendanceConfirmationsPanel({ block }: { block: AttendanceConfirmationsBlock }) {
  return (
    <div className="bg-white border-2 border-black rounded-2xl p-5 shadow-[6px_6px_0px_0px_rgba(0,0,0,1)] flex flex-col gap-3">
      <p className="text-xs font-black uppercase text-gray-500">Confirmação de véspera (agregado)</p>
      <MetricStateWrapper
        block={block}
        emptyMessage="Nenhuma confirmação de presença foi pedida neste período."
      >
        {(data) => (
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 text-center">
            <div>
              <p className="text-xl font-black tabular-nums">{data.requested}</p>
              <p className="text-[10px] font-bold uppercase text-gray-500">Pedidas</p>
            </div>
            <div>
              <p className="text-xl font-black tabular-nums">{data.responded}</p>
              <p className="text-[10px] font-bold uppercase text-gray-500">Respondidas</p>
            </div>
            <div>
              <p className="text-xl font-black tabular-nums">{data.declined}</p>
              <p className="text-[10px] font-bold uppercase text-gray-500">Recusadas</p>
            </div>
          </div>
        )}
      </MetricStateWrapper>
    </div>
  );
}
