/**
 * doc-version 一致性门禁（`scripts/check-doc-version.mjs`）的回归测试。
 *
 * 它守的是一条 2026-10-27 实测出来的洞：`<!-- doc-version: sdk=X.Y.Z -->` 这个标记
 * 在全仓**零校验**，除 docs/ 外没有任何脚本读它 —— 它只是个注释。于是它安静地烂掉：
 * SDK 已发到 3.7.3 时，26 篇文档仍写 `sdk=3.7.2`，其中 `docs/sdk/scaffold-cli.md`
 * 顶着旧版本号描述着当时 npm 上**根本没有**的构建期守卫。读者按文档相信平台有这个
 * 能力，装回去的包里却没有，而门禁、CI、发版三处都不报。
 *
 * 这里盯住四件事：
 * 1. 标记写的版本 == 对应包 package.json 的 version（不一致 → 非 0 退出并点名文件行号）；
 * 2. 一致 → 退出 0，且报告里 checked 数正确；
 * 3. 认不出的标记键（比如拼错成 `sk=`）会被记为 unknown-key 而不是被静默放过；
 * 4. 根 `CHANGELOG.md` 顶部那句**人读的**版本注记同样要对上 —— 它不在 doc-version
 *    标记的范围内，2026-10-27 就出过一次「手改错、三处门禁都不报」。
 *    注记缺失也算失败：缺了就等于门禁静默失效。
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
/**
 * 造一个最小仓库骨架，跑真实脚本（不 mock）。
 *
 * `changelogNote` 控制根 CHANGELOG 顶部那句版本注记：
 * - 传 `null` 表示**不写** CHANGELOG.md（测「缺文件时不该白报」）；
 * - 传字符串则原样写入，用于构造注记漂移 / 注记缺失两种场景。
 */
function makeRepo(
  docVersionLine: string,
  opts: { sdkVersion?: string; testKitVersion?: string; changelogNote?: string | null } = {},
): string {
  const sdkVersion = opts.sdkVersion ?? '3.7.4';
  const testKitVersion = opts.testKitVersion ?? '3.3.3';
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'docver-'));
  fs.mkdirSync(path.join(dir, 'docs/api'), { recursive: true });
  fs.mkdirSync(path.join(dir, 'packages/plugin-sdk'), { recursive: true });
  fs.mkdirSync(path.join(dir, 'packages/plugin-test-kit'), { recursive: true });
  fs.mkdirSync(path.join(dir, 'audit-tools/reports'), { recursive: true });
  fs.writeFileSync(
    path.join(dir, 'packages/plugin-sdk/package.json'),
    JSON.stringify({ name: '@openlearn/plugin-sdk', version: sdkVersion }),
  );
  fs.writeFileSync(
    path.join(dir, 'packages/plugin-test-kit/package.json'),
    JSON.stringify({ name: '@openlearn/plugin-test-kit', version: testKitVersion }),
  );
  fs.writeFileSync(path.join(dir, 'docs/api/a.md'), `# A\n\n${docVersionLine}\n\n正文\n`);

  const note =
    opts.changelogNote === undefined
      ? `> \`@openlearn/plugin-sdk\` (currently **${sdkVersion}**) and \`@openlearn/plugin-test-kit\` (currently **${testKitVersion}**).`
      : opts.changelogNote;
  if (note !== null) {
    fs.writeFileSync(
      path.join(dir, 'CHANGELOG.md'),
      `# Changelog\n\nAll notable changes.\n\n${note}\n\nThe format is based on Keep a Changelog.\n`,
    );
  }
  return dir;
}

interface DocVersionItem {
  file: string;
  line: number;
  key: string;
  declared: string | null;
  expected: string | null;
  kind: 'drift' | 'unknown-key' | 'changelog-note-drift' | 'changelog-note-missing';
}

interface DocVersionReport {
  drift: number;
  checked: number;
  unparsable: number;
  items: DocVersionItem[];
  actualVersion: Record<string, string | null>;
}

function run(cwd: string): { code: number; stdout: string; stderr: string; report: DocVersionReport } {
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
    // 1 处 docs 标记 + 2 条 CHANGELOG 版本注记（sdk / test-kit）—— 注记也算「检查处数」
    expect(r.report.checked).toBe(3);
  });

  it('认不出的键记为 unknown-key，不静默放过', () => {
    const dir = makeRepo('<!-- doc-version: sk=9.9.9 -->');
    const r = run(dir);
    expect(r.code).toBe(0); // unknown-key 不计入 drift（避免拼错把 CI 打红）
    expect(r.report.unparsable).toBeGreaterThan(0);
    expect(r.report.items.some((i) => i.kind === 'unknown-key')).toBe(true);
  });

  // ── 根 CHANGELOG 的版本注记（doc-version 标记管不到的那一句）──────────
  //
  // 2026-10-27 实测：v0.7.5 发版准备时把这句里的 3.7.4 手改成 3.7.3（用了版本
  // bump 之前的过期测量）。doc-version 标记只管 docs/，于是**门禁、CI、发版三处
  // 都不报** —— 这句是给人读的版本承诺，属于同一类漂移。

  it('CHANGELOG 版本注记落后 → 拦下并指出该改哪一句', () => {
    const dir = makeRepo('<!-- doc-version: sdk=3.7.4 -->', {
      changelogNote:
        '> `@openlearn/plugin-sdk` (currently **3.7.3**) and `@openlearn/plugin-test-kit` (currently **3.3.3**).',
    });
    const r = run(dir);
    expect(r.code).not.toBe(0);
    const item = r.report.items.find((i) => i.kind === 'changelog-note-drift');
    expect(item).toMatchObject({ file: 'CHANGELOG.md', key: 'sdk', declared: '3.7.3', expected: '3.7.4' });
    expect(r.stderr).toContain('CHANGELOG.md');
  });

  it('CHANGELOG 缺少版本注记 → 同样拦下（缺注记等于门禁静默失效）', () => {
    const dir = makeRepo('<!-- doc-version: sdk=3.7.4 -->', { changelogNote: '# Changelog\n\n没有版本注记。\n' });
    const r = run(dir);
    expect(r.code).not.toBe(0);
    const missing = r.report.items.filter((i) => i.kind === 'changelog-note-missing');
    // sdk 与 test-kit 两条都缺
    expect(missing.map((i) => i.key).sort()).toEqual(['sdk', 'test-kit']);
    expect(r.report.unparsable).toBeGreaterThanOrEqual(2);
  });

  it('CHANGELOG 没有该文件时不白报（只查 docs 标记）', () => {
    const dir = makeRepo('<!-- doc-version: sdk=3.7.4 -->', { changelogNote: null });
    const r = run(dir);
    expect(r.code).toBe(0);
    expect(r.report.items.filter((i) => String(i.file).startsWith('CHANGELOG'))).toHaveLength(0);
  });

  it('注记一致时计入 checked（28 = 26 篇文档 + 2 条 CHANGELOG 注记，在本仓实测）', () => {
    const dir = makeRepo('<!-- doc-version: sdk=3.7.4 -->');
    const r = run(dir);
    expect(r.code).toBe(0);
    // 本用例骨架里只有 1 处 docs 标记 + 2 条 CHANGELOG 注记
    expect(r.report.checked).toBe(3);
    expect(r.report.drift).toBe(0);
  });
});
