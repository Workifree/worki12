import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

const service = vi.hoisted(() => ({
    publishBatch: vi.fn(),
    dispatchCall: vi.fn(),
    countPublishedBatch: vi.fn(),
    listRecentModels: vi.fn(),
    listExistingShifts: vi.fn(),
    listJobsBetween: vi.fn(),
    listPreviousWorkerIds: vi.fn(),
    getModelJob: vi.fn(),
}));

vi.mock('../../services/shiftBatchService', async (importOriginal) => ({
    ...(await importOriginal<typeof import('../../services/shiftBatchService')>()),
    ...service,
}));
vi.mock('../../lib/supabase', () => {
    const chain = { select: () => chain, eq: () => chain, maybeSingle: async () => ({ data: null, error: null }) };
    return {
        supabase: {
            from: () => chain,
            rpc: vi.fn(async () => ({ data: [], error: null })),
            auth: {
                getSession: async () => ({ data: { session: { user: { id: 'u1' } } } }),
                onAuthStateChange: () => ({ data: { subscription: { unsubscribe: () => {} } } }),
            },
        },
    };
});
vi.mock('../../services/teamConnectionService', () => ({
    TeamConnectionService: {
        listTeamMembers: vi.fn(async () => [{ connection: { id: 'c1' }, worker: { id: 'w1', full_name: 'Ana', primary_role: 'garcom' } }]),
    },
}));
vi.mock('../../services/teamListService', () => ({
    TeamListService: { listLists: vi.fn(async () => [{ id: 'l1', name: 'Garçons', memberIds: ['w1'] }]) },
}));
vi.mock('../../services/linkRiskService', () => ({
    DEFAULT_LINK_RISK_CONFIG: { enabled: true, threshold: 2 },
    LinkRiskService: { getConfig: async () => ({ enabled: true, threshold: 2 }), countForRange: async () => new Map() },
}));

import { ShiftBatchFlow } from './ShiftBatchFlow';

const model = {
    id: 'j0', title: 'Garçom evento', category: 'garcom', description: 'Salão', budget: 150, budget_type: 'daily',
    start_date: '2026-01-01T15:00:00Z', work_start_time: '18:00', work_end_time: '23:00', slots: 1,
};

const renderFlow = () =>
    render(
        <MemoryRouter>
            <ShiftBatchFlow companyId="emp" isGestor tagsEnabled={false} />
        </MemoryRouter>,
    );

const typeText = (value: string) => {
    fireEvent.change(screen.getByLabelText('Colar ou digitar'), { target: { value } });
    fireEvent.click(screen.getByRole('button', { name: 'Montar turnos do texto' }));
};

beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    service.listRecentModels.mockResolvedValue([model]);
    service.listExistingShifts.mockResolvedValue([]);
});

