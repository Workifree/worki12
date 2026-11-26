import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { PresenceCheckFlow } from './PresenceCheckFlow';
import { PresenceExceptionPanel } from './PresenceExceptionPanel';
import { PresenceBadge } from './PresenceBadge';
import { ShowShiftQr } from './ShowShiftQr';
import { SiteForm } from './SiteForm';

const service = vi.hoisted(() => ({
    verifyPresence: vi.fn(), requestPresenceException: vi.fn(), registerDepartureUnverified: vi.fn(),
    recordPresenceException: vi.fn(), getPresenceQr: vi.fn(), saveSite: vi.fn(),
}));
vi.mock('../../services/presenceService', () => service);

const geo = vi.hoisted(() => ({ getDevicePosition: vi.fn() }));
vi.mock('../../lib/presenceGeo', async (original) => ({ ...(await original<object>()), ...geo }));

vi.mock('../team/QrScannerPane', () => ({
    QrScannerPane: ({ onDecoded }: { onDecoded: (t: string) => void }) => (
        // Dispara duas vezes, como o leitor de verdade faz quadro a quadro.
        <button type="button" onClick={() => { onDecoded('token-cru'); onDecoded('token-cru'); }}>ler</button>
    ),
}));

const good = () => ({ ok: true, position: { lat: 1, lng: 2, accuracy: 10, takenAt: Date.now() } });

beforeEach(() => vi.clearAllMocks());
afterEach(() => vi.useRealTimers());

const flow = (kind: 'arrival' | 'departure' = 'arrival', onRegistered = vi.fn()) => {
    render(<MemoryRouter><PresenceCheckFlow applicationId="app" kind={kind} onRegistered={onRegistered} /></MemoryRouter>);
    return onRegistered;
};

describe('PresenceCheckFlow', () => {
    it('mostra o aviso antes de pedir a localização', () => {
        flow();
        expect(screen.getByText('Sobre sua localização')).toBeInTheDocument();
        expect(screen.getByRole('link', { name: 'Política de Privacidade' })).toHaveAttribute('href', '/privacidade');
        expect(geo.getDevicePosition).not.toHaveBeenCalled();
    });

    it('localização negada: pede ao responsável com o motivo certo', async () => {
        geo.getDevicePosition.mockResolvedValue({ ok: false, failure: 'denied' });
        service.requestPresenceException.mockResolvedValue({ outcome: 'requested' });
        flow();
        await userEvent.click(screen.getByRole('button', { name: 'Continuar' }));
        expect(await screen.findByText('Sem localização')).toBeInTheDocument();
        await userEvent.click(screen.getByRole('button', { name: 'Pedir confirmação ao responsável' }));
        expect(service.requestPresenceException).toHaveBeenCalledWith('app', 'arrival', 'gps_negado');
        expect(await screen.findByText(/Pedido enviado/)).toBeInTheDocument();
        expect(screen.queryByRole('button', { name: 'Registrar saída sem verificação' })).not.toBeInTheDocument();
    });

    it('verificado: envia uma vez só e avisa o chamador', async () => {
        geo.getDevicePosition.mockResolvedValue(good());
        service.verifyPresence.mockResolvedValue({ outcome: 'verified' });
        const done = flow();
        await userEvent.click(screen.getByRole('button', { name: 'Continuar' }));
        await userEvent.click(await screen.findByRole('button', { name: 'ler' }));
        expect(await screen.findByText(/Presença verificada no local/)).toBeInTheDocument();
        expect(service.verifyPresence).toHaveBeenCalledTimes(1);
        expect(done).toHaveBeenCalledTimes(1);
    });

    it.each([
        ['qr_expired', /código venceu/],
        ['qr_invalid', /não é o QR deste turno/],
        ['gps_low_accuracy', /impreciso/],
        ['gps_out_of_range', /fora da área/],
        ['too_many_attempts', /Muitas tentativas/],
        ['error', /Verifique a conexão/],
    ])('recusa %s: explica, deixa tentar de novo e pedir ajuda', async (outcome, text) => {
        geo.getDevicePosition.mockResolvedValue(good());
        service.verifyPresence.mockResolvedValue({ outcome });
        const done = flow();
        await userEvent.click(screen.getByRole('button', { name: 'Continuar' }));
        await userEvent.click(await screen.findByRole('button', { name: 'ler' }));
        expect(await screen.findByText(text)).toBeInTheDocument();
        expect(screen.getByRole('button', { name: 'Tentar de novo' })).toBeInTheDocument();
        expect(screen.getByRole('button', { name: 'Pedir confirmação ao responsável' })).toBeInTheDocument();
        expect(done).not.toHaveBeenCalled();
    });

    it('saída pode ser registrada sem verificação', async () => {
        service.registerDepartureUnverified.mockResolvedValue({ outcome: 'registered' });
        const done = flow('departure');
        await userEvent.click(screen.getByRole('button', { name: 'Registrar saída sem verificação' }));
        expect(await screen.findByText('Saída registrada sem verificação.')).toBeInTheDocument();
        expect(done).toHaveBeenCalled();
    });
});

