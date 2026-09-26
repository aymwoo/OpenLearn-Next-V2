/**
 * 金丝雀插件打包 builder。
 *
 * 职责边界（canary README §6）：ZIP 内 index.js 是作者侧 esbuild 产物（bundle 完成、
 * @openlearn/* 保持 external），宿主 installFromZip 时会再做一次 esbuild 扫描打包。
 */
import esbuild from 'esbuild';
import fs from 'node:fs';
import path from 'node:path';
import JSZip from 'jszip';

const SRC_DIR = path.resolve(__dirname, 'canary-src');

export interface BuildOptions {
  /** 深覆盖 manifest 模板字段（毒丸变体注入点） */
  manifestOverrides?: Record<string, unknown>;
}

// 作者侧 bundle 进程内缓存：同一测试文件的多次组装复用
let cachedBundle: string | null = null;

async function bundleIndex(): Promise<string> {
  const result = await esbuild.build({
    entryPoints: [path.join(SRC_DIR, 'index.ts')],
    bundle: true,
    write: false,
    format: 'esm',
    platform: 'neutral',
    target: 'es2022',
    // 与宿主 bundlePlugin 相同的 external 口径：裸 specifier 只允许 @openlearn/*
    external: ['@openlearn/*'],
    logLevel: 'silent',
  });
  cachedBundle = result.outputFiles![0].text;
  return cachedBundle;
}

/** 组装金丝雀 ZIP（manifest.json + index.js 平铺在 ZIP 根） */
export async function buildCanaryZip(opts: BuildOptions = {}): Promise<Buffer> {
  const indexJs = await bundleIndex();
  const template = JSON.parse(fs.readFileSync(path.join(SRC_DIR, 'manifest.template.json'), 'utf-8'));
  const manifest = { ...template, ...opts.manifestOverrides };

  const zip = new JSZip();
  zip.file('manifest.json', JSON.stringify(manifest, null, 2));
  zip.file('index.js', indexJs);
  return zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' });
}

// 毒丸变体（buildPoisonZip）在第 4 步实现 —— canary README §7 步骤 4
/**
 * 组装毒丸变体 ZIP 包（用于步骤 4 防御验证）
 */
export async function buildPoisonZip(variant: string): Promise<Buffer> {
  const template = JSON.parse(fs.readFileSync(path.join(SRC_DIR, 'manifest.template.json'), 'utf-8'));
  const indexJs = await bundleIndex();

  switch (variant) {
    case 'nested-zip': {
      // 嵌套目录：manifest.json 与 index.js 位于子目录下，ZIP 根目录缺少 manifest.json
      const zip = new JSZip();
      zip.folder('canary')!.file('manifest.json', JSON.stringify(template, null, 2));
      zip.folder('canary')!.file('index.js', indexJs);
      return zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' });
    }

    case 'engine99': {
      return buildCanaryZip({
        manifestOverrides: {
          engines: { openlearn: '>=99.0.0' },
        },
      });
    }

    case 'engine02': {
      return buildCanaryZip({
        manifestOverrides: {
          engines: { openlearn: '^0.2.9' },
        },
      });
    }

    case 'missing-entry': {
      return buildCanaryZip({
        manifestOverrides: {
          main: 'non-existent-entry.js',
        },
      });
    }

    case 'bomb': {
      // 构造未压缩大小超过 300MB 的文件（301MB 稀疏 Buffer），启用 level 1 快速压缩
      const zip = new JSZip();
      zip.file('manifest.json', JSON.stringify(template, null, 2));
      zip.file('index.js', indexJs);
      zip.file('padding.bin', Buffer.alloc(301 * 1024 * 1024, 0));
      return zip.generateAsync({
        type: 'nodebuffer',
        compression: 'DEFLATE',
        compressionOptions: { level: 1 },
      });
    }

    case 'all-method': {
      return buildCanaryZip({
        manifestOverrides: {
          api: {
            baseRoute: '/canary',
            routes: [
              { method: 'ALL', path: '/all' },
            ],
          },
        },
      });
    }

    case 'traversal': {
      // 路径穿越：包含 ../ 路径条目
      const zip = new JSZip();
      zip.file('manifest.json', JSON.stringify(template, null, 2));
      zip.file('index.js', indexJs);
      zip.file('../evil.js', 'console.log("traversal exploit");');
      return zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' });
    }

    case 'noprovides': {
      // 声明 provides 为空数组，但入口代码在 activate 时直接 ctx.provide 未声明 Token 触发安全拦截
      const zip = new JSZip();
      const evilManifest = { ...template, provides: [] };
      const evilCode = `
export default {
  manifest: {
    id: 'ext-canary',
    name: '金丝雀探针插件',
    version: '1.0.0',
    main: 'index.js',
  },
  async activate(ctx) {
    await ctx.provide({ name: 'ext-canary:IBadService' }, { ping: () => 'pong' });
  }
};
`;
      zip.file('manifest.json', JSON.stringify(evilManifest, null, 2));
      zip.file('index.js', evilCode);
      return zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' });
    }

    default:
      throw new Error(`Unknown poison variant: ${variant}`);
  }
}
