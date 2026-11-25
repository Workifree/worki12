/** Fala com a edge function `copilot-llm`. A chave do provedor nunca passa pelo navegador. */
import { supabase } from '../../lib/supabase'
import { createCopilotFetch } from '../../lib/copilot/transport'
import type { CopilotRole } from '../../lib/copilot/routes'

export function copilotEndpoint(): string {
  return `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/copilot-llm`
}

async function authHeaders(): Promise<Record<string, string>> {
  const { data } = await supabase.auth.getSession()
  const token = data.session?.access_token
  if (!token) throw new Error('Sem sessão')
  return { Authorization: `Bearer ${token}`, apikey: import.meta.env.VITE_SUPABASE_ANON_KEY }
}

/** `false` para qualquer problema (sem secret = 503, função não publicada = 404, rede). */
export async function checkAgentAvailability(): Promise<boolean> {
  try {
    const response = await fetch(copilotEndpoint(), { method: 'GET', headers: await authHeaders(), credentials: 'omit' })
    if (!response.ok) return false
    const body = (await response.json()) as { available?: unknown }
    return body.available === true
  } catch {
    return false
  }
}

export function createAgentFetch(role: CopilotRole): typeof fetch {
  return createCopilotFetch({ endpoint: `${copilotEndpoint()}/chat/completions`, role, getHeaders: authHeaders })
}
