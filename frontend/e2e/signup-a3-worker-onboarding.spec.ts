import { test, expect } from '@playwright/test';

test('A3: Complete worker onboarding (3 steps)', async ({ browser }) => {
  const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const page = await context.newPage();

  const consoleErrors: string[] = [];
  page.on('console', msg => {
    if (msg.type() === 'error') consoleErrors.push(msg.text());
  });
  page.on('pageerror', err => consoleErrors.push(`PAGE ERROR: ${err.message}`));

  // Login with existing worker account
  await page.goto('http://localhost:5173/', { waitUntil: 'networkidle' });
  await page.locator('text=QUERO TRABALHAR').first().click();
  await page.waitForTimeout(1000);

  // Login with the worker account
  const emailField = page.locator('input[type="email"]');
  await emailField.fill('geribameuacesso+worker@gmail.com');
  const passwordField = page.locator('input[type="password"]');
  await passwordField.fill('WorkiTest123');

  // Click "ENTRAR"
  const entrarBtn = page.locator('button:has-text("ENTRAR")');
  await entrarBtn.click();
  await page.waitForTimeout(3000);

  console.log('After login URL:', page.url());
  await page.screenshot({ path: 'e2e/screenshots/signup-flow/a3-00-after-login.png', fullPage: true });

  // Should be on /worker/onboarding since we haven't completed it yet
  expect(page.url()).toContain('/worker/onboarding');

  // ========================
  // STEP 1: Personal Data
  // ========================
  await page.waitForTimeout(500);

  // Fill Name
  const nameInput = page.locator('input[aria-label="Nome completo"]');
  await expect(nameInput).toBeVisible({ timeout: 5000 });
  await nameInput.fill('Teste Worker Geriba');

  // Fill CPF (valid CPF: 123.456.789-09)
  const cpfInput = page.locator('input[aria-label="CPF"]');
  await cpfInput.fill('12345678909');
  await page.waitForTimeout(300);

  // Fill Birth Date
  const birthInput = page.locator('input[aria-label="Data de nascimento"]');
  await birthInput.fill('1995-05-15');

  // Fill Phone
  const phoneInput = page.locator('input[aria-label="Celular ou WhatsApp"]');
  await phoneInput.fill('11999998888');
  await page.waitForTimeout(300);

  // Fill City
  const cityInput = page.locator('input[aria-label="Cidade"]');
  await cityInput.fill('São Paulo');

  await page.screenshot({ path: 'e2e/screenshots/signup-flow/a3-01-step1-filled.png', fullPage: true });
  console.log('Step 1 filled');

  // Click PROXIMO
  const nextBtn = page.locator('button[type="submit"]:has-text("Próximo")');
  await expect(nextBtn).toBeEnabled({ timeout: 3000 });
  await nextBtn.click();
  await page.waitForTimeout(1000);

  // ========================
  // STEP 2: Professional
  // ========================
  await page.screenshot({ path: 'e2e/screenshots/signup-flow/a3-02-step2.png', fullPage: true });
  console.log('Step 2 visible, URL:', page.url());

  // Select roles: Garçom, Atendente
  await page.locator('button:has-text("Garçom")').click();
  await page.waitForTimeout(200);
  await page.locator('button:has-text("Atendente")').click();
  await page.waitForTimeout(200);

  // Select experience
  const experienceSelect = page.locator('select[aria-label="Tempo de experiencia"]');
  await experienceSelect.selectOption('1-2 anos');
  await page.waitForTimeout(200);

  // Fill bio
  const bioInput = page.locator('textarea[aria-label="Bio curta"]');
  await bioInput.fill('Trabalhador dedicado com experiência em atendimento ao cliente.');

  await page.screenshot({ path: 'e2e/screenshots/signup-flow/a3-03-step2-filled.png', fullPage: true });
  console.log('Step 2 filled');

  // Click PROXIMO
  const nextBtn2 = page.locator('button[type="submit"]:has-text("Próximo")');
  await expect(nextBtn2).toBeEnabled({ timeout: 3000 });
  await nextBtn2.click();
  await page.waitForTimeout(1000);

  // ========================
  // STEP 3: Goals & Availability
  // ========================
  await page.screenshot({ path: 'e2e/screenshots/signup-flow/a3-04-step3.png', fullPage: true });
  console.log('Step 3 visible, URL:', page.url());

  // Select goal: Renda Extra
  await page.locator('input[aria-label="Renda Extra (Freelancer)"]').click();
  await page.waitForTimeout(200);

  // Select availability: Manhã, Tarde
  await page.locator('button:has-text("Manhã")').click();
  await page.waitForTimeout(200);
  await page.locator('button:has-text("Tarde")').click();
  await page.waitForTimeout(200);

  // Accept TOS
  await page.locator('#tos').click();
  await page.waitForTimeout(200);

  await page.screenshot({ path: 'e2e/screenshots/signup-flow/a3-05-step3-filled.png', fullPage: true });
  console.log('Step 3 filled');

  // Click FINALIZAR
  const finalizarBtn = page.locator('button[type="submit"]:has-text("Finalizar")');
  await expect(finalizarBtn).toBeEnabled({ timeout: 3000 });
  await finalizarBtn.click();

  // Wait for save + redirect
  await page.waitForTimeout(5000);

  await page.screenshot({ path: 'e2e/screenshots/signup-flow/a3-06-after-onboarding.png', fullPage: true });
  console.log('After onboarding URL:', page.url());
  console.log('Console errors:', JSON.stringify(consoleErrors));

  // Should be on /dashboard
  expect(page.url()).toContain('/dashboard');
  console.log('A3 PASSED: Onboarding complete, landed on dashboard');

  await context.close();
});
