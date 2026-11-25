/** Boas-vindas do primeiro acesso: no máximo 3 passos, sempre com "Pular". */
import type { PapelGuia } from './tipos';

export interface CartaoBoasVindas {
    titulo: string;
    texto: string;
}

const AJUDA: CartaoBoasVindas = {
    titulo: 'Ajuda quando precisar',
    texto: 'Toque em "Como faço…?" e escreva do seu jeito. O app mostra na tela onde tocar. No modo de mostrar, quem toca é sempre você.',
};

export const BOAS_VINDAS: Readonly<Record<PapelGuia, readonly CartaoBoasVindas[]>> = {
    gestor: [
        { titulo: 'Boas-vindas ao Worki', texto: 'Aqui você cria turnos, chama seu Elenco, confere presença e registra pagamentos.' },
        { titulo: 'O pagamento é por fora', texto: 'Você paga por PIX ou dinheiro e registra no Worki. O recibo fica guardado para os dois lados.' },
        AJUDA,
    ],
    encarregado: [
        { titulo: 'Você entrou na equipe', texto: 'Você cuida dos turnos sob sua responsabilidade: chamar freelas, conferir presença e registrar pagamento.' },
        { titulo: 'Alguns menus são do Gestor', texto: 'Se algo não aparece para você, peça ao Gestor.' },
        AJUDA,
    ],
    freela: [
        { titulo: 'Boas-vindas ao Worki', texto: 'Aqui chegam seus convites de turno. Você decide se aceita e registra chegada e saída.' },
        { titulo: 'Seu pagamento', texto: 'A empresa paga direto a você e registra aqui. Cadastre sua chave PIX e só confirme depois que o dinheiro chegar.' },
        AJUDA,
    ],
};
