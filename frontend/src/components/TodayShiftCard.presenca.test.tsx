import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import TodayShiftCard, { type TodayShift } from './TodayShiftCard'

const mocks = vi.hoisted(() => ({
    update: vi.fn(() => ({ eq: () => ({ select: () => Promise.resolve({ data: [{ id: 'a1' }], error: null }) }) })),
}))
vi.mock('../lib/supabase', () => ({ supabase: { from: () => ({ update: mocks.update }), rpc: vi.fn() } }))
vi.mock('../lib/logger', () => ({ logError: vi.fn() }))
vi.mock('../contexts/ToastContext', () => ({ useToast: () => ({ addToast: vi.fn() }) }))

const shift: TodayShift = {
    applicationId: 'a1', status: 'in_progress', title: 'Turno', companyName: 'Empresa',
    startDate: '2026-01-01', startTime: '10:00', endTime: '18:00', location: null, pay: 100,
    presenceMode: 'qr_gps',
    // Chegada por exceção: só a empresa carimbou.
    worker_checkin_at: null, worker_checkout_at: null,
    company_checkin_confirmed_at: '2026-01-01T13:00:00Z', company_checkout_confirmed_at: null,
}

const registrarSaida = () => {
    render(<MemoryRouter><TodayShiftCard shift={shift} heading="Hoje" onChanged={() => undefined} /></MemoryRouter>)
    fireEvent.click(screen.getByRole('button', { name: 'Registrar saída' }))
}

afterEach(() => {
    vi.unstubAllEnvs()
    mocks.update.mockClear()
})

describe('TodayShiftCard — presença verificada', () => {
    it('flag desligada: grava direto, mesmo em turno qr_gps', () => {
        vi.stubEnv('VITE_FEATURE_PRESENCA', '')
        registrarSaida()
        expect(mocks.update).toHaveBeenCalledTimes(1)
        expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    })

    it('flag ligada: abre o fluxo, não grava direto e oferece pedir confirmação', () => {
        vi.stubEnv('VITE_FEATURE_PRESENCA', 'true')
        registrarSaida()
        expect(mocks.update).not.toHaveBeenCalled()
        expect(screen.getByRole('dialog')).toBeInTheDocument()
        expect(screen.getByRole('button', { name: 'Pedir confirmação ao responsável' })).toBeInTheDocument()
    })
})
