import { describe, it, expect, vi, beforeEach } from 'vitest'
import { clearAuthLockReload, createResilientLock, reloadOnceForAuthLock } from './authLock'
import type { AuthLock } from './authLock'

const abort = () => new DOMException('signal is aborted without reason', 'AbortError')

describe('createResilientLock', () => {
    it('AbortError na aquisição e depois sucesso: pede o lock de novo e roda a operação uma vez', async () => {
        let calls = 0
        const base: AuthLock = async (_name, _timeout, fn) => {
            calls++
            if (calls === 1) throw abort()
            return fn()
        }
        const fn = vi.fn().mockResolvedValue('sessao')
        await expect(createResilientLock(base, [0])('lock', 10, fn)).resolves.toBe('sessao')
        expect(calls).toBe(2)
        expect(fn).toHaveBeenCalledTimes(1)
    })

    it('desiste depois das esperas previstas e propaga o erro', async () => {
        const base = vi.fn().mockRejectedValue(abort())
        await expect(createResilientLock(base as unknown as AuthLock, [0, 0])('lock', 10, vi.fn())).rejects.toMatchObject({ name: 'AbortError' })
        expect(base).toHaveBeenCalledTimes(3)
    })

    it('não repete quando a operação já começou, nem no tick sem espera (timeout 0)', async () => {
        const started = vi.fn().mockRejectedValue(abort())
        const passthrough: AuthLock = (_n, _t, fn) => fn()
        await expect(createResilientLock(passthrough, [0])('lock', 10, started)).rejects.toBeTruthy()
        expect(started).toHaveBeenCalledTimes(1)

        const busy = vi.fn().mockRejectedValue(Object.assign(new Error('ocupado'), { isAcquireTimeout: true }))
        await expect(createResilientLock(busy as unknown as AuthLock, [0])('lock', 0, vi.fn())).rejects.toBeTruthy()
        expect(busy).toHaveBeenCalledTimes(1)
    })
})

describe('reloadOnceForAuthLock', () => {
    beforeEach(() => window.sessionStorage.clear())

    it('recarrega uma única vez até uma verificação dar certo', () => {
        const reload = vi.fn()
        expect(reloadOnceForAuthLock(reload)).toBe(true)
        expect(reloadOnceForAuthLock(reload)).toBe(false)
        expect(reload).toHaveBeenCalledTimes(1)
        clearAuthLockReload()
        expect(reloadOnceForAuthLock(reload)).toBe(true)
    })
})
