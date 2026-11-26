/**
 * Duas experiências, uma lógica: celular (toque, sheet, dedo virtual) e computador (cursor, painel
 * flutuante). A detecção é por ponteiro e por largura; testes e capturas forçam por parâmetro.
 */
import { useEffect, useState } from 'react'

export type DeviceMode = 'mobile' | 'desktop'

const MOBILE_QUERY = '(pointer: coarse), (hover: none), (max-width: 767px)'

/** `?copilot-device=mobile|desktop` na URL, ou `window.__COPILOT_DEVICE__` (testes). */
function forced(): DeviceMode | null {
  try {
    const fromUrl = new URLSearchParams(window.location.search).get('copilot-device')
    const value = fromUrl ?? (window as unknown as { __COPILOT_DEVICE__?: string }).__COPILOT_DEVICE__
    return value === 'mobile' || value === 'desktop' ? value : null
  } catch {
    return null
  }
}

export function detectDeviceMode(): DeviceMode {
  const override = forced()
  if (override) return override
  try {
    if (window.matchMedia?.(MOBILE_QUERY).matches) return 'mobile'
  } catch {
    // sem matchMedia: cai para a largura
  }
  return window.innerWidth <= 767 ? 'mobile' : 'desktop'
}

/** `override` (propriedade do componente) vale mais que a detecção. */
export function useDeviceMode(override?: DeviceMode): DeviceMode {
  const [mode, setMode] = useState<DeviceMode>(() => override ?? detectDeviceMode())
  useEffect(() => {
    if (override) return
    const update = () => setMode(detectDeviceMode())
    update()
    const query = window.matchMedia?.(MOBILE_QUERY)
    query?.addEventListener?.('change', update)
    window.addEventListener('resize', update)
    return () => {
      query?.removeEventListener?.('change', update)
      window.removeEventListener('resize', update)
    }
  }, [override])
  return override ?? mode
}
