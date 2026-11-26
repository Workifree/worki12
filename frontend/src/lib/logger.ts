import type { BrowserOptions } from '@sentry/react';

// ---------------------------------------------------------------------------
// Por que o console tambem fala em producao (achado de 25/08/2026)
//
// Ate aqui, o ramo PROD mandava tudo APENAS para o Sentry. So que `Sentry.init`
// so roda com DSN (initMonitoring, abaixo) e `VITE_SENTRY_DSN` NAO esta
// definido no build da Vercel -- conferido no bundle servido: zero referencia a
// host do Sentry, nenhum DSN embutido. Ou seja, `captureException` era um no-op.
//
// Resultado: as 330 chamadas de `logError` do app descartavam todo erro em
// silencio. Nada no console (o ramo PROD nao logava), nada no Sentry (desligado).
// Foi o que me fez ler "console limpo" varias vezes enquanto uma requisicao
// devolvia 400.
//
// Enquanto o DSN nao existir, o console e a UNICA superficie de diagnostico que
// sobra -- e num piloto, poder pedir "abre o console e me manda o print" vale
// mais do que console limpo. Quando o DSN for configurado, o Sentry volta a ser o
// canal principal e este log vira redundancia barata; nao remova sem confirmar
// que o Sentry esta mesmo recebendo.
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Sentry sob demanda: o SDK fica fora do chunk inicial e so e baixado quando ha DSN.
// Enquanto ele nao chega, o que seria enviado (inclusive window.onerror e
// unhandledrejection) entra numa fila, repassada em ordem depois do `init` -- logo
// passando pelo mesmo `beforeSend`, que mascara os tokens de convite.
// ---------------------------------------------------------------------------

type SentryClient = typeof import('./sentryClient');
type CaptureContext = { extra?: Record<string, unknown> };

/** Teto da fila: ficam os PRIMEIROS eventos, que costumam ser a causa dos demais. */
const MAX_FILA = 50;

let sdk: SentryClient | null = null;
let carregando = false;
let fila: Array<(client: SentryClient) => void> = [];

function despachar(acao: (client: SentryClient) => void) {
  if (sdk) acao(sdk);
  else if (carregando && fila.length < MAX_FILA) fila.push(acao);
  // sem DSN (ou SDK que nao carregou): nao ha para onde mandar
}

export function captureException(error: unknown, context?: CaptureContext) {
  despachar((client) => client.captureException(error, context));
}

export function captureMessage(message: string, level: 'warning' | 'error') {
  despachar((client) => client.captureMessage(message, level));
}

export function setMonitoringUser(user: { id: string } | null) {
  despachar((client) => client.setUser(user));
}

/**
 * Liga o monitoramento. Sem `dsn` nao faz nada (nem baixa o SDK).
 * `load` so e trocado em teste.
 */
export async function initMonitoring(
  options: BrowserOptions,
  load: () => Promise<SentryClient> = () => import('./sentryClient'),
): Promise<void> {
  if (!options.dsn || sdk || carregando) return;
  carregando = true;

  // Fazem o papel dos handlers globais do SDK ate ele assumir.
  const onError = (event: ErrorEvent) => captureException(event.error ?? event.message);
  const onRejection = (event: PromiseRejectionEvent) => captureException(event.reason);
  window.addEventListener('error', onError);
  window.addEventListener('unhandledrejection', onRejection);
  const soltarHandlers = () => {
    window.removeEventListener('error', onError);
    window.removeEventListener('unhandledrejection', onRejection);
  };

  try {
    const client = await load();
    // Tudo sincrono daqui em diante: sem intervalo (erro perdido) nem sobreposicao (erro em dobro).
    client.init(options);
    soltarHandlers();
    sdk = client;
    const pendentes = fila;
    fila = [];
    pendentes.forEach((acao) => acao(client));
  } catch (error) {
    soltarHandlers();
    console.error(`Sentry nao carregou; ${fila.length} evento(s) nao enviados.`, error);
    fila = [];
  } finally {
    carregando = false;
  }
}

/** true quando o Sentry foi realmente inicializado (DSN presente e SDK carregado). */
function sentryAtivo(): boolean {
  try {
    return !!sdk?.getClient?.();
  } catch {
    return false;
  }
}

export function logError(message: string, error?: unknown) {
  if (import.meta.env.DEV) {
    console.error(message, error);
  }
  if (import.meta.env.PROD) {
    if (!sentryAtivo()) console.error(message, error);
    if (error instanceof Error) {
      captureException(error, { extra: { message } });
    } else if (error) {
      captureMessage(`${message}: ${String(error)}`, 'error');
    } else {
      captureMessage(message, 'error');
    }
  }
}

export function logWarn(message: string, detail?: unknown) {
  if (import.meta.env.DEV) {
    console.warn(message, detail);
  }
  if (import.meta.env.PROD) {
    if (!sentryAtivo()) console.warn(message, detail);
    captureMessage(`${message}: ${String(detail || '')}`, 'warning');
  }
}
