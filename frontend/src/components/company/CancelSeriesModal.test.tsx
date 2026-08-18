import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import CancelSeriesModal from './CancelSeriesModal'

// JobSeriesService é mockado inteiro — estes testes cobrem a UI do preview (dry-run), não a RPC.
vi.mock('../../services/jobSeriesService', () => ({
    JobSeriesService: {
        previewStopSeries: vi.fn(),
        stopSeries: vi.fn(),
    },
}))

vi.mock('../../contexts/ToastContext', () => ({
    useToast: vi.fn(() => ({ addToast: vi.fn(), removeToast: vi.fn() })),
}))

import { JobSeriesService } from '../../services/jobSeriesService'

function renderModal() {
    return render(<CancelSeriesModal seriesId="series-1" onClose={vi.fn()} onCancelled={vi.fn()} />)
}

describe('CancelSeriesModal — prévia (dry-run)', () => {
    beforeEach(() => {
        vi.clearAllMocks()
    })

    it('dispara a prévia ao montar (a tela já abre em confirmação) e mostra os dois baldes', async () => {
        vi.mocked(JobSeriesService.previewStopSeries).mockResolvedValue({
            wouldCancel: 12,
            skippedFilled: 3,
            skippedCalled: 1,
        })

        renderModal()

        await waitFor(() => {
            expect(JobSeriesService.previewStopSeries).toHaveBeenCalledTimes(1)
        })
        await waitFor(() => {
            expect(
                screen.getByText('12 turnos serão cancelados. 3 serão mantidos porque já têm freela confirmado e 1 porque tem chamado aberto.'),
            ).toBeInTheDocument()
        })
        expect(screen.getByRole('button', { name: /cancelar a série/i })).not.toBeDisabled()
    })

    it('desabilita o botão de confirmar enquanto a prévia carrega', async () => {
        let resolvePreview: (value: { wouldCancel: number; skippedFilled: number; skippedCalled: number }) => void = () => {}
        vi.mocked(JobSeriesService.previewStopSeries).mockReturnValue(
            new Promise((resolve) => { resolvePreview = resolve }),
        )

        renderModal()

        expect(screen.getByText(/calculando quantos turnos serão afetados/i)).toBeInTheDocument()
        expect(screen.getByRole('button', { name: /cancelar a série/i })).toBeDisabled()

        resolvePreview({ wouldCancel: 4, skippedFilled: 0, skippedCalled: 0 })
        await waitFor(() => {
            expect(screen.getByRole('button', { name: /cancelar a série/i })).not.toBeDisabled()
        })
    })

    it('NÃO desabilita o botão quando wouldCancel=0 — encerrar a série continua válido mesmo sem nada a excluir', async () => {
        // Diferente do EditSeriesModal: mesmo com zero ocorrências tocáveis, confirmar ainda
        // marca `job_series.status='stopped'` (impede a série de gerar novos turnos). Bloquear
        // aqui deixaria a empresa sem como parar uma série cujas ocorrências futuras já estão
        // todas preenchidas/com chamado aberto.
        vi.mocked(JobSeriesService.previewStopSeries).mockResolvedValue({
            wouldCancel: 0,
            skippedFilled: 1,
            skippedCalled: 1,
        })
        vi.mocked(JobSeriesService.stopSeries).mockResolvedValue({
            cancelled: 0,
            skippedFilled: 1,
            skippedCalled: 1,
        })

        renderModal()

        await waitFor(() => {
            expect(screen.getByText(/nenhum turno será cancelado/i)).toBeInTheDocument()
        })
        expect(screen.getByText(/a série será encerrada e não gerará novas ocorrências/i)).toBeInTheDocument()

        const confirmButton = screen.getByRole('button', { name: /cancelar a série/i })
        expect(confirmButton).not.toBeDisabled()

        fireEvent.click(confirmButton)

        await waitFor(() => {
            expect(JobSeriesService.stopSeries).toHaveBeenCalledTimes(1)
        })
    })

    it('avisa de forma diferente quando não há sequer ocorrência futura pulada', async () => {
        vi.mocked(JobSeriesService.previewStopSeries).mockResolvedValue({
            wouldCancel: 0,
            skippedFilled: 0,
            skippedCalled: 0,
        })

        renderModal()

        await waitFor(() => {
            expect(screen.getByText(/não há ocorrências futuras para cancelar/i)).toBeInTheDocument()
        })
        expect(screen.getByRole('button', { name: /cancelar a série/i })).not.toBeDisabled()
    })

    it('quando a prévia falha, NÃO bloqueia — cai no texto qualitativo e deixa confirmar', async () => {
        vi.mocked(JobSeriesService.previewStopSeries).mockResolvedValue({
            wouldCancel: 0,
            skippedFilled: 0,
            skippedCalled: 0,
            error: 'Não foi possível calcular a prévia do cancelamento.',
        })
        vi.mocked(JobSeriesService.stopSeries).mockResolvedValue({
            cancelled: 7,
            skippedFilled: 2,
            skippedCalled: 0,
        })

        renderModal()

        await waitFor(() => {
            expect(screen.getByText(/não foi possível calcular a prévia exata/i)).toBeInTheDocument()
        })
        const confirmButton = screen.getByRole('button', { name: /cancelar a série/i })
        expect(confirmButton).not.toBeDisabled()

        fireEvent.click(confirmButton)

        await waitFor(() => {
            expect(JobSeriesService.stopSeries).toHaveBeenCalledTimes(1)
        })
        await waitFor(() => {
            expect(screen.getByText(/7 turnos cancelados/)).toBeInTheDocument()
        })
    })
})
