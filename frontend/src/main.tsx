import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'
import { initPwa } from './lib/pwa'
import { scrubDeep } from './lib/sentryScrub'
import { initMonitoring } from './lib/logger'

// Sem DSN nao faz nada; com DSN, baixa o SDK em paralelo e enfileira os erros ate ele chegar.
void initMonitoring({
  dsn: import.meta.env.VITE_SENTRY_DSN,
  environment: import.meta.env.MODE,
  tracesSampleRate: 0.1,
  replaysSessionSampleRate: 0,
  replaysOnErrorSampleRate: 1.0,
  // O token do link de convite (/convite-equipe|gerente/<token>) nunca sai do navegador.
  beforeSend: (event) => scrubDeep(event),
  beforeSendTransaction: (event) => scrubDeep(event),
  beforeBreadcrumb: (breadcrumb) => scrubDeep(breadcrumb),
})

// PWA: listeners de instalacao (cedo, o beforeinstallprompt dispara uma vez) + service worker (so em producao).
initPwa()

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
