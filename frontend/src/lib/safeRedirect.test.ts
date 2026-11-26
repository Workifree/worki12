import { describe, it, expect } from 'vitest';
import { safeInternalPath } from './safeRedirect';

describe('safeInternalPath', () => {
    it.each([
        '/convite/abc123',
        '/convite/w_YWJj',
        '/convite-gerente/tok',
        '/company/dashboard?aba=1&volta=%2Fx#topo',
    ])('aceita caminho interno %s', (value) => {
        expect(safeInternalPath(value)).toBe(value);
    });

    it.each([
        '//site-externo.com',
        '///site-externo.com',
        '/\\site-externo.com',
        '\\\\site-externo.com',
        '/\t/site-externo.com',
        '/\n/site-externo.com',
        '/%2F%2Fsite-externo.com',
        '/%2fsite-externo.com',
        '/%5Csite-externo.com',
        '/%255Csite-externo.com',
        '/%252Fsite-externo.com',
        '/%09/site-externo.com',
        '%2F%2Fsite-externo.com',
        'https://site-externo.com',
        'javascript:alert(1)',
        'site-externo.com',
        '/%E0%A4%A',
        '',
    ])('recusa %j', (value) => {
        expect(safeInternalPath(value)).toBeNull();
    });

    it('recusa ausente', () => {
        expect(safeInternalPath(null)).toBeNull();
        expect(safeInternalPath(undefined)).toBeNull();
    });
});
