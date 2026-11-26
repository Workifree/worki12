// Vite próprio da galeria, servindo o frontend ATUAL do repo.
// Fail-closed: `envDir` aponta para uma pasta VAZIA (nenhum .env/.env.local do repo é lido) e o
// servidor só é aceito se o módulo servido de lib/supabase.ts contiver o host falso e nada de real.
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createRequire } from 'node:module';

export const HOST_FALSO = 'galeria.invalid';
export const SUPABASE_FALSO = `https://${HOST_FALSO}`;
export const CHAVE_FALSA = 'chave-anon-falsa-da-galeria';
export const ADMIN_FALSO = 'admin@galeria.invalid';

const aqui = dirname(fileURLToPath(import.meta.url));
export const RAIZ_FRONTEND = resolve(aqui, '../../../frontend');

export async function subirVite(porta = 5180) {
  if ([5173, 9222, 9223].includes(porta)) throw new Error(`Porta ${porta} é reservada; use outra.`);

  // Nenhuma VITE_* herdada do shell sobrevive; as que o app lê são definidas aqui.
  for (const k of Object.keys(process.env)) if (k.startsWith('VITE_')) delete process.env[k];
  process.env.VITE_SUPABASE_URL = SUPABASE_FALSO;
  process.env.VITE_SUPABASE_ANON_KEY = CHAVE_FALSA;
  process.env.VITE_SENTRY_DSN = '';
  process.env.VITE_ADMIN_EMAILS = ADMIN_FALSO;
  process.env.VITE_CONTACT_EMAIL = 'contato@galeria.invalid';

  const envVazio = mkdtempSync(join(tmpdir(), 'galeria-env-'));
  const cache = mkdtempSync(join(tmpdir(), 'galeria-vite-'));
  process.chdir(RAIZ_FRONTEND); // tailwind/postcss resolvem `content` a partir do cwd

  const requireFront = createRequire(join(RAIZ_FRONTEND, 'package.json'));
  const caminhoVite = join(dirname(requireFront.resolve('vite/package.json')), 'dist/node/index.js');
  const { createServer } = await import(pathToFileURL(caminhoVite).href);

  const server = await createServer({
    root: RAIZ_FRONTEND,
    configFile: join(RAIZ_FRONTEND, 'vite.config.ts'),
    envDir: envVazio,
    cacheDir: cache,
    logLevel: 'error',
    // Sem HMR: outro agente editando o código não recarrega a página no meio da foto.
    server: { port: porta, strictPort: true, host: '127.0.0.1', hmr: false },
  });
  await server.listen();

  const base = `http://127.0.0.1:${porta}`;
  const fechar = async () => {
    await server.close();
    for (const d of [envVazio, cache]) {
      try { rmSync(d, { recursive: true, force: true }); } catch { /* Windows pode segurar o cache */ }
    }
  };

  try {
    const modulo = await (await fetch(`${base}/src/lib/supabase.ts`)).text();
    if (!modulo.includes(HOST_FALSO)) throw new Error('o host falso não está no módulo servido');
    if (/supabase\.(co|in|net)\b|eyJhbGciOi/.test(modulo)) throw new Error('há URL ou chave real no módulo servido');
  } catch (e) {
    await fechar();
    throw new Error(`ABORTADO (fail-closed): a variável falsa não venceu: ${e.message}`);
  }
  return { base, fechar };
}
