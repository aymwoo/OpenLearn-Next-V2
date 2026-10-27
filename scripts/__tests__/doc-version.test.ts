/**
 * doc-version 一致性门禁（`scripts/check-doc-version.mjs`）的回归测试。
 *
 * 它守的是一条 2026-10-27 实测出来的洞：`<!-- doc-version: sdk=X.Y.Z -->` 这个标记
 * 在全仓**零校验**，除 docs/ 外没有任何脚本读它 —— 它只是个注释。于是它安静地烂掉：
 * SDK 已发到 3.7.3 时，26 篇文档仍写 `sdk=3.7.2`，其中 `docs/sdk/scaffold-cli.md`
 * 顶着旧版本号描述着当时 npm 上**根本没有**的构建期守卫。读者按文档相信平台有这个
 * 能力，装回去的包里却没有，而门禁、CI、发版三处都不报。
 *
 * 这里盯住三件事：
 * 1. 标记写的版本 == 对应包 package.json 的 version（不一致 → 非 0 退出并点名文件行号）；
 * 2. 一致 → 退出 0，且报告里 checked 数正确；
 * 3. 认不出的标记键（比如拼错成 `sk=`）会被记为 unknown-key 而不是被静默放过。
 *
 * 跑法：`node scripts/check-doc-version.mjs`
 * 门禁本体在 `audit-tools/run.sh` 的 2.9 段接入（计入 drift），CI 的 docs-drift-audit 会跑。
 */
import { describe, it, expect } from 'vitest';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const REPO_ROOT = path.resolve(__dirname, '../..');
const SCRIPT = path.join(REPO_ROOT, 'scripts/check-doc-version.mjs');
const NODE = process.execPath;

/** 造一个最小仓库骨架，跑真实脚本（不 mock —— 与 CLI 类测试同一手法）。 */
function makeRepo(docVersionLine: string, sdkVersion = '3.7.4'): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'docver-'));
  fs.mkdirSync(path.join(dir, 'docs/api'), { recursive: true });
  fs.mkdirSync(path.join(dir, 'packages/plugin-sdk'), { recursive: true });
  fs.mkdirSync(path.join(dir, 'audit-tools/reports'), { recursive: true });
  fs.writeFileSync(
    path.join(dir, 'packages/plugin-sdk/package.json'),
    JSON.stringify({ name: '@openlearn/plugin-sdk', version: sdkVersion }),
  );
  fs.writeFileSync(path.join(dir, 'docs/api/a.md'), `# A\n\n${docVersionLine}\n\n正文\n`);
  return dir;
}

function run(cwd: string): { code: number; stdout: string; stderr: string; report: any } {
  let code = 0;
  let stdout = '';
  let stderr = '';
  try {
    stdout = execFileSync(
      NODE,
      [SCRIPT, '--json', 'audit-tools/reports/dv.json', '--md', 'audit-tools/reports/dv.md'],
      {
        cwd,
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'pipe'],
      },
    );
  } catch (e: any) {
    code = e.status ?? 1;
    stdout = e.stdout ?? '';
    stderr = e.stderr ?? '';
  }
  const report = JSON.parse(fs.readFileSync(path.join(cwd, 'audit-tools/reports/dv.json'), 'utf8'));
  return { code, stdout, stderr, report };
}

describe('check-doc-version', () => {
  it('文档声明的版本落后于 package.json → 拦下并点名文件与行号', () => {
    const dir = makeRepo('<!-- doc-version: sdk=3.7.2 -->');
    const r = run(dir);
    expect(r.code).not.toBe(0);
    expect(r.report.drift).toBe(1);
    expect(r.report.items[0]).toMatchObject({
      file: 'docs/api/a.md',
      line: 3,
      key: 'sdk',
      declared: '3.7.2',
      expected: '3.7.4',
    });
    expect(r.stderr).toContain('docs/api/a.md:3');
  });

  it('版本一致 → 放行，且报告给出检查处数', () => {
    const dir = makeRepo('<!-- doc-version: sdk=3.7.4 -->');
    const r = run(dir);
    expect(r.code).toBe(0);
    expect(r.report.drift).toBe(0);
    expect(r.report.checked).toBe(1);
  });

  it('认不出的键记为 unknown-key，不静默放过', () => {
    const dir = makeRepo('<!-- doc-version: sk=9.9.9 -->');
    const r = run(dir);
    expect(r.code).toBe(0); // unknown-key 不计入 drift（避免拼错把 CI 打红）
    expect(r.report.unparsable).toBeGreaterThan(0);
    expect(r.report.items.some((i: any) => i.kind === 'unknown-key')).toBe(true);
  });
});
