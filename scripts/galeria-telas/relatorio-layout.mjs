// Resume layout.json (gerado por `node run.mjs --layout`) em contagens e achados agrupados.
// Uso: node relatorio-layout.mjs PASTA [PASTA2 ...] [--md=arquivo.md] [--min-sev=2] [--top=40]
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join, resolve } from 'node:path';

const args = process.argv.slice(2);
const pastas = args.filter((a) => !a.startsWith('--'));
const opt = Object.fromEntries(args.filter((a) => a.startsWith('--')).map((a) => { const [k, ...v] = a.slice(2).split('='); return [k, v.join('=') || true]; }));
if (!pastas.length) throw new Error('informe a pasta com layout.json');
const minSev = Number(opt['min-sev'] || 1);
const top = Number(opt.top || 40);

// Junta várias pastas (a posterior vence).
const cen = {};
for (const p of pastas) {
  const f = join(resolve(p), 'layout.json');
  if (!existsSync(f)) throw new Error(`sem ${f}`);
  const j = JSON.parse(readFileSync(f, 'utf8')).cenarios;
  for (const [id, c] of Object.entries(j)) { cen[id] ||= { ...c, viewports: {} }; Object.assign(cen[id].viewports, c.viewports); }
}

const TIPOS = ['sobreposicao', 'coberto', 'fim', 'overflow', 'texto', 'alvo', 'dobra', 'teclado'];
const NOMES = { sobreposicao: 'sobreposição (a)', coberto: 'fixo/camada cobre alvo (b)', overflow: 'overflow horizontal (c)', texto: 'texto cortado/escapando (d)', alvo: 'alvo < 44px (e)', dobra: 'primário fora da dobra (f)', fim: 'rodapé impede o fim (g)', teclado: 'teclado cobre campo (h)' };
const vpsUsados = [...new Set(Object.values(cen).flatMap((c) => Object.keys(c.viewports)))].sort((a, b) => parseInt(b) - parseInt(a) || a.localeCompare(b));
// Classificação aplicada igual ao "antes" e ao "depois": só o que sobra conta como defeito deste lote.
//  sidebar = rail do menu lateral em 768/1024 (arquivo de outro agente); fp = falso positivo conhecido do detector.
const ROTULOS_SIDEBAR = /^(?:p|span|a) "(Worki|Início|Mensagens|Criar turno|Verificado|Empresa|Turnos|Elenco|Gestão|Relatórios|Meus Turnos|Empresas|Recebimentos)"/;
function classificar(a, vp) {
  const d = a.d;
  if (['768', '1024'].includes(vp) && ['texto', 'alvo'].includes(a.t) && ROTULOS_SIDEBAR.test(d)) return 'sidebar';
  if (a.t === 'texto' && /^h1 "Mensagens"|^p "Converse com/.test(d)) return 'fp'; // max-md:sr-only
  if (a.t === 'texto' && /^p "TERMO DE PRESTA/.test(d)) return 'fp'; // prévia recortada com "ver completo"
  if (a.t === 'texto' && /\(reticências\)/.test(d)) return 'fp'; // nome truncado com reticências, intencional
  if (a.t === 'coberto' && /Notificações Marcar todas/.test(d)) return 'fp'; // painel do sino aberto cobre por desenho
  if (a.t === 'teclado' && /barras fixas deixam só/.test(d) && /menu/.test(a.cen || '')) return 'fp'; // menu aberto contado como barra
  return null;
}
const norm = (d) => d.replace(/\d+(\.\d+)?/g, '#').replace(/"[^"]*"/g, '"_"');

const descartes = {};
const conta = {}; // tipo -> vp -> n
const grupos = new Map(); // chave -> { t, sev, d, cenarios:Set, vps:Set, imgs:[] }
let comAchado = 0, total = 0;
for (const c of Object.values(cen)) {
  for (const [vp, x] of Object.entries(c.viewports)) {
    total++;
    const ach = (x.layout || []).map((a) => ({ ...a, cen: c.id, classe: classificar({ ...a, cen: c.id }, vp) })).filter((a) => a.sev >= minSev);
    if (ach.some((a) => !a.classe)) comAchado++;
    for (const a of ach) {
      if (a.classe) { descartes[a.classe] = (descartes[a.classe] || 0) + 1; continue; }
      (conta[a.t] ||= {})[vp] = (conta[a.t][vp] || 0) + 1;
      const chave = `${a.t}|${norm(a.d)}`;
      const g = grupos.get(chave) || { t: a.t, sev: a.sev, d: a.d, cenarios: new Set(), vps: new Set(), imgs: [], n: 0 };
      g.cenarios.add(c.id); g.vps.add(vp); g.n++;
      if (a.img && g.imgs.length < 3) g.imgs.push(a.img);
      grupos.set(chave, g);
    }
  }
}

const linhas = [];
linhas.push(`Cenários x viewports medidos: ${total}; com algum achado (sev >= ${minSev}): ${comAchado}`);
linhas.push(`Fora da conta: ${descartes.sidebar || 0} do Sidebar (outro agente), ${descartes.fp || 0} falsos positivos conhecidos`);
linhas.push('');
linhas.push(['| tipo', ...vpsUsados, 'total |'].join(' | '));
linhas.push(['|---', ...vpsUsados.map(() => '---:'), '---:|'].join('|'));
const totPorVp = {};
for (const t of TIPOS) {
  const l = conta[t] || {};
  const tot = Object.values(l).reduce((s, n) => s + n, 0);
  vpsUsados.forEach((v) => { totPorVp[v] = (totPorVp[v] || 0) + (l[v] || 0); });
  linhas.push(`| ${NOMES[t]} | ${vpsUsados.map((v) => l[v] || 0).join(' | ')} | ${tot} |`);
}
linhas.push(`| **total** | ${vpsUsados.map((v) => totPorVp[v] || 0).join(' | ')} | ${Object.values(totPorVp).reduce((s, n) => s + n, 0)} |`);
linhas.push('');
linhas.push(`## Achados agrupados (top ${top}, por gravidade e alcance)`);
const ord = [...grupos.values()].sort((a, b) => b.sev - a.sev || b.cenarios.size - a.cenarios.size);
for (const g of ord.slice(0, top)) {
  linhas.push(`- [sev ${g.sev}] **${g.t}** ${g.d}  — ${g.cenarios.size} cenário(s), vps ${[...g.vps].join('/')}; ex.: ${[...g.cenarios].slice(0, 3).join(', ')}${g.imgs.length ? `; foto: ${g.imgs[0]}` : ''}`);
}
const saida = linhas.join('\n');
console.log(saida);
if (typeof opt.md === 'string') writeFileSync(opt.md, saida + '\n');
