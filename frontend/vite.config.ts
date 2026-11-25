import { createHash } from 'node:crypto'
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
 * disponível" jamais apareceria. O id é um hash do conteúdo publicado (index.html, que cita os
 * assets com hash, + arquivos do PWA): muda quando o app muda, inclusive em deploy feito pela CLI
 * com o mesmo commit, e não muda em rebuild idêntico. Sem dependência extra.
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
      const hash = createHash('sha256')
      for (const name of ['index.html', 'sw.js', 'offline.html', 'offline.js', 'manifest.webmanifest']) {
        hash.update(readFileSync(resolve(root, outDir, name)))
      }
      const buildId = hash.digest('hex').slice(0, 12)
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
