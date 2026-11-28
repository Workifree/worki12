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

/**
 * Aviso legal no próprio código enviado ao navegador.
 *
 * O Rollup descarta os comentários @license das bibliotecas antes da minificação (conferido: nem
 * com minify desligado eles chegam ao dist), e o esbuild do Vite não grava arquivo .LEGAL.txt. Então
 * o aviso entra como banner de comentário legal, que o esbuild preserva: (1) o chunk de entrada
 * aponta para o texto completo em /licencas-de-terceiros.txt; (2) o chunk que contém o page-agent
 * carrega o copyright dele e o da browser-use, de onde o page-agent deriva parte do código (a MIT
 * exige que o aviso acompanhe o código). O texto integral vem de scripts/gerar-licencas.mjs.
 */
function avisoLegalDoChunk(chunk: { isEntry: boolean; moduleIds: string[] }): string {
  const noChunk = (trecho: string) => chunk.moduleIds.some((id) => id.replace(/\\/g, '/').includes(trecho))
  const linhas: string[] = []
  if (chunk.isEntry) {
    linhas.push('Workyn usa codigo aberto de terceiros. Avisos de copyright e licencas (MIT, ISC, Apache-2.0, 0BSD): /licencas-de-terceiros.txt e /licencas')
  }
  if (noChunk('node_modules/@page-agent/') || noChunk('node_modules/ai-motion/')) {
    linhas.push(
      'page-agent (@page-agent/core, llms, page-controller): MIT, Copyright (c) 2026 SimonLuvRamen, Copyright (c) 2026 Alibaba Group Holding Limited.',
      'ai-motion: MIT, Copyright (c) 2025 Simon.',
      'Partes derivadas de browser-use: MIT, Copyright (c) 2024 Gregor Zunic.',
      'Texto integral da licenca MIT: /licencas-de-terceiros.txt',
    )
  }
  return linhas.length > 0 ? `/*!\n * ${linhas.join('\n * ')}\n */` : ''
}

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), serviceWorkerBuildId()],
  // Mantém no minificador qualquer comentário legal que sobreviva ao Rollup. 'external' não serve
  // aqui: o Vite minifica pela API transform do esbuild, que não grava o arquivo .LEGAL.txt, e os
  // comentários seriam descartados; 'eof' os junta ao fim do chunk.
  esbuild: {
    legalComments: 'eof',
  },
  build: {
    sourcemap: 'hidden',
    rollupOptions: {
      output: {
        banner: avisoLegalDoChunk,
      },
    },
  },
})
