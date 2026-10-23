#!/usr/bin/env node
/**
 * ESLint 告警预算棘轮（Issue #231）。
 *
 * 背景：`pnpm lint:eslint` 此前**不在 CI 里** —— ESLint 当时有 6186 条告警（0 error），
 * 无人拦截，可以无限增长。类型检查（`lint` / `lint:strict`）对 `any` 这类位置无能为力：
 * `any` 会静默吞掉调用方契约错误。
 *
 * 做法（与覆盖率棘轮同构）：
 * - 基线记录在 `config/lint-budget.json`；
 * - 实际告警数 **超过** 基线 → 失败（不许欠新债）；
 * - 实际告警数 **低于** 基线 → 通过，并提示可以收紧基线；
 * - `node scripts/check-lint-budget.mjs --update` 把基线写成当前值（清理告警后用）。
 *
 * 注意：ESLint 的告警数只取决于仓库里的文件集合，与机器无关 —— 同一份代码在任何
 * 机器上都是同一个数字，所以基线可以安全地提交进仓库。
 */
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import path from 'node:path';

const ROOT = process.cwd();
const BUDGET_FILE = path.join(ROOT, 'config', 'lint-budget.json');

/** 与 package.json 的 lint:eslint 脚本保持一致 —— 同一份文件集合，数字才有可比性。 */
const ESLINT_ARGS = [
  '.',
  '--ext',
  '.ts,.tsx',
  '--ignore-pattern',
  'dist',
  '--ignore-pattern',
  'node_modules',
];

function readBudget() {
  if (!existsSync(BUDGET_FILE)) {
    throw new Error(`缺少基线文件 ${path.relative(ROOT, BUDGET_FILE)}`);
  }
  return JSON.parse(readFileSync(BUDGET_FILE, 'utf8'));
}

function runEslint() {
  let stdout = '';
  try {
    stdout = execFileSync('npx', ['eslint', ...ESLINT_ARGS, '--format', 'json'], {
      cwd: ROOT,
      encoding: 'utf8',
      maxBuffer: 256 * 1024 * 1024,
      stdio: ['ignore', 'pipe', 'inherit'],
    });
  } catch (err) {
    // ESLint 在有 error 时以非 0 退出；JSON 仍在 stdout 里，照常解析。
    if (err.stdout) {
      stdout = typeof err.stdout === 'string' ? err.stdout : String(err.stdout);
    } else {
      throw err;
    }
  }
  const results = JSON.parse(stdout || '[]');
  let errors = 0;
  let warnings = 0;
  for (const file of results) {
    for (const msg of file.messages ?? []) {
      if (msg.severity === 2) errors += 1;
      else if (msg.severity === 1) warnings += 1;
    }
  }
  return { errors, warnings };
}

const budget = readBudget();
const { errors, warnings } = runEslint();

if (process.argv.includes('--update')) {
  writeFileSync(
    BUDGET_FILE,
    `${JSON.stringify(
      {
        ...budget,
        eslintMaxWarnings: warnings,
        updatedAt: new Date().toISOString().slice(0, 10),
      },
      null,
      2,
    )}\n`,
    'utf8',
  );
  console.log(`[LintBudget] 基线已更新：eslintMaxWarnings = ${warnings}（error ${errors}）`);
  process.exit(0);
}

const maxWarnings = budget.eslintMaxWarnings;
console.log(`[LintBudget] ESLint 告警 ${warnings} 条（上限 ${maxWarnings}），error ${errors} 条`);

if (errors > 0) {
  console.error(`[LintBudget] ESLint 报出 ${errors} 个 error —— 必须是 0。`);
  process.exit(1);
}

if (warnings > maxWarnings) {
  const delta = warnings - maxWarnings;
  console.error(
    `[LintBudget] 告警数超过基线 ${delta} 条（${warnings} > ${maxWarnings}）。\n` +
      `  请修掉这些告警，或在清理告警后运行：node scripts/check-lint-budget.mjs --update`,
  );
  process.exit(1);
}

if (warnings < maxWarnings) {
  console.log(
    `[LintBudget] 告警数已低于基线 ${maxWarnings - warnings} 条 —— ` +
      `可以运行 node scripts/check-lint-budget.mjs --update 收紧基线。`,
  );
}
