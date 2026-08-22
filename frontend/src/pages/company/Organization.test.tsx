import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import Organization from './Organization';

const mockRpc = vi.fn();
const mockFrom = vi.fn();

vi.mock('../../lib/supabase', () => ({
  supabase: {
    rpc: (...args: unknown[]) => mockRpc(...args),
    from: (...args: unknown[]) => mockFrom(...args),
  },
}));

vi.mock('../../lib/logger', () => ({ logError: vi.fn() }));

const mockAddToast = vi.fn();
vi.mock('../../contexts/ToastContext', () => ({
  useToast: () => ({ addToast: mockAddToast, removeToast: vi.fn() }),
}));

function countChain(count: number) {
  return { eq: vi.fn(() => ({ eq: vi.fn(() => Promise.resolve({ count, error: null })) })) };
}

function managersChain(rows: unknown[]) {
  return {
    eq: vi.fn(() => ({
      neq: vi.fn(() => ({ order: vi.fn().mockResolvedValue({ data: rows, error: null }) })),
    })),
  };
}

describe('Organization (F13 R16)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockRpc.mockImplementation((fn: string) => {
      if (fn === 'get_my_companies') {
        return Promise.resolve({
          data: [{
            company_id: 'comp-1',
            company_name: 'Loja Centro',
            role: 'owner',
            organization_id: 'org-1',
            organization_name: 'Rede X',
            onboarding_completed: true,
            accepted_tos: true,
          }],
          error: null,
        });
      }
      return Promise.resolve({ data: null, error: null });
    });

    mockFrom.mockImplementation((table: string) => {
      if (table === 'jobs') return { select: vi.fn(() => countChain(3)) };
      if (table === 'team_connections') return { select: vi.fn(() => countChain(7)) };
      if (table === 'company_members') {
        return {
          select: vi.fn(() => managersChain([
            { id: 'm1', company_id: 'comp-1', user_id: null, role: 'manager', status: 'invited', invited_email: 'ger@ex.com', invite_token: 'tok-1', invited_at: '2026-01-01', accepted_at: null, expires_at: '2026-01-08' },
          ])),
        };
      }
      return { select: vi.fn(() => countChain(0)) };
    });
  });

  it('lista a unidade com contagens de turnos abertos e elenco', async () => {
    render(<Organization />);

    await waitFor(() => {
      expect(screen.getByText('Loja Centro')).toBeInTheDocument();
    });
    expect(screen.getByText('3')).toBeInTheDocument();
    expect(screen.getByText('7')).toBeInTheDocument();
    expect(screen.getByText('ger@ex.com')).toBeInTheDocument();
  });

  it('convida um gerente por e-mail (R8)', async () => {
    mockRpc.mockImplementation((fn: string) => {
      if (fn === 'get_my_companies') {
        return Promise.resolve({
          data: [{
            company_id: 'comp-1', company_name: 'Loja Centro', role: 'owner',
            organization_id: 'org-1', organization_name: 'Rede X',
            onboarding_completed: true, accepted_tos: true,
          }],
          error: null,
        });
      }
      if (fn === 'invite_company_manager') {
        return Promise.resolve({ data: { outcome: 'invited', member_id: 'm2', invite_token: 'tok-2' }, error: null });
      }
      return Promise.resolve({ data: null, error: null });
    });
    mockFrom.mockImplementation((table: string) => {
      if (table === 'jobs') return { select: vi.fn(() => countChain(0)) };
      if (table === 'team_connections') return { select: vi.fn(() => countChain(0)) };
      if (table === 'company_members') return { select: vi.fn(() => managersChain([])) };
      return { select: vi.fn(() => countChain(0)) };
    });

    render(<Organization />);

    await waitFor(() => {
      expect(screen.getByText('Loja Centro')).toBeInTheDocument();
    });

    const emailInput = screen.getByLabelText('E-mail do gerente');
    fireEvent.change(emailInput, { target: { value: 'novo@ex.com' } });
    fireEvent.click(screen.getByRole('button', { name: /Convidar/i }));

    await waitFor(() => {
      expect(mockRpc).toHaveBeenCalledWith('invite_company_manager', {
        p_company_id: 'comp-1',
        p_email: 'novo@ex.com',
      });
    });
    await waitFor(() => {
      expect(mockAddToast).toHaveBeenCalledWith('Convite enviado.', 'success');
    });
  });

  it('remove um gerente (R10 — soft delete)', async () => {
    mockRpc.mockImplementation((fn: string) => {
      if (fn === 'get_my_companies') {
        return Promise.resolve({
          data: [{
            company_id: 'comp-1', company_name: 'Loja Centro', role: 'owner',
            organization_id: 'org-1', organization_name: 'Rede X',
            onboarding_completed: true, accepted_tos: true,
          }],
          error: null,
        });
      }
      if (fn === 'revoke_company_manager') {
        return Promise.resolve({ data: { outcome: 'revoked', affected: 1 }, error: null });
      }
      return Promise.resolve({ data: null, error: null });
    });

    render(<Organization />);

    await waitFor(() => {
      expect(screen.getByText('ger@ex.com')).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole('button', { name: /Remover ger@ex.com/i }));

    await waitFor(() => {
      expect(mockRpc).toHaveBeenCalledWith('revoke_company_manager', {
        p_company_id: 'comp-1',
        p_user_id: null,
      });
    });
  });
});
