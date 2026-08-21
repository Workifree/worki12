import { useEffect, useMemo, useState } from 'react';
import { X, Loader2, Send, Users, CheckCircle2, AlertTriangle } from 'lucide-react';
import { useToast } from '../../contexts/ToastContext';
import { logError } from '../../lib/logger';
import { ShiftCallService } from '../../services/shiftCallService';
import { LinkRiskService, type LinkRiskConfig } from '../../services/linkRiskService';
import { useCompanyTeam } from '../../hooks/useTeamConnections';
import type { TeamMember } from '../../types';

import {
    DEFAULT_LINK_RISK_THRESHOLD,
    weeksOverThreshold,
    weekRangeLabel,
    type InviteSeriesTarget,
} from './seriesWeekRisk';

// Re-exportado para quem já importa o tipo a partir do componente (ex.: CompanyJobs.tsx).
export type { InviteSeriesTarget } from './seriesWeekRisk';


/** Quantas requisições de `createShiftCall` disparar em paralelo por vez (R10). */
const INVITE_BATCH_SIZE = 10;

interface InviteSeriesModalProps {
    /** Ocorrências futuras, abertas e ainda sem freela desta série (calculadas pelo pai). */
    targets: InviteSeriesTarget[];
    onClose: () => void;
    onDone: () => void;
}

/**
 * R10 — "Convidar [freela] para a série inteira": dispara UM chamado de turno (F1) por
 * ocorrência ainda sem freela, todos para o mesmo freela escolhido. É estritamente o mesmo
 * resultado de convidar ocorrência por ocorrência à mão (A7) — só em lote, em lotes de
 * `INVITE_BATCH_SIZE` para não disparar dezenas de requisições simultâneas de uma vez.
 *
 * F5 (guarda de vínculo, `ddl-aprovado.md` §3) — refactor de unificação: o aviso de frequência
 * ANTES era calculado uma única vez, worker-independente, contando SÓ as ocorrências desta
 * série — metade do número que a empresa precisa ver. Agora é por freela: uma única chamada
 * `LinkRiskService.countForRange()` para o elenco inteiro (mesmo carregamento de
 * `useCompanyTeam`, não uma RPC por membro) devolve a carga preexistente de cada um, e o selo
 * aparece na linha de CADA freela na lista, calculado com `weeksOverThreshold(targets,
 * threshold, existingByWeek)`. Nunca bloqueia o botão "Convidar" (A7) — é informação, a decisão
 * é da empresa (R7).
 */
