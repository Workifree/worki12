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
    console.log('=== FLOW 45: Company Onboarding Re-test ===');
    console.log('User already has onboarding_completed=true from previous run');

    // Login
    await page.goto(`${BASE}/login?type=hire`, { waitUntil: 'networkidle' });
    await page.waitForSelector('input[aria-label="Email"]', { timeout: 20000 });
    await page.fill('input[aria-label="Email"]', 'e2e.retest3.company@gmail.com');
    await page.fill('input[aria-label="Senha"]', 'TestRetest123!');
    await page.click('button[type="submit"]');

    // Should go straight to dashboard
    await page.waitForTimeout(8000);

    const finalUrl = page.url();
    console.log('Final URL:', finalUrl);
    await page.screenshot({ path: 'e2e/screenshots/f45-07-dashboard-check.png' });

    if (finalUrl.includes('/company/dashboard')) {
      console.log('RESULT: PASS - User with completed onboarding goes to dashboard');
    } else if (finalUrl.includes('/company/onboarding')) {
      console.log('RESULT: PARTIAL - Redirected to onboarding even though completed');
    } else {
      console.log('RESULT: FAIL - Unexpected URL:', finalUrl);
    }

    if (consoleErrors.length > 0) {
      console.log('\n--- Console Errors ---');
      consoleErrors.forEach(e => console.log(e));
    }

  } catch (err) {
    console.error('ERROR:', err);
  } finally {
    await browser.close();
  }
}

run();
