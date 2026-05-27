import { test, expect } from '@playwright/test';

test('B1-B2: Company signup from landing page', async ({ browser }) => {
  const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const page = await context.newPage();

  const consoleErrors: string[] = [];
  page.on('console', msg => {
    if (msg.type() === 'error') consoleErrors.push(msg.text());
  });
  page.on('pageerror', err => consoleErrors.push(`PAGE ERROR: ${err.message}`));

  // ========================
  // B1: Navigate to company signup
  // ========================
  await page.goto('http://localhost:5173/', { waitUntil: 'networkidle' });
  await page.waitForTimeout(1000);
  await page.screenshot({ path: 'e2e/screenshots/signup-flow/b1-01-landing.png', fullPage: true });

  // Click "QUERO CONTRATAR" (blue button)
  const companyBtn = page.locator('text=QUERO CONTRATAR').first();
  await expect(companyBtn).toBeVisible({ timeout: 5000 });
  await companyBtn.click();
  await page.waitForTimeout(1500);
  await page.screenshot({ path: 'e2e/screenshots/signup-flow/b1-02-company-login.png', fullPage: true });
  console.log('B1 - After click URL:', page.url());
  expect(page.url()).toContain('/login');

  // Click "Cadastre-se"
  const cadastreBtn = page.locator('text=Cadastre-se').first();
  await expect(cadastreBtn).toBeVisible({ timeout: 5000 });
  await cadastreBtn.click();
  await page.waitForTimeout(1000);
  await page.screenshot({ path: 'e2e/screenshots/signup-flow/b1-03-company-signup.png', fullPage: true });
  console.log('B1 - After Cadastre-se URL:', page.url());

  // ========================
  // B2: Fill and submit company signup
  // ========================
  const emailField = page.locator('input[type="email"]');
  await emailField.fill('geribameuacesso+company@gmail.com');
  const passwordField = page.locator('input[type="password"]');
  await passwordField.fill('WorkiTest123');
  await page.waitForTimeout(500);

  await page.screenshot({ path: 'e2e/screenshots/signup-flow/b2-01-form-filled.png', fullPage: true });

  // Click "CRIAR CONTA"
  const criarContaBtn = page.locator('button:has-text("CRIAR CONTA")');
  await expect(criarContaBtn).toBeVisible({ timeout: 3000 });
  await criarContaBtn.click();
  console.log('B2 - Clicked CRIAR CONTA');

  // Wait for signup response
  await page.waitForTimeout(5000);

  await page.screenshot({ path: 'e2e/screenshots/signup-flow/b2-02-after-signup.png', fullPage: true });
  console.log('B2 - After signup URL:', page.url());
  console.log('B2 - Console errors:', JSON.stringify(consoleErrors));

  // Should be on /company/onboarding
  expect(page.url()).toContain('/company/onboarding');
  console.log('B1-B2 PASSED: Company signup successful, on company onboarding');

  await context.close();
});
