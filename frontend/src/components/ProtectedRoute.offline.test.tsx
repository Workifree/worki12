import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, act } from '@testing-library/react'
import { MemoryRouter, Routes, Route } from 'react-router-dom'
import ProtectedRoute from './ProtectedRoute'
import HomeRedirect from './HomeRedirect'

const mockGetSession = vi.fn()
const mockGetUser = vi.fn()
const mockSingle = vi.fn()
let authListener: (event: string, session: unknown) => void

vi.mock('../lib/supabase', () => ({
    supabase: {
        auth: {
            getSession: () => mockGetSession(),
            getUser: () => mockGetUser(),
            onAuthStateChange: (cb: (event: string, session: unknown) => void) => {
                authListener = cb
                return { data: { subscription: { unsubscribe: vi.fn() } } }
            },
        },
        from: () => ({ select: () => ({ eq: () => ({ single: () => mockSingle() }) }) }),
    },
}))
vi.mock('../lib/logger', () => ({ logError: vi.fn() }))
vi.mock('../contexts/ToastContext', () => ({ useToast: () => ({ addToast: vi.fn() }) }))
vi.mock('../pages/Onboarding', () => ({ default: () => <div>Pagina publica</div> }))

const offline = { name: 'AuthRetryableFetchError', status: 0, message: 'Failed to fetch' }
const worker = { id: 'w1', user_metadata: { user_type: 'work' } }
const okSession = { data: { session: { user: worker } }, error: null }
const okProfile = { data: { onboarding_completed: true, accepted_tos: true }, error: null }
const failedRead = { data: null, error: { code: '', message: 'TypeError: Failed to fetch' } }

function renderGate() {
    render(
        <MemoryRouter initialEntries={['/dashboard']}>
            <Routes>
                <Route element={<ProtectedRoute />}>
                    <Route path="/dashboard" element={<div>Area protegida</div>} />
                    <Route path="/worker/onboarding" element={<div>Tela de onboarding</div>} />
                </Route>
                <Route path="/" element={<div>Home</div>} />
            </Routes>
        </MemoryRouter>,
    )
}

async function expectError() {
    expect(await screen.findByRole('button', { name: 'Tentar de novo' })).toBeInTheDocument()
    for (const text of ['Area protegida', 'Tela de onboarding', 'Home', 'Pagina publica']) {
        expect(screen.queryByText(text)).not.toBeInTheDocument()
    }
}

describe('gates sem rede', () => {
    beforeEach(() => {
        vi.resetAllMocks()
        mockGetSession.mockResolvedValue(okSession)
        mockSingle.mockResolvedValue(okProfile)
    })

    it('erro em workers nao leva ao onboarding; "Tentar de novo" recupera', async () => {
        mockSingle.mockResolvedValueOnce(failedRead)
        renderGate()
        await expectError()
        fireEvent.click(screen.getByRole('button', { name: 'Tentar de novo' }))
        expect(await screen.findByText('Area protegida')).toBeInTheDocument()
    })

    const abort = () => new DOMException('signal is aborted without reason', 'AbortError')

    it('AbortError do lock de auth e depois sucesso: abre sozinho, sem tela de erro', async () => {
        mockGetSession.mockRejectedValueOnce(abort()).mockResolvedValue(okSession)
        renderGate()
        expect(await screen.findByText('Area protegida', undefined, { timeout: 3000 })).toBeInTheDocument()
        expect(mockGetSession).toHaveBeenCalledTimes(2)
        expect(screen.queryByRole('button', { name: 'Tentar de novo' })).not.toBeInTheDocument()
    })

    it('AbortError persistente: gate fechado; "Tentar de novo" faz leitura nova e recupera', async () => {
        window.sessionStorage.setItem('worki:auth-lock-reload', '1') // o único reload já foi gasto
        mockGetSession.mockRejectedValue(abort())
        renderGate()
        expect(await screen.findByRole('button', { name: 'Tentar de novo' }, { timeout: 5000 })).toBeInTheDocument()
        await expectError()
        const antes = mockGetSession.mock.calls.length
        mockGetSession.mockResolvedValue(okSession)
        fireEvent.click(screen.getByRole('button', { name: 'Tentar de novo' }))
        expect(await screen.findByText('Area protegida')).toBeInTheDocument()
        expect(mockGetSession.mock.calls.length).toBeGreaterThan(antes)
        expect(window.sessionStorage.getItem('worki:auth-lock-reload')).toBeNull()
    })

    it('retoma sozinho no evento online', async () => {
        mockSingle.mockResolvedValueOnce(failedRead)
        renderGate()
        await expectError()
        act(() => { window.dispatchEvent(new Event('online')) })
        expect(await screen.findByText('Area protegida')).toBeInTheDocument()
    })

    it('sessao expirada sem rede nao vira deslogado, mesmo com INITIAL_SESSION nulo', async () => {
        mockGetSession.mockResolvedValue({ data: { session: null }, error: offline })
        renderGate()
        await expectError()
        act(() => { authListener('INITIAL_SESSION', null) })
        await expectError()
    })

    it('zero linhas (PGRST116) continua indo ao onboarding', async () => {
        mockSingle.mockResolvedValue({ data: null, error: { code: 'PGRST116' } })
        renderGate()
        expect(await screen.findByText('Tela de onboarding')).toBeInTheDocument()
    })

    it('tela ja verificada ignora sessao nula; SIGNED_OUT sai', async () => {
        renderGate()
        expect(await screen.findByText('Area protegida')).toBeInTheDocument()
        act(() => { authListener('INITIAL_SESSION', null) })
        expect(screen.getByText('Area protegida')).toBeInTheDocument()
        act(() => { authListener('SIGNED_OUT', null) })
        expect(await screen.findByText('Home')).toBeInTheDocument()
    })

    it('HomeRedirect: sem rede mostra erro, nao a pagina publica', async () => {
        mockGetUser.mockResolvedValue({ data: { user: null }, error: offline })
        render(<MemoryRouter><HomeRedirect /></MemoryRouter>)
        await expectError()
        mockGetUser.mockResolvedValue({ data: { user: null }, error: { name: 'AuthSessionMissingError' } })
        act(() => { window.dispatchEvent(new Event('online')) })
        expect(await screen.findByText('Pagina publica')).toBeInTheDocument()
    })
})
