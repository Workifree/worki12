/**
 * Estado de acesso da própria sessão (RPC `my_access_state`, migration 20261126000600).
 * Só para roteamento: não é autorização (essa é do RLS).
 */
import { supabase } from '../lib/supabase';
import { logError } from '../lib/logger';

export interface AccessState {
  /** Já teve algum vínculo de equipe encerrado. */
  removed: boolean;
  /** Tem vínculo ativo com empresa de outra pessoa. */
  hasActive: boolean;
  /** Tem empresa própria com onboarding concluído (a casca do cadastro não conta). */
  ownsCompany: boolean;
}

/** `null` = desconhecido (RPC falhou, não existe ou respondeu em formato inesperado). */
export async function getMyAccessState(): Promise<AccessState | null> {
  try {
    const { data, error } = await supabase.rpc('my_access_state');
    if (error) throw error;
    const row = data as { removed?: unknown; has_active?: unknown; owns_company?: unknown } | null;
    if (
      typeof row?.removed !== 'boolean' ||
      typeof row.has_active !== 'boolean' ||
      typeof row.owns_company !== 'boolean'
    ) {
      throw new Error('my_access_state: resposta inesperada');
    }
    return { removed: row.removed, hasActive: row.has_active, ownsCompany: row.owns_company };
  } catch (err) {
    logError('accessStateService.getMyAccessState', err);
    return null;
  }
}
