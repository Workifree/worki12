// Automação do demo: quadros sequenciais e medição com CPU estrangulada, via DevTools Protocol.
// Uso (Node 22+, sem dependências):
//   node ferramentas.mjs paginas <pastaSaida>              -> screenshots de cada aba em 1440 e 390
//   node ferramentas.mjs quadros <pastaSaida> [idCenario]  -> 3-5 quadros por efeito em 1440 e 390
//   node ferramentas.mjs medir   [pastaSaida]              -> mede e grava o resultado em index.html (bloco REF)
// Porta própria 9351 (não usa 5173, 5190-5193, 9222-9224).
import { spawn } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const PORT = 9351;
const HERE = dirname(fileURLToPath(import.meta.url));
const PAGE = pathToFileURL(join(HERE, 'index.html')).href;
const CHROME = process.env.CHROME_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const sleep = ms => new Promise(r => setTimeout(r, ms));

async function launch() {
  const dir = mkdtempSync(join(tmpdir(), 'vfx-chrome-'));
  const NOGPU = !!process.env.VFX_NOGPU;
  const args = ['--headless=new', ...(NOGPU ? ['--disable-gpu', '--enable-unsafe-swiftshader'] : []), `--remote-debugging-port=${PORT}`, `--user-data-dir=${dir}`, '--no-first-run', '--disable-extensions', '--hide-scrollbars', '--window-size=1440,900', 'about:blank'];
  const proc = spawn(CHROME, args, { stdio: 'ignore' });
  for (let i = 0; i < 60; i++) { try { const r = await fetch(`http://127.0.0.1:${PORT}/json/version`); if (r.ok) break; } catch {} await sleep(250); }
  const list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
  const tab = list.find(t => t.type === 'page');
  const ws = new WebSocket(tab.webSocketDebuggerUrl); await new Promise(r => ws.addEventListener('open', r, { once: true }));
  let id = 0; const pend = new Map(); const handlers = [];
  ws.addEventListener('message', e => { const m = JSON.parse(e.data); if (m.id && pend.has(m.id)) { const { res, rej } = pend.get(m.id); pend.delete(m.id); m.error ? rej(new Error(m.error.message)) : res(m.result); } else handlers.forEach(h => h(m)); });
  const send = (method, params = {}) => new Promise((res, rej) => { const i = ++id; pend.set(i, { res, rej }); ws.send(JSON.stringify({ id: i, method, params })); });
  const evalJS = async (expression, awaitPromise = true) => { const r = await send('Runtime.evaluate', { expression, awaitPromise, returnByValue: true }); if (r.exceptionDetails) throw new Error(JSON.stringify(r.exceptionDetails.exception?.description || r.exceptionDetails.text)); return r.result.value; };
  const waitLoad = () => new Promise(res => { const h = m => { if (m.method === 'Page.loadEventFired') { handlers.splice(handlers.indexOf(h), 1); res(); } }; handlers.push(h); });
  await send('Page.enable'); await send('Runtime.enable'); await send('Performance.enable');
  const close = async () => { try { ws.close(); } catch {} proc.kill(); await sleep(400); try { rmSync(dir, { recursive: true, force: true }); } catch {} };
  const version = (await (await fetch(`http://127.0.0.1:${PORT}/json/version`)).json()).Browser;
  return { send, evalJS, waitLoad, close, version };
}
const VP = { desktop: { w: 1440, h: 900, dpr: 1, mobile: false }, mobile: { w: 390, h: 844, dpr: 2, mobile: true } };
async function setVP(c, vp, rate = 1) {
  await c.send('Emulation.setDeviceMetricsOverride', { width: vp.w, height: vp.h, deviceScaleFactor: vp.dpr, mobile: vp.mobile });
  await c.send('Emulation.setTouchEmulationEnabled', { enabled: vp.mobile });
  await c.send('Emulation.setCPUThrottlingRate', { rate });
}
async function nav(c, url) {
  // passa por about:blank: mudar só o hash não dispara "load" e travaria a espera
  let w = c.waitLoad(); await c.send('Page.navigate', { url: 'about:blank' }); await w;
  w = c.waitLoad(); await c.send('Page.navigate', { url }); await w; await sleep(500);
}
async function shot(c, file, clip) { const r = await c.send('Page.captureScreenshot', { format: 'png', ...(clip ? { clip: { ...clip, scale: 1 } } : {}) }); writeFileSync(file, Buffer.from(r.data, 'base64')); }

