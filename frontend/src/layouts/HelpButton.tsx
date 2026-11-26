/**
 * O ÚNICO botão de ajuda/copiloto. Sem a flag abre o guia "Me mostre"; com ela abre o copiloto
 * (barra de comando; Ctrl+K também), que leva ao guia. Em rota que o copiloto não alcança, volta a abrir o guia.
 */
import { useLocation } from 'react-router-dom';
import { Sparkles } from 'lucide-react';
import { BotaoComoFaco, type BotaoComoFacoProps } from '../components/guide/BotaoComoFaco';
import { isCopilotEnabled } from '../lib/copilot/flags';
import { requestOpen } from '../lib/copilot/openEvent';
import { pathPolicy } from '../lib/copilot/routes';

export default function HelpButton(props: Pick<BotaoComoFacoProps, 'variante' | 'className'>) {
    const { pathname } = useLocation();
    const copilot = isCopilotEnabled() && pathPolicy(pathname) !== 'blocked';
    return (
        <BotaoComoFaco
            {...props}
            aoAbrir={copilot ? (origem) => { requestOpen(origem); } : undefined}
            rotulo={copilot ? 'Ajuda e copiloto' : undefined}
            icone={copilot ? <Sparkles size={props.variante === 'linha' ? 18 : 20} aria-hidden="true" /> : undefined}
        />
    );
}
