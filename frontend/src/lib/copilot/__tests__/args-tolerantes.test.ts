import { describe, expect, it } from 'vitest'
import { parseToolArguments } from '../../../../../supabase/functions/copilot-llm/providers.ts'

describe('argumentos da ferramenta com defeitos comuns de modelo', () => {
  const ok = { action: { done: { text: 'oi', success: true } } }
  it.each([
    ['limpo', JSON.stringify(ok)],
    ['cerca de código', '```json\n' + JSON.stringify(ok) + '\n```'],
    ['texto antes e depois', 'Claro! ' + JSON.stringify(ok) + ' Pronto.'],
    ['vírgula sobrando', '{"action":{"done":{"text":"oi","success":true,},},}'],
    ['codificado duas vezes', JSON.stringify(JSON.stringify(ok))],
  ])('%s vira objeto', (_nome, raw) => {
    expect(parseToolArguments(raw)).toEqual(ok)
  })
  it.each(['', 'não é json', '[1,2]', '"texto"', '{'])('lixo %j vira null', (raw) => {
    expect(parseToolArguments(raw)).toBeNull()
  })
})
