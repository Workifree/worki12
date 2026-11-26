import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import CompanyLayout from './CompanyLayout';

vi.mock('../contexts/AuthContext', () => ({ useAuth: () => ({ user: null }) }));
vi.mock('../contexts/ToastContext', () => ({ useToast: () => ({ addToast: vi.fn() }) }));
vi.mock('../components/Sidebar', () => ({ default: () => null }));
vi.mock('../components/BottomNav', () => ({ default: () => null }));
vi.mock('../components/NotificationBell', () => ({ default: () => null }));

const renderAt = (path: string) => render(<MemoryRouter initialEntries={[path]}><CompanyLayout /></MemoryRouter>);

describe('CompanyLayout', () => {
  it.each(['/company/dashboard', '/company/hoje', '/company/jobs'])(
    '%s não tem botão flutuante e a página (não o main) é quem rola',
    (path) => {
      const { container } = renderAt(path);
      expect(screen.queryByRole('link', { name: 'Criar turno' })).not.toBeInTheDocument();
      // `overflow` no main quebraria a ActionBar (sticky).
      expect(container.querySelector('main')?.className).not.toContain('overflow');
    },
  );

  it('cabeçalho sem atalhos de Trilha e Equipe', () => {
    renderAt('/company/dashboard');
    expect(screen.queryByRole('link', { name: /Trilha|Equipe/ })).not.toBeInTheDocument();
  });
});
