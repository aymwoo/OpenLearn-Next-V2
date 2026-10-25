#!/usr/bin/env node
/**
 * 格式基线棘轮（Issue #236 后续 / 审计 P1-1）。
 *
 * ## 为什么在「全仓已干净」之后还要这个
 *
 * CI 的 format-check 作业此前只检查「**本次变更触及的文件**」。这条规则在
 * 有历史遗留问题时是刻意的（别让别人的旧问题变成当前 PR 的失败），但它有个
 * 结构性漏洞：**文件一旦合入 main，只要后续没有 PR 再碰它，就再也不会被任何
 * 一次 CI 检查**。
 *
 * 实测后果（2026-10-24 审计）：5 个文件不合规，其中 4 个来自当天合入的
 * #287/#288/#289/#290 —— 那三次 main push 的 CI **确实红了**（失败 job 就是
 * Format check），但因为后续 PR 不再触碰这些文件，HEAD 的 CI 11 个 job 全绿，
 * 而 main 里仍躺着不合规文件。**「CI 绿」在这里是不真实的。**
 *
 * 本脚本把格式检查改成**全仓基线棘轮**，与 `scripts/check-lint-budget.mjs`
 * 同构：
 *
 * - 基线（`config/format-budget.json`）是一份「允许暂时不合规的文件清单」；
 * - 清单**之外**出现不合规文件 → 失败（不许欠新债）；
 * - 清单里的文件被修好 → 提示可以 `--update` 收紧（不失败，与 lint 预算同口径）；
 * - 当前基线为空 —— 即**全仓必须合规**。
 *
 * 有了零基线，「整仓检查会把别人的历史遗留问题变成当前 PR 的失败」这个顾虑
 * 也不再成立：不合规只可能由某次提交引入，而那次提交对应的 PR 会是第一个
 * 看到全仓检查失败的地方 —— 也就是引入它的那一次。
 *
 * ## 用法
 *
 * ```bash
 * node scripts/check-format-budget.mjs           # 检查（CI 用；不合规即退出码 1）
 * node scripts/check-format-budget.mjs --update  # 把基线收紧为当前实际不合规清单
 * ```
 */
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const BUDGET_FILE = path.join(ROOT, 'config', 'format-budget.json');

/** 与 CI format-check 作业同一份扩展名集合（`.sh` 等不在 prettier 管辖范围）。 */
const EXTENSIONS = ['ts', 'tsx', 'mjs', 'js', 'json', 'md', 'yml', 'yaml', 'css'];

/** 单次调用的文件数上限 —— 避免 argv 过长（Windows 上限约 32k 字符）。 */
const BATCH_SIZE = 150;

function localDateStamp() {
  const now = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

/**
 * 受检文件集合：已跟踪的文件 + 未被忽略的未跟踪文件。
 *
 * 用 `git ls-files -co --exclude-standard` 而不是只取已跟踪：本地新写但还没
 * `git add` 的文件也该被检查（CI 里两者等价 —— checkout 出来的都是已跟踪的）。
 */
function collectFiles() {
  const stdout = execFileSync('git', ['ls-files', '-co', '--exclude-standard', '-z'], {
    cwd: ROOT,
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
  });
  return stdout
    .split('\0')
    .filter(Boolean)
    .filter((f) => EXTENSIONS.some((ext) => f.endsWith(`.${ext}`)));
}

/** 返回当前不合规（prettier --list-different）的文件列表。 */
function findNonCompliant(files) {
  const bad = [];
  for (let i = 0; i < files.length; i += BATCH_SIZE) {
    const batch = files.slice(i, i + BATCH_SIZE);
    try {
      const stdout = execFileSync('npx', ['prettier', '--list-different', '--', ...batch], {
        cwd: ROOT,
        encoding: 'utf8',
        maxBuffer: 64 * 1024 * 1024,
      });
      bad.push(...parseList(stdout));
    } catch (err) {
      // prettier 发现不合规文件时以非 0 退出，文件列表在 stdout 里。
      const stdout = err.stdout ? String(err.stdout) : '';
      if (!stdout) throw err;
      bad.push(...parseList(stdout));
    }
  }
  return bad.sort();
}

function parseList(stdout) {
  return stdout
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);
}

function readBudget() {
  if (!existsSync(BUDGET_FILE)) {
    throw new Error(`缺少基线文件 ${path.relative(ROOT, BUDGET_FILE)}`);
  }
  return JSON.parse(readFileSync(BUDGET_FILE, 'utf8'));
}

const files = collectFiles();
const nonCompliant = findNonCompliant(files);

if (process.argv.includes('--update')) {
  writeFileSync(
    BUDGET_FILE,
    `${JSON.stringify(
      {
        allowedNonCompliantFiles: nonCompliant,
        note: 'Issue #236 后续（审计 P1-1）：格式基线棘轮。清单里的文件允许暂时不合规；清单之外出现不合规文件即 CI 失败（不许欠新债）。清理后运行 `node scripts/check-format-budget.mjs --update` 收紧。基线为空 = 全仓必须合规。',
        updatedAt: localDateStamp(),
      },
      null,
      2,
    )}\n`,
    'utf8',
  );
  console.log(`[FormatBudget] 基线已更新：允许不合规的文件 ${nonCompliant.length} 个（共检查 ${files.length} 个文件）`);
  for (const f of nonCompliant) console.log(`  ${f}`);
  process.exit(0);
}

const budget = readBudget();
const allowed = new Set(budget.allowedNonCompliantFiles ?? []);
const allowedSet = new Set(allowed);
const violations = nonCompliant.filter((f) => !allowedSet.has(f));
const stale = [...allowed].filter((f) => !nonCompliant.includes(f));

console.log(
  `[FormatBudget] 检查 ${files.length} 个文件，不合规 ${nonCompliant.length} 个（基线允许 ${allowed.size} 个）`,
);

if (violations.length > 0) {
  console.error(`[FormatBudget] ${violations.length} 个文件格式不合规，且不在基线清单里：`);
  for (const f of violations) console.error(`  ${f}`);
  console.error(
    '  修复：pnpm exec prettier --write <文件>；' +
      '若确认这些文件需要保留原样（极少），把它们加进 config/format-budget.json 的 allowedNonCompliantFiles。',
  );
  process.exit(1);
}

if (stale.length > 0) {
  console.log(
    `[FormatBudget] 基线里有 ${stale.length} 个文件已合规 —— ` +
      `可以运行 node scripts/check-format-budget.mjs --update 收紧基线。`,
  );
}
