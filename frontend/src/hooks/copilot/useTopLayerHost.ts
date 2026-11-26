import { useEffect, useState } from 'react'
import { UI_ATTR } from '../../lib/copilot/dom'

/**
 * Nó estável onde a interface do copiloto é montada.
 *
 * `showModal()` deixa INERTE tudo que não é descendente do modal, inclusive outros elementos do
 * top layer; z-index não resolve. Por isso o nó é movido para dentro do modal da frente (e volta
 * ao body quando ele fecha). `popover="manual"` o põe no top layer, sem ser cortado pelo modal.
 */
export function useTopLayerHost(): HTMLElement {
  const [host] = useState(() => {
    const node = document.createElement('div')
    node.setAttribute(UI_ATTR, '')
    node.setAttribute('data-page-agent-ignore', 'true')
    node.setAttribute('data-testid', 'copilot-host')
    // Neutraliza o estilo padrão de popover (centralizado, com borda e fundo).
    node.style.cssText =
      'position:fixed;inset:auto;top:0;left:0;width:0;height:0;margin:0;padding:0;border:0;background:transparent;overflow:visible;z-index:2147483647'
    return node
  })

  useEffect(() => {
    const canPop = typeof (host as HTMLElement & { showPopover?: () => void }).showPopover === 'function'
    if (canPop) host.setAttribute('popover', 'manual')

    const place = () => {
      const open = Array.from(document.querySelectorAll('dialog[open]')).filter((d) => !d.hasAttribute('inert'))
      const target = open.at(-1) ?? document.body
      if (host.parentElement === target) return
      target.appendChild(host)
      if (canPop) {
        try {
          host.showPopover()
        } catch {
          // já aberto
        }
      }
    }
    place()
    const observer = new MutationObserver(place)
    observer.observe(document.body, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ['open', 'inert'],
    })
    return () => {
      observer.disconnect()
      host.remove()
    }
  }, [host])

  return host
}
