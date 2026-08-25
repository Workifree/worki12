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
    // 5s (o padrao) e curto demais para esta suite: sao ~80 arquivos com jsdom + React Testing
    // Library rodando em paralelo, e sob contencao de CPU os testes estouram o limite ANTES de
    // qualquer assercao. Medido em 24/08/2026: tres execucoes seguidas deram 3, 0 e 12 falhas --
    // TODAS "Test timed out in 5000ms", com duracoes de 5 a 8 segundos. Com
    // `--no-file-parallelism`, as mesmas 936 passam.
    //
    // Suite que falha por sorteio deixa de ser lida: o time passa a re-rodar ate ficar verde, e
    // uma falha de verdade se esconde no meio do ruido. 20s da folga sem mascarar teste travado.
    testTimeout: 20000,
    hookTimeout: 20000,
    // Unit tests mockam o Supabase — não acessam DB real. Credenciais dummy evitam que
    // lib/supabase.ts lance "Missing VITE_SUPABASE_URL" na coleção (o repo/CI não expõe secrets
    // p/ o step de testes). Fonte única p/ CI e local, sem depender de env externo.
    env: {
      VITE_SUPABASE_URL: 'https://dummy.supabase.co',
      VITE_SUPABASE_ANON_KEY: 'dummy-anon-key-for-tests',
      // Fuso FIXO — sem isto, os testes de data do projeto passam por acidente no CI.
      //
      // O runner do GitHub Actions (`ubuntu-latest`, ci.yml) roda em UTC, onde o offset local é
      // zero: uma referência de 12h, 21h e 23h59 do mesmo dia produz os TRÊS resultados
      // idênticos, e uma regressão que reintroduza `toISOString().split('T')[0]` ou `getUTCDay()`
      // fica VERDE. Na máquina de quem desenvolve (BRT, offset -180min) o mesmo teste pega o bug.
      // Ou seja: o guarda existia justamente onde não era necessário e faltava onde o PR é barrado.
      //
      // America/Sao_Paulo (e não um offset qualquer) porque é o fuso do produto — todo o
      // raciocínio de "véspera", "semana corrida dom–sáb" e "data da ocorrência" é data civil
      // brasileira. O Brasil não tem horário de verão desde 2019, então o offset é estável.
      TZ: 'America/Sao_Paulo',
    },
  },
})
