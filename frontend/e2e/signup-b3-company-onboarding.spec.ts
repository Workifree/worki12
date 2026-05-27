import { test, expect } from '@playwright/test';

test('B3: Complete company onboarding (2 steps)', async ({ browser }) => {
  const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const page = await context.newPage();

  const consoleErrors: string[] = [];
  page.on('console', msg => {
    if (msg.type() === 'error') consoleErrors.push(msg.text());
  });
  page.on('pageerror', err => consoleErrors.push(`PAGE ERROR: ${err.message}`));

  // Login with existing company account
  await page.goto('http://localhost:5173/', { waitUntil: 'networkidle' });
  await page.locator('text=QUERO CONTRATAR').first().click();
  await page.waitForTimeout(1000);

  // Login with company credentials
  await page.locator('input[type="email"]').fill('geribameuacesso+company@gmail.com');
  await page.locator('input[type="password"]').fill('WorkiTest123');
  await page.locator('button:has-text("ENTRAR")').click();
  await page.waitForTimeout(3000);

  console.log('After login URL:', page.url());
  await page.screenshot({ path: 'e2e/screenshots/signup-flow/b3-00-after-login.png', fullPage: true });

  // Should be on /company/onboarding
  expect(page.url()).toContain('/company/onboarding');

  // ========================
  // STEP 1: Company Data
  // ========================
  await page.waitForTimeout(500);

  // Fill company name
  const nameInput = page.locator('input[aria-label="Nome da empresa"]');
  await expect(nameInput).toBeVisible({ timeout: 5000 });
  await nameInput.fill('Teste Empresa Geriba Ltda');

  // Fill CNPJ (valid: 11222333000181)
  const cnpjInput = page.locator('input[aria-label="CNPJ"]');
  await cnpjInput.fill('11222333000181');
  await page.waitForTimeout(300);

  // Select company type: MEI
  const typeSelect = page.locator('select[aria-label="Tipo de empresa"]');
  await typeSelect.selectOption('MEI');
  await page.waitForTimeout(200);

  // Select industry/sector
  const industrySelect = page.locator('select[aria-label="Setor"]');
  await industrySelect.selectOption({ index: 1 }); // First real option
  await page.waitForTimeout(200);

  // Fill city
  const cityInput = page.locator('input[aria-label="Cidade"]');
  await cityInput.fill('Rio de Janeiro');

  await page.screenshot({ path: 'e2e/screenshots/signup-flow/b3-01-step1-filled.png', fullPage: true });
  console.log('Step 1 filled');

  // Click PROXIMO
  const nextBtn = page.locator('button[type="submit"]:has-text("Próximo")');
  await expect(nextBtn).toBeEnabled({ timeout: 3000 });
  await nextBtn.click();
  await page.waitForTimeout(1000);

  // ========================
  // STEP 2: Goals
  // ========================
  await page.screenshot({ path: 'e2e/screenshots/signup-flow/b3-02-step2.png', fullPage: true });
  console.log('Step 2 visible, URL:', page.url());

  // Select hiring goal: Freelancers Pontuais
  await page.locator('input[aria-label="Freelancers Pontuais"]').click();
  await page.waitForTimeout(200);

  // Select volume: 1-5 (input is hidden, click the visible label container)
  await page.locator('label:has(input[value="1-5"])').click();
  await page.waitForTimeout(200);

  // Accept TOS
  await page.locator('#tos').click();
  await page.waitForTimeout(200);

  await page.screenshot({ path: 'e2e/screenshots/signup-flow/b3-03-step2-filled.png', fullPage: true });
  console.log('Step 2 filled');

  // Click FINALIZAR
  const finalizarBtn = page.locator('button[type="submit"]:has-text("Finalizar")');
  await expect(finalizarBtn).toBeEnabled({ timeout: 3000 });
  await finalizarBtn.click();

  // Wait for save + redirect
  await page.waitForTimeout(5000);

  await page.screenshot({ path: 'e2e/screenshots/signup-flow/b3-04-after-onboarding.png', fullPage: true });
  console.log('After onboarding URL:', page.url());
  console.log('Console errors:', JSON.stringify(consoleErrors));

  // Should be on /company/dashboard
  expect(page.url()).toContain('/company/dashboard');
  console.log('B3 PASSED: Company onboarding complete, landed on company dashboard');

  await context.close();
});
