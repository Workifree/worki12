import { chromium } from 'playwright';

const BASE = 'http://localhost:5173';

async function run() {
  const browser = await chromium.launch({ headless: false, slowMo: 300 });
  const ctx1 = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const ctx2 = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const workerPage = await ctx1.newPage();
  const companyPage = await ctx2.newPage();

  try {
    console.log('=== FLOW 52: Typing Indicator ===');

    // Login worker
    await workerPage.goto(`${BASE}/login?type=work`, { waitUntil: 'networkidle' });
    await workerPage.waitForSelector('input[aria-label="Email"]', { timeout: 20000 });
    await workerPage.fill('input[aria-label="Email"]', 'oliveira9138@gmail.com');
    await workerPage.fill('input[aria-label="Senha"]', 'Waftk321321qwe!');
    await workerPage.click('button[type="submit"]');
    await workerPage.waitForTimeout(5000);
    console.log('Worker logged in');

    // Login company
    await companyPage.goto(`${BASE}/login?type=hire`, { waitUntil: 'networkidle' });
    await companyPage.waitForSelector('input[aria-label="Email"]', { timeout: 20000 });
    await companyPage.fill('input[aria-label="Email"]', 'e2e.company.test@gmail.com');
    await companyPage.fill('input[aria-label="Senha"]', 'TestCompany123!');
    await companyPage.click('button[type="submit"]');
    await companyPage.waitForTimeout(5000);
    console.log('Company logged in');

    // Navigate to messages
    await workerPage.goto(`${BASE}/messages`, { waitUntil: 'networkidle' });
    await workerPage.waitForTimeout(3000);

    await companyPage.goto(`${BASE}/company/messages`, { waitUntil: 'networkidle' });
    await companyPage.waitForTimeout(3000);

    // Worker: click on first conversation with E2E Company Test
    const workerConvo = await workerPage.$('text=E2E Company Test');
    if (workerConvo) {
      await workerConvo.click();
      await workerPage.waitForTimeout(2000);
      console.log('Worker opened conversation with E2E Company Test');
      await workerPage.screenshot({ path: 'e2e/screenshots/f52-01-worker-convo.png' });
    }

    // Company: click on first conversation
    const companyConvo = await companyPage.$('text=pedro de oliveira');
    if (companyConvo) {
      await companyConvo.click();
      await companyPage.waitForTimeout(2000);
      console.log('Company opened conversation');
      await companyPage.screenshot({ path: 'e2e/screenshots/f52-02-company-convo.png' });
    }

    // Find message input on worker page
    const workerInput = await workerPage.$('input[placeholder*="mensagem" i], textarea[placeholder*="mensagem" i], input[placeholder*="Digite" i], textarea[placeholder*="Digite" i]');
    if (!workerInput) {
      // Try any input in the message area
      const allInputs = await workerPage.$$('input[type="text"], textarea');
      console.log('Found inputs on worker page:', allInputs.length);
      for (const inp of allInputs) {
        const placeholder = await inp.getAttribute('placeholder');
        const ariaLabel = await inp.getAttribute('aria-label');
        console.log(`  Input: placeholder="${placeholder}" aria-label="${ariaLabel}"`);
      }
    }

    if (workerInput) {
      console.log('Found message input, typing...');
      // Type slowly
      await workerInput.focus();
      await workerPage.keyboard.type('Ola, estou testando...', { delay: 150 });
      await workerPage.waitForTimeout(1000);
      await workerPage.screenshot({ path: 'e2e/screenshots/f52-03-worker-typing.png' });

      // Check company page for typing indicator
      await companyPage.waitForTimeout(3000);
      const companyBodyText = await companyPage.textContent('body');
      await companyPage.screenshot({ path: 'e2e/screenshots/f52-04-company-sees.png' });

      const hasTypingIndicator = companyBodyText?.includes('digitando') || companyBodyText?.includes('Digitando') ||
                                  companyBodyText?.includes('typing') || companyBodyText?.includes('...');

      // Also check for any animated dots or visual indicator
      const typingEl = await companyPage.$('[class*="typing"], [class*="Typing"]');

      if (hasTypingIndicator || typingEl) {
        console.log('FLOW 52 RESULT: PASS - Typing indicator visible');
      } else {
        console.log('FLOW 52 RESULT: NOT IMPLEMENTED - No typing indicator detected');
        console.log('(Checked for: "digitando", "typing", animated elements)');
      }
    } else {
      console.log('FLOW 52 RESULT: NOT TESTABLE - No message input found after opening conversation');
    }

  } catch (err) {
    console.error('FLOW 52 ERROR:', err);
  } finally {
    await ctx1.close();
    await ctx2.close();
    await browser.close();
  }
}

run();
