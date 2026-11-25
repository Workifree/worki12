import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import ReviewQueue from './ReviewQueue';
import PayoutList from './PayoutList';
import EnrollmentsPanel from './EnrollmentsPanel';
import { payoutsToCsv } from './csv';
import { formatNumber, paramError, paramLabel, PARAM_BOUNDS } from './format';
import type { EnrollmentItem } from './types';
import type { BonusAdminAdapter, PayoutItem, ReviewItem } from './types';

const review: ReviewItem = {
    ledgerId: 'l1', operatorName: 'Sabrina', companyName: 'Momma', jobTitle: 'Evento sábado',
    workerName: 'Carlos', flags: ['burst'], valueAtStakeCents: 5000, flaggedAt: '2026-11-20T12:00:00Z', reviewDueAt: null,
};
const payout: PayoutItem = {
    payoutId: 'p1', operatorName: 'Sabrina', companyName: 'Momma', amountCents: 3500, pixKey: 'a@b.com',
    scheduledFor: '2026-11-30', blocked: false, blockReason: null, payable: true, milestones: [{ title: 'Primeiro turno', amountCents: 3500 }],
};

function adapterWith(over: Partial<BonusAdminAdapter>): BonusAdminAdapter {
    return {
        getReviewQueue: vi.fn().mockResolvedValue([review]),
        decideReview: vi.fn().mockResolvedValue(undefined),
        getPayouts: vi.fn().mockResolvedValue([payout]),
        markPayoutPaid: vi.fn().mockResolvedValue(undefined),
        getVetos: vi.fn().mockResolvedValue([]),
        addVeto: vi.fn(), removeVeto: vi.fn(),
        getTracks: vi.fn().mockResolvedValue([]),
        updateTrackParams: vi.fn(),
        getTracking: vi.fn(),
        getParamsHistory: vi.fn().mockResolvedValue([]),
        getEnrollments: vi.fn().mockResolvedValue([]),
        getAlerts: vi.fn().mockResolvedValue({ items: [], evaluationFailed: [] }),
        createEnrollment: vi.fn().mockResolvedValue(undefined),
        registerCompanyAck: vi.fn().mockResolvedValue(undefined),
        updateTrackStatus: vi.fn().mockResolvedValue(undefined),
        cancelEnrollment: vi.fn().mockResolvedValue(undefined),
        getProgramEnabled: vi.fn().mockResolvedValue(false),
        setProgramEnabled: vi.fn().mockResolvedValue(undefined),
        ...over,
    };
}

describe('ReviewQueue', () => {
    it('Desfazer cancela a decisão sem gravar', async () => {
        vi.useFakeTimers({ shouldAdvanceTime: true });
        const adapter = adapterWith({});
        render(<ReviewQueue adapter={adapter} undoMs={50} />);
        fireEvent.click(await screen.findByRole('button', { name: 'Aprovar' }));
        fireEvent.click(screen.getByRole('button', { name: 'Desfazer' }));
        await act(async () => { vi.advanceTimersByTime(200); });
        expect(adapter.decideReview).not.toHaveBeenCalled();
        vi.useRealTimers();
    });

    it('grava a decisão depois da janela de desfazer', async () => {
        const adapter = adapterWith({});
        render(<ReviewQueue adapter={adapter} undoMs={20} />);
        fireEvent.click(await screen.findByRole('button', { name: 'Não contar' }));
        await waitFor(() => expect(adapter.decideReview).toHaveBeenCalledWith('l1', 'not_count'));
    });
});

describe('ReviewQueue: segurança de gravação', () => {
    it('avisa com beforeunload enquanto há decisão pendente', async () => {
        render(<ReviewQueue adapter={adapterWith({})} undoMs={60000} />);
        fireEvent.click(await screen.findByRole('button', { name: 'Aprovar' }));
        const ev = new Event('beforeunload', { cancelable: true });
        window.dispatchEvent(ev);
        expect(ev.defaultPrevented).toBe(true);
    });

    it('mostra erro (callback) se a gravação ao desmontar falhar', async () => {
        const onFlushError = vi.fn();
        const adapter = adapterWith({ decideReview: vi.fn().mockRejectedValue(new Error('x')) });
        const { unmount } = render(<ReviewQueue adapter={adapter} undoMs={60000} onFlushError={onFlushError} />);
        fireEvent.click(await screen.findByRole('button', { name: 'Aprovar' }));
        unmount();
        await waitFor(() => expect(onFlushError).toHaveBeenCalled());
        expect(adapter.decideReview).toHaveBeenCalledWith('l1', 'approve');
    });
});

