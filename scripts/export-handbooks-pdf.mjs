#!/usr/bin/env node
/**
 * 将 Sphinx 构建生成的 HTML 手册导出为精美排版的 A4 PDF，
 * 并同步拷贝至 ~/Downloads/ 供离线阅读与分发。
 *
 * @module
 */
import { chromium } from '@playwright/test';
import { existsSync, mkdirSync, copyFileSync } from 'node:fs';
import path from 'node:path';
import os from 'node:os';

const CHROMIUM = '/usr/bin/chromium';
const HTML_DIR = path.resolve('docs/_build/html');
const DOWNLOADS_DIR = path.join(os.homedir(), 'Downloads');

const PRINT_CSS = `
  @media print {
    nav.wy-nav-side,
    .wy-nav-top,
    .rst-breadcrumbs,
    footer,
    .headerlink,
    .btnlink {
      display: none !important;
    }
    section.wy-nav-content-wrap {
      margin-left: 0 !important;
      background: #ffffff !important;
    }
    .wy-nav-content {
      max-width: 100% !important;
      padding: 0 !important;
      margin: 0 !important;
    }
    body, .rst-content {
      color: #1e293b !important;
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Noto Sans CJK SC", "PingFang SC", "Microsoft YaHei", sans-serif !important;
      line-height: 1.6 !important;
    }
    img {
      max-width: 92% !important;
      height: auto !important;
      display: block !important;
      margin: 14px auto !important;
      border: 1px solid #e2e8f0 !important;
      border-radius: 6px !important;
      box-shadow: 0 2px 6px rgba(0,0,0,0.06) !important;
      page-break-inside: avoid !important;
    }
    table.docutils {
      width: 100% !important;
      border-collapse: collapse !important;
      margin: 14px 0 !important;
      page-break-inside: avoid !important;
    }
    table.docutils th, table.docutils td {
      border: 1px solid #cbd5e1 !important;
      padding: 6px 10px !important;
      font-size: 9.5pt !important;
    }
    table.docutils th {
      background-color: #f1f5f9 !important;
      font-weight: 600 !important;
    }
    pre, .highlight, div[class*="highlight-"] {
      page-break-inside: avoid !important;
      background: #f8fafc !important;
      border: 1px solid #e2e8f0 !important;
      border-radius: 5px !important;
      font-size: 9pt !important;
      line-height: 1.45 !important;
    }
    h1 {
      font-size: 20pt !important;
      margin-top: 0 !important;
      margin-bottom: 16px !important;
      color: #0f172a !important;
      border-bottom: 2px solid #3b82f6 !important;
      padding-bottom: 8px !important;
      page-break-after: avoid !important;
    }
    h2 {
      font-size: 15pt !important;
      margin-top: 24px !important;
      margin-bottom: 12px !important;
      color: #1e293b !important;
      border-bottom: 1px solid #e2e8f0 !important;
      padding-bottom: 6px !important;
      page-break-after: avoid !important;
    }
    h3 {
      font-size: 12.5pt !important;
      margin-top: 18px !important;
      margin-bottom: 8px !important;
      color: #334155 !important;
      page-break-after: avoid !important;
    }
    h4 {
      font-size: 11pt !important;
      margin-top: 14px !important;
      margin-bottom: 6px !important;
      page-break-after: avoid !important;
    }
    p, li {
      font-size: 10pt !important;
    }
  }
`;

const TARGETS = [
  {
    html: path.join(HTML_DIR, 'getting-started/quickstart-handbook.html'),
    outDoc: path.resolve('docs/getting-started/quickstart-handbook.pdf'),
    outDownload: path.join(DOWNLOADS_DIR, 'OpenLearnV2-快速上手手册.pdf'),
    title: 'OpenLearn V2 · 快速上手手册',
  },
  {
    html: path.join(HTML_DIR, 'tutorials/plugin-development-tutorial.html'),
    outDoc: path.resolve('docs/tutorials/plugin-development-tutorial.pdf'),
    outDownload: path.join(DOWNLOADS_DIR, 'OpenLearnV2-插件开发完全指南.pdf'),
    title: 'OpenLearn V2 · 插件开发完全指南',
  },
];

async function main() {
  if (!existsSync(DOWNLOADS_DIR)) {
    mkdirSync(DOWNLOADS_DIR, { recursive: true });
  }

  const launchOptions = {
    args: ['--no-sandbox', '--disable-setuid-sandbox'],
    ...(existsSync(CHROMIUM) ? { executablePath: CHROMIUM } : {}),
  };
  const browser = await chromium.launch(launchOptions);

  try {
    const context = await browser.newContext({
      viewport: { width: 1200, height: 900 },
      deviceScaleFactor: 2,
    });

    for (const item of TARGETS) {
      if (!existsSync(item.html)) {
        console.error(`✖ HTML 文件不存在: ${item.html}，请先执行 bash scripts/build-docs.sh`);
        continue;
      }

      console.log(`\n正在渲染 PDF: ${item.title} ...`);
      const page = await context.newPage();
      await page.goto(`file://${item.html}`, { waitUntil: 'networkidle' });

      // 注入自定义打印样式
      await page.addStyleTag({ content: PRINT_CSS });

      // 等待图片加载完成
      await page.waitForTimeout(1500);

      await page.pdf({
        path: item.outDoc,
        format: 'A4',
        printBackground: true,
        margin: {
          top: '15mm',
          bottom: '15mm',
          left: '14mm',
          right: '14mm',
        },
        displayHeaderFooter: true,
        headerTemplate: `
          <div style="font-size: 8pt; color: #94a3b8; width: 100%; padding: 0 14mm; display: flex; justify-content: space-between;">
            <span>${item.title}</span>
            <span>OpenLearn V2</span>
          </div>`,
        footerTemplate: `
          <div style="font-size: 8pt; color: #94a3b8; width: 100%; text-align: center;">
            <span class="pageNumber"></span> / <span class="totalPages"></span>
          </div>`,
      });

      console.log(`✔ 生成文档 PDF: ${item.outDoc}`);

      // 同步复制一份到 ~/Downloads/
      copyFileSync(item.outDoc, item.outDownload);
      console.log(`✔ 已复制至 Downloads: ${item.outDownload}`);

      await page.close();
    }

    // 同时将 PR #388 的插件开发 Skill 使用指南 PDF 复制到 ~/Downloads/
    const skillGuidePdf = path.resolve('docs/tutorials/plugin-skill-guide.pdf');
    if (existsSync(skillGuidePdf)) {
      const skillDownload = path.join(DOWNLOADS_DIR, 'OpenLearnV2-插件开发Skill使用指南.pdf');
      copyFileSync(skillGuidePdf, skillDownload);
      console.log(`✔ 已复制至 Downloads: ${skillDownload}`);
    }

    console.log('\n🎉 所有最新手册 PDF 均已成功生成并存放到 ~/Downloads/ 下！');
  } finally {
    await browser.close();
  }
}

main().catch((err) => {
  console.error('✖ 导出 PDF 失败:', err);
  process.exit(1);
});
