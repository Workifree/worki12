import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  test: {
    globals: true,
    environment: 'jsdom',
    setupFiles: ['./src/test/setup.ts'],
    include: ['src/**/*.{test,spec}.{ts,tsx}'],
    css: false,
    // Unit tests mockam o Supabase — não acessam DB real. Credenciais dummy evitam que
    // lib/supabase.ts lance "Missing VITE_SUPABASE_URL" na coleção (o repo/CI não expõe secrets
    // p/ o step de testes). Fonte única p/ CI e local, sem depender de env externo.
    env: {
      VITE_SUPABASE_URL: 'https://dummy.supabase.co',
      VITE_SUPABASE_ANON_KEY: 'dummy-anon-key-for-tests',
    },
  },
})
