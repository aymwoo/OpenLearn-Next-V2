/**
 * 格式基线棘轮（Issue #236 后续 / 审计 P1-1）—— 配置与 CI 接线自检。
 *
 * 棘轮的价值完全取决于「它真的在 CI 里跑」：脚本被误删、基线文件被误改、
 * CI 步骤被删掉，都会让格式重新变成无人拦截的状态。这几条断言就是防这个。
 *
 * 额外钉住「基线必须为空」这条不变量：基线非空意味着有文件被豁免，
 * 而豁免清单是责任漂移的温床 —— 修好一个就要收紧一次。
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import path from 'node:path';

const ROOT = process.cwd();
const BUDGET_FILE = path.join(ROOT, 'config', 'format-budget.json');
const SCRIPT_FILE = path.join(ROOT, 'scripts', 'check-format-budget.mjs');
const CI_FILE = path.join(ROOT, '.github', 'workflows', 'ci.yml');

describe('格式基线棘轮（Issue #236 后续 / 审计 P1-1）', () => {
  it('基线文件存在且结构合法', () => {
    expect(existsSync(BUDGET_FILE)).toBe(true);
    const budget = JSON.parse(readFileSync(BUDGET_FILE, 'utf8'));
    expect(Array.isArray(budget.allowedNonCompliantFiles)).toBe(true);
    expect(budget.allowedNonCompliantFiles.every((f: unknown) => typeof f === 'string')).toBe(true);
  });

  it('基线清单为空 —— 全仓必须合规（修好一个就要收紧一次）', () => {
    const budget = JSON.parse(readFileSync(BUDGET_FILE, 'utf8'));
    expect(budget.allowedNonCompliantFiles, '基线里还有被豁免的文件：格式债没有清零，责任漂移的温床仍在').toEqual([]);
  });

  it('检查脚本存在', () => {
    expect(existsSync(SCRIPT_FILE)).toBe(true);
  });

  it('CI 里确实调用了格式基线检查（防止被误删）', () => {
    const ci = readFileSync(CI_FILE, 'utf8');
    expect(ci).toContain('check-format-budget.mjs');
  });

  it('CI 的格式作业不再退回「只检查本次变更触及的文件」', () => {
    const ci = readFileSync(CI_FILE, 'utf8');
    // 「Collect changed files」步骤正是责任漂移漏洞的来源：文件进了 main 之后
    // 就再也不会被检查。改成全仓基线棘轮后，这个步骤必须消失。
    expect(ci).not.toContain('Collect changed files');
  });

  it('棘轮脚本不含 TypeScript 类型注解（.mjs 只能跑纯 JS）', () => {
    const src = readFileSync(SCRIPT_FILE, 'utf8');
    expect(src).not.toMatch(/function\s+\w+\([^)]*\)\s*:\s*\w/);
    expect(src).not.toMatch(/const\s+\w+\s*:\s*(string|number|boolean)\[\]/);
  });
});
