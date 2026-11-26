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
 *
 * `companyId`: a empresa DO TURNO (quem opera duas unidades não pode depender da "corrente").
 * Sem ele, cai no seam (`getAuthenticatedCompanyId`).
 */
export function useBusyWorkers(params: {
  windows: Array<BusyWindow | null>;
  workerIds: string[];
  /** Vale para as janelas que não trazem o próprio `excludeJobId`. */
  excludeJobId?: string | null;
  companyId?: string | null;
  enabled?: boolean;
}): ReadonlySet<string> {
  const { windows, workerIds, excludeJobId = null, companyId = null, enabled = true } = params;
  // O resultado carrega a chave da consulta que o produziu: resposta de uma consulta antiga
  // (janelas/freelas já trocados) nunca é exibida como se fosse a atual.
  const [result, setResult] = useState<{ key: string; busy: ReadonlySet<string> }>({ key: '', busy: EMPTY });

  // Chaves-string: comparam por VALOR, então um array literal novo a cada render do pai não
  // redispara a RPC (mesma defesa da F5-08 no ShiftCallModal).
  const idsKey = useMemo(() => [...workerIds].sort().join(','), [workerIds]);
  const windowsKey = useMemo(
    () => windows.filter((w): w is BusyWindow => w !== null).map((w) => `${w.start}|${w.end}|${w.excludeJobId ?? ''}`).join(';'),
    [windows],
  );
  const queryKey = `${companyId ?? ''}#${excludeJobId ?? ''}#${windowsKey}#${idsKey}`;

  // Sem o que consultar, não há aviso: derivado no retorno (nada de setState síncrono no efeito).
  const applicable = enabled && idsKey !== '' && windowsKey !== '';

  useEffect(() => {
    if (!applicable) return;
    let active = true;
    void (async () => {
      try {
        const resolvedCompanyId = companyId ?? (await getAuthenticatedCompanyId());
        const ids = idsKey.split(',');
        const queue = windowsKey.split(';').map((key) => {
          const [start, end, own] = key.split('|');
          return { start, end, excludeJobId: own || excludeJobId };
        });
        const union = new Set<string>();
        for (let i = 0; i < queue.length && active; i += MAX_CONCURRENT_CHECKS) {
          const batch = queue.slice(i, i + MAX_CONCURRENT_CHECKS);
          const found = await Promise.all(
            batch.map((w) => getBusyWorkerIds({ companyId: resolvedCompanyId, window: { start: w.start, end: w.end }, workerIds: ids, excludeJobId: w.excludeJobId })),
          );
          found.forEach((set) => set.forEach((id) => union.add(id)));
        }
        if (active) setResult({ key: queryKey, busy: union });
      } catch (err) {
        logError('useBusyWorkers', err);
        if (active) setResult({ key: queryKey, busy: EMPTY });
      }
    })();
    return () => {
      active = false;
    };
  }, [applicable, idsKey, windowsKey, excludeJobId, companyId, queryKey]);

  return applicable && result.key === queryKey ? result.busy : EMPTY;
}
