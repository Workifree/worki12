import { test, expect } from '@playwright/test';

test('A4-A7: Worker dashboard verify, logout, re-login x2', async ({ browser }) => {
  const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const page = await context.newPage();

  const consoleErrors: string[] = [];
  page.on('console', msg => {
    if (msg.type() === 'error') consoleErrors.push(`[${new Date().toISOString()}] ${msg.text()}`);
  });
  page.on('pageerror', err => consoleErrors.push(`PAGE ERROR: ${err.message}`));

  // ========================
  // A4: Login and verify dashboard works
  // ========================
  await page.goto('http://localhost:5173/', { waitUntil: 'networkidle' });
  await page.locator('text=QUERO TRABALHAR').first().click();
  await page.waitForTimeout(1000);

  // Login
  await page.locator('input[type="email"]').fill('geribameuacesso+worker@gmail.com');
  await page.locator('input[type="password"]').fill('WorkiTest123');
  await page.locator('button:has-text("ENTRAR")').click();
  await page.waitForTimeout(3000);

  console.log('A4 - After login URL:', page.url());

  // Since onboarding is complete, should go to /dashboard directly
  expect(page.url()).toContain('/dashboard');
  await page.screenshot({ path: 'e2e/screenshots/signup-flow/a4-01-dashboard.png', fullPage: true });

  // Click sidebar links
  // 1. Profile
  await page.locator('text=MEU PERFIL').first().click();
  await page.waitForTimeout(2000);
  await page.screenshot({ path: 'e2e/screenshots/signup-flow/a4-02-profile.png', fullPage: true });
  console.log('A4 - Profile URL:', page.url());

  // 2. Buscar Vagas (jobs)
  await page.locator('text=BUSCAR VAGAS').first().click();
  await page.waitForTimeout(2000);
  await page.screenshot({ path: 'e2e/screenshots/signup-flow/a4-03-jobs.png', fullPage: true });
  console.log('A4 - Jobs URL:', page.url());

  // 3. Back to dashboard
  await page.locator('text=INÍCIO').first().click();
  await page.waitForTimeout(1500);
  console.log('A4 - Back to dashboard URL:', page.url());

  // ========================
  // A5: Logout
  // ========================
  // Click SAIR
  const sairBtn = page.locator('text=SAIR').first();
  await expect(sairBtn).toBeVisible({ timeout: 5000 });
  await sairBtn.click();
  await page.waitForTimeout(2000);

  await page.screenshot({ path: 'e2e/screenshots/signup-flow/a5-01-after-logout.png', fullPage: true });
  console.log('A5 - After logout URL:', page.url());

  // Should be on / or /login
  const afterLogoutUrl = page.url();
  expect(afterLogoutUrl === 'http://localhost:5173/' || afterLogoutUrl.includes('/login')).toBeTruthy();

  // ========================
  // A6: Second login (MUST skip onboarding)
  // ========================
  // Navigate to worker login
  if (!page.url().includes('/login')) {
    await page.locator('text=QUERO TRABALHAR').first().click();
    await page.waitForTimeout(1000);
  }

  await page.locator('input[type="email"]').fill('geribameuacesso+worker@gmail.com');
  await page.locator('input[type="password"]').fill('WorkiTest123');
  await page.locator('button:has-text("ENTRAR")').click();
  await page.waitForTimeout(3000);

  await page.screenshot({ path: 'e2e/screenshots/signup-flow/a6-01-second-login.png', fullPage: true });
  console.log('A6 - Second login URL:', page.url());

  // MUST go to /dashboard NOT /worker/onboarding
  if (page.url().includes('/worker/onboarding')) {
    console.error('BUG: Second login went to onboarding instead of dashboard!');
  }
  expect(page.url()).toContain('/dashboard');
  console.log('A6 PASSED: Second login goes directly to dashboard');

  // Logout again
  await page.locator('text=SAIR').first().click();
  await page.waitForTimeout(2000);

  // ========================
  // A7: Third login (stability)
  // ========================
  if (!page.url().includes('/login')) {
    await page.locator('text=QUERO TRABALHAR').first().click();
    await page.waitForTimeout(1000);
  }

  await page.locator('input[type="email"]').fill('geribameuacesso+worker@gmail.com');
  await page.locator('input[type="password"]').fill('WorkiTest123');
  await page.locator('button:has-text("ENTRAR")').click();
  await page.waitForTimeout(3000);

  await page.screenshot({ path: 'e2e/screenshots/signup-flow/a7-01-third-login.png', fullPage: true });
  console.log('A7 - Third login URL:', page.url());

  // MUST go to /dashboard
  expect(page.url()).toContain('/dashboard');
  console.log('A7 PASSED: Third login stable - goes directly to dashboard');

  console.log('ALL CONSOLE ERRORS:', JSON.stringify(consoleErrors, null, 2));

  await context.close();
});
