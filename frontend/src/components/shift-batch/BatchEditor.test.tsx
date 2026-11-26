import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { BatchEditor } from './BatchEditor';
import {
    createRow, emptyTemplate, newId, MAX_BATCH_ROWS, BATCH_LIMIT_MESSAGE,
    type RowDefaults, type ShiftDraftBatch,
} from '../../lib/shiftDrafts';

const TODAY = '2026-11-26';
const DEFAULTS: RowDefaults = { start_time: '18:00', end_time: '23:00', slots: 2, budget: 150 };

function draftWith(rows = [createRow('2026-11-27', DEFAULTS)]): ShiftDraftBatch {
    return { client_batch_id: newId(), source: 'form', template: emptyTemplate('garcom'), rows };
}

function Harness({
    initial = draftWith(), directPublish = true, saveModelName, onPublish = vi.fn(), onReview = vi.fn(), onDraftChange,
}: {
    initial?: ShiftDraftBatch;
    directPublish?: boolean;
    saveModelName?: string | null;
    onPublish?: () => void;
    onReview?: () => void;
    onDraftChange?: (draft: ShiftDraftBatch) => void;
}) {
    const [draft, setDraft] = useState(initial);
    const [model, setModel] = useState<string | null | undefined>(saveModelName);
    return (
        <BatchEditor
            draft={draft}
            onDraft={(next) => { setDraft(next); onDraftChange?.(next); }}
            defaults={DEFAULTS}
            onDefaults={() => {}}
            today={TODAY}
            tags={[]}
            canRepeat={false}
            directPublish={directPublish}
            publishing={false}
            errorMessage={null}
            onPublish={onPublish}
            onReview={onReview}
            onBack={() => {}}
            initialEditingKey={null}
            saveModelName={model}
            onSaveModelName={setModel}
        />
    );
}

const cards = () => within(screen.getByRole('list', { name: 'Turnos a criar' })).getAllByRole('listitem');
const dateOf = (card: HTMLElement) => (within(card).getByLabelText('Data') as HTMLInputElement).value;