describe('foco, parâmetros e CSV', () => {
    it('move o foco para Desfazer após decidir', async () => {
        render(<ReviewQueue adapter={adapterWith({})} undoMs={60000} />);
        fireEvent.click(await screen.findByRole('button', { name: 'Aprovar' }));
        expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Desfazer' }));
    });

    it('não grava duas vezes se o timer já disparou', async () => {
        const adapter = adapterWith({ decideReview: vi.fn(() => new Promise<void>(() => {})) });
        const { unmount } = render(<ReviewQueue adapter={adapter} undoMs={10} />);
        fireEvent.click(await screen.findByRole('button', { name: 'Aprovar' }));
        await waitFor(() => expect(adapter.decideReview).toHaveBeenCalledTimes(1));
        window.dispatchEvent(new Event('pagehide'));
        unmount();
        expect(adapter.decideReview).toHaveBeenCalledTimes(1);
    });

    it('todas as chaves têm rótulo em português e respeitam limites', () => {
        for (const key of Object.keys(PARAM_BOUNDS)) expect(paramLabel(key)).not.toBe(key);
        expect(paramError('max_per_worker_week', 3)).toMatch(/de 1 a 2/);
        expect(paramError('max_per_worker_week', 2)).toBeNull();
        expect(formatNumber(null, 'sem baseline')).toBe('sem baseline');
        expect(formatNumber(null)).toBe('sem dado');
    });

    it('CSV neutraliza fórmula de planilha', () => {
        expect(payoutsToCsv([{ ...payout, operatorName: '=HYPERLINK("x")' }])).toContain(`"'=HYPERLINK(""x"")"`);
    });
});

describe('EnrollmentsPanel', () => {
    const invited: EnrollmentItem = {
        enrollmentId: 'e1', trackKey: 'eventos', displayName: 'Sabrina', companyName: 'Momma', status: 'invited',
        companyAckAt: null, companyAckByLabel: null, acceptedAt: null, endsAt: null,
        payoutBlockReason: null, evaluationFailed: false,
    };

    it('mostra motivo do bloqueio, procedimento, alertas e falha de avaliação', async () => {
        const adapter = adapterWith({
            getEnrollments: vi.fn().mockResolvedValue([{ ...invited, payoutBlockReason: 'pix_match', evaluationFailed: true }]),
            getAlerts: vi.fn().mockResolvedValue({
                items: [{ id: '1', at: '2026-11-25T12:00:00Z', kind: 'voided_late', operatorName: 'Luiz', blockReason: null }],
                evaluationFailed: ['Rita'],
            }),
        });
        render(<EnrollmentsPanel adapter={adapter} />);
        expect(await screen.findByText(/Pagamento bloqueado: há coincidência/)).toBeTruthy();
        expect(screen.getByText(/Não existe liberação manual/)).toBeTruthy();
        expect(screen.getByText(/Não pagável: a última avaliação falhou/)).toBeTruthy();
        expect(await screen.findByText(/recibo estornado depois da janela/)).toBeTruthy();
        expect(screen.getByText(/a avaliação falhou para Rita/)).toBeTruthy();
    });

    it('registra a ciência do patrão só com nome e nota; não há botão Ativar', async () => {
        const adapter = adapterWith({ getEnrollments: vi.fn().mockResolvedValue([invited]) });
        render(<EnrollmentsPanel adapter={adapter} />);
        fireEvent.change(await screen.findByLabelText(/Quem deu a ciência/), { target: { value: 'Dona Ana' } });
        expect(screen.queryByRole('button', { name: 'Ativar' })).toBeNull();
        expect(screen.getByRole('button', { name: 'Registrar ciência' })).toBeDisabled();
        fireEvent.change(screen.getByLabelText('Como foi registrada'), { target: { value: 'ligação' } });
        fireEvent.click(screen.getByRole('button', { name: 'Registrar ciência' }));
        await waitFor(() => expect(adapter.registerCompanyAck).toHaveBeenCalledWith('e1', 'Dona Ana', 'ligação'));
    });
});

