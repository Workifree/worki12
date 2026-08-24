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

// REGRESSAO (achado cancelando um chamado no celular, 24/08/2026): o rotulo de `response:
// 'closed'` era fixo em "Vaga preenchida". Quando a EMPRESA cancela o chamado, ninguem foi
// contratado -- e o painel dizia que a vaga estava preenchida. Conferido no banco na hora:
// shift_calls.status='cancelled', zero applications no turno.
// REGRESSAO (achado testando a manha seguinte, 24/08/2026): `shift_calls` nao tem quem marque
// 'expired' -- o edge function expire-invites so mexe em `applications`, e nao ha cron para
// chamados. Um chamado que morreu as 16h continuava exibido como ABERTO, com botao de cancelar e
// "expira 16:23" no passado, as 20:23.
describe('ShiftCallsPanel — chamado vencido nao se apresenta como aberto', () => {
  const base = {
    id: 'call-x', job_id: 'job-1', company_id: 'c-1', created_by: 'c-1',
    slots: 1, reason: 'falta', message: null, targets_count: 1,
    status: 'open', origin: 'team', first_claim_at: null, closed_at: null,
    created_at: '2026-08-24T10:00:00Z',
    targets: [{ id: 't1', call_id: 'call-x', worker_id: 'w1', notified_at: '2026-08-24T10:00:00Z',
      responded_at: null, response: null,
      worker: { id: 'w1', full_name: 'Fulano', avatar_url: null, primary_role: null, rating_average: null } }],
  }
  const comExpiracao = (quando: string) => ([{ ...base, expires_at: quando }] as never)

  it('status=open com expires_at no PASSADO: mostra que expirou e some o botao de cancelar', () => {
    const passado = new Date(Date.now() - 4 * 3600_000).toISOString()
    render(<ShiftCallsPanel calls={comExpiracao(passado)} loading={false} cancellingId={null} onCancel={() => {}} />)

    expect(screen.getByText(/Chamado expirou/i)).toBeInTheDocument()
    expect(screen.getByText(/Expirou às .* sem ninguém aceitar/i)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /cancelar/i })).not.toBeInTheDocument()
  })

  it('status=open com expires_at no FUTURO segue aberto e cancelavel', () => {
    const futuro = new Date(Date.now() + 2 * 3600_000).toISOString()
    render(<ShiftCallsPanel calls={comExpiracao(futuro)} loading={false} cancellingId={null} onCancel={() => {}} />)

    expect(screen.getByText(/Chamado aberto/i)).toBeInTheDocument()
    expect(screen.getByText(/Ninguém aceitou ainda · expira/i)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /cancelar/i })).toBeInTheDocument()
  })
})

describe('ShiftCallsPanel — motivo do encerramento (nao inventa "preenchida")', () => {
  const alvoFechado = {
    id: 'tgt-1', call_id: 'call-1', worker_id: 'w-1',
    notified_at: '2026-08-24T20:00:00Z', responded_at: '2026-08-24T20:05:00Z',
    response: 'closed' as const,
    worker: { id: 'w-1', full_name: 'Fulano de Tal', avatar_url: null, primary_role: null, rating_average: null },
  }
  const chamado = (status: string) => ([{
    id: 'call-1', job_id: 'job-1', company_id: 'c-1', created_by: 'c-1',
    slots: 1, reason: 'falta', message: null, targets_count: 1,
    status, origin: 'team',
    expires_at: '2026-08-24T22:00:00Z', created_at: '2026-08-24T20:00:00Z',
    closed_at: '2026-08-24T20:30:00Z', first_claim_at: null,
    targets: [alvoFechado],
  }] as never)

  it('chamado CANCELADO pela empresa nao diz "Vaga preenchida"', () => {
    render(<ShiftCallsPanel calls={chamado('cancelled')} loading={false} cancellingId={null} onCancel={() => {}} />)
    expect(screen.getByText(/Chamado cancelado/)).toBeInTheDocument()
    expect(screen.queryByText(/Vaga preenchida/)).not.toBeInTheDocument()
  })

  it('chamado EXPIRADO diz que expirou, nao que preencheu', () => {
    render(<ShiftCallsPanel calls={chamado('expired')} loading={false} cancellingId={null} onCancel={() => {}} />)
    expect(screen.getByText(/Expirou sem resposta/)).toBeInTheDocument()
  })

  it('chamado FILLED continua dizendo que a vaga foi preenchida', () => {
    render(<ShiftCallsPanel calls={chamado('filled')} loading={false} cancellingId={null} onCancel={() => {}} />)
    expect(screen.getByText(/Vaga preenchida/)).toBeInTheDocument()
  })
})

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
