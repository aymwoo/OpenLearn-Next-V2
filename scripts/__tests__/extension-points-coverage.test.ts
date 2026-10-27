/**
 * 扩展点覆盖门禁（`audit-tools/extension_points_coverage.py`）的回归测试。
 *
 * 这个门禁守的是一条已经被付过代价的规则：
 * 「插件能往内核注册哪些领域扩展点」必须写在插件文档里。
 * 2026-10-27 实测 9 个真实扩展点里有 6 个在 `docs/plugin/` 与 `docs/tutorials/`
 * 下从未出现（题库题型只散落在 `docs/architecture/assessment-model.md`），
 * 第三方作者的合理结论是「平台只支持 UI 槽位」。
 *
 * 这里盯住四件事：
 * 1. 真值从**源码**推导（`PLUGIN_RESOLVABLE_TOKENS` + 接口体里的 `register*`），
 *    不靠人手维护 token 清单；
 * 2. L0（插件文档里完全没出现）→ drift；L1/L2 只作提示；
 * 3. 豁免必须指明 `coveredBy` 文档，且该文档确实提到该方法（防「一刀切豁免」）；
 * 4. 豁免指向的 (token, method) 若在源码里已不存在 → drift（防过期豁免）。
 *
 * 跑法：`python3 audit-tools/extension_points_coverage.py`
 * 门禁本体在 `audit-tools/run.sh` 的 2.8 段接入，CI 的 docs-drift-audit 会跑。
 */
import { describe, it, expect } from 'vitest';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const REPO = path.resolve(__dirname, '../..');
const SCRIPT = path.join(REPO, 'audit-tools/extension_points_coverage.py');
const POLICY = path.join(REPO, 'audit-tools/extension-point-policy.json');

interface Report {
  candidates: number;
  exempted: number;
  graded: number;
  L0_missing: Array<{ token: string; method: string }>;
  L1_listed: Array<{ token: string; method: string }>;
  L2_indexed: Array<{ token: string; method: string }>;
  L3_full: Array<{ token: string; method: string }>;
  problems: Array<{ kind: string; token: string; method: string; reason: string }>;
  stats: { drift: number };
}

/** 在临时目录里跑门禁（报告写到临时路径，不污染仓库 reports/）。 */
function runGate(repo = REPO): { report: Report; stdout: string } {
  const out = fs.mkdtempSync(path.join(os.tmpdir(), 'extpt-gate-'));
  try {
    const stdout = execFileSync(
      'python3',
      [SCRIPT, '--repo', repo, '--json', path.join(out, 'r.json'), '--md', path.join(out, 'r.md')],
      { encoding: 'utf8', cwd: REPO },
    );
    const report = JSON.parse(fs.readFileSync(path.join(out, 'r.json'), 'utf8')) as Report;
    return { report, stdout };
  } finally {
    fs.rmSync(out, { recursive: true, force: true });
  }
}

describe('扩展点覆盖门禁', () => {
  it('当前仓库 drift=0：每个 register* 扩展点在插件文档里都有落点', () => {
    const { report } = runGate();

    expect(report.L0_missing).toEqual([]);
    expect(report.problems).toEqual([]);
    expect(report.stats.drift).toBe(0);
  });

  it('真值来自源码而非人手清单：候选数随源码变化', () => {
    const { report } = runGate();

    // 7 个领域扩展点（题型/环节 Gate/积分维度/AI 人格/AI 上下文/课堂阶段门禁/课堂互动）
    // + 命令与进程类（3 个豁免）
    expect(report.candidates).toBeGreaterThanOrEqual(10);
    expect(report.exempted).toBeGreaterThanOrEqual(3);
    // 豁免不参与评级
    expect(report.graded).toBe(report.candidates - report.exempted);
  });

  it('豁免必须指明 coveredBy 文档，且该文档确实提到该方法', () => {
    const policy = JSON.parse(fs.readFileSync(POLICY, 'utf8')) as {
      exemptions: Array<{ token: string; method: string; coveredBy?: string; reason?: string }>;
    };

    for (const ex of policy.exemptions) {
      expect(ex.coveredBy, `${ex.token}.${ex.method} 缺 coveredBy`).toBeTruthy();
      const text = fs.readFileSync(path.join(REPO, ex.coveredBy!), 'utf8');
      expect(text.includes(ex.method), `${ex.coveredBy} 里没有 ${ex.method} —— 豁免已过期`).toBe(true);
    }
  });

  it('负向对照：把扩展点从插件文档里摘掉 → 门禁必须报 drift', () => {
    // 复制一个最小仓库副本：源码 + 策略 + 被改动的文档
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'extpt-neg-'));
    try {
      fs.mkdirSync(path.join(tmp, 'packages/core/di'), { recursive: true });
      fs.mkdirSync(path.join(tmp, 'audit-tools'), { recursive: true });
      fs.mkdirSync(path.join(tmp, 'docs/plugin'), { recursive: true });

      fs.copyFileSync(
        path.join(REPO, 'packages/core/di/interfaces.ts'),
        path.join(tmp, 'packages/core/di/interfaces.ts'),
      );
      fs.copyFileSync(POLICY, path.join(tmp, 'audit-tools/extension-point-policy.json'));
      fs.copyFileSync(SCRIPT, path.join(tmp, 'audit-tools/extension_points_coverage.py'));

      // 只放一份「不含任何 register* 方法名」的插件文档
      fs.writeFileSync(path.join(tmp, 'docs/plugin/extension-registry.md'), '# 空的插件文档\n', 'utf8');

      const { report } = runGate(tmp);
      expect(report.L0_missing.length).toBeGreaterThan(0);
      expect(report.stats.drift).toBeGreaterThan(0);
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });

  it('负向对照：豁免指向源码里已不存在的方法 → 报 stale_exemption', () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'extpt-stale-'));
    try {
      fs.mkdirSync(path.join(tmp, 'packages/core/di'), { recursive: true });
      fs.mkdirSync(path.join(tmp, 'audit-tools'), { recursive: true });
      fs.mkdirSync(path.join(tmp, 'docs/plugin'), { recursive: true });
      fs.mkdirSync(path.join(tmp, 'docs/tutorials'), { recursive: true });

      fs.copyFileSync(
        path.join(REPO, 'packages/core/di/interfaces.ts'),
        path.join(tmp, 'packages/core/di/interfaces.ts'),
      );
      fs.copyFileSync(SCRIPT, path.join(tmp, 'audit-tools/extension_points_coverage.py'));
      fs.writeFileSync(path.join(tmp, 'docs/plugin/extension-registry.md'), '# 空的插件文档\n', 'utf8');

      // 策略里塞一条源码中不存在的豁免
      const policy = JSON.parse(fs.readFileSync(POLICY, 'utf8')) as Record<string, unknown>;
      policy.exemptions = [
        {
          token: 'IStageGuardServiceToken',
          method: 'registerThisMethodDoesNotExist',
          coveredBy: 'docs/plugin/extension-registry.md',
          reason: '人为构造的过期豁免',
        },
      ];
      fs.writeFileSync(
        path.join(tmp, 'audit-tools/extension-point-policy.json'),
        JSON.stringify(policy, null, 2),
        'utf8',
      );

      const { report } = runGate(tmp);
      expect(report.problems.some((p) => p.kind === 'stale_exemption')).toBe(true);
      expect(report.stats.drift).toBeGreaterThan(0);
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });
});
