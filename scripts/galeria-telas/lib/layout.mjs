// Detector de layout: componentes que se empurram, sobrepõem ou cobrem uns aos outros.
// As duas funções rodam DENTRO da página (page.evaluate); por isso não podem usar nada de fora.
//
// Tipos de achado (campo `t`):
//   sobreposicao  dois alvos interativos se cruzam > 15% (e um não contém o outro)
//   coberto       elementFromPoint no centro do alvo devolve outra coisa (fixo/sticky ou camada acima)
//   fim           barra fixa impede de ver o fim do conteúdo, mesmo rolando tudo
//   texto         texto cortado (overflow escondido sem reticências) ou escapando da própria caixa
//   dobra         botão primário abaixo da dobra, fora de barra fixa
//   teclado       com a janela reduzida (teclado virtual) o campo em foco fica coberto ou sem espaço
// Severidade (`sev`): 3 grave, 2 médio, 1 baixo.

export function detectar({ toque }) {
  const vw = document.documentElement.clientWidth;
  const vh = window.innerHeight;
  const gl = (window.__gl = []);
  const id = (el) => { let i = gl.indexOf(el); if (i < 0) { gl.push(el); i = gl.length - 1; } return i; };
  const achados = [];
  const add = (t, sev, d, els = []) => achados.push({ t, sev, d, ids: els.map(id) });

  const visivel = (el) => {
    const r = el.getBoundingClientRect();
    if (r.width < 1 || r.height < 1) return false;
    return !el.checkVisibility || el.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true });
  };
  const descrever = (el) => {
    const t = (el.getAttribute('aria-label') || el.innerText || el.getAttribute('placeholder') || el.getAttribute('type') || '').trim().replace(/\s+/g, ' ').slice(0, 36);
    const cls = typeof el.className === 'string' ? el.className.split(/\s+/).filter(Boolean).slice(0, 2).join('.') : '';
    return `${el.tagName.toLowerCase()}${t ? ` "${t}"` : cls ? `.${cls}` : ''}`;
  };
  const estilo = (el) => getComputedStyle(el);
  /** Fixo/sticky em si ou por ancestral. */
  const ancoraFixa = (el) => {
    for (let p = el; p && p !== document.documentElement; p = p.parentElement) {
      if (dialogo && (p === dialogo || p.contains(dialogo))) continue; // o próprio diálogo não conta como "barra fixa"
      const pos = estilo(p).position;
      if (pos === 'fixed' || pos === 'sticky') return p;
    }
    return null;
  };
  /** Retângulo visível: interseção com a janela e com ancestrais que cortam. */
  const recorte = (el) => {
    const r = el.getBoundingClientRect();
    let l = r.left, t = r.top, rr = r.right, b = r.bottom;
    for (let p = el.parentElement; p && p !== document.documentElement; p = p.parentElement) {
      const s = estilo(p);
      if (/(auto|scroll|hidden|clip)/.test(s.overflowX + s.overflowY) && p !== document.body) {
        const pr = p.getBoundingClientRect();
        if (/(auto|scroll|hidden|clip)/.test(s.overflowX)) { l = Math.max(l, pr.left); rr = Math.min(rr, pr.right); }
        if (/(auto|scroll|hidden|clip)/.test(s.overflowY)) { t = Math.max(t, pr.top); b = Math.min(b, pr.bottom); }
      }
    }
    return { l, t, r: rr, b, w: rr - l, h: b - t };
  };

  /** Menu/popover aberto cobre o resto de propósito (camada superior); só conta o que ele cobre de errado. */
  const emMenu = (el) => !!el.closest('[role="menu"],[role="listbox"],[popover]:popover-open,[data-menu-open]');
  /** Painel flutuante (sino aberto, popover): não encosta nas bordas nem ocupa a largura; cobrir é o papel dele. */
  const flutuante = (fixa) => { if (!fixa) return false; const r = fixa.getBoundingClientRect(); return r.top > 2 && r.bottom < vh - 2 && r.width < vw * 0.9; };
  /** Toast (z-80, some sozinho) cobre de propósito. */
  const ehToast = (fixa) => !!fixa && estilo(fixa).zIndex === '80';
  /** Só barra encostada no rodapé "impede o fim da rolagem"; cabeçalho fixo sobre conteúdo que rolou é normal. */
  const barraDeBaixo = (fixa) => { const r = fixa.getBoundingClientRect(); return r.bottom >= vh - 2 && r.top > vh * 0.4; };
  const dialogos = [...document.querySelectorAll('dialog[open],[role="dialog"],[role="alertdialog"]')].filter(visivel);
  var dialogo = dialogos.at(-1) ?? null; // eslint-disable-line no-var
  const raiz = dialogo ?? document;

  const SEL = 'button,a[href],input:not([type=hidden]),select,textarea,summary,[role=button],[role=tab],[role=switch],[role=menuitem],[role=radio],[role=checkbox]';
  const alvos = [];
  for (const el of raiz.querySelectorAll(SEL)) {
    if (el.closest('.sr-only,[aria-hidden="true"]')) continue;
    let alvo = el;
    if (['checkbox', 'radio', 'file'].includes(el.type)) alvo = el.closest('label') || (el.id && document.querySelector(`label[for="${CSS.escape(el.id)}"]`)) || el;
    if (!visivel(alvo) || alvos.includes(alvo)) continue;
    alvos.push(alvo);
  }

  // Rolagens (janela e contêineres internos grandes), para voltar ao topo no fim.
  const rolaveis = [...document.querySelectorAll('body *')].filter((e) => {
    const s = estilo(e);
    return /(auto|scroll)/.test(s.overflowY) && e.scrollHeight > e.clientHeight + 8 && e.clientHeight > vh * 0.3 && visivel(e);
  });
  const rolarTudo = (fim) => {
    window.scrollTo(0, fim ? 1e7 : 0);
    rolaveis.forEach((e) => { e.scrollTop = fim ? 1e7 : 0; });
  };
  rolarTudo(false);

  // ---- (a) sobreposição entre alvos interativos ----
  const linhas = (el) => (estilo(el).display === 'inline' ? [...el.getClientRects()].filter((q) => q.width > 1 && q.height > 1) : [el.getBoundingClientRect()]);
  const caixas = alvos.map((el) => ({ el, c: recorte(el), fixo: ancoraFixa(el) })).filter((x) => x.c.w > 2 && x.c.h > 2);
  for (let i = 0; i < caixas.length; i++) {
    for (let j = i + 1; j < caixas.length; j++) {
      const A = caixas[i], B = caixas[j];
      if (A.fixo !== B.fixo) continue; // camadas diferentes (fixo x conteúdo, painel x menu): o item (b) cobre
      if (A.el.contains(B.el) || B.el.contains(A.el)) continue;
      const w = Math.min(A.c.r, B.c.r) - Math.max(A.c.l, B.c.l);
      const h = Math.min(A.c.b, B.c.b) - Math.max(A.c.t, B.c.t);
      if (w <= 1 || h <= 1) continue;
      // link "esticado" (cobre o cartão de propósito, sem texto próprio)
      const esticado = (x) => x.el.tagName === 'A' && !(x.el.innerText || '').trim() && estilo(x.el).position === 'absolute';
      if (esticado(A) || esticado(B)) continue;
      // cada linha de um elemento em linha (link no meio da frase) vale por si
      let melhor = 0;
      for (const qa of linhas(A.el)) for (const qb of linhas(B.el)) {
        const ww = Math.min(qa.right, qb.right) - Math.max(qa.left, qb.left), hh = Math.min(qa.bottom, qb.bottom) - Math.max(qa.top, qb.top);
        if (ww > 1 && hh > 1) melhor = Math.max(melhor, ww * hh / Math.min(qa.width * qa.height, qb.width * qb.height));
      }
      if (melhor <= 0.15) continue;
      const q = (c) => `${Math.round(c.l)},${Math.round(c.t)}-${Math.round(c.r)},${Math.round(c.b)}`;
      add('sobreposicao', 3, `${descrever(A.el)} x ${descrever(B.el)} (${Math.round(melhor * 100)}%) [${q(A.c)} | ${q(B.c)}]`, [A.el, B.el]);
    }
  }

  // ---- (b) alvo coberto: elementFromPoint no centro, com o alvo trazido ao meio da janela ----
  const cobertos = new Set();
  for (const { el } of caixas.slice(0, 140)) {
    el.scrollIntoView({ block: 'center', inline: 'nearest', behavior: 'instant' });
    const c = recorte(el);
    const x0 = Math.max(c.l, 0), x1 = Math.min(c.r, vw), y0 = Math.max(c.t, 0), y1 = Math.min(c.b, vh);
    if (x1 - x0 < 4 || y1 - y0 < 4) continue;
    const topo = document.elementFromPoint((x0 + x1) / 2, (y0 + y1) / 2);
    if (!topo || el.contains(topo) || topo.contains(el) || emMenu(topo)) continue;
    if (el.tagName === 'LABEL' && el.control && (topo === el.control || el.contains(topo))) continue;
    if (topo.closest('label') === el) continue;
    const fixa = ancoraFixa(topo);
    if (ehToast(fixa) || flutuante(fixa)) continue;
    const chave = `${descrever(el)}|${descrever(topo)}`;
    if (cobertos.has(chave)) continue;
    cobertos.add(chave);
    add('coberto', fixa ? 3 : 2, `${descrever(el)} coberto por ${fixa ? 'fixo ' : ''}${descrever(fixa ?? topo)}`, [el, fixa ?? topo]);
  }

  // ---- (g) rodapé/barra fixa que impede ver o fim do conteúdo ----
  rolarTudo(true);
  {
    const folhas = [];
    for (const el of raiz.querySelectorAll('*')) {
      if (el.closest('.sr-only,[aria-hidden="true"],script,style') || ancoraFixa(el)) continue;
      if (el.children.length) continue;
      const temTexto = (el.innerText || '').trim().length > 0 || el.matches('img,svg,input,button,select,textarea,canvas');
      if (!temTexto || !visivel(el)) continue;
      const c = recorte(el);
      if (c.h < 4 || c.w < 4 || c.b < 0 || c.t > vh) continue;
      folhas.push({ el, c });
    }
    folhas.sort((a, b) => b.c.b - a.c.b);
    const vistos = new Set();
    for (const { el, c } of folhas.slice(0, 6)) {
      const y = Math.min(c.b - Math.min(5, c.h / 2), vh - 1), x = Math.min(Math.max((c.l + c.r) / 2, 1), vw - 1);
      const topo = document.elementFromPoint(x, y);
      if (!topo || el.contains(topo) || topo.contains(el) || emMenu(topo)) continue;
      const fixa = ancoraFixa(topo);
      if (!fixa || ehToast(fixa) || !barraDeBaixo(fixa)) continue;
      const k = descrever(fixa);
      if (vistos.has(k)) continue;
      vistos.add(k);
      add('fim', 3, `${k} cobre o fim do conteúdo (${descrever(el)})`, [el, fixa]);
      break;
    }
  }
  // Fim do conteúdo: o "último" alvo ao rolar tudo também precisa estar livre.
  for (const { el } of caixas.slice(-8)) {
    const c = recorte(el);
    if (c.b <= 0 || c.t >= vh || c.h < 4) continue;
    const x = Math.min(Math.max((c.l + c.r) / 2, 1), vw - 1), y = Math.min(Math.max((c.t + c.b) / 2, 1), vh - 1);
    const topo = document.elementFromPoint(x, y);
    if (!topo || el.contains(topo) || topo.contains(el) || topo.closest('label') === el || emMenu(topo)) continue;
    const fixa = ancoraFixa(topo);
    const chave = `${descrever(el)}|${descrever(topo)}`;
    if (!fixa || ehToast(fixa) || !barraDeBaixo(fixa) || cobertos.has(chave)) continue;
    cobertos.add(chave);
    add('fim', 3, `${descrever(el)} (fim da rolagem) coberto por fixo ${descrever(fixa)}`, [el, fixa]);
  }
  rolarTudo(false);

  // ---- (d) texto cortado ou escapando ----
  const cand = raiz.querySelectorAll('button,a[href],[role=tab],[role=button],label,h1,h2,h3,h4,p,span,li,td,th,dt,dd,legend,summary,div');
  let nTexto = 0;
  for (const el of cand) {
    if (nTexto > 40) break;
    if (el.closest('.sr-only,[aria-hidden="true"]') || !visivel(el)) continue;
    // só elementos cujo texto é direto (folha de texto), para não acusar contêiner pelo filho
    const proprio = [...el.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim());
    if (!proprio) continue;
    const s = estilo(el);
    const r = el.getBoundingClientRect();
    const clip = /(hidden|clip)/.test(s.overflowX);
    const clampLinhas = s.webkitLineClamp && s.webkitLineClamp !== 'none';
    const reticencias = s.textOverflow === 'ellipsis';
    const ehControle = el.matches('button,a[href],[role=tab],[role=button],summary');
    const nome = descrever(el);
    // escondido sem reticências (ou reticências em controle, onde o rótulo precisa ser lido inteiro)
    if (clip && el.scrollWidth > el.clientWidth + 1 && !clampLinhas && (!reticencias || ehControle)) {
      add('texto', ehControle ? 3 : 2, `${nome} corta ${el.scrollWidth - el.clientWidth}px (${reticencias ? 'reticências' : 'sem reticências'})`, [el]);
      nTexto++; continue;
    }
    if (/(hidden|clip)/.test(s.overflowY) && !clampLinhas && el.scrollHeight > el.clientHeight + 2 && el.clientHeight > 0 && s.display !== 'inline') {
      add('texto', 2, `${nome} corta ${el.scrollHeight - el.clientHeight}px na vertical`, [el]);
      nTexto++; continue;
    }
    // texto que escapa da própria caixa (overflow visível)
    if (!clip) {
      const rg = document.createRange();
      rg.selectNodeContents(el);
      const rs = [...rg.getClientRects()].filter((q) => q.width > 0 && q.height > 0);
      if (rs.length) {
        const dir = Math.max(...rs.map((q) => q.right)), baixo = Math.max(...rs.map((q) => q.bottom));
        if (s.display !== 'inline' && s.display !== 'contents') {
          if (dir > r.right + 4) { add('texto', ehControle ? 3 : 2, `${nome} escapa ${Math.round(dir - r.right)}px à direita`, [el]); nTexto++; continue; }
          if (ehControle && baixo > r.bottom + 2) { add('texto', 3, `${nome} escapa ${Math.round(baixo - r.bottom)}px embaixo`, [el]); nTexto++; continue; }
        }
      }
    }
  }

  // ---- (f) primário abaixo da dobra, sem barra fixa ----
  for (const el of raiz.querySelectorAll('button,a[href]')) {
    if (el.closest('.sr-only,[aria-hidden="true"]') || !visivel(el) || ancoraFixa(el)) continue;
    const s = estilo(el);
    const primario = el.type === 'submit' || (/rgb\(0, 0, 0\)|rgb\(0, 107, 51\)/.test(s.backgroundColor) && /rgb\(255, 255, 255\)/.test(s.color) && parseFloat(s.borderTopWidth) >= 2);
    if (!primario || s.display === 'inline' || el.getBoundingClientRect().height < 36) continue;
    const r = el.getBoundingClientRect();
    let limite = vh;
    for (let p = el.parentElement; p && p !== document.documentElement; p = p.parentElement) {
      const ps = estilo(p);
      if (/(auto|scroll|hidden|clip)/.test(ps.overflowY) && p !== document.body) limite = Math.min(limite, p.getBoundingClientRect().bottom);
    }
    if (r.top >= limite - 4) add('dobra', 1, `primário ${descrever(el)} abaixo da dobra (y=${Math.round(r.top)} de ${Math.round(limite)})`, [el]);
  }

  // ---- fora da janela: painel fixo/absoluto que vaza pela esquerda ou direita (a sobra normal fica com `medir`) ----
  for (const el of raiz.querySelectorAll('*')) {
    const s = estilo(el);
    if ((s.position !== 'fixed' && s.position !== 'absolute') || el.closest('.sr-only,[aria-hidden="true"]') || !visivel(el)) continue;
    const r = el.getBoundingClientRect();
    if (r.width < 60 || r.height < 30) continue;
    const c = recorte(el);
    const esq = r.left < -2 && c.l <= r.left + 1 && r.right > 8, dir = s.position === 'fixed' && r.right > vw + 2 && c.r >= r.right - 1 && r.left < vw - 8;
    if (esq || dir) add('overflow', 3, `${descrever(el)} (${s.position}) vaza ${esq ? `${Math.round(-r.left)}px pela esquerda` : `${Math.round(r.right - vw)}px pela direita`}`, [el]);
  }

  // ---- sobra horizontal e alvos pequenos ficam com `medir` (auditoria.mjs); aqui só o resto ----
  rolarTudo(false);
  return { achados, nAlvos: alvos.length };
}

