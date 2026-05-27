import { test, expect } from '@playwright/test';

test('A3: Worker second login - must skip onboarding', async ({ browser }) => {
  const context = await browser.newContext();
  const page = await context.newPage();

  const consoleErrors: string[] = [];
  page.on('console', msg => {
    if (msg.type() === 'error') consoleErrors.push(`[error] ${msg.text()}`);
  });
  page.on('pageerror', err => {
    consoleErrors.push(`[pageerror] ${err.message}`);
  });

  // Login
  await page.goto('http://localhost:5173/login?type=work');
  await page.waitForLoadState('networkidle');
  await page.getByLabel('Email').fill('geribameuacesso+worker@gmail.com');
  await page.getByLabel('Senha').fill('WorkiTest123!');
  await page.screenshot({ path: 'e2e/screenshots/onboarding/a3-01-login.png', fullPage: true });

  await page.getByRole('button', { name: /Entrar/i }).click();

  // Should go directly to dashboard, NOT onboarding
  await page.waitForURL('**/dashboard', { timeout: 15000 });
  await page.waitForLoadState('networkidle');
  await page.waitForTimeout(3000);

  const url = page.url();
  await page.screenshot({ path: 'e2e/screenshots/onboarding/a3-02-after-login.png', fullPage: true });

  console.log('=== SECOND LOGIN URL:', url);
  console.log('=== CONSOLE ERRORS:', JSON.stringify(consoleErrors));

  // CRITICAL: Must be on dashboard, NOT onboarding
  expect(url).toContain('/dashboard');
  expect(url).not.toContain('/onboarding');

  // Verify dashboard content loaded
  const bodyText = await page.locator('body').innerText();
  expect(bodyText).toContain('WORKER');

  await context.close();
});

test('A4: Worker third login - confirm stable', async ({ browser }) => {
  const context = await browser.newContext();
  const page = await context.newPage();

  // Login
  await page.goto('http://localhost:5173/login?type=work');
  await page.waitForLoadState('networkidle');
  await page.getByLabel('Email').fill('geribameuacesso+worker@gmail.com');
  await page.getByLabel('Senha').fill('WorkiTest123!');
  await page.getByRole('button', { name: /Entrar/i }).click();

  // Should go directly to dashboard
  await page.waitForURL('**/dashboard', { timeout: 15000 });
  await page.waitForLoadState('networkidle');
  await page.waitForTimeout(3000);

  const url = page.url();
  await page.screenshot({ path: 'e2e/screenshots/onboarding/a4-01-third-login.png', fullPage: true });

  console.log('=== THIRD LOGIN URL:', url);

  expect(url).toContain('/dashboard');
  expect(url).not.toContain('/onboarding');

  // Navigate to a few pages
  await page.locator('text=BUSCAR VAGAS').click();
  await page.waitForTimeout(2000);
  await page.screenshot({ path: 'e2e/screenshots/onboarding/a4-02-jobs.png', fullPage: true });
  expect(page.url()).toContain('/jobs');

  await context.close();
});
