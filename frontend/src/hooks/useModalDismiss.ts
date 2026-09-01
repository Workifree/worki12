import { useEffect, useCallback } from 'react';

/**
 * Saída de emergência de modal (heurística #3 de Nielsen — controle e liberdade do usuário).
 *
 * Achado da avaliação heurística de 01/09/2026: NENHUM dos 24 modais do produto fechava com ESC
 * ou com toque no fundo escurecido — só pelo botão explícito. O único que tentava (RateModal)
 * usava `onKeyDown` na própria div, que só dispara com foco DENTRO dela; sem foco, o ESC nunca
 * chegava. Verificado no browser: ESC e backdrop ignorados.
 *
 * Este hook resolve os dois de uma vez:
 *  - ESC: listener no `document` (pega a tecla com qualquer foco);
 *  - fundo: devolve um onClick para o wrapper `fixed inset-0` que só fecha quando o clique foi
 *    NO PRÓPRIO fundo (`e.target === e.currentTarget`) — clique dentro do cartão nunca fecha.
 *
 * NÃO usar em modal que é gate de propósito (TosGateModal, convite obrigatório pós-criação de
 * turno): ali a impossibilidade de dispensar é a feature.
 */
export function useModalDismiss(onClose: () => void) {
    useEffect(() => {
        const aoTeclar = (e: KeyboardEvent) => {
            if (e.key === 'Escape') onClose();
        };
        document.addEventListener('keydown', aoTeclar);
        return () => document.removeEventListener('keydown', aoTeclar);
    }, [onClose]);

    return useCallback(
        (e: React.MouseEvent<HTMLElement>) => {
            if (e.target === e.currentTarget) onClose();
        },
        [onClose],
    );
}
