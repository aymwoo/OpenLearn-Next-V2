#!/usr/bin/env node
/**
 * 将 Sphinx 构建生成的 HTML 手册导出为精美排版的 A4 PDF，
 * 并同步拷贝至 ~/Downloads/ 供离线阅读与分发。
 *
 * ⚠️ **产物不进版本控制**：PDF 写入 `docs/_build/handbooks/`（已被 .gitignore 忽略），
 * 仓库只保留生成脚本与截图源图。分发走 **GitHub Release 附件**：
 *   npm run docs:pdf            # 生成到 docs/_build/handbooks/
 *   npm run docs:pdf:upload     # 上传为 Release 附件（releases/latest/download/… 稳定链接）
 * 原因：一份手册 PDF 约 3–6 MB，而每次文档改动都可能重新导出；
 * 二进制制品入 git 会永久胀大仓库（历史不可追回），且容易与源码版本脱节。
 *
 * @module
 */
import { chromium } from '@playwright/test';
import { existsSync, mkdirSync, copyFileSync, unlinkSync } from 'node:fs';
import path from 'node:path';
import os from 'node:os';

const CHROMIUM = '/usr/bin/chromium';
const HTML_DIR = path.resolve('docs/_build/html');
const DOWNLOADS_DIR = path.join(os.homedir(), 'Downloads');
/** PDF 产物目录（gitignored）：不进版本控制，只作为上传 Release 附件的中间产物 */
const OUT_DIR = path.resolve('docs/_build/handbooks');

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
    outDoc: path.join(OUT_DIR, 'OpenLearnV2-Quickstart-Handbook.pdf'),
    outDownload: path.join(DOWNLOADS_DIR, 'OpenLearnV2-快速上手手册.pdf'),
    title: 'OpenLearn V2 · 快速上手手册',
  },
  {
    html: path.join(HTML_DIR, 'tutorials/plugin-development-tutorial.html'),
    outDoc: path.join(OUT_DIR, 'OpenLearnV2-Plugin-Handbook.pdf'),
    outDownload: path.join(DOWNLOADS_DIR, 'OpenLearnV2-插件开发手册.pdf'),
    title: 'OpenLearn V2 · 插件开发手册',
  },
];

async function main() {
  if (!existsSync(DOWNLOADS_DIR)) {
    mkdirSync(DOWNLOADS_DIR, { recursive: true });
  }
  if (!existsSync(OUT_DIR)) {
    mkdirSync(OUT_DIR, { recursive: true });
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

    // 渲染以人类如何使用 AI Skill 为核心的《OpenLearn V2 插件开发手册》并同步到 ~/Downloads/
    const skillGuideHtml = path.resolve('docs/tutorials/plugin-skill-guide.html');
    const skillGuidePdf = path.join(OUT_DIR, 'OpenLearnV2-Plugin-Skill-Guide.pdf');
    if (existsSync(skillGuideHtml)) {
      console.log('\n正在渲染 PDF: OpenLearn V2 · 插件开发手册（如何使用 AI Skill 零门槛开发课堂插件） ...');
      const skillPage = await context.newPage();
      await skillPage.goto(`file://${skillGuideHtml}`, { waitUntil: 'networkidle' });
      await skillPage.emulateMedia({ media: 'print' });
      await skillPage.waitForTimeout(800);
      await skillPage.pdf({
        path: skillGuidePdf,
        format: 'A4',
        printBackground: true,
      });
      await skillPage.close();
      console.log(`✔ 生成文档 PDF: ${skillGuidePdf}`);
    }

    if (existsSync(skillGuidePdf)) {
      const pluginHandbookDownload = path.join(DOWNLOADS_DIR, 'OpenLearnV2-插件开发手册.pdf');
      const skillGuideDownload = path.join(DOWNLOADS_DIR, 'OpenLearnV2-插件开发Skill使用指南.pdf');
      copyFileSync(skillGuidePdf, pluginHandbookDownload);
      copyFileSync(skillGuidePdf, skillGuideDownload);
      console.log(`✔ 已复制至 Downloads: ${pluginHandbookDownload}`);
      console.log(`✔ 已复制至 Downloads: ${skillGuideDownload}`);
    }

    // 清理旧版 59 页底层 API 参考手册，避免与面向人类的 Skill 开发手册混淆
    const legacyApiPdf = path.join(DOWNLOADS_DIR, 'OpenLearnV2-插件开发完全指南.pdf');
    if (existsSync(legacyApiPdf)) {
      unlinkSync(legacyApiPdf);
      console.log(`✔ 已移除旧版底层 API 手册: ${legacyApiPdf}`);
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
