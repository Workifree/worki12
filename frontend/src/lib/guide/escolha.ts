/**
 * Costura para a IA. Ao escolher um roteiro ela só pode devolver um id desta lista fechada: não cria
 * passo, rota, seletor nem ação. Tudo o que voltar passa por `resolverEscolha`.
 *
 * Quem implementar com modelo remoto precisa antes redigir dados pessoais da pergunta (mapa, §7).
 */
import { buscarRoteiros } from './busca';
import { roteirosDoPapel } from './roteiros';
import type { PapelGuia, RoteiroGuia } from './tipos';

export interface OpcaoDeRoteiro {
    id: string;
    titulo: string;
    descricao: string;
}

export interface EscolhedorDeRoteiro {
    /** A resposta é `unknown` de propósito: nada é confiado sem validação. */
    escolher(pergunta: string, opcoes: readonly OpcaoDeRoteiro[]): Promise<unknown>;
}

export function listarRoteiros(papel: PapelGuia): OpcaoDeRoteiro[] {
    return roteirosDoPapel(papel).map(({ id, titulo, descricao }) => ({ id, titulo, descricao }));
}

/** Só aceita o id exato de um roteiro do papel. */
export function resolverEscolha(papel: PapelGuia, resposta: unknown): RoteiroGuia | null {
    if (typeof resposta !== 'string') return null;
    return roteirosDoPapel(papel).find((r) => r.id === resposta) ?? null;
}

export async function escolherRoteiro(
    papel: PapelGuia,
    pergunta: string,
    escolhedor: EscolhedorDeRoteiro,
): Promise<RoteiroGuia | null> {
    try {
        return resolverEscolha(papel, await escolhedor.escolher(pergunta, listarRoteiros(papel)));
    } catch {
        return null;
    }
}

/** Implementação sem IA: o primeiro resultado da busca local. */
export function escolhedorLocal(papel: PapelGuia): EscolhedorDeRoteiro {
    return { escolher: async (pergunta) => buscarRoteiros(papel, pergunta, 1)[0]?.id ?? null };
}
