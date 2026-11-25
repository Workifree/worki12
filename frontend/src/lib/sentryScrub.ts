/**
 * Mascara o TOKEN dos links de convite (`/convite/<token>`, `/convite-equipe/<token>`,
 * `/convite-gerente/<token>`) antes de qualquer dado sair para o Sentry. O token é segredo ao
 * portador. Vale também para as formas codificadas (`?redirect=%2Fconvite%2F<token>`, inclusive
 * codificadas mais de uma vez), em URL, breadcrumbs, transação, spans e qualquer outra string.
 */
const SLASH = String.raw`(?:\/|%(?:25)*2F)`;
// O token termina em separador literal ou codificado (`/`, `?`, `#`, `&`).
const INVITE_TOKEN = new RegExp(
  String.raw`(${SLASH}convite(?:-equipe|-gerente)?${SLASH})(?:(?!%(?:25)*(?:2F|3F|23|26))[^/?#&\s"'<>])+`,
  'gi',
);

export function scrubInviteTokens(text: string): string {
  return text.replace(INVITE_TOKEN, '$1[redacted]');
}

const MAX_DEPTH = 8;

/** Percorre o valor (objetos/arrays) mascarando toda string; devolve o mesmo formato. */
export function scrubDeep<T>(value: T, depth = 0): T {
  if (typeof value === 'string') return scrubInviteTokens(value) as unknown as T;
  if (depth >= MAX_DEPTH || value === null || typeof value !== 'object') return value;
  if (Array.isArray(value)) return value.map((item) => scrubDeep(item, depth + 1)) as unknown as T;
  const out: Record<string, unknown> = {};
  for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
    out[key] = scrubDeep(item, depth + 1);
  }
  return out as T;
}
