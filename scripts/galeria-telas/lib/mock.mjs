// Supabase falso: PostgREST em memória (filtros, embeds, single, count), auth, RPC, functions,
// storage e realtime. Tudo que o app pedir ao host falso é respondido aqui; consulta sem fixture
// entra no relatório de lacunas (estado quebrado por mock incompleto não é defeito do app).
import { HOST_FALSO } from './server.mjs';

const SINGULAR = {
  jobs: 'job', companies: 'company', workers: 'worker', applications: 'application',
  shift_calls: 'call', shift_call_targets: 'target', team_lists: 'list', job_series: 'series',
  shift_payments: 'shift_payment', company_tags: 'tag', Conversation: 'conversation',
};
/** Relações cujo nome de coluna não segue `<singular>_id`. */
const FK_ESPECIAL = {
  'Conversation>applications': { campo: 'application_uuid', tipo: 'um' },
  'shift_call_targets>shift_calls': { campo: 'call_id', tipo: 'um' },
  'shift_calls>shift_call_targets': { campo: 'call_id', tipo: 'muitos' },
  'team_lists>team_list_members': { campo: 'list_id', tipo: 'muitos' },
  'jobs>job_series': { campo: 'series_id', tipo: 'um' },
};

/** Divide por vírgula respeitando parênteses. */
function dividir(s) {
  const partes = []; let nivel = 0; let atual = '';
  for (const c of s) {
    if (c === '(') nivel++;
    if (c === ')') nivel--;
    if (c === ',' && nivel === 0) { partes.push(atual); atual = ''; } else atual += c;
  }
  if (atual.trim()) partes.push(atual);
  return partes.map((p) => p.trim()).filter(Boolean);
}

export function parseSelect(sel) {
  const campos = []; const embeds = []; let estrela = false;
  for (const p of dividir((sel || '*').replace(/\s+/g, ''))) {
    const abre = p.indexOf('(');
    if (abre >= 0) {
      let cabeca = p.slice(0, abre); const dentro = p.slice(abre + 1, -1);
      let alias = null;
      if (cabeca.includes(':')) [alias, cabeca] = cabeca.split(':');
      const [tabela, ...dicas] = cabeca.split('!');
      embeds.push({ chave: alias || tabela, alias, tabela, inner: dicas.includes('inner'), sub: parseSelect(dentro) });
    } else if (p === '*') estrela = true;
    else campos.push(p.includes(':') ? p.split(':') : [p, p]);
  }
  return { campos, embeds, estrela };
}

function relacionar(db, origem, linha, embed, lacunas) {
  let { tabela } = embed;
  if (!db[tabela]) {
    // `job:job_id(...)` ou nome no singular
    const plural = Object.entries(SINGULAR).find(([, s]) => s === tabela || `${s}_id` === tabela)?.[0];
    if (plural) tabela = plural;
  }
  if (!db[tabela]) { lacunas.add(`embed sem fixture: ${origem}>${embed.tabela}`); return { linhas: [], tipo: 'um', tabela }; }
  const especial = FK_ESPECIAL[`${origem}>${tabela}`];
  if (especial) {
    return especial.tipo === 'um'
      ? { tipo: 'um', tabela, linhas: db[tabela].filter((r) => r.id === linha[especial.campo]) }
      : { tipo: 'muitos', tabela, linhas: db[tabela].filter((r) => r[especial.campo] === linha.id) };
  }
  const candidatos = [embed.alias && `${embed.alias}_id`, `${SINGULAR[tabela] ?? tabela}_id`].filter(Boolean);
  const fk = candidatos.find((c) => c in linha);
  if (fk) return { tipo: 'um', tabela, linhas: db[tabela].filter((r) => r.id === linha[fk]) };
  const volta = `${SINGULAR[origem] ?? origem}_id`;
  return { tipo: 'muitos', tabela, linhas: db[tabela].filter((r) => r[volta] === linha.id) };
}

function texto(v) { return v === null || v === undefined ? null : String(v); }

const ISO = /^\d{4}-\d{2}-\d{2}(T|$)/;
/** Datas se comparam como instante (como no Postgres), não como texto. */
function ordenaveis(v, alvo) {
  return ISO.test(v) && ISO.test(alvo) ? [Date.parse(v), Date.parse(alvo)] : [v, alvo];
}

