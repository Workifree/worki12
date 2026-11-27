import { describe, it, expect, vi, beforeEach } from 'vitest'

const mockGetUser = vi.fn()
const mockRpc = vi.fn()
const mockFrom = vi.fn()

vi.mock('../lib/supabase', () => ({
  supabase: {
    auth: { getUser: (...args: unknown[]) => mockGetUser(...args) },
    rpc: (...args: unknown[]) => mockRpc(...args),
    from: (...args: unknown[]) => mockFrom(...args),
  },
}))

vi.mock('./companyScopeService', () => ({
  getAuthenticatedCompanyId: vi.fn().mockResolvedValue('company-1'),
}))

import { OrderReportService, toCSV, reportOutcomeMessage } from './orderReportService'
import type { FinancialReportRow } from '../types'

function row(over: Partial<FinancialReportRow> = {}): FinancialReportRow {
  return {
    job_id: 'job-1', job_title: 'Evento sábado', job_category: 'garcom', job_date: '2026-11-21',
    tag_id: 'tag-1', tag_name: 'Loja Centro', responsible_id: 'u-1', responsible_name: 'Sabrina',
    worker_id: 'w-1', worker_name: 'Ana Souza',
    checkin_at: '2026-11-21T20:00:00Z', checkout_at: '2026-11-22T04:00:00Z', checkout_confirmed: true,
    hours: 8, hours_estimated: 6, amount: 160, amount_kind: 'realized', hourly_rate: 20,
    payment_id: 'pay-aaaa-bbbb', payment_status: 'recorded', source: 'external_pix',
    paid_at: '2026-11-22T15:00:00Z', scheduled_for: null, worker_confirmed_at: null, status: 'paga',
    ...over,
  }
}

const SUMS = { shifts_count: 1, hours_total: 8, hours_missing_count: 0, total_amount: 160, total_paid: 160, total_to_pay: 0 }
const TOTALS = {
  by_worker: [{ worker_id: 'w-1', worker_name: 'Ana Souza', ...SUMS }],
  by_day: [{ job_date: '2026-11-21', ...SUMS }],
  overall: SUMS,
}

beforeEach(() => {
  vi.clearAllMocks()
  mockGetUser.mockResolvedValue({ data: { user: { id: 'u-1' } }, error: null })
})

describe('OrderReportService.getReport', () => {
  it('chama get_financial_report com a empresa do seam e filtros, sem ler tabelas', async () => {
    mockRpc.mockResolvedValue({ data: { outcome: 'ok', scope: 'company', truncated: false, rows: [row()], totals: TOTALS }, error: null })

    const report = await OrderReportService.getReport({
      from: '2026-11-01', to: '2026-11-30', status: 'paga', workerId: 'w-1', responsibleId: '', tagId: 'tag-1',
    })

    expect(mockRpc).toHaveBeenCalledWith('get_financial_report', {
      p_company_id: 'company-1', p_from: '2026-11-01', p_to: '2026-11-30',
      p_worker_id: 'w-1', p_responsible_id: null, p_tag_id: 'tag-1', p_status: 'paga',
    })
    expect(mockFrom).not.toHaveBeenCalled()
    expect(report.outcome).toBe('ok')
    expect(report.rows).toHaveLength(1)
    expect(report.totals.overall.total_paid).toBe(160)
    expect(report.totals.by_day[0].job_date).toBe('2026-11-21')
  })

  it("status 'todas' vira null", async () => {
    mockRpc.mockResolvedValue({ data: { outcome: 'ok', rows: [], totals: TOTALS }, error: null })
    await OrderReportService.getReport({ from: '2026-11-01', to: '2026-11-02', status: 'todas' })
    expect(mockRpc.mock.calls[0][1].p_status).toBeNull()
  })

  it('devolve o outcome não-ok como dado (forbidden / not_confirmed / range_too_large)', async () => {
    mockRpc.mockResolvedValue({ data: { outcome: 'not_confirmed', rows: [] }, error: null })
    const report = await OrderReportService.getReport({ from: '2026-11-01', to: '2026-11-02' })
    expect(report.outcome).toBe('not_confirmed')
    expect(report.rows).toEqual([])
    expect(reportOutcomeMessage('not_confirmed')).toMatch(/confirmado/i)
    expect(reportOutcomeMessage('range_too_large')).toMatch(/92/)
    expect(reportOutcomeMessage('invalid_range')).toMatch(/datas/)
  })

  it('normaliza numéricos que chegam como string e preserva horas nulas (nunca 0)', async () => {
    mockRpc.mockResolvedValue({
      data: { outcome: 'ok', scope: 'own', truncated: true, rows: [row({ hours: null, hourly_rate: null, amount: '90.5' as unknown as number })], totals: TOTALS },
      error: null,
    })
    const report = await OrderReportService.getReport({ from: '2026-11-01', to: '2026-11-02' })
    expect(report.scope).toBe('own')
    expect(report.truncated).toBe(true)
    expect(report.rows[0].hours).toBeNull()
    expect(report.rows[0].hourly_rate).toBeNull()
    expect(report.rows[0].amount).toBe(90.5)
  })

  it('erro da RPC lança (a tela mostra erro, não relatório vazio)', async () => {
    mockRpc.mockResolvedValue({ data: null, error: { message: 'boom' } })
    await expect(OrderReportService.getReport({ from: '2026-11-01', to: '2026-11-02' })).rejects.toBeTruthy()
  })

  it('sem sessão: unauthenticated, sem chamar a RPC', async () => {
    mockGetUser.mockResolvedValue({ data: { user: null }, error: null })
    const report = await OrderReportService.getReport({ from: '2026-11-01', to: '2026-11-02' })
    expect(report.outcome).toBe('unauthenticated')
    expect(mockRpc).not.toHaveBeenCalled()
  })
})

