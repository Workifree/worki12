import * as Sentry from '@sentry/react';

// ---------------------------------------------------------------------------
// Por que o console tambem fala em producao (achado de 25/08/2026)
//
// Ate aqui, o ramo PROD mandava tudo APENAS para o Sentry. So que `Sentry.init`
// roda dentro de `if (SENTRY_DSN)` (main.tsx) e `VITE_SENTRY_DSN` NAO esta
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

/** true quando o Sentry foi realmente inicializado (DSN presente no build). */
function sentryAtivo(): boolean {
  try {
    return !!Sentry.getClient?.();
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
      Sentry.captureException(error, { extra: { message } });
    } else if (error) {
      Sentry.captureMessage(`${message}: ${String(error)}`, 'error');
    } else {
      Sentry.captureMessage(message, 'error');
    }
  }
}

export function logWarn(message: string, detail?: unknown) {
  if (import.meta.env.DEV) {
    console.warn(message, detail);
  }
  if (import.meta.env.PROD) {
    if (!sentryAtivo()) console.warn(message, detail);
    Sentry.captureMessage(`${message}: ${String(detail || '')}`, 'warning');
  }
}