describe('BatchEditor (lista de cartões)', () => {
    it('um cartão completo publica direto e não mostra "Revisar"', () => {
        const onPublish = vi.fn();
        render(<Harness onPublish={onPublish} />);
        expect(cards()).toHaveLength(1);
        expect(screen.queryByRole('button', { name: 'Remover turno' })).toBeNull();
        expect(screen.queryByRole('button', { name: /^Revisar/ })).toBeNull();
        fireEvent.click(screen.getByRole('button', { name: 'Publicar' }));
        expect(onPublish).toHaveBeenCalledTimes(1);
    });

    it('sem publicação direta, o botão é "Revisar"', () => {
        const onReview = vi.fn();
        render(<Harness directPublish={false} onReview={onReview} />);
        fireEvent.click(screen.getByRole('button', { name: 'Revisar' }));
        expect(onReview).toHaveBeenCalledTimes(1);
    });

    it('"Adicionar outro turno" copia o último cartão no dia seguinte e foca a data', () => {
        render(<Harness />);
        fireEvent.click(screen.getByRole('button', { name: 'Adicionar outro turno' }));
        const list = cards();
        expect(list).toHaveLength(2);
        expect(dateOf(list[1])).toBe('2026-11-28');
        expect((within(list[1]).getByLabelText('Entrada') as HTMLInputElement).value).toBe('18:00');
        expect((within(list[1]).getByLabelText('Valor por pessoa (dia)') as HTMLInputElement).value).toBe('150');
        expect(document.activeElement).toBe(within(list[1]).getByLabelText('Data'));
        // Mais de um cartão: o botão principal vira "Revisar (2)".
        expect(screen.getByRole('button', { name: 'Revisar (2)' })).toBeTruthy();
        expect(screen.queryByRole('button', { name: 'Publicar' })).toBeNull();
        expect(screen.getAllByRole('button', { name: 'Remover turno' })).toHaveLength(2);
    });

    it('remove um cartão e volta a publicar direto', () => {
        render(<Harness />);
        fireEvent.click(screen.getByRole('button', { name: 'Adicionar outro turno' }));
        fireEvent.click(screen.getAllByRole('button', { name: 'Remover turno' })[1]);
        expect(cards()).toHaveLength(1);
        expect(screen.getByRole('button', { name: 'Publicar' })).toBeTruthy();
    });

    it('duplicar cria outro cartão logo abaixo, na mesma data, que não se junta ao original', () => {
        render(<Harness />);
        fireEvent.click(within(cards()[0]).getByRole('button', { name: 'Duplicar turno' }));
        const list = cards();
        expect(list).toHaveLength(2);
        expect(dateOf(list[1])).toBe('2026-11-27');
        expect(screen.getByRole('button', { name: 'Revisar (2)' })).toBeTruthy();
    });

    it('chips Hoje e Amanhã preenchem a data do cartão', () => {
        render(<Harness initial={draftWith([createRow('', DEFAULTS)])} />);
        fireEvent.click(screen.getByRole('button', { name: 'Amanhã 27/11' }));
        expect(dateOf(cards()[0])).toBe('2026-11-27');
        fireEvent.click(screen.getByRole('button', { name: 'Hoje 26/11' }));
        expect(dateOf(cards()[0])).toBe('2026-11-26');
    });

    it('o lápis do cartão abre o turno em tela cheia e salva só o que mudou como dado próprio', () => {
        const seen: ShiftDraftBatch[] = [];
        render(<Harness onDraftChange={(d) => seen.push(d)} />);
        fireEvent.click(screen.getByRole('button', { name: 'Editar detalhes do turno de Sex 27/11' }));
        const dialog = screen.getByRole('dialog');
        const title = within(dialog).getByLabelText(/Título do turno/) as HTMLInputElement;
        expect(title.value).toBe('Garçom / Garçonete');
        fireEvent.change(title, { target: { value: 'Garçom VIP' } });
        fireEvent.change(within(dialog).getByLabelText('Local'), { target: { value: 'Salão 2' } });
        fireEvent.click(within(dialog).getByRole('button', { name: 'Salvar' }));

        expect(screen.queryByRole('dialog')).toBeNull();
        const saved = seen[seen.length - 1];
        expect(saved.rows[0].overrides).toEqual({ title: 'Garçom VIP', location: 'Salão 2' });
        expect(saved.template.title).toBe('Garçom / Garçonete');
        expect(within(cards()[0]).getByText('Garçom VIP')).toBeTruthy();
        expect(within(cards()[0]).getByText('Dados próprios')).toBeTruthy();
    });

    it('cancelar o modal não muda o rascunho', () => {
        const seen: ShiftDraftBatch[] = [];
        render(<Harness onDraftChange={(d) => seen.push(d)} />);
        fireEvent.click(screen.getByRole('button', { name: /^Editar detalhes do turno de/ }));
        const dialog = screen.getByRole('dialog');
        fireEvent.change(within(dialog).getByLabelText(/Título do turno/), { target: { value: 'Outro' } });
        fireEvent.click(within(dialog).getByRole('button', { name: 'Cancelar' }));
        expect(screen.queryByRole('dialog')).toBeNull();
        expect(seen).toHaveLength(0);
    });

    it('o lápis do topo edita os dados que valem para todos os cartões', () => {
        render(<Harness />);
        fireEvent.click(screen.getByRole('button', { name: 'Adicionar outro turno' }));
        fireEvent.click(screen.getByRole('button', { name: 'Editar dados do turno' }));
        const dialog = screen.getByRole('dialog');
        fireEvent.change(within(dialog).getByLabelText(/Título do turno/), { target: { value: 'Evento de fim de ano' } });
        fireEvent.click(within(dialog).getByRole('button', { name: 'Salvar' }));
        for (const card of cards()) expect(within(card).getByText('Evento de fim de ano')).toBeTruthy();
        expect(screen.getByText(/Evento de fim de ano · Garçom \/ Garçonete/)).toBeTruthy();
    });

    it('guarda mostra o que falta e não envia', () => {
        const onPublish = vi.fn();
        render(<Harness initial={draftWith([createRow('', DEFAULTS)])} onPublish={onPublish} />);
        fireEvent.click(screen.getByRole('button', { name: 'Publicar' }));
        expect(onPublish).not.toHaveBeenCalled();
        const alert = screen.getByRole('alert');
        expect(alert.textContent).toContain('Antes de continuar');
        expect(alert.textContent).toContain('Falta: data.');
        expect(within(cards()[0]).getByLabelText('Data').getAttribute('aria-invalid')).toBe('true');
    });

    it('resumo conta turnos, vagas e custo previsto', () => {
        render(<Harness />);
        expect(screen.getByText(/1 turno · 2 vagas · R\$\s300,00 previstos/)).toBeTruthy();
        fireEvent.click(screen.getByRole('button', { name: 'Adicionar outro turno' }));
        expect(screen.getByText(/2 turnos · 4 vagas · R\$\s600,00 previstos/)).toBeTruthy();
        fireEvent.change(within(cards()[1]).getByLabelText('Vagas'), { target: { value: '1' } });
        expect(screen.getByText(/2 turnos · 3 vagas · R\$\s450,00 previstos/)).toBeTruthy();
    });

    it('no limite, desliga "Adicionar outro turno" e avisa', () => {
        const rows = Array.from({ length: MAX_BATCH_ROWS }, (_, i) => createRow(`2027-01-${String((i % 28) + 1).padStart(2, '0')}`, DEFAULTS));
        render(<Harness initial={draftWith(rows)} />);
        expect((screen.getByRole('button', { name: 'Adicionar outro turno' }) as HTMLButtonElement).disabled).toBe(true);
        expect(screen.getByText(BATCH_LIMIT_MESSAGE)).toBeTruthy();
    }, 60000); // 60 cartões completos: pesado só no jsdom

    it('guardar como modelo: marca, foca o nome e edita', () => {
        render(<Harness saveModelName={null} />);
        expect(screen.queryByLabelText('Nome do modelo')).toBeNull();
        fireEvent.click(screen.getByLabelText('Guardar como modelo para usar de novo'));
        const name = screen.getByLabelText('Nome do modelo') as HTMLInputElement;
        expect(name.value).toBe('Garçom / Garçonete');
        expect(document.activeElement).toBe(name);
        fireEvent.change(name, { target: { value: 'Garçom sexta' } });
        expect(name.value).toBe('Garçom sexta');
        fireEvent.click(screen.getByLabelText('Guardar como modelo para usar de novo'));
        expect(screen.queryByLabelText('Nome do modelo')).toBeNull();
    });

    it('sem a opção de modelo quando o turno já veio de um modelo guardado', () => {
        render(<Harness saveModelName={undefined} />);
        expect(screen.queryByLabelText('Guardar como modelo para usar de novo')).toBeNull();
    });

    it('sem função, pede a função no topo e preenche título e descrição sugeridos', () => {
        const initial: ShiftDraftBatch = { ...draftWith(), template: emptyTemplate('') };
        render(<Harness initial={initial} />);
        fireEvent.change(screen.getByLabelText(/^Função/), { target: { value: 'garcom' } });
        expect(screen.getByText(/Turno de:/).parentElement?.textContent).toBe('Turno de: Garçom / Garçonete')
        expect(screen.queryByLabelText(/^Função/)).toBeNull();
    });
});
