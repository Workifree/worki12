import { useCallback, useEffect, useRef, useState } from 'react'
import { logError } from '../lib/logger'
import { isEarned } from '../components/bonus/trailView'
import type { BonusTrailApi, BonusTrailSnapshot } from '../components/bonus/types'

export interface UseBonusTrail {
  snapshot: BonusTrailSnapshot | null
  loading: boolean
  /** Falha sem nenhum dado para mostrar. */
  failed: boolean
  /** Falha ao atualizar com dados já na tela: o snapshot é mantido. */
  stale: boolean
  reload: () => Promise<void>
  /** Marcos conquistados ainda não comemorados (confete uma vez). */
  pendingCelebrations: Array<{ awardId: string; title: string; amountCents: number }>
  /** Marca como comemorados (chamar ao exibir o aviso). */
  acknowledgeCelebrations: () => Promise<void>
}

/**
 * Carrega a trilha do operador. `api` é injetável (adaptador do serviço de banco). O fetch de
 * `getMyTrail` já avalia no banco (R-8), então a tela nunca fica atrás.
 */
export function useBonusTrail(api: BonusTrailApi): UseBonusTrail {
  const [snapshot, setSnapshot] = useState<BonusTrailSnapshot | null>(null)
  const [loading, setLoading] = useState(true)
  const [failed, setFailed] = useState(false)
  const active = useRef(true)

  const load = useCallback(async () => {
    try {
      const data = await api.getMyTrail()
      if (!active.current) return
      setSnapshot(data)
      setFailed(false)
    } catch (error) {
      logError('useBonusTrail.getMyTrail', error)
      if (active.current) setFailed(true)
    } finally {
      if (active.current) setLoading(false)
    }
  }, [api])

  useEffect(() => {
    active.current = true
    void load()
    return () => {
      active.current = false
    }
  }, [load])

  const pendingCelebrations = (snapshot?.milestones ?? [])
    .filter((m) => isEarned(m) && !m.celebrated && m.awardId !== null)
    .map((m) => ({ awardId: m.awardId as string, title: m.title, amountCents: m.amountCents }))

  const acknowledgeCelebrations = useCallback(async () => {
    const ids = pendingCelebrations.map((p) => p.awardId)
    if (ids.length === 0) return
    try {
      await api.markCelebrated(ids)
      if (!active.current) return
      setSnapshot((prev) =>
        prev
          ? { ...prev, milestones: prev.milestones.map((m) => (m.awardId && ids.includes(m.awardId) ? { ...m, celebrated: true } : m)) }
          : prev,
      )
    } catch (error) {
      logError('useBonusTrail.markCelebrated', error)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [api, snapshot])

  return { snapshot, loading, failed: failed && snapshot === null, stale: failed && snapshot !== null, reload: load, pendingCelebrations, acknowledgeCelebrations }
}
