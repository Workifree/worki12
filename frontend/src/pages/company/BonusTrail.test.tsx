import { describe, it, expect, vi } from 'vitest'
import { render, screen, waitFor, fireEvent } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import BonusTrail from './BonusTrail'
import { ToastProvider } from '../../contexts/ToastContext'
import type { BonusMilestone, BonusTrailApi, BonusTrailSnapshot } from '../../components/bonus/types'

function milestone(n: number, over: Partial<BonusMilestone> = {}): BonusMilestone {
  return {
    id: `m${n}`,
    key: `k${n}`,
    group: 'B',
    sortOrder: n,
    title: `Marco ${n}`,
    amountCents: 1000 + n,
    countsInTotal: true,
    earned: false,
    earnedAt: null,
    awardState: null,
    availableAt: null,
    releaseText: null,
    awardId: null,
    celebrated: true,
    progress: { current: 1, target: 3, unit: 'turnos' },
    ...over,
  }
}

function snapshot(over: Partial<BonusTrailSnapshot> = {}): BonusTrailSnapshot {
  return {
    status: 'active',
    endsAt: '2027-02-16T03:00:00+00:00',
    milestones: Array.from({ length: 19 }, (_, i) =>
      milestone(i + 1, i < 2 ? { earned: true, earnedAt: '2026-11-24', awardState: 'validating', awardId: `a${i}`, progress: null } : {}),
    ),
    earnedCents: 1000,
    releasingCents: 1000,
    releasingUntil: '2026-11-26',
    releaseText: null,
    pendingShifts: [],
    availableCents: 1000,
    minPayoutCents: 2500,
    requestedPayoutCents: null,
    nextPayoutDate: '2026-11-30',
    pixKeyMasked: '***.456.789-**',
    payouts: [],
    ...over,
  }
}

function fakeApi(s: BonusTrailSnapshot, over: Partial<BonusTrailApi> = {}): BonusTrailApi {
  return {
    getMyTrail: vi.fn().mockResolvedValue(s),
    acceptEnrollment: vi.fn().mockResolvedValue('ok'),
    setPixKey: vi.fn().mockResolvedValue('ok'),
    requestPayout: vi.fn().mockResolvedValue('ok'),
    cancelPayout: vi.fn().mockResolvedValue('ok'),
    markCelebrated: vi.fn().mockResolvedValue(undefined),
    ...over,
  }
}

function renderPage(api: BonusTrailApi) {
  return render(
    <MemoryRouter>
      <ToastProvider>
        <BonusTrail api={api} />
      </ToastProvider>
    </MemoryRouter>,
  )
}