describe('PresenceExceptionPanel', () => {
    it('exige motivo e confirma', async () => {
        service.recordPresenceException.mockResolvedValue({ outcome: 'recorded' });
        const done = vi.fn();
        render(<PresenceExceptionPanel applicationId="app" kind="arrival" workerName="Ana" onDecided={done} />);
        const submit = screen.getByRole('button', { name: 'Confirmar chegada manualmente' });
        await userEvent.click(submit);
        expect(screen.getByRole('alert')).toHaveTextContent('Escolha o motivo');
        expect(service.recordPresenceException).not.toHaveBeenCalled();
        await userEvent.selectOptions(screen.getByRole('combobox'), 'sem_sinal_gps');
        await userEvent.click(submit);
        await waitFor(() => expect(done).toHaveBeenCalled());
        expect(service.recordPresenceException).toHaveBeenCalledWith('app', 'arrival', 'sem_sinal_gps');
    });

    it('sem permissão mostra o motivo e não conclui', async () => {
        service.recordPresenceException.mockResolvedValue({ outcome: 'forbidden' });
        const done = vi.fn();
        render(<PresenceExceptionPanel applicationId="app" kind="arrival" workerName="Ana" requestedReason="gps_negado" onDecided={done} />);
        await userEvent.click(screen.getByRole('button', { name: 'Confirmar chegada manualmente' }));
        expect(await screen.findByText(/não tem permissão/)).toBeInTheDocument();
        expect(done).not.toHaveBeenCalled();
    });
});

describe('ShowShiftQr', () => {
    it('renova a cada 20s e tira o código vencido sem conexão', async () => {
        vi.useFakeTimers();
        service.getPresenceQr.mockResolvedValueOnce({ outcome: 'ok', token: 't1', site_name: 'Loja' })
            .mockResolvedValue({ outcome: 'error' });
        render(<ShowShiftQr jobId="j" />);
        await act(() => vi.advanceTimersByTimeAsync(0));
        expect(screen.getByRole('img', { name: 'QR do turno' })).toBeInTheDocument();
        await act(() => vi.advanceTimersByTimeAsync(20_000));
        expect(screen.getByRole('img', { name: 'QR do turno' })).toBeInTheDocument();
        await act(() => vi.advanceTimersByTimeAsync(40_000));
        expect(screen.queryByRole('img', { name: 'QR do turno' })).not.toBeInTheDocument();
        expect(screen.getByRole('alert')).toHaveTextContent('Sem conexão');
    });

    it('sem permissão para de pedir', async () => {
        vi.useFakeTimers();
        service.getPresenceQr.mockResolvedValue({ outcome: 'forbidden' });
        render(<ShowShiftQr jobId="j" />);
        await act(() => vi.advanceTimersByTimeAsync(60_000));
        expect(service.getPresenceQr).toHaveBeenCalledTimes(1);
    });
});

describe('SiteForm', () => {
    it('recusa ponto impreciso e salva com ponto bom e raio padrão 150', async () => {
        geo.getDevicePosition
            .mockResolvedValueOnce({ ok: true, position: { lat: 1, lng: 2, accuracy: 80, takenAt: 0 } })
            .mockResolvedValueOnce(good());
        service.saveSite.mockResolvedValue({ id: 's' });
        const saved = vi.fn();
        render(<SiteForm companyId="c" onSaved={saved} />);
        await userEvent.type(screen.getByRole('textbox', { name: /Nome do local/ }), 'Loja');
        await userEvent.click(screen.getByRole('button', { name: 'Estou aqui agora' }));
        expect(await screen.findByRole('alert')).toHaveTextContent('80 m');
        await userEvent.click(screen.getByRole('button', { name: 'Cadastrar local' }));
        expect(service.saveSite).not.toHaveBeenCalled();
        await userEvent.click(screen.getByRole('button', { name: 'Estou aqui agora' }));
        await screen.findByText(/Ponto capturado/);
        await userEvent.click(screen.getByRole('button', { name: 'Cadastrar local' }));
        await waitFor(() => expect(saved).toHaveBeenCalled());
        expect(service.saveSite).toHaveBeenCalledWith('c', { name: 'Loja', address_text: null, lat: 1, lng: 2, radius_m: 150 }, undefined);
    });
});

it('PresenceBadge mostra o selo', () => {
    render(<PresenceBadge checks={[{ kind: 'arrival', result: 'verified', reason: null }]} />);
    expect(screen.getByText('Presença verificada no local')).toBeInTheDocument();
});
