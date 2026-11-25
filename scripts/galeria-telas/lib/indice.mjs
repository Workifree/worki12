import { writeFileSync } from 'node:fs';
import { join } from 'node:path';

const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

export function resumoCenario(c) {
  const v = Object.values(c.viewports);
  return {
    overflow: Object.entries(c.viewports).filter(([, x]) => x.sobra || x.forados?.length || x.rolagemNoDialogo?.length).map(([k, x]) => `${k}${x.sobra ? ` (+${x.sobra}px)` : ''}`),
    pequenos: Math.max(0, ...v.map((x) => x.pequenos?.length ?? 0)),
    console: [...new Set(v.flatMap((x) => x.console ?? []))],
    erro: [...new Set(v.flatMap((x) => (x.telasDeErro ?? []).filter((t) => !(c.erroEsperado))))],
    naoConfirmado: v.some((x) => x.naoConfirmado), falhas: [...new Set(v.flatMap((x) => x.falhas ?? []))],
  };
}

export function gravarIndice(saida, resultados, meta) {
  const lista = Object.values(resultados).sort((a, b) => a.ordem - b.ordem);
  writeFileSync(join(saida, 'resultados.json'), JSON.stringify({ meta, cenarios: resultados }, null, 1));

  let md = `# Galeria de telas do Worki\n\nGerada em ${meta.quando}. Cenários: ${lista.length}. Requisições externas que saíram: ${meta.vazou.length}. Abortadas no navegador: ${meta.bloqueadas.length}.\n\n`;
  md += '| Cenário | Papel | Rota | Estado confirmado | Rolagem horizontal | Alvos < 44px | Erros de console | Tela de erro |\n|---|---|---|---|---|---|---|---|\n';
  let corpo = ''; let grupo = '';
  for (const c of lista) {
    const r = resumoCenario(c);
    md += `| ${c.id} | ${c.papel} | \`${c.rota}\` | ${r.naoConfirmado || r.falhas.length ? `NÃO (${[...r.falhas].join('; ').slice(0, 120) || 'texto esperado ausente'})` : 'sim'} | ${r.overflow.join(', ') || '-'} | ${r.pequenos || '-'} | ${r.console.length || '-'} | ${r.erro.join(', ') || '-'} |\n`;
    if (c.grupo !== grupo) { grupo = c.grupo; corpo += `<h2 id="${esc(grupo)}">${esc(grupo)}</h2>`; }
    const selo = (cls, t) => `<span class="s ${cls}">${esc(t)}</span>`;
    corpo += `<article id="${esc(c.id)}" data-problema="${r.overflow.length || r.console.length || r.erro.length || r.naoConfirmado || r.falhas.length ? 1 : 0}"><h3>${esc(c.id)}</h3><p>${esc(c.papel)} · <code>${esc(c.rota)}</code> · ${esc(c.regra)}</p><p>`
      + (r.naoConfirmado || r.falhas.length ? selo('ruim', 'estado não confirmado') : selo('bom', 'estado confirmado'))
      + (r.overflow.length ? selo('ruim', `rolagem horizontal: ${r.overflow.join(', ')}`) : '')
      + (r.pequenos ? selo('aviso', `${r.pequenos} alvos < 44px`) : '') + (r.console.length ? selo('aviso', `${r.console.length} erros de console`) : '') + (r.erro.length ? selo('ruim', `tela de erro: ${r.erro.join(', ')}`) : '') + '</p>';
    const detalhes = Object.entries(c.viewports).map(([k, x]) => [x.forados?.length && `${k} estouram: ${x.forados.join(' | ')}`, x.pequenos?.length && `${k} pequenos: ${x.pequenos.join(' | ')}`, x.falhas?.length && `${k} falhas: ${x.falhas.join(' | ')}`].filter(Boolean)).flat().concat(r.console);
    if (detalhes.length) corpo += `<details><summary>detalhes</summary><ul>${detalhes.map((d) => `<li>${esc(d)}</li>`).join('')}</ul></details>`;
    corpo += `<div class="fotos">${Object.values(c.viewports).flatMap((x) => x.fotos ?? []).map((f) => `<a href="${esc(f)}" target="_blank"><img loading="lazy" src="${esc(f)}" alt="${esc(f)}"><small>${esc(f.split('__')[1])}</small></a>`).join('')}</div></article>`;
  }
  writeFileSync(join(saida, 'index.md'), md);
  const grupos = [...new Set(lista.map((c) => c.grupo))];
  writeFileSync(join(saida, 'index.html'), `<!doctype html><html lang="pt-BR"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Galeria Worki</title><style>
body{font:14px system-ui;margin:16px;background:#f4f4f0;color:#111}article{background:#fff;border:2px solid #111;border-radius:12px;padding:12px;margin:12px 0}h3{margin:0;overflow-wrap:anywhere}
.fotos{display:flex;gap:12px;overflow-x:auto;align-items:flex-start}.fotos a{flex:none;text-align:center;color:#111}.fotos img{height:360px;width:auto;max-width:560px;object-fit:cover;object-position:top;border:1px solid #999;display:block}
.s{display:inline-block;padding:2px 8px;border-radius:99px;margin:0 4px 4px 0;border:1px solid #111}.bom{background:#d1fae5}.ruim{background:#fecaca}.aviso{background:#fef3c7}nav a{margin-right:10px}body.so article[data-problema="0"]{display:none}</style>
<h1>Galeria de telas do Worki</h1><p>${esc(meta.quando)} · ${lista.length} cenários · requisições externas que saíram: <b>${meta.vazou.length}</b> · abortadas: ${meta.bloqueadas.length}</p>
<label><input type="checkbox" onchange="document.body.classList.toggle('so',this.checked)"> só cenários com alerta</label><nav>${grupos.map((g) => `<a href="#${esc(g)}">${esc(g)}</a>`).join('')}</nav>${corpo}</html>`);
}
