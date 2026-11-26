import { act, render, screen } from '@testing-library/react'
import { MemoryRouter, useLocation, useNavigate } from 'react-router-dom'
import { useEffect } from 'react'
import { describe, expect, it, vi } from 'vitest'
import { GuideProvider } from './GuideProvider'
import { useGuide } from '../../hooks/useGuide'
import { guia } from '../../lib/guide/api'

vi.mock('../../services/analytics', () => ({ AnalyticsService: { trackEvent: vi.fn() } }))
vi.mock('../../contexts/AuthContext', () => ({ useAuth: () => ({ user: { id: 'g1' } }) }))

let navegar: ReturnType<typeof useNavigate>

function Tela() {
  const definir = useGuide()?.definirPapel
  const ir = useNavigate()
  useEffect(() => { navegar = ir })
  useEffect(() => { definir?.('gestor') }, [definir])
  return <p data-testid="caminho">{useLocation().pathname}</p>
}

const montar = (inicio: string) => render(
  <MemoryRouter initialEntries={[inicio]}><GuideProvider><Tela /></GuideProvider></MemoryRouter>,
)
const esperar = () => act(async () => { await new Promise((r) => setTimeout(r, 30)) })
const caminho = () => screen.getByTestId('caminho').textContent

describe('guia da empresa: chegada à tela do turno', () => {
  it('já na presença, começa no passo seguinte sem sair dali; Voltar não quica', async () => {
    montar('/company/jobs/1/candidates')
    await esperar()
    act(() => { guia.iniciarRoteiro('empresa-presenca') })
    await esperar()
    expect(caminho()).toBe('/company/jobs/1/candidates')
    expect(guia.estado().ativo?.passo).toBe(2)
    act(() => { screen.getByRole('button', { name: 'Voltar' }).click() })
    await esperar()
    expect(caminho()).toBe('/company/jobs')
    expect(guia.estado().ativo?.passo).toBe(1)
  })

  it('avança quando a pessoa abre a presença do turno', async () => {
    montar('/company/dashboard')
    await esperar()
    act(() => { guia.iniciarRoteiro('empresa-presenca') })
    await esperar()
    expect(caminho()).toBe('/company/jobs')
    act(() => { void navegar('/company/jobs/9/candidates') })
    await esperar()
    expect(guia.estado().ativo?.passo).toBe(2)
    act(() => { guia.sair() })
  })
})
