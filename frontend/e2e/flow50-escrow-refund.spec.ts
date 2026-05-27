import { chromium } from 'playwright';

const BASE = 'http://localhost:5173';

async function run() {
  const browser = await chromium.launch({ headless: false, slowMo: 400 });
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const page = await context.newPage();

  try {
    console.log('=== FLOW 50: Escrow Refund ===');

    // Login as company
    await page.goto(`${BASE}/login?type=hire`, { waitUntil: 'networkidle' });
    await page.waitForSelector('input[aria-label="Email"]', { timeout: 20000 });
    await page.fill('input[aria-label="Email"]', 'e2e.company.test@gmail.com');
    await page.fill('input[aria-label="Senha"]', 'TestCompany123!');
    await page.click('button[type="submit"]');
    await page.waitForTimeout(6000);

    // Go to company jobs
    await page.goto(`${BASE}/company/jobs`, { waitUntil: 'networkidle' });
    await page.waitForTimeout(3000);

    // Click kebab menu then "Ver Candidatos"
    const kebab = await page.$$('button');
    for (const btn of kebab) {
      const inner = await btn.innerHTML();
      if (inner.includes('more-vertical') || inner.includes('ellipsis')) {
        const isVisible = await btn.isVisible();
        if (isVisible) {
          await btn.click();
          await page.waitForTimeout(500);
          // Click "Ver Candidatos"
          const candidatesBtn = await page.$('button:has-text("Ver Candidatos")');
          if (candidatesBtn) {
            await candidatesBtn.click();
            await page.waitForTimeout(3000);
          }
          break;
        }
      }
    }

    console.log('After clicking Ver Candidatos:', page.url());
    await page.screenshot({ path: 'e2e/screenshots/f50-01-candidates.png' });

    const candText = await page.textContent('body');
    console.log('Candidates page text (first 600):', candText?.substring(0, 600));

    // Check for hired status and cancel/refund options
    const hasHired = candText?.includes('Contratado') || candText?.includes('contratado') ||
                     candText?.includes('Hired') || candText?.includes('hired');
    const hasApproved = candText?.includes('Aprovado') || candText?.includes('aprovado');
    const hasCancelBtn = candText?.includes('Cancelar') || candText?.includes('cancelar') ||
                         candText?.includes('Dispensar') || candText?.includes('dispensar');
    const hasRefundBtn = candText?.includes('Reembolso') || candText?.includes('Estornar');

    console.log('Has hired workers:', hasHired);
    console.log('Has approved workers:', hasApproved);
    console.log('Has cancel button:', hasCancelBtn);
    console.log('Has refund button:', hasRefundBtn);

    // Scroll down to see all content
    await page.evaluate('window.scrollTo(0, document.body.scrollHeight)');
    await page.waitForTimeout(1000);
    await page.screenshot({ path: 'e2e/screenshots/f50-02-candidates-scrolled.png' });

    // Check company wallet for escrow info
    await page.goto(`${BASE}/company/wallet`, { waitUntil: 'networkidle' });
    await page.waitForTimeout(3000);
    await page.screenshot({ path: 'e2e/screenshots/f50-03-company-wallet.png' });
    const walletText = await page.textContent('body');
    console.log('\nCompany wallet (first 500):', walletText?.substring(0, 500));

    const hasEscrow = walletText?.includes('Escrow') || walletText?.includes('escrow') ||
                      walletText?.includes('Reservado') || walletText?.includes('reservado') ||
                      walletText?.includes('Bloqueado') || walletText?.includes('bloqueado');

    console.log('Has escrow info:', hasEscrow);

    // Scroll wallet page
    await page.evaluate('window.scrollTo(0, document.body.scrollHeight)');
    await page.waitForTimeout(1000);
    await page.screenshot({ path: 'e2e/screenshots/f50-04-wallet-scrolled.png' });

    if (hasCancelBtn || hasRefundBtn) {
      console.log('\nFLOW 50 RESULT: ESCROW REFUND AVAILABLE IN UI');
    } else if (hasHired) {
      console.log('\nFLOW 50 RESULT: NOT IMPLEMENTED - Hired workers exist but no cancel/refund button');
    } else {
      console.log('\nFLOW 50 RESULT: NOT TESTABLE - No hired workers to test escrow refund');
      console.log('Note: Escrow refund requires a worker to be in "hired" status with escrow reserved');
    }

  } catch (err) {
    console.error('FLOW 50 ERROR:', err);
    await page.screenshot({ path: 'e2e/screenshots/f50-error.png' });
  } finally {
    await browser.close();
  }
}

run();
