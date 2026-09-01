import { describe, it, expect, vi, beforeEach } from 'vitest'
import { invalidateCompanyScope } from '../services/companyScopeService'
import { render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter, Routes, Route } from 'react-router-dom'

// Mock supabase
const mockGetSession = vi.fn()
const mockOnAuthStateChange = vi.fn()
const mockFrom = vi.fn()
const mockRpc = vi.fn()

vi.mock('../lib/supabase', () => ({
    supabase: {
        auth: {
            getSession: (...args: unknown[]) => mockGetSession(...args),
            onAuthStateChange: (...args: unknown[]) => mockOnAuthStateChange(...args),
        },
        from: (...args: unknown[]) => mockFrom(...args),
        rpc: (...args: unknown[]) => mockRpc(...args),
    },
}))

// Mock logger
vi.mock('../lib/logger', () => ({
    logError: vi.fn(),
}))

// Mock ToastContext
vi.mock('../contexts/ToastContext', () => ({
    useToast: () => ({
        addToast: vi.fn(),
        removeToast: vi.fn(),
    }),
}))

import ProtectedRoute from './ProtectedRoute'

function renderRoute(path = '/dashboard') {
    return render(
        <MemoryRouter initialEntries={[path]}>
            <Routes>
                <Route element={<ProtectedRoute />}>
                    <Route path="/dashboard" element={<div data-testid="outlet-content">Conteudo Protegido</div>} />
                    <Route path="/company/dashboard" element={<div data-testid="outlet-content">Conteudo Protegido</div>} />
                    <Route path="/company/organization" element={<div data-testid="organization-content">Organização</div>} />
                    <Route path="/worker/onboarding" element={<div data-testid="worker-onboarding">Worker Onboarding</div>} />
                    <Route path="/company/onboarding" element={<div data-testid="company-onboarding">Company Onboarding</div>} />
                </Route>
                <Route path="/" element={<div data-testid="home-page">Home</div>} />
            </Routes>
        </MemoryRouter>
    )
}

/** Um único registro devolvido por `get_my_companies()` (F13, ddl-aprovado.md §7). */
function myCompaniesRow(overrides: Partial<{
    company_id: string;
    company_name: string;
    role: 'owner' | 'operator' | 'manager';
    organization_id: string;
    organization_name: string;
    onboarding_completed: boolean;
    accepted_tos: boolean;
}> = {}) {
    return {
        company_id: 'comp-1',
        company_name: 'Divino Fogão',
        role: 'owner' as const,
        organization_id: 'org-1',
        organization_name: 'Divino Fogão',
        onboarding_completed: true,
        accepted_tos: true,
        ...overrides,
    }
}

