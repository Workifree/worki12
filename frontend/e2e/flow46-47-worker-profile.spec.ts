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
    console.log('=== FLOW 46: Worker Public Profile Re-test ===');
    console.log('=== FLOW 47: Review Visible on Public Profile ===');

    // Login as company
    await page.goto(`${BASE}/login?type=hire`, { waitUntil: 'networkidle' });
    await page.waitForSelector('input[aria-label="Email"]', { timeout: 20000 });
    await page.fill('input[aria-label="Email"]', 'e2e.company.test@gmail.com');
    await page.fill('input[aria-label="Senha"]', 'TestCompany123!');
    await page.click('button[type="submit"]');
    await page.waitForTimeout(6000);
    console.log('Logged in as company. URL:', page.url());
    await page.screenshot({ path: 'e2e/screenshots/f46-01-company-logged-in.png' });

    // Navigate to worker public profile
    const workerUrl = `${BASE}/company/worker/d25998b0-aaac-44da-9d64-2729aee2ed9f`;
    console.log('Navigating to worker public profile:', workerUrl);
    await page.goto(workerUrl, { waitUntil: 'networkidle' });
    await page.waitForTimeout(5000);
    await page.screenshot({ path: 'e2e/screenshots/f46-02-worker-profile.png' });

    const url = page.url();
    const pageText = await page.textContent('body');
    console.log('Worker profile URL:', url);
    console.log('Page text (first 500):', pageText?.substring(0, 500));

    // Check if profile loaded
    const hasError = pageText?.includes('Perfil não encontrado') || pageText?.includes('não encontrado');
    const hasName = pageText?.includes('oliveira') || pageText?.includes('Oliveira') || pageText?.includes('Worker');

    if (hasError) {
      console.log('FLOW 46 RESULT: FAIL - "Perfil não encontrado" shown (RLS still blocking)');
    } else if (hasName || (pageText && pageText.length > 100)) {
      console.log('FLOW 46 RESULT: PASS - Worker profile loaded successfully');
    } else {
      console.log('FLOW 46 RESULT: UNCLEAR - Page loaded but content unclear');
    }

    // Flow 47: Check for reviews section
    console.log('\n=== FLOW 47: Reviews on Public Profile ===');
    const hasReviews = pageText?.includes('Avaliações') || pageText?.includes('avaliações') ||
                       pageText?.includes('Reviews') || pageText?.includes('estrelas') ||
                       pageText?.includes('★') || pageText?.includes('⭐');
    const hasRating = pageText?.includes('5,0') || pageText?.includes('5.0') ||
                      pageText?.includes('4,') || pageText?.includes('rating');

    if (hasReviews || hasRating) {
      console.log('FLOW 47 RESULT: PASS - Reviews/ratings section visible');
    } else {
      console.log('FLOW 47 RESULT: NO REVIEWS SECTION - Need to check UI more');
    }

    // Scroll down to see if reviews are below fold
    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
    await page.waitForTimeout(1000);
    await page.screenshot({ path: 'e2e/screenshots/f47-01-profile-scrolled.png' });

    if (consoleErrors.length > 0) {
      console.log('\n--- Console Errors ---');
      consoleErrors.forEach(e => console.log(e));
    } else {
      console.log('No console errors.');
    }

  } catch (err) {
    console.error('FLOW 46/47 ERROR:', err);
    await page.screenshot({ path: 'e2e/screenshots/f46-error.png' });
  } finally {
    await browser.close();
  }
}

run();
