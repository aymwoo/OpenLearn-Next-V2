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
 * 五道断言：
 *   ① 依赖里不允许出现本地协议（workspace: / link: / file:）——消费者装不上
 *   ② packages/core/version.ts 的 FALLBACK_VERSION 必须等于 package.json 的 version
 *      （仅平台包；SDK / test-kit 没有这一层版本常量，跳过）
 *   ③ 当前 HEAD 必须正好被发布 tag 指向——发布必须发生在打了 tag 的提交上
 *   ④ 当前 HEAD 必须已经并入主干（origin/main）——registry 不得领先于 main
 *   ⑤ CHANGELOG 必须与本次版本对得上——有 `## [<version>]` 段，且 `[Unreleased]` 已折叠
 *
 * tag 命名空间按包名自动推导（见 docs/contributing/contributing.md「发布 tag 约定」）：
 *   openlearn-next              → v<X.Y.Z>
 *   @openlearn/plugin-sdk       → plugin-sdk-v<X.Y.Z>
 *   @openlearn/plugin-test-kit  → plugin-test-kit-v<X.Y.Z>
 * 推导而非「由调用方传前缀」是刻意的：少一个能被忘记的参数，就少一条绕过门禁的路径。
 * 需要例外时用 --tag-prefix=<prefix> 显式覆盖。
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

// ── tag 命名空间：按包名推导，允许 --tag-prefix 覆盖 ────────────────────────
const TAG_PREFIX_BY_PKG = {
  'openlearn-next': 'v',
  '@openlearn/plugin-sdk': 'plugin-sdk-v',
  '@openlearn/plugin-test-kit': 'plugin-test-kit-v',
};
const argv = process.argv.slice(2);
const argIdx = argv.findIndex((a) => a === '--tag-prefix' || a.startsWith('--tag-prefix='));
const tagPrefixArg = argIdx === -1 ? null : argv[argIdx].includes('=') ? argv[argIdx].split('=')[1] : argv[argIdx + 1];
const tagPrefix = tagPrefixArg || TAG_PREFIX_BY_PKG[pkg.name] || 'v';
const isPlatform = pkg.name === 'openlearn-next';

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

// ── 断言 2：FALLBACK_VERSION 必须与 package.json 的 version 一致（仅平台包）──
if (isPlatform) {
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
}

// ── 断言 3：HEAD 必须正好被发布 tag 指向 ────────────────────────────────────
const expectedTag = `${tagPrefix}${version}`;
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

// ── 断言 4：HEAD 必须已经并入主干 ───────────────────────────────────────────
//
// 为什么需要它：2026-10-26 的 3.7.1 事故。那次发布的提交（把脚手架模板从
// `export default function Component()` 改成沙箱桥接入口 `{ activate }`）落在特性
// 分支上，tag 与 npm 都指向它，**但它从未进过 main**。结果两侧内容分叉：
//
//   · npm 上的 @openlearn/plugin-sdk@3.7.1 → 模板已是桥接版
//   · GitHub main 的 scaffold/templates/  → 模板还是 React 组件版
//
// 后果不是「文档过时」那么轻：第三方作者照 main 抄模板，插件能构建、能装上，
// 激活时隐藏 iframe 里 `typeof plugin.activate !== 'function'` 抛
// `missing activate function`，整个插件进错误态。而 npm 与 main 谁都不会报错。
//
// 断言 3 看不见这种漂移 —— tag 完全可以打在一个没合并的提交上。所以再补一条：
// 这个提交必须已经出现在主干历史里。
//
// 正确顺序是「合并进 main → 在 main 上打 tag → 发版」。从特性分支直接发布会把
// registry 推到 main 前面，而 npm 不可回滚，只能再补一次发版才追平。
//
// 确需例外（紧急补丁先发后合、或环境里没有主干信息）时显式放行：
//   ALLOW_UNMERGED_PUBLISH=1 npm publish --registry=https://registry.npmjs.org
// 也可传 --allow-unmerged。
const allowUnmerged = argv.includes('--allow-unmerged') || process.env.ALLOW_UNMERGED_PUBLISH === '1';

