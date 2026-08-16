import { describe, it, expect } from 'vitest'
import { groupJobsByDay } from './CompanyJobs'

// Referência fixa (NUNCA `new Date()` real — vira o teste dependente do relógio do ambiente):
// sábado, 2026-08-16. Todo o teste é relativo a essa data, não à data de execução do CI.
const TODAY = new Date(2026, 7, 16) // mês 0-indexado: 7 = agosto

interface FakeJob {
  id: string
  start_date?: string | null
  work_start_time?: string | null
}

function job(id: string, start_date?: string | null, work_start_time?: string | null): FakeJob {
  return { id, start_date, work_start_time }
}

describe('groupJobsByDay — agenda por dia (CompanyJobs)', () => {
  it('caso de virada: turno de HOJE e turno de AMANHÃ vão para seções distintas', () => {
    const jobs = [job('hoje-1', '2026-08-16'), job('amanha-1', '2026-08-17')]
    const buckets = groupJobsByDay(jobs, TODAY)

    const today = buckets.find((b) => b.key === 'today')
    const tomorrow = buckets.find((b) => b.key === 'tomorrow')

    expect(today?.label).toBe('Hoje')
    expect(today?.jobs.map((j) => j.id)).toEqual(['hoje-1'])
    expect(tomorrow?.label).toBe('Amanhã')
    expect(tomorrow?.jobs.map((j) => j.id)).toEqual(['amanha-1'])
  })

  it('NÃO deixa o turno de amanhã cair na seção de hoje (regressão do off-by-one de fuso)', () => {
    const buckets = groupJobsByDay([job('amanha-1', '2026-08-17')], TODAY)
    const todayJobs = buckets.find((b) => b.key === 'today')?.jobs ?? []
    expect(todayJobs).toHaveLength(0)
  })

  it('turno sem start_date vai para "Sem Data" — nunca é escondido', () => {
    const buckets = groupJobsByDay([job('sem-data', null), job('sem-data-2', undefined)], TODAY)
    const noDate = buckets.find((b) => b.key === 'no_date')
    expect(noDate?.label).toBe('Sem Data')
    expect(noDate?.jobs).toHaveLength(2)
  })

  it('agrupa o restante da semana (2 a 6 dias à frente) em "Esta Semana", ordenado por data', () => {
    const jobs = [job('d5', '2026-08-21'), job('d2', '2026-08-18'), job('d6', '2026-08-22')]
    const buckets = groupJobsByDay(jobs, TODAY)
    const week = buckets.find((b) => b.key === 'week')
    expect(week?.label).toBe('Esta Semana')
    expect(week?.jobs.map((j) => j.id)).toEqual(['d2', 'd5', 'd6'])
  })

  it('turnos a mais de 6 dias vão para "Depois"', () => {
    const buckets = groupJobsByDay([job('longe', '2026-09-01')], TODAY)
    const later = buckets.find((b) => b.key === 'later')
    expect(later?.label).toBe('Depois')
    expect(later?.jobs.map((j) => j.id)).toEqual(['longe'])
  })

  it('turnos passados vão para "Anteriores", ordenados do mais recente para o mais antigo', () => {
    const jobs = [job('antigo', '2026-08-01'), job('recente', '2026-08-15')]
    const buckets = groupJobsByDay(jobs, TODAY)
    const past = buckets.find((b) => b.key === 'past')
    expect(past?.label).toBe('Anteriores')
    expect(past?.jobs.map((j) => j.id)).toEqual(['recente', 'antigo'])
  })

  it('não retorna seções vazias', () => {
    const buckets = groupJobsByDay([job('hoje-1', '2026-08-16')], TODAY)
    expect(buckets).toHaveLength(1)
    expect(buckets[0].key).toBe('today')
  })

  it('lista vazia não gera nenhuma seção', () => {
    expect(groupJobsByDay([], TODAY)).toEqual([])
  })

  it('ordena "Hoje" por horário de início (ascendente), não pela ordem de criação', () => {
    // Dois turnos no mesmo dia (almoço e jantar), inseridos fora de ordem.
    const jobs = [job('jantar', '2026-08-16', '18:00'), job('almoco', '2026-08-16', '11:00')]
    const buckets = groupJobsByDay(jobs, TODAY)
    const today = buckets.find((b) => b.key === 'today')
    expect(today?.jobs.map((j) => j.id)).toEqual(['almoco', 'jantar'])
  })

  it('ordena "Amanhã" por horário de início (ascendente)', () => {
    const jobs = [job('tarde', '2026-08-17', '15:00'), job('manha', '2026-08-17', '08:00')]
    const buckets = groupJobsByDay(jobs, TODAY)
    const tomorrow = buckets.find((b) => b.key === 'tomorrow')
    expect(tomorrow?.jobs.map((j) => j.id)).toEqual(['manha', 'tarde'])
  })

  it('turno de hoje sem horário definido cai para o fim, sem sumir da seção', () => {
    const jobs = [job('sem-horario', '2026-08-16', null), job('com-horario', '2026-08-16', '09:00')]
    const buckets = groupJobsByDay(jobs, TODAY)
    const today = buckets.find((b) => b.key === 'today')
    expect(today?.jobs.map((j) => j.id)).toEqual(['com-horario', 'sem-horario'])
  })

  it('preserva a ordem canônica das seções (Hoje, Amanhã, Esta Semana, Depois, Sem Data, Anteriores)', () => {
    const jobs = [
      job('past', '2026-08-01'),
      job('nodate', null),
      job('later', '2026-09-01'),
      job('week', '2026-08-19'),
      job('tomorrow', '2026-08-17'),
      job('today', '2026-08-16'),
    ]
    const buckets = groupJobsByDay(jobs, TODAY)
    expect(buckets.map((b) => b.key)).toEqual(['today', 'tomorrow', 'week', 'later', 'no_date', 'past'])
  })
})
