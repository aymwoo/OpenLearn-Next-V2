/**
 * 发布守卫的**挂载**回归测试。
 *
 * 守的是一件很容易丢、丢了以后完全没人发现的事：`scripts/assert-publishable.mjs`
 * 必须挂在每个可发布包的 `prepublishOnly` 上。
 *
 * 2026-10-27 实测：SDK 3.7.4 想靠这道守卫拦住「CHANGELOG 没折叠就发版」，
 * 结果 `packages/plugin-sdk` 的 `prepublishOnly` 是 `node build.mjs` ——
 * 守卫只挂在根包（openlearn-next）与 test-kit 上，**SDK 发布时它根本不跑**。
 * 而漏掉守卫的恰恰就是 SDK：3.7.3 发布时 build 期守卫还在 PR 分支上没合进 main。
 *
 * 这道守卫写得再对，没挂上就等于不存在。所以把「挂没挂上」本身变成测试。
 *
 * 判定范围：带 `publishConfig` 的包（那就是要发到 registry 的那一批）。
 */
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const REPO_ROOT = path.resolve(__dirname, '../..');

interface PackageJson {
  name?: string;
  publishConfig?: unknown;
  scripts?: Record<string, string>;
}

interface PublishablePackage {
  file: string;
  name: string;
  prepublishOnly: string;
}

function readPackageJson(file: string): PackageJson {
  return JSON.parse(fs.readFileSync(file, 'utf8')) as PackageJson;
}

/** 所有候选 package.json：根 + packages/* */
function publishablePackages(): PublishablePackage[] {
  const files = [path.join(REPO_ROOT, 'package.json')];
  const packagesDir = path.join(REPO_ROOT, 'packages');
  for (const entry of fs.readdirSync(packagesDir, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const p = path.join(packagesDir, entry.name, 'package.json');
    if (fs.existsSync(p)) files.push(p);
  }
  return files
    .map((file) => ({ file, pkg: readPackageJson(file) }))
    .filter(({ pkg }) => pkg.publishConfig !== undefined)
    .map(({ file, pkg }) => ({
      file: path.relative(REPO_ROOT, file),
      name: pkg.name ?? file,
      prepublishOnly: pkg.scripts?.prepublishOnly ?? '',
    }));
}

describe('assert-publishable 挂载', () => {
  it('至少覆盖 openlearn-next / plugin-sdk / plugin-test-kit 三个可发布包', () => {
    const names = publishablePackages()
      .map((p) => p.name)
      .sort();
    expect(names).toEqual(
      expect.arrayContaining(['@openlearn/plugin-sdk', '@openlearn/plugin-test-kit', 'openlearn-next']),
    );
  });

  it('每个可发布包的 prepublishOnly 都要跑 assert-publishable.mjs', () => {
    const missing = publishablePackages().filter((p) => !p.prepublishOnly.includes('assert-publishable.mjs'));
    expect(missing.map((p) => `${p.file}（${p.name}）prepublishOnly=${p.prepublishOnly || '（无）'}`)).toEqual([]);
  });
});
