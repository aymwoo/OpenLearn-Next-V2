/**
 * install-utils.ts — esbuild 打包 + jszip 解压 + manifest 校验 + ZIP bomb 防护。
 *
 * ## 职责
 *
 * - bundlePlugin() — 将多文件插件（含相对导入）通过 esbuild 打包为单 ESM bundle
 * - validateAndBundleZip() — 从 ZIP Buffer 中解压、校验 manifest、esbuild 打包
 * - extractManifestFromBundle() — 从已打包的 bundle 中重新提取 manifest（备用）
 *
 * ## 设计决策
 *
 * - **纯函数**: 所有函数不依赖 Kernel 实例，便于单独导入和单元测试
 * - **D-07**: 使用 esbuild.build({ stdin, bundle, write:false }) 在内存中完成打包
 * - **D-08**: external: ['@openlearn/*'] 保留 Token 服务导入，平台无关导入被拒绝
 * - **D-10**: manifestSchema.parse() 运行时校验 manifest.json
 * - **D-12**: ZIP 原始字节 → 解压 → 校验 → 打包 → 返回 { manifest, bundledCode }
 * - **ZIP bomb 防护**: 解压前检查未压缩大小总和 ≤ 10MB
 * - **路径穿越防护**: 拒绝包含 ".." 或以 "/" 开头的 ZIP 条目名
 * - **临时目录清理**: try/finally 确保临时文件被删除
 */

import * as esbuild from 'esbuild';
import JSZip from 'jszip';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { v7 as uuidv7 } from 'uuid';
import { manifestSchema, type Manifest } from './manifest-schema.js';

/** ZIP 包中所有文件的未压缩大小上限（10MB），用于 ZIP bomb 防护 */
const MAX_UNCOMPRESSED_SIZE = 10 * 1024 * 1024;

/**
 * 将插件入口代码（含相对导入）通过 esbuild 打包为单 ESM bundle。
 *
 * D-07: esbuild 安装时打包 —— stdin API 接收代码字符串，bundle 选项
 * 解析所有相对导入并内联，write: false 在内存中完成打包。
 * D-08: external: ['@openlearn/*'] 保留 Token 服务导入为 external，
 * 禁止第三方 npm 包导入（esbuild 无法解析的裸 specifier 会报错）。
 *
 * @param entryCode - 插件入口文件的源代码
 * @param resolveDir - 解析相对导入的基准目录（临时解压目录）
 * @returns 打包后的单 ESM bundle 代码字符串
 */
export async function bundlePlugin(
  entryCode: string,
  resolveDir: string,
): Promise<string> {
  const result = await esbuild.build({
    stdin: {
      contents: entryCode,
      resolveDir,
      loader: 'ts',
    },
    bundle: true,
    write: false,
    format: 'esm',
    platform: 'neutral',
    target: 'es2022',
    external: ['@openlearn/*'],
    plugins: [
      {
        name: 'openlearn-token-enforcer',
        setup(build) {
          // 拦截所有非相对路径的导入解析
          build.onResolve({ filter: /.*/ }, (args) => {
            // 相对路径和绝对路径由 esbuild 正常解析
            if (args.path.startsWith('.') || args.path.startsWith('/')) {
              return undefined; // 让 esbuild 自行处理
            }
            // @openlearn Token 导入 — 标记为 external 保留
            if (args.path.startsWith('@openlearn')) {
              return { external: true, path: args.path };
            }
            // 其他裸 specifier（如 lodash）— 拒绝打包
            return {
              errors: [
                {
                  text: `Import of "${args.path}" is not allowed. Plugins may only use relative imports or @openlearn/* Token services.`,
                },
              ],
            };
          });
        },
      },
    ],
  });

  return result.outputFiles[0].text;
}