const gitQuiet = (args) =>
  execFileSync('git', args, { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });

function resolveMainRef() {
  for (const ref of ['refs/remotes/origin/main', 'refs/heads/main']) {
    try {
      gitQuiet(['rev-parse', '--verify', '--quiet', ref]);
      return ref;
    } catch {
      /* 试下一个候选引用 */
    }
  }
  return null;
}

if (allowUnmerged) {
  console.warn('[assert-publishable] ! ALLOW_UNMERGED_PUBLISH 已放行「发布提交未并入主干」—— 请确保合并动作紧随其后。');
} else {
  const mainRef = resolveMainRef();
  if (!mainRef) {
    errors.push(
      '找不到主干引用（refs/remotes/origin/main 或 refs/heads/main），无法核对本次发布是否已并入主干。' +
        '请先 git fetch origin main；若确实要在没有主干信息的环境里发布，设 ALLOW_UNMERGED_PUBLISH=1 显式放行。',
    );
  } else {
    let merged = true;
    try {
      gitQuiet(['merge-base', '--is-ancestor', 'HEAD', mainRef]);
    } catch {
      merged = false;
    }
    if (!merged) {
      let head = 'HEAD';
      let pending = '';
      try {
        head = gitQuiet(['rev-parse', '--short', 'HEAD']).trim();
      } catch {
        /* 只是给提示，取不到就用 HEAD */
      }
      try {
        pending = gitQuiet(['log', '--oneline', '-5', `${mainRef}..HEAD`]).trim();
      } catch {
        /* 同上 */
      }
      errors.push(
        `当前 HEAD（${head}）不在主干 ${mainRef} 的历史里 —— 这次发布会把 registry 推到 main 前面，` +
          `npm 上的内容从此与 GitHub main 分叉（3.7.1 事故就是这个形态：main 上还是旧 React 模板，npm 上已是沙箱桥接版）。` +
          `请先把发布提交合并进 main，再在 main 上打 tag 发版。` +
          (pending ? `\n    未合并的提交：\n      ${pending.split('\n').join('\n      ')}` : ''),
      );
    }
  }
}

// ── 断言 5：CHANGELOG 必须与本次发布的版本对得上 ──────────────────────────
//
// 为什么需要它：2026-10-27 实测过 —— `scripts/publish.sh` 与整个 `audit-tools/`
// 里 grep `CHANGELOG` / `Unreleased` **零命中**，也就是说发布链路完全不看
// CHANGELOG，它是纯人工维护的。于是「代码进了 main、能力没进 npm」这种漂移
// 没有任何信号：PR #326 已经把 build 期裸说明符守卫合进 main，可 npm latest
// 仍是 3.7.3（发在守卫合入之前），第三方 `npm i -D @openlearn/plugin-sdk`
// 装到的包里没有这道守卫，而文档已经写了它。装的人、写插件的人都不会得到
// 任何提示。
//
// 断言 3、4 都防不住这个形态：tag 打对了、HEAD 也在 main 上，只是**发布这一
// 刻截取的快照里没有某项改动**。补一条「版本号必须在 CHANGELOG 里有对应段、
// 且待发布内容必须已折叠进该段」，就把「发版前整理 CHANGELOG」从人工纪律
// 变成硬断言 —— 没折叠就发不出去，也就不会有人以为发出去了。
//
// 加了这条之后，平台包（根 CHANGELOG）下一次发版会被拦，直到有人把
// `[Unreleased]` 里的条目折叠进新的版本段。**这是预期行为**：那些条目确实
// 尚未出现在任何已发布的版本里，先折叠是对的做法。
//
// 确需例外（例如给已发布版本补发、CI 环境无 CHANGELOG 语义）时显式放行：
//   ALLOW_UNRELEASED_CHANGELOG=1 npm publish --registry=https://registry.npmjs.org
// 也可传 --allow-unreleased-changelog。
const allowUnreleasedChangelog =
  argv.includes('--allow-unreleased-changelog') || process.env.ALLOW_UNRELEASED_CHANGELOG === '1';

