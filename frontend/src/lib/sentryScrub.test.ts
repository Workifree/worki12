import { describe, it, expect } from 'vitest';
import { scrubDeep, scrubInviteTokens } from './sentryScrub';

const TOKEN = 'ab12'.repeat(16);

describe('sentryScrub', () => {
  it('mascara o token de convite de equipe e de gerente, preservando query e hash', () => {
    expect(scrubInviteTokens(`https://worki.app/convite-equipe/${TOKEN}?x=1#h`)).toBe('https://worki.app/convite-equipe/[redacted]?x=1#h');
    expect(scrubInviteTokens(`/convite-gerente/${TOKEN}`)).toBe('/convite-gerente/[redacted]');
  });

  it('mascara o convite de freela (/convite/<token>)', () => {
    expect(scrubInviteTokens(`/convite/${TOKEN}?x=1`)).toBe('/convite/[redacted]?x=1');
    expect(scrubInviteTokens('/convite/w_abc-123')).toBe('/convite/[redacted]');
  });

  it('mascara as formas codificadas em ?redirect=, preservando os demais parâmetros', () => {
    for (const rota of ['convite', 'convite-equipe', 'convite-gerente']) {
      for (const barra of ['%2F', '%2f', '%252F', '%25252F']) {
        expect(scrubInviteTokens(`/login?redirect=${barra}${rota}${barra}${TOKEN}&type=hire`))
          .toBe(`/login?redirect=${barra}${rota}${barra}[redacted]&type=hire`);
      }
      expect(scrubInviteTokens(`/login?redirect=/${rota}/${TOKEN}&type=hire`))
        .toBe(`/login?redirect=/${rota}/[redacted]&type=hire`);
    }
    expect(scrubInviteTokens(`?redirect=%2Fconvite%2F${TOKEN}%3Fa%3D1`)).toBe('?redirect=%2Fconvite%2F[redacted]%3Fa%3D1');
  });

  it('não mexe em outras rotas', () => {
    expect(scrubInviteTokens('/convites/abc')).toBe('/convites/abc');
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
