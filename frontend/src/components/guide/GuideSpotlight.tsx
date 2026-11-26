import { useCallback, useEffect, useRef, useState } from 'react';
import type { KeyboardEvent } from 'react';
import { createPortal } from 'react-dom';
import { Hand, Pause } from 'lucide-react';
import { Button } from '../ui';
import { useTopDialogElement } from '../../hooks/useModalDismiss';
import { useGuideTarget } from '../../hooks/useGuideTarget';
import { posicionarBalao } from '../../lib/guide/alvo';
import { alvoEhRiscoD } from '../../lib/guide/api';
import { TOS_GATE_SELECTOR } from '../../lib/copilot/dom';
import { ROTAS, estaNaRota, type RotaId } from '../../lib/guide/rotas';
import type { PassoAtivo } from '../../lib/guide/tipos';

export interface GuideSpotlightProps {
    passo: PassoAtivo;
    indice: number;
    total: number;
    pathname: string;
    /** `true` quando a pessoa pediu este passo pelo balão ou pela ajuda: o foco vai para ele. */
    focar: boolean;
    onProximo: () => void;
    onVoltar: () => void;
    onSair: () => void;
    onIrPara: (rota: RotaId) => void;
    /** A pessoa tocou no alvo (o guia só observa). */
    onToqueNoAlvo: (avanca: boolean) => void;
    onAlvoVisivel: (visivel: boolean | null) => void;
}

/** Sobe a camada para o top layer (acima de menus e dialogs). Sem suporte, vale o z-index. */
function noTopo(elemento: HTMLDivElement | null) {
    if (!elemento || typeof elemento.showPopover !== 'function') return;
    try {
        elemento.setAttribute('popover', 'manual');
        if (!elemento.matches(':popover-open')) elemento.showPopover();
    } catch {
        elemento.removeAttribute('popover');
    }
}

const CAMADA =
    'pointer-events-none fixed inset-0 z-[95] m-0 h-full max-h-none w-full max-w-none overflow-visible border-0 bg-transparent p-0';

/**
 * Destaque + balão. O recorte não captura toque: a pessoa usa a tela normalmente e nunca fica presa.
 * Com um `<dialog>` modal aberto, o resto da página é inerte, então a camada é desenhada DENTRO dele.
 */
