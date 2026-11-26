import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';

const templates = vi.hoisted(() => ({
    listShiftTemplates: vi.fn(),
    saveShiftTemplate: vi.fn(),
    updateShiftTemplate: vi.fn(),
    setShiftTemplateArchived: vi.fn(),
}));
vi.mock('../../services/shiftTemplateService', () => templates);
vi.mock('../../services/shiftOperationService', () => ({ listTags: vi.fn().mockResolvedValue([]) }));

import { emptyTemplate, type SavedShiftTemplate } from '../../lib/shiftDrafts';
import { TemplatesScreen } from './TemplatesScreen';

const make = (id: string, name: string, extra: Partial<SavedShiftTemplate['defaults']> = {}): SavedShiftTemplate => ({
    id,
    name,
    template: { ...emptyTemplate('garcom'), title: name, description: 'Salão', location: 'Loja Centro' },
    defaults: { start_time: '18:00', end_time: '23:00', slots: 3, budget: 150, ...extra },
});

const sabado = make('t1', 'Garçom sábado');
const onUse = vi.fn();
const onBack = vi.fn();

const renderScreen = () => render(<TemplatesScreen companyId="emp" onUse={onUse} onBack={onBack} />);

beforeEach(() => {
    vi.clearAllMocks();
    templates.listShiftTemplates.mockResolvedValue([sabado]);
    templates.setShiftTemplateArchived.mockResolvedValue(true);
});

