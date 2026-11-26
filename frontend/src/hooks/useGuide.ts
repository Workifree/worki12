import { createContext, useContext, useSyncExternalStore } from 'react';
import { guia, type EstadoDoGuia } from '../lib/guide/api';
import type { OrigemGuia } from '../lib/guide/metricas';
import type { ProgressoGuia } from '../lib/guide/progresso';
import type { PapelGuia } from '../lib/guide/tipos';

export interface GuiaContextValue {
    /** `null` = guia indisponível nesta tela. */
    papel: PapelGuia | null;
    progresso: ProgressoGuia;
    definirPapel: (papel: PapelGuia | null) => void;
    iniciar: (id: string, origem: OrigemGuia) => void;
    abrirAjuda: () => void;
    ocultarChecklist: () => void;
}

export const GuiaContext = createContext<GuiaContextValue | null>(null);

/** `null` quando não há `GuideProvider` (testes de tela, rotas fora dele): quem usa não renderiza. */
export function useGuide(): GuiaContextValue | null {
    return useContext(GuiaContext);
}

/** Estado público do guia (o mesmo que o copiloto assina). */
export function useGuideState(): EstadoDoGuia {
    return useSyncExternalStore(guia.assinar, guia.estado, guia.estado);
}
