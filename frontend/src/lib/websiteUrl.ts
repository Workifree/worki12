/**
 * Normaliza o site digitado pela empresa para um href externo seguro.
 * Sem esquema vira `https://`; qualquer esquema que não seja http(s) (`javascript:`, `data:`...)
 * ou texto com espaço/caractere de controle devolve `null` (não vira link).
 */
export function toSafeWebsiteHref(raw: string | null | undefined): string | null {
  const value = raw?.trim();
  // eslint-disable-next-line no-control-regex
  if (!value || /[\s\u0000-\u001f\u007f]/.test(value)) return null;

  const isHttp = /^https?:\/\//i.test(value);
  // "algo:" é esquema, exceto "host:porta" (seguido de dígito).
  if (!isHttp && /^[a-z][a-z0-9+.-]*:(?!\d)/i.test(value)) return null;

  const href = isHttp ? value : `https://${value.replace(/^\/+/, '')}`;
  try {
    const { protocol } = new URL(href);
    return protocol === 'http:' || protocol === 'https:' ? href : null;
  } catch {
    return null;
  }
}
