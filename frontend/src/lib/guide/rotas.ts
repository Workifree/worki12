/**
 * LISTA FECHADA de rotas do guia. `destino` é o único caminho que o guia pode abrir (sempre
 * literal, sem parâmetro vindo de fora). Rota sem `destino` depende de um item que só a pessoa
 * escolhe (um turno, um recibo): o guia explica como chegar e oferece a lista (`partirDe`).
 *
 * Fora da lista de propósito, porque AGEM ao abrir ou são sensíveis: /convite*, /login,
 * /company/worker/:id, /company/trilha, /admin e qualquer `?conversation=` (mapa, §1).
 */
import { matchPath } from 'react-router-dom';

interface RotaDef {
    padrao: string;
    nome: string;
    destino?: string;
    comoChegar?: string;
    partirDe?: RotaId;
}

export type RotaId =
    | 'empresa.inicio' | 'empresa.hoje' | 'empresa.turnos' | 'empresa.criar' | 'empresa.turno'
    | 'empresa.presenca' | 'empresa.elenco' | 'empresa.indicacoes' | 'empresa.relatorio'
    | 'empresa.operacao' | 'empresa.equipe' | 'empresa.dados' | 'empresa.gestao'
    | 'empresa.mensagens' | 'empresa.notificacoes' | 'empresa.recibo'
    | 'freela.inicio' | 'freela.turnos' | 'freela.empresas' | 'freela.recebimentos'
    | 'freela.recibo' | 'freela.perfil' | 'freela.indicacoes' | 'freela.mensagens' | 'comum.ajuda';

export const ROTAS: Readonly<Record<RotaId, RotaDef>> = {
    'empresa.inicio': { padrao: '/company/dashboard', destino: '/company/dashboard', nome: 'Visão geral' },
    'empresa.hoje': { padrao: '/company/hoje', destino: '/company/hoje', nome: 'Hoje' },
    'empresa.turnos': { padrao: '/company/jobs', destino: '/company/jobs', nome: 'Turnos' },
    'empresa.criar': { padrao: '/company/create', destino: '/company/create', nome: 'Criar turno' },
    'empresa.turno': {
        padrao: '/company/jobs/:id', nome: 'o turno', partirDe: 'empresa.turnos',
        comoChegar: 'Em Turnos, toque no turno que você quer ver.',
    },
    'empresa.presenca': {
        padrao: '/company/jobs/:id/candidates', nome: 'Presença e pagamento', partirDe: 'empresa.turnos',
        comoChegar: 'Em Turnos, escolha o turno e abra a tela Presença e pagamento.',
    },
    'empresa.elenco': { padrao: '/company/team', destino: '/company/team', nome: 'Meu Elenco' },
    'empresa.indicacoes': { padrao: '/company/indicacoes', destino: '/company/indicacoes', nome: 'Indicações' },
    'empresa.relatorio': { padrao: '/company/relatorio', destino: '/company/relatorio', nome: 'Pagamentos' },
    'empresa.operacao': { padrao: '/company/operacao', destino: '/company/operacao', nome: 'Operação' },
    'empresa.equipe': {
        padrao: '/company/configuracoes/equipe', destino: '/company/configuracoes/equipe', nome: 'Equipe e acessos',
    },
    'empresa.dados': { padrao: '/company/profile', destino: '/company/profile', nome: 'Dados da empresa' },
    'empresa.gestao': { padrao: '/company/gestao', destino: '/company/gestao', nome: 'Gestão' },
    'empresa.mensagens': { padrao: '/company/messages', destino: '/company/messages', nome: 'Mensagens' },
    'empresa.notificacoes': { padrao: '/company/notifications', destino: '/company/notifications', nome: 'Notificações' },
    'empresa.recibo': {
        padrao: '/recibo/:jobId', nome: 'o recibo', partirDe: 'empresa.turnos',
        comoChegar: 'Na tela Presença e pagamento do turno, toque em ver recibo.',
    },
    'freela.inicio': { padrao: '/dashboard', destino: '/dashboard', nome: 'Início' },
    'freela.turnos': { padrao: '/my-jobs', destino: '/my-jobs', nome: 'Meus Turnos' },
    'freela.empresas': { padrao: '/carteira', destino: '/carteira', nome: 'Empresas' },
    'freela.recebimentos': { padrao: '/recebimentos', destino: '/recebimentos', nome: 'Recebimentos' },
    'freela.recibo': {
        padrao: '/recibo/:jobId', nome: 'o recibo', partirDe: 'freela.recebimentos',
        comoChegar: 'Em Recebimentos, abra o recibo do pagamento.',
    },
    'freela.perfil': { padrao: '/profile', destino: '/profile', nome: 'Meu perfil' },
    'freela.indicacoes': { padrao: '/indicacoes', destino: '/indicacoes', nome: 'Quem te indicou' },
    'freela.mensagens': { padrao: '/messages', destino: '/messages', nome: 'Mensagens' },
    'comum.ajuda': { padrao: '/ajuda', destino: '/ajuda', nome: 'Ajuda' },
};

export function estaNaRota(pathname: string, rota: RotaId): boolean {
    return matchPath({ path: ROTAS[rota].padrao, end: true }, pathname) !== null;
}

export function rotaAtual(pathname: string): RotaId | null {
    return (Object.keys(ROTAS) as RotaId[]).find((id) => estaNaRota(pathname, id)) ?? null;
}

/** Telas em que o guia não existe: entrada, convites, senha, cadastro e administração. */
const SEM_GUIA = [
    '/', '/login', '/esqueci-senha', '/redefinir-senha', '/sobre', '/admin',
    '/convite/*', '/convite-gerente/*', '/convite-equipe/*', '/company/onboarding', '/worker/onboarding',
];

export function guiaPermitidoEm(pathname: string): boolean {
    return !SEM_GUIA.some((path) => matchPath({ path, end: true }, pathname) !== null);
}
