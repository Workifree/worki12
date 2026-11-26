import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import Help from '../pages/Help';
import Privacy from '../pages/Privacy';
import Terms from '../pages/Terms';
import { CONTACT_PENDING_TEXT, getContactEmail } from './contact';

vi.mock('../components/PageMeta', () => ({ default: () => null }));

const pages = [
    ['Ajuda', Help],
    ['Privacidade', Privacy],
    ['Termos', Terms],
] as const;

const mailLinks = (container: HTMLElement) => [...container.querySelectorAll('a[href^="mailto:"]')];

afterEach(() => {
    vi.unstubAllEnvs();
});

describe('canal de contato', () => {
    it('sem VITE_CONTACT_EMAIL não há canal', () => {
        vi.stubEnv('VITE_CONTACT_EMAIL', '   ');
        expect(getContactEmail()).toBeNull();
    });

    it.each(pages)('%s sem canal: nenhum link de e-mail', (name, Page) => {
        vi.stubEnv('VITE_CONTACT_EMAIL', '');
        const { container } = render(<MemoryRouter><Page /></MemoryRouter>);

        expect(mailLinks(container)).toHaveLength(0);
        if (name === 'Ajuda') {
            expect(screen.queryByRole('heading', { name: 'Contato' })).not.toBeInTheDocument();
            expect(screen.getByRole('heading', { name: /perguntas frequentes/i })).toBeInTheDocument();
        } else {
            expect(screen.getAllByText(CONTACT_PENDING_TEXT).length).toBeGreaterThan(0);
        }
    });

    it.each(pages)('%s com canal: mostra o mailto configurado', (_name, Page) => {
        vi.stubEnv('VITE_CONTACT_EMAIL', 'canal@example.com');
        const { container } = render(<MemoryRouter><Page /></MemoryRouter>);

        const links = mailLinks(container);
        expect(links.length).toBeGreaterThan(0);
        links.forEach((a) => expect(a).toHaveAttribute('href', 'mailto:canal@example.com'));
        expect(screen.queryByText(CONTACT_PENDING_TEXT)).not.toBeInTheDocument();
    });

    it('nenhum arquivo de frontend/src cita o domínio que não é nosso', () => {
        const sources = import.meta.glob('../**/*.{ts,tsx,css,json,html}', {
            query: '?raw', import: 'default', eager: true,
        }) as Record<string, string>;
        // Montado em partes para este próprio teste não conter o domínio.
        const domain = ['worki', 'com', 'br'].join('.');

        expect(Object.keys(sources).length).toBeGreaterThan(50);
        expect(Object.entries(sources).filter(([, text]) => text.includes(domain)).map(([file]) => file)).toEqual([]);
    });
});
