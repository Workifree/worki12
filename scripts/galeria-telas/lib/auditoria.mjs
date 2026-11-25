// Medidas tiradas dentro da página, no momento da foto.
export function medir({ toque }) {
  const vw = document.documentElement.clientWidth;
  const visivel = (el) => {
    const r = el.getBoundingClientRect();
    if (r.width < 1 || r.height < 1) return false;
    return !el.checkVisibility || el.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true });
  };
  const descrever = (el) => {
    const t = (el.getAttribute('aria-label') || el.innerText || el.getAttribute('placeholder') || el.getAttribute('type') || '').trim().replace(/\s+/g, ' ').slice(0, 40);
    return `${el.tagName.toLowerCase()}${t ? ` "${t}"` : `.${String(el.className).split(' ').slice(0, 3).join('.')}`}`;
  };
  const contido = (el) => {
    for (let p = el.parentElement; p && p !== document.body; p = p.parentElement) {
      if (['auto', 'scroll', 'hidden', 'clip'].includes(getComputedStyle(p).overflowX) && p.getBoundingClientRect().right <= vw + 1) return true;
    }
    return false;
  };
  const dialogos = [...document.querySelectorAll('dialog[open],[role="dialog"],[role="alertdialog"]')].filter(visivel);
  const dialogo = dialogos.at(-1) ?? null;

  const sobra = Math.max(document.documentElement.scrollWidth, document.body.scrollWidth) - vw;
  const forados = [];
  for (const el of document.querySelectorAll('body *')) {
    if (el.closest('.sr-only,[aria-hidden="true"]') || !visivel(el)) continue;
    const r = el.getBoundingClientRect();
    if (r.right > vw + 1 && r.left < vw && !contido(el) && getComputedStyle(el).position !== 'fixed') forados.push(`${descrever(el)} (+${Math.round(r.right - vw)}px)`);
  }
  // Conteúdo cortado dentro do diálogo (rolagem lateral interna) também é estouro.
  const rolagemNoDialogo = dialogo ? [dialogo, ...dialogo.querySelectorAll('*')].filter((e) => e.scrollWidth > e.clientWidth + 2 && ['auto', 'scroll'].includes(getComputedStyle(e).overflowX) && ['auto', 'scroll'].includes(getComputedStyle(e).overflowY)).map(descrever) : [];

  const pequenos = [];
  if (toque) {
    const raiz = dialogo ?? document;
    for (const el of raiz.querySelectorAll('button,a[href],input:not([type=hidden]),select,textarea,summary,[role=button],[role=tab],[role=switch],[role=menuitem]')) {
      if (el.closest('.sr-only') || el.disabled) continue;
      let alvo = el;
      if (['checkbox', 'radio', 'file'].includes(el.type)) alvo = el.closest('label') || (el.id && document.querySelector(`label[for="${CSS.escape(el.id)}"]`)) || el;
      if (!visivel(alvo)) continue;
      // Link no meio de uma frase é exceção de acessibilidade (WCAG 2.5.8).
      if (el.tagName === 'A' && getComputedStyle(el).display === 'inline' && (el.parentElement?.innerText || '').trim().length > (el.innerText || '').trim().length + 10) continue;
      const r = alvo.getBoundingClientRect();
      if (r.right <= 0 || r.bottom <= 0) continue; // link de pular conteúdo, fora da tela
      if (r.width < 43.5 || r.height < 43.5) pequenos.push(`${descrever(el)} ${Math.round(r.width)}x${Math.round(r.height)}`);
    }
  }

  const corpo = document.body.innerText;
  const telasDeErro = [
    ['ErrorBoundary', /Algo deu errado|Ops! Algo/i], ['ErroDeVerificacao', /Não (foi possível|conseguimos) verificar/i],
    ['ErroDeCarga', /Tentar de novo|Tentar novamente/i], ['Overlay do Vite', /\[plugin:vite/i],
  ].filter(([, re]) => re.test(corpo)).map(([n]) => n);
  if (document.querySelector('vite-error-overlay')) telasDeErro.push('Overlay do Vite');
  const carregando = [...document.querySelectorAll('[role=status]')].some((e) => /^Carregando/i.test((e.innerText || e.getAttribute('aria-label') || '').trim()));

  return {
    sobra: sobra > 1 ? sobra : 0, forados: [...new Set(forados)].slice(0, 6), rolagemNoDialogo: rolagemNoDialogo.slice(0, 3),
    pequenos: [...new Set(pequenos)], temDialogo: !!dialogo, telasDeErro, carregando,
    vazia: corpo.trim().length < 3 && !carregando,
  };
}
