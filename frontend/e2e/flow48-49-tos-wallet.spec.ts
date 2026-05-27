import { chromium } from 'playwright';

const BASE = 'http://localhost:5173';

async function run() {
  const browser = await chromium.launch({ headless: false, slowMo: 400 });
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const page = await context.newPage();

  const consoleErrors: string[] = [];
  page.on('console', msg => {
    if (msg.type() === 'error') consoleErrors.push(`[console.error] ${msg.text()}`);
  });
  page.on('pageerror', err => consoleErrors.push(`[PAGE_ERROR] ${err.message}`));

  try {
    console.log('=== FLOW 48: TOS Gate During Onboarding ===');
    console.log('=== FLOW 49: Wallet INSERT During Onboarding ===');

    // Login as new worker
    await page.goto(`${BASE}/login?type=work`, { waitUntil: 'networkidle' });
    await page.waitForSelector('input[aria-label="Email"]', { timeout: 20000 });
    await page.fill('input[aria-label="Email"]', 'e2e.retest.worker@gmail.com');
    await page.fill('input[aria-label="Senha"]', 'TestRetest123!');
    await page.click('button[type="submit"]');
    await page.waitForTimeout(6000);

    const afterLoginUrl = page.url();
    console.log('After login URL:', afterLoginUrl);
    await page.screenshot({ path: 'e2e/screenshots/f48-01-after-login.png' });

    // FLOW 48: Check if TOS modal appears DURING onboarding
    // It should NOT appear - the ProtectedRoute skips TOS gate on onboarding routes
    const pageText = await page.textContent('body');
    const tosModalVisible = pageText?.includes('Termos de Uso Atualizados') ||
                            pageText?.includes('Aceitar e Continuar');

    if (tosModalVisible) {
      console.log('FLOW 48 RESULT: FAIL - TOS modal appeared during onboarding');
    } else {
      console.log('FLOW 48 RESULT: PASS - No TOS modal during onboarding');
    }

    // Check if we're on onboarding page
    if (afterLoginUrl.includes('/worker/onboarding')) {
      console.log('On worker onboarding page, filling form...');
      await page.waitForSelector('text=Bem-vindo ao Worki', { timeout: 15000 });

      // Step 1: Personal Data
      await page.fill('input[aria-label="Nome completo"]', 'E2E Retest Worker');
      await page.fill('input[aria-label="CPF"]', '52998224725'); // valid CPF
      await page.fill('input[aria-label="Data de nascimento"]', '1995-05-15');
      await page.fill('input[aria-label="Celular ou WhatsApp"]', '11999998888');
      await page.fill('input[aria-label="Cidade"]', 'São Paulo');
      await page.screenshot({ path: 'e2e/screenshots/f48-02-step1.png' });
      await page.click('button[type="submit"]');
      await page.waitForTimeout(2000);

      // Step 2: Profession
      // Click on "Garçom" role
      await page.click('button:has-text("Garçom")');
      await page.waitForTimeout(300);
      await page.selectOption('select[aria-label="Tempo de experiencia"]', '1-2 anos');
      await page.fill('textarea[aria-label="Bio curta"]', 'Trabalhador dedicado e responsável');
      await page.screenshot({ path: 'e2e/screenshots/f48-03-step2.png' });
      await page.click('button[type="submit"]');
      await page.waitForTimeout(2000);

      // Step 3: Goals
      await page.click('input[aria-label="Renda Extra (Freelancer)"]');
      await page.waitForTimeout(300);
      // Click availability
      await page.click('button:has-text("Manhã")');
      await page.waitForTimeout(300);
      await page.click('button:has-text("Tarde")');
      await page.waitForTimeout(300);
      // TOS checkbox
      await page.click('#tos');
      await page.waitForTimeout(300);
      await page.screenshot({ path: 'e2e/screenshots/f48-04-step3.png' });

      // Click Finalizar
      console.log('Clicking Finalizar...');
      await page.click('button[type="submit"]');
      await page.waitForTimeout(8000);
      await page.screenshot({ path: 'e2e/screenshots/f48-05-after-submit.png' });

      const finalUrl = page.url();
      console.log('After submit URL:', finalUrl);

      // Check FLOW 48: TOS gate should appear on dashboard IF accepted_tos was not set
      // But since onboarding sets accepted_tos=true, TOS gate should NOT appear
      if (finalUrl.includes('/dashboard')) {
        console.log('Onboarding completed, reached dashboard');
        const dashText = await page.textContent('body');
        const tosOnDash = dashText?.includes('Termos de Uso Atualizados') ||
                          dashText?.includes('Aceitar e Continuar');
        if (tosOnDash) {
          console.log('FLOW 48 (post-onboarding): TOS modal appears on dashboard - expected if accepted_tos=false');
        } else {
          console.log('FLOW 48 (post-onboarding): No TOS modal on dashboard - accepted_tos=true from onboarding');
        }
      }

      // FLOW 49: Navigate to wallet
      console.log('\n=== FLOW 49: Wallet INSERT During Onboarding ===');
      await page.goto(`${BASE}/wallet`, { waitUntil: 'networkidle' });
      await page.waitForTimeout(3000);
      await page.screenshot({ path: 'e2e/screenshots/f49-01-wallet.png' });

      const walletText = await page.textContent('body');
      console.log('Wallet page text (first 300):', walletText?.substring(0, 300));

      const hasWalletError = walletText?.includes('Erro') || walletText?.includes('erro');
      const hasBalance = walletText?.includes('R$') || walletText?.includes('0,00') || walletText?.includes('Saldo');

      if (hasBalance && !hasWalletError) {
        console.log('FLOW 49 RESULT: PASS - Wallet page loaded with balance');
      } else if (hasWalletError) {
        console.log('FLOW 49 RESULT: FAIL - Wallet page shows error');
      } else {
        console.log('FLOW 49 RESULT: UNCLEAR - Check screenshot');
      }

      // Check for console errors related to wallet RLS
      const walletErrors = consoleErrors.filter(e =>
        e.includes('wallet') || e.includes('RLS') || e.includes('policy')
      );
      if (walletErrors.length > 0) {
        console.log('Wallet-related console errors:', walletErrors);
      }
    } else {
      console.log('Not on onboarding - checking if already completed');
    }

    if (consoleErrors.length > 0) {
      console.log('\n--- Console Errors ---');
      consoleErrors.forEach(e => console.log(e));
    } else {
      console.log('\nNo console errors.');
    }

  } catch (err) {
    console.error('FLOW 48/49 ERROR:', err);
    await page.screenshot({ path: 'e2e/screenshots/f48-error.png' });
  } finally {
    await browser.close();
  }
}

run();