function comparar(valor, op, alvo) {
  if (op === 'not') {
    const i = alvo.indexOf('.');
    return !comparar(valor, alvo.slice(0, i), alvo.slice(i + 1));
  }
  const v = texto(valor);
  switch (op) {
    case 'eq': return v === alvo;
    case 'neq': return v !== null && v !== alvo;
    case 'is': return alvo === 'null' ? v === null : v === alvo;
    case 'in': return alvo.replace(/^\(|\)$/g, '').split(',').map((x) => x.replace(/^"|"$/g, '')).includes(v);
    case 'gt': { if (v === null) return false; const [x, y] = ordenaveis(v, alvo); return x > y; }
    case 'gte': { if (v === null) return false; const [x, y] = ordenaveis(v, alvo); return x >= y; }
    case 'lt': { if (v === null) return false; const [x, y] = ordenaveis(v, alvo); return x < y; }
    case 'lte': { if (v === null) return false; const [x, y] = ordenaveis(v, alvo); return x <= y; }
    case 'like': case 'ilike':
      return v !== null && new RegExp(`^${alvo.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/[*%]/g, '.*')}$`, 'i').test(v);
    case 'cs': case 'ov': return true;
    default: return true;
  }
}

function condicao(linha, expr) {
  // forma usada em or(): coluna.op.valor | and(...)
  if (expr.startsWith('and(')) return dividir(expr.slice(4, -1)).every((e) => condicao(linha, e));
  const [col, op, ...resto] = expr.split('.');
  return comparar(linha[col], op, resto.join('.'));
}

const RESERVADOS = new Set(['select', 'order', 'limit', 'offset', 'on_conflict', 'columns']);

function consultar(db, tabela, url, lacunas, visivel) {
  const sel = parseSelect(url.searchParams.get('select'));
  const filtros = []; const filtrosEmbed = {};
  for (const [k, v] of url.searchParams) {
    if (RESERVADOS.has(k)) continue;
    if (/(^|\.)(or|and)$/.test(k)) {
      if (!k.includes('.')) filtros.push((l) => dividir(v.slice(1, -1))[k === 'or' ? 'some' : 'every']((e) => condicao(l, e)));
      continue;
    }
    if (/\.(order|limit|offset)$/.test(k)) continue;
    const i = v.indexOf('.'); const op = v.slice(0, i); const alvo = v.slice(i + 1);
    if (k.includes('.')) {
      const [emb, col] = k.split('.');
      (filtrosEmbed[emb] ||= []).push((l) => comparar(l[col], op, alvo));
    } else {
      if (db[tabela].length && !db[tabela].some((l) => k in l)) lacunas.add(`coluna filtrada sem fixture: ${tabela}.${k}`);
      filtros.push((l) => comparar(l[k], op, alvo));
    }
  }

  let linhas = db[tabela].filter((l) => (!visivel || visivel(l)) && filtros.every((f) => f(l)));

  const projetar = (origem, linha, s, fe) => {
    const saida = s.estrela || (!s.campos.length && !s.embeds.length) ? { ...linha } : {};
    for (const [nome, col] of s.campos) saida[nome] = linha[col] ?? null;
    for (const e of s.embeds) {
      const r = relacionar(db, origem, linha, e, lacunas);
      const filtradas = r.linhas.filter((l) => (fe?.[e.chave] ?? fe?.[e.tabela] ?? []).every((f) => f(l)));
      if (e.sub.campos.length === 1 && e.sub.campos[0][1] === 'count') { saida[e.chave] = [{ count: filtradas.length }]; continue; }
      const proj = filtradas.map((l) => projetar(r.tabela, l, e.sub, null)).filter(Boolean);
      const valor = r.tipo === 'um' ? (proj[0] ?? null) : proj;
      if (e.inner && (!valor || (Array.isArray(valor) && !valor.length))) return null;
      saida[e.chave] = valor;
    }
    return saida;
  };

  const ordem = url.searchParams.get('order');
  if (ordem) {
    const regras = ordem.split(',').map((r) => r.split('.'));
    linhas = [...linhas].sort((a, b) => {
      for (const [col, dir] of regras) {
        const x = a[col] ?? ''; const y = b[col] ?? '';
        if (x !== y) return (x > y ? 1 : -1) * (dir === 'desc' ? -1 : 1);
      }
      return 0;
    });
  }
  let projetadas = linhas.map((l) => projetar(tabela, l, sel, filtrosEmbed)).filter(Boolean);
  const total = projetadas.length;
  const off = Number(url.searchParams.get('offset') || 0);
  const lim = url.searchParams.get('limit');
  projetadas = projetadas.slice(off, lim ? off + Number(lim) : undefined);
  return { linhas: projetadas, total, filtros };
}

