/**
 * API ESTÁVEL do guia para o copiloto (e qualquer código fora da árvore React).
 * Só mostra: nenhuma função aqui clica, preenche, envia ou aceita rota/seletor livre.
 * Contrato documentado em `.harness/spec/copiloto-worki/integracao-guia.md`.
 */
import { ROTAS, type RotaId } from './rotas';
import { ROTEIROS } from './roteiros';
import { listarRoteiros } from './escolha';
import type { AlvoGuia, PapelGuia } from './tipos';

export { listarRoteiros };
export type { OpcaoDeRoteiro } from './escolha';

const FORMATO_ALVO = /^(empresa|freela|publico)\.[a-z0-9-]+\.[a-z0-9-]+$/;
const LIMITE_TITULO = 80;
const LIMITE_EXPLICACAO = 280;

/** Alvos que o catálogo marca como risco D (a tela também marca com `data-copilot-risk`). */
const ALVOS_D: ReadonlySet<string> = new Set(
    ROTEIROS.flatMap((r) => r.passos.filter((p) => p.risco === 'D').flatMap((p) => p.alvos)),
);

export const alvoEhRiscoD = (alvo: string): boolean => ALVOS_D.has(alvo);

/** O formato estrito também impede injeção de seletor CSS. */
export function alvoValido(valor: unknown, papel: PapelGuia): valor is AlvoGuia {
    if (typeof valor !== 'string' || !FORMATO_ALVO.test(valor)) return false;
    return valor.startsWith(papel === 'freela' ? 'freela.' : 'empresa.');
}

/** Texto vindo de fora: uma linha, curto, exibido só como texto puro. */
export function limparTexto(texto: unknown, limite: number): string {
    if (typeof texto !== 'string') return '';
    const limpo = texto.replace(/\s+/g, ' ').trim();
    return limpo.length > limite ? `${limpo.slice(0, limite - 1)}…` : limpo;
}

export interface PedidoDeDestaque {
    explicacao: string;
    titulo?: string;
}

export function prepararDestaque(pedido: string | PedidoDeDestaque): { titulo: string; explicacao: string } {
    const p = typeof pedido === 'string' ? { explicacao: pedido } : pedido;
    return {
        titulo: limparTexto(p.titulo, LIMITE_TITULO) || 'É aqui',
        explicacao: limparTexto(p.explicacao, LIMITE_EXPLICACAO),
    };
}

export type MotivoRecusa = 'guia-indisponivel' | 'roteiro-desconhecido' | 'alvo-invalido' | 'rota-nao-permitida';
export type Resultado = { ok: true } | { ok: false; motivo: MotivoRecusa };

export interface EstadoDoGuia {
    /** `false` fora das telas logadas ou sem papel definido. */
    disponivel: boolean;
    papel: PapelGuia | null;
    ativo: null | {
        /** `null` = destaque avulso. */
        roteiroId: string | null;
        passo: number;
        total: number;
        /** `null` enquanto procura (ou passo sem alvo). */
        alvoVisivel: boolean | null;
    };
}

export interface RotaPermitida {
    id: RotaId;
    nome: string;
    padrao: string;
    /** `false`: depende de um item que só a pessoa escolhe. */
    navegavel: boolean;
}

export function rotasPermitidas(papel?: PapelGuia): RotaPermitida[] {
    return (Object.keys(ROTAS) as RotaId[])
        .filter((id) => !papel || id === 'comum.ajuda' || id.startsWith(papel === 'freela' ? 'freela.' : 'empresa.'))
        .filter((id) => !papel || papelAlcanca(papel, id))
        .map((id) => ({ id, nome: ROTAS[id].nome, padrao: ROTAS[id].padrao, navegavel: !!ROTAS[id].destino }));
}

const SO_GESTOR: ReadonlySet<RotaId> = new Set<RotaId>([
    'empresa.indicacoes', 'empresa.relatorio', 'empresa.operacao', 'empresa.equipe', 'empresa.dados', 'empresa.mensagens',
]);

export function papelAlcanca(papel: PapelGuia, rota: RotaId): boolean {
    return !(papel === 'encarregado' && SO_GESTOR.has(rota));
}

export interface ControladorDoGuia {
    destacar(alvo: unknown, pedido: string | PedidoDeDestaque): Resultado;
    iniciarRoteiro(id: unknown): Resultado;
    irPara(rota: unknown): Resultado;
    abrirAjuda(): Resultado;
    sair(): void;
}

const INDISPONIVEL: Resultado = { ok: false, motivo: 'guia-indisponivel' };
export const SEM_GUIA: EstadoDoGuia = { disponivel: false, papel: null, ativo: null };

let controlador: ControladorDoGuia | null = null;
let estado: EstadoDoGuia = SEM_GUIA;
const ouvintes = new Set<() => void>();

/** Uso exclusivo do `GuideProvider`. */
export function registrarControlador(novo: ControladorDoGuia): () => void {
    controlador = novo;
    return () => {
        if (controlador === novo) controlador = null;
    };
}

/** Uso exclusivo do `GuideProvider`. */
export function publicarEstado(novo: EstadoDoGuia): void {
    if (JSON.stringify(novo) === JSON.stringify(estado)) return;
    estado = novo;
    ouvintes.forEach((ouvinte) => ouvinte());
}

export const guia = {
    destacar: (alvo: unknown, pedido: string | PedidoDeDestaque): Resultado =>
        controlador?.destacar(alvo, pedido) ?? INDISPONIVEL,
    iniciarRoteiro: (id: unknown): Resultado => controlador?.iniciarRoteiro(id) ?? INDISPONIVEL,
    /** Abre uma rota da lista fechada que tenha destino fixo. */
    irPara: (rota: unknown): Resultado => controlador?.irPara(rota) ?? INDISPONIVEL,
    abrirAjuda: (): Resultado => controlador?.abrirAjuda() ?? INDISPONIVEL,
    sair: (): void => controlador?.sair(),
    listarRoteiros,
    rotasPermitidas,
    estado: (): EstadoDoGuia => estado,
    assinar(ouvinte: () => void): () => void {
        ouvintes.add(ouvinte);
        return () => { ouvintes.delete(ouvinte); };
    },
};
