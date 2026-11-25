import { useEffect, useMemo, useState } from 'react';
import { TeamConnectionService } from '../../services/teamConnectionService';
import { TeamListService } from '../../services/teamListService';
import { DEFAULT_LINK_RISK_CONFIG, LinkRiskService, type LinkRiskConfig } from '../../services/linkRiskService';
import { buildShiftWindow, getBusyWorkerIds } from '../../services/shiftOperationService';
import { logError } from '../../lib/logger';
import { addDays, weekdayOf, type ShiftDraftRow } from '../../lib/shiftDrafts';
import type { TeamListWithMembers, TeamMember } from '../../types';

export interface CallData {
    loading: boolean;
    error: boolean;
    members: TeamMember[];
    lists: TeamListWithMembers[];
    retry: () => void;
}

/** Elenco aceito e listas. Só consulta quando a pessoa pode chamar. */
export function useCallData(enabled: boolean): CallData {
    const [attempt, setAttempt] = useState(0);
    const [data, setData] = useState<{ attempt: number; error: boolean; members: TeamMember[]; lists: TeamListWithMembers[] } | null>(null);

    useEffect(() => {
        if (!enabled) return;
        let active = true;
        void (async () => {
            const [team, lists] = await Promise.allSettled([TeamConnectionService.listTeamMembers(), TeamListService.listLists()]);
            if (!active) return;
            setData({
                attempt,
                error: team.status === 'rejected' || lists.status === 'rejected',
                members: team.status === 'fulfilled' ? team.value : [],
                lists: lists.status === 'fulfilled' ? lists.value : [],
            });
        })();
        return () => { active = false; };
    }, [enabled, attempt]);

    return {
        loading: enabled && data?.attempt !== attempt,
        error: data?.error ?? false,
        members: data?.members ?? [],
        lists: data?.lists ?? [],
        retry: () => setAttempt((a) => a + 1),
    };
}

export interface InvitePair {
    row: ShiftDraftRow;
    workerIds: string[];
}

/** Quem, entre os convidados de cada turno, já está em outro turno no horário (F: só avisa). */
export function useRowBusy(companyId: string, pairs: InvitePair[]): { row_key: string; worker_id: string }[] {
    const key = JSON.stringify(pairs.map((p) => [p.row.key, p.row.date, p.row.start_time, p.row.end_time, p.workerIds]));
    const [result, setResult] = useState<{ key: string; busy: { row_key: string; worker_id: string }[] }>({ key: '', busy: [] });

    useEffect(() => {
        let active = true;
        void (async () => {
            const busy: { row_key: string; worker_id: string }[] = [];
            for (const [rowKey, date, start, end, ids] of JSON.parse(key) as [string, string, string, string, string[]][]) {
                if (!active) return;
                if (!ids.length) continue;
                const found = await getBusyWorkerIds({ companyId, window: buildShiftWindow(date, start, end), workerIds: ids });
                found.forEach((worker_id) => busy.push({ row_key: rowKey, worker_id }));
            }
            if (active) setResult({ key, busy });
        })();
        return () => { active = false; };
    }, [companyId, key]);

    return result.key === key ? result.busy : [];
}

const weekStart = (date: string) => addDays(date, -weekdayOf(date));

export interface RiskNotice {
    worker_id: string;
    week: string;
    count: number;
}

/** Guarda de vínculo (F5): turnos já confirmados na semana + os deste lote, acima do limite. */
export function useBatchLinkRisk(companyId: string, pairs: InvitePair[]): RiskNotice[] {
    const workerKey = useMemo(() => [...new Set(pairs.flatMap((p) => p.workerIds))].sort().join(','), [pairs]);
    const dateKey = [...new Set(pairs.filter((p) => p.workerIds.length).map((p) => p.row.date))].sort().join(',');
    const queryKey = `${workerKey}#${dateKey}`;
    const [data, setData] = useState<{ key: string; config: LinkRiskConfig; counts: Map<string, number> } | null>(null);

    useEffect(() => {
        if (!workerKey || !dateKey) return;
        let active = true;
        void (async () => {
            const dates = dateKey.split(',');
            try {
                const [config, counts] = await Promise.all([
                    LinkRiskService.getConfig(companyId).catch(() => DEFAULT_LINK_RISK_CONFIG),
                    LinkRiskService.countForRange(workerKey.split(','), dates[0], dates[dates.length - 1]),
                ]);
                if (active) setData({ key: `${workerKey}#${dateKey}`, config, counts });
            } catch (err) {
                logError('shiftBatch.linkRisk', err);
            }
        })();
        return () => { active = false; };
    }, [companyId, workerKey, dateKey]);

    if (!data || data.key !== queryKey || !data.config.enabled) return [];
    const inBatch = new Map<string, number>();
    for (const { row, workerIds } of pairs) {
        for (const id of workerIds) {
            const k = `${id}|${weekStart(row.date)}`;
            inBatch.set(k, (inBatch.get(k) ?? 0) + 1);
        }
    }
    return [...inBatch].flatMap(([k, own]) => {
        const count = own + (data.counts.get(k) ?? 0);
        const [worker_id, week] = k.split('|');
        return count > data.config.threshold ? [{ worker_id, week, count }] : [];
    });
}
