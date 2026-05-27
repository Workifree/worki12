import { test, expect } from '@playwright/test';

test('B3: Company second login - must skip onboarding', async ({ browser }) => {
  const context = await browser.newContext();
  const page = await context.newPage();

  const consoleErrors: string[] = [];
  page.on('console', msg => {
    if (msg.type() === 'error') consoleErrors.push(`[error] ${msg.text()}`);
  });

  // Login
  await page.goto('http://localhost:5173/login?type=hire');
  await page.waitForLoadState('networkidle');
  await page.getByLabel('Email').fill('geribameuacesso+company@gmail.com');
  await page.getByLabel('Senha').fill('WorkiTest123!');
  await page.getByRole('button', { name: /Entrar/i }).click();

  // Should go directly to company dashboard, NOT onboarding
  await page.waitForURL('**/company/dashboard', { timeout: 15000 });
  await page.waitForLoadState('networkidle');
  await page.waitForTimeout(3000);

  const url = page.url();
  await page.screenshot({ path: 'e2e/screenshots/onboarding/b3-01-after-login.png', fullPage: true });

  console.log('=== SECOND LOGIN URL:', url);
  console.log('=== CONSOLE ERRORS:', JSON.stringify(consoleErrors));

  expect(url).toContain('/company/dashboard');
  expect(url).not.toContain('/onboarding');

  await context.close();
});

test('B4: Company third login - confirm stable', async ({ browser }) => {
  const context = await browser.newContext();
  const page = await context.newPage();

  // Login
  await page.goto('http://localhost:5173/login?type=hire');
  await page.waitForLoadState('networkidle');
  await page.getByLabel('Email').fill('geribameuacesso+company@gmail.com');
  await page.getByLabel('Senha').fill('WorkiTest123!');
  await page.getByRole('button', { name: /Entrar/i }).click();

  // Should go directly to company dashboard
  await page.waitForURL('**/company/dashboard', { timeout: 15000 });
  await page.waitForLoadState('networkidle');
  await page.waitForTimeout(3000);

  const url = page.url();
  await page.screenshot({ path: 'e2e/screenshots/onboarding/b4-01-third-login.png', fullPage: true });

  console.log('=== THIRD LOGIN URL:', url);

  expect(url).toContain('/company/dashboard');
  expect(url).not.toContain('/onboarding');

  await context.close();
});
