import { test, expect } from '@playwright/test';

test('B2: Company onboarding - all steps', async ({ browser }) => {
  const context = await browser.newContext();
  const page = await context.newPage();

  const consoleErrors: string[] = [];
  const allLogs: string[] = [];

  page.on('console', msg => {
    allLogs.push(`[${msg.type()}] ${msg.text()}`);
    if (msg.type() === 'error') consoleErrors.push(`[error] ${msg.text()}`);
  });
  page.on('pageerror', err => {
    consoleErrors.push(`[pageerror] ${err.message}`);
    allLogs.push(`[pageerror] ${err.message}`);
  });
  page.on('response', resp => {
    if (resp.status() >= 400 && !resp.url().includes('functions/v1')) {
      resp.text().then(body => {
        allLogs.push(`[API ${resp.status()}] ${resp.url().split('?')[0]} => ${body.substring(0, 200)}`);
      }).catch(() => {});
    }
  });

  // Login
  await page.goto('http://localhost:5173/login?type=hire');
  await page.waitForLoadState('networkidle');
  await page.getByLabel('Email').fill('geribameuacesso+company@gmail.com');
  await page.getByLabel('Senha').fill('WorkiTest123!');
  await page.getByRole('button', { name: /Entrar/i }).click();

  // Wait for redirect to company onboarding
  await page.waitForURL('**/company/onboarding', { timeout: 20000 });
  await page.waitForSelector('text=Primeiro Acesso', { timeout: 15000 });
  await page.waitForTimeout(500);

  console.log('=== STEP 1: Filling company data');

  // ========== STEP 1: Company Data ==========
  await page.locator('input[aria-label="Nome da empresa"]').fill('Empresa Teste E2E Ltda');
  await page.locator('input[aria-label="CNPJ"]').fill('30897405000135');
  await page.locator('select[aria-label="Tipo de empresa"]').selectOption('LIMITED');
  await page.locator('select[aria-label="Setor"]').selectOption({ index: 1 });
  await page.locator('input[aria-label="Cidade"]').fill('Sao Paulo');

  await page.screenshot({ path: 'e2e/screenshots/onboarding/b2-02-step1-filled.png', fullPage: true });
  await page.locator('button[type="submit"]').click();
  await page.waitForTimeout(1000);

  console.log('=== STEP 2: Filling goals');

  // ========== STEP 2: Goals ==========
  await page.waitForSelector('text=Objetivos de Contratação', { timeout: 5000 });
  await page.locator('input[aria-label="Freelancers Pontuais"]').check();
  await page.waitForTimeout(200);
  await page.locator('label:has(input[value="1-5"])').click();
  await page.waitForTimeout(200);
  await page.locator('#tos').check();
  await page.waitForTimeout(200);

  await page.screenshot({ path: 'e2e/screenshots/onboarding/b2-04-step2-filled.png', fullPage: true });

  // Click Finalizar
  console.log('=== Clicking Finalizar...');
  await page.locator('button[type="submit"]').click();

  // Monitor URL changes
  for (let i = 0; i < 15; i++) {
    await page.waitForTimeout(1000);
    const url = page.url();
    console.log(`=== t+${i+1}s URL: ${url}`);
    if (url.includes('/company/dashboard') && !url.includes('/onboarding')) {
      console.log('=== SUCCESS: On company dashboard!');
      break;
    }
  }

  await page.screenshot({ path: 'e2e/screenshots/onboarding/b2-05-final.png', fullPage: true });

  const finalUrl = page.url();
  console.log('=== FINAL URL:', finalUrl);
  console.log('=== ALL LOGS (last 20):');
  allLogs.slice(-20).forEach(l => console.log('  ', l));

  expect(finalUrl).toContain('/company/dashboard');

  await context.close();
});