describe('toCSV', () => {
  it('começa com BOM, usa ; e vírgula decimal, com as colunas novas', () => {
    const csv = toCSV({ rows: [row()] })
    expect(csv.charCodeAt(0)).toBe(0xfeff)
    const [header, line] = csv.slice(1).split('\r\n')
    expect(header).toBe(
      'Data;Etiqueta;Turno;Função;Responsável;Freela;Check-in;Check-out;Horas;Valor/hora;Valor;Tipo do valor;Forma;Status;Data Pgto;ID do pagamento',
    )
    const cells = line.split(';')
    expect(cells[0]).toBe('21/11/2026')
    expect(cells[1]).toBe('Loja Centro')
    expect(cells[2]).toBe('Evento sábado')
    expect(cells[4]).toBe('Sabrina')
    expect(cells[5]).toBe('Ana Souza')
    expect(cells[8]).toBe('8,00')
    expect(cells[9]).toBe('20,00')
    expect(cells[10]).toBe('160,00')
    expect(cells[11]).toBe('Real')
    expect(cells[12]).toBe('PIX')
    expect(cells[13]).toBe('Paga')
    expect(cells[15]).toBe('pay-aaaa-bbbb')
  })

  it('horas e valor/hora vazios ficam em branco; valor estimado é rotulado', () => {
    const csv = toCSV({ rows: [row({ hours: null, hourly_rate: null, checkin_at: null, checkout_at: null, amount_kind: 'estimated', status: 'aberta', payment_id: null, source: null, paid_at: null })] })
    const cells = csv.slice(1).split('\r\n')[1].split(';')
    expect(cells[6]).toBe('')
    expect(cells[8]).toBe('')
    expect(cells[9]).toBe('')
    expect(cells[11]).toBe('Estimado')
    expect(cells[13]).toBe('Aberta')
  })

  it('protege texto livre contra fórmula (= + - @ tab) e escapa ; e aspas', () => {
    const csv = toCSV({
      rows: [row({ worker_name: '=HYPERLINK("x")', tag_name: '+cmd', responsible_name: '@alguem', job_title: '\tTab', job_category: null })],
    })
    const line = csv.slice(1).split('\r\n')[1]
    expect(line).toContain("\"'=HYPERLINK(\"\"x\"\")\"")
    expect(line).toContain("'+cmd")
    expect(line).toContain("'@alguem")
    expect(line).toContain("'\tTab")
  })

  it('rotula estimado por horas previstas', () => {
    const csv = toCSV({ rows: [row({ amount_kind: 'estimated_by_planned_hours' })] })
    expect(csv).toContain(';Estimado (horas previstas);')
  })

  it('número negativo legítimo não recebe apóstrofo', () => {
    const csv = toCSV({ rows: [row({ amount: -10 })] })
    expect(csv).toContain(';-10,00;')
  })
})