const cmd = process.argv[2], out = process.argv[3];
const c = await launch();
try {
  if (cmd === 'paginas') {
    mkdirSync(out, { recursive: true });
    for (const [name, vp] of Object.entries(VP)) {
      await setVP(c, vp);
      for (const k of ['A', 'B', 'C', 'D', 'E', 'F', 'M']) {
        await nav(c, PAGE + '#' + k); await sleep(900);
        const h = await c.evalJS('Math.ceil(document.documentElement.scrollHeight)', false);
        await c.send('Emulation.setDeviceMetricsOverride', { width: vp.w, height: Math.min(h, 2600), deviceScaleFactor: vp.dpr, mobile: vp.mobile });
        await sleep(300); await shot(c, join(out, `pagina-${k}-${name}.png`));
        await c.send('Emulation.setDeviceMetricsOverride', { width: vp.w, height: vp.h, deviceScaleFactor: vp.dpr, mobile: vp.mobile });
      }
    }
  } else if (cmd === 'quadros') {
    mkdirSync(out, { recursive: true });
    const only = process.argv[4];
    const PLAN = {
      'A-css': [60, 240, 520, 900, 1500], 'A-svg': [60, 240, 520, 900, 1500], 'A-canvas': [60, 240, 520, 900, 1500],
      'B-css': [400, 2500, 4500], 'B-canvas': [400, 2500], 'B-webgl': [400, 2500], 'B-naive': [400, 2500],
      'C-transform': [200, 560, 980, 1180, 1400], 'D-touch': [150, 420, 560, 700, 950],
      'E-bg': [300, 1100, 1900], 'E-win': [300, 1100, 1900], 'F-css': [30, 100, 180, 260, 420]
    };
    for (const [name, vp] of Object.entries(VP)) {
      await setVP(c, vp); await nav(c, PAGE + '#A');
      for (const [id, times] of Object.entries(PLAN)) {
        if (only && only !== id) continue;
        const levels = id === 'B-css' ? ['med', 'low', 'high'] : ['med'];
        for (const level of levels) {
          await c.evalJS(`__vfx.prepare(${JSON.stringify(id)}, { level: ${JSON.stringify(level)} })`, false); await sleep(250);
          await c.evalJS('__vfx.go()', false);
          for (const t of times) { await c.evalJS(`__vfx.at(${t})`, false); await sleep(120); await shot(c, join(out, `${id}${level === 'med' ? '' : '-' + level}-${name}-${String(t).padStart(4, '0')}.png`)); }
          await c.evalJS('__vfx.cleanup()', false);
        }
      }
    }
  } else if (cmd === 'medir') {
    const NOGPU = !!process.env.VFX_NOGPU;
    const conds = NOGPU ? [['d1', 'desktop', 1], ['d4', 'desktop', 4], ['m1', 'mobile', 1], ['m4', 'mobile', 4]] : [['d1', 'desktop', 1], ['d4', 'desktop', 4], ['d6', 'desktop', 6], ['m1', 'mobile', 1], ['m4', 'mobile', 4], ['m6', 'mobile', 6]];
    const rows = {}; let meta = null;
    for (const [key, vpName, rate] of conds) {
      await setVP(c, VP[vpName], rate); await nav(c, PAGE + '#M'); await sleep(500);
      if (!meta) meta = await c.evalJS('__vfx.meta()', false);
      const ids = await c.evalJS('__vfx.ids', false);
      for (const id of ids) {
        const m0 = Object.fromEntries((await c.send('Performance.getMetrics')).metrics.map(x => [x.name, x.value]));
        const r = await c.evalJS(`__vfx.measure(${JSON.stringify(id)}, 3500)`);
        const m1 = Object.fromEntries((await c.send('Performance.getMetrics')).metrics.map(x => [x.name, x.value]));
        const busy = (m1.TaskDuration - m0.TaskDuration) / (m1.Timestamp - m0.Timestamp);
        (rows[id] ??= {})[key] = { ...r, cpu: +(busy * 100).toFixed(0) };
        console.log(key, id, r.fps, 'fps p95', r.p95, 'jank', r.jank, 'cpu', (busy * 100).toFixed(0));
      }
    }
    const REF = { meta: { chrome: c.version, date: new Date().toISOString().slice(0, 10), gl: meta.gl, note: (NOGPU ? 'Chrome com --disable-gpu (SwiftShader): composição e rasterização por software, aproxima um aparelho sem GPU útil. ' : '') + 'Estrangulamento de CPU via Emulation.setCPUThrottlingRate (age na thread principal). Quadros por requestAnimationFrame; cpu = tempo de tarefa na thread principal / tempo de relógio.' }, rows };
    if (out) { mkdirSync(out, { recursive: true }); writeFileSync(join(out, NOGPU ? 'medicao-sem-gpu.json' : 'medicao.json'), JSON.stringify(REF, null, 1)); }
    const f = join(HERE, 'index.html'); const html = readFileSync(f, 'utf8');
    writeFileSync(f, NOGPU ? html.replace(/\/\*REF2\*\/[\s\S]*?\/\*END2\*\//, () => '/*REF2*/' + JSON.stringify(REF) + '/*END2*/') : html.replace(/\/\*REF\*\/[\s\S]*?\/\*END\*\//, () => '/*REF*/' + JSON.stringify(REF) + '/*END*/'));
    console.log('REF gravado em index.html');
  }
} finally { await c.close(); }
