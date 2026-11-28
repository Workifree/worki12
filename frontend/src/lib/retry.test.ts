import { describe, expect, it, vi } from 'vitest';
import { isRealNetworkError, isRetryableError, isUnauthorizedError, loadFailureMessage, withRetry } from './retry';

const noSleep = () => Promise.resolve();

describe('isRealNetworkError', () => {
    it('reconhece fetch que não completou', () => {
        expect(isRealNetworkError(new TypeError('Failed to fetch'))).toBe(true);
        expect(isRealNetworkError({ message: 'TypeError: NetworkError when attempting to fetch resource.' })).toBe(true);
    });
    it('não chama de rede o que o servidor respondeu', () => {
        expect(isRealNetworkError({ status: 401, message: 'JWT expired' })).toBe(false);
        expect(isRealNetworkError({ status: 503, message: 'down' })).toBe(false);
        expect(isRealNetworkError({ code: '42501', message: 'permission denied' })).toBe(false);
    });
});

describe('isRetryableError', () => {
    it('repete rede, 401, 429 e 5xx', () => {
        expect(isRetryableError(new TypeError('Failed to fetch'))).toBe(true);
        expect(isRetryableError({ status: 401 })).toBe(true);
        expect(isRetryableError({ status: 429 })).toBe(true);
        expect(isRetryableError({ status: 502 })).toBe(true);
        expect(isRetryableError({ message: 'JWT expired', code: 'PGRST301' })).toBe(true);
    });
    it('não repete permissão/RLS nem 4xx', () => {
        expect(isRetryableError({ code: '42501' })).toBe(false);
        expect(isRetryableError({ status: 403 })).toBe(false);
        expect(isRetryableError({ status: 406 })).toBe(false);
    });
    it('detecta 401', () => {
        expect(isUnauthorizedError({ message: 'JWT expired' })).toBe(true);
        expect(isUnauthorizedError({ status: 500 })).toBe(false);
    });
});

describe('withRetry', () => {
    it('devolve na primeira quando dá certo', async () => {
        const fn = vi.fn().mockResolvedValue('ok');
        await expect(withRetry(fn, { sleep: noSleep })).resolves.toBe('ok');
        expect(fn).toHaveBeenCalledTimes(1);
    });
    it('repete até 3 vezes com backoff 1s/2s/4s e então sucede', async () => {
        const fn = vi.fn()
            .mockRejectedValueOnce(new TypeError('Failed to fetch'))
            .mockRejectedValueOnce({ status: 503 })
            .mockRejectedValueOnce({ status: 401 })
            .mockResolvedValue('ok');
        const sleep = vi.fn<(ms: number) => Promise<void>>(() => Promise.resolve());
        const beforeRetry = vi.fn();
        await expect(withRetry(fn, { sleep, beforeRetry })).resolves.toBe('ok');
        expect(sleep.mock.calls.map((c) => c[0])).toEqual([1000, 2000, 4000]);
        expect(beforeRetry).toHaveBeenCalledTimes(3);
        expect(fn).toHaveBeenCalledTimes(4);
    });
    it('lança o último erro depois de esgotar', async () => {
        const erro = new TypeError('Failed to fetch');
        const fn = vi.fn().mockRejectedValue(erro);
        await expect(withRetry(fn, { sleep: noSleep })).rejects.toBe(erro);
        expect(fn).toHaveBeenCalledTimes(4);
    });
    it('não repete erro de permissão', async () => {
        const fn = vi.fn().mockRejectedValue({ code: '42501' });
        await expect(withRetry(fn, { sleep: noSleep })).rejects.toEqual({ code: '42501' });
        expect(fn).toHaveBeenCalledTimes(1);
    });
});

describe('loadFailureMessage', () => {
    it('só diz "sem conexão" para falha de rede', () => {
        expect(loadFailureMessage(new TypeError('Failed to fetch'))).toMatch(/Sem conexão/);
        expect(loadFailureMessage({ status: 403 })).not.toMatch(/Sem conexão/);
    });
});
