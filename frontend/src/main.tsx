import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import * as Sentry from '@sentry/react'
import './index.css'
import App from './App.tsx'
import { initPwa } from './lib/pwa'
import { scrubDeep } from './lib/sentryScrub'

const SENTRY_DSN = import.meta.env.VITE_SENTRY_DSN

if (SENTRY_DSN) {
  Sentry.init({
    dsn: SENTRY_DSN,
    environment: import.meta.env.MODE,
    tracesSampleRate: 0.1,
    replaysSessionSampleRate: 0,
    replaysOnErrorSampleRate: 1.0,
    // O token do link de convite (/convite-equipe|gerente/<token>) nunca sai do navegador.
    beforeSend: (event) => scrubDeep(event),
    beforeSendTransaction: (event) => scrubDeep(event),
    beforeBreadcrumb: (breadcrumb) => scrubDeep(breadcrumb),
  })
}

// PWA: listeners de instalacao (cedo, o beforeinstallprompt dispara uma vez) + service worker (so em producao).
initPwa()

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