function parseChangelogSections(text) {
  // 只认 `## ` 二级标题（Keep a Changelog 的版本段级别），标题里的版本取方括号内内容：
  // `## [3.7.4] - 2026-10-27` → '3.7.4'；`## [Unreleased]` → 'Unreleased'。
  const sections = new Map();
  let current = null;
  for (const line of text.split('\n')) {
    const heading = line.match(/^##\s+(.*)$/);
    if (heading) {
      const bracket = heading[1].match(/\[([^\]]+)\]/);
      current = bracket ? bracket[1].trim() : heading[1].trim();
      if (!sections.has(current)) sections.set(current, []);
      continue;
    }
    if (current !== null) sections.get(current).push(line);
  }
  return sections;
}

try {
  const changelogPath = path.join(root, 'CHANGELOG.md');
  if (!fs.existsSync(changelogPath)) {
    errors.push(
      `找不到 ${path.relative(root, changelogPath) || 'CHANGELOG.md'}，无法核对版本与 CHANGELOG 是否一致。` +
        `发版前请先建一个，并补上 \`## [${version}]\` 段。`,
    );
  } else {
    const sections = parseChangelogSections(fs.readFileSync(changelogPath, 'utf8'));
    if (!sections.has(version)) {
      const known = [...sections.keys()].filter((k) => /^\d+\.\d+\.\d+/.test(k));
      errors.push(
        `CHANGELOG.md 里没有 \`## [${version}]\` 段 —— 版本号凭空抬了，发布出去的版本没有任何变更说明。` +
          `请把 ${version} 的改动写进 CHANGELOG（已有的版本段：${known.slice(0, 6).join(' / ') || '无'}）。`,
      );
    }

    const unreleased = (sections.get('Unreleased') || []).join('\n');
    // 「有条目」的判据是存在列表项。`## [Unreleased]` 下写「_（下一版本待补充）_」
    // 这类占位说明不算条目，不该拦。
    if (/^\s*[-*+]\s+\S/m.test(unreleased)) {
      const firstEntries = unreleased
        .split('\n')
        .filter((l) => /^\s*[-*+]\s+\S/.test(l))
        .slice(0, 5)
        .map((l) => l.trim())
        .join('\n      ');
      if (allowUnreleasedChangelog) {
        console.warn(
          '[assert-publishable] ! ALLOW_UNRELEASED_CHANGELOG 已放行「CHANGELOG 的 [Unreleased] 仍有条目」—— 那些改动不会出现在本次发布的版本说明里。',
        );
      } else {
        errors.push(
          `CHANGELOG.md 的 \`## [Unreleased]\` 里还有条目没折叠进 \`## [${version}]\` ——` +
            `这些改动不会出现在本次发布的版本说明里，正是「代码在 main 上、能力不在 npm 上」的来源。` +
            `发版前请把它们移到 \`## [${version}]\` 段下。` +
            `\n    未折叠的条目：\n      ${firstEntries}`,
        );
      }
    }
  }
} catch (e) {
  errors.push(`读取 CHANGELOG.md 失败：${e.message}`);
}

// ── 结论 ─────────────────────────────────────────────────────────────────────
if (errors.length > 0) {
  console.error('[assert-publishable] ✗ 发布被守卫拦下：');
  for (const e of errors) console.error(`  • ${e}`);
  console.error(
    `[assert-publishable] 正确顺序：提交（含版本 bump）→ 合并进 main → git tag -a ${expectedTag} -m 'release(${pkg.name}): ${version}' → git push origin ${expectedTag} → scripts/publish.sh`,
  );
  process.exit(1);
}

const checks = [
  '依赖无本地协议',
  ...(isPlatform ? ['FALLBACK_VERSION 一致'] : []),
  `HEAD 已被 ${expectedTag} 指向`,
  allowUnmerged ? '未并入主干（已显式放行）' : '已并入主干',
  allowUnreleasedChangelog ? 'CHANGELOG 未折叠（已显式放行）' : 'CHANGELOG 已对上版本',
];
console.log(`[assert-publishable] ✓ ${pkg.name}@${version} 满足发布前提（${checks.join(' / ')}）`);
