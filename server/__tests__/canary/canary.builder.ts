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
