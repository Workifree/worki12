import { useEffect, useId, useState } from 'react';
import { Button, DialogActions, DialogHeader } from '../ui';
import { Dialog } from '../ui/Dialog';
import { useTopDialogElement } from '../../hooks/useModalDismiss';
import { BOAS_VINDAS } from '../../lib/guide/boasVindas';
import type { PapelGuia } from '../../lib/guide/tipos';

/** Dá tempo de Termos e convite em tela cheia aparecerem primeiro. */
export const ESPERA_BOAS_VINDAS_MS = 1200;

export interface GuideWelcomeProps {
    papel: PapelGuia;
    onFechar: () => void;
}

export function GuideWelcome({ papel, onFechar }: GuideWelcomeProps) {
    const [aberto, setAberto] = useState(false);
    const [indice, setIndice] = useState(0);
    const tituloId = useId();
    const outroModal = useTopDialogElement();
    const bloqueado = !aberto && !!outroModal;

    useEffect(() => {
        if (aberto || bloqueado) return;
        const t = window.setTimeout(() => setAberto(true), ESPERA_BOAS_VINDAS_MS);
        return () => window.clearTimeout(t);
    }, [aberto, bloqueado]);

    if (!aberto) return null;

    const cartoes = BOAS_VINDAS[papel];
    const cartao = cartoes[indice];
    const ultimo = indice === cartoes.length - 1;

    return (
        <Dialog labelledBy={tituloId} onClose={onFechar} focusKey={String(indice)} initialFocus="panel">
            <DialogHeader
                titleId={tituloId}
                title={cartao.titulo}
                subtitle={`${indice + 1} de ${cartoes.length}`}
                onClose={onFechar}
            />
            <p className="text-sm text-gray-700" aria-live="polite">{cartao.texto}</p>
            <DialogActions>
                {!ultimo && <Button variant="secondary" onClick={onFechar}>Pular</Button>}
                <Button
                    variant={papel === 'freela' ? 'primary' : 'dark'}
                    onClick={() => (ultimo ? onFechar() : setIndice(indice + 1))}
                >
                    {ultimo ? 'Começar' : 'Próximo'}
                </Button>
            </DialogActions>
        </Dialog>
    );
}

export default GuideWelcome;
