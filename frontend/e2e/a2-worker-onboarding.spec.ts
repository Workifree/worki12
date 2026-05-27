import { test, expect } from '@playwright/test';

test('A2: Worker onboarding - all 3 steps', async ({ browser }) => {
  const context = await browser.newContext();
  const page = await context.newPage();

  const consoleErrors: string[] = [];
  const networkErrors: string[] = [];

  page.on('console', msg => {
    if (msg.type() === 'error') consoleErrors.push(`[error] ${msg.text()}`);
  });
  page.on('pageerror', err => {
    consoleErrors.push(`[pageerror] ${err.message}`);
  });
  page.on('requestfailed', req => {
    networkErrors.push(`[network-fail] ${req.method()} ${req.url()} => ${req.failure()?.errorText}`);
  });

  // Intercept API responses
  page.on('response', resp => {
    if (resp.url().includes('rest/v1/workers') && resp.status() >= 400) {
      resp.text().then(body => {
        console.log(`[API ERROR] ${resp.status()} ${resp.url()} => ${body}`);
      }).catch(() => {});
    }
  });

  // Login first
  await page.goto('http://localhost:5173/login?type=work');
  await page.waitForLoadState('networkidle');
  await page.getByLabel('Email').fill('geribameuacesso+worker@gmail.com');
  await page.getByLabel('Senha').fill('WorkiTest123!');
  await page.getByRole('button', { name: /Entrar/i }).click();

  // Wait for redirect to onboarding
  await page.waitForURL('**/worker/onboarding', { timeout: 20000 });

  // Wait for the form to render
  await page.waitForSelector('text=Bem-vindo ao Worki', { timeout: 15000 });
  await page.waitForTimeout(500);
  await page.screenshot({ path: 'e2e/screenshots/onboarding/a2-01-onboarding-step1.png', fullPage: true });

  console.log('=== STEP 1: Filling personal data');

  // ========== STEP 1: Personal Data ==========
  const nameInput = page.locator('input[aria-label="Nome completo"]');
  await nameInput.waitFor({ state: 'visible', timeout: 5000 });
  await nameInput.fill('Worker Teste E2E');

  // CPF - type it character by character since it has a mask
  const cpfInput = page.locator('input[aria-label="CPF"]');
  await cpfInput.click();
  await cpfInput.fill('22834030065');

  // Birth date
  const birthInput = page.locator('input[aria-label="Data de nascimento"]');
  await birthInput.fill('1995-06-15');

  // Phone - type it since it has a mask
  const phoneInput = page.locator('input[aria-label="Celular ou WhatsApp"]');
  await phoneInput.click();
  await phoneInput.fill('21999991234');

  // City
  const cityInput = page.locator('input[aria-label="Cidade"]');
  await cityInput.fill('Rio de Janeiro');

  await page.screenshot({ path: 'e2e/screenshots/onboarding/a2-02-step1-filled.png', fullPage: true });

  // Check if Proximo button is enabled
  const nextBtn1 = page.locator('button[type="submit"]');
  const isDisabled1 = await nextBtn1.isDisabled();
  console.log('=== STEP 1 Next button disabled:', isDisabled1);

  if (isDisabled1) {
    // Debug: check form values
    const nameVal = await nameInput.inputValue();
    const cpfVal = await cpfInput.inputValue();
    const birthVal = await birthInput.inputValue();
    const phoneVal = await phoneInput.inputValue();
    const cityVal = await cityInput.inputValue();
    console.log(`DEBUG form values: name="${nameVal}" cpf="${cpfVal}" birth="${birthVal}" phone="${phoneVal}" city="${cityVal}"`);
    // CPF needs 11 digits (masked)
    const cpfDigits = cpfVal.replace(/\D/g, '');
    console.log(`DEBUG CPF digits count: ${cpfDigits.length}`);
  }

  // Click Proximo
  await nextBtn1.click();
  await page.waitForTimeout(800);
  await page.screenshot({ path: 'e2e/screenshots/onboarding/a2-03-step2-loaded.png', fullPage: true });

  console.log('=== STEP 2: Filling professional data');

  // ========== STEP 2: Professional ==========
  await page.waitForSelector('text=Profissão', { timeout: 5000 });

  // Select roles
  await page.locator('button:has-text("Garçom")').click();
  await page.waitForTimeout(200);
  await page.locator('button:has-text("Barman")').click();
  await page.waitForTimeout(200);

  // Select experience
  const expSelect = page.locator('select[aria-label="Tempo de experiencia"]');
  await expSelect.selectOption('1-2 anos');

  // Bio
  const bioInput = page.locator('textarea[aria-label="Bio curta"]');
  await bioInput.fill('Profissional dedicado com experiencia em eventos.');

  await page.screenshot({ path: 'e2e/screenshots/onboarding/a2-04-step2-filled.png', fullPage: true });

  // Click Proximo
  const nextBtn2 = page.locator('button[type="submit"]');
  const isDisabled2 = await nextBtn2.isDisabled();
  console.log('=== STEP 2 Next button disabled:', isDisabled2);

  await nextBtn2.click();
  await page.waitForTimeout(800);
  await page.screenshot({ path: 'e2e/screenshots/onboarding/a2-05-step3-loaded.png', fullPage: true });

  console.log('=== STEP 3: Filling goals & availability');

  // ========== STEP 3: Goals & Availability ==========
  await page.waitForSelector('text=Objetivos', { timeout: 5000 });

  // Select goal radio
  await page.locator('input[aria-label="Renda Extra (Freelancer)"]').check();
  await page.waitForTimeout(200);

  // Select availability
  await page.locator('button:has-text("Manhã")').click();
  await page.waitForTimeout(200);
  await page.locator('button:has-text("Tarde")').click();
  await page.waitForTimeout(200);

  // Accept TOS
  await page.locator('#tos').check();
  await page.waitForTimeout(200);

  await page.screenshot({ path: 'e2e/screenshots/onboarding/a2-06-step3-filled.png', fullPage: true });

  // Check Finalizar button
  const finishBtn = page.locator('button[type="submit"]');
  const isDisabled3 = await finishBtn.isDisabled();
  console.log('=== STEP 3 Finalizar button disabled:', isDisabled3);

  // Click Finalizar
  await finishBtn.click();

  // Wait for API response and navigation
  console.log('=== Clicked Finalizar, waiting for navigation...');

  // Wait for either dashboard or stay on page (error)
  try {
    await page.waitForURL('**/dashboard', { timeout: 15000 });
    console.log('=== SUCCESS: Navigated to dashboard!');
  } catch {
    console.log('=== STILL ON:', page.url());
    // Check for error toast
    const toastText = await page.locator('.toast-error, [role="alert"]').textContent().catch(() => 'no toast found');
    console.log('=== Toast:', toastText);
  }

  await page.waitForLoadState('networkidle');
  await page.waitForTimeout(2000);
  await page.screenshot({ path: 'e2e/screenshots/onboarding/a2-07-final.png', fullPage: true });

  const finalUrl = page.url();
  console.log('=== FINAL URL:', finalUrl);
  console.log('=== CONSOLE ERRORS:', JSON.stringify(consoleErrors));
  console.log('=== NETWORK ERRORS:', JSON.stringify(networkErrors));

  // Verify we're on dashboard
  expect(finalUrl).toContain('/dashboard');

  await context.close();
});
