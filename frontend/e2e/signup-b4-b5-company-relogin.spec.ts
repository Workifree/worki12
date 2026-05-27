import { test, expect } from '@playwright/test';

test('B4-B5: Company logout, re-login x2 (must skip onboarding)', async ({ browser }) => {
  const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const page = await context.newPage();

  const consoleErrors: string[] = [];
  page.on('console', msg => {
    if (msg.type() === 'error') consoleErrors.push(`[${new Date().toISOString()}] ${msg.text()}`);
  });
  page.on('pageerror', err => consoleErrors.push(`PAGE ERROR: ${err.message}`));

  // ========================
  // B4: Login → should go directly to /company/dashboard
  // ========================
  await page.goto('http://localhost:5173/', { waitUntil: 'networkidle' });
  await page.locator('text=QUERO CONTRATAR').first().click();
  await page.waitForTimeout(1000);

  await page.locator('input[type="email"]').fill('geribameuacesso+company@gmail.com');
  await page.locator('input[type="password"]').fill('WorkiTest123');
  await page.locator('button:has-text("ENTRAR")').click();
  await page.waitForTimeout(3000);

  await page.screenshot({ path: 'e2e/screenshots/signup-flow/b4-01-second-login.png', fullPage: true });
  console.log('B4 - Second login URL:', page.url());

  // MUST go to /company/dashboard NOT /company/onboarding
  if (page.url().includes('/company/onboarding')) {
    console.error('BUG: Company second login went to onboarding!');
  }
  expect(page.url()).toContain('/company/dashboard');
  console.log('B4 PASSED: Second login goes to company dashboard');

  // Click some sidebar links to verify
  await page.locator('text=PERFIL EMPRESA').first().click();
  await page.waitForTimeout(2000);
  await page.screenshot({ path: 'e2e/screenshots/signup-flow/b4-02-company-profile.png', fullPage: true });
  console.log('B4 - Company Profile URL:', page.url());

  // Logout
  await page.locator('text=SAIR').first().click();
  await page.waitForTimeout(2000);
  console.log('B4 - After logout URL:', page.url());

  // ========================
  // B5: Third login (stability)
  // ========================
  if (!page.url().includes('/login')) {
    await page.locator('text=QUERO CONTRATAR').first().click();
    await page.waitForTimeout(1000);
  }

  await page.locator('input[type="email"]').fill('geribameuacesso+company@gmail.com');
  await page.locator('input[type="password"]').fill('WorkiTest123');
  await page.locator('button:has-text("ENTRAR")').click();
  await page.waitForTimeout(3000);

  await page.screenshot({ path: 'e2e/screenshots/signup-flow/b5-01-third-login.png', fullPage: true });
  console.log('B5 - Third login URL:', page.url());

  expect(page.url()).toContain('/company/dashboard');
  console.log('B5 PASSED: Third login stable - goes directly to company dashboard');

  console.log('ALL CONSOLE ERRORS:', JSON.stringify(consoleErrors, null, 2));

  await context.close();
});
