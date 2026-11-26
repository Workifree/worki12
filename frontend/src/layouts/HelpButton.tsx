/**
 * O ÚNICO botão de ajuda/copiloto. Sem a flag abre o guia "Me mostre"; com ela vira a pílula do copiloto
 * (barra de comando; Ctrl+K também), que leva ao guia. No computador a pílula flutua no topo da tela
 * (renderizada pelo próprio copiloto), então aqui só sobra o espaço reservado; no celular ela fica
 * no cabeçalho, com brilho e texto. Em rota que o copiloto não alcança, volta a abrir o guia.
 */
import { useLocation } from 'react-router-dom';
import { BotaoComoFaco, type BotaoComoFacoProps } from '../components/guide/BotaoComoFaco';
import { TriggerBody } from '../components/copilot/Trigger';
import { useGuide } from '../hooks/useGuide';
import { isCopilotEnabled } from '../lib/copilot/flags';
import { requestOpen } from '../lib/copilot/openEvent';
import { pathPolicy } from '../lib/copilot/routes';

export default function HelpButton(props: Pick<BotaoComoFacoProps, 'variante' | 'className'>) {
    const { pathname } = useLocation();
    const contexto = useGuide();
    const copilot = isCopilotEnabled() && pathPolicy(pathname) !== 'blocked';
    if (!copilot) return <BotaoComoFaco {...props} />;
    if (!contexto?.papel) return null;
    // Desktop: a pílula flutuante do copiloto substitui este botão; só reserva a faixa do topo.
    if (props.variante === 'linha') return <div aria-hidden="true" className="h-10" />;
    return (
        <button
            type="button"
            aria-label="Ajuda e copiloto"
            aria-haspopup="dialog"
            data-page-agent-ignore="true"
            onClick={(evento) => {
                const r = evento.currentTarget.getBoundingClientRect();
                requestOpen(r.width || r.height ? { x: r.left + r.width / 2, y: r.top + r.height / 2 } : undefined);
            }}
            className={`wk-trigger relative mr-2 !min-h-11 !px-3 md:hidden ${props.className ?? ''}`}
        >
            <TriggerBody compact />
        </button>
    );
}
