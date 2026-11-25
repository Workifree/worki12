import { describe, it, expect } from 'vitest';
import appSource from '../App.tsx?raw';
import {
    COMPANY_CREATE_ACTION, NOTIFICATIONS_PATHS, SECTION_TABS, WORKER_PROFILE_LINK,
    getCompanyNav, getGestaoGroups, getWorkerNav, isNavActive, toBottomNav,
    type NavItem, isGestorOnlyPath } from './navigation';

/** Lê do próprio App.tsx as rotas montadas dentro de um layout: rota nova sem caminho quebra aqui. */
function layoutRoutes(startMarker: string, endMarker: string, prefix: string): string[] {
    const start = appSource.indexOf(startMarker);
    const end = appSource.indexOf(endMarker, start);
    expect(start).toBeGreaterThan(-1);
    expect(end).toBeGreaterThan(start);
    return [...appSource.slice(start, end).matchAll(/<Route path="([^"]+)" element/g)]
        .map((m) => m[1])
        .filter((path) => !path.startsWith('/'))
        .map((path) => `${prefix}/${path}`);
}

const workerRoutes = layoutRoutes('{/* Worker Layout Routes */}', '{/* Company Layout Routes */}', '');
const companyRoutes = layoutRoutes('{/* Company Layout Routes */}', '<Route path="*"', '/company');

/** Telas de detalhe: abertas a partir de uma lista, com id. Precisam marcar o item certo. */
const CONTEXTUAL: Record<string, string> = {
    '/company/jobs/:id': 'turnos',
    '/company/jobs/:id/edit': 'turnos',
    '/company/jobs/:id/candidates': 'turnos',
    '/company/worker/:id': 'elenco',
    '/company/empresa/:id': 'elenco',
    '/empresa/:id': 'empresas',
};

/** Destinos que abrem uma seção levam também às abas irmãs. */
function expandTabs(paths: string[]): Set<string> {
    const reachable = new Set(paths);
    for (const tabs of Object.values(SECTION_TABS)) {
        if (tabs.some((t) => reachable.has(t.path))) tabs.forEach((t) => reachable.add(t.path));
    }
    return reachable;
}

function companyReachable(device: 'desktop' | 'mobile', hasTeam: boolean): Set<string> {
    const items = getCompanyNav({ isEncarregado: false, hasTeam });
    const nav = device === 'desktop' ? items : toBottomNav(items);
    const cards = getGestaoGroups({ gestor: true, units: true, teamInvited: hasTeam, trail: true })
        .flatMap((g) => g.cards)
        .filter((c) => device === 'mobile' || !c.mobileOnly);
    const direct = [
        ...nav.map((i) => i.path),
        ...cards.map((c) => c.path),
        COMPANY_CREATE_ACTION.path,
        NOTIFICATIONS_PATHS.company,
    ];
    // Sem equipe as abas de Início não são renderizadas: não contam como caminho.
    return hasTeam ? expandTabs(direct) : new Set([...expandTabs(direct.filter((p) => p !== '/company/dashboard')), '/company/dashboard']);
}

const staticRoutes = (routes: string[]) => routes.filter((r) => !r.includes(':'));

describe('navegação — toda rota de página é alcançável', () => {
    it('as rotas foram lidas do App.tsx', () => {
        expect(workerRoutes).toContain('/indicacoes');
        expect(companyRoutes).toContain('/company/gestao');
        expect(companyRoutes.length).toBeGreaterThan(15);
    });

    it.each(['desktop', 'mobile'] as const)('empresa com equipe (%s)', (device) => {
        const reachable = companyReachable(device, true);
        expect(staticRoutes(companyRoutes).filter((r) => !reachable.has(r))).toEqual([]);
    });

    it.each(['desktop', 'mobile'] as const)('dono único (%s): só a tela Hoje fica de fora', (device) => {
        const reachable = companyReachable(device, false);
        expect(staticRoutes(companyRoutes).filter((r) => !reachable.has(r))).toEqual(['/company/hoje']);
    });

    it('freela (desktop e celular têm os mesmos destinos, mais perfil e sino)', () => {
        const reachable = expandTabs([
            ...toBottomNav(getWorkerNav()).map((i) => i.path),
            WORKER_PROFILE_LINK.path,
            NOTIFICATIONS_PATHS.worker,
        ]);
        expect(staticRoutes(workerRoutes).filter((r) => !reachable.has(r))).toEqual([]);
    });

    it('toda rota com id marca o item da sua seção', () => {
        const parametrized = [...workerRoutes, ...companyRoutes].filter((r) => r.includes(':'));
        for (const route of parametrized) {
            const items = route.startsWith('/company/')
                ? getCompanyNav({ isEncarregado: false, hasTeam: false })
                : getWorkerNav();
            const active = items.filter((i) => isNavActive(route.replace(':id', 'abc'), i)).map((i) => i.id);
            expect({ route, active }).toEqual({ route, active: [CONTEXTUAL[route]] });
        }
    });
});

describe('navegação — estado ativo', () => {
    const activeIds = (items: NavItem[], path: string) => items.filter((i) => isNavActive(path, i)).map((i) => i.id);
    const company = getCompanyNav({ isEncarregado: false, hasTeam: true });

    it.each([
        ['/company/hoje', 'inicio'],
        ['/company/dashboard', 'inicio'],
        ['/company/create', 'turnos'],
        ['/company/indicacoes', 'elenco'],
        ['/company/operacao', 'relatorios'],
        ['/company/configuracoes/equipe', 'gestao'],
        ['/company/trilha', 'gestao'],
    ])('lateral: %s marca %s', (path, id) => {
        expect(activeIds(company, path)).toEqual([id]);
    });

    it('notificações não marcam nada', () => {
        expect(activeIds(company, '/company/notifications')).toEqual([]);
        expect(activeIds(getWorkerNav(), '/notifications')).toEqual([]);
    });

    it('celular: Relatórios marca Gestão e a barra tem 5 itens', () => {
        const bottom = toBottomNav(company);
        expect(bottom.map((i) => i.label)).toEqual(['Início', 'Turnos', 'Elenco', 'Mensagens', 'Gestão']);
        expect(activeIds(bottom, '/company/relatorio')).toEqual(['gestao']);
    });

    it('encarregado: quatro itens (com Elenco, sem Mensagens e Relatórios) e, em Gestão, só trilha e ajuda', () => {
        const items = getCompanyNav({ isEncarregado: true, hasTeam: true });
        expect(items.map((i) => i.label)).toEqual(['Início', 'Turnos', 'Elenco', 'Gestão']);
        expect(isGestorOnlyPath('/company/messages')).toBe(true);
        expect(toBottomNav(items)).toHaveLength(4);
        const cards = getGestaoGroups({ gestor: false, units: false, teamInvited: false, trail: true })
            .flatMap((g) => g.cards.map((c) => c.id));
        expect(cards).toEqual(['trilha', 'ajuda']);
    });

    it('Início aponta para Hoje só com equipe', () => {
        expect(getCompanyNav({ isEncarregado: false, hasTeam: true })[0].path).toBe('/company/hoje');
        expect(getCompanyNav({ isEncarregado: false, hasTeam: false })[0].path).toBe('/company/dashboard');
    });
});