const cors = (origem) => ({
  'access-control-allow-origin': origem || '*',
  'access-control-allow-headers': '*',
  'access-control-allow-methods': 'GET,POST,PUT,PATCH,DELETE,HEAD,OPTIONS',
  'access-control-expose-headers': 'content-range, x-supabase-api-version',
});

/**
 * Falhas por cenário: chaves como 'rest:jobs', 'rest:*', 'rpc:get_my_companies', 'rpc:*',
 * 'auth:user', 'fn:admin-data'. Valores: 'rede' (aborta), 'erro' (500), 'pendura' (nunca responde),
 * ou { status, body }.
 */
function falhaPara(falhas, tipo, nome) {
  return falhas?.[`${tipo}:${nome}`] ?? falhas?.[`${tipo}:*`];
}

export function criarBackend(mundo, relatorio) {
  const { lacunas, chamadas } = relatorio;
  const json = (route, corpo, status = 200, extra = {}) => route.fulfill({
    status,
    headers: { ...cors(route.request().headers().origin), 'content-type': 'application/json', ...extra },
    body: corpo === undefined ? '' : JSON.stringify(corpo),
  }).catch(() => {});

  return async function responder(route) {
    const req = route.request(); const url = new URL(req.url()); const metodo = req.method();
    if (metodo === 'OPTIONS') return route.fulfill({ status: 204, headers: cors(req.headers().origin) }).catch(() => {});
    const [, servico, , ...resto] = url.pathname.split('/');
    let corpo = null;
    try { corpo = req.postDataJSON(); } catch { corpo = null; }
    const tipo = { auth: 'auth', rest: resto[0] === 'rpc' ? 'rpc' : 'rest', functions: 'fn', storage: 'storage' }[servico];
    const nome = tipo === 'rpc' ? resto[1] : resto.join('/');
    chamadas.push(`${tipo}:${nome}`);

    const falha = falhaPara(mundo.falhas, tipo, nome);
    if (falha === 'rede') return route.abort('internetdisconnected').catch(() => {});
    if (falha === 'pendura') return; // nunca responde: estado "carregando"
    if (falha === 'erro') return json(route, { message: 'erro simulado pela galeria', code: 'XX000' }, 500);
    if (falha) return json(route, falha.body, falha.status ?? 400);

    if (tipo === 'auth') {
      const u = mundo.sessao;
      const sessao = () => ({ access_token: mundo.token, refresh_token: 'refresh-falso', token_type: 'bearer', expires_in: 31536000, expires_at: mundo.expira, user: u ?? mundo.usuarioNovo });
      if (mundo.auth?.[nome]) { const r = mundo.auth[nome](corpo, mundo); return json(route, r.body, r.status ?? 200); }
      if (nome === 'user') return u ? json(route, u) : json(route, { code: 'session_not_found', message: 'sem sessão' }, 401);
      if (nome === 'token' || nome === 'verify') return json(route, sessao());
      if (nome === 'signup') return json(route, { ...mundo.usuarioNovo, identities: [{ id: '1' }] });
      if (nome === 'logout') return route.fulfill({ status: 204, headers: cors(req.headers().origin) }).catch(() => {});
      if (nome === 'otp' || nome === 'recover' || nome === 'resend') return json(route, {});
      lacunas.add(`auth sem fixture: ${nome}`); return json(route, {});
    }

    if (tipo === 'rpc') {
      if (nome in mundo.rpc) {
        const r = mundo.rpc[nome];
        return json(route, typeof r === 'function' ? r(corpo ?? {}, mundo) : r);
      }
      lacunas.add(`rpc sem fixture: ${nome}`);
      return json(route, null);
    }

    if (tipo === 'fn') {
      const chave = corpo?.action ? `${nome}:${corpo.action}` : nome;
      if (chave in mundo.fn) { const r = mundo.fn[chave]; return json(route, typeof r === 'function' ? r(corpo, mundo) : r); }
      lacunas.add(`function sem fixture: ${chave}`); return json(route, {});
    }

    if (tipo === 'storage') return json(route, { Key: 'falso' });

    if (tipo === 'rest') {
      const tabela = nome;
      if (!mundo.db[tabela]) { lacunas.add(`tabela sem fixture: ${tabela}`); mundo.db[tabela] = []; }
      const unico = (req.headers().accept || '').includes('vnd.pgrst.object');
      const prefer = req.headers().prefer || '';
      let linhas; let total;
      if (metodo === 'GET' || metodo === 'HEAD') {
        ({ linhas, total } = consultar(mundo.db, tabela, url, lacunas, mundo.rls?.[tabela]));
      } else if (metodo === 'POST') {
        linhas = [].concat(corpo ?? {}).map((l, i) => ({ id: l.id ?? `novo-${tabela}-${mundo.db[tabela].length + i}`, created_at: mundo.agora, ...(tabela === 'shift_payments' ? { status: 'recorded' } : {}), ...l }));
        mundo.db[tabela].push(...linhas); total = linhas.length;
      } else {
        const semSelect = new URL(url); semSelect.searchParams.set('select', '*');
        const alvo = consultar(mundo.db, tabela, semSelect, lacunas).linhas.map((l) => l.id);
        const afetadas = mundo.db[tabela].filter((l) => alvo.includes(l.id));
        if (metodo === 'PATCH') afetadas.forEach((l) => Object.assign(l, corpo));
        if (metodo === 'DELETE') mundo.db[tabela] = mundo.db[tabela].filter((l) => !alvo.includes(l.id));
        linhas = afetadas; total = linhas.length;
      }
      const faixa = { 'content-range': `${total ? `0-${Math.max(linhas.length - 1, 0)}` : '*'}/${/count=/.test(prefer) ? total : '*'}` };
      if (metodo === 'HEAD') return route.fulfill({ status: 200, headers: { ...cors(req.headers().origin), ...faixa } }).catch(() => {});
      if (unico) {
        if (linhas.length !== 1) return json(route, { code: 'PGRST116', message: 'JSON object requested, multiple (or no) rows returned', details: `The result contains ${linhas.length} rows` }, 406);
        return json(route, linhas[0], 200, faixa);
      }
      return json(route, linhas, metodo === 'POST' ? 201 : 200, faixa);
    }

    lacunas.add(`caminho sem fixture: ${url.pathname}`);
    return json(route, {});
  };
}

