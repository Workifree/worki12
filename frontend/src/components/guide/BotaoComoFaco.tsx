import type { ReactNode } from 'react';
import { HelpCircle } from 'lucide-react';
import { Button, IconButton } from '../ui';
import { useGuide } from '../../hooks/useGuide';

export interface BotaoComoFacoProps {
    /** `icone`: cabeçalho do celular. `linha`: lateral do desktop. Nunca flutuante. */
    variante?: 'icone' | 'linha';
    /** O copiloto passa a própria abertura e compõe `<ConteudoComoFaco>` no painel dele. Recebe o ponto do toque. */
    aoAbrir?: (origem?: { x: number; y: number }) => void;
    rotulo?: string;
    /** Ícone próprio (o copiloto usa o dele). */
    icone?: ReactNode;
    className?: string;
}

/** ÚNICO botão de ajuda do app (do guia hoje, do copiloto depois). */
export function BotaoComoFaco({ variante = 'icone', aoAbrir, rotulo = 'Como faço…?', icone, className }: BotaoComoFacoProps) {
    const contexto = useGuide();
    if (!contexto?.papel) return null;
    const abrir = (evento: { currentTarget: HTMLElement }) => {
        if (!aoAbrir) return contexto.abrirAjuda();
        const r = evento.currentTarget.getBoundingClientRect();
        aoAbrir(r.width || r.height ? { x: r.left + r.width / 2, y: r.top + r.height / 2 } : undefined);
    };

    if (variante === 'icone') {
        return (
            <IconButton aria-label={rotulo} aria-haspopup="dialog" data-page-agent-ignore="true" onClick={abrir} className={className}>
                {icone ?? <HelpCircle size={20} />}
            </IconButton>
        );
    }
    return (
        <Button
            variant="secondary"
            aria-haspopup="dialog"
            data-page-agent-ignore="true"
            onClick={abrir}
            iconLeft={icone ?? <HelpCircle size={18} aria-hidden="true" />}
            className={className}
        >
            {rotulo}
        </Button>
    );
}

export default BotaoComoFaco;
