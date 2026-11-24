import { useEffect, useMemo, useState } from 'react';
import { getAuthenticatedCompanyId } from '../services/companyScopeService';
import { getBusyWorkerIds, type ShiftWindow } from '../services/shiftOperationService';
import { logError } from '../lib/logger';

const EMPTY: ReadonlySet<string> = new Set<string>();

/** Quantas consultas `get_busy_workers` rodam ao mesmo tempo (várias janelas = série). */
const MAX_CONCURRENT_CHECKS = 4;

/** Janela do turno; `excludeJobId` tira o PRÓPRIO turno daquela janela da checagem. */
export type BusyWindow = ShiftWindow & { excludeJobId?: string | null };

/**
 * Freelas do Elenco que já estão em outro turno da empresa na janela (R14). É SÓ UM AVISO: nunca
 * bloqueia, nunca diz qual turno nem de quem. Erro de qualquer natureza = "sem aviso" + log.
 * `windows` aceita várias janelas (ex.: ocorrências de uma série); o resultado é a união, com no
 * máximo `MAX_CONCURRENT_CHECKS` consultas em voo.
 */
export function useBusyWorkers(params: {
  windows: Array<BusyWindow | null>;
  workerIds: string[];
  /** Vale para as janelas que não trazem o próprio `excludeJobId`. */
  excludeJobId?: string | null;
  enabled?: boolean;
}): ReadonlySet<string> {
  const { windows, workerIds, excludeJobId = null, enabled = true } = params;
  const [busy, setBusy] = useState<ReadonlySet<string>>(EMPTY);

  // Chaves-string: comparam por VALOR, então um array literal novo a cada render do pai não
  // redispara a RPC (mesma defesa da F5-08 no ShiftCallModal).
  const idsKey = useMemo(() => [...workerIds].sort().join(','), [workerIds]);
  const windowsKey = useMemo(
    () => windows.filter((w): w is BusyWindow => w !== null).map((w) => `${w.start}|${w.end}|${w.excludeJobId ?? ''}`).join(';'),
    [windows],
  );

  // Sem o que consultar, não há aviso: derivado no retorno (nada de setState síncrono no efeito).
  const applicable = enabled && idsKey !== '' && windowsKey !== '';

  useEffect(() => {
    if (!applicable) return;
    let active = true;
    void (async () => {
      try {
        const companyId = await getAuthenticatedCompanyId();
        const ids = idsKey.split(',');
        const queue = windowsKey.split(';').map((key) => {
          const [start, end, own] = key.split('|');
          return { start, end, excludeJobId: own || excludeJobId };
        });
        const union = new Set<string>();
        for (let i = 0; i < queue.length && active; i += MAX_CONCURRENT_CHECKS) {
          const batch = queue.slice(i, i + MAX_CONCURRENT_CHECKS);
          const found = await Promise.all(
            batch.map((w) => getBusyWorkerIds({ companyId, window: { start: w.start, end: w.end }, workerIds: ids, excludeJobId: w.excludeJobId })),
          );
          found.forEach((set) => set.forEach((id) => union.add(id)));
        }
        if (active) setBusy(union);
      } catch (err) {
        logError('useBusyWorkers', err);
        if (active) setBusy(EMPTY);
      }
    })();
    return () => {
      active = false;
    };
  }, [applicable, idsKey, windowsKey, excludeJobId]);

  return applicable ? busy : EMPTY;
}