/**
 * Instala a interceptação no contexto. Só localhost passa; o host falso é respondido aqui; todo o
 * resto é abortado e registrado. `relatorio.vazou` mede, pelo IP real de cada resposta, se alguma
 * requisição saiu da máquina (deve ficar vazio).
 */
export async function isolarContexto(context, mundo, relatorio) {
  const responder = criarBackend(mundo, relatorio);
  await context.route('**/*', async (route) => {
    const url = new URL(route.request().url());
    if (url.protocol === 'data:' || url.protocol === 'blob:') return route.continue();
    if (['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname)) {
      const sub = mundo.modulos && Object.entries(mundo.modulos).find(([trecho]) => url.pathname.endsWith(trecho));
      if (sub) return route.fulfill({ status: 200, contentType: 'application/javascript', body: sub[1] });
      return route.continue().catch(() => {});
    }
    if (url.hostname === HOST_FALSO) {
      try { return await responder(route); } catch (e) {
        relatorio.lacunas.add(`erro no mock em ${url.pathname}: ${e.message}`);
        return route.abort().catch(() => {});
      }
    }
    relatorio.bloqueadas.push(url.href.slice(0, 200));
    return route.abort('blockedbyclient').catch(() => {});
  });
  // Realtime: socket do host falso fica mudo; só o localhost conecta de verdade.
  await context.routeWebSocket(/.*/, (ws) => {
    const h = new URL(ws.url()).hostname;
    if (h === '127.0.0.1' || h === 'localhost') ws.connectToServer();
    else if (h !== HOST_FALSO) { relatorio.bloqueadas.push(ws.url().slice(0, 200)); ws.close(); }
  });
  context.on('response', async (res) => {
    try {
      const ip = (await res.serverAddr())?.ipAddress;
      if (ip && !['127.0.0.1', '::1', '[::1]'].includes(ip)) relatorio.vazou.push(`${res.url()} (${ip})`);
    } catch { /* contexto já fechado */ }
  });
}
