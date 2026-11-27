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
                    <Route path="/company/configuracoes/equipe" element={<div data-testid="equipe-content">Equipe</div>} />
                    <Route path="/worker/onboarding" element={<div data-testid="worker-onboarding">Worker Onboarding</div>} />
                    <Route path="/company/onboarding" element={<div data-testid="company-onboarding">Company Onboarding</div>} />
                </Route>
                <Route path="/convite-equipe/:token" element={<div data-testid="convite-equipe">Convite</div>} />
                <Route path="/" element={<div data-testid="home-page">Home</div>} />
            </Routes>
        </MemoryRouter>
    )
}

/** Um único registro devolvido por `get_my_companies()` (F13, ddl-aprovado.md §7). */
function myCompaniesRow(overrides: Partial<{
    company_id: string;
    company_name: string;
    role: 'owner' | 'operator' | 'manager' | 'encarregado';
    confirmed: boolean;
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
        localStorage.clear()
        sessionStorage.clear()
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

        it('encarregado NÃO confirmado vê só a tela de espera, nunca o conteúdo (R22)', async () => {
            mockGetSession.mockResolvedValue({
                data: { session: { user: { id: 'enc-1', user_metadata: { user_type: 'hire' } } } },
            })
            mockRpc.mockResolvedValue({
                data: [myCompaniesRow({ company_id: 'comp-9', role: 'encarregado', confirmed: false })],
                error: null,
            })

            renderRoute('/company/dashboard')

            await waitFor(() => {
                expect(screen.getByText('Seu acesso está quase pronto')).toBeInTheDocument()
            })
            expect(screen.queryByTestId('outlet-content')).not.toBeInTheDocument()
        })

        it('ex-membro (removido/revogado) sem NENHUMA empresa vê "acesso encerrado", nunca o onboarding de CNPJ', async () => {
            localStorage.setItem('worki_team_member_hint:ex-1', '1')
            mockGetSession.mockResolvedValue({
                data: { session: { user: { id: 'ex-1', user_metadata: { user_type: 'hire' } } } },
            })
            mockRpc.mockResolvedValue({ data: [], error: null })

            renderRoute('/company/dashboard')

            await waitFor(() => {
                expect(screen.getByText('Seu acesso a essa empresa foi encerrado')).toBeInTheDocument()
            })
            expect(screen.queryByTestId('company-onboarding')).not.toBeInTheDocument()
            expect(screen.queryByTestId('outlet-content')).not.toBeInTheDocument()
        })

        it('dono NOVO no mesmo aparelho de um ex-membro não herda a marca: vai ao onboarding, não a "acesso encerrado"', async () => {
            localStorage.setItem('worki_team_member_hint:ex-1', '1')
            localStorage.setItem('worki_team_member_hint', '1') // marca global de versão antiga também é ignorada
            mockGetSession.mockResolvedValue({
                data: { session: { user: { id: 'dono-novo', user_metadata: { user_type: 'hire' } } } },
            })
            mockRpc.mockResolvedValue({ data: [], error: null })

            renderRoute('/company/dashboard')

            await waitFor(() => {
                expect(screen.getByTestId('company-onboarding')).toBeInTheDocument()
            })
            expect(screen.queryByText('Seu acesso a essa empresa foi encerrado')).not.toBeInTheDocument()
        })

        it('encarregado confirmado é barrado em /company/onboarding (Dados da empresa mostra sem acesso no GestorRouteGuard)', async () => {
            mockGetSession.mockResolvedValue({
                data: { session: { user: { id: 'enc-2', user_metadata: { user_type: 'hire' } } } },
            })
            mockRpc.mockResolvedValue({
                data: [myCompaniesRow({ company_id: 'comp-9', role: 'encarregado', confirmed: true })],
                error: null,
            })

            renderRoute('/company/onboarding')
            await waitFor(() => {
                expect(screen.getByTestId('outlet-content')).toBeInTheDocument()
            })
            expect(screen.queryByTestId('company-onboarding')).not.toBeInTheDocument()
        })

        it('quem está no meio do convite de equipe (token pendente) e sem empresa volta ao convite, não ao CNPJ', async () => {
            sessionStorage.setItem('pending_team_invite_token', 'tok-pendente')
            mockGetSession.mockResolvedValue({
                data: { session: { user: { id: 'novo-1', user_metadata: { user_type: 'hire' } } } },
            })
            mockRpc.mockResolvedValue({ data: [], error: null })

            renderRoute('/company/dashboard')

            await waitFor(() => {
                expect(screen.getByTestId('convite-equipe')).toBeInTheDocument()
            })
            expect(screen.queryByTestId('company-onboarding')).not.toBeInTheDocument()
        })

        it.each(['/company/dashboard', '/company/onboarding'])(
            'D-2: falha em get_my_companies (%s) mostra erro com "Tentar de novo", nunca o onboarding',
            async (path) => {
                mockGetSession.mockResolvedValue({
                    data: { session: { user: { id: 'dono-1', user_metadata: { user_type: 'hire' } } } },
                })
                mockRpc.mockResolvedValue({ data: null, error: new Error('Failed to fetch') })

                renderRoute(path)

                await waitFor(() => {
                    expect(screen.getByRole('button', { name: 'Tentar de novo' })).toBeInTheDocument()
                })
                expect(screen.getByText(/Nada foi alterado/)).toBeInTheDocument()
                expect(screen.queryByTestId('company-onboarding')).not.toBeInTheDocument()
                expect(screen.queryByTestId('outlet-content')).not.toBeInTheDocument()
            },
        )

        it('D-3: dono com token de convite na sessão e marca de equipe, sob falha, NÃO vê "o Gestor precisa liberar sua entrada"', async () => {
            sessionStorage.setItem('pending_team_invite_token', 'tok-qualquer')
            localStorage.setItem('worki_team_member_hint:dono-2', '1')
            mockGetSession.mockResolvedValue({
                data: { session: { user: { id: 'dono-2', user_metadata: { user_type: 'hire' } } } },
            })
            mockRpc.mockResolvedValue({ data: null, error: new Error('Failed to fetch') })

            renderRoute('/company/dashboard')

            await waitFor(() => {
                expect(screen.getByRole('button', { name: 'Tentar de novo' })).toBeInTheDocument()
            })
            expect(screen.queryByText('Seu acesso está quase pronto')).not.toBeInTheDocument()
            expect(screen.queryByText(/O Gestor precisa liberar/)).not.toBeInTheDocument()
        })

        it('encarregado NÃO confirmado não escapa da espera pela rota de onboarding', async () => {
            mockGetSession.mockResolvedValue({
                data: { session: { user: { id: 'enc-1b', user_metadata: { user_type: 'hire' } } } },
            })
            mockRpc.mockResolvedValue({
                data: [myCompaniesRow({ company_id: 'comp-9', role: 'encarregado', confirmed: false })],
                error: null,
            })

            renderRoute('/company/onboarding')

            await waitFor(() => {
                expect(screen.getByText('Seu acesso está quase pronto')).toBeInTheDocument()
            })
            expect(screen.queryByTestId('company-onboarding')).not.toBeInTheDocument()
        })

        it('encarregado CONFIRMADO opera: sem onboarding de CNPJ e sem TosGate de empresa', async () => {
            mockGetSession.mockResolvedValue({
                data: { session: { user: { id: 'enc-2', user_metadata: { user_type: 'hire' } } } },
            })
            mockRpc.mockResolvedValue({
                data: [myCompaniesRow({
                    company_id: 'comp-9', role: 'encarregado', confirmed: true,
                    onboarding_completed: false, accepted_tos: false,
                })],
                error: null,
            })

            renderRoute('/company/dashboard')

            await waitFor(() => {
                expect(screen.getByTestId('outlet-content')).toBeInTheDocument()
            })
            expect(screen.queryByTestId('company-onboarding')).not.toBeInTheDocument()
            expect(screen.queryByText('Termos de Uso Atualizados')).not.toBeInTheDocument()
        })

        it('Gestor (manager) acessa /company/configuracoes/equipe', async () => {
            mockGetSession.mockResolvedValue({
                data: { session: { user: { id: 'mgr-4', user_metadata: { user_type: 'hire' } } } },
            })
            mockRpc.mockResolvedValue({
                data: [myCompaniesRow({ company_id: 'comp-9', role: 'manager' })],
                error: null,
            })

            renderRoute('/company/configuracoes/equipe')

            await waitFor(() => {
                expect(screen.getByTestId('equipe-content')).toBeInTheDocument()
            })
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
