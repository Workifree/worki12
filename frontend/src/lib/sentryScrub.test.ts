import { describe, it, expect } from 'vitest';
import { scrubDeep, scrubInviteTokens } from './sentryScrub';

const TOKEN = 'ab12'.repeat(16);

describe('sentryScrub', () => {
  it('mascara o token de convite de equipe e de gerente, preservando query e hash', () => {
    expect(scrubInviteTokens(`https://worki.app/convite-equipe/${TOKEN}?x=1#h`)).toBe('https://worki.app/convite-equipe/[redacted]?x=1#h');
    expect(scrubInviteTokens(`/convite-gerente/${TOKEN}`)).toBe('/convite-gerente/[redacted]');
  });

  it('não mexe em outras rotas', () => {
    expect(scrubInviteTokens('/convite/abc')).toBe('/convite/abc');
    expect(scrubInviteTokens('/company/hoje')).toBe('/company/hoje');
  });

  it('mascara em URL de request, breadcrumbs e nome de transação do evento', () => {
    const event = {
      transaction: `/convite-equipe/${TOKEN}`,
      request: { url: `https://worki.app/convite-equipe/${TOKEN}` },
      breadcrumbs: [
        { category: 'navigation', data: { from: '/', to: `/convite-gerente/${TOKEN}` } },
        { category: 'fetch', data: { url: `https://x/convite-equipe/${TOKEN}?a=b` } },
      ],
      spans: [{ description: `GET /convite-equipe/${TOKEN}` }],
    };
    const out = JSON.stringify(scrubDeep(event));
    expect(out).not.toContain(TOKEN);
    expect(out).toContain('[redacted]');
    expect(event.request.url).toContain(TOKEN); // não muta o original
  });
});