describe('ProtectedRoute - Onboarding Gate', () => {
    beforeEach(() => {
        invalidateCompanyScope()  // o cache de rajada do seam nao pode vazar entre testes
        vi.clearAllMocks()
        mockOnAuthStateChange.mockReturnValue({
            data: { subscription: { unsubscribe: vi.fn() } },
        })
    })

    it('worker com onboarding_completed=true renderiza Outlet', async () => {
        mockGetSession.mockResolvedValue({
            data: { session: { user: { id: 'w2', user_metadata: { user_type: 'work' } } } },
        })
        mockFrom.mockReturnValue({
            select: vi.fn(() => ({
                eq: vi.fn(() => ({
                    single: vi.fn().mockResolvedValue({
                        data: { onboarding_completed: true, accepted_tos: true },
                        error: null,
                    }),
                })),
            })),
        })

        renderRoute('/dashboard')

        await waitFor(() => {
            expect(screen.getByTestId('outlet-content')).toBeInTheDocument()
        })
    })

    it('rota /worker/onboarding com onboarding incompleto renderiza Outlet sem redirect', async () => {
        mockGetSession.mockResolvedValue({
            data: { session: { user: { id: 'w3', user_metadata: { user_type: 'work' } } } },
        })

        renderRoute('/worker/onboarding')

        await waitFor(() => {
            expect(screen.getByTestId('worker-onboarding')).toBeInTheDocument()
        })
    })

    it('usuario nao autenticado redireciona para /', async () => {
        mockGetSession.mockResolvedValue({
            data: { session: null },
        })

        renderRoute('/dashboard')

        await waitFor(() => {
            expect(screen.getByTestId('home-page')).toBeInTheDocument()
        })
    })

    it('empresa (dona direta) com onboarding_completed=true renderiza Outlet', async () => {
        mockGetSession.mockResolvedValue({
            data: { session: { user: { id: 'c1', user_metadata: { user_type: 'hire' } } } },
        })
        mockRpc.mockResolvedValue({
            data: [myCompaniesRow({ company_id: 'c1', role: 'owner' })],
            error: null,
        })

        renderRoute('/company/dashboard')

        await waitFor(() => {
            expect(screen.getByTestId('outlet-content')).toBeInTheDocument()
        })
    })

    // ------------------------------------------------------------------------
    // F13 (R11/A7) — o achado mais crítico da spec: um gerente ativo
    // (`company_members`, sem linha própria em `companies`) NÃO pode cair no loop de
    // onboarding permanente. `get_my_companies()` é o único resolvedor de escopo — nunca
    // `.eq('id', authUser.id).single()`.
    // ------------------------------------------------------------------------
    describe('F13 — gerente (company_members ativo, sem linha própria em companies)', () => {
        it('gerente com onboarding_completed=true na unidade NÃO é redirecionado para /company/onboarding', async () => {
            mockGetSession.mockResolvedValue({
                data: { session: { user: { id: 'manager-1', user_metadata: { user_type: 'hire' } } } },
            })
            // get_my_companies() devolve a unidade que o gerente OPERA (role='manager'),
            // mesmo sem `companies.id = 'manager-1'` existir.
            mockRpc.mockResolvedValue({
                data: [myCompaniesRow({ company_id: 'comp-9', role: 'manager', onboarding_completed: true })],
                error: null,
            })

            renderRoute('/company/dashboard')

            await waitFor(() => {
                expect(screen.getByTestId('outlet-content')).toBeInTheDocument()
            })
            expect(screen.queryByTestId('company-onboarding')).not.toBeInTheDocument()
        })

        it('gerente sem NENHUMA unidade (get_my_companies devolve 0 linhas) vai para onboarding', async () => {
            mockGetSession.mockResolvedValue({
                data: { session: { user: { id: 'manager-2', user_metadata: { user_type: 'hire' } } } },
            })
            mockRpc.mockResolvedValue({ data: [], error: null })

            renderRoute('/company/dashboard')

            await waitFor(() => {
                expect(screen.getByTestId('company-onboarding')).toBeInTheDocument()
            })
        })

        it('gerente comum (role=manager) é bloqueado de /company/organization — só sócio/operador', async () => {
            mockGetSession.mockResolvedValue({
                data: { session: { user: { id: 'manager-3', user_metadata: { user_type: 'hire' } } } },
            })
            mockRpc.mockResolvedValue({
                data: [myCompaniesRow({ company_id: 'comp-9', role: 'manager' })],
                error: null,
            })

            renderRoute('/company/organization')

            await waitFor(() => {
                expect(screen.getByTestId('outlet-content')).toBeInTheDocument()
            })
            expect(screen.queryByTestId('organization-content')).not.toBeInTheDocument()
        })

        it('sócio/operador (role=operator) acessa /company/organization normalmente', async () => {
            mockGetSession.mockResolvedValue({
                data: { session: { user: { id: 'operator-1', user_metadata: { user_type: 'hire' } } } },
            })
            mockRpc.mockResolvedValue({
                data: [myCompaniesRow({ company_id: 'comp-9', role: 'operator' })],
                error: null,
            })

            renderRoute('/company/organization')

            await waitFor(() => {
                expect(screen.getByTestId('organization-content')).toBeInTheDocument()
            })
        })
    })
})
