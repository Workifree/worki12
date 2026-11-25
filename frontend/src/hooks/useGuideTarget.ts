import { useEffect, useState } from 'react';
import { encontrarAlvo, medirTela, type Area, type Tela } from '../lib/guide/alvo';
import type { AlvoGuia } from '../lib/guide/tipos';

export const ESPERA_DO_ALVO_MS = 3500;
const INTERVALO_MS = 200;

export interface AlvoNaTela {
    elemento: HTMLElement | null;
    area: Area | null;
    tela: Tela;
    /** Passou o prazo sem achar. A busca continua: se aparecer depois, é destacado. */
    ausente: boolean;
}

const reduzMovimento = () => window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;

/**
 * Acompanha o alvo (tela lazy, esqueleto, rolagem, rotação). Consulta periódica em vez de observar
 * o DOM inteiro: barata, e cobre mudança de posição sem mutação.
 * O estado nasce zerado a cada montagem: quem usa monta um por passo (`key`).
 */
export function useGuideTarget(alvos: readonly AlvoGuia[], modal: Element | null, ativo: boolean): AlvoNaTela {
    const [estado, setEstado] = useState<AlvoNaTela>(() => ({
        elemento: null, area: null, tela: medirTela(), ausente: false,
    }));
    const chave = alvos.join(' ');

    useEffect(() => {
        if (!ativo) return;
        const lista = chave ? (chave.split(' ') as AlvoGuia[]) : [];
        const inicio = Date.now();
        let rolado: HTMLElement | null = null;

        const medir = () => {
            const elemento = encontrarAlvo(lista, modal);
            const tela = medirTela();
            if (elemento && elemento !== rolado) {
                rolado = elemento;
                const r = elemento.getBoundingClientRect();
                if (r.top < tela.topoLivre || r.bottom > tela.altura - tela.baseLivre) {
                    elemento.scrollIntoView?.({ block: 'center', behavior: reduzMovimento() ? 'auto' : 'smooth' });
                }
            }
            const r = elemento?.getBoundingClientRect();
            const area = r ? { top: r.top, bottom: r.bottom, left: r.left, width: r.width } : null;
            const ausente = !elemento && lista.length > 0 && Date.now() - inicio >= ESPERA_DO_ALVO_MS;
            setEstado((antes) =>
                antes.elemento === elemento && antes.ausente === ausente &&
                JSON.stringify([antes.area, antes.tela]) === JSON.stringify([area, tela])
                    ? antes
                    : { elemento, area, tela, ausente });
        };

        const primeiro = window.setTimeout(medir, 0);
        const intervalo = window.setInterval(medir, INTERVALO_MS);
        window.addEventListener('resize', medir);
        window.addEventListener('scroll', medir, true);
        return () => {
            window.clearTimeout(primeiro);
            window.clearInterval(intervalo);
            window.removeEventListener('resize', medir);
            window.removeEventListener('scroll', medir, true);
        };
    }, [chave, modal, ativo]);

    return estado;
}