/**
 * 从 ZIP Buffer 中解压、校验 manifest、esbuild 打包，返回 manifest 和 bundledCode。
 *
 * D-12: 接收 ZIP 原始字节（来自 SQLite zip_package BLOB 或 HTTP upload），完成：
 * 1. ZIP bomb 防护：检查所有文件未压缩大小总和 ≤ 10MB
 * 2. 路径穿越防护：拒绝包含 ".." 或以 "/" 开头的条目名
 * 3. jszip.loadAsync() 解压
 * 4. 读取并解析 manifest.json
 * 5. D-10: manifestSchema.parse() 运行时校验
 * 6. 根据 manifest.main 读取入口文件
 * 7. 将所有文件写入临时目录
 * 8. 调用 bundlePlugin() 打包
 * 9. 清理临时目录
 *
 * @param zipBuffer - ZIP 文件的原始字节
 * @returns {{ manifest, bundledCode, entryFileName }}
 * @throws {Error} ZIP bomb 检测、路径穿越、manifest 缺失/校验失败、入口文件缺失、esbuild 打包失败
 */
export async function validateAndBundleZip(
  zipBuffer: Buffer,
): Promise<{
  manifest: Manifest;
  bundledCode: string;
  entryFileName: string;
}> {
  // Step 1: 加载 ZIP
  const zip = await JSZip.loadAsync(zipBuffer);

  // Step 2: ZIP bomb 防护 — 检查所有文件的未压缩大小总和
  let totalUncompressed = 0;
  for (const file of Object.values(zip.files)) {
    if (!file.dir) {
      // jszip 的 _data.uncompressedSize 在 loadAsync 后可访问
      const uncompressedSize = (file as any)._data?.uncompressedSize ?? 0;
      totalUncompressed += uncompressedSize;
    }
  }

  if (totalUncompressed > MAX_UNCOMPRESSED_SIZE) {
    throw new Error(
      `ZIP bomb prevention: total uncompressed size ${totalUncompressed} bytes exceeds limit of ${MAX_UNCOMPRESSED_SIZE} bytes`,
    );
  }

  // Step 3: 路径穿越检查 — 拒绝 ".." 或以 "/" 开头的路径
  for (const name of Object.keys(zip.files)) {
    if (name.includes('..') || name.startsWith('/')) {
      throw new Error(
        `Security: path traversal detected in ZIP entry: "${name}"`,
      );
    }
  }

  // Step 4: 读取 manifest.json
  const manifestFile = zip.file('manifest.json');
  if (!manifestFile) {
    throw new Error('ZIP package is missing manifest.json');
  }
  const manifestJson = await manifestFile.async('string');
  const rawManifest = JSON.parse(manifestJson);

  // Step 5: D-10 — zod 运行时校验
  const manifest = manifestSchema.parse(rawManifest);

  // Step 6: 读取入口文件
  const entryFile = zip.file(manifest.main);
  if (!entryFile) {
    throw new Error(
      `Entry file "${manifest.main}" specified in manifest not found in ZIP package`,
    );
  }
  const entryCode = await entryFile.async('string');

  // Step 7: 创建临时解压目录，写入所有文件以支持 esbuild 的 resolveDir
  const tmpDir = path.join(os.tmpdir(), `plugin-build-${uuidv7()}`);

  try {
    fs.mkdirSync(tmpDir, { recursive: true });

    // 写入所有 ZIP 文件到临时目录
    for (const [name, file] of Object.entries(zip.files)) {
      if (file.dir) continue;
      const filePath = path.join(tmpDir, name);
      const fileDir = path.dirname(filePath);
      fs.mkdirSync(fileDir, { recursive: true });
      const content = await file.async('nodebuffer');
      fs.writeFileSync(filePath, content);
    }

    // Step 8: esbuild 打包
    const bundledCode = await bundlePlugin(entryCode, tmpDir);

    return { manifest, bundledCode, entryFileName: manifest.main };
  } finally {
    // Step 9: 清理临时目录
    try {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    } catch {
      // 静默清理失败
    }
  }
}

/**
 * 从已打包的 bundle 代码中重新提取 manifest。
 *
 * 当前由 validateAndBundleZip() 一步完成 manifest 提取和打包，
 * 此函数保留为备用接口，用于未来无需 ZIP 的场景。
 *
 * @param _bundledCode - 打包后的 bundle 代码（当前未使用）
 * @returns Promise<Manifest> 当前实现抛出 "not implemented"
 */
export async function extractManifestFromBundle(
  _bundledCode: string,
): Promise<Manifest> {
  throw new Error('extractManifestFromBundle is not yet implemented');
}
