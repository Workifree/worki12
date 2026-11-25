import { describe, it, expect, beforeEach } from 'vitest'
import { MAX_TOASTS, pushToast, toastDuration } from './toastTiming'
import { focusPageHeading, shouldResetView } from './routeFocus'
import { nextTabIndex } from './tabsKeyboard'
import { focusFirstInvalid } from './formErrors'

describe('toastTiming', () => {
    it('erro não expira; os demais ganham tempo de leitura, com teto', () => {
        expect(toastDuration('error', 'x')).toBeNull()
        expect(toastDuration('success', 'x')).toBeGreaterThanOrEqual(6000)
        expect(toastDuration('info', 'x'.repeat(120))!).toBeGreaterThan(toastDuration('info', 'x')!)
        expect(toastDuration('info', 'x'.repeat(2000))).toBe(15000)
    })

    it('troca o repetido e respeita o teto', () => {
        const base = [{ message: 'a', type: 'error' as const }]
        expect(pushToast(base, { message: 'a', type: 'error' })).toHaveLength(1)
        let list = base
        for (let i = 0; i < 10; i++) list = pushToast(list, { message: String(i), type: 'error' })
        expect(list).toHaveLength(MAX_TOASTS)
        expect(list.at(-1)?.message).toBe('9')
    })
})

describe('foco de rota', () => {
    beforeEach(() => { document.body.innerHTML = '' })

    it('só reinicia a tela ao ir para frente em outro caminho', () => {
        expect(shouldResetView('PUSH', '/a', '/b')).toBe(true)
        expect(shouldResetView('REPLACE', '/a', '/b')).toBe(true)
        expect(shouldResetView('POP', '/a', '/b')).toBe(false)
        expect(shouldResetView('PUSH', '/a', '/a')).toBe(false)
        expect(shouldResetView('PUSH', null, '/a')).toBe(false)
    })

    it('foca o h1, inclusive o que aparece depois do esqueleto', async () => {
        document.body.innerHTML = '<main></main>'
        const cancel = focusPageHeading()
        document.querySelector('main')!.innerHTML = '<h1>Turnos</h1>'
        await new Promise((resolve) => setTimeout(resolve, 0))
        expect(document.activeElement?.textContent).toBe('Turnos')
        cancel()
    })

    it('não rouba o foco de um campo', () => {
        document.body.innerHTML = '<main><h1>X</h1><input /></main>'
        const input = document.querySelector('input')!
        input.focus()
        focusPageHeading()
        expect(document.activeElement).toBe(input)
    })
})

describe('nextTabIndex', () => {
    it('setas dão a volta; Home/End vão às pontas; outras teclas passam', () => {
        expect(nextTabIndex('ArrowRight', 3, 4)).toBe(0)
        expect(nextTabIndex('ArrowLeft', 0, 4)).toBe(3)
        expect(nextTabIndex('Home', 2, 4)).toBe(0)
        expect(nextTabIndex('End', 0, 4)).toBe(3)
        expect(nextTabIndex('Enter', 0, 4)).toBeNull()
    })
})

describe('focusFirstInvalid', () => {
    it('foca o primeiro inválido na ordem da tela', () => {
        document.body.innerHTML =
            '<form><input id="a" /><div id="g" data-invalid="true" tabindex="-1"></div><input id="b" aria-invalid="true" /></form>'
        expect(focusFirstInvalid(document.querySelector('form'))).toBe(true)
        expect(document.activeElement?.id).toBe('g')
    })
})