export default function InviteSeriesModal({ targets, onClose, onDone }: InviteSeriesModalProps) {
    const { addToast } = useToast();
    const { teamMembers, loading: teamLoading } = useCompanyTeam();
    const [inviting, setInviting] = useState(false);
    const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
    const [result, setResult] = useState<{ invited: number; failed: number } | null>(null);

    // F5 — estado PRÓPRIO da guarda de vínculo: nunca segura a lista do elenco (mesmo princípio
    // de LM-10 do `ShiftCallModal`). `riskByWorker`: workerId -> (weekStart -> contagem
    // preexistente naquela semana), montado a partir da chave composta `${workerId}|${weekStart}`
    // do contrato de `countForRange`.
    const [riskConfig, setRiskConfig] = useState<LinkRiskConfig | null>(null);
    const [riskByWorker, setRiskByWorker] = useState<Map<string, Map<string, number>>>(new Map());

    const targetJobIds = useMemo(() => targets.map((t) => t.jobId), [targets]);

    useEffect(() => {
        if (teamLoading || teamMembers.length === 0 || targets.length === 0) return;
        let active = true;
        void (async () => {
            const dates = targets.map((t) => t.occurrenceDate).slice().sort();
            const rangeStart = dates[0];
            const rangeEnd = dates[dates.length - 1];
            // `allSettled`: a lista de convite (useCompanyTeam) já renderiza independente deste
            // efeito — mas uma rejeição inesperada aqui não pode deixar `riskConfig`/`riskByWorker`
            // pendurados num estado inconsistente (defesa em profundidade, mesmo raciocínio do
            // `ShiftCallModal`).
            //
            // F5-11 (nit, registrado como decisão — não corrigido): diferente do `ShiftCallModal`
            // (que só dispara `countForShift` DEPOIS de saber que `enabled !== false`), aqui
            // `getConfig()` e `countForRange()` disparam juntos SEMPRE, mesmo quando a config
            // acabaria dizendo "desligado" — 1 chamada "desperdiçada" por abertura do modal quando
            // a empresa desliga o aviso. Gating explícito exigiria esperar a config responder
            // ANTES de disparar a contagem (2 idas ao servidor em série) — a MESMA troca que o
            // LM-9 rejeitou para o `ShiftCallModal` (e este modal, ao contrário daquele, não tem
            // pressa das 8h30, mas também não é gratuito reintroduzir serialização). Mantido
            // assimétrico de propósito.
            const [configResult, countsResult] = await Promise.allSettled([
                LinkRiskService.getConfig(),
                LinkRiskService.countForRange(
                    teamMembers.map((m) => m.worker.id),
                    rangeStart,
                    rangeEnd,
                ),
            ]);
            if (!active) return;
            const config = configResult.status === 'fulfilled' ? configResult.value : null;
            const counts = countsResult.status === 'fulfilled' ? countsResult.value : new Map<string, number>();
            setRiskConfig(config);
            const byWorker = new Map<string, Map<string, number>>();
            counts.forEach((count, key) => {
                const [workerId, weekStart] = key.split('|');
                if (!workerId || !weekStart) return;
                const forWorker = byWorker.get(workerId) ?? new Map<string, number>();
                forWorker.set(weekStart, count);
                byWorker.set(workerId, forWorker);
            });
            setRiskByWorker(byWorker);
        })();
        return () => {
            active = false;
        };
    }, [teamLoading, teamMembers, targets]);

    // `enabled !== false` trata config ainda não resolvida (undefined) como ligada — LM-6:
    // "undefined não é false", fail-safe na direção de mostrar o aviso, não escondê-lo.
    const riskEnabled = riskConfig?.enabled !== false;
    const riskThreshold = riskConfig?.threshold ?? DEFAULT_LINK_RISK_THRESHOLD;

    const handleInvite = async (workerId: string) => {
        setInviting(true);
        setProgress({ done: 0, total: targetJobIds.length });
        try {
            let invited = 0;
            let failed = 0;
            for (let i = 0; i < targetJobIds.length; i += INVITE_BATCH_SIZE) {
                const batch = targetJobIds.slice(i, i + INVITE_BATCH_SIZE);
                const outcomes = await Promise.all(
                    batch.map((jobId) => ShiftCallService.createShiftCall(jobId, [workerId]))
                );
                outcomes.forEach((o) => {
                    if (!o.error && o.invited > 0) invited++;
                    else failed++;
                });
                setProgress({ done: Math.min(i + INVITE_BATCH_SIZE, targetJobIds.length), total: targetJobIds.length });
            }
            if (failed > 0) {
                logError('InviteSeriesModal.handleInvite', new Error(`${failed} convite(s) falharam de ${targetJobIds.length}`));
            }
            setResult({ invited, failed });
            onDone();
        } catch (error) {
            logError('InviteSeriesModal.handleInvite', error);
            addToast('Não foi possível convidar o freela para a série. Tente novamente.', 'error');
        } finally {
            setInviting(false);
        }
    };

    return (
        <div className="fixed inset-0 z-50 bg-black/50 backdrop-blur-sm flex items-center justify-center p-4 animate-in fade-in duration-200">
            <div className="bg-white rounded-2xl border-2 border-black shadow-[8px_8px_0px_0px_rgba(0,0,0,1)] w-full max-w-md p-6">
                <div className="flex items-center justify-between mb-4">
                    <h2 className="text-xl font-black uppercase tracking-tight">Convidar para a série</h2>
                    <button onClick={onClose} aria-label="Fechar" className="p-2 hover:bg-gray-100 rounded-xl transition-colors min-w-[44px] min-h-[44px] flex items-center justify-center">
                        <X size={20} />
                    </button>
                </div>

                {!result && (
                    <>
                        <p className="text-sm font-bold text-gray-600 mb-4">
                            Escolha um freela do seu elenco para convidar de uma vez para {targetJobIds.length} turno{targetJobIds.length !== 1 ? 's' : ''} desta
                            série ainda sem freela.
                        </p>

                        {teamLoading && (
                            <div className="space-y-3 animate-pulse">
                                {[...Array(3)].map((_, i) => <div key={i} className="h-14 bg-gray-200 rounded-xl" />)}
                            </div>
                        )}

                        {!teamLoading && teamMembers.length === 0 && (
                            <div className="text-center py-8 border-2 border-dashed border-gray-200 rounded-2xl text-gray-400">
                                <Users size={32} className="mx-auto mb-2 opacity-30" />
                                <p className="font-bold text-sm">Seu elenco está vazio.</p>
                            </div>
                        )}

                        {!teamLoading && teamMembers.length > 0 && (
                            <div className="space-y-3 max-h-72 overflow-y-auto">
                                {teamMembers.map((member: TeamMember) => {
                                    const avatarUrl = member.worker.avatar_url ?? member.worker.photo_url ?? null;
                                    // F5 — por freela (R10/A7): soma a carga preexistente DESTE freela
                                    // às ocorrências-alvo da série antes de comparar com o limite.
                                    const existingByWeek = riskByWorker.get(member.worker.id) ?? new Map<string, number>();
                                    const riskyWeeks = riskEnabled
                                        ? weeksOverThreshold(targets, riskThreshold, existingByWeek)
                                        : [];
                                    return (
                                        <div key={member.connection.id} className="p-3 rounded-xl border-2 border-gray-100 hover:border-black transition-all">
                                            <div className="flex items-center gap-3">
                                                <div className="w-10 h-10 rounded-xl border-2 border-black overflow-hidden bg-gray-100 flex-shrink-0">
                                                    {avatarUrl ? (
                                                        <img src={avatarUrl} alt={member.worker.full_name} className="w-full h-full object-cover" />
                                                    ) : (
                                                        <div className="w-full h-full flex items-center justify-center bg-black text-white font-black">
                                                            {member.worker.full_name[0]?.toUpperCase()}
                                                        </div>
                                                    )}
                                                </div>
                                                <div className="flex-1 min-w-0">
                                                    <p className="font-black uppercase text-sm truncate">{member.worker.full_name}</p>
                                                    {/* Linha do cargo — reservada para o selo verde de disponibilidade
                                                        da F7 (spec pronta, ainda não construída). O selo de risco de
                                                        vínculo (amarelo) NÃO entra aqui, de propósito. */}
                                                    {member.worker.primary_role && (
                                                        <p className="text-xs font-bold text-gray-400 uppercase truncate">{member.worker.primary_role}</p>
                                                    )}
                                                </div>
                                                <button
                                                    onClick={() => handleInvite(member.worker.id)}
                                                    disabled={inviting}
                                                    className="min-h-[44px] bg-black hover:bg-primary text-white px-4 py-2 rounded-xl font-black uppercase text-xs flex items-center gap-1.5 transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex-shrink-0"
                                                >
                                                    {inviting ? <Loader2 className="animate-spin" size={14} /> : <Send size={14} />}
                                                    {inviting && progress ? `${progress.done}/${progress.total}` : inviting ? '...' : 'Convidar'}
                                                </button>
                                            </div>

                                            {/* R10/A7 — aviso NÃO-bloqueante, factual (nunca conclusão jurídica):
                                                o app informa a contagem por semana, quem decide é a empresa. */}
                                            {riskyWeeks.length > 0 && (
                                                <div className="mt-2 flex flex-wrap gap-1.5">
                                                    {riskyWeeks.map((w) => (
                                                        <span
                                                            key={w.weekStart}
                                                            className="inline-flex items-center gap-1 text-[10px] font-black uppercase text-yellow-700 bg-yellow-50 border border-yellow-300 rounded-pill px-2 py-0.5"
                                                        >
                                                            <AlertTriangle size={10} className="flex-shrink-0" />
                                                            Ficaria {w.count}x com você na sem. {weekRangeLabel(w.weekStart)}
                                                        </span>
                                                    ))}
                                                </div>
                                            )}
                                        </div>
                                    );
                                })}
                            </div>
                        )}

                        {teamMembers.length > 0 && riskEnabled && (
                            <p className="text-[11px] font-bold text-gray-400 mt-3">
                                Sua empresa avisa a partir de {riskThreshold}x na mesma semana (dom–sáb) para o
                                mesmo freela. A decisão de convidar é sua — consulte seu contador/jurídico se
                                tiver dúvida sobre frequência e risco de vínculo.
                            </p>
                        )}
                    </>
                )}

                {result && (
                    <div className="space-y-4">
                        <div className="flex items-start gap-3 p-4 rounded-xl border-2 border-primary bg-primary-light">
                            <CheckCircle2 size={20} className="text-primary flex-shrink-0 mt-0.5" />
                            <p className="text-sm font-bold text-primary-dark">
                                {result.invited} chamado{result.invited !== 1 ? 's' : ''} disparado{result.invited !== 1 ? 's' : ''}.
                            </p>
                        </div>
                        {result.failed > 0 && (
                            <div className="p-4 rounded-xl border-2 border-gray-200 bg-gray-50 text-sm font-bold text-gray-600">
                                {result.failed} turno{result.failed !== 1 ? 's' : ''} não recebeu convite — tente convidar manualmente na agenda.
                            </div>
                        )}
                        <button
                            onClick={onClose}
                            className="w-full min-h-[44px] bg-black hover:bg-primary text-white px-6 py-3 rounded-xl font-black uppercase text-sm transition-colors"
                        >
                            Fechar
                        </button>
                    </div>
                )}
            </div>
        </div>
    );
}
