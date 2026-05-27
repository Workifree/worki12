import { chromium } from 'playwright';

const BASE = 'http://localhost:5173';

async function run() {
  const browser = await chromium.launch({ headless: false, slowMo: 400 });
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const page = await context.newPage();

  const consoleErrors: string[] = [];
  page.on('console', msg => {
    if (msg.type() === 'error') consoleErrors.push(msg.text());
  });

  try {
    console.log('=== FLOW 55: Job Deletion ===');

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
    await page.screenshot({ path: 'e2e/screenshots/f55-01-company-jobs.png' });

    // Find the "..." (kebab) button on the job card
    const dotButtons = await page.$$('button');
    let kebabFound = false;
    for (const btn of dotButtons) {
      const innerHTML = await btn.innerHTML();
      // Look for MoreVertical or similar icon, or "..." text
      if (innerHTML.includes('more-vertical') || innerHTML.includes('ellipsis') || innerHTML.includes('...')) {
        // Check visible text
        const isVisible = await btn.isVisible();
        if (isVisible) {
          console.log('Found kebab/more button');
          kebabFound = true;
          await btn.click();
          await page.waitForTimeout(1000);
          await page.screenshot({ path: 'e2e/screenshots/f55-02-menu-open.png' });

          const menuText = await page.textContent('body');
          console.log('Menu text after click:', menuText?.substring(0, 500));

          // Look for delete/excluir option
          const deleteBtn = await page.$('button:has-text("Excluir"), [role="menuitem"]:has-text("Excluir")');
          const editBtn = await page.$('button:has-text("Editar"), [role="menuitem"]:has-text("Editar"), a:has-text("Editar")');

          if (deleteBtn) {
            console.log('FLOW 55: Delete button found in menu!');
          }
          if (editBtn) {
            console.log('FLOW 55: Edit button found in menu');
          }

          break;
        }
      }
    }

    if (!kebabFound) {
      // Try clicking on the "..." text directly
      const dotsEl = await page.$('text=...');
      if (dotsEl) {
        console.log('Found "..." text element, clicking...');
        await dotsEl.click();
        await page.waitForTimeout(1000);
        await page.screenshot({ path: 'e2e/screenshots/f55-02-menu-open.png' });
      }
    }

    // Also try clicking the job card itself to navigate to detail
    const jobTitle = await page.$('text=Garcom E2E Escrow Test');
    if (jobTitle) {
      await jobTitle.click();
      await page.waitForTimeout(3000);
      console.log('Navigated to:', page.url());
      await page.screenshot({ path: 'e2e/screenshots/f55-03-job-detail.png' });

      const detailText = await page.textContent('body');

      // Look for edit/delete buttons on detail page
      const detailEditBtn = await page.$('a:has-text("Editar"), button:has-text("Editar")');
      const detailDeleteBtn = await page.$('button:has-text("Excluir"), button:has-text("Deletar")');
      const detailMenuBtn = await page.$$('button');

      console.log('Detail - Edit button:', !!detailEditBtn);
      console.log('Detail - Delete button:', !!detailDeleteBtn);

      // Check for actions menu
      if (detailText?.includes('Excluir') || detailText?.includes('excluir')) {
        console.log('FLOW 55: Delete option found on detail page');
      } else if (detailText?.includes('Editar')) {
        console.log('FLOW 55: Edit found but no Delete on detail page');
      }

      // Try all clickable elements for a dropdown
      for (const btn of detailMenuBtn) {
        const ariaLabel = await btn.getAttribute('aria-label');
        const title = await btn.getAttribute('title');
        if (ariaLabel?.toLowerCase().includes('menu') || ariaLabel?.toLowerCase().includes('more') ||
            title?.toLowerCase().includes('menu') || title?.toLowerCase().includes('more')) {
          console.log('Found menu button with label:', ariaLabel || title);
          await btn.click();
          await page.waitForTimeout(1000);
          await page.screenshot({ path: 'e2e/screenshots/f55-04-detail-menu.png' });
          break;
        }
      }
    }

    if (consoleErrors.length > 0) {
      console.log('\n--- Console Errors ---');
      consoleErrors.forEach(e => console.log(e));
    }

    // Check the CompanyJobs component for delete functionality
    console.log('\nFLOW 55 SUMMARY: Checking code for delete functionality...');

  } catch (err) {
    console.error('FLOW 55 ERROR:', err);
    await page.screenshot({ path: 'e2e/screenshots/f55-error.png' });
  } finally {
    await browser.close();
  }
}

run();
