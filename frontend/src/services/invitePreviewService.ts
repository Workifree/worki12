/**
 * Prévia de convite por link (RPC `get_invite_preview`): quem está convidando, antes do aceite.
 * Contrato: `{ outcome: 'ok' | 'not_found', inviter_name, kind: 'elenco' | 'freela' | 'gerente' }`.
 * Só leitura e sempre tolerante: RPC ausente, erro ou resposta estranha viram `null` e a tela usa
 * o texto genérico. Nunca decide se o convite vale (isso é do aceite).
 */
import { supabase } from '../lib/supabase';
import { logError } from '../lib/logger';

export type InvitePreviewKind = 'elenco' | 'freela' | 'gerente';

const TIMEOUT_MS = 4000;

export async function getInvitePreviewName(token: string, kind: InvitePreviewKind): Promise<string | null> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const result = await Promise.race([
      Promise.resolve(supabase.rpc('get_invite_preview', { p_token: token })),
      new Promise<null>((resolve) => {
        timer = setTimeout(() => resolve(null), TIMEOUT_MS);
      }),
    ]);
    if (!result) return null;
    if (result.error) throw result.error;
    const data = result.data as { outcome?: unknown; inviter_name?: unknown; kind?: unknown } | null;
    if (!data || data.outcome !== 'ok' || data.kind !== kind || typeof data.inviter_name !== 'string') return null;
    return data.inviter_name.trim() || null;
  } catch (err) {
    logError('invitePreviewService.getInvitePreviewName', err);
    return null;
  } finally {
    if (timer) clearTimeout(timer);
  }
}
