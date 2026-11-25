import { act, fireEvent, render, screen } from '@testing-library/react'
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { GuideProvider } from './GuideProvider'
import { GuideRoleFreela } from './GuideRole'
import { BotaoComoFaco } from './BotaoComoFaco'
import { Dialog } from '../ui/Dialog'
import { guia } from '../../lib/guide/api'
import { ESPERA_DO_ALVO_MS } from '../../hooks/useGuideTarget'
import { ESPERA_BOAS_VINDAS_MS } from './GuideWelcome'

const track = vi.hoisted(() => vi.fn())
vi.mock('../../services/analytics', () => ({ AnalyticsService: { trackEvent: track } }))
vi.mock('../../contexts/AuthContext', () => ({ useAuth: () => ({ user: { id: 'u1' } }) }))

const cliqueNoAlvo = vi.fn()

function Caminho() {
  return <p data-testid="caminho">{useLocation().pathname}</p>
}

function montar(inicio = '/dashboard', extra: React.ReactNode = null) {
  return render(
    <MemoryRouter initialEntries={[inicio]}>
      <GuideProvider>
        <GuideRoleFreela />
        <BotaoComoFaco />
        <Caminho />
        <Routes>
          <Route path="/profile" element={<button data-copilot="freela.perfil.sos" data-copilot-risk="D" onClick={cliqueNoAlvo}>SOS</button>} />
          <Route path="*" element={null} />
        </Routes>
        {extra}
      </GuideProvider>
    </MemoryRouter>,
  )
}

const passar = (ms: number) => act(async () => { await vi.advanceTimersByTimeAsync(ms) })
const verBoasVindas = () => localStorage.setItem('worki:guia:v1:u1:freela', JSON.stringify({ boasVindasVistas: true }))

