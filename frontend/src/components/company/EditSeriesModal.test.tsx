import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import EditSeriesModal, { type SeriesJobSnapshot } from './EditSeriesModal'

// JobSeriesService é mockado inteiro — estes testes cobrem a UI do preview (dry-run), não a RPC.
vi.mock('../../services/jobSeriesService', () => ({
    JobSeriesService: {
        previewUpdateFutureOccurrences: vi.fn(),
        updateFutureOccurrences: vi.fn(),
    },
}))

vi.mock('../../contexts/ToastContext', () => ({
    useToast: vi.fn(() => ({ addToast: vi.fn(), removeToast: vi.fn() })),
}))

import { JobSeriesService } from '../../services/jobSeriesService'

const JOB: SeriesJobSnapshot = {
    id: 'job-1',
    series_id: 'series-1',
    title: 'Garçom de domingo',
    category: 'garcom',
    description: 'Atendimento de salão',
    requirements: '',
    briefing: null,
    location: 'São Paulo',
    work_start_time: '18:00',
    work_end_time: '23:00',
    slots: 1,
}

function renderModal() {
    return render(<EditSeriesModal job={JOB} onClose={vi.fn()} onApplied={vi.fn()} />)
}

async function goToConfirm() {
    fireEvent.click(screen.getByRole('button', { name: 'Continuar' }))
}

// Escopo de unidade (F13): os servicos passaram a resolver a empresa OPERADA pelo seam, em vez
// de `.eq('owner_id', user.id)`. O duble evita bater na RPC get_my_companies nos testes.
vi.mock('../../services/companyScopeService', () => ({
  getAuthenticatedCompanyId: vi.fn().mockResolvedValue('company-1'),
  getMyCompanies: vi.fn().mockResolvedValue([{ company_id: 'company-1' }]),
}))

describe('EditSeriesModal — prévia (dry-run)', () => {
    beforeEach(() => {
        vi.clearAllMocks()
    })

    it('dispara a prévia ao entrar na confirmação e mostra os dois baldes', async () => {
        vi.mocked(JobSeriesService.previewUpdateFutureOccurrences).mockResolvedValue({
            wouldUpdate: 12,
            skippedFilled: 3,
            skippedCalled: 1,
        })

        renderModal()
        await goToConfirm()

        expect(JobSeriesService.previewUpdateFutureOccurrences).toHaveBeenCalledTimes(1)

        await waitFor(() => {
            expect(
                screen.getByText('12 turnos serão atualizados. 3 serão mantidos porque já têm freela confirmado e 1 porque tem chamado aberto.'),
            ).toBeInTheDocument()
        })
        expect(screen.getByRole('button', { name: /confirmar e aplicar/i })).not.toBeDisabled()
    })

    it('desabilita o botão de confirmar enquanto a prévia carrega', async () => {
        let resolvePreview: (value: { wouldUpdate: number; skippedFilled: number; skippedCalled: number }) => void = () => {}
        vi.mocked(JobSeriesService.previewUpdateFutureOccurrences).mockReturnValue(
            new Promise((resolve) => { resolvePreview = resolve }),
        )

        renderModal()
        await goToConfirm()

        expect(screen.getByText(/calculando quantos turnos serão afetados/i)).toBeInTheDocument()
        expect(screen.getByRole('button', { name: /aplicar/i })).toBeDisabled()

        resolvePreview({ wouldUpdate: 2, skippedFilled: 0, skippedCalled: 0 })
        await waitFor(() => {
            expect(screen.getByRole('button', { name: /confirmar e aplicar/i })).not.toBeDisabled()
        })
    })

    it('desabilita o botão e avisa quando a prévia calcula zero ocorrências afetadas', async () => {
        vi.mocked(JobSeriesService.previewUpdateFutureOccurrences).mockResolvedValue({
            wouldUpdate: 0,
            skippedFilled: 2,
            skippedCalled: 0,
        })

        renderModal()
        await goToConfirm()

        await waitFor(() => {
            expect(screen.getByText(/nenhuma ocorrência será afetada/i)).toBeInTheDocument()
        })
        expect(screen.getByRole('button', { name: /aplicar/i })).toBeDisabled()
        expect(JobSeriesService.updateFutureOccurrences).not.toHaveBeenCalled()
    })

    it('quando a prévia falha, NÃO bloqueia — cai no texto qualitativo e deixa confirmar', async () => {
        vi.mocked(JobSeriesService.previewUpdateFutureOccurrences).mockResolvedValue({
            wouldUpdate: 0,
            skippedFilled: 0,
            skippedCalled: 0,
            error: 'Não foi possível calcular a prévia dos turnos futuros.',
        })
        vi.mocked(JobSeriesService.updateFutureOccurrences).mockResolvedValue({
            updated: 5,
            skippedFilled: 1,
            skippedCalled: 0,
        })

        renderModal()
        await goToConfirm()

        await waitFor(() => {
            expect(screen.getByText(/não foi possível calcular a prévia exata/i)).toBeInTheDocument()
        })
        // Preview falhou — o preview é informação, não guarda: o botão continua liberado.
        const confirmButton = screen.getByRole('button', { name: /confirmar e aplicar/i })
        expect(confirmButton).not.toBeDisabled()

        fireEvent.click(confirmButton)

        await waitFor(() => {
            expect(JobSeriesService.updateFutureOccurrences).toHaveBeenCalledTimes(1)
        })
        await waitFor(() => {
            expect(screen.getByText(/5 turnos atualizados/)).toBeInTheDocument()
        })
    })
})
