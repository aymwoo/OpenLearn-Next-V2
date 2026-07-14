import { test, expect } from '@playwright/test';
import path from 'path';

test('Verify teacher login and dashboard screenshot', async ({ page }) => {
  console.log('Navigating to local OpenLearn Next app...');
  await page.goto('http://127.0.0.1:9000/', { waitUntil: 'networkidle' });

  console.log('Page title:', await page.title());

  console.log('Clicking on teacher tab...');
  await page.click('button:has-text("教师与管理端")');

  console.log('Filling username and password...');
  await page.fill('input[placeholder*="教工账户名"]', 'admin');
  await page.fill('input[placeholder*="登录密码"]', 'admin');

  console.log('Submitting login...');
  await Promise.all([
    page.waitForNavigation({ waitUntil: 'networkidle' }),
    page.click('button[type="submit"]')
  ]);

  console.log('Login completed. Current URL:', page.url());

  // Wait for page load and elements to settle
  await page.waitForTimeout(2000);

  // Take screenshot
  const screenshotPath = path.resolve('scratch/dashboard.png');
  await page.screenshot({ path: screenshotPath, fullPage: true });
  console.log(`🎉 SUCCESS: Dashboard screenshot saved to ${screenshotPath}`);
});
