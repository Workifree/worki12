/** Progresso do guia, por usuário e papel, só neste aparelho. Armazenamento bloqueado não quebra nada. */
import type { PapelGuia } from './tipos';

export interface ProgressoGuia {
    boasVindasVistas: boolean;
    concluidos: string[];
    checklistOculto: boolean;
}

export const PROGRESSO_VAZIO: ProgressoGuia = { boasVindasVistas: false, concluidos: [], checklistOculto: false };

const chave = (userId: string, papel: PapelGuia) => `worki:guia:v1:${userId}:${papel}`;

/** Cópia em memória para quando o armazenamento falha (aba anônima, cota). */
const memoria = new Map<string, ProgressoGuia>();

export function lerProgresso(userId: string, papel: PapelGuia): ProgressoGuia {
    const k = chave(userId, papel);
    try {
        const bruto = window.localStorage.getItem(k);
        if (!bruto) return memoria.get(k) ?? PROGRESSO_VAZIO;
        const dados = JSON.parse(bruto) as Partial<ProgressoGuia> | null;
        return {
            boasVindasVistas: dados?.boasVindasVistas === true,
            concluidos: Array.isArray(dados?.concluidos)
                ? dados.concluidos.filter((id): id is string => typeof id === 'string')
                : [],
            checklistOculto: dados?.checklistOculto === true,
        };
    } catch {
        return memoria.get(k) ?? PROGRESSO_VAZIO;
    }
}

export function gravarProgresso(userId: string, papel: PapelGuia, progresso: ProgressoGuia): void {
    const k = chave(userId, papel);
    try {
        window.localStorage.setItem(k, JSON.stringify(progresso));
        memoria.delete(k);
    } catch {
        memoria.set(k, progresso);
    }
}
