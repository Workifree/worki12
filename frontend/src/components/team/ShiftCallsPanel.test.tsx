import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { ShiftCallsPanel } from './ShiftCallsPanel';
import type { ShiftCall } from '../../types';

// ---------------------------------------------------------------------------
// F11 (SOS) — o painel reusado pelo F1 precisa respeitar, NO CLIENTE, a mesma membrana que a
// RLS já garante no banco (D1 do ADR-20260821): para `origin='sos'`, `call.targets` só traz quem
// ACEITOU (a policy nunca devolve o pool). Um teste que fabricasse `targets` com o pool inteiro
// estaria testando um mundo que a RLS real nunca produz — por isso o mock abaixo espelha
// EXATAMENTE a forma que o banco devolve: `targets_count` alto (o pool real), mas `targets` só
// com as linhas aceitas (o que a policy permite ler).
// ---------------------------------------------------------------------------

function makeSosCall(overrides: Partial<ShiftCall> = {}): ShiftCall {
  return {
    id: 'call-sos-1',
    job_id: 'job-1',
    company_id: 'company-1',
    created_by: 'company-1',
    slots: 1,
    reason: 'falta',
    message: null,
    targets_count: 12,
    status: 'open',
    expires_at: '2026-08-21T20:00:00.000Z',
    created_at: '2026-08-21T19:00:00.000Z',
    origin: 'sos',
    targets: [
      {
        id: 't-1',
        call_id: 'call-sos-1',
        worker_id: 'worker-9',
        notified_at: '2026-08-21T19:00:00.000Z',
        responded_at: '2026-08-21T19:05:00.000Z',
        response: 'accepted',
        origin: 'sos',
        worker: { id: 'worker-9', full_name: 'Freela Aceito' },
      },
    ],
    ...overrides,
  } as ShiftCall;
}

function makeTeamCall(overrides: Partial<ShiftCall> = {}): ShiftCall {
  return {
    id: 'call-team-1',
    job_id: 'job-1',
    company_id: 'company-1',
    created_by: 'company-1',
    slots: 2,
    reason: 'falta',
    message: null,
    targets_count: 3,
    status: 'open',
    expires_at: '2026-08-21T20:00:00.000Z',
    created_at: '2026-08-21T19:00:00.000Z',
    origin: 'team',
    targets: [
      {
        id: 'tt-1',
        call_id: 'call-team-1',
        worker_id: 'worker-1',
        notified_at: '2026-08-21T19:00:00.000Z',
        responded_at: null,
        response: null,
        origin: 'team',
        worker: { id: 'worker-1', full_name: 'Freela Pendente' },
      },
    ],
    ...overrides,
  } as ShiftCall;
}

describe('ShiftCallsPanel — membrana do SOS (F11)', () => {
  it('usa targets_count (o pool real) para "avisados", nunca o tamanho do array de alvos carregado', () => {
    render(
      <ShiftCallsPanel calls={[makeSosCall()]} loading={false} cancellingId={null} onCancel={vi.fn()} />,
    );

    expect(screen.getByText(/12 avisados fora do elenco/i)).toBeInTheDocument();
    expect(screen.getByText(/1 aceite/i)).toBeInTheDocument();
  });

  it('renderiza SÓ o alvo aceito — nunca fabrica linhas extras para preencher o pool', () => {
    render(
      <ShiftCallsPanel calls={[makeSosCall()]} loading={false} cancellingId={null} onCancel={vi.fn()} />,
    );

    // Só 1 chip de alvo (o aceito), mesmo com targets_count=12 — nenhuma lista com 12 nomes.
    expect(screen.getByText('Freela Aceito')).toBeInTheDocument();
    expect(screen.queryAllByText(/aguardando/i)).toHaveLength(0);
  });

  it('filtra de novo no client mesmo se um alvo pendente vazasse no array (defesa em profundidade)', () => {
    const leaked = makeSosCall({
      targets: [
        {
          id: 't-1',
          call_id: 'call-sos-1',
          worker_id: 'worker-9',
          notified_at: '2026-08-21T19:00:00.000Z',
          responded_at: '2026-08-21T19:05:00.000Z',
          response: 'accepted',
          origin: 'sos',
          worker: { id: 'worker-9', full_name: 'Freela Aceito' },
        },
        {
          id: 't-2',
          call_id: 'call-sos-1',
          worker_id: 'worker-10',
          notified_at: '2026-08-21T19:00:00.000Z',
          responded_at: null,
          response: null,
          origin: 'sos',
          worker: { id: 'worker-10', full_name: 'Alvo Que Nao Deveria Aparecer' },
        },
      ],
    });
    render(<ShiftCallsPanel calls={[leaked]} loading={false} cancellingId={null} onCancel={vi.fn()} />);

    expect(screen.queryByText('Alvo Que Nao Deveria Aparecer')).not.toBeInTheDocument();
    expect(screen.getByText(/12 avisados fora do elenco/i)).toBeInTheDocument();
  });

  it('turno do Elenco (F1) continua usando o tamanho real do array de alvos, sem regressão', () => {
    render(
      <ShiftCallsPanel calls={[makeTeamCall()]} loading={false} cancellingId={null} onCancel={vi.fn()} />,
    );

    expect(screen.getByText(/1 chamado/i)).toBeInTheDocument();
    expect(screen.getByText('Freela Pendente')).toBeInTheDocument();
  });
});
