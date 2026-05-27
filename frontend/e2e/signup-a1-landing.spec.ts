import { test, expect } from '@playwright/test';

test('A1: Landing page → navigate to worker signup', async ({ browser }) => {
  const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const page = await context.newPage();

  // Collect console errors
  const consoleErrors: string[] = [];
  page.on('console', msg => {
    if (msg.type() === 'error') consoleErrors.push(msg.text());
  });
  page.on('pageerror', err => consoleErrors.push(`PAGE ERROR: ${err.message}`));

  // Step 1: Go to landing page
  await page.goto('http://localhost:5173/', { waitUntil: 'networkidle' });
  await page.waitForTimeout(1000);
  await page.screenshot({ path: 'e2e/screenshots/signup-flow/a1-01-landing.png', fullPage: true });
  console.log('Landing page URL:', page.url());

  // Step 2: Click "QUERO TRABALHAR" (green button — hero section)
  const workerBtn = page.locator('text=QUERO TRABALHAR').first();
  await expect(workerBtn).toBeVisible({ timeout: 5000 });
  await workerBtn.click();
  await page.waitForTimeout(1500);
  await page.screenshot({ path: 'e2e/screenshots/signup-flow/a1-02-login-page.png', fullPage: true });
  console.log('After click URL:', page.url());
  expect(page.url()).toContain('/login');

  // Step 3: Click "Cadastre-se" to toggle to signup mode
  const cadastreBtn = page.locator('text=Cadastre-se').first();
  await expect(cadastreBtn).toBeVisible({ timeout: 5000 });
  await cadastreBtn.click();
  await page.waitForTimeout(1000);
  await page.screenshot({ path: 'e2e/screenshots/signup-flow/a1-03-signup-form.png', fullPage: true });
  console.log('After Cadastre-se URL:', page.url());

  // Verify signup form is visible (email + password fields + Criar Conta button)
  const emailField = page.locator('input[type="email"]');
  await expect(emailField).toBeVisible({ timeout: 3000 });
  const passwordField = page.locator('input[type="password"]');
  await expect(passwordField).toBeVisible({ timeout: 3000 });

  // Check for "Criar Conta" button
  const criarContaBtn = page.locator('button:has-text("Criar Conta")');
  await expect(criarContaBtn).toBeVisible({ timeout: 3000 });

  console.log('Console errors:', JSON.stringify(consoleErrors));
  console.log('A1 PASSED: Signup form visible with all fields');

  await context.close();
});
