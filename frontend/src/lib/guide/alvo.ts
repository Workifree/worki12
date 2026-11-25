/** Localização do alvo no DOM e posição do balão. Só leitura: nada aqui clica, foca ou preenche. */
import type { AlvoGuia } from './tipos';

function visivel(el: Element): boolean {
    for (let atual: Element | null = el; atual; atual = atual.parentElement) {
        if (atual.hasAttribute('hidden') || atual.hasAttribute('inert')) return false;
        const estilo = window.getComputedStyle(atual);
        if (estilo.display === 'none' || estilo.visibility === 'hidden') return false;
        // `<details>` fechado esconde tudo menos o resumo.
        const pai = atual.parentElement;
        if (pai?.tagName === 'DETAILS' && !pai.hasAttribute('open') && atual.tagName !== 'SUMMARY') return false;
    }
    return true;
}

/**
 * Primeiro alvo visível, na ordem de preferência (a mesma âncora pode existir no desktop e no
 * celular). Com um modal aberto, o que está fora dele é inerte: só vale o que está dentro.
 */
export function encontrarAlvo(alvos: readonly AlvoGuia[], modal: Element | null): HTMLElement | null {
    const raiz: ParentNode = modal ?? document;
    for (const id of alvos) {
        const achado = Array.from(raiz.querySelectorAll<HTMLElement>(`[data-copilot="${id}"]`)).find(visivel);
        if (achado) return achado;
    }
    return null;
}

export interface Area {
    top: number;
    bottom: number;
    left: number;
    width: number;
}

export interface Tela {
    largura: number;
    altura: number;
    /** Faixas ocupadas por cabeçalho fixo e barra inferior. */
    topoLivre: number;
    baseLivre: number;
}

export interface Posicao {
    top?: number;
    bottom?: number;
    left: number;
    width: number;
    maxHeight: number;
}

export function medirTela(): Tela {
    const cabecalho = document.querySelector('.worki-layout > header')?.getBoundingClientRect();
    const barra = document.querySelector('[data-bottom-nav]')?.getBoundingClientRect();
    return {
        largura: document.documentElement.clientWidth || window.innerWidth,
        altura: window.innerHeight,
        topoLivre: cabecalho && cabecalho.height > 0 ? Math.max(0, cabecalho.bottom) : 0,
        baseLivre: barra ? barra.height : 0,
    };
}

const MARGEM = 8;
const LARGURA = 360;
const ALTURA_MINIMA = 160;

/**
 * Balão: no celular ocupa a largura e encosta no lado oposto ao alvo; no desktop fica colado ao
 * alvo. A altura é limitada ao espaço que sobra (o conteúdo rola dentro).
 */
export function posicionarBalao(alvo: Area | null, tela: Tela): Posicao {
    const width = Math.min(LARGURA, tela.largura - MARGEM * 2);
    const estreita = tela.largura < 640;
    const teto = Math.max(ALTURA_MINIMA, tela.altura - tela.topoLivre - tela.baseLivre - MARGEM * 2);
    const centro = Math.round((tela.largura - width) / 2);
    const base = tela.baseLivre + MARGEM;

    if (!alvo) {
        return { bottom: base, left: centro, width, maxHeight: Math.min(teto, Math.round(tela.altura * 0.6)) };
    }

    const acima = alvo.top - tela.topoLivre - MARGEM * 2;
    const abaixo = tela.altura - tela.baseLivre - alvo.bottom - MARGEM * 2;
    const embaixo = abaixo >= acima;
    const maxHeight = Math.min(teto, Math.max(ALTURA_MINIMA, embaixo ? abaixo : acima));

    if (estreita) {
        return embaixo
            ? { bottom: base, left: centro, width, maxHeight }
            : { top: tela.topoLivre + MARGEM, left: centro, width, maxHeight };
    }

    const left = Math.round(
        Math.min(Math.max(MARGEM, alvo.left + alvo.width / 2 - width / 2), tela.largura - width - MARGEM),
    );
    // Sem espaço de nenhum lado (alvo enorme): o balão encosta na base.
    if (Math.max(acima, abaixo) < ALTURA_MINIMA) return { bottom: base, left, width, maxHeight };
    return embaixo
        ? { top: Math.round(alvo.bottom + MARGEM + 4), left, width, maxHeight }
        : { bottom: Math.round(tela.altura - alvo.top + MARGEM + 4), left, width, maxHeight };
}