describe('guia na tela', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    localStorage.clear()
    track.mockClear()
    cliqueNoAlvo.mockClear()
    return () => { vi.useRealTimers() }
  })

  it('boas-vindas aparecem uma vez, com Pular', async () => {
    const tela = montar()
    await passar(ESPERA_BOAS_VINDAS_MS + 50)
    fireEvent.click(screen.getByRole('button', { name: 'Pular' }))
    await passar(ESPERA_BOAS_VINDAS_MS + 50)
    expect(screen.queryByRole('button', { name: 'Pular' })).toBeNull()
    tela.unmount()
    montar()
    await passar(ESPERA_BOAS_VINDAS_MS + 50)
    expect(screen.queryByRole('button', { name: 'Pular' })).toBeNull()
  })

  it('navega, destaca, nunca clica e registra início e conclusão', async () => {
    verBoasVindas()
    montar()
    await passar(10)
    act(() => { expect(guia.iniciarRoteiro('freela-sos')).toEqual({ ok: true }) })
    await passar(500)
    expect(screen.getByTestId('caminho').textContent).toBe('/profile')
    expect(document.querySelector('[data-guide="destaque"]')).not.toBeNull()
    expect(screen.getByText('O guia só mostra. Quem decide e toca é você.')).toBeTruthy()
    // Passo D: sem atalho que leve o foco ao botão de risco.
    expect(screen.queryByRole('button', { name: 'Ir até o botão' })).toBeNull()
    expect(guia.estado().ativo).toMatchObject({ roteiroId: 'freela-sos', alvoVisivel: true })
    fireEvent.click(screen.getByRole('button', { name: 'Concluir' }))
    await passar(10)
    expect(cliqueNoAlvo).not.toHaveBeenCalled()
    expect(guia.estado().ativo).toBeNull()
    expect(track.mock.calls.map((c) => c[0])).toEqual(['guia_roteiro_iniciado', 'guia_roteiro_concluido'])
  })

  it('o toque da pessoa no alvo do último passo conclui', async () => {
    verBoasVindas()
    montar('/profile')
    await passar(10)
    act(() => { guia.iniciarRoteiro('freela-sos') })
    await passar(500)
    fireEvent.click(screen.getByRole('button', { name: 'SOS' }))
    await passar(10)
    expect(cliqueNoAlvo).toHaveBeenCalledTimes(1)
    expect(guia.estado().ativo).toBeNull()
  })

  it('alvo ausente explica o motivo e nunca trava', async () => {
    verBoasVindas()
    montar()
    await passar(10)
    act(() => { guia.iniciarRoteiro('freela-privacidade') })
    await passar(ESPERA_DO_ALVO_MS + 400)
    expect(document.querySelector('[data-guide="sem-alvo"]')?.textContent).toContain('Preferências')
    fireEvent.click(screen.getByRole('button', { name: 'Próximo' }))
    await passar(10)
    expect(screen.getByText('Passo 2 de 2')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Sair do guia' }))
    expect(document.querySelector('[data-guide="camada"]')).toBeNull()
  })

  it('Esc no balão sai do guia; destaque avulso não navega', async () => {
    verBoasVindas()
    montar('/dashboard')
    await passar(10)
    act(() => { expect(guia.destacar('freela.perfil.sos', 'Fica no perfil')).toEqual({ ok: true }) })
    await passar(10)
    expect(screen.getByTestId('caminho').textContent).toBe('/dashboard')
    fireEvent.keyDown(screen.getByRole('dialog', { name: 'Guia: É aqui' }), { key: 'Escape' })
    expect(guia.estado().ativo).toBeNull()
  })

  it('com um modal aberto, a camada entra nele e encolhe se o alvo está fora', async () => {
    verBoasVindas()
    montar('/profile', <Dialog onClose={() => {}}><p>Janela</p></Dialog>)
    await passar(10)
    act(() => { guia.destacar('freela.perfil.sos', 'x') })
    await passar(500)
    const camada = document.querySelector('[data-guide="camada"]')!
    expect(camada.closest('dialog')).not.toBeNull()
    expect(document.querySelector('[data-guide="destaque"]')).toBeNull()
    expect(screen.getByRole('button', { name: 'Sair' })).toBeTruthy()
  })

  it('recusa rota, roteiro e alvo fora da lista', async () => {
    verBoasVindas()
    montar()
    await passar(10)
    act(() => {
      expect(guia.irPara('/convite/abc')).toMatchObject({ ok: false, motivo: 'rota-nao-permitida' })
      expect(guia.irPara('freela.recibo')).toMatchObject({ ok: false })
      expect(guia.iniciarRoteiro('empresa-pagamento')).toMatchObject({ motivo: 'roteiro-desconhecido' })
      expect(guia.destacar('empresa.elenco.copiar-link', 'x')).toMatchObject({ motivo: 'alvo-invalido' })
      expect(guia.irPara('freela.recebimentos')).toEqual({ ok: true })
    })
    expect(screen.getByTestId('caminho').textContent).toBe('/recebimentos')
  })

  it('a busca sem resultado é medida sem o texto digitado', async () => {
    verBoasVindas()
    montar()
    await passar(10)
    fireEvent.click(screen.getByRole('button', { name: 'Como faço…?' }))
    await passar(10)
    fireEvent.change(screen.getByLabelText('O que você quer fazer?'), { target: { value: 'xyzw maria 11999998888' } })
    await passar(2000)
    expect(track).toHaveBeenCalledWith('guia_busca_sem_resultado', { papel: 'freela', termos: '3', tela: 'freela.inicio' })
    expect(JSON.stringify(track.mock.calls)).not.toMatch(/maria|9999/)
  })

  it('continua disponível no recibo, fora dos layouts', async () => {
    verBoasVindas()
    montar('/recibo/abc')
    await passar(10)
    expect(guia.estado().disponivel).toBe(true)
  })

  it('não existe em tela de convite', async () => {
    montar('/convite/abc')
    await passar(ESPERA_BOAS_VINDAS_MS + 50)
    expect(guia.estado().disponivel).toBe(false)
    expect(screen.queryByRole('button', { name: 'Como faço…?' })).toBeNull()
  })
})
