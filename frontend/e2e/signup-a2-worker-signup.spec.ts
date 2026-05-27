import { test, expect } from '@playwright/test';

test('A2: Fill and submit worker signup', async ({ browser }) => {
  const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const page = await context.newPage();

  // Collect console errors
  const consoleErrors: string[] = [];
  page.on('console', msg => {
    if (msg.type() === 'error') consoleErrors.push(msg.text());
  });
  page.on('pageerror', err => consoleErrors.push(`PAGE ERROR: ${err.message}`));

  // Navigate to landing, click worker button, then Cadastre-se
  await page.goto('http://localhost:5173/', { waitUntil: 'networkidle' });
  await page.locator('text=QUERO TRABALHAR').first().click();
  await page.waitForTimeout(1000);
  await page.locator('text=Cadastre-se').first().click();
  await page.waitForTimeout(1000);

  // Fill email
  const emailField = page.locator('input[type="email"]');
  await emailField.fill('geribameuacesso+worker@gmail.com');
  await page.waitForTimeout(300);

  // Fill password
  const passwordField = page.locator('input[type="password"]');
  await passwordField.fill('WorkiTest123');
  await page.waitForTimeout(500);

  // Screenshot: form filled
  await page.screenshot({ path: 'e2e/screenshots/signup-flow/a2-01-form-filled.png', fullPage: true });
  console.log('Form filled screenshot taken');

  // Click "Criar Conta"
  const criarContaBtn = page.locator('button:has-text("CRIAR CONTA")');
  await expect(criarContaBtn).toBeVisible({ timeout: 3000 });
  await criarContaBtn.click();
  console.log('Clicked CRIAR CONTA');

  // Wait for response
  await page.waitForTimeout(5000);

  // Screenshot: where did we land?
  await page.screenshot({ path: 'e2e/screenshots/signup-flow/a2-02-after-signup.png', fullPage: true });
  console.log('After signup URL:', page.url());
  console.log('Console errors:', JSON.stringify(consoleErrors));

  // Check what page we're on
  const currentUrl = page.url();
  console.log('FINAL URL:', currentUrl);

  // Take page content for debug
  const bodyText = await page.locator('body').textContent();
  console.log('Page text (first 500):', bodyText?.substring(0, 500));

  await context.close();
});
