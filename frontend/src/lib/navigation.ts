/**
 * Fonte ÚNICA da navegação por papel: lateral, barra inferior, abas de seção, hub Gestão e botão
 * "Criar turno" leem daqui. Spec: `.harness/spec/navegacao-agrupada/spec.md`.
 *
 * Esconder item aqui é só não oferecer o que a pessoa não usa — a barreira real é o RLS
 * (e o `ProtectedRoute` para as rotas do Gestor).
 */
import {
    BarChart3, Briefcase, Building2, Contact, HelpCircle, Home, Inbox, LayoutGrid, MessageSquare,
    Network, Receipt, Trophy, UserCog, Users, type LucideIcon,
} from 'lucide-react';
import { matchPath } from 'react-router-dom';

export type NavRole = 'worker' | 'company';

export interface NavItem {
    id: string;
    label: string;
    /** Rótulo da barra inferior, quando o da lateral não cabe. */
    shortLabel?: string;
    icon: LucideIcon;
    path: string;
    /** Padrões de rota (react-router) em que o item fica ativo. */
    matches: readonly string[];
    /** Fora da barra inferior: no celular a rota "pertence" a este outro item. */
    mobileParent?: string;
}

export interface NavTab {
    label: string;
    path: string;
}

export interface CompanyNavContext {
    /** `true` também enquanto o papel é desconhecido: item só APARECE depois, nunca some. */
    isEncarregado: boolean;
    /** `hasTeamNav` (equipe ou encarregado): Início leva à tela Hoje. */
    hasTeam: boolean;
}

export const COMPANY_GESTAO_PATH = '/company/gestao';

export const ORGANIZATION_PATH = '/company/organization';

/** Rotas só do Gestor (guarda única em `GestorRouteGuard`). Indicações: as RPCs são Gestor-only. */
export const GESTOR_ONLY_ROUTES: readonly string[] = [
    '/company/indicacoes', '/company/relatorio', '/company/operacao', ORGANIZATION_PATH,
    '/company/configuracoes/*',
];

export function isGestorOnlyPath(pathname: string): boolean {
    return GESTOR_ONLY_ROUTES.some((pattern) => matchPath({ path: pattern, end: true }, pathname) !== null);
}

/** Ação primária da empresa (não é item de navegação). */
export const COMPANY_CREATE_ACTION = { label: 'Criar turno', path: '/company/create' } as const;

/** Telas em que o "Criar turno" flutua no celular. */
export const COMPANY_FAB_PATHS: readonly string[] = ['/company/dashboard', '/company/hoje', '/company/jobs'];

/** Perfil do freela: cartão no rodapé da lateral e avatar no cabeçalho do celular. */
export const WORKER_PROFILE_LINK = { label: 'Meu perfil', path: '/profile' } as const;

/** Aberto pelo sino; não marca item nenhum. */
export const NOTIFICATIONS_PATHS: Record<NavRole, string> = {
    worker: '/notifications',
    company: '/company/notifications',
};

export const SECTION_TABS = {
    inicio: [
        { label: 'Hoje', path: '/company/hoje' },
        { label: 'Visão geral', path: '/company/dashboard' },
    ],
    elenco: [
        { label: 'Meu Elenco', path: '/company/team' },
        { label: 'Indicações', path: '/company/indicacoes' },
    ],
    relatorios: [
        { label: 'Pagamentos', path: '/company/relatorio' },
        { label: 'Operação', path: '/company/operacao' },
    ],
    empresas: [
        { label: 'Minhas empresas', path: '/carteira' },
        { label: 'Quem te indicou', path: '/indicacoes' },
    ],
} as const satisfies Record<string, readonly NavTab[]>;

export type SectionId = keyof typeof SECTION_TABS;

const tabPaths = (section: SectionId): string[] => SECTION_TABS[section].map((t) => t.path);

const WORKER_NAV: readonly NavItem[] = [
    { id: 'inicio', label: 'Início', icon: Home, path: '/dashboard', matches: ['/dashboard'] },
    // "Meus Turnos", não "Convites": o rótulo descreve o DESTINO (information scent).
    { id: 'turnos', label: 'Meus Turnos', shortLabel: 'Turnos', icon: Inbox, path: '/my-jobs', matches: ['/my-jobs'] },
    { id: 'empresas', label: 'Empresas', icon: Contact, path: '/carteira', matches: [...tabPaths('empresas'), '/empresa/:id'] },
    { id: 'recebimentos', label: 'Recebimentos', icon: Receipt, path: '/recebimentos', matches: ['/recebimentos'] },
    { id: 'mensagens', label: 'Mensagens', icon: MessageSquare, path: '/messages', matches: ['/messages'] },
];

export function getWorkerNav(): NavItem[] {
    return [...WORKER_NAV];
}

