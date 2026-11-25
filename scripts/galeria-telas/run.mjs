// Galeria de estados do Worki. Uso: node run.mjs [--so=onboarding,recibo] [--saida=PASTA] [--vp=390,320,1440] [--paralelo=4] [--porta=5180] [--lista]
import { mkdirSync, readFileSync, writeFileSync, existsSync, readdirSync, rmSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';
import { chromium } from 'playwright-core';
import { subirVite } from './lib/server.mjs';
import { isolarContexto } from './lib/mock.mjs';
import { medir } from './lib/auditoria.mjs';
import { gravarIndice } from './lib/indice.mjs';
import { criarMundo, AGORA } from './fixtures/world.mjs';

const aqui = dirname(fileURLToPath(import.meta.url));
const args = Object.fromEntries(process.argv.slice(2).map((a) => { const [k, ...v] = a.replace(/^--/, '').split('='); return [k, v.join('=') || true]; }));
const saida = resolve(process.cwd(), typeof args.saida === 'string' ? args.saida : join(aqui, 'saida'));

const VIEWPORTS = {
  390: { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true },
  320: { viewport: { width: 320, height: 640 }, isMobile: true, hasTouch: true },
  1440: { viewport: { width: 1440, height: 900 } },
};
const vps = String(args.vp || '390,320,1440').split(',').filter((v) => VIEWPORTS[v]);

const todos = [];
for (const arq of readdirSync(join(aqui, 'cenarios')).filter((f) => f.endsWith('.mjs')).sort()) {
  todos.push(...(await import(`./cenarios/${arq}`)).default);
}
todos.forEach((c, i) => { c.ordem = i; });
const repetidos = todos.map((c) => c.id).filter((x, i, a) => a.indexOf(x) !== i);
if (repetidos.length) throw new Error(`ids repetidos: ${repetidos}`);
const filtro = typeof args.so === 'string' ? args.so.split(',') : null;
const escolhidos = filtro ? todos.filter((c) => filtro.some((f) => c.id.includes(f) || c.grupo === f)) : todos;
if (args.lista) { escolhidos.forEach((c) => console.log(`${c.grupo.padEnd(18)} ${c.id}`)); console.log(`${escolhidos.length} cenários`); process.exit(0); }
if (!escolhidos.length) throw new Error('nenhum cenário casa com --so');

mkdirSync(saida, { recursive: true });
const relatorio = { lacunas: new Set(), chamadas: [], bloqueadas: [], vazou: [] };
const lacunasPorCenario = {};

const vite = await subirVite(Number(args.porta) || 5180);
let browser;
const encerrar = async () => { await browser?.close().catch(() => {}); await vite.fechar().catch(() => {}); };
process.on('SIGINT', () => encerrar().then(() => process.exit(130)));

const resultados = existsSync(join(saida, 'resultados.json')) && filtro ? JSON.parse(readFileSync(join(saida, 'resultados.json'), 'utf8')).cenarios : {};

try {
  // Chrome instalado, headless, perfil temporário (o launch cria e apaga). Segunda trava de rede:
  // nenhum nome fora do localhost resolve, mesmo que algo escape da interceptação.
  browser = await chromium.launch({
    channel: 'chrome', headless: true,
    args: ['--host-resolver-rules=MAP * ~NOTFOUND, EXCLUDE localhost, EXCLUDE 127.0.0.1', '--disable-background-networking', '--disable-component-update', '--disable-sync', '--no-first-run', '--proxy-server=direct://'],
  });

  /** Espera a rede do app assentar (requisições "penduradas" de propósito não contam). */
  const assentar = async (page, pendentes, max = 12000) => {
    const ini = Date.now(); let calmo = Date.now();
    while (Date.now() - ini < max) {
      if (pendentes.n > 0) calmo = Date.now();
      if (Date.now() - calmo > 600) return;
      await page.waitForTimeout(100);
    }
  };

  const alvoDe = async (page, nome) => {
    const re = nome instanceof RegExp ? nome : new RegExp(nome.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
    const ini = Date.now();
    while (Date.now() - ini < 8000) {
      const dialogo = page.locator('dialog[open],[role="dialog"],[role="alertdialog"]').last();
      const raizes = (await dialogo.count()) ? [dialogo, page] : [page];
      for (const raiz of raizes) {
        for (const papel of ['button', 'link', 'tab', 'menuitem', 'radio', 'checkbox', 'switch']) {
          const l = raiz.getByRole(papel, { name: re }).filter({ visible: true });
          if (await l.count()) return l.first();
        }
        const t = raiz.getByText(re).filter({ visible: true });
        if (await t.count()) return t.first();
      }
      await page.waitForTimeout(200);
    }
    throw new Error(`não achei "${nome}"`);
  };

  const executar = async (page, p, pendentes) => {
    if (p.clicar) {
      const alvo = await alvoDe(page, p.clicar);
      if (await alvo.isDisabled().catch(() => false)) throw new Error(`"${p.clicar}" está desabilitado`);
      await alvo.click({ timeout: 6000 });
    } else if (p.css) await page.locator(p.css).filter({ visible: true }).first().click({ timeout: 6000 });
    else if (p.preencher) await page.locator(p.preencher[0]).filter({ visible: true }).first().fill(p.preencher[1], { timeout: 6000 });
    else if (p.selecionar) await page.locator(p.selecionar[0]).filter({ visible: true }).first().selectOption(p.selecionar[1], { timeout: 6000 });
    else if (p.marcar) await page.locator(p.marcar).first().check({ timeout: 6000, force: true });
    else if (p.avaliar) await page.evaluate(p.avaliar);
    else if (p.esperar) await page.waitForTimeout(p.esperar);
    else if (p.offline) await page.context().setOffline(true);
    else if (p.falhar) Object.assign(p.mundo.falhas, p.falhar);
    await page.waitForTimeout(150);
    await assentar(page, pendentes, 6000);
  };

  const fotografar = async (cen, vp) => {
    const mundo = criarMundo(cen.papel);
    cen.prep?.(mundo);
    const rel = { lacunas: new Set(), chamadas: [], bloqueadas: relatorio.bloqueadas, vazou: relatorio.vazou };
    const context = await browser.newContext({
      ...VIEWPORTS[vp], locale: 'pt-BR', timezoneId: 'America/Sao_Paulo', reducedMotion: 'reduce', serviceWorkers: 'block',
      ...(cen.ua ? { userAgent: cen.ua } : {}),
    });
    const info = { fotos: [], console: [], falhas: [] };
    try {
      await isolarContexto(context, mundo, rel);
      await context.clock.setFixedTime(AGORA);
      const local = { ...(cen.convitePwa ? {} : { 'worki:pwa-install-dismissed-at': String(AGORA.getTime()) }), ...(cen.local || {}) };
      if (mundo.sessao) local['sb-galeria-auth-token'] = JSON.stringify({ access_token: mundo.token, refresh_token: 'refresh-falso', token_type: 'bearer', expires_in: 31536000, expires_at: mundo.expira, user: mundo.sessao });
      await context.addInitScript(([l, s]) => {
        if (sessionStorage.getItem('__galeria')) return;
        sessionStorage.setItem('__galeria', '1');
        for (const [k, v] of Object.entries(l)) localStorage.setItem(k, v);
        for (const [k, v] of Object.entries(s)) sessionStorage.setItem(k, v);
      }, [local, cen.session || {}]);
      if (cen.init) await context.addInitScript(cen.init);

      const page = await context.newPage();
      const pendentes = { n: 0 };
      const vivos = new Set();
      page.on('request', (r) => { const pendurada = Object.values(mundo.falhas).includes('pendura') && r.url().includes('galeria.invalid'); if (!pendurada && !r.url().startsWith('ws')) { vivos.add(r); pendentes.n = vivos.size; } });
      for (const ev of ['requestfinished', 'requestfailed']) page.on(ev, (r) => { vivos.delete(r); pendentes.n = vivos.size; });
      page.on('console', (m) => { if (m.type() === 'error' && !/React Router Future|Download the React DevTools/.test(m.text())) info.console.push(m.text().replace(/\s+/g, ' ').slice(0, 220)); });
      page.on('pageerror', (e) => info.console.push(`pageerror: ${e.message.slice(0, 220)}`));
      page.on('dialog', (d) => d.dismiss());

      await page.goto(vite.base + cen.rota, { waitUntil: 'domcontentloaded', timeout: 90000 });
      await page.waitForFunction(() => document.querySelector('#root')?.childElementCount > 0, null, { timeout: 60000 }).catch(() => info.falhas.push('app não montou'));
      await assentar(page, pendentes);
      for (const p of cen.passos || []) {
        try { await executar(page, { ...p, mundo }, pendentes); } catch (e) { info.falhas.push(`passo: ${e.message.split('\n')[0].slice(0, 160)}`); break; }
      }
      if (cen.espera) {
        const fonte = cen.espera.source ?? cen.espera; // texto vale como fonte de regex (aceita a|b)
        await page.waitForFunction((f) => new RegExp(f, 'i').test(document.body.innerText + ' ' + [...document.querySelectorAll('input,textarea')].map((i) => i.value).join(' ')), fonte, { timeout: 8000 }).catch(() => { info.naoConfirmado = true; });
      }
      await assentar(page, pendentes, 4000);
      await page.evaluate(() => document.fonts.ready);
      await page.waitForTimeout(cen.pausa ?? 350);

      Object.assign(info, await page.evaluate(medir, { toque: vp !== '1440' }));
      if (info.carregando && !cen.carregandoEsperado) info.falhas.push('foto com carregamento ainda na tela');
      if (info.vazia) info.falhas.push('tela em branco');
      const nome = `${cen.id}__${vp}.png`;
      // Página inteira: em vez de `fullPage` (que deixa a navegação fixa no meio da foto), a janela
      // cresce até a altura do documento. As medidas acima já foram tiradas no tamanho real.
      if (!info.temDialogo) {
        const { width, height } = VIEWPORTS[vp].viewport;
        const total = await page.evaluate(() => document.documentElement.scrollHeight);
        if (total > height + 4) { await page.setViewportSize({ width, height: Math.min(total, 14000) }); await page.waitForTimeout(150); }
      }
      await page.screenshot({ path: join(saida, nome), animations: 'disabled', timeout: 30000 });
      info.fotos.push(nome);
      if (info.temDialogo) {
        // Diálogo com rolagem própria: segunda foto com o fim dele.
        const rolou = await page.evaluate(() => {
          const d = [...document.querySelectorAll('dialog[open],[role="dialog"],[role="alertdialog"]')].at(-1);
          const alvos = [d, ...d.querySelectorAll('*'), d.parentElement].filter((e) => e && e.scrollHeight > e.clientHeight + 8 && /auto|scroll/.test(getComputedStyle(e).overflowY));
          alvos.forEach((e) => { e.scrollTop = e.scrollHeight; });
          return alvos.length > 0;
        });
        if (rolou) { const fim = `${cen.id}__${vp}-fim.png`; await page.waitForTimeout(100); await page.screenshot({ path: join(saida, fim), animations: 'disabled' }); info.fotos.push(fim); }
      } else rmSync(join(saida, `${cen.id}__${vp}-fim.png`), { force: true });
    } catch (e) {
      info.falhas.push(`runner: ${e.message.split('\n')[0].slice(0, 200)}`);
    } finally {
      await context.close().catch(() => {});
    }
    info.console = [...new Set(info.console)].slice(0, 8);
    for (const l of rel.lacunas) (lacunasPorCenario[l] ||= new Set()).add(cen.id);
    return info;
  };

  const fila = escolhidos.flatMap((c) => vps.filter((v) => !c.viewports || c.viewports.includes(v)).map((v) => [c, v]));
  console.log(`${escolhidos.length} cenários x ${vps.length} viewports = ${fila.length} fotos -> ${saida}`);
  // Aquecimento: a primeira compilação do Vite não pode estourar o tempo de um cenário.
  await fotografar({ id: '_aquecimento', papel: 'anon', rota: '/login' }, '390');
  rmSync(join(saida, '_aquecimento__390.png'), { force: true });
  let feitas = 0;
  const trabalhador = async () => {
    for (let item = fila.shift(); item; item = fila.shift()) {
      const [c, v] = item;
      const info = await fotografar(c, v);
      resultados[c.id] ||= {};
      Object.assign(resultados[c.id], { id: c.id, grupo: c.grupo, ordem: c.ordem, papel: c.papel, rota: c.rota, regra: c.regra, erroEsperado: !!c.erroEsperado });
      (resultados[c.id].viewports ||= {})[v] = info;
      if (++feitas % 30 === 0) console.log(`  ${feitas} fotos`);
    }
  };
  await Promise.all(Array.from({ length: Number(args.paralelo) || 4 }, trabalhador));

  const lacunas = Object.fromEntries(Object.entries(lacunasPorCenario).map(([k, v]) => [k, [...v]]));
  writeFileSync(join(saida, 'lacunas-de-fixture.json'), JSON.stringify(lacunas, null, 1));
  const meta = { quando: new Date().toISOString(), vazou: relatorio.vazou, bloqueadas: [...new Set(relatorio.bloqueadas)] };
  gravarIndice(saida, resultados, meta);

  const rodados = escolhidos.map((c) => resultados[c.id]);
  const ruins = rodados.filter((c) => Object.values(c.viewports).some((x) => x.naoConfirmado || x.falhas?.length));
  console.log(`\nEstados confirmados: ${rodados.length - ruins.length}/${rodados.length}`);
  for (const c of ruins) console.log(`  NÃO ${c.id}: ${[...new Set(Object.entries(c.viewports).flatMap(([k, x]) => [...(x.falhas || []), x.naoConfirmado ? 'texto esperado ausente' : null].filter(Boolean).map((f) => `${f}`)))].join('; ')}`);
  console.log(`Lacunas de fixture: ${Object.keys(lacunas).length}`);
  for (const [k, v] of Object.entries(lacunas)) console.log(`  ${k}  <- ${v.slice(0, 3).join(', ')}${v.length > 3 ? ` (+${v.length - 3})` : ''}`);
  console.log(`Requisições externas abortadas no navegador: ${meta.bloqueadas.length}${meta.bloqueadas.length ? ` (${meta.bloqueadas.slice(0, 5).join(' ')})` : ''}`);
  console.log(`Requisições externas que SAÍRAM: ${relatorio.vazou.length}`);
  console.log(`Índice: ${join(saida, 'index.html')}`);
  if (relatorio.vazou.length) process.exitCode = 2;
} finally {
  await encerrar();
}
