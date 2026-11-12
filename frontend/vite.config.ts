import { readFileSync, writeFileSync, existsSync } from 'node:fs'
import { resolve } from 'node:path'
import { defineConfig } from 'vite'
import type { Plugin } from 'vite'
import react from '@vitejs/plugin-react'

/**
 * Carimba o service worker (public/sw.js) com um id de build.
 *
 * Sem isto o sw.js seria IDÊNTICO byte a byte em todo deploy e o navegador nunca detectaria
 * versão nova (ele só reinstala o worker quando o arquivo muda) — o aviso "Nova versão
 * disponível" jamais apareceria. O id vem do commit da Vercel quando existe, senão do horário
 * do build. Sem dependência extra (nada de vite-plugin-pwa/workbox).
 */
function serviceWorkerBuildId(): Plugin {
  let outDir = 'dist'
  let root = process.cwd()
  return {
    name: 'worki-sw-build-id',
    apply: 'build',
    configResolved(config) {
      outDir = config.build.outDir
      root = config.root
    },
    closeBundle() {
      const file = resolve(root, outDir, 'sw.js')
      if (!existsSync(file)) return
      const buildId = (process.env.VERCEL_GIT_COMMIT_SHA ?? Date.now().toString(36)).slice(0, 12)
      const source = readFileSync(file, 'utf8')
      if (!source.includes('__BUILD_ID__')) {
        throw new Error('sw.js sem o placeholder __BUILD_ID__: o service worker não seria versionado.')
      }
      writeFileSync(file, source.replaceAll('__BUILD_ID__', buildId))
    },
  }
}

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), serviceWorkerBuildId()],
  build: {
    sourcemap: 'hidden',
  },
})