/** Teclado virtual simulado: a janela já foi reduzida pelo chamador. */
export function detectarTeclado() {
  const vw = document.documentElement.clientWidth;
  const vh = window.innerHeight;
  const gl = (window.__gl ||= []);
  const id = (el) => { let i = gl.indexOf(el); if (i < 0) { gl.push(el); i = gl.length - 1; } return i; };
  const achados = [];
  const visivel = (el) => { const r = el.getBoundingClientRect(); return r.width > 1 && r.height > 1 && (!el.checkVisibility || el.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true })); };
  const descrever = (el) => `${el.tagName.toLowerCase()} "${(el.getAttribute('aria-label') || el.getAttribute('placeholder') || el.name || el.id || el.type || '').toString().slice(0, 32)}"`;
  const ancoraFixa = (el) => { for (let p = el; p && p !== document.documentElement; p = p.parentElement) { const pos = getComputedStyle(p).position; if (pos === 'fixed' || pos === 'sticky') return p; } return null; };
  const dialogo = [...document.querySelectorAll('dialog[open],[role="dialog"],[role="alertdialog"]')].filter(visivel).at(-1) ?? null;
  const raiz = dialogo ?? document;
  const campos = [...raiz.querySelectorAll('input:not([type=hidden]):not([type=checkbox]):not([type=radio]):not([type=file]):not([type=range]):not([type=submit]):not([type=button]),textarea')]
    .filter((e) => !e.disabled && !e.readOnly && !e.closest('.sr-only,[aria-hidden="true"]') && visivel(e)).slice(0, 8);
  // quanto da janela sobra livre: fixos no topo/rodapé que cobrem a faixa útil
  let topo = 0, base = vh;
  for (const el of document.querySelectorAll('body *')) {
    const s = getComputedStyle(el);
    if (s.position !== 'fixed' && s.position !== 'sticky') continue;
    if (!visivel(el) || el.closest('.sr-only,[aria-hidden="true"]') || (dialogo && (dialogo === el || dialogo.contains(el) || el.contains(dialogo)))) continue;
    const r = el.getBoundingClientRect();
    if (r.width < vw * 0.5) continue;
    if (r.top <= 2 && r.bottom < vh * 0.5) topo = Math.max(topo, r.bottom);
    if (r.bottom >= vh - 2 && r.top > vh * 0.3) base = Math.min(base, r.top);
  }
  const livre = base - topo;
  const total = campos.length;
  if (total && livre < vh * 0.5) achados.push({ t: 'teclado', sev: 3, d: `barras fixas deixam só ${Math.round(livre)}px de ${vh}px (${Math.round(livre / vh * 100)}%) para o campo com teclado`, ids: [] });
  for (const el of campos) {
    el.focus();
    el.scrollIntoView({ block: 'nearest', behavior: 'instant' }); // o navegador faria isso ao abrir o teclado
    const r = el.getBoundingClientRect();
    if (r.bottom > vh + 1 || r.top < -1) { achados.push({ t: 'teclado', sev: 3, d: `${descrever(el)} fora da janela com teclado (top ${Math.round(r.top)}, bottom ${Math.round(r.bottom)} de ${vh})`, ids: [id(el)] }); continue; }
    const topoEl = document.elementFromPoint(Math.min(Math.max((r.left + r.right) / 2, 1), vw - 1), Math.min(Math.max((r.top + r.bottom) / 2, 1), vh - 1));
    if (topoEl && topoEl !== el && !el.contains(topoEl) && !topoEl.contains(el) && topoEl.closest('label') !== el.closest('label')) {
      const fixa = ancoraFixa(topoEl);
      achados.push({ t: 'teclado', sev: 3, d: `${descrever(el)} em foco coberto por ${fixa ? 'fixo ' : ''}${descrever(fixa ?? topoEl)}`, ids: [id(el), id(fixa ?? topoEl)] });
    }
    el.blur();
  }
  return { achados, nCampos: total };
}
