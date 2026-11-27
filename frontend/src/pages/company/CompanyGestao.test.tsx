import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import CompanyGestao from './CompanyGestao';
import type { MyCompany } from '../../types';

let mockCompany: MyCompany | null = null;
let mockTrail = false;
vi.mock('../../hooks/useCurrentCompany', () => ({
  useCurrentCompanyState: () => ({ company: mockCompany, resolved: true, error: false }),
}));
vi.mock('../../hooks/useBonusTrailAccess', () => ({ useBonusTrailAccess: () => mockTrail }));
vi.mock('../../components/PageMeta', () => ({ default: () => null }));
vi.mock('../../contexts/AuthContext', () => ({ useAuth: () => ({ signOut: vi.fn() }) }));
vi.mock('../../contexts/ToastContext', () => ({ useToast: () => ({ addToast: vi.fn() }) }));
vi.mock('../../lib/supabase', () => ({ supabase: { auth: { onAuthStateChange: vi.fn() } } }));

function company(overrides: Partial<MyCompany> = {}): MyCompany {
  return {
    company_id: 'c1', company_name: 'Loja', role: 'owner', organization_id: 'o1', organization_name: null,
    onboarding_completed: true, accepted_tos: true, team_enabled: false, ...overrides,
  };
}

const renderPage = () => render(<MemoryRouter><CompanyGestao /></MemoryRouter>);
const card = (name: RegExp) => screen.queryByRole('link', { name });

describe('CompanyGestao', () => {
  beforeEach(() => {
    mockTrail = false;
  });

  it('dono único: pode convidar, vê dados e ajuda; sem trilha', () => {
    mockCompany = company();
    renderPage();

    expect(card(/Equipe.*Convide seu primeiro encarregado/)).toHaveAttribute('href', '/company/configuracoes/equipe');
    expect(card(/Dados da empresa/)).toHaveAttribute('href', '/company/profile');
    expect(card(/Ajuda/)).toHaveAttribute('href', '/ajuda');
    expect(card(/Trilha/)).not.toBeInTheDocument();
  });

  it('gerente: sem Unidades (removidas)', () => {
    mockCompany = company({ role: 'manager' });
    renderPage();

    expect(card(/Unidades/)).not.toBeInTheDocument();
    expect(card(/Dados da empresa/)).toBeInTheDocument();
  });

  it('encarregado com trilha: só Trilha e Ajuda (nada de acesso novo)', () => {
    mockCompany = company({ role: 'encarregado' });
    mockTrail = true;
    renderPage();

    expect(screen.getAllByRole('link').map((a) => a.getAttribute('href'))).toEqual(['/company/trilha', '/ajuda']);
    expect(screen.getByRole('button', { name: 'Sair' })).toBeInTheDocument();
  });
});