describe('ShiftBatchFlow', () => {
    it('rápido: modelo, data e Publicar; duplo toque chama a publicação uma vez', async () => {
        let release: (value: unknown) => void = () => {};
        service.publishBatch.mockReturnValue(new Promise((resolve) => { release = resolve; }));
        renderFlow();
        fireEvent.click(await screen.findByRole('button', { name: /Garçom evento/ }));
        fireEvent.click(screen.getByRole('button', { name: /^Amanhã/ }));
        const publish = screen.getByRole('button', { name: 'Publicar' });
        fireEvent.click(publish);
        fireEvent.click(publish);
        expect(service.publishBatch).toHaveBeenCalledTimes(1);
        release({ ok: true, alreadyCreated: false, jobIds: ['n1'] });
        expect(await screen.findByText('1 turno publicado')).toBeTruthy();
        expect(screen.getByRole('link', { name: 'Chamar' }).getAttribute('href')).toBe('/company/jobs/n1/candidates?chamar=1');
    });

    it('sem data, o toque explica o que falta e não publica', async () => {
        renderFlow();
        fireEvent.click(await screen.findByRole('button', { name: /Garçom evento/ }));
        fireEvent.click(screen.getByRole('button', { name: 'Publicar' }));
        expect(screen.getByRole('alert').textContent).toContain('Falta: data.');
        expect(service.publishBatch).not.toHaveBeenCalled();
    });

    it('A9: texto só abre a revisão; nada é publicado sem o toque', async () => {
        renderFlow();
        typeText('amanhã e depois de amanhã 18-23h 3 garçons 150');
        expect(await screen.findByRole('button', { name: 'Publicar 2' })).toBeTruthy();
        expect(screen.getByRole('heading', { name: '2 turnos · 6 vagas' })).toBeTruthy();
        expect(service.publishBatch).not.toHaveBeenCalled();
    });

    it('texto não entendido fica no começo com o motivo', async () => {
        renderFlow();
        typeText('tal dia lá');
        expect(screen.getByRole('alert').textContent).toContain('Não entendi');
        expect(screen.queryByRole('button', { name: /^Publicar \d/ })).toBeNull();
    });

    it('A1: linhas iguais são juntadas à vista e "Separar" desfaz', async () => {
        renderFlow();
        typeText('amanhã 18-23h 3 garçons 150; amanhã 18-23h 2 garçons 150');
        expect(await screen.findByText('2 linhas iguais foram juntadas: 1 turno com 5 vagas.')).toBeTruthy();
        fireEvent.click(screen.getByRole('button', { name: 'Separar' }));
        expect(screen.getByRole('button', { name: 'Publicar 2' })).toBeTruthy();
    });

    it('A5: sem saída a revisão bloqueia o Publicar', async () => {
        renderFlow();
        typeText('amanhã 18h 3 garçons 150');
        const button = await screen.findByRole('button', { name: 'Publicar 1' });
        expect((button as HTMLButtonElement).disabled).toBe(true);
        expect(screen.getByText('Falta: saída.')).toBeTruthy();
    });

    it('A7: chamado que falha não desfaz turnos e só ele ganha "Tentar de novo"', async () => {
        service.publishBatch.mockResolvedValue({ ok: true, alreadyCreated: false, jobIds: ['n1', 'n2', 'n3'] });
        service.dispatchCall.mockImplementation(async (item: { job_id: string }) =>
            item.job_id === 'n2' ? { item, status: 'failed', error: 'cota' } : { item, status: 'sent' });
        renderFlow();
        typeText('amanhã 18-23h 1 garçom 150; amanhã 9-12h 1 garçom 150; amanhã 13-17h 1 garçom 150');
        fireEvent.click(await screen.findByRole('button', { name: 'Lista: Garçons' }));
        fireEvent.click(screen.getByRole('button', { name: 'Publicar 3' }));
        expect(await screen.findByText('Chamados: 2 enviados · 1 falhou')).toBeTruthy();
        expect(screen.getByText('3 turnos publicados')).toBeTruthy();
        const retry = screen.getAllByRole('button', { name: /Tentar de novo/ });
        expect(retry).toHaveLength(1);
        service.dispatchCall.mockImplementation(async (item: unknown) => ({ item, status: 'sent' }));
        fireEvent.click(retry[0]);
        expect(await screen.findByText('Chamados: 3 enviados')).toBeTruthy();
        expect(service.dispatchCall).toHaveBeenLastCalledWith(expect.objectContaining({ job_id: 'n2' }), expect.anything(), { retry: true });
        expect(service.publishBatch).toHaveBeenCalledTimes(1);
    });

    it('resposta perdida: repetir usa o mesmo id; editar confere o envio anterior antes de criar outro', async () => {
        service.publishBatch.mockResolvedValue({ ok: false, uncertain: true, errors: [], message: 'Sem resposta' });
        service.countPublishedBatch.mockResolvedValue(2);
        renderFlow();
        typeText('amanhã 18-23h 1 garçom 150; amanhã 9-12h 1 garçom 150');
        const publish = await screen.findByRole('button', { name: 'Publicar 2' });
        const sentIds = () => service.publishBatch.mock.calls.map((c) => c[1].client_batch_id);

        fireEvent.click(publish);
        await screen.findByText('Sem resposta');
        await waitFor(() => expect((publish as HTMLButtonElement).disabled).toBe(false));
        fireEvent.click(publish);
        await waitFor(() => expect(service.publishBatch).toHaveBeenCalledTimes(2));
        expect(new Set(sentIds()).size).toBe(1);
        await waitFor(() => expect((publish as HTMLButtonElement).disabled).toBe(false));

        // Edita (tira uma linha) e tenta publicar: o lote anterior existe, então para e avisa.
        fireEvent.click(screen.getAllByRole('button', { name: /^Editar/ })[0]);
        fireEvent.click(screen.getAllByRole('button', { name: /Opções do turno/ })[0]);
        fireEvent.click(screen.getByRole('menuitem', { name: 'Remover' }));
        fireEvent.click(screen.getByRole('button', { name: 'Revisar' }));
        fireEvent.click(screen.getByRole('button', { name: 'Publicar 1' }));
        expect(await screen.findByText(/o envio anterior criou 2 turno/)).toBeTruthy();
        expect(service.countPublishedBatch).toHaveBeenCalledWith('emp', sentIds()[0]);
        expect(service.publishBatch).toHaveBeenCalledTimes(2);
        const publishAgain = screen.getByRole('button', { name: 'Publicar 1' });
        await waitFor(() => expect((publishAgain as HTMLButtonElement).disabled).toBe(false));
        fireEvent.click(publishAgain);
        await waitFor(() => expect(service.publishBatch).toHaveBeenCalledTimes(3));
        expect(sentIds()[2]).not.toBe(sentIds()[0]);
    });

    it('calendário: várias datas viram linhas e a barra soma', async () => {
        renderFlow();
        fireEvent.click(await screen.findByRole('button', { name: /Garçom evento/ }));
        fireEvent.click(screen.getByRole('button', { name: 'Várias datas' }));
        fireEvent.click(screen.getByRole('button', { name: 'Próximo mês' }));
        const grid = screen.getByRole('group', { name: /^Datas de/ });
        const days = within(grid).getAllByRole('button');
        fireEvent.click(days[4]);
        fireEvent.click(days[5]);
        fireEvent.click(days[6]);
        expect(screen.getByRole('button', { name: 'Revisar (3)' })).toBeTruthy();
        expect(screen.getByText(/3 turnos · 3 vagas · R\$\s450,00 previstos/)).toBeTruthy();
    });
});
