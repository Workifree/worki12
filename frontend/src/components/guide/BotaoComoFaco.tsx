import { HelpCircle } from 'lucide-react';
import { Button, IconButton } from '../ui';
import { useGuide } from '../../hooks/useGuide';

export interface BotaoComoFacoProps {
    /** `icone`: cabeçalho do celular. `linha`: lateral do desktop. Nunca flutuante. */
    variante?: 'icone' | 'linha';
    /** O copiloto passa a própria abertura e compõe `<ConteudoComoFaco>` no painel dele. */
    aoAbrir?: () => void;
    rotulo?: string;
    className?: string;
}

/** ÚNICO botão de ajuda do app (do guia hoje, do copiloto depois). */
export function BotaoComoFaco({ variante = 'icone', aoAbrir, rotulo = 'Como faço…?', className }: BotaoComoFacoProps) {
    const contexto = useGuide();
    if (!contexto?.papel) return null;
    const abrir = aoAbrir ?? contexto.abrirAjuda;

    if (variante === 'icone') {
        return (
            <IconButton aria-label={rotulo} aria-haspopup="dialog" onClick={abrir} className={className}>
                <HelpCircle size={20} />
            </IconButton>
        );
    }
    return (
        <Button
            variant="secondary"
            aria-haspopup="dialog"
            onClick={abrir}
            iconLeft={<HelpCircle size={18} aria-hidden="true" />}
            className={className}
        >
            {rotulo}
        </Button>
    );
}

export default BotaoComoFaco;
