#!/usr/bin/env node
/**
 * doc-version 一致性校验 —— 文档声明的包版本必须等于 package.json 的 version。
 *
 * 为什么需要它：2026-10-27 实测，`<!-- doc-version: sdk=X.Y.Z -->` 这个标记在
 * 全仓**零校验**（除 docs/ 外没有任何脚本读它），它只是个注释。于是它安静地烂掉：
 * SDK 已经发到 3.7.3，而 26 篇文档仍写着 `sdk=3.7.2`。
 *
 * 这不是排版问题。`docs/sdk/scaffold-cli.md` 顶着 `sdk=3.7.2` 却描述着 3.7.4 才
 * 有的构建期守卫 —— 读者按文档相信平台有这个能力，装回去的 npm 包里却没有。
 * 「文档承诺了 registry 上不存在的能力」比「文档过时」严重得多，而且**没有任何
 * 信号**：门禁不报、CI 不报、发版不报。
 *
 * 判据很简单：标记里写的版本号，必须等于对应包 package.json 的 version。
 * 发版抬了版本号就得同步抬标记 —— 一件本来就该在发版 PR 里做完的事。
 *
 * 覆盖两类声明（2026-10-27 起）：
 *   1. `docs/**` 里的 `<!-- doc-version: sdk=X.Y.Z -->` 标记；
 *   2. 根 `CHANGELOG.md` 顶部那句人读的版本注记
 *      （`\`@openlearn/plugin-sdk\` (currently **X.Y.Z**) ...`）。
 *
 * 第 2 类是补上的洞：v0.7.5 发版准备时把这句的 3.7.4 手改成 3.7.3（用了版本 bump
 * 之前的过期测量），而第 1 类只管 `docs/` —— 于是门禁、CI、发版三处都不报。
 *
 * 退出码：0 一致；1 有漂移并逐条打印文件与修复命令。
 */
import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();

// ── 参数 ──────────────────────────────────────────────────────────────────
const argv = process.argv.slice(2);
const argVal = (name) => {
  const i = argv.findIndex((a) => a === name || a.startsWith(`${name}=`));
  if (i === -1) return null;
  return argv[i].includes('=') ? argv[i].slice(argv[i].indexOf('=') + 1) : argv[i + 1];
};
const jsonOut = argVal('--json') || 'audit-tools/reports/doc_version_report.json';
const mdOut = argVal('--md') || 'audit-tools/reports/doc_version_report.md';

// ── 标记键 → 包目录 ───────────────────────────────────────────────────────
// 推导而非「由调用方传包名」：与 assert-publishable.mjs 同一个理由，
// 少一个能被传错的参数就少一条绕过路径。
const KEY_TO_PKG = {
  sdk: 'packages/plugin-sdk',
  'test-kit': 'packages/plugin-test-kit',
  platform: '.',
};

const MARKER_RE = /<!--\s*doc-version:\s*([^>]*?)\s*-->/g;
const PAIR_RE = /([A-Za-z][A-Za-z0-9_-]*)\s*=\s*([0-9]+\.[0-9]+\.[0-9]+(?:[-+][0-9A-Za-z.-]+)?)/g;

function readPkgVersion(dir) {
  try {
    return JSON.parse(fs.readFileSync(path.join(root, dir, 'package.json'), 'utf8')).version;
  } catch {
    return null;
  }
}

function walk(dir, out = []) {
  if (!fs.existsSync(dir)) return out;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name.startsWith('.')) continue;
    const p = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(p, out);
    else if (entry.name.endsWith('.md')) out.push(p);
  }
  return out;
}

const actualVersion = {};
for (const [key, dir] of Object.entries(KEY_TO_PKG)) actualVersion[key] = readPkgVersion(dir);

const items = [];
let checked = 0;
let unparsable = 0;

for (const file of walk(path.join(root, 'docs'))) {
  const text = fs.readFileSync(file, 'utf8');
  let m;
  MARKER_RE.lastIndex = 0;
  while ((m = MARKER_RE.exec(text)) !== null) {
    const line = text.slice(0, m.index).split('\n').length;
    let pair;
    let found = false;
    PAIR_RE.lastIndex = 0;
    while ((pair = PAIR_RE.exec(m[1])) !== null) {
      found = true;
      const [, key, declared] = pair;
      const expected = actualVersion[key];
      if (!expected) {
        unparsable++;
        items.push({ file: path.relative(root, file), line, key, declared, expected: null, kind: 'unknown-key' });
        continue;
      }
      checked++;
      if (declared !== expected) {
        items.push({ file: path.relative(root, file), line, key, declared, expected, kind: 'drift' });
      }
    }
    if (!found) unparsable++;
  }
}

