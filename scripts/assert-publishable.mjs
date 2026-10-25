#!/usr/bin/env node
/**
 * 发布前守卫 —— 挂在根 package.json 的 prepublishOnly 上，在 npm 打包前执行。
 *
 * 为什么需要它：2026-10-25 的 0.7.3 事故，就是一次**绕过 scripts/publish.sh 的直接
 * `npm publish`** —— publish.sh 里那条把 SDK 依赖改写成精确 pin 的 sed 因此没生效，
 * `"@openlearn/plugin-sdk": "workspace:*"` 原样进了发布包，消费者安装必然报
 * EUNSUPPORTEDPROTOCOL（Unsupported URL Type "workspace:"），整个版本不可安装；
 * 同时 gitHead 指向的是分支 HEAD 而非发布 tag，npm 上的版本与仓库 tag 失去对应。
 *
 * 这道守卫把「发布必须满足的前提」从「只在某个脚本里」变成「npm 自己也会检查」，
 * 因此任何直接 npm publish 的路径都会被拦下。
 *
 * 三道断言：
 *   ① 依赖里不允许出现本地协议（workspace: / link: / file:）——消费者装不上
 *   ② packages/core/version.ts 的 FALLBACK_VERSION 必须等于 package.json 的 version
 *   ③ 当前 HEAD 必须正好被 v<version> 这个 tag 指向——发布必须发生在打了 tag 的提交上
 *
 * 退出码：0 放行；1 拦下并逐条打印原因。
 */
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

const root = process.cwd();
const errors = [];

const readJson = (p) => JSON.parse(fs.readFileSync(path.join(root, p), 'utf8'));
const pkg = readJson('package.json');
const version = pkg.version;

// ── 断言 1：依赖里不得有本地协议 ────────────────────────────────────────────
const LOCAL_PROTOCOLS = ['workspace:', 'link:', 'file:'];
for (const field of ['dependencies', 'optionalDependencies', 'peerDependencies']) {
  const deps = pkg[field] || {};
  for (const [name, spec] of Object.entries(deps)) {
    for (const proto of LOCAL_PROTOCOLS) {
      if (typeof spec === 'string' && spec.startsWith(proto)) {
        errors.push(
          `依赖 ${field}.${name} = "${spec}" 使用了本地协议 "${proto}"。` +
            `发布到 registry 后消费者无法解析该 spec（EUNSUPPORTEDPROTOCOL），` +
            `请先把它改写成精确版本号（例如 "3.7.0"）。`,
        );
      }
    }
  }
}

// ── 断言 2：FALLBACK_VERSION 必须与 package.json 的 version 一致 ─────────────
try {
  const src = fs.readFileSync(path.join(root, 'packages/core/version.ts'), 'utf8');
  const m = src.match(/FALLBACK_VERSION\s*=\s*['"]([^'"]+)['"]/);
  if (!m) {
    errors.push('packages/core/version.ts 里找不到 FALLBACK_VERSION 字面量，无法核对版本一致性。');
  } else if (m[1] !== version) {
    errors.push(`版本不一致：package.json 是 ${version}，packages/core/version.ts 的 FALLBACK_VERSION 是 ${m[1]}。`);
  }
} catch (e) {
  errors.push(`读取 packages/core/version.ts 失败：${e.message}`);
}

// ── 断言 3：HEAD 必须正好被 v<version> 指向 ─────────────────────────────────
const expectedTag = `v${version}`;
try {
  const tags = execFileSync('git', ['tag', '--points-at', 'HEAD'], {
    cwd: root,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'ignore'],
  })
    .split('\n')
    .map((s) => s.trim())
    .filter(Boolean);
  if (!tags.includes(expectedTag)) {
    errors.push(
      `当前 HEAD 没有被 ${expectedTag} 指向（HEAD 上的 tag：${tags.length ? tags.join(', ') : '无'}）。` +
        `发布必须发生在打了发布 tag 的提交上，否则 npm 上的版本与仓库 tag 无法对应。`,
    );
  }
} catch (e) {
  errors.push(
    `无法读取 git tag（${e.message}）。发布必须在打了 ${expectedTag} 的提交上、且能访问 git 元数据的环境中进行。`,
  );
}

// ── 结论 ─────────────────────────────────────────────────────────────────────
if (errors.length > 0) {
  console.error('[assert-publishable] ✗ 发布被守卫拦下：');
  for (const e of errors) console.error(`  • ${e}`);
  console.error('[assert-publishable] 如需发布，请走 scripts/publish.sh（它会完成 SDK 依赖改写与 tag 同源校验）。');
  process.exit(1);
}

console.log(
  `[assert-publishable] ✓ 版本 ${version} 满足发布前提（依赖无本地协议 / FALLBACK_VERSION 一致 / HEAD 已被 ${expectedTag} 指向）`,
);
