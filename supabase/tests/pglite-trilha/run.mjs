// Executa a trilha de bonus (S1..S4) e os cenarios no PGlite (Postgres 17 em WASM). Nada sai da maquina.
//
// Uso, da raiz do repositorio:
//   npx -y -p @electric-sql/pglite@0.6.0 node supabase/tests/pglite-trilha/run.mjs
//
// O que faz: (1) portao negativo: sem E1 a S1 tem de parar sem criar nada; (2) stub + anonymize_account
// REAL (20260902000200) + a edicao LGPD de E1 (secao 7 de 20261123000200); (3) S1..S4; (4) cenarios.sql
// (cada bloco em transacao com ROLLBACK); (5) auditoria estrutural; (6) reaplicacao das quatro.
// Limite: o stub nao tem as RLS, FKs nem os gatilhos reais das tabelas existentes.
import { readFileSync, existsSync } from 'node:fs';
import { delimiter, dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

async function loadPglite() {
  try {
    return await import('@electric-sql/pglite');
  } catch {
    // com `npx -p`, o pacote fica no cache do npx e so o .bin entra no PATH
    for (const entry of (process.env.PATH ?? process.env.Path ?? '').split(delimiter)) {
      const candidate = join(entry, '..', '@electric-sql', 'pglite', 'dist', 'index.js');
      if (existsSync(candidate)) return import(pathToFileURL(candidate).href);
    }
    if (process.env.PGLITE_DIST) return import(pathToFileURL(process.env.PGLITE_DIST).href);
    throw new Error('PGlite nao encontrado. Rode: npx -y -p @electric-sql/pglite@0.6.0 node supabase/tests/pglite-trilha/run.mjs');
  }
}

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '..', '..', '..');
const read = (p) => readFileSync(p, 'utf8').replace(/\r\n/g, '\n');
const migration = (name) => read(join(root, 'supabase', 'migrations', `${name}.sql`));
const TRILHA = [
  '20261124000100_trilha_bonus_s1_esquema', '20261124000200_trilha_bonus_s2_motor',
  '20261124000300_trilha_bonus_s3_aceite_e_saque', '20261124000400_trilha_bonus_s4_admin',
];
const inTx = (sql) => `BEGIN;\n${sql}\nCOMMIT;`;

const { PGlite } = await loadPglite();
let failures = 0;
let passed = 0;

async function run(db, label, sql) {
  try {
    await db.exec(sql);
    passed += 1;
    console.log('ok    ', label);
    return true;
  } catch (e) {
    failures += 1;
    console.log('FALHOU', label, '->', e.message);
    if (e.where) console.log('       onde:', e.where.split('\n').slice(0, 4).join(' | '));
    if (e.position) console.log('       perto:', JSON.stringify(sql.slice(Math.max(0, e.position - 120), Number(e.position) + 60)));
    await db.exec('ROLLBACK').catch(() => {});
    return false;
  }
}

// (1) portao negativo
{
  const db = new PGlite();
  await db.exec(read(join(here, 'stub.sql')));
  await db.exec('DROP FUNCTION public.internal_company_confirmed_operator(uuid, uuid)');
  let halted = false;
  try {
    await db.exec(inTx(migration(TRILHA[0])));
  } catch (e) {
    halted = /ASSERCAO S1: dependencia de equipe-encarregados ausente/.test(e.message);
    await db.exec('ROLLBACK').catch(() => {});
  }
  const left = await db.query("SELECT count(*)::int AS n FROM pg_class WHERE relname LIKE 'bonus%'");
  if (halted && left.rows[0].n === 0) { passed += 1; console.log('ok     portao: sem E1 a S1 para e nao cria nada'); }
  else { failures += 1; console.log('FALHOU portao negativo', { halted, objetos: left.rows[0].n }); }
  await db.close();
}

const db = new PGlite();
await run(db, 'stub', read(join(here, 'stub.sql')));
await run(db, 'anonymize_account real (20260902000200)', migration('20260902000200_fix_anonymize_account_colunas_dropadas'));
const e1 = migration('20261123000200_equipe_e1_schema_aditivo');
const secao7 = e1.slice(e1.indexOf('-- 7. LGPD'), e1.indexOf('-- 7b.'));
await run(db, 'edicao LGPD de E1 sobre o corpo real', secao7.slice(secao7.indexOf('DO $mig$')));
await db.exec('INSERT INTO public.companies (id, owner_id, name) VALUES (gen_random_uuid(), gen_random_uuid(), \'Empresa semente\')');
for (const name of TRILHA) if (!(await run(db, name, inTx(migration(name))))) process.exit(1);

// (4) cenarios: o arquivo e dividido em blocos "--== nome"; o primeiro cria os utilitarios
const blocks = read(join(here, 'cenarios.sql')).split(/^--== /m);
await run(db, 'utilitarios dos cenarios', blocks[0]);
for (const block of blocks.slice(1)) {
  const nl = block.indexOf('\n');
  await run(db, block.slice(0, nl).trim(), `BEGIN;\n${block.slice(nl + 1)}\nROLLBACK;`);
}

await run(db, 'auditoria estrutural (supabase/tests/trilha_bonus_auditoria.sql)', read(join(root, 'supabase', 'tests', 'trilha_bonus_auditoria.sql')));
for (const name of TRILHA) await run(db, `reaplicar ${name}`, inTx(migration(name)));

// (7) banco separado COM os dois hardenings de applications e a sequencia real de escritas do app
{
  const h = new PGlite();
  await run(h, 'hardening: stub', read(join(here, 'stub.sql')) + read(join(here, 'stub_hardening.sql')));
  await run(h, 'hardening: anonymize_account real', migration('20260902000200_fix_anonymize_account_colunas_dropadas'));
  await run(h, 'hardening: edicao LGPD de E1', secao7.slice(secao7.indexOf('DO $mig$')));
  await h.exec("INSERT INTO public.companies (id, owner_id, name) VALUES (gen_random_uuid(), gen_random_uuid(), 'Semente')");
  for (const name of TRILHA) await run(h, 'hardening: ' + name, inTx(migration(name)));
  for (const name of ['20261125000100_applications_insert_hardening', '20261125000200_applications_update_hardening']) {
    await run(h, 'hardening: ' + name, migration(name));
  }
  await run(h, 'hardening: utilitarios', blocks[0]);
  const passos = read(join(here, 'cenario_hardening.sql')).split(/^--== /m);
  await run(h, 'hardening: tabela dos passos', passos[0]);
  for (const passo of passos.slice(1)) {
    const nl = passo.indexOf('\n');
    await run(h, 'hardening ' + passo.slice(0, nl).trim(), passo.slice(nl + 1));
  }
}

console.log('\nRESULTADO: ' + passed + ' ok, ' + failures + ' falha(s)');
process.exit(failures ? 1 : 0);
