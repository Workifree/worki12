import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent, within } from '@testing-library/react';
import CoverageModal from './CoverageModal';

vi.mock('../../lib/logger', () => ({ logError: vi.fn() }));
vi.mock('../../lib/dateUtils', async () => {
  const actual = await vi.importActual<typeof import('../../lib/dateUtils')>('../../lib/dateUtils');
  return { ...actual, todayInBrazil: () => '2026-11-24' };
});
vi.mock('../../services/shiftOperationService', async () => {
  const actual = await vi.importActual<typeof import('../../services/shiftOperationService')>('../../services/shiftOperationService');
  return { ...actual, createCoverage: vi.fn() };
});

import { createCoverage } from '../../services/shiftOperationService';

const people = [
  { userId: 'a', label: 'Ana' },
  { userId: 'b', label: 'Beto' },
];

function setup(onDone = vi.fn()) {
  render(<CoverageModal companyId="c1" people={people} onClose={vi.fn()} onDone={onDone} />);
  return onDone;
}

function escolher(coberto: string, quemCobre: string) {
  fireEvent.click(within(screen.getByRole('group', { name: 'Quem será coberto' })).getByRole('button', { name: coberto }));
  fireEvent.click(within(screen.getByRole('group', { name: 'Quem cobre' })).getByRole('button', { name: quemCobre }));
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('CoverageModal', () => {
  it('mostra o fim automático e só habilita com as duas pessoas escolhidas', () => {
    setup();
    const criar = screen.getByRole('button', { name: 'Criar cobertura' });
    expect(criar).toBeDisabled();

    escolher('Ana', 'Beto');
    expect(criar).toBeEnabled();
    expect(screen.getByRole('status')).toHaveTextContent('termina sozinha em 30/11');
  });

  it('recusa período maior que 60 dias antes de chamar o banco', () => {
    setup();
    escolher('Ana', 'Beto');
    fireEvent.change(screen.getByLabelText(/^Até/), { target: { value: '2027-03-01' } });
    expect(screen.getByText('No máximo 60 dias.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Criar cobertura' })).toBeDisabled();
  });

  it('overlaps mostra a janela existente e não fecha o modal', async () => {
    vi.mocked(createCoverage).mockResolvedValue({
      outcome: 'overlaps', coverageId: 'cv0', existingStartsOn: '2026-11-26', existingEndsOn: '2026-12-10',
    });
    const onDone = setup();
    escolher('Ana', 'Beto');
    fireEvent.click(screen.getByRole('button', { name: 'Criar cobertura' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('26/11 a 10/12');
    expect(onDone).not.toHaveBeenCalled();
  });

  it('criada: chama o banco com as datas e avisa', async () => {
    vi.mocked(createCoverage).mockResolvedValue({ outcome: 'created', coverageId: 'cv1' });
    const onDone = setup();
    escolher('Ana', 'Beto');
    fireEvent.click(screen.getByRole('button', { name: 'Criar cobertura' }));

    await waitFor(() => expect(onDone).toHaveBeenCalled());
    expect(createCoverage).toHaveBeenCalledWith({
      companyId: 'c1', fromUserId: 'a', toUserId: 'b', startsOn: '2026-11-24', endsOn: '2026-11-30',
    });
  });
});