describe('BonusTrail', () => {
  it('mostra os três números, 2 de 19, 3 ativos e trancados com valor, sem palavras proibidas (A25)', async () => {
    renderPage(fakeApi(snapshot()))
    await screen.findByText('Bônus conquistado')
    expect(screen.getByText('Disponível para saque')).toBeInTheDocument()
    expect(screen.getByText('Próximo PIX (segunda)')).toBeInTheDocument()
    expect(screen.getByTestId('bonus-counter')).toHaveTextContent('2 de 19 marcos concluídos')
    const items = screen.getAllByRole('listitem').filter((li) => li.hasAttribute('data-state'))
    expect(items.filter((li) => li.getAttribute('data-state') === 'active')).toHaveLength(3)
    expect(screen.getAllByRole('progressbar')).toHaveLength(3)
    expect(items.filter((li) => li.getAttribute('data-state') === 'locked')).toHaveLength(14)
    const text = document.body.textContent ?? ''
    expect(text).not.toMatch(/saldo|carteira|crédito|wallet|suspeit|antifraude|irregularidade/i)
  })

  it('abaixo do mínimo, o clique explica quanto falta e não pede o PIX', async () => {
    const api = fakeApi(snapshot())
    renderPage(api)
    fireEvent.click(await screen.findByRole('button', { name: /pedir pix de segunda/i }))
    expect(await screen.findByTestId('bonus-payout-notice')).toHaveTextContent(/faltam R\$\s?15,00/i)
    expect(api.requestPayout).not.toHaveBeenCalled()
  })

  it('pede o PIX quando atinge o mínimo', async () => {
    const api = fakeApi(snapshot({ availableCents: 3000 }))
    renderPage(api)
    fireEvent.click(await screen.findByRole('button', { name: /pedir pix de segunda/i }))
    await waitFor(() => expect(api.requestPayout).toHaveBeenCalledTimes(1))
  })

  it('mostra o release_text neutro no topo e no marco, sem falar em conferência', async () => {
    const s = snapshot({ releaseText: 'libera em até 48h', releasingUntil: null })
    s.milestones[0] = { ...s.milestones[0], releaseText: 'estamos finalizando' }
    renderPage(fakeApi(s))
    expect(await screen.findByText(/liberando — libera em até 48h/i)).toBeInTheDocument()
    expect(screen.getByText(/Estamos finalizando/)).toBeInTheDocument()
    expect(document.body.textContent).not.toMatch(/conferência|revisão|análise/i)
  })

  it('"Quase lá" diz o que falta, quem faz, e leva à tela do turno ou ao WhatsApp', async () => {
    renderPage(
      fakeApi(
        snapshot({
          pendingShifts: [
            { jobId: 'j1', jobTitle: 'Evento', shiftDate: '2026-11-24', workerName: 'Ana Souza', missingStamps: ['worker_checkout', 'company_checkout', 'payment_record', 'receipt_confirmation'], warnings: [] },
            { jobId: 'j2', jobTitle: 'Loja', shiftDate: '2026-11-23', workerName: 'Beto', missingStamps: ['receipt_confirmation'], warnings: [] },
            { jobId: 'j3', jobTitle: 'Feira', shiftDate: '2026-11-22', workerName: null, missingStamps: ['company_checkin'], warnings: [] },
          ],
        }),
      ),
    )
    expect(await screen.findByRole('heading', { name: 'Quase lá' })).toBeInTheDocument()
    expect(screen.getByText('Falta Ana fazer o check-out')).toBeInTheDocument()
    expect(screen.getByText('Falta você confirmar a saída')).toBeInTheDocument()
    expect(screen.getByText('Falta registrar o pagamento')).toBeInTheDocument()
    expect(screen.queryByText('Falta Ana confirmar o recebimento')).not.toBeInTheDocument()
    expect(screen.getByText('Falta Beto confirmar o recebimento')).toBeInTheDocument()
    expect(screen.getAllByRole('link', { name: /abrir o turno/i }).map((a) => a.getAttribute('href'))).toEqual([
      '/company/jobs/j1/candidates',
      '/company/jobs/j3/candidates',
    ])
    const reminders = screen.getAllByRole('link', { name: /pelo whatsapp/i })
    expect(reminders).toHaveLength(2)
    expect(reminders[0].getAttribute('href')).toMatch(/^https:\/\/wa\.me\/\?text=/)
    expect(decodeURIComponent(reminders[1].getAttribute('href') ?? '')).toContain('confirmar o recebimento')
  })

  it('mostra os avisos do banco em "Quase lá", mesmo sem passo em aberto, sem tom de alerta', async () => {
    const warning = 'O horário informado para a saída do freela é diferente da hora em que foi registrado. Este turno pode não entrar na contagem.'
    renderPage(
      fakeApi(
        snapshot({
          pendingShifts: [
            { jobId: 'j9', jobTitle: 'Evento', shiftDate: '2026-11-24', workerName: 'Ana', missingStamps: [], warnings: [warning] },
          ],
        }),
      ),
    )
    const text = await screen.findByText(warning)
    expect(text.closest('[role="alert"]')).toBeNull()
    expect(screen.getByRole('link', { name: /abrir o turno/i })).toHaveAttribute('href', '/company/jobs/j9/candidates')
    expect(screen.queryByRole('link', { name: /pelo whatsapp/i })).not.toBeInTheDocument()
  })

  it('marco em validação sem data aparece igual ao normal, sem revelar conferência', async () => {
    const s = snapshot({ releasingUntil: null, releaseText: 'estamos finalizando' })
    s.milestones[0] = { ...s.milestones[0], availableAt: '2026-11-26T15:00:00+00:00' }
    s.milestones[1] = { ...s.milestones[1], availableAt: null, releaseText: 'estamos finalizando' }
    renderPage(fakeApi(s))
    await screen.findByText(/liberando — estamos finalizando/i)
    const [normal, noDate] = screen.getAllByRole('listitem').filter((li) => li.getAttribute('data-state') === 'done')
    expect(noDate.className).toBe(normal.className)
    expect(noDate.querySelector('span')?.innerHTML).toBe(normal.querySelector('span')?.innerHTML)
    expect(normal).toHaveTextContent('Libera em 26/11')
    expect(noDate).toHaveTextContent('Estamos finalizando')
    expect(document.body.textContent).not.toMatch(/conferência|revisão|análise|suspeit/i)
  })

  it('sem turno pendente, não há "Quase lá"', async () => {
    renderPage(fakeApi(snapshot()))
    await screen.findByText('Bônus conquistado')
    expect(screen.queryByText('Quase lá')).not.toBeInTheDocument()
  })

  it('identity_required mostra a mensagem da trilha para quem opera com login próprio', async () => {
    renderPage(fakeApi(snapshot({ status: 'identity_required', milestones: [] })))
    expect(await screen.findByText(/a trilha é para quem opera com login próprio/i)).toBeInTheDocument()
    expect(screen.queryByText('Bônus conquistado')).not.toBeInTheDocument()
  })

  it('convite exige marcar o regulamento antes de entrar', async () => {
    const api = fakeApi(snapshot({ status: 'invited', milestones: [] }))
    renderPage(api)
    const enter = await screen.findByRole('button', { name: /entrar na trilha/i })
    const link = screen.getByRole('link', { name: /ler o regulamento de 1 página/i })
    expect(link).toHaveAttribute('href', '/regulamento-trilha')
    expect(link).toHaveAttribute('target', '_blank')
    expect(link.getAttribute('rel')).toContain('noopener')
    expect(enter).toBeDisabled()
    fireEvent.click(screen.getByRole('checkbox'))
    fireEvent.click(enter)
    await waitFor(() => expect(api.acceptEnrollment).toHaveBeenCalledWith(null))
  })

  it('banner não modal, anunciado em região viva, marca como comemorado ao exibir (A27)', async () => {
    const s = snapshot()
    s.milestones[0] = { ...s.milestones[0], celebrated: false }
    const api = fakeApi(s)
    window.matchMedia = vi.fn().mockReturnValue({ matches: false }) as unknown as typeof window.matchMedia
    renderPage(api)
    await waitFor(() => expect(api.markCelebrated).toHaveBeenCalledWith(['a0']))
    expect(screen.getByTestId('bonus-live')).toHaveTextContent('Marco concluído!')
    expect(screen.getByTestId('bonus-live')).toHaveAttribute('role', 'status')
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(screen.getByTestId('bonus-confetti')).toHaveAttribute('aria-hidden', 'true')
    expect(api.markCelebrated).toHaveBeenCalledTimes(1)
    fireEvent.click(screen.getByRole('button', { name: /fechar aviso/i }))
    expect(screen.queryByText('Marco concluído!')).not.toBeInTheDocument()
  })

  it('com movimento reduzido não há confete', async () => {
    const s = snapshot()
    s.milestones[0] = { ...s.milestones[0], celebrated: false }
    window.matchMedia = vi.fn().mockReturnValue({ matches: true }) as unknown as typeof window.matchMedia
    renderPage(fakeApi(s))
    expect(await screen.findByText('Marco concluído!')).toBeInTheDocument()
    expect(screen.queryByTestId('bonus-confetti')).not.toBeInTheDocument()
  })

  it('not_counted não aparece concluído nem comemorado, só o texto neutro', async () => {
    const s = snapshot()
    s.milestones[0] = { ...s.milestones[0], awardState: 'not_counted', celebrated: false }
    const api = fakeApi(s)
    renderPage(api)
    expect(await screen.findByText('Esse turno não entrou na contagem')).toBeInTheDocument()
    expect(screen.getByTestId('bonus-counter')).toHaveTextContent('1 de 19')
    expect(screen.queryByText('Marco concluído!')).not.toBeInTheDocument()
    expect(api.markCelebrated).not.toHaveBeenCalled()
  })

  it('mostra a nota da constância e o último dia da trilha; encerrada não diz "vai até"', async () => {
    const s = snapshot()
    s.milestones[18] = { ...s.milestones[18], key: 'constancy' }
    const first = renderPage(fakeApi(s))
    expect(await screen.findByText('Só fecha no fim da trilha.')).toBeInTheDocument()
    expect(screen.getByText('Sua trilha vai até 15/02.')).toBeInTheDocument()
    first.unmount()
    renderPage(fakeApi({ ...s, status: 'ended' }))
    expect(await screen.findByText('Sua trilha terminou em 15/02.')).toBeInTheDocument()
    expect(screen.queryByText(/vai até/)).not.toBeInTheDocument()
    expect(screen.queryByText('Só fecha no fim da trilha.')).not.toBeInTheDocument()
  })

  it('se a atualização falhar depois de uma ação, mantém os dados com aviso em linha', async () => {
    const s = snapshot({ availableCents: 3000 })
    const getMyTrail = vi.fn().mockResolvedValueOnce(s).mockRejectedValue(new Error('rede'))
    renderPage(fakeApi(s, { getMyTrail }))
    fireEvent.click(await screen.findByRole('button', { name: /pedir pix de segunda/i }))
    expect(await screen.findByText(/não conseguimos atualizar agora/i)).toBeInTheDocument()
    expect(screen.getByText('Bônus conquistado')).toBeInTheDocument()
  })

  it('no convite dá para trocar e remover a chave escolhida', async () => {
    const api = fakeApi(snapshot({ status: 'invited', milestones: [] }))
    renderPage(api)
    fireEvent.click(await screen.findByRole('button', { name: /cadastrar chave pix/i }))
    fireEvent.change(screen.getByLabelText(/^chave pix/i), { target: { value: '52998224725' } })
    fireEvent.click(screen.getByRole('button', { name: /usar esta chave/i }))
    expect(await screen.findByRole('button', { name: /trocar chave/i })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: /remover chave/i }))
    expect(screen.getByRole('button', { name: /cadastrar chave pix/i })).toBeInTheDocument()
  })
})
