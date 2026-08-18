/**
 * Frase única da prévia (dry-run) de uma ação em massa de série — mesma distinção de "dois
 * baldes" que a tela de RESULTADO já mostra (freela confirmado vs. chamado aberto), só que
 * ANTES de confirmar. Compartilhada entre `EditSeriesModal` e `CancelSeriesModal` para as duas
 * nunca divergirem de redação.
 *
 * Ex.: describeSeriesPreview(12, 'serão cancelados', 'será cancelado', { skippedFilled: 3, skippedCalled: 1 })
 *   → "12 turnos serão cancelados. 3 serão mantidos porque já têm freela confirmado e 1 porque tem chamado aberto."
 */
export interface SeriesPreviewSkipCounts {
    skippedFilled: number;
    skippedCalled: number;
}

export function describeSeriesPreview(
    mainCount: number,
    mainVerbPlural: string,
    mainVerbSingular: string,
    counts: SeriesPreviewSkipCounts,
): string {
    const mainSentence = `${mainCount} turno${mainCount !== 1 ? 's' : ''} ${mainCount === 1 ? mainVerbSingular : mainVerbPlural}.`;

    const parts: string[] = [];
    if (counts.skippedFilled > 0) {
        parts.push(
            `${counts.skippedFilled} ${counts.skippedFilled === 1 ? 'será mantido' : 'serão mantidos'} porque já ${counts.skippedFilled === 1 ? 'tem' : 'têm'} freela confirmado`,
        );
    }
    if (counts.skippedCalled > 0) {
        parts.push(`${counts.skippedCalled} porque ${counts.skippedCalled === 1 ? 'tem' : 'têm'} chamado aberto`);
    }

    if (parts.length === 0) return mainSentence;
    return `${mainSentence} ${parts.join(' e ')}.`;
}
