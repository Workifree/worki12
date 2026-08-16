// ---------------------------------------------------------------------------
// Utilitários compartilhados entre os componentes de `components/team/`.
// ---------------------------------------------------------------------------

/** Formata uma data "date-only" (YYYY-MM-DD) sem shift de fuso (mesmo padrão de ReceiptView). */
export function formatHistoryDate(dateOnly: string): string {
  const [y, m, d] = dateOnly.split('-').map(Number);
  const date = new Date(y, (m ?? 1) - 1, d ?? 1);
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
