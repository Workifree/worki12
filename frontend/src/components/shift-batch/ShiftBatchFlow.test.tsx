import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

const service = vi.hoisted(() => ({
    publishBatch: vi.fn(),
    dispatchCall: vi.fn(),
    countPublishedBatch: vi.fn(),
    listRecentModels: vi.fn(),
    listExistingShifts: vi.fn(),
    getModelJob: vi.fn(),
}));

const templates = vi.hoisted(() => ({
    listShiftTemplates: vi.fn(),
    saveShiftTemplate: vi.fn(),
    setShiftTemplateArchived: vi.fn(),
}));
vi.mock('../../services/shiftTemplateService', () => templates);

const savedModel = vi.hoisted(() => ({
    id: 't1', name: 'Garçom sábado',
    template: {
        category: 'garcom', title: 'Garçom sábado', description: 'Salão', requirements: '', briefing: '',
        certification_requirement: null, location: '', budget_type: 'daily', has_lunch: false, tag_id: null,
    },
    defaults: { start_time: '18:00', end_time: '23:00', slots: 3, budget: 150 },
}));

// A área de modelos tem testes próprios: aqui basta saber que o fluxo a monta e recebe o modelo escolhido.
vi.mock('./TemplatesScreen', () => ({
    TemplatesScreen: ({ companyId, onUse, onBack }: { companyId: string; onUse: (t: unknown) => void; onBack: () => void }) => (
        <div>
            <p>Área de modelos de {companyId}</p>
            <button type="button" onClick={() => onUse(savedModel)}>Usar Garçom sábado</button>
            <button type="button" onClick={onBack}>Voltar</button>
        </div>
    ),
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
import { TeamConnectionService } from '../../services/teamConnectionService';
import { createRow, emptyTemplate, type ShiftDraftBatch } from '../../lib/shiftDrafts';
import { batchFromParse, parseShiftText } from '../../lib/shiftTextParser';
import { todayInBrazil } from '../../lib/dateUtils';
import { batchDraftKey, saveShiftDraft } from '../../lib/shiftDraftStorage';

const model = {
    id: 'j0', title: 'Garçom evento', category: 'garcom', description: 'Salão', budget: 150, budget_type: 'daily',
    start_date: '2026-01-01T15:00:00Z', work_start_time: '18:00', work_end_time: '23:00', slots: 1,
};

const saved = savedModel;

const renderFlow = (initialDraft?: ShiftDraftBatch | null) =>
    render(
        <MemoryRouter>
            <ShiftBatchFlow companyId="emp" isGestor tagsEnabled={false} initialDraft={initialDraft} />
        </MemoryRouter>,
    );

/** Entrada do copiloto: o texto vira rascunho e o fluxo abre direto na revisão. */
const renderReview = (text: string) => {
    const batch = batchFromParse(parseShiftText(text, { today: todayInBrazil() }));
    if (!batch) throw new Error('texto de teste não entendido');
    return renderFlow(batch);
};

/** Hub, Repetir um turno anterior, toque no turno. */
const repeatFromHistory = async (name: RegExp = /Garçom evento/) => {
    fireEvent.click(await screen.findByRole('button', { name: /Repetir um turno anterior/ }));
    fireEvent.click(await screen.findByRole('button', { name }));
};

/** No editor, "Quem vai trabalhar" é obrigatório: escolhe a lista do elenco. */
const pickList = async () => fireEvent.click(await screen.findByRole('button', { name: 'Lista: Garçons' }));

const storeDraft = () =>
    saveShiftDraft(batchDraftKey('u1', 'emp'), {
        batch: { client_batch_id: 'b1', source: 'form', template: { ...emptyTemplate('garcom'), title: 'Meu rascunho' }, rows: [createRow('2026-02-01')] },
        sent: null,
    });

beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    service.listRecentModels.mockResolvedValue([model]);
    service.listExistingShifts.mockResolvedValue([]);
    service.dispatchCall.mockImplementation(async (item: unknown) => ({ item, status: 'sent' }));
    templates.listShiftTemplates.mockResolvedValue([]);
    templates.saveShiftTemplate.mockResolvedValue({ ok: true, template: saved });
    templates.setShiftTemplateArchived.mockResolvedValue(true);
});

describe('ShiftBatchFlow', () => {
    it('rápido: turno anterior, data e Publicar; duplo toque chama a publicação uma vez', async () => {
        let release: (value: unknown) => void = () => {};
        service.publishBatch.mockReturnValue(new Promise((resolve) => { release = resolve; }));
        renderFlow();
        await repeatFromHistory();
        fireEvent.click(screen.getByRole('button', { name: /^Amanhã/ }));
        await pickList();
        const publish = screen.getByRole('button', { name: 'Publicar' });
        fireEvent.click(publish);
        fireEvent.click(publish);
        expect(service.publishBatch).toHaveBeenCalledTimes(1);
        release({ ok: true, alreadyCreated: false, jobIds: ['n1'] });
        expect(await screen.findByText('1 turno publicado')).toBeTruthy();
        await waitFor(() => expect(service.dispatchCall).toHaveBeenCalledTimes(1));
    });

    it('sem escolher quem vai trabalhar, Publicar segue sem chamar (não bloqueia); escolhendo a lista, publica e chama', async () => {
        service.publishBatch.mockResolvedValue({ ok: true, alreadyCreated: false, jobIds: ['n1'] });
        renderFlow();
        await repeatFromHistory();
        fireEvent.click(screen.getByRole('button', { name: /^Amanhã/ }));
        expect(await screen.findByText('Ninguém escolhido ainda.')).toBeTruthy();
        fireEvent.click(screen.getByRole('button', { name: 'Publicar' }));
        expect(await screen.findByText('1 turno publicado')).toBeTruthy();
        expect(service.publishBatch).toHaveBeenCalledTimes(1);
        expect(service.dispatchCall).not.toHaveBeenCalled();
    });

    it('com a lista escolhida, publica e chama', async () => {
        service.publishBatch.mockResolvedValue({ ok: true, alreadyCreated: false, jobIds: ['n1'] });
        renderFlow();
        await repeatFromHistory();
        fireEvent.click(screen.getByRole('button', { name: /^Amanhã/ }));
        await pickList();
        expect(screen.getByText('1 pessoa escolhida')).toBeTruthy();
        fireEvent.click(screen.getByRole('button', { name: 'Publicar' }));
        expect(await screen.findByText('1 turno publicado')).toBeTruthy();
        await waitFor(() => expect(service.dispatchCall).toHaveBeenCalledTimes(1));
        expect(service.dispatchCall.mock.calls[0][0]).toEqual(expect.objectContaining({ job_id: 'n1', worker_ids: ['w1'], starts_at: expect.any(String) }));
    });

    it('"Publicar sem chamar agora": saída explícita, publica e não chama ninguém', async () => {
        service.publishBatch.mockResolvedValue({ ok: true, alreadyCreated: false, jobIds: ['n1'] });
        renderFlow();
        await repeatFromHistory();
        fireEvent.click(screen.getByRole('button', { name: /^Amanhã/ }));
        fireEvent.click(await screen.findByRole('button', { name: 'Publicar sem chamar agora' }));
        expect(await screen.findByText('1 turno publicado')).toBeTruthy();
        expect(service.dispatchCall).not.toHaveBeenCalled();
    });

    it('falha ao carregar o Elenco com convidados no rascunho: não publica em silêncio e oferece tentar de novo', async () => {
        vi.mocked(TeamConnectionService.listTeamMembers).mockRejectedValueOnce(new Error('rede'));
        service.publishBatch.mockResolvedValue({ ok: true, alreadyCreated: false, jobIds: ['n1'] });
        const batch = batchFromParse(parseShiftText('amanhã 18-23h 3 garçons 150', { today: todayInBrazil() }));
        if (!batch) throw new Error('texto de teste não entendido');
        renderFlow({ ...batch, call: { mode: 'workers', worker_ids: ['w1'] } });
        expect(await screen.findByText('Não conseguimos carregar o Elenco')).toBeTruthy();
        fireEvent.click(await screen.findByRole('button', { name: /^Publicar \d/ }));
        expect(service.publishBatch).not.toHaveBeenCalled();
        expect(screen.getAllByRole('alert').some((a) => /não serão enviados/.test(a.textContent ?? ''))).toBe(true);
        // Tentar de novo: o Elenco volta (mock padrão) e a publicação passa a chamar.
        fireEvent.click(screen.getByRole('button', { name: 'Tentar de novo' }));
        await waitFor(() => expect(screen.queryByText('Não conseguimos carregar o Elenco')).toBeNull());
        fireEvent.click(screen.getByRole('button', { name: /^Publicar \d/ }));
        await waitFor(() => expect(service.publishBatch).toHaveBeenCalledTimes(1));
    });

    it('falha só das listas com lista escolhida também bloqueia; "Publicar sem chamar agora" libera', async () => {
        const { TeamListService } = await import('../../services/teamListService');
        vi.mocked(TeamListService.listLists).mockRejectedValueOnce(new Error('rede'));
        service.publishBatch.mockResolvedValue({ ok: true, alreadyCreated: false, jobIds: ['n1'] });
        const batch = batchFromParse(parseShiftText('amanhã 18-23h 3 garçons 150', { today: todayInBrazil() }));
        if (!batch) throw new Error('texto de teste não entendido');
        renderFlow({ ...batch, call: { mode: 'list', list_id: 'l1' } });
        expect(await screen.findByText('Não conseguimos carregar o Elenco')).toBeTruthy();
        fireEvent.click(screen.getByRole('button', { name: /^Publicar \d/ }));
        expect(service.publishBatch).not.toHaveBeenCalled();
        fireEvent.click(screen.getByRole('button', { name: 'Publicar sem chamar agora' }));
        expect(await screen.findByText('1 turno publicado')).toBeTruthy();
        expect(service.dispatchCall).not.toHaveBeenCalled();
    });

    it('2 vagas e 1 pessoa chamada: avisa que 1 vaga continua aberta, sem bloquear', async () => {
        const batch = batchFromParse(parseShiftText('amanhã 18-23h 2 garçons 150', { today: todayInBrazil() }));
        if (!batch) throw new Error('texto de teste não entendido');
        renderFlow({ ...batch, call: { mode: 'workers', worker_ids: ['w1'] } });
        expect(await screen.findByText('2 vagas, 1 pessoa chamada: 1 vaga continua aberta.')).toBeTruthy();
        expect((screen.getByRole('button', { name: /^Publicar \d/ }) as HTMLButtonElement).disabled).toBe(false);
    });

    it('elenco vazio: explica que o turno fica aberto e publica sem chamar', async () => {
        vi.mocked(TeamConnectionService.listTeamMembers).mockResolvedValueOnce([]);
        service.publishBatch.mockResolvedValue({ ok: true, alreadyCreated: false, jobIds: ['n1'] });
        renderFlow();
        await repeatFromHistory();
        fireEvent.click(screen.getByRole('button', { name: /^Amanhã/ }));
        expect(await screen.findByText(/Seu Elenco está vazio: o turno fica aberto/)).toBeTruthy();
        fireEvent.click(screen.getByRole('button', { name: 'Publicar' }));
        expect(await screen.findByText('1 turno publicado')).toBeTruthy();
        expect(service.dispatchCall).not.toHaveBeenCalled();
    });

    it('pessoas escolhidas no diálogo valem para publicar e chamar', async () => {
        service.publishBatch.mockResolvedValue({ ok: true, alreadyCreated: false, jobIds: ['n1'] });
        service.dispatchCall.mockImplementation(async (item: unknown) => ({ item, status: 'sent' }));
        renderFlow();
        await repeatFromHistory();
        fireEvent.click(screen.getByRole('button', { name: /^Amanhã/ }));
        fireEvent.click(await screen.findByRole('button', { name: 'Escolher pessoas' }));
        fireEvent.click(await screen.findByRole('button', { name: /Ana/ }));
        fireEvent.click(screen.getByRole('button', { name: /^Escolher \(1\)/ }));
        fireEvent.click(screen.getByRole('button', { name: 'Publicar' }));
        expect(await screen.findByText('1 turno publicado')).toBeTruthy();
        await waitFor(() => expect(service.dispatchCall).toHaveBeenCalledTimes(1));
        expect(service.dispatchCall.mock.calls[0][0].worker_ids).toEqual(['w1']);
    });

    it('sem data, o toque explica o que falta e não publica', async () => {
        renderFlow();
        await repeatFromHistory();
        await screen.findByText('Ninguém escolhido ainda.');
        fireEvent.click(screen.getByRole('button', { name: 'Publicar' }));
        expect(screen.getByRole('alert').textContent).toContain('Falta: data.');
        expect(service.publishBatch).not.toHaveBeenCalled();
    });

    it('A9: rascunho de fora (copiloto) só abre a revisão; nada é publicado sem o toque', async () => {
        renderReview('amanhã e depois de amanhã 18-23h 3 garçons 150');
        expect(await screen.findByRole('button', { name: 'Publicar 2' })).toBeTruthy();
        expect(screen.getByRole('heading', { name: '2 turnos · 6 vagas' })).toBeTruthy();
        expect(service.publishBatch).not.toHaveBeenCalled();
    });

    it('A1: linhas iguais são juntadas à vista e "Separar" desfaz', async () => {
        renderReview('amanhã 18-23h 3 garçons 150; amanhã 18-23h 2 garçons 150');
        expect(await screen.findByText('2 linhas iguais foram juntadas: 1 turno com 5 vagas.')).toBeTruthy();
        fireEvent.click(screen.getByRole('button', { name: 'Separar' }));
        expect(screen.getByRole('button', { name: 'Publicar 2' })).toBeTruthy();
    });

    it('A5: sem saída a revisão bloqueia o Publicar', async () => {
        renderReview('amanhã 18h 3 garçons 150');
        const button = await screen.findByRole('button', { name: 'Publicar 1' });
        expect((button as HTMLButtonElement).disabled).toBe(true);
        expect(screen.getByText('Falta: saída.')).toBeTruthy();
    });

    it('A7: chamado que falha não desfaz turnos e só ele ganha "Tentar de novo"', async () => {
        service.publishBatch.mockResolvedValue({ ok: true, alreadyCreated: false, jobIds: ['n1', 'n2', 'n3'] });
        service.dispatchCall.mockImplementation(async (item: { job_id: string }) =>
            item.job_id === 'n2' ? { item, status: 'failed', error: 'cota' } : { item, status: 'sent' });
        renderReview('amanhã 18-23h 1 garçom 150; amanhã 9-12h 1 garçom 150; amanhã 13-17h 1 garçom 150');
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
        renderReview('amanhã 18-23h 1 garçom 150; amanhã 9-12h 1 garçom 150');
        await pickList();
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
        fireEvent.click(screen.getAllByRole('button', { name: 'Remover turno' })[0]);
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

    it('vários turnos se faz no editor em lista: "Adicionar outro turno" soma na barra', async () => {
        renderFlow();
        await repeatFromHistory();
        fireEvent.click(screen.getByRole('button', { name: /^Amanhã/ }));
        fireEvent.click(screen.getByRole('button', { name: 'Adicionar outro turno' }));
        expect(screen.getByRole('button', { name: 'Revisar (2)' })).toBeTruthy();
    });

    describe('começo: o hub escolhe entre três ideias', () => {
        it('mostra três cartões, na ordem, e nada de texto livre, busca ou "Mais formas"', async () => {
            templates.listShiftTemplates.mockResolvedValue([saved]);
            renderFlow();
            const cards = await screen.findAllByRole('button', { name: /Criar turno|Usar um modelo|Repetir um turno anterior/ });
            expect(cards.map((c) => c.textContent)).toEqual([
                expect.stringContaining('Criar turno'),
                expect.stringContaining('Usar um modelo'),
                expect.stringContaining('Repetir um turno anterior'),
            ]);
            expect(screen.getByText('Do zero, sem modelo. Preencha e lance na hora.')).toBeTruthy();
            expect(screen.getByText('Pegue um do histórico e ajuste só data e horário.')).toBeTruthy();
            expect(await screen.findByText('1 modelo')).toBeTruthy();
            expect(screen.queryByText('Mais formas de começar')).toBeNull();
            expect(screen.queryByLabelText('Colar ou digitar')).toBeNull();
            expect(screen.queryByRole('button', { name: /Repetir (a semana|o fim de semana)/ })).toBeNull();
            expect(screen.queryByRole('searchbox')).toBeNull();
            expect(service.listRecentModels).not.toHaveBeenCalled();
        });

        it('Criar turno abre o editor do zero', async () => {
            renderFlow();
            fireEvent.click(await screen.findByRole('button', { name: /^Criar turno/ }));
            expect(await screen.findByRole('button', { name: 'Publicar' })).toBeTruthy();
            expect(screen.getByRole('button', { name: 'Adicionar outro turno' })).toBeTruthy();
        });

        it('Usar um modelo abre a área de modelos; escolher um abre o editor e dá para publicar', async () => {
            service.publishBatch.mockResolvedValue({ ok: true, alreadyCreated: false, jobIds: ['n1'] });
            renderFlow();
            fireEvent.click(await screen.findByRole('button', { name: /Usar um modelo/ }));
            expect(screen.getByText('Área de modelos de emp')).toBeTruthy();
            expect(screen.queryByRole('button', { name: /^Criar turno/ })).toBeNull();
            fireEvent.click(screen.getByRole('button', { name: 'Usar Garçom sábado' }));
            fireEvent.click(await screen.findByRole('button', { name: /^Amanhã/ }));
            await pickList();
            fireEvent.click(screen.getByRole('button', { name: 'Publicar' }));
            expect(await screen.findByText('1 turno publicado')).toBeTruthy();
            // veio de um modelo: não oferece guardar de novo
            expect(templates.saveShiftTemplate).not.toHaveBeenCalled();
        });

        it('Voltar da área de modelos devolve ao hub', async () => {
            renderFlow();
            fireEvent.click(await screen.findByRole('button', { name: /Usar um modelo/ }));
            fireEvent.click(screen.getByRole('button', { name: 'Voltar' }));
            expect(await screen.findByRole('button', { name: /^Criar turno/ })).toBeTruthy();
            expect(screen.queryByText('Área de modelos de emp')).toBeNull();
        });

        it('histórico: lista cartões com horário e valor; toque abre o editor com os dados e data vazia', async () => {
            renderFlow();
            fireEvent.click(await screen.findByRole('button', { name: /Repetir um turno anterior/ }));
            expect(await screen.findByRole('heading', { name: 'Repetir um turno anterior' })).toBeTruthy();
            expect(screen.getByText('Toque em um turno para repetir. Você ajusta só a data e o horário.')).toBeTruthy();
            expect(service.listRecentModels).toHaveBeenCalledWith(30);
            expect(await screen.findByText(/01\/01 · 18:00–23:00 · R\$/)).toBeTruthy();
            fireEvent.click(screen.getByRole('button', { name: /Garçom evento/ }));
            expect(await screen.findByRole('button', { name: 'Publicar' })).toBeTruthy();
            expect((screen.getByLabelText('Data') as HTMLInputElement).value).toBe('');
            expect(screen.getByText('Garçom evento')).toBeTruthy();
        });

        it('histórico: erro com "Tentar de novo" e depois vazio', async () => {
            service.listRecentModels.mockRejectedValueOnce(new Error('rede')).mockResolvedValue([]);
            renderFlow();
            fireEvent.click(await screen.findByRole('button', { name: /Repetir um turno anterior/ }));
            fireEvent.click(await screen.findByRole('button', { name: 'Tentar de novo' }));
            expect(await screen.findByText(/Os turnos que você publicar aparecem aqui/)).toBeTruthy();
        });

        it('histórico: busca só com mais de 5 turnos', async () => {
            const many = Array.from({ length: 6 }, (_, i) => ({ ...model, id: `j${i}`, title: `Turno ${i}` }));
            service.listRecentModels.mockResolvedValue(many);
            renderFlow();
            fireEvent.click(await screen.findByRole('button', { name: /Repetir um turno anterior/ }));
            fireEvent.change(await screen.findByLabelText('Buscar nos turnos anteriores'), { target: { value: 'turno 4' } });
            expect(screen.getAllByRole('button', { name: /^Turno \d/ })).toHaveLength(1);
        });

        it('Voltar do histórico e do editor retornam ao hub', async () => {
            renderFlow();
            fireEvent.click(await screen.findByRole('button', { name: /Repetir um turno anterior/ }));
            fireEvent.click(screen.getByRole('button', { name: 'Voltar' }));
            expect(await screen.findByRole('button', { name: /^Criar turno/ })).toBeTruthy();

            await repeatFromHistory();
            await screen.findByRole('button', { name: 'Publicar' });
            fireEvent.click(screen.getByRole('button', { name: /Voltar|Sair/ }));
            expect(await screen.findByRole('button', { name: /^Criar turno/ })).toBeTruthy();
            expect(screen.queryByRole('heading', { name: 'Repetir um turno anterior' })).toBeNull();
        });

        it('rascunho: Continuar ou Descartar; descartar some e dá "Desfazer"', async () => {
            storeDraft();
            renderFlow();
            expect(await screen.findByText('Meu rascunho · 1 turno')).toBeTruthy();
            expect(screen.getByRole('button', { name: 'Continuar' })).toBeTruthy();
            fireEvent.click(screen.getByRole('button', { name: 'Descartar rascunho' }));
            expect(screen.queryByText('Meu rascunho · 1 turno')).toBeNull();
            expect(screen.getAllByRole('status').map((n) => n.textContent).join(' ')).toContain('Rascunho descartado');
            expect(localStorage.getItem(batchDraftKey('u1', 'emp'))).toBeNull();
            fireEvent.click(screen.getByRole('button', { name: 'Desfazer descarte do rascunho' }));
            expect(await screen.findByText('Meu rascunho · 1 turno')).toBeTruthy();
            expect(localStorage.getItem(batchDraftKey('u1', 'emp'))).not.toBeNull();
        });

        it('rascunho: Continuar abre o editor', async () => {
            storeDraft();
            renderFlow();
            fireEvent.click(await screen.findByRole('button', { name: 'Continuar' }));
            expect(await screen.findByRole('button', { name: 'Publicar' })).toBeTruthy();
        });
    });

    it('Guardar como modelo: guarda depois de publicar e avisa', async () => {
        service.publishBatch.mockResolvedValue({ ok: true, alreadyCreated: false, jobIds: ['n1'] });
        renderFlow();
        await repeatFromHistory();
        fireEvent.click(screen.getByRole('checkbox', { name: /Guardar como modelo/ }));
        expect((screen.getByLabelText('Nome do modelo') as HTMLInputElement).value).toBe('Garçom evento');
        fireEvent.click(screen.getByRole('button', { name: /^Amanhã/ }));
        await pickList();
        fireEvent.click(screen.getByRole('button', { name: 'Publicar' }));
        expect(await screen.findByText(/Modelo guardado/)).toBeTruthy();
        expect(templates.saveShiftTemplate).toHaveBeenCalledWith(
            'emp', 'Garçom evento',
            expect.objectContaining({ title: 'Garçom evento', category: 'garcom' }),
            expect.objectContaining({ start_time: '18:00', end_time: '23:00', budget: 150 }),
        );
    });

    it('Guardar como modelo: falha não desfaz a publicação', async () => {
        service.publishBatch.mockResolvedValue({ ok: true, alreadyCreated: false, jobIds: ['n1'] });
        templates.saveShiftTemplate.mockResolvedValue({ ok: false, reason: 'duplicate' });
        renderFlow();
        await repeatFromHistory();
        fireEvent.click(screen.getByRole('checkbox', { name: /Guardar como modelo/ }));
        fireEvent.click(screen.getByRole('button', { name: /^Amanhã/ }));
        await pickList();
        fireEvent.click(screen.getByRole('button', { name: 'Publicar' }));
        expect(await screen.findByText('1 turno publicado')).toBeTruthy();
        expect(await screen.findByText(/Já existe um modelo com esse nome/)).toBeTruthy();
    });
});
