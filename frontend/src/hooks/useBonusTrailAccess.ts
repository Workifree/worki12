import { useEffect, useState } from 'react'
import type { BonusTrailApi } from '../components/bonus/types'
import { logError } from '../lib/logger'
import { supabase } from '../lib/supabase'
import { BonusTrailService } from '../services/bonusTrailService'

/**
 * Acesso LEVE à Trilha: só diz se existe inscrição `active`, via
 * `BonusTrailService.hasActiveEnrollment()` (consulta que NÃO roda a avaliação no banco), com um
 * cache de módulo: Sidebar, cabeçalho e BottomNav pedem ao
 * mesmo tempo e a RPC sai uma única vez (sem refetch em cascata). Falha ou trilha desligada = false.
 */
const TTL_OK_MS = 5 * 60 * 1000
const TTL_FAIL_MS = 60 * 1000

interface CacheEntry {
  promise: Promise<boolean>
  expiresAt: number
}

let cache: CacheEntry | null = null

const listeners = new Set<() => void>()

/** Descarta o cache e faz quem está montado consultar de novo (aceite, saída, outra conta). */
export function resetBonusTrailAccessCache(): void {
  cache = null
  listeners.forEach((notify) => notify())
}

let watchingAuth = false
let lastUserId: string | null | undefined

/** Uma única inscrição no auth: saída ou troca de usuário nunca herda o acesso da conta anterior. */
function watchAuth(): void {
  if (watchingAuth || typeof supabase.auth?.onAuthStateChange !== 'function') return
  watchingAuth = true
  supabase.auth.onAuthStateChange((event, session) => {
    const userId = session?.user?.id ?? null
    const changed = event === 'SIGNED_OUT' || (lastUserId !== undefined && lastUserId !== userId)
    lastUserId = userId
    // Fora do callback do auth: consultar o Supabase de dentro dele pode travar o client.
    if (changed) setTimeout(resetBonusTrailAccessCache, 0)
  })
}

/** `api` é só ponto de injeção (testes); sem ele vai a consulta leve. */
export function fetchBonusTrailAccess(api?: BonusTrailApi): Promise<boolean> {
  const now = Date.now()
  if (cache && cache.expiresAt > now) return cache.promise
  const entry: CacheEntry = {
    expiresAt: now + TTL_OK_MS,
    promise: (api
      ? api.getMyTrail().then((snapshot) => snapshot.status === 'active')
      : BonusTrailService.hasActiveEnrollment()
    )
      .catch((error: unknown) => {
        logError('useBonusTrailAccess', error)
        entry.expiresAt = Date.now() + TTL_FAIL_MS
        return false
      }),
  }
  cache = entry
  return entry.promise
}

/** `enabled=false` (ex.: área de freela) não consulta nada. */
export function useBonusTrailAccess(enabled: boolean = true, api?: BonusTrailApi): boolean {
  const [hasAccess, setHasAccess] = useState(false)
  const [version, setVersion] = useState(0)

  useEffect(() => {
    if (!enabled) return
    watchAuth()
    const notify = () => {
      setHasAccess(false)
      setVersion((v) => v + 1)
    }
    listeners.add(notify)
    return () => {
      listeners.delete(notify)
    }
  }, [enabled])

  useEffect(() => {
    if (!enabled) return
    let active = true
    void fetchBonusTrailAccess(api).then((ok) => {
      if (active) setHasAccess(ok)
    })
    return () => {
      active = false
    }
  }, [enabled, api, version])

  return enabled && hasAccess
}
