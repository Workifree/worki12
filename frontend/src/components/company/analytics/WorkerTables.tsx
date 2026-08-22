/**
 * WorkerTables — blocos por freela (R12 aceite, R13-R15 presença, R16 desempenho).
 *
 * REGRA DURA (D4/R17 do PRD, briefing item 4): desempenho é SEMPRE métricas componentes lado a
 * lado, NUNCA combinadas num score. As linhas já chegam ordenadas ALFABETICAMENTE pelo service
 * (`workerName.localeCompare`) — este componente NUNCA reordena por métrica. Não introduzir
 * `.sort()` por número aqui.
 *
 * Tabela larga rola dentro do próprio contêiner (`overflow-x-auto`), nunca a página inteira.
 */
import type { ReactNode } from 'react';
import type { WorkerAcceptanceBlock, WorkerAttendanceBlock, WorkerPerformanceBlock } from '../../../types';
import { MetricStateWrapper } from './AnalyticsStates';
import { formatPercent } from './format';

function Panel({ title, note, children }: { title: string; note?: string; children: ReactNode }) {
  return (
    <div className="bg-white border-2 border-black rounded-2xl p-5 shadow-[6px_6px_0px_0px_rgba(0,0,0,1)] flex flex-col gap-4">
      <div>
        <p className="text-xs font-black uppercase text-gray-500">{title}</p>
        {note && <p className="text-[11px] text-gray-400 font-bold mt-0.5">{note}</p>}
      </div>
      {children}
    </div>
  );
}

export function WorkerAcceptancePanel({ block }: { block: WorkerAcceptanceBlock }) {
  return (
    <Panel title="Aceite por freela" note="Ordem alfabética — não é ranking.">
      <MetricStateWrapper block={block} emptyMessage="Nenhum chamado de turno disparado a freelas neste período.">
        {(data) => (
          <div className="overflow-x-auto -mx-1 px-1">
            <table className="w-full text-sm min-w-[520px]">
              <thead>
                <tr className="border-b-2 border-black text-left">
                  <th className="py-2 pr-3 font-black uppercase text-[11px]">Freela</th>
                  <th className="py-2 pr-3 font-black uppercase text-[11px] text-right">Recebidos</th>
                  <th className="py-2 pr-3 font-black uppercase text-[11px] text-right">Aceitos</th>
                  <th className="py-2 pr-3 font-black uppercase text-[11px] text-right">Recusados</th>
                  <th className="py-2 pr-3 font-black uppercase text-[11px] text-right">% Aceite</th>
                </tr>
              </thead>
              <tbody>
                {data.rows.map((row) => (
                  <tr key={row.workerId} className="border-b border-gray-200 last:border-0">
                    <td className="py-2 pr-3 font-bold">{row.workerName}</td>
                    <td className="py-2 pr-3 text-right tabular-nums">{row.received}</td>
                    <td className="py-2 pr-3 text-right tabular-nums">{row.accepted}</td>
                    <td className="py-2 pr-3 text-right tabular-nums">{row.declined}</td>
                    <td className="py-2 pr-3 text-right tabular-nums font-black">
                      {row.acceptanceRate === null ? '—' : formatPercent(row.acceptanceRate)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </MetricStateWrapper>
    </Panel>
  );
}

export function WorkerAttendancePanel({ block }: { block: WorkerAttendanceBlock }) {
  return (
    <Panel
      title="Presença por freela"
      note="Cancelamento não distingue quem cancelou (empresa ou freela) — ordem alfabética, não é ranking."
    >
      <MetricStateWrapper block={block} emptyMessage="Nenhum turno contratado/cancelado neste período.">
        {(data) => (
          <div className="overflow-x-auto -mx-1 px-1">
            <table className="w-full text-sm min-w-[620px]">
              <thead>
                <tr className="border-b-2 border-black text-left">
                  <th className="py-2 pr-3 font-black uppercase text-[11px]">Freela</th>
                  <th className="py-2 pr-3 font-black uppercase text-[11px] text-right">No-show</th>
                  <th className="py-2 pr-3 font-black uppercase text-[11px] text-right">Cancelamentos</th>
                  <th className="py-2 pr-3 font-black uppercase text-[11px] text-right">Pontual</th>
                  <th className="py-2 pr-3 font-black uppercase text-[11px] text-right">Atrasos</th>
                  <th className="py-2 pr-3 font-black uppercase text-[11px] text-right">% Pontualidade</th>
                </tr>
              </thead>
              <tbody>
                {data.rows.map((row) => (
                  <tr key={row.workerId} className="border-b border-gray-200 last:border-0">
                    <td className="py-2 pr-3 font-bold">{row.workerName}</td>
                    <td className="py-2 pr-3 text-right tabular-nums">
                      {row.noShowCount}
                      {row.noShowExcludedNoScheduleCount > 0 && (
                        <span className="block text-[10px] text-gray-400 font-normal">
                          +{row.noShowExcludedNoScheduleCount} sem horário cadastrado
                        </span>
                      )}
                    </td>
                    <td className="py-2 pr-3 text-right tabular-nums">{row.cancelledCount}</td>
                    <td className="py-2 pr-3 text-right tabular-nums">{row.punctualCount}</td>
                    <td className="py-2 pr-3 text-right tabular-nums">{row.lateCount}</td>
                    <td className="py-2 pr-3 text-right tabular-nums font-black">
                      {row.punctualityRate === null ? '—' : formatPercent(row.punctualityRate)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </MetricStateWrapper>
    </Panel>
  );
}

export function WorkerPerformancePanel({ block }: { block: WorkerPerformanceBlock }) {
  return (
    <Panel
      title="Desempenho por freela"
      note="Métricas lado a lado — não combinadas em score. Ordem alfabética, não é ranking."
    >
      <MetricStateWrapper block={block} emptyMessage="Nenhum turno concluído com freelas neste período.">
        {(data) => (
          <div className="overflow-x-auto -mx-1 px-1">
            <table className="w-full text-sm min-w-[480px]">
              <thead>
                <tr className="border-b-2 border-black text-left">
                  <th className="py-2 pr-3 font-black uppercase text-[11px]">Freela</th>
                  <th className="py-2 pr-3 font-black uppercase text-[11px] text-right">
                    Avaliação (global — todas as empresas)
                  </th>
                  <th className="py-2 pr-3 font-black uppercase text-[11px] text-right">Concluídos com você</th>
                </tr>
              </thead>
              <tbody>
                {data.rows.map((row) => (
                  <tr key={row.workerId} className="border-b border-gray-200 last:border-0">
                    <td className="py-2 pr-3 font-bold">{row.workerName}</td>
                    <td className="py-2 pr-3 text-right tabular-nums">
                      {row.ratingAverage === null ? '—' : row.ratingAverage.toFixed(1)}
                    </td>
                    <td className="py-2 pr-3 text-right tabular-nums font-black">{row.completedWithCompanyCount}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </MetricStateWrapper>
    </Panel>
  );
}
