// @vitest-environment node
/** O override de modelo é só de desenvolvimento: o bundle de produção não envia `eval`. */
import { build } from 'esbuild'
import { describe, expect, it } from 'vitest'

const bundle = async (dev: boolean) => {
  const out = await build({
    entryPoints: ['src/lib/copilot/transport.ts'],
    bundle: true, write: false, format: 'esm', minify: true, logLevel: 'silent',
    define: { 'import.meta.env.DEV': String(dev) },
  })
  return out.outputFiles[0].text
}

describe('modelo de avaliação', () => {
  it('produção: nem a chave do armazenamento nem o campo eval existem no código', async () => {
    const code = await bundle(false)
    expect(code).not.toContain('eval')
    expect(code).toContain('worki-copilot')
  })

  it('desenvolvimento: o override existe (prova de que o teste acima enxerga)', async () => {
    expect(await bundle(true)).toContain('worki:copilot:eval-model')
  })
})
