import { test, expect } from '@playwright/test';

test('B1: Company first login', async ({ browser }) => {
  const context = await browser.newContext();
  const page = await context.newPage();

  const consoleErrors: string[] = [];
  page.on('console', msg => {
    if (msg.type() === 'error') consoleErrors.push(`[error] ${msg.text()}`);
  });
  page.on('pageerror', err => {
    consoleErrors.push(`[pageerror] ${err.message}`);
  });

  // Go to login page for companies
  await page.goto('http://localhost:5173/login?type=hire');
  await page.waitForLoadState('networkidle');
  await page.screenshot({ path: 'e2e/screenshots/onboarding/b1-01-login-page.png', fullPage: true });

  // Fill login
  await page.getByLabel('Email').fill('geribameuacesso+company@gmail.com');
  await page.getByLabel('Senha').fill('WorkiTest123!');
  await page.screenshot({ path: 'e2e/screenshots/onboarding/b1-02-login-filled.png', fullPage: true });

  // Click Entrar
  await page.getByRole('button', { name: /Entrar/i }).click();

  // Wait for navigation
  await page.waitForURL(/\/(company|dashboard)/, { timeout: 15000 });
  await page.waitForTimeout(3000);

  const url = page.url();
  await page.screenshot({ path: 'e2e/screenshots/onboarding/b1-03-after-login.png', fullPage: true });

  console.log('=== FIRST LOGIN URL:', url);
  console.log('=== CONSOLE ERRORS:', JSON.stringify(consoleErrors));

  // Should be on company onboarding (since onboarding_completed is false)
  expect(url).toContain('/company/onboarding');

  await context.close();
});
