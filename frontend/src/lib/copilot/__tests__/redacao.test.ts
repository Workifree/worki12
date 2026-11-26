import { describe, expect, it } from 'vitest'
import clientCopy from '../redact.ts?raw'
import serverCopy from '../../../../../supabase/functions/copilot-llm/redact.ts?raw'
import { containsPII, redactPII } from '../redact'

const NOW = new Date('2026-11-25T12:00:00-03:00')
const red = (s: string) => redactPII(s, NOW)

describe('redação de dados pessoais', () => {
  it.each([
    ['CPF pontuado', 'cpf 529.982.247-25 ok', '529'],
    ['CPF corrido', 'doc 52998224725', '52998224725'],
    ['CPF espaçado', '5 2 9 9 8 2 2 4 7 2 5', '4 7 2 5'],
    ['CPF com caractere invisível', '529​982​247​25', '982'],
    ['CPF em largura total', '５２９９８２２４７２５', '2247'],
    ['CPF dentro de URL', 'https://x/y?d=529.982.247-25', '247'],
    ['CNPJ', '11.222.333/0001-81', '222'],
    ['CNPJ corrido', '11222333000181', '222333'],
    ['CNPJ alfanumérico', '12.ABC.345/01DE-35', 'ABC'],
    ['telefone com DDD', '(11) 98765-4321', '4321'],
    ['telefone fixo', '(11) 3456-7890', '7890'],
    ['telefone internacional', '+55 11 98765 4321', '98765'],
    ['celular sem DDD', 'liga 98765-4321', '4321'],
    ['link wa.me', 'wa.me/5511987654321', '98765'],
    ['e-mail', 'maria.silva+x@empresa.com.br', 'maria'],
    ['e-mail codificado', 'u=maria%40gmail.com', 'maria'],
    ['e-mail por extenso', 'maria arroba gmail ponto com', 'maria'],
    ['e-mail cortado', 'maria.silva@gm...', 'maria'],
    ['PIX aleatória', '123e4567-e89b-12d3-a456-426614174000', '4266'],
    ['PIX copia e cola', '00020126580014br.gov.bcb.pix0136abcdefgh5204000053039865802BR6304ABCD', 'bcb'],
    ['senha com dois pontos', 'senha: Segredo!2024', 'Segredo'],
    ['senha em frase', 'minha senha é gatinho', 'gatinho'],
    ['código OTP', 'o código é 482913', '482913'],
    ['OTP separado', 'token: 123 456', '456'],
    ['convite no caminho', 'https://worki.app/convite/Ab3dEf9hJkLmNoPq', 'Ab3dEf'],
    ['convite de equipe codificado', '/login?redirect=%2Fconvite-equipe%2Fzzz999SECRETO', 'SECRETO'],
    ['token curto na URL', '/x?token=abc123', 'abc123'],
    ['JWT', 'eyJhbGciOi.eyJzdWIiOiIx.c2lnbmF0dXJl', 'c2lnbm'],
    ['nascimento antigo', 'dia 12/03/1990', '1990'],
    ['nascimento ISO', '1990-03-12', '1990'],
    ['nascimento por extenso', '12 de março de 1990', '1990'],
    ['nascimento com ano curto', 'nasci em 12/03/90', '12/03'],
    ['CPF com vírgulas', 'cpf 123,456,789-09', '456'],
    ['CPF com espaços e dígitos finais', '123 456 789 09', '456'],
    ['CPF com ponto final', 'cpf 123.456.789.09', '456'],
    ['CPF colado em valor em dinheiro', 'R$ 123.456.789-09', '789-09'],
    ['e-mail com "at" e "ponto"', 'joao at gmail ponto com', 'joao'],
    ['e-mail com (at) e (dot)', 'joao (at) gmail (dot) com', 'joao'],
    ['senha em frase com "é"', 'minha senha é banana', 'banana'],
    ['senha em inglês', 'my password is banana', 'banana'],
    ['senha de uma letra', 'senha: x', ': x'],
  ])('%s', (_name, input, mustVanish) => {
    const out = red(input)
    expect(out).not.toContain(mustVanish)
    expect(red(out)).toBe(out)
    expect(containsPII(out, NOW)).toBe(false)
  })

  it.each([
    'Turno em 2026-11-28 das 18:00 às 23:00',
    'Data 28/11/2026, valor R$ 1.500,00, 3 vagas',
    '[12]<button> Publicar turno />',
    'Step 3 of 20',
    'id=empresa.turno-criar.enviar',
    'click_element_by_index',
    'Current time: 25/11/2026, 14:03:22',
  ])('preserva o que a tarefa precisa: %s', (input) => {
    expect(red(input)).toBe(input)
  })

  it.each([
    'R$ 80,00',
    'valor R$ 80,00 por turno',
    'R$80',
    'R$ 1.500,00',
    'de R$ 80,00 a R$ 120,00',
    'total R$ 12.345.678,90 no mês',
    'R$ 1.234.567,89 em 2026-11-28',
  ])('valor em dinheiro passa inteiro: %s', (input) => {
    expect(red(input)).toBe(input)
    expect(containsPII(input, NOW)).toBe(false)
  })

  it('dinheiro ao lado de dado pessoal: só o dado pessoal sai', () => {
    expect(red('paga R$ 80,00; cpf 529.982.247-25; tel (11) 98765-4321')).toBe('paga R$ 80,00; cpf [cpf]; tel [telefone]')
  })

  it('o marcador de dinheiro não pode ser forjado nem reaproveitado', () => {
    expect(red('R$ 80,00 e ' + String.fromCharCode(0xe000, 0xe101, 0xe001))).toBe('R$ 80,00 e ')
  })

  it.each([
    ['dígitos e vírgulas', '1,'.repeat(20_000)],
    ['dinheiro repetido', 'R$ 1.234,56 '.repeat(3_400)],
    ['R$ sem número', 'R$ '.repeat(13_000)],
    ['CPF quase completo', '123 456 78 '.repeat(3_600)],
    ['arroba sem fim', 'a at '.repeat(8_000)],
    ['(at) sem domínio', 'x (at) '.repeat(5_700)],
    ['senha sem fim', 'senha é '.repeat(5_000)],
    ['letras e espaços', 'a'.repeat(100) + ' '.repeat(39_900)],
    ['ponto e dígitos', '1.'.repeat(20_000)],
  ])('desempenho adversarial (40 mil caracteres): %s', (_n, input) => {
    const t = performance.now()
    redactPII(input.slice(0, 40_000), NOW)
    expect(performance.now() - t).toBeLessThan(1000)
  })

  it('a entrada não forja o marcador interno de data protegida', () => {
    expect(red('x '+String.fromCharCode(0xe000, 0xe100, 0xe001)+' y 28/11/2026')).toBe('x  y 28/11/2026')
  })

  it('várias datas recentes voltam nos lugares certos', () => {
    expect(red('de 28/11/2026 a 2026-12-05, cpf 52998224725')).toBe('de 28/11/2026 a 2026-12-05, cpf [numero]')
  })

  it('as cópias do cliente e do servidor são idênticas', () => {
    expect(clientCopy.replace(/\r\n/g, '\n')).toBe(serverCopy.replace(/\r\n/g, '\n'))
  })
})

