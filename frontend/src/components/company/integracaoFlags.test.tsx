/** Integração das funções novas: com as flags desligadas nada novo aparece nem é consultado. */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, renderHook, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import BatchEntry from './BatchEntry';
import BatchList from './BatchList';
import { batchLabels, clusterByBatch } from './batchGroups';
import { useBatchLabels } from './useBatchLabels';
import { usePresenceSetup } from './usePresenceSetup';
import { applyPresenceToJobs } from './applyPresenceToJobs';
import { toPolicy } from './presenceDefaults';
import { getGestaoGroups } from '../../lib/navigation';
import { isAvisosEnabled, isLoteEnabled, isPresencaEnabled } from '../../lib/features';
import { LEAVE_TIMEOUT_MS, leaveDevice } from '../../lib/leaveDevice';
import { OPEN_EVENT } from '../copilot/CopilotPanel';
import { COPILOT_OPEN_EVENT } from '../../layouts/copilotOpenEvent';

const { from, disable } = vi.hoisted(() => ({ from: vi.fn(), disable: vi.fn() }));
vi.mock('../../lib/supabase', () => ({ supabase: { from, rpc: vi.fn() } }));
vi.mock('../../services/pushService', () => ({ disablePushOnThisDevice: disable }));

beforeEach(() => {
    from.mockReset();
    disable.mockReset().mockResolvedValue(undefined);
    vi.stubEnv('VITE_FEATURE_LOTE', '');
    vi.stubEnv('VITE_FEATURE_PRESENCA', '');
    vi.stubEnv('VITE_FEATURE_AVISOS', '');
});
afterEach(() => {
    vi.unstubAllEnvs();
    vi.useRealTimers();
});

describe('flags desligadas (padrão)', () => {
    it('todas desligadas', () => {
        expect([isLoteEnabled(), isPresencaEnabled(), isAvisosEnabled()]).toEqual([false, false, false]);
    });

    it('sem atalhos de lote e sem cartão Locais', () => {
        const { container } = render(<MemoryRouter><BatchEntry /></MemoryRouter>);
        expect(container).toBeEmptyDOMElement();
        const cards = getGestaoGroups({ gestor: true, units: true, teamInvited: true, trail: true }).flatMap((g) => g.cards);
        expect(cards.map((c) => c.id)).not.toContain('locais');
    });

    it('nenhuma consulta a coluna nova', () => {
        const lote = renderHook(() => useBatchLabels(['a', 'b']));
        renderHook(() => usePresenceSetup(null, true));
        expect(lote.result.current.labels.size).toBe(0);
        expect(from).not.toHaveBeenCalled();
    });

    it('lista sem lote não ganha elemento nenhum', () => {
        const { container } = render(
            <ul><BatchList as="li" items={['a', 'b']} batchOf={() => 'x'} labels={new Map()} render={(i) => <li key={i}>{i}</li>} /></ul>,
        );
        expect(container.innerHTML).toBe('<ul><li>a</li><li>b</li></ul>');
    });

    it('logout não toca em push', async () => {
        await leaveDevice();
        expect(disable).not.toHaveBeenCalled();
    });
});

describe('ligadas', () => {
    it('logout desliga o push e nunca fica preso', async () => {
        vi.stubEnv('VITE_FEATURE_AVISOS', 'true');
        await leaveDevice();
        expect(disable).toHaveBeenCalledOnce();

        disable.mockRejectedValueOnce(new Error('x'));
        await expect(leaveDevice()).resolves.toBeUndefined();

        vi.useFakeTimers();
        disable.mockReturnValueOnce(new Promise(() => undefined));
        const done = vi.fn();
        void leaveDevice().then(done);
        await vi.advanceTimersByTimeAsync(LEAVE_TIMEOUT_MS);
        expect(done).toHaveBeenCalled();
    });

    it('atalhos de lote e cartão Locais só para o Gestor', () => {
        vi.stubEnv('VITE_FEATURE_LOTE', 'true');
        render(<MemoryRouter><BatchEntry /></MemoryRouter>);
        expect(screen.getByRole('link', { name: /Copiar fim de semana/ })).toHaveAttribute('href', '/company/create?copiar=fim-de-semana');
        const ids = (gestor: boolean) => getGestaoGroups({ gestor, units: false, teamInvited: false, trail: false, sites: true })
            .flatMap((g) => g.cards.map((c) => c.id));
        expect(ids(true)).toContain('locais');
        expect(ids(false)).not.toContain('locais');
    });

    it('agrupa por lote com totais e mantém os soltos na ordem', () => {
        const jobs = [
            { id: '1', creation_batch_id: 'L', created_at: '2026-11-25T15:00:00Z', slots: 5 },
            { id: '2', creation_batch_id: null },
            { id: '3', creation_batch_id: 'L', created_at: '2026-11-25T15:00:00Z', slots: 1 },
            { id: '4', creation_batch_id: 'S', slots: 1 },
        ];
        const labels = batchLabels(jobs);
        expect([...labels]).toEqual([['L', 'Lote de 25/11 · 2 turnos · 6 vagas']]);
        expect(clusterByBatch(jobs, (j) => j.creation_batch_id, labels).map((c) => c.items.map((j) => j.id)))
            .toEqual([['1', '3'], ['2', '4']]);
    });

    it('presença do lote: dupla confirmação não grava; recusa parcial vira falso', async () => {
        await expect(applyPresenceToJobs(['a'], toPolicy(null))).resolves.toBe(true);
        expect(from).not.toHaveBeenCalled();
        const select = vi.fn().mockResolvedValue({ data: [{ id: 'a' }], error: null });
        from.mockReturnValue({ update: () => ({ in: () => ({ select }) }) });
        const qr = toPolicy({ presence_mode: 'qr_gps', site_id: 's' });
        await expect(applyPresenceToJobs(['a', 'b'], qr)).resolves.toBe(false);
        await expect(applyPresenceToJobs(['a'], qr)).resolves.toBe(true);
    });

    it('o evento do botão é o que o painel do copiloto escuta', () => {
        expect(COPILOT_OPEN_EVENT).toBe(OPEN_EVENT);
    });
});