describe('TemplatesScreen', () => {
    it('lista o modelo com o resumo de horário, vagas e valor', async () => {
        renderScreen();
        expect(await screen.findByText('Garçom sábado')).toBeInTheDocument();
        expect(screen.getByText(/18:00–23:00 · 3 vagas · R\$\s?150,00/)).toBeInTheDocument();
        expect(screen.getByText('Loja Centro')).toBeInTheDocument();
        expect(screen.getByText(/Um modelo guarda função, local, horário, vagas e valor/)).toBeInTheDocument();
        fireEvent.click(screen.getByRole('button', { name: 'Voltar' }));
        expect(onBack).toHaveBeenCalled();
    });

    it('"Usar" entrega o modelo a quem montou a tela', async () => {
        renderScreen();
        fireEvent.click(await screen.findByRole('button', { name: 'Usar modelo Garçom sábado' }));
        expect(onUse).toHaveBeenCalledWith(sabado);
    });

    it('estado vazio explica e oferece criar', async () => {
        templates.listShiftTemplates.mockResolvedValue([]);
        renderScreen();
        expect(await screen.findByText('Você ainda não tem modelos')).toBeInTheDocument();
        fireEvent.click(screen.getByRole('button', { name: 'Novo modelo' }));
        expect(await screen.findByRole('dialog', { name: 'Novo modelo' })).toBeInTheDocument();
    });

    it('erro ao carregar mostra aviso e "Tentar de novo" recarrega', async () => {
        templates.listShiftTemplates.mockRejectedValueOnce(new Error('rede'));
        renderScreen();
        fireEvent.click(await screen.findByRole('button', { name: 'Tentar de novo' }));
        expect(await screen.findByText('Garçom sábado')).toBeInTheDocument();
        expect(templates.listShiftTemplates).toHaveBeenCalledTimes(2);
    });

    it('cria um modelo novo e ele entra na lista', async () => {
        const created = make('t2', 'Cozinha domingo', { slots: 2 });
        templates.saveShiftTemplate.mockResolvedValue({ ok: true, template: created });
        renderScreen();
        await screen.findByText('Garçom sábado');
        fireEvent.click(screen.getByRole('button', { name: 'Novo modelo' }));
        const dialog = await screen.findByRole('dialog', { name: 'Novo modelo' });
        fireEvent.change(within(dialog).getByLabelText(/Nome do modelo/), { target: { value: 'Cozinha domingo' } });
        fireEvent.change(within(dialog).getByLabelText(/Função/), { target: { value: 'cozinha' } });
        fireEvent.click(within(dialog).getByRole('button', { name: 'Salvar modelo' }));
        await waitFor(() => expect(templates.saveShiftTemplate).toHaveBeenCalled());
        const [companyId, name, template] = templates.saveShiftTemplate.mock.calls[0];
        expect(companyId).toBe('emp');
        expect(name).toBe('Cozinha domingo');
        expect(template.category).toBe('cozinha');
        expect(await screen.findByText('Cozinha domingo')).toBeInTheDocument();
        expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    });

    it('não salva sem nome e mostra o motivo', async () => {
        renderScreen();
        fireEvent.click(await screen.findByRole('button', { name: 'Novo modelo' }));
        const dialog = await screen.findByRole('dialog', { name: 'Novo modelo' });
        fireEvent.click(within(dialog).getByRole('button', { name: 'Salvar modelo' }));
        expect(await within(dialog).findByText('Dê um nome ao modelo.')).toBeInTheDocument();
        expect(templates.saveShiftTemplate).not.toHaveBeenCalled();
    });

    it('nome repetido mostra "Já existe um modelo com esse nome."', async () => {
        templates.saveShiftTemplate.mockResolvedValue({ ok: false, reason: 'duplicate' });
        renderScreen();
        fireEvent.click(await screen.findByRole('button', { name: 'Novo modelo' }));
        const dialog = await screen.findByRole('dialog', { name: 'Novo modelo' });
        fireEvent.change(within(dialog).getByLabelText(/Nome do modelo/), { target: { value: 'Garçom sábado' } });
        fireEvent.change(within(dialog).getByLabelText(/Função/), { target: { value: 'garcom' } });
        fireEvent.click(within(dialog).getByRole('button', { name: 'Salvar modelo' }));
        expect(await within(dialog).findByText('Já existe um modelo com esse nome.')).toBeInTheDocument();
        expect(screen.getByRole('dialog', { name: 'Novo modelo' })).toBeInTheDocument();
    });

    it('o lápis abre o modelo preenchido e salva a edição', async () => {
        const edited = { ...sabado, name: 'Garçom sexta' };
        templates.updateShiftTemplate.mockResolvedValue({ ok: true, template: edited });
        renderScreen();
        fireEvent.click(await screen.findByRole('button', { name: 'Editar modelo Garçom sábado' }));
        const dialog = await screen.findByRole('dialog', { name: 'Editar modelo' });
        const nameInput = within(dialog).getByLabelText(/Nome do modelo/) as HTMLInputElement;
        expect(nameInput.value).toBe('Garçom sábado');
        fireEvent.change(nameInput, { target: { value: 'Garçom sexta' } });
        fireEvent.click(within(dialog).getByRole('button', { name: 'Salvar modelo' }));
        await waitFor(() => expect(templates.updateShiftTemplate).toHaveBeenCalledWith('t1', 'Garçom sexta', sabado.template, sabado.defaults));
        expect(await screen.findByText('Garçom sexta')).toBeInTheDocument();
        expect(screen.queryByText('Garçom sábado')).not.toBeInTheDocument();
    });

    it('Cancelar fecha o editor sem salvar', async () => {
        renderScreen();
        fireEvent.click(await screen.findByRole('button', { name: 'Editar modelo Garçom sábado' }));
        const dialog = await screen.findByRole('dialog', { name: 'Editar modelo' });
        fireEvent.click(within(dialog).getByRole('button', { name: 'Cancelar' }));
        await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
        expect(templates.updateShiftTemplate).not.toHaveBeenCalled();
    });

    it('excluir arquiva o modelo e "Desfazer" o traz de volta', async () => {
        renderScreen();
        fireEvent.click(await screen.findByRole('button', { name: 'Mais opções do modelo Garçom sábado' }));
        fireEvent.click(await screen.findByRole('menuitem', { name: 'Excluir modelo' }));
        await waitFor(() => expect(templates.setShiftTemplateArchived).toHaveBeenCalledWith('t1', true));
        const undo = await screen.findByRole('button', { name: 'Desfazer exclusão do modelo Garçom sábado' });
        expect(screen.getByRole('status')).toContainElement(undo);
        expect(screen.queryByRole('button', { name: 'Usar modelo Garçom sábado' })).not.toBeInTheDocument();
        fireEvent.click(undo);
        await waitFor(() => expect(templates.setShiftTemplateArchived).toHaveBeenCalledWith('t1', false));
        expect(await screen.findByRole('button', { name: 'Usar modelo Garçom sábado' })).toBeInTheDocument();
    });

    it('com 5 modelos ou menos não há busca', async () => {
        renderScreen();
        await screen.findByText('Garçom sábado');
        expect(screen.queryByLabelText('Buscar nos meus modelos')).not.toBeInTheDocument();
    });

    it('com mais de 5 modelos aparece a busca; mostra 6 e "Ver todos"', async () => {
        templates.listShiftTemplates.mockResolvedValue(Array.from({ length: 8 }, (_, i) => make(`m${i}`, `Modelo ${i}`)));
        renderScreen();
        const search = await screen.findByLabelText('Buscar nos meus modelos');
        expect(screen.getAllByRole('button', { name: /^Usar modelo/ })).toHaveLength(6);
        fireEvent.click(screen.getByRole('button', { name: 'Ver todos (8)' }));
        expect(screen.getAllByRole('button', { name: /^Usar modelo/ })).toHaveLength(8);
        fireEvent.change(search, { target: { value: 'modelo 7' } });
        expect(screen.getAllByRole('button', { name: /^Usar modelo/ })).toHaveLength(1);
    });
});
