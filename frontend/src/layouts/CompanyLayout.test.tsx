import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import CompanyLayout from './CompanyLayout';

vi.mock('../components/Sidebar', () => ({ default: () => null }));
vi.mock('../components/BottomNav', () => ({ default: () => null }));
vi.mock('../components/NotificationBell', () => ({ default: () => null }));

const renderAt = (path: string) => render(<MemoryRouter initialEntries={[path]}><CompanyLayout /></MemoryRouter>);

describe('CompanyLayout — "Criar turno" flutuante e cabeçalho do celular', () => {
  it.each(['/company/dashboard', '/company/hoje', '/company/jobs'])('%s mostra o botão e abre folga no fim', (path) => {
    const { container } = renderAt(path);
    expect(screen.getByRole('link', { name: 'Criar turno' })).toHaveAttribute('href', '/company/create');
    expect(container.querySelector('main')?.className).toContain('pb-40');
  });

  it.each(['/company/jobs/abc', '/company/messages', '/company/gestao'])('%s não tem botão', (path) => {
    renderAt(path);
    expect(screen.queryByRole('link', { name: 'Criar turno' })).not.toBeInTheDocument();
  });

  it('cabeçalho sem atalhos de Trilha e Equipe', () => {
    renderAt('/company/dashboard');
    expect(screen.queryByRole('link', { name: /Trilha|Equipe/ })).not.toBeInTheDocument();
  });
});
