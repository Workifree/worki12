/** Busca local em linguagem simples: sem acento, com sinônimos, sem modelo de linguagem. */
import { roteirosDoPapel } from './roteiros';
import { estaNaRota } from './rotas';
import type { PapelGuia, RoteiroGuia } from './tipos';

const VAZIAS = new Set([
    'a', 'o', 'as', 'os', 'um', 'uma', 'de', 'do', 'da', 'dos', 'das', 'no', 'na', 'nos', 'nas', 'em', 'e', 'ou',
    'para', 'pra', 'pro', 'por', 'com', 'que', 'eu', 'me', 'meu', 'minha', 'meus', 'minhas', 'como', 'faco', 'fazer',
    'faz', 'posso', 'quero', 'preciso', 'consigo', 'onde', 'fica', 'ver', 'se', 'ao', 'vou',
]);

/** Cada grupo é uma ideia; os termos já vêm sem acento e no singular. */
const SINONIMOS: readonly (readonly string[])[] = [
    ['freela', 'freelancer', 'funcionario', 'garcom', 'pessoa', 'colaborador', 'trabalhador', 'gente'],
    ['turno', 'vaga', 'diaria', 'plantao', 'escala', 'bico', 'evento'],
    ['pagar', 'pagamento', 'paguei', 'pago', 'acerto', 'pix', 'dinheiro', 'recebimento', 'recibo', 'recebi'],
    ['chamar', 'convidar', 'convite', 'convocar', 'chamado'],
    ['presenca', 'chegada', 'checkin', 'ponto', 'entrada', 'cheguei', 'chegou'],
    ['saida', 'checkout', 'sai'],
    ['cancelar', 'excluir', 'apagar', 'desmarcar', 'desistir', 'remover'],
    ['criar', 'publicar', 'abrir', 'novo', 'nova', 'cadastrar', 'adicionar'],
    ['mensagem', 'chat', 'conversa', 'falar'],
    ['elenco', 'equipe', 'time'],
];

export function normalizar(texto: string): string {
    return texto
        .normalize('NFD')
        .replace(/\p{Diacritic}/gu, '')
        .toLowerCase()
        .replace(/check[\s-]*(in|out)\b/g, 'check$1')
        .replace(/[^a-z0-9]+/g, ' ')
        .trim();
}

const singular = (p: string): string => (p.length > 3 && p.endsWith('s') ? p.slice(0, -1) : p);

export function termos(texto: string): string[] {
    return normalizar(texto)
        .split(' ')
        .filter((p) => p.length > 1 && !VAZIAS.has(p))
        .map(singular);
}

/** Igual, começo de palavra (a pessoa ainda digitando) ou mesmo radical longo. */
function parecido(termo: string, palavra: string): boolean {
    if (termo === palavra) return true;
    if (termo.length >= 3 && palavra.startsWith(termo)) return true;
    let i = 0;
    while (i < termo.length && termo[i] === palavra[i]) i += 1;
    return i >= 5;
}

function pontuarTermo(termo: string, palavras: readonly string[]): number {
    if (palavras.some((p) => parecido(termo, p))) return 3;
    const grupos = SINONIMOS.filter((g) => g.some((s) => parecido(termo, s)));
    return grupos.some((g) => g.some((s) => palavras.includes(s))) ? 1 : 0;
}

export function buscarRoteiros(papel: PapelGuia, consulta: string, limite = 6): RoteiroGuia[] {
    const procurados = termos(consulta);
    if (procurados.length === 0) return [];
    return roteirosDoPapel(papel)
        .map((roteiro) => {
            const titulo = termos(roteiro.titulo);
            const resto = termos(`${roteiro.descricao} ${roteiro.frases.join(' ')}`);
            let pontos = 0;
            let achados = 0;
            for (const termo of procurados) {
                const valor = pontuarTermo(termo, titulo) * 2 + pontuarTermo(termo, resto);
                pontos += valor;
                if (valor > 0) achados += 1;
            }
            // Metade dos termos precisa casar: uma palavra solta numa frase longa não é resposta.
            return { roteiro, achados, pontos: achados * 2 >= procurados.length ? pontos : 0 };
        })
        .filter((r) => r.pontos > 0)
        .sort((a, b) => b.achados - a.achados || b.pontos - a.pontos)
        .slice(0, limite)
        .map((r) => r.roteiro);
}

/** Roteiros que começam nesta tela primeiro; depois os que passam por ela. */
export function sugestoesDaTela(papel: PapelGuia, pathname: string, limite = 4): RoteiroGuia[] {
    return roteirosDoPapel(papel)
        .map((roteiro) => ({ roteiro, indice: roteiro.passos.findIndex((p) => estaNaRota(pathname, p.rota)) }))
        .filter((r) => r.indice >= 0)
        .sort((a, b) => a.indice - b.indice)
        .slice(0, limite)
        .map((r) => r.roteiro);
}
