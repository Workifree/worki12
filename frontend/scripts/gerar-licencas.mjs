// Gera public/licencas-de-terceiros.txt com os avisos de copyright e as licenças do código aberto
// que o Worki envia ao navegador. A MIT, a BSD e a Apache exigem que o aviso acompanhe o código.
// Uso (de frontend/): node scripts/gerar-licencas.mjs
//
// Fonte: as dependências de runtime do package.json (campo "dependencies") e tudo que elas puxam
// (dependencies + optionalDependencies, recursivo). devDependencies ficam de fora: não vão ao
// navegador. O texto de cada licença é copiado do arquivo LICENSE/NOTICE do próprio pacote em
// node_modules, nunca escrito à mão. A saída é determinística (sem data), então rodar de novo sem
// mudar dependência não gera diff.
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const raiz = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const saida = join(raiz, 'public', 'licencas-de-terceiros.txt')
const pkgRaiz = JSON.parse(readFileSync(join(raiz, 'package.json'), 'utf8'))

/**
 * Aviso da browser-use, de quem o page-agent deriva o processamento de DOM e de prompt
 * (page-controller: "port from browser-use", dom_tree/index.js; core: "Adapted from browser-use").
 * O pacote da browser-use não está em node_modules (é Python), então o texto aqui é a licença MIT
 * padrão com o aviso de copyright do projeto: MIT, Copyright (c) 2024 Gregor Zunic.
 * Origem: https://github.com/browser-use/browser-use
 */
const BROWSER_USE = `MIT License

Copyright (c) 2024 Gregor Zunic

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.`

/**
 * Dependências transitivas que o gráfico de runtime lista, mas que NÃO entram no bundle do navegador
 * (conferido nos sourcemaps do build de produção): tipos TypeScript (@types/*), o cliente WebSocket
 * de Node (ws, usado só fora do navegador pelo supabase realtime), os tipos do undici e o código de
 * servidor do react-router (cookie, set-cookie-parser). Dependências DIRETAS do package.json
 * entram sempre, mesmo que o bundler as elimine.
 */
const FORA_DO_NAVEGADOR = new Set(['ws', 'undici-types', 'cookie', 'set-cookie-parser'])
const foraDoNavegador = (nome) => nome.startsWith('@types/') || FORA_DO_NAVEGADOR.has(nome)

/** Acha o diretório do pacote como o Node faria: sobe a partir de quem depende dele. */
function achaPacote(nome, aPartirDe) {
  let dir = aPartirDe
  for (;;) {
    const candidato = join(dir, 'node_modules', nome)
    if (existsSync(join(candidato, 'package.json'))) return candidato
    const pai = dirname(dir)
    if (pai === dir) return null
    dir = pai
  }
}

const ehLicenca = (arquivo) => /^(licen[sc]e|copying|notice)(\.|-|$)/i.test(arquivo)

function autorDe(pkg) {
  const a = pkg.author
  if (!a) return ''
  return typeof a === 'string' ? a : [a.name, a.email && `<${a.email}>`].filter(Boolean).join(' ')
}

/** Percorre o fecho de dependências de runtime. Chave: nome@versão (versões distintas contam). */
const pacotes = new Map()
const faltando = []

function visita(nome, aPartirDe, direta = false) {
  if (!direta && foraDoNavegador(nome)) return
  const dir = achaPacote(nome, aPartirDe)
  if (!dir) {
    faltando.push(nome)
    return
  }
  const pkg = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8'))
  const chave = `${pkg.name}@${pkg.version}`
  if (pacotes.has(chave)) return

  const arquivos = readdirSync(dir).filter(ehLicenca).sort()
  const textos = arquivos
    .map((a) => readFileSync(join(dir, a), 'utf8').replace(/\r\n/g, '\n').trim())
    .filter(Boolean)
  const spdx = typeof pkg.license === 'string' ? pkg.license : pkg.license?.type ?? 'SEM-CAMPO-license'
  pacotes.set(chave, { nome: pkg.name, versao: pkg.version, spdx, autor: autorDe(pkg), textos })

  for (const dep of Object.keys({ ...pkg.dependencies, ...pkg.optionalDependencies })) {
    visita(dep, dir)
  }
}

for (const dep of Object.keys(pkgRaiz.dependencies ?? {})) visita(dep, raiz, true)

if (faltando.length > 0) {
  console.error(`Pacotes de runtime ausentes em node_modules (rode npm install): ${[...new Set(faltando)].join(', ')}`)
  process.exit(1)
}

const lista = [...pacotes.values()].sort((a, b) => a.nome.localeCompare(b.nome) || a.versao.localeCompare(b.versao))
const semTexto = lista.filter((p) => p.textos.length === 0)

// Agrupa pacotes cujo texto de licença é idêntico byte a byte (ex.: todos os @supabase/*), para o
// arquivo não repetir a mesma licença dezenas de vezes. O aviso de copyright vem dentro do texto,
// então só agrupa quando o texto inteiro é igual.
const grupos = new Map()
for (const p of lista.filter((x) => x.textos.length > 0)) {
  const corpo = p.textos.join('\n\n----- (arquivo adicional do pacote) -----\n\n')
  if (!grupos.has(corpo)) grupos.set(corpo, [])
  grupos.get(corpo).push(p)
}

const linha = '='.repeat(78)
const partes = []

partes.push(`AVISOS DE CÓDIGO ABERTO DE TERCEIROS — WORKI

O Worki usa código aberto. Este arquivo reúne os avisos de copyright e os textos de licença do
software de terceiros que o Worki envia ao navegador, como exigem as licenças MIT, BSD, ISC e Apache.
Foi gerado por frontend/scripts/gerar-licencas.mjs a partir das dependências de runtime do projeto;
os textos são copiados dos arquivos de licença de cada pacote.`)

partes.push(`${linha}
DERIVAÇÃO: browser-use
${linha}

Parte do código do page-agent (@page-agent/core e @page-agent/page-controller), que o Worki usa
no assistente da tela, foi portada ou adaptada do projeto browser-use (processamento da árvore
do DOM e montagem de prompt). Aviso e licença da browser-use
(https://github.com/browser-use/browser-use):

${BROWSER_USE}`)

partes.push(`${linha}
PACOTES INCLUÍDOS (${lista.length})
${linha}

${lista.map((p) => `- ${p.nome}@${p.versao} (${p.spdx})`).join('\n')}`)

for (const [corpo, membros] of grupos) {
  const cabecalho = membros.map((p) => `${p.nome}@${p.versao} (${p.spdx})`).join('\n')
  partes.push(`${linha}\n${cabecalho}\n${linha}\n\n${corpo}`)
}

if (semTexto.length > 0) {
  partes.push(`${linha}
PACOTES SEM ARQUIVO DE LICENÇA PRÓPRIO
${linha}

Os pacotes abaixo não trazem um arquivo de licença no npm. Declaram a licença no package.json
(campo "license"), com o autor indicado:

${semTexto.map((p) => `- ${p.nome}@${p.versao}: ${p.spdx}${p.autor ? ` — ${p.autor}` : ''}`).join('\n')}`)
}

writeFileSync(saida, partes.join('\n\n') + '\n', 'utf8')
console.log(
  `licencas-de-terceiros.txt: ${lista.length} pacotes, ${grupos.size} textos distintos` +
    (semTexto.length ? `, ${semTexto.length} sem arquivo de licença (${semTexto.map((p) => p.nome).join(', ')})` : ''),
)
