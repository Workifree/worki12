/**
 * Unico ponto que importa o SDK em runtime. E carregado por `import()` (lib/logger.ts), entao fica
 * fora do chunk inicial. Reexporta so o que o app usa, para o tree-shaking nao arrastar o SDK todo.
 */
export { init, captureException, captureMessage, setUser, getClient } from '@sentry/react';
