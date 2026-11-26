// D-9: com o convite "Instale o Worki" (e o aviso de "sem internet" junto), nenhuma ação do
// conteúdo pode ficar coberta depois de rolar até o fim. `verificar` mede no navegador.
import { grupoDe } from '../lib/cenario.mjs';
import { id, AGORA } from '../fixtures/world.mjs';

const g = grupoDe('pwa-espaco');
const dispararInstalacao = { avaliar: "(() => { const e = new Event('beforeinstallprompt', { cancelable: true }); e.prompt = async () => {}; e.userChoice = Promise.resolve({ outcome: 'dismissed' }); window.dispatchEvent(e); })()" };

/** Rola tudo até o fim e confere, para cada botão/link visível, que o ponto central é ele mesmo. */
export const conferirNadaCoberto = `(async () => {
  const pilha = document.querySelector('.worki-pwa-stack');
  if (!pilha) return 'pilha PWA não apareceu';
  const roladores = [document.scrollingElement, ...document.querySelectorAll('main, main *')]
    .filter((e) => e && e.scrollHeight > e.clientHeight + 4 && (e === document.scrollingElement || /auto|scroll/.test(getComputedStyle(e).overflowY)));
  roladores.forEach((e) => { e.scrollTop = e.scrollHeight; });
  await new Promise((r) => setTimeout(r, 150));
  const topoPilha = Math.min(...[...pilha.children].filter((c) => getComputedStyle(c).display !== 'none').map((c) => c.getBoundingClientRect().top), innerHeight);
  const fundoPilha = Math.max(...[...pilha.children].filter((c) => getComputedStyle(c).display !== 'none').map((c) => c.getBoundingClientRect().bottom), 0);
  const cobertos = [];
  for (const b of document.querySelectorAll('main button, main a[href], main [role=button], main input, main textarea')) {
    const r = b.getBoundingClientRect();
    if (!r.width || !r.height || getComputedStyle(b).visibility === 'hidden') continue;
    const cx = r.left + r.width / 2, cy = r.top + r.height / 2;
    if (cy < 0 || cy > innerHeight) continue;
    const no = document.elementFromPoint(cx, cy);
    if (no && pilha.contains(no)) cobertos.push((b.innerText || b.getAttribute('aria-label') || b.tagName).trim().slice(0, 30) + '@' + Math.round(cy));
  }
  const main = document.querySelector('main');
  const fimMain = main ? Math.round(main.lastElementChild?.getBoundingClientRect().bottom ?? 0) : 0;
  window.__medidaPwa = { pwaH: getComputedStyle(document.documentElement).getPropertyValue('--worki-pwa-h'), pb: main && getComputedStyle(main).paddingBottom, topoPilha: Math.round(topoPilha), fundoPilha: Math.round(fundoPilha), alturaPilha: Math.max(0, Math.round(fundoPilha - topoPilha)), fimConteudo: fimMain, cobertos };
  console.error('MEDIDA ' + JSON.stringify(window.__medidaPwa));
  const alturaPilha = Math.max(0, Math.round(fundoPilha - topoPilha));
  if (alturaPilha > 104) return 'pilha alta: ' + alturaPilha + 'px';
  return cobertos.length ? 'coberto: ' + cobertos.slice(0, 6).join(', ') : null;
})()`;

const rotas = [
  ['empresa', '/company/jobs', 'turnos'],
  ['empresa', '/company/hoje', 'hoje'],
  ['freela', '/my-jobs', 'meus-turnos'],
  ['freela', '/profile', 'perfil'],
  ['freela', `/messages?conversation=${id(95, 1)}`, 'chat'],
];

// O convite só aparece com 20s de uso na SESSÃO e nunca na primeira tela carregada: a sessão nasce
// "antiga" (sessionStorage) e o cenário abre noutra tela e navega pelo roteador até a tela medida.
const SESSAO_ANTIGA = { 'worki:pwa-sessao-inicio': String(AGORA.getTime() - 60000) };
const navegar = (rota) => ({ avaliar: `(() => { history.pushState({}, '', ${JSON.stringify(rota)}); window.dispatchEvent(new PopStateEvent('popstate')); })()` });
const inicio = (papel) => (papel === 'empresa' ? '/company/dashboard' : '/dashboard');

const principais = rotas.flatMap(([papel, rota, nome]) => {
  const base = { convitePwa: true, session: SESSAO_ANTIGA, viewports: ['390', '320'], verificar: conferirNadaCoberto };
  const chegar = [dispararInstalacao, navegar(rota), { esperar: 800 }];
  return [
    g(`instalar-${nome}`, papel, inicio(papel), `D-9: convite de instalar visível em ${rota}`, { ...base, passos: chegar, espera: nome === 'chat' ? '.' : 'Instale o Worki' }),
    g(`instalar-offline-${nome}`, papel, inicio(papel), `D-9: instalar + sem internet em ${rota}`, { ...base, passos: [...chegar, { offline: true }], espera: 'sem internet' }),
  ];
});

// Trava de produto: na primeira tela carregada o convite NUNCA aparece, mesmo com sessão longa.
const nuncaNaPrimeira = `(() => document.querySelector('[aria-label="Instalar o Worki"]') ? 'convite apareceu na primeira tela' : null)()`;
principais.push(g('primeira-tela-sem-convite', 'empresa', '/company/jobs', 'nunca no primeiro carregamento', { convitePwa: true, session: SESSAO_ANTIGA, viewports: ['390'], passos: [dispararInstalacao, { esperar: 800 }], verificar: nuncaNaPrimeira }));

// D-10/D-11: alvos de toque dos links de licenças e do aceite no cadastro (≥ 44px de altura).
const alvo44 = (nomes) => `(() => { const ruins = []; for (const n of ${JSON.stringify(nomes)}) { const a = [...document.querySelectorAll('a')].find((x) => x.textContent.trim() === n); if (!a) { ruins.push(n + ': ausente'); continue; } const h = Math.round(Math.max(...[...a.getClientRects()].map((r) => r.height))); console.error('ALVO ' + n + ' ' + h); if (h < 44) ruins.push(n + ': ' + h + 'px'); } return ruins.length ? ruins.join(', ') : null; })()`;
const t = grupoDe('alvos-links');
export const extras = [
  t('licencas-baixar', 'anon', '/licencas', 'D-10', { viewports: ['390', '320'], espera: 'Baixar em texto', verificar: alvo44(['Baixar em texto']) }),
  t('cadastro-termos', 'anon', '/login', 'D-11', { viewports: ['390', '320'], passos: [{ clicar: /cadastre-se|criar conta/i }], espera: 'Termos de Uso', verificar: alvo44(['Termos de Uso', 'Política de Privacidade']) }),
];
export default [...principais, ...extras];
