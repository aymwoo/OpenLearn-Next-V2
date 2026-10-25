#!/usr/bin/env node
/**
 * coverage-ratchet.mjs — 覆盖率棘轮（Issue #232）。
 *
 * 问题：vitest thresholds 是固定底线（防塌方），行覆盖曾可回退 17pp 仍全绿。
 * 棘轮 = 提交在仓的 coverage-baseline.json 记录当前实测水位；CI 的 coverage
 * job 在测试后运行本脚本，实际值低于基线（容差 -0.5pp 防抖动）即失败，
 * 并输出如何上调基线。
 *
 * 基线只升不降：
 *   - 覆盖率上升后，随功能 PR 手动把 coverage-baseline.json 的对应字段改为新值；
 *   - 任何「下调基线」的改动需要在 PR 描述里说明理由（例如大规模删除死代码）。
 *
 * 用法：node scripts/coverage-ratchet.mjs [coverage-summary.json 路径]
 *   默认 coverage/coverage-summary.json（vitest --coverage.reporter=json-summary 产物）。
 */
import fs from 'node:fs';
import path from 'node:path';

const TOLERANCE_PP = 0.5;
const METRICS = ['lines', 'statements', 'functions', 'branches'];

const summaryPath = process.argv[2] || 'coverage/coverage-summary.json';
const baselinePath = path.resolve('coverage-baseline.json');

function fail(msg) {
  console.error(`[coverage-ratchet] ${msg}`);
  process.exit(1);
}

if (!fs.existsSync(summaryPath)) {
  fail(`覆盖率摘要不存在：${summaryPath}（请先运行 pnpm test:coverage -- --coverage.reporter=json-summary）`);
}
if (!fs.existsSync(baselinePath)) {
  fail(`基线文件不存在：${baselinePath}`);
}

const summary = JSON.parse(fs.readFileSync(summaryPath, 'utf8'));
const baseline = JSON.parse(fs.readFileSync(baselinePath, 'utf8'));
const total = summary.total;
if (!total) fail('coverage-summary.json 缺少 total 字段，产物格式异常');

const regressions = [];
const improvements = [];
for (const metric of METRICS) {
  const actual = total[metric]?.pct;
  const base = baseline[metric];
  if (typeof actual !== 'number' || typeof base !== 'number') {
    fail(`指标 ${metric} 缺失（actual=${actual}, baseline=${base}）`);
  }
  if (actual < base - TOLERANCE_PP) {
    regressions.push(
      `  ${metric}: 实际 ${actual.toFixed(2)}% < 基线 ${base.toFixed(2)}%（回退 ${(base - actual).toFixed(2)}pp）`,
    );
  } else if (actual > base + TOLERANCE_PP) {
    improvements.push(`  ${metric}: ${base.toFixed(2)} → ${actual.toFixed(2)}%（可上调基线）`);
  }
}

if (regressions.length > 0) {
  console.error('[coverage-ratchet] 覆盖率回退，拒绝通过：');
  console.error(regressions.join('\n'));
  console.error('如属有意删除代码导致，请在 PR 中说明并下调 coverage-baseline.json（需复核）；否则请补测试。');
  process.exit(1);
}

if (improvements.length > 0) {
  console.log('[coverage-ratchet] 覆盖率高于基线，建议随本 PR 上调 coverage-baseline.json：');
  console.log(improvements.join('\n'));
}
console.log(
  `[coverage-ratchet] OK：lines ${total.lines.pct.toFixed(2)}% / statements ${total.statements.pct.toFixed(2)}% / ` +
    `functions ${total.functions.pct.toFixed(2)}% / branches ${total.branches.pct.toFixed(2)}% ≥ 基线`,
);
