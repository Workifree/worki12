import { describe, it, expect } from 'vitest';
import { checkinWindow, checkinWindowMessage, isTodayShift } from './checkinWindow';

// 25/11/2026 em São Paulo (UTC-3); start_date ancorado ao meio-dia como o app grava.
const DAY = '2026-11-25T15:00:00+00:00';
const sp = (day: string, time: string) => new Date(`2026-11-${day}T${time}-03:00`);
const evening = { startDate: DAY, startTime: '18:00', endTime: '23:00' };
const overnight = { startDate: DAY, startTime: '22:00', endTime: '04:00' };
const NONE = {
    worker_checkin_at: null,
    worker_checkout_at: null,
    company_checkin_confirmed_at: null,
    company_checkout_confirmed_at: null,
};

describe('checkinWindow', () => {
    it.each([
        ['15:59:59', 'before'],
        ['16:00:00', 'open'],
        ['18:00:00', 'open'],
    ])('abre 2h antes do início (%s = %s)', (time, state) => {
        expect(checkinWindow(evening, sp('25', time)).state).toBe(state);
    });

    it('fecha 2h depois do fim, com o limite incluído', () => {
        expect(checkinWindow(evening, sp('26', '01:00:00')).state).toBe('open');
        expect(checkinWindow(evening, sp('26', '01:00:01')).state).toBe('closed');
    });

    it('turno que vira a noite continua aberto depois da meia-noite', () => {
        expect(checkinWindow(overnight, sp('26', '06:00:00')).state).toBe('open');
        expect(checkinWindow(overnight, sp('26', '06:00:01')).state).toBe('closed');
    });

    it('sem término: até 12h após o início', () => {
        const noEnd = { ...evening, endTime: null };
        expect(checkinWindow(noEnd, sp('26', '06:00:00')).state).toBe('open');
        expect(checkinWindow(noEnd, sp('26', '06:00:01')).state).toBe('closed');
    });

    it('usa o dia de São Paulo, não o dia UTC', () => {
        // 26/11 01:00Z ainda é 25/11 em São Paulo.
        const w = checkinWindow({ ...evening, startDate: '2026-11-26T01:00:00+00:00' }, sp('25', '17:00:00'));
        expect(w.startDay).toBe('2026-11-25');
        expect(w.state).toBe('open');
    });

    it('nunca abre antes do que o banco aceita (12h antes)', () => {
        expect(checkinWindow(evening).opensAt!.getTime()).toBeGreaterThanOrEqual(sp('25', '06:00:00').getTime());
    });

    it('sem horário de início vale o dia inteiro; sem data explica o motivo', () => {
        const allDay = { startDate: DAY, startTime: null, endTime: null };
        expect(checkinWindow(allDay, sp('25', '23:00:00')).state).toBe('open');
        const none = checkinWindow({ ...allDay, startDate: null });
        expect(none.state).toBe('no_date');
        expect(checkinWindowMessage(none)).toMatch(/sem data/);
    });

    it('as mensagens dizem quando libera e quando encerrou', () => {
        expect(checkinWindowMessage(checkinWindow(evening, sp('25', '10:00:00'))))
            .toBe('Chegada liberada a partir de 25/11 às 16:00.');
        expect(checkinWindowMessage(checkinWindow(evening, sp('26', '03:00:00'))))
            .toMatch(/terminou em 26\/11 às 01:00/);
    });
});

describe('isTodayShift', () => {
    const base = { ...evening, ...NONE, status: 'hired' };

    it('turno de hoje aparece antes e depois da janela', () => {
        expect(isTodayShift(base, sp('25', '08:00:00'))).toBe(true);
        expect(isTodayShift({ ...base, startTime: '06:00', endTime: '08:00' }, sp('25', '20:00:00'))).toBe(true);
    });

    it('turno de outro dia não aparece; o noturno segue no dia seguinte', () => {
        expect(isTodayShift(base, sp('24', '12:00:00'))).toBe(false);
        expect(isTodayShift({ ...base, ...overnight }, sp('26', '09:00:00'))).toBe(true);
        expect(isTodayShift({ ...base, ...overnight }, sp('27', '09:00:00'))).toBe(false);
    });

    it('com chegada e sem saída aparece sempre; com saída some', () => {
        const arrived = { ...base, worker_checkin_at: DAY };
        expect(isTodayShift(arrived, sp('28', '09:00:00'))).toBe(true);
        expect(isTodayShift({ ...arrived, company_checkout_confirmed_at: DAY }, sp('25', '19:00:00'))).toBe(false);
    });

    it('cancelado não aparece', () => {
        expect(isTodayShift({ ...base, status: 'cancelled' }, sp('25', '17:00:00'))).toBe(false);
    });
});
