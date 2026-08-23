// ---------------------------------------------------------------------------
// Utilitários compartilhados entre os componentes de `components/team/`.
// ---------------------------------------------------------------------------

/**
 * Formata para dd/mm/aaaa aceitando as DUAS formas que os chamadores passam.
 *
 * Nasceu aceitando so "date-only" (YYYY-MM-DD), mas os dois call sites reais passam
 * `jobs.start_date`, que e timestamptz ("2026-08-23T13:00:00+00:00"). O split('-') virava
 * ["2026","08","23T13:00:00+00:00"], Number() do terceiro dava NaN, e o card do elenco exibia
 * "ultimo em Invalid Date" para toda empresa que tivesse historico com o freela.
 *
 * As duas formas precisam de tratamento DIFERENTE, e por isso nao da para so fatiar 10 caracteres:
 *   - date-only nao tem fuso; construir com `new Date(y, m-1, d)` evita o shift que UTC causaria.
 *   - timestamptz tem instante real; a data que interessa e a LOCAL de quem le. Fatiar os 10
 *     primeiros caracteres devolveria a data UTC, e um turno as 02:00 UTC de 24/08 apareceria
 *     como 24/08 para alguem que o viveu as 23:00 de 23/08.
 */
export function formatHistoryDate(value: string): string {
  const raw = (value ?? '').trim();
  if (!raw) return '—';

  const dateOnly = /^\d{4}-\d{2}-\d{2}$/.test(raw);
  const date = dateOnly
    ? (() => { const [y, m, d] = raw.split('-').map(Number); return new Date(y, m - 1, d); })()
    : new Date(raw);

  if (Number.isNaN(date.getTime())) return '—';
  return date.toLocaleDateString('pt-BR');
}

// UUID "solto" — mesmo formato usado como Worki ID (auth.uid()). O QR de
// identidade (Profile.tsx) codifica o workerId cru, sem prefixo/URL.
export const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Extrai o token de convite de um texto colado pelo usuário.
 *
 * O freela pode colar a URL completa (`https://.../convite/w_xxxx`) ou só o
 * token (`w_xxxx`). Se `raw` for uma URL válida, pega o último segmento do
 * path; caso contrário, assume que já é o token puro.
 */
export function extractInviteToken(raw: string): string {
  const trimmed = raw.trim();
  if (!trimmed) return '';
  try {
    const url = new URL(trimmed);
    const segments = url.pathname.split('/').filter(Boolean);
    return segments[segments.length - 1] ?? trimmed;
  } catch {
    return trimmed;
  }
}
