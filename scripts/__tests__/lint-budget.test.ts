/**
 * ESLint 告警预算棘轮（Issue #231）—— 配置与 CI 接线自检。
 *
 * 棘轮本身的价值完全取决于「它真的在 CI 里跑」：脚本被误删、基线文件被误改、
 * CI 步骤被删掉，都会让告警重新变成无人拦截的状态。这几条断言就是防这个。
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import path from 'node:path';

const ROOT = process.cwd();
const BUDGET_FILE = path.join(ROOT, 'config', 'lint-budget.json');
const SCRIPT_FILE = path.join(ROOT, 'scripts', 'check-lint-budget.mjs');
const CI_FILE = path.join(ROOT, '.github', 'workflows', 'ci.yml');

describe('ESLint 告警预算棘轮（Issue #231）', () => {
  it('基线文件存在且是合法的非负整数', () => {
    expect(existsSync(BUDGET_FILE)).toBe(true);
    const budget = JSON.parse(readFileSync(BUDGET_FILE, 'utf8'));
    expect(typeof budget.eslintMaxWarnings).toBe('number');
    expect(Number.isInteger(budget.eslintMaxWarnings)).toBe(true);
    expect(budget.eslintMaxWarnings).toBeGreaterThanOrEqual(0);
  });

  it('检查脚本存在', () => {
    expect(existsSync(SCRIPT_FILE)).toBe(true);
  });

  it('CI 里确实调用了告警预算检查（防止被误删）', () => {
    const ci = readFileSync(CI_FILE, 'utf8');
    expect(ci).toContain('check-lint-budget.mjs');
  });

  it('CI 里也跑 i18n 硬编码检查（package.json 里一直有，但此前不在 CI）', () => {
    const ci = readFileSync(CI_FILE, 'utf8');
    expect(ci).toContain('lint:i18n');
  });
});
