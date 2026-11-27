import { beforeEach, describe, expect, it } from 'vitest'
import {
    isRateDismissed,
    isWithinRatePromptWindow,
    markRateDismissed,
    markRatePromptShownThisSession,
    ratePromptShownThisSession,
    RATE_PROMPTED_KEY,
} from './ratePrompt'

const DAY = 86_400_000

describe('ratePrompt', () => {
    beforeEach(() => {
        localStorage.clear()
        sessionStorage.clear()
    })

    it('um prompt por sessão: flag persiste na sessionStorage', () => {
        expect(ratePromptShownThisSession()).toBe(false)
        markRatePromptShownThisSession()
        expect(ratePromptShownThisSession()).toBe(true)
    })

    it('dispensa (X, Esc, Agora não, fora) persiste em localStorage com timestamp', () => {
        markRateDismissed('job-1', 1000)
        const stored = JSON.parse(localStorage.getItem(RATE_PROMPTED_KEY) ?? '{}')
        expect(stored['job-1']).toBe(1000)
        expect(isRateDismissed('job-1', 1000 + DAY)).toBe(true)
        expect(isRateDismissed('job-2', 1000 + DAY)).toBe(false)
    })

    it('a dispensa expira depois de 14 dias', () => {
        markRateDismissed('job-1', 0)
        expect(isRateDismissed('job-1', 13 * DAY)).toBe(true)
        expect(isRateDismissed('job-1', 14 * DAY + 1)).toBe(false)
    })

    it('formato antigo (lista de ids) vira dispensa', () => {
        localStorage.setItem(RATE_PROMPTED_KEY, JSON.stringify(['job-9']))
        expect(isRateDismissed('job-9')).toBe(true)
    })

    it('janela de 3 dias para turno concluído', () => {
        const now = Date.parse('2026-11-27T12:00:00Z')
        expect(isWithinRatePromptWindow('2026-11-25T12:00:00Z', now)).toBe(true)
        expect(isWithinRatePromptWindow('2026-11-20T12:00:00Z', now)).toBe(false)
        expect(isWithinRatePromptWindow(null, now)).toBe(false)
    })
})
