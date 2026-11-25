import { supabase } from '../lib/supabase';
import { captureException, captureMessage } from '../lib/logger';

/**
 * Helper para chamar Supabase Edge Functions com error handling padronizado.
 * Extrai mensagem de erro do contexto da resposta quando disponivel.
 */
export async function invokeFunction<T = Record<string, unknown>>(
  functionName: string,
  body: Record<string, unknown>
): Promise<T> {
  const { data, error } = await supabase.functions.invoke(functionName, { body });

  if (error) {
    let msg = error.message;
    if (error.context && typeof error.context.json === 'function') {
      try {
        const errData = await error.context.json();
        msg = errData.error || msg;
      } catch { /* erro de parse ignorado */ }
    }
    const err = new Error(msg);
    captureException(err, { extra: { functionName } });
    throw err;
  }

  if (data?.error) {
    captureMessage(`Edge function ${functionName} returned error: ${data.error}`, 'warning');
    throw new Error(data.error);
  }

  return data as T;
}