export function GuideSpotlight({
    passo, indice, total, pathname, focar,
    onProximo, onVoltar, onSair, onIrPara, onToqueNoAlvo, onAlvoVisivel,
}: GuideSpotlightProps) {
    const modal = useTopDialogElement();
    const naRota = !passo.rota
        || [passo.rota, ...(passo.tambemEm ?? [])].some((rota) => estaNaRota(pathname, rota));
    const { elemento, area, tela, ausente } = useGuideTarget(passo.alvos, modal, naRota);

    const riscoD = passo.risco === 'D'
        || !!elemento?.closest('[data-copilot-risk="D"]')
        || alvoEhRiscoD(elemento?.getAttribute('data-copilot') ?? '');
    const ultimo = indice === total - 1;

    const visivel = !naRota ? false : elemento ? true : ausente ? false : null;
    useEffect(() => { onAlvoVisivel(visivel); }, [visivel, onAlvoVisivel]);

    // Observa o toque da própria pessoa. Nunca chama click() nem cancela o evento.
    useEffect(() => {
        if (!elemento) return;
        const aoTocar = (evento: Event) => {
            if (!(evento.target instanceof Node) || !elemento.contains(evento.target)) return;
            const avanca = !riscoD && !!passo.avancaAoTocar;
            if (!avanca && !ultimo) return;
            // Depois do handler da própria tela.
            window.setTimeout(() => onToqueNoAlvo(avanca), 0);
        };
        document.addEventListener('click', aoTocar, true);
        return () => document.removeEventListener('click', aoTocar, true);
    }, [elemento, riscoD, ultimo, passo.avancaAoTocar, onToqueNoAlvo]);

    // Janela aberta sem o alvo dentro (ex.: confirmação): encolhe para não cobrir as ações dela.
    const pausado = !!modal && !elemento;

    const [no, setNo] = useState<HTMLDivElement | null>(null);
    const camada = useCallback((div: HTMLDivElement | null) => {
        noTopo(div);
        setNo(div);
    }, []);

    const balaoRef = useRef<HTMLDivElement>(null);
    useEffect(() => {
        if (focar && no) balaoRef.current?.focus({ preventScroll: true });
    }, [focar, no]);

    // Região viva preenchida depois de montada, para o leitor de tela anunciar.
    const resumo = `Passo ${indice + 1} de ${total}: ${passo.titulo}. ${passo.explicacao}`;
    const [anuncio, setAnuncio] = useState('');
    useEffect(() => {
        const t = window.setTimeout(() => setAnuncio(resumo), 150);
        return () => window.clearTimeout(t);
    }, [resumo, no]);

    // Os Termos são um aceite obrigatório: o guia some enquanto estiverem na tela.
    if (modal?.querySelector(TOS_GATE_SELECTOR)) return null;

    const aoTeclar = (e: KeyboardEvent<HTMLDivElement>) => {
        if (e.key !== 'Escape') return;
        // Só com o foco no balão: sai do guia sem fechar o modal por baixo.
        e.preventDefault();
        e.stopPropagation();
        onSair();
    };

    const rota = passo.rota ? ROTAS[passo.rota] : null;
    const irPara: RotaId | undefined = !naRota && rota
        ? rota.destino ? passo.rota
            : rota.partirDe && !estaNaRota(pathname, rota.partirDe) ? rota.partirDe : undefined
        : undefined;
    const posicao = posicionarBalao(naRota ? area : null, tela);
    // Alvo fora da janela (ainda rolando até ele) ou sem tamanho: escurecer a tela sem recorte nenhum
    // deixa a pessoa no escuro. Sem recorte visível, não há escurecimento.
    const recorteVisivel = !!area && area.width > 0 && area.bottom > area.top && area.bottom > 0 && area.top < tela.altura;

    return createPortal(
        <div ref={camada} data-guide="camada" className={CAMADA}>
            <p className="sr-only" aria-live="polite">{anuncio}</p>

            {naRota && area && recorteVisivel && !pausado && (
                <div
                    aria-hidden="true"
                    data-guide="destaque"
                    className="pointer-events-none fixed rounded-xl border-2 border-black outline outline-4 outline-primary"
                    style={{
                        top: area.top - 4,
                        left: area.left - 4,
                        width: area.width + 8,
                        height: area.bottom - area.top + 8,
                        boxShadow: '0 0 0 100vmax rgb(0 0 0 / 0.45)',
                    }}
                />
            )}

            <div
                ref={balaoRef}
                role="dialog"
                aria-modal="false"
                aria-label={`Guia: ${passo.titulo}`}
                aria-describedby="guia-texto"
                tabIndex={-1}
                onKeyDown={aoTeclar}
                className="pointer-events-auto fixed overflow-y-auto overscroll-contain rounded-2xl border-2 border-black bg-white p-4 text-left shadow-brutal focus:outline-none focus-visible:ring-2 focus-visible:ring-black"
                style={pausado
                    ? { top: 8, left: posicao.left, width: posicao.width, maxHeight: posicao.maxHeight }
                    : posicao}
            >
                {pausado ? (
                    <div id="guia-texto" className="flex items-center gap-2">
                        <Pause size={16} aria-hidden="true" className="shrink-0" />
                        <p className="min-w-0 flex-1 text-sm font-bold">Guia: {passo.titulo}</p>
                        {!ultimo && <Button variant="ghost" size="sm" onClick={onProximo}>Próximo</Button>}
                        <Button variant="secondary" size="sm" onClick={onSair}>Sair</Button>
                    </div>
                ) : (
                    <>
                        <div className="flex items-center justify-between gap-2">
                            <p className="text-xs text-gray-600">
                                {total > 1 ? `Passo ${indice + 1} de ${total}` : 'Guia'}
                            </p>
                            <Button variant="ghost" size="sm" onClick={onSair}>Sair do guia</Button>
                        </div>
                        <h2 className="text-base font-bold">{passo.titulo}</h2>
                        <div id="guia-texto" className="mt-1 space-y-2 text-sm text-gray-700 [overflow-wrap:anywhere]">
                            <p>{passo.explicacao}</p>
                            {naRota && passo.aoTocar && (
                                <p><span className="font-bold text-black">Ao tocar: </span>{passo.aoTocar}</p>
                            )}
                            {!naRota && rota && (
                                <p className="rounded-xl border-2 border-gray-200 p-2">
                                    {rota.destino ? `Este passo fica na tela ${rota.nome}.` : rota.comoChegar}
                                </p>
                            )}
                            {naRota && ausente && (
                                <p className="rounded-xl border-2 border-gray-200 p-2" data-guide="sem-alvo">
                                    {passo.semAlvo ?? 'Não encontrei esse botão nesta tela agora.'}
                                </p>
                            )}
                            {naRota && !elemento && !ausente && passo.alvos.length > 0 && (
                                <p className="text-gray-600">Procurando na tela...</p>
                            )}
                            {riscoD && (
                                <p className="flex items-start gap-2 font-bold text-black">
                                    <Hand size={16} aria-hidden="true" className="mt-0.5 shrink-0" />
                                    O guia só mostra. Quem decide e toca é você.
                                </p>
                            )}
                        </div>
                        <div className="mt-3 flex flex-wrap justify-end gap-2">
                            {indice > 0 && <Button variant="ghost" onClick={onVoltar}>Voltar</Button>}
                            {irPara && (
                                <Button variant="secondary" onClick={() => onIrPara(irPara)}>
                                    Ir para {ROTAS[irPara].nome}
                                </Button>
                            )}
                            {elemento && !riscoD && (
                                <Button variant="ghost" onClick={() => elemento.focus()}>Ir até o botão</Button>
                            )}
                            <Button variant="dark" onClick={onProximo}>{ultimo ? 'Concluir' : 'Próximo'}</Button>
                        </div>
                    </>
                )}
            </div>
        </div>,
        modal ?? document.body,
    );
}

export default GuideSpotlight;
