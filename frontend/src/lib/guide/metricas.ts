/**
 * Uso do guia pela camada de analytics existente. Só ids do catálogo, papel e faixas: NUNCA o texto
 * digitado, texto vindo do copiloto, nome, id de turno ou URL.
 */
import { AnalyticsService } from '../../services/analytics';
import type { RotaId } from './rotas';
import type { PapelGuia } from './tipos';

export type OrigemGuia = 'ajuda' | 'sugestao' | 'checklist' | 'copiloto';

export function registrarInicio(papel: PapelGuia, roteiro: string, origem: OrigemGuia): void {
    void AnalyticsService.trackEvent('guia_roteiro_iniciado', { papel, roteiro, origem });
}

export function registrarConclusao(papel: PapelGuia, roteiro: string): void {
    void AnalyticsService.trackEvent('guia_roteiro_concluido', { papel, roteiro });
}

export function registrarBuscaSemResultado(papel: PapelGuia, quantidadeDeTermos: number, tela: RotaId | null): void {
    void AnalyticsService.trackEvent('guia_busca_sem_resultado', {
        papel,
        termos: quantidadeDeTermos >= 4 ? '4+' : String(quantidadeDeTermos),
        tela: tela ?? 'outra',
    });
}
