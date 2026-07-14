import { chromium } from 'playwright';
import path from 'path';

async function run() {
  console.log('=== Starting Playwright UI Verification ===');
  
  // Launch browser with local proxy bypassed
  const browser = await chromium.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox']
  });

  const context = await browser.newContext();
  const page = await context.newPage();

  try {
    // Navigate to local server
    console.log('Navigating to OpenLearn Next homepage...');
    await page.goto('http://127.0.0.1:9000/', { waitUntil: 'networkidle' });

    console.log('Title:', await page.title());

    // Switch to teacher tab just in case
    console.log('Clicking on teacher portal tab...');
    await page.click('button:has-text("教师与管理端")');

    // Fill credentials
    console.log('Filling login credentials...');
    await page.fill('input[placeholder*="教工账户名"]', 'admin');
    await page.fill('input[placeholder*="登录密码"]', 'admin');

    // Click sign in
    console.log('Submitting login form...');
    await page.click('button[type="submit"]');

    // Wait for the navigation sidebar to render (e.g. looking for "插件中心" or "课程管理" tab button)
    console.log('Waiting for dashboard layout to load...');
    await page.waitForSelector('text=插件中心', { timeout: 10000 });

    console.log('Login successful! Dashboard loaded.');
    
    // Take a screenshot of the dashboard page to verify
    const screenshotPath = path.resolve('scratch/dashboard.png');
    await page.screenshot({ path: screenshotPath, fullPage: true });
    console.log(`🎉 Screenshot captured successfully at ${screenshotPath}`);

  } catch (err) {
    console.error('Playwright Test Failed:', err);
    process.exit(1);
  } finally {
    await browser.close();
    console.log('=== Playwright UI Verification Completed ===');
  }
}

run();