// ── 根 CHANGELOG 的版本注记 ───────────────────────────────────────────────
//
// doc-version 标记只管 docs/。根 CHANGELOG 顶部那句
//
//   > `@openlearn/plugin-sdk` (currently **X.Y.Z**) and `@openlearn/plugin-test-kit` (currently **X.Y.Z**).
//
// 此前不在任何门禁覆盖内 —— 实测后果：v0.7.5 发版准备时把这句里的 3.7.4 手改成 3.7.3
// （用了版本 bump 之前的过期测量），门禁、CI、发版三处**都不报**。
// 它和 doc-version 是同一类漂移：文档对「registry 上有什么版本」的承诺。
//
// 容错解析：包名之后 60 字符内出现 `currently **X.Y.Z**` 即视为该包的声明，
// 这样改标点/换行不会误报，改数字才会。
const CHANGELOG_FILE = 'CHANGELOG.md';
const NOTE_PKGS = [
  { key: 'sdk', pkg: '@openlearn/plugin-sdk' },
  { key: 'test-kit', pkg: '@openlearn/plugin-test-kit' },
];

if (fs.existsSync(path.join(root, CHANGELOG_FILE))) {
  const text = fs.readFileSync(path.join(root, CHANGELOG_FILE), 'utf8');
  for (const { key, pkg } of NOTE_PKGS) {
    const escaped = pkg.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const re = new RegExp('`' + escaped + '`[^\\n]{0,60}?currently\\s*\\*{0,2}([0-9]+\\.[0-9]+\\.[0-9]+)');
    const m = re.exec(text);
    if (!m) {
      unparsable++;
      items.push({
        file: CHANGELOG_FILE,
        line: 1,
        key,
        declared: null,
        expected: actualVersion[key],
        kind: 'changelog-note-missing',
      });
      continue;
    }
    const line = text.slice(0, m.index).split('\n').length;
    checked++;
    if (m[1] !== actualVersion[key]) {
      items.push({
        file: CHANGELOG_FILE,
        line,
        key,
        declared: m[1],
        expected: actualVersion[key],
        kind: 'changelog-note-drift',
      });
    }
  }
}

const drift = items.filter((i) => i.kind !== 'unknown-key');

// ── 报告 ──────────────────────────────────────────────────────────────────
for (const out of [jsonOut, mdOut]) {
  const dir = path.dirname(path.join(root, out));
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

fs.writeFileSync(
  path.join(root, jsonOut),
  `${JSON.stringify({ drift: drift.length, checked, unparsable, actualVersion, items }, null, 2)}\n`,
);

const lines = [
  '# doc-version 一致性报告',
  '',
  `检查 ${checked} 处标记，漂移 ${drift.length} 处。`,
  '',
  '| 包 | package.json |',
  '| --- | --- |',
  ...Object.entries(actualVersion).map(([k, v]) => `| \`${k}\` | ${v ?? '（读不到）'} |`),
  '',
];
if (drift.length) {
  lines.push('## 漂移明细', '', '| 文件 | 行 | 键 | 文档声明 | 实际 |', '| --- | --- | --- | --- | --- |');
  for (const i of drift) lines.push(`| ${i.file} | ${i.line} | \`${i.key}\` | ${i.declared} | ${i.expected} |`);
  lines.push('');
}
fs.writeFileSync(path.join(root, mdOut), `${lines.join('\n')}\n`);

if (drift.length === 0) {
  console.log(`[doc-version] ✓ ${checked} 处标记与 package.json 一致（见 ${mdOut}）`);
  process.exit(0);
}

console.error(`[doc-version] ✗ ${drift.length} 处 doc-version 漂移（共检查 ${checked} 处）：`);
for (const i of drift) {
  console.error(`  • ${i.file}:${i.line}  ${i.key}=${i.declared} → 应为 ${i.expected}`);
}
console.error('');
console.error(
  `[doc-version] 这些文档声明的包版本已经和 package.json 不一致，读者会照着文档去用 registry 上不存在的（或不存在的）能力。` +
    `\n  修法（把对应标记抬到实际版本）：`,
);
const markerDrift = drift.filter((i) => i.file !== CHANGELOG_FILE);
const noteDrift = drift.filter((i) => i.file === CHANGELOG_FILE);

const byKey = new Map();
for (const i of markerDrift) {
  if (!byKey.has(i.key)) byKey.set(i.key, { expected: i.expected, files: [] });
  byKey.get(i.key).files.push(i.file);
}
for (const [key, { expected, files }] of byKey) {
  console.error(`\n    # ${key} → ${expected}`);
  console.error(
    `    ${files.map((f) => `docs/${path.relative(path.join(root, 'docs'), path.join(root, f))}`).join(' ')} \\`,
  );
  console.error(
    `      | xargs sed -i 's/doc-version: ${key}=[0-9]\\+\\.[0-9]\\+\\.[0-9]\\+/doc-version: ${key}=${expected}/'`,
  );
}
if (noteDrift.length) {
  console.error(`\n    # ${CHANGELOG_FILE} 顶部的版本注记（人读的那句）`);
  for (const i of noteDrift) {
    if (i.declared === null) {
      console.error(
        `    ${CHANGELOG_FILE}: 缺少 \`${i.key === 'sdk' ? '@openlearn/plugin-sdk' : '@openlearn/plugin-test-kit'}\` 的 ` +
          `\`(currently **X.Y.Z**)\` 注记 → 补上 ${i.expected}`,
      );
    } else {
      console.error(`    ${CHANGELOG_FILE}:${i.line}  ${i.declared} → ${i.expected}`);
    }
  }
}
console.error(`\n  报告：${mdOut}`);
process.exit(1);
