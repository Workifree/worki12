import { describe, it, expect, vi, afterEach } from 'vitest';
import { pendingExceptionRequests, presenceMessage, presenceSummary } from './presence';
import type { PresenceCheck, PresenceResult, PresenceKind } from './presence';
import { getDevicePosition } from './presenceGeo';

const c = (kind: PresenceKind, result: PresenceResult, extra: Partial<PresenceCheck> = {}): PresenceCheck => ({
    id: `${kind}-${result}`, application_id: 'a1', job_id: 'j', worker_id: 'w', kind, result,
    distance_m: null, accuracy_m: null, reason: null, decided_by: null,
    created_at: '2026-11-27T10:00:00Z', ...extra,
});

describe('presenceSummary', () => {
    it('sem nada, ou só tentativas falhas, não é verificada', () => {
        expect(presenceSummary([]).label).toBe('Presença não verificada');
        expect(presenceSummary([c('arrival', 'gps_out_of_range')]).seal).toBe('unverified');
    });
    it('chegada verificada', () => {
        expect(presenceSummary([c('arrival', 'verified')]).label).toBe('Presença verificada no local');
    });
    it('saída gravada sem verificação fica marcada', () => {
        expect(presenceSummary([c('arrival', 'verified'), c('departure', 'unverified')]).seal).toBe('unverified');
        expect(presenceSummary([c('arrival', 'verified')], true).label).toBe('Chegada verificada · saída não verificada');
    });
    it('exceção mostra o motivo', () => {
        expect(presenceSummary([c('arrival', 'manual_exception', { reason: 'gps_negado' })]).label)
            .toBe('Confirmada manualmente: Localização não permitida no aparelho');
    });
    it('exceção vence a marca "sem verificação" do mesmo momento', () => {
        const checks = [
            c('arrival', 'verified'), c('departure', 'unverified'),
            c('departure', 'manual_exception', { reason: 'qr_ilegivel' }),
        ];
        expect(presenceSummary(checks, true).seal).toBe('manual');
    });
});

describe('pendingExceptionRequests', () => {
    it('um pedido por momento, some depois da decisão', () => {
        const requests = [
            c('arrival', 'exception_requested', { id: '1', created_at: '2026-11-27T10:00:00Z' }),
            c('arrival', 'exception_requested', { id: '2', created_at: '2026-11-27T10:20:00Z' }),
        ];
        expect(pendingExceptionRequests(requests).map((r) => r.id)).toEqual(['2']);
        expect(pendingExceptionRequests([...requests, c('arrival', 'manual_exception')])).toEqual([]);
        expect(pendingExceptionRequests([...requests, c('arrival', 'verified', { application_id: 'a2' })])).toHaveLength(1);
    });
});

it('desfecho desconhecido nunca mostra o código cru', () => {
    expect(presenceMessage('xyz_interno')).not.toContain('xyz');
});

describe('getDevicePosition', () => {
    afterEach(() => vi.unstubAllGlobals());

    it.each([[1, 'denied'], [2, 'unavailable'], [3, 'timeout']])('código %i vira %s', async (code, failure) => {
        vi.stubGlobal('navigator', {
            geolocation: { getCurrentPosition: (_ok: unknown, fail: (e: { code: number }) => void) => fail({ code }) },
        });
        expect(await getDevicePosition()).toEqual({ ok: false, failure });
    });
    it('sem suporte', async () => {
        vi.stubGlobal('navigator', {});
        expect(await getDevicePosition()).toEqual({ ok: false, failure: 'unsupported' });
    });
    it('pede alta precisão e nada de cache', async () => {
        const get = vi.fn((ok: (p: unknown) => void) => ok({ coords: { latitude: 1, longitude: 2, accuracy: 3 } }));
        vi.stubGlobal('navigator', { geolocation: { getCurrentPosition: get } });
        const result = await getDevicePosition();
        expect(result.ok && result.position).toMatchObject({ lat: 1, lng: 2, accuracy: 3 });
        expect(get.mock.calls[0]).toContainEqual({ enableHighAccuracy: true, timeout: 15000, maximumAge: 0 });
    });
});
