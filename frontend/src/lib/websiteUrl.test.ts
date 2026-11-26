import { describe, it, expect } from 'vitest'
import { toSafeWebsiteHref } from './websiteUrl'

describe('toSafeWebsiteHref', () => {
  it.each([
    ['empresa.com.br', 'https://empresa.com.br'],
    ['  www.empresa.com/x ', 'https://www.empresa.com/x'],
    ['http://empresa.com', 'http://empresa.com'],
    ['HTTPS://empresa.com', 'HTTPS://empresa.com'],
    ['//empresa.com', 'https://empresa.com'],
    ['empresa.com:8080', 'https://empresa.com:8080'],
    ['httpbin.org', 'https://httpbin.org'],
  ])('%s vira link externo', (raw, href) => {
    expect(toSafeWebsiteHref(raw)).toBe(href)
  })

  it.each(['javascript:alert(1)', ' JavaScript:alert(1)', 'java\tscript:alert(1)', 'data:text/html,x', 'vbscript:x', 'file:///etc', 'mailto:a@b.com', 'duas palavras', '', null, undefined])(
    '%s não vira link',
    (raw) => {
      expect(toSafeWebsiteHref(raw)).toBeNull()
    },
  )
})
