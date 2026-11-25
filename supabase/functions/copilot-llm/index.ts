// copilot-llm — proxy do copiloto. A chave do provedor só existe aqui.
// Deploy NORMAL (com verificação de JWT no gateway); a função ainda exige um usuário real,
// porque a chave anon também é um JWT válido para o gateway.
//
// Secrets: COPILOT_LLM_PROVIDER (openai|anthropic), COPILOT_LLM_MODEL, COPILOT_LLM_API_KEY.
// Opcionais: COPILOT_ENABLED=false, COPILOT_ALLOWED_ORIGINS, COPILOT_LIMIT_PER_MINUTE,
// COPILOT_LIMIT_PER_DAY, COPILOT_USER_DAILY_TOKENS, COPILOT_GLOBAL_DAILY_TOKENS.
// Sem os três primeiros: 503, e o app oferece só o guia.
import { createClient } from 'jsr:@supabase/supabase-js@2'
import { handleCopilot, type Deps } from './handler.ts'

const admin = createClient(
  Deno.env.get('SUPABASE_URL') ?? '',
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
  { auth: { persistSession: false, autoRefreshToken: false } },
)

const deps: Deps = {
  env: (name) => Deno.env.get(name),
  async getUserId(token) {
    const { data, error } = await admin.auth.getUser(token)
    if (error || !data.user || data.user.is_anonymous) return null
    return data.user.id
  },
  async reserve(userId, limits, estimate) {
    const { data, error } = await admin.rpc('copilot_reserve', {
      p_user: userId,
      p_per_minute: limits.perMinute,
      p_per_day: limits.perDay,
      p_user_daily_tokens: limits.userDailyTokens,
      p_global_daily_tokens: limits.globalDailyTokens,
      p_estimate: estimate,
    })
    if (error) throw new Error('rpc')
    return data
  },
  async settle(userId, day, estimate, inputTokens, outputTokens) {
    const { error } = await admin.rpc('copilot_settle', {
      p_user: userId,
      p_day: day,
      p_estimate: estimate,
      p_input: inputTokens,
      p_output: outputTokens,
    })
    if (error) throw new Error('rpc')
  },
  fetch: (url, init) => fetch(url, { ...init, redirect: 'error' }),
  log: (event, data) => console.log(JSON.stringify({ fn: 'copilot-llm', event, ...data })),
}

Deno.serve((request) => handleCopilot(request, deps))