export function getCompanyNav({ isEncarregado, hasTeam }: CompanyNavContext): NavItem[] {
    const items: Array<NavItem & { gestorOnly?: boolean }> = [
        {
            id: 'inicio', label: 'Início', icon: Home,
            path: hasTeam ? '/company/hoje' : '/company/dashboard',
            matches: tabPaths('inicio'),
        },
        {
            id: 'turnos', label: 'Turnos', icon: Briefcase, path: '/company/jobs',
            matches: ['/company/jobs/*', COMPANY_CREATE_ACTION.path],
        },
        {
            // O encarregado confirmado lê o Elenco e traz freelas (R7/R10b), em modo restrito.
            id: 'elenco', label: 'Elenco', icon: Users, path: '/company/team',
            matches: [...tabPaths('elenco'), '/company/worker/:id', '/company/empresa/:id'],
        },
        { id: 'mensagens', label: 'Mensagens', icon: MessageSquare, path: '/company/messages', matches: ['/company/messages'] },
        {
            id: 'relatorios', label: 'Relatórios', icon: BarChart3, path: '/company/relatorio', gestorOnly: true,
            matches: tabPaths('relatorios'), mobileParent: 'gestao',
        },
        {
            id: 'gestao', label: 'Gestão', icon: LayoutGrid, path: COMPANY_GESTAO_PATH,
            matches: [
                COMPANY_GESTAO_PATH, '/company/configuracoes/equipe', '/company/profile',
                '/company/organization', '/company/trilha',
            ],
        },
    ];
    return items.filter((item) => !(isEncarregado && item.gestorOnly));
}

/** Itens da barra inferior: quem tem `mobileParent` sai e empresta os `matches` ao pai. */
export function toBottomNav(items: readonly NavItem[]): NavItem[] {
    return items
        .filter((item) => !item.mobileParent)
        .map((item) => ({
            ...item,
            matches: [
                ...item.matches,
                ...items.filter((child) => child.mobileParent === item.id).flatMap((child) => child.matches),
            ],
        }));
}

export function isNavActive(pathname: string, item: Pick<NavItem, 'matches'>): boolean {
    return item.matches.some((pattern) => matchPath({ path: pattern, end: true }, pathname) !== null);
}

// ── Hub Gestão ───────────────────────────────────────────────────────────────────────────────

export interface GestaoCard {
    id: string;
    title: string;
    description: string;
    path: string;
    icon: LucideIcon;
    /** Só no celular: na lateral do desktop o destino já é um item próprio. */
    mobileOnly?: boolean;
}

export interface GestaoGroup {
    id: string;
    label: string;
    cards: GestaoCard[];
}

export interface GestaoAccess {
    /** Dono, operador ou gerente (`isGestor`). */
    gestor: boolean;
    /** `canSeeOrganization`. */
    units: boolean;
    /** A empresa já tem alguém na equipe. */
    teamInvited: boolean;
    /** `useBonusTrailAccess`. */
    trail: boolean;
}

export function getGestaoGroups({ gestor, units, teamInvited, trail }: GestaoAccess): GestaoGroup[] {
    const groups: GestaoGroup[] = [
        {
            id: 'pessoas', label: 'Pessoas',
            cards: gestor ? [{
                id: 'equipe', title: 'Equipe e acessos', icon: UserCog, path: '/company/configuracoes/equipe',
                description: teamInvited ? 'Quem opera a empresa com você' : 'Convidar quem te ajuda',
            }] : [],
        },
        {
            id: 'empresa', label: 'Empresa',
            cards: [
                ...(gestor ? [{
                    id: 'dados', title: 'Dados da empresa', icon: Building2, path: '/company/profile',
                    description: 'Perfil público, briefing padrão e conta',
                }] : []),
                ...(units ? [{
                    id: 'unidades', title: 'Unidades', icon: Network, path: '/company/organization',
                    description: 'Visão das lojas da sua rede',
                }] : []),
                ...(gestor ? [{
                    id: 'relatorios', title: 'Relatórios', icon: BarChart3, path: '/company/relatorio',
                    description: 'Pagamentos e operação', mobileOnly: true,
                }] : []),
            ],
        },
        {
            id: 'bonus', label: 'Meus bônus',
            cards: trail ? [{
                id: 'trilha', title: 'Trilha', icon: Trophy, path: '/company/trilha',
                description: 'Seus marcos e bônus por PIX',
            }] : [],
        },
        {
            id: 'suporte', label: 'Suporte',
            cards: [{ id: 'ajuda', title: 'Ajuda', icon: HelpCircle, path: '/ajuda', description: 'Perguntas frequentes' }],
        },
    ];
    return groups.filter((group) => group.cards.length > 0);
}
