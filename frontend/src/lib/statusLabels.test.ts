import { describe, expect, it } from 'vitest'
import { STATUS, getStatus, roleLabel, statusLabel } from './statusLabels'

describe('glossário de status', () => {
    it('nenhum rótulo é enum cru ou sinônimo vetado', () => {
        const labels = Object.values(STATUS).flatMap((d) => Object.values(d).map((i) => i.label))
        for (const label of labels) {
            expect(label).not.toMatch(/_|cancelled|expired|pending|Finalizad|Dispensad/)
        }
    })

    it('status desconhecido, vazio ou herdado do Object não vaza para a tela', () => {
        expect(statusLabel('application', 'algo_novo')).toBe('Encerrado')
        expect(statusLabel('application', 'constructor')).toBe('Encerrado')
        expect(statusLabel('job', null)).toBe('Encerrado')
    })

    it('recusa e cancelamento são neutros', () => {
        expect(getStatus('application', 'declined').tone).toBe('neutral')
        expect(getStatus('application', 'cancelled')).toMatchObject({ label: 'Cancelado', tone: 'neutral' })
    })

    it('função: slug vira rótulo com acento; texto livre é preservado', () => {
        expect(roleLabel('garcom')).toBe('Garçom')
        expect(roleLabel('Garcom')).toBe('Garçom')
        expect(roleLabel('auxiliar_cozinha')).toBe('Auxiliar de cozinha')
        expect(roleLabel('Chef de Fila')).toBe('Chef de Fila')
        expect(roleLabel(null)).toBe('')
    })
})
