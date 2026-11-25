/**
 * Contrato do guia vivo (modo "Me mostre": funciona sem IA). O guia NUNCA clica, preenche ou envia:
 * só navega por rota da lista fechada, destaca e espera a pessoa tocar.
 */
import type { RotaId } from './rotas';

export type PapelGuia = 'gestor' | 'encarregado' | 'freela';

/** Id de âncora `data-copilot` (convenção: `.harness/spec/copiloto-worki/mapa-de-intencoes.md`, §8). */
export type AlvoGuia = `${'empresa' | 'freela' | 'publico'}.${string}.${string}`;

export interface PassoGuia {
    rota: RotaId;
    /** Âncoras em ordem de preferência; vale a primeira visível. Vazio = passo só de explicação. */
    alvos: readonly AlvoGuia[];
    titulo: string;
    explicacao: string;
    aoTocar: string;
    /** Mostrado quando nenhum alvo está na tela (estado vazio, outra aba, sem permissão). */
    semAlvo?: string;
    /** `D`: dinheiro, presença, consentimento, acesso ou exclusão. O guia só mostra. */
    risco?: 'D';
    /** Tocar no alvo já leva ao próximo passo. Nunca em passo `D`. */
    avancaAoTocar?: boolean;
    /** Outras telas em que o passo também vale. */
    tambemEm?: readonly RotaId[];
    /** Avança quando a PESSOA chega a esta tela. */
    avancaAoChegar?: RotaId;
}

/** Passo em exibição. `rota` ausente = destaque avulso, na tela em que a pessoa estiver. */
export type PassoAtivo = Omit<PassoGuia, 'rota'> & { rota?: RotaId };

export interface RoteiroGuia {
    id: string;
    papeis: readonly PapelGuia[];
    titulo: string;
    descricao: string;
    /** Outras formas de pedir a mesma coisa (busca local). */
    frases: readonly string[];
    passos: readonly PassoGuia[];
}
