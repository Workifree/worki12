import { describe, it, expect, vi, beforeEach } from 'vitest';
import { recordPresenceException, saveSite, verifyPresence } from './presenceService';

const mockRpc = vi.fn();
const mockFrom = vi.fn();
const mockLog = vi.fn();

vi.mock('../lib/supabase', () => ({
    supabase: {
        rpc: (fn: string, params: unknown) => mockRpc(fn, params),
        from: (table: string) => mockFrom(table),
    },
}));
vi.mock('../lib/logger', () => ({ logError: (...args: unknown[]) => mockLog(...args) }));

beforeEach(() => vi.clearAllMocks());

const position = { lat: -5.123456, lng: -35.654321, accuracy: 12, takenAt: 0 };

describe('verifyPresence', () => {
    it('manda o QR cru e a posição para a RPC', async () => {
        mockRpc.mockResolvedValue({ data: { outcome: 'verified' }, error: null });
        await expect(verifyPresence('app', 'arrival', ' cru ', position)).resolves.toEqual({ outcome: 'verified' });
        expect(mockRpc).toHaveBeenCalledWith('verify_presence', {
            p_application_id: 'app', p_kind: 'arrival', p_qr: ' cru ',
            p_lat: position.lat, p_lng: position.lng, p_accuracy_m: 12,
        });
    });
    it('erro não leva coordenada nem QR para o log', async () => {
        mockRpc.mockResolvedValue({ data: null, error: { code: 'X', message: 'falhou' } });
        await expect(verifyPresence('app', 'arrival', 'segredo-qr', position)).resolves.toEqual({ outcome: 'error' });
        const logged = JSON.stringify(mockLog.mock.calls);
        expect(logged).not.toContain('segredo-qr');
        expect(logged).not.toContain('5.123456');
    });
});

it('exceção manda só o motivo da lista, sem texto livre', async () => {
    mockRpc.mockResolvedValue({ data: { outcome: 'recorded' }, error: null });
    await recordPresenceException('app', 'arrival', 'outro');
    expect(mockRpc.mock.calls[0][1]).toEqual({ p_application_id: 'app', p_kind: 'arrival', p_reason: 'outro' });
});

it('saveSite trata zero linhas (RLS) como falha', async () => {
    const select = vi.fn().mockResolvedValue({ data: [], error: null });
    mockFrom.mockReturnValue({ update: () => ({ eq: () => ({ select }) }) });
    await expect(saveSite('c', { name: 'n', address_text: null, lat: 1, lng: 2, radius_m: 150 }, 's')).resolves.toBeNull();
});