describe('higiene do código-fonte', () => {
  const fontes = import.meta.glob(
    ['../**/*.{ts,tsx}', '../../../components/copilot/*.tsx', '../../../hooks/copilot/*.ts', '../../../services/copilot/*.ts', '../../../../../supabase/functions/copilot-llm/*.ts'],
    { query: '?raw', import: 'default', eager: true },
  ) as Record<string, string>

  it('nenhum caractere de controle ou invisível literal (um "\b" virando backspace desliga uma trava)', () => {
    const sujos = Object.entries(fontes).filter(([, code]) =>
      Array.from(code).some((c) => ![9, 10, 13].includes(c.charCodeAt(0)) && /[\p{Cc}\p{Cf}]/u.test(c)),
    )
    expect(sujos.map(([file]) => file)).toEqual([])
  })
})

describe('endpoint de demonstração do page-agent', () => {
  const dependencias = import.meta.glob('/node_modules/@page-agent/{core,llms,page-controller}/dist/**/*.js', {
    query: '?raw', import: 'default', eager: true,
  }) as Record<string, string>
  const nossas = import.meta.glob(
    ['../**/*.ts', '!../__tests__/**', '../../../components/copilot/*.tsx', '../../../hooks/copilot/*.ts', '../../../services/copilot/*.ts', '../../../../../supabase/functions/copilot-llm/*.ts'],
    { query: '?raw', import: 'default', eager: true },
  ) as Record<string, string>
  const PROIBIDO = /fcapp\.run|aliyun|page-ag-testing|dashscope/i

  it('não existe no código das dependências que entram no bundle nem no nosso', () => {
    expect(Object.keys(dependencias).length).toBeGreaterThanOrEqual(3)
    expect(Object.keys(nossas).length).toBeGreaterThan(15)
    const achados = Object.entries({ ...dependencias, ...nossas }).filter(([, code]) => PROIBIDO.test(code))
    expect(achados.map(([file]) => file)).toEqual([])
  })

  it('o pacote com a demo, o painel e a extensão nunca é importado', () => {
    const achados = Object.entries(nossas).filter(([, code]) => /from\s+['"](?:page-agent|@page-agent\/(?:ui|extension|mcp))['"/]/.test(code))
    expect(achados.map(([file]) => file)).toEqual([])
  })
})