describe('PayoutList: pedidos que não podem ser pagos', () => {
    const early: PayoutItem = { ...payout, payoutId: 'p2', operatorName: 'Luiz', pixKey: 'cedo@x.com', amountCents: 4000, payable: false };
    const held: PayoutItem = { ...payout, payoutId: 'p3', operatorName: 'Rita', pixKey: 'bloq@x.com', amountCents: 9000, payable: false, blocked: true, blockReason: 'pix_match' };

    it.each([
        ['antes do corte', early, /só depois de sexta 23:59/],
        ['bloqueado', held, /NÃO PAGUE/],
        ['bloqueado mesmo com payable=true', { ...held, payable: true }, /NÃO PAGUE/],
    ])('%s: esconde PIX, Copiar, Marcar como pago e mostra o motivo', async (_n, item, reason) => {
        render(<PayoutList adapter={adapterWith({ getPayouts: vi.fn().mockResolvedValue([item]) })} />);
        expect(await screen.findByText(reason)).toBeTruthy();
        expect(document.body.textContent).not.toContain(item.pixKey);
        expect(screen.queryByRole('button', { name: /Copiar/ })).toBeNull();
        expect(screen.queryByRole('button', { name: 'Marcar como pago' })).toBeNull();
        expect(screen.queryByRole('button', { name: 'Exportar CSV' })).toBeNull();
        expect(document.body.textContent).not.toContain('Faça o PIX');
    });

    it('total e CSV contam só os pagáveis', async () => {
        render(<PayoutList adapter={adapterWith({ getPayouts: vi.fn().mockResolvedValue([payout, early, held]) })} />);
        expect((await screen.findByText(/Total a pagar/)).textContent?.replace(/\s/g, ' ')).toContain('R$ 35,00');
        const csv = payoutsToCsv([payout, early, held]);
        expect(csv).toContain('a@b.com');
        expect(csv).not.toMatch(/cedo@x\.com|bloq@x\.com|Luiz|Rita/);
    });

    it('mostra a mensagem do servidor e recarrega a lista após erro', async () => {
        const getPayouts = vi.fn().mockResolvedValueOnce([payout]).mockResolvedValue([held]);
        const markPayoutPaid = vi.fn().mockRejectedValue(new Error('NÃO PAGUE: frase do servidor'));
        render(<PayoutList adapter={adapterWith({ getPayouts, markPayoutPaid })} />);
        fireEvent.click(await screen.findByRole('button', { name: 'Marcar como pago' }));
        fireEvent.click(screen.getByRole('button', { name: /Confirmar: já paguei/ }));
        expect(await screen.findByText('NÃO PAGUE: frase do servidor')).toBeTruthy();
        await waitFor(() => expect(getPayouts).toHaveBeenCalledTimes(2));
        await waitFor(() => expect(screen.queryByRole('button', { name: 'Marcar como pago' })).toBeNull());
    });
});

describe('PayoutList', () => {
    it('exige segundo clique para marcar como pago', async () => {
        const adapter = adapterWith({});
        render(<PayoutList adapter={adapter} />);
        fireEvent.click(await screen.findByRole('button', { name: 'Marcar como pago' }));
        expect(adapter.markPayoutPaid).not.toHaveBeenCalled();
        fireEvent.click(screen.getByRole('button', { name: /Confirmar: já paguei/ }));
        await waitFor(() => expect(adapter.markPayoutPaid).toHaveBeenCalledWith('p1', undefined));
    });

    it('não usa a palavra saldo ou carteira', async () => {
        render(<PayoutList adapter={adapterWith({})} />);
        await screen.findByText('Sabrina');
        expect(document.body.textContent?.toLowerCase()).not.toMatch(/saldo|carteira/);
    });
});
