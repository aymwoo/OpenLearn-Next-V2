/**
 * SDK 契约漂移防回归门禁（审计 E-2）。
 *
 * ## 为什么需要这个测试
 *
 * 旧的 parity 测试（`openlearn-dts-parity.test.ts`）只比对 `*Token` 的**名字集合**，
 * 对签名/类型漂移一律无感 —— 历史上 d.ts 曾缺 14/33 个 Token（插件 import 即 TS2305），
 * 但同一批测试对「`PluginInfo` 少了 `has_frontend`」「`IAIService` 少了两个可选方法」
 * 这类漂移完全沉默。数字对得上，契约却已经烂了。
 *
 * 本测试用 TypeScript 编译器 API 做**成员级**比对（见 helpers/sdk-drift-analyzer.ts），
 * 覆盖面从「Token 名」扩展到全部可达导出符号及其成员。
 *
 * ## 基线策略
 *
 * 漂移条目现已达 130+，手写清单必然与实际脱节，而脱节本身又是一种失真。
 * 因此基线落在**快照文件** `fixtures/sdk-drift-baseline.json`，由
 * `scripts/sdk-drift-baseline.mts` 生成：
 *
 * - 出现快照之外的新漂移 → 失败（防止新漂移悄悄进来）
 * - 快照里的漂移被修复 → 失败（提示该重生成快照，避免基线只增不减）
 *
 * 详见该脚本头部注释。
 */
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { analyzeSdkDrift, formatDrift } from './helpers/sdk-drift-analyzer.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SDK_DIR = path.resolve(__dirname, '..');
const BASELINE_FILE = path.join(__dirname, 'fixtures/sdk-drift-baseline.json');
/** generate-dts.mjs 以 `packages/plugin-sdk` 为基准解析相对路径，cwd 必须是仓库根 */
const repoRoot = () => path.resolve(SDK_DIR, '../..');

interface DriftBaseline {
  ghostWithMembers: string[];
  ghostAll: string[];
  reverseValues: string[];
  reverseTypes: string[];
  memberDrift: Array<{ name: string; onlyIndex: string[]; onlyDts: string[] }>;
}

const baseline: DriftBaseline = JSON.parse(fs.readFileSync(BASELINE_FILE, 'utf-8'));
const report = analyzeSdkDrift(SDK_DIR);

/**
 * 已收回对外承诺的符号（D-2 / D-6 决策，SDK 3.8.0）。
 *
 * 这些符号在 `openlearn.d.ts` 里仍有声明（内核侧继续可用），但刻意不进导出块。
 * 因此漂移分析器会把它们判成**反向漂移·运行时值**（d.ts 声明 / index 未导出），
 * 消费侧若真去 `import` 会拿到 TS2693。
 *
 * 这与「反向漂移必须清零」的门禁直接冲突 —— 但不是门禁错了，而是这批符号属于
 * **有意为之**的撤回。所以这里显式列出，让门禁对「意外的反向漂移」保持严格，
 * 同时对这批已知撤回项放行。放行清单与generate-dts.mjs 的
 * `WITHDRAWN_FROM_SDK` 一一对应，两处必须同步改。
 */
const WITHDRAWN_FROM_SDK = [
  'ICapabilityGovernanceServiceToken',
  'IPluginCapabilityGatewayToken',
  'IPluginRuntimeCompositionToken',
  'IUnifiedExtensionRegistryToken',
];

const currentGhost = report.ghost.map((g) => g.name).sort();
const currentGhostWithMembers = report.ghost
  .filter((g) => g.surface.members.length > 0)
  .map((g) => g.name)
  .sort();
const currentReverse = report.reverseValues.map((r) => r.name).sort();
const currentMemberNames = report.memberDrift.map((m) => m.name).sort();

function newlyIntroduced(baselineList: string[], currentList: string[]): string[] {
  return currentList.filter((n) => !baselineList.includes(n));
}

function resolved(baselineList: string[], currentList: string[]): string[] {
  return baselineList.filter((n) => !currentList.includes(n));
}

describe('SDK 契约成员级漂移门禁（E-2）', () => {
  it('分析器确实读到了两侧声明面（防空跑假绿）', () => {
    // 路径写错 / 解析器失效会让收集数为 0，此时下面所有「不新增」断言都会
    // 因为 current 为空而**自动通过** —— 变成一整套假绿。
    // 因此这里直接断言收集规模，而不是断言某个具体漂移类别非空
    // （漂移类别会随整改归零，用它做断言必然在收敛后失效）。
    expect(report.collected.index, 'index.ts 侧收集到的符号数').toBeGreaterThan(150);
    expect(report.collected.dts, 'openlearn.d.ts 侧收集到的符号数').toBeGreaterThan(80);
  });

  it('成员级漂移不新增', () => {
    const added = newlyIntroduced(
      baseline.memberDrift.map((m) => m.name),
      currentMemberNames,
    );
    expect(
      added,
      `出现未登记的成员级漂移 ${added.length} 个。新增漂移必须二选一：\n` +
        `  ① 补 openlearn.d.ts 声明（或补 core 侧接口声明）\n` +
        `  ② 判定为无需暴露 → 修实现侧，或登记进快照并写明原因\n\n完整报告：\n${formatDrift(report)}`,
    ).toEqual([]);
  });

  it('幽灵符号（index 导出 / d.ts 未可用）必须清零', () => {
    // 这里用 ghostAll 而非 ghostWithMembers：实测确认无成员符号同样会失败 ——
    //   · 运行时值（class/const）→ TS2305 / TS2724
    //   · 纯类型但未进 d.ts 导出块 → TS2459「declares locally, but is not exported」
    // 早期版本只检查「带成员」的那批，而该集合一度为 0，断言形同虚设。
    //
    // 现在基线已归零（148 → 0，由 generate-dts.mjs 生成声明 + 补导出块），
    // 因此从「不新增」升级为「必须为空」—— 否则新幽灵又会以「已登记」的形式沉淀。
    expect(
      currentGhost,
      `出现幽灵符号 ${currentGhost.length} 个 —— 第三方插件 import 会得到 TS2305 / TS2724 / TS2459。\n` +
        `index.ts 导出了但消费侧 d.ts 里没有的符号。修法：\n` +
        `  ① 若该符号能从 packages/core 源码推导 → 跑 node packages/plugin-sdk/generate-dts.mjs\n` +
        `  ② 若无源码真相（宿主注入面 / 前端专有类型）→ 在 openlearn.d.ts 补声明并加入末尾导出块\n` +
        `  ③ 若本就不该对外暴露 → 从 index.ts 移除`,
    ).toEqual([]);
  });

  it('成员级漂移必须清零', () => {
    // 基线已归零（9 → 0）。这里同样从「不新增」升级为「必须为空」：
    // 成员面漂移意味着 d.ts 里描述的接口与实现不一致，插件按声明写会踩空。
    expect(
      currentMemberNames,
      `出现成员级漂移 ${currentMemberNames.length} 个 —— d.ts 描述的成员面与实现不一致。\n` +
        `要么改 d.ts（可推导的跑 generate-dts.mjs），要么改实现补齐成员。\n\n完整报告：\n${formatDrift(report)}`,
    ).toEqual([]);
  });

  it('generated.d.ts 与源码一致（生成物不能陈旧）', () => {
    // 生成物一旦与源码脱节，上面所有断言都会基于一份过期快照通过。
    // 用 `--check` 模式：只比对不写盘 —— 测试不应产生副作用，
    // 否则与其他 worker 并行读同一文件时会互相干扰。
    expect(() =>
      execFileSync(process.execPath, [path.join(SDK_DIR, 'generate-dts.mjs'), '--check'], {
        cwd: repoRoot(),
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'pipe'],
      }),
    ).not.toThrow();
  });

  it('反向漂移·运行时值（d.ts 声明 / index 未导出）必须清零', () => {
    // 只有 class / const / function 这类**运行时值**才是真问题：
    // 插件 `import { X } from '@openlearn/plugin-sdk'`（非 type-only）会报
    // `TS2693: only refers to a type, but is being used as a value here`。
    //
    // 纯类型符号的反向漂移**无害** —— TypeScript 解析该包走 package.json 的
    // `types` 字段指向 dist/index.d.ts（即 openlearn.d.ts 的副本），不经过 index.ts。
    // 已实测：13 项反向漂移里的 12 项（interface / type alias）能被插件正常
    // import，只有 ActivityRegistry（class）失败。
    expect(
      currentReverse.filter((n) => !WITHDRAWN_FROM_SDK.includes(n)),
      '这些运行时值在 d.ts 声明但 index.ts 未导出 —— 插件 import 即 TS2693。请在 index.ts 补 export。',
    ).toEqual([]);
  });

  it('撤回名单与 generate-dts.mjs 保持一致', () => {
    // 两处各有一份 WITHDRAWN_FROM_SDK，靠人肉同步必然漂移。这里读源码交叉验证：
    // ① 名单里的每个名字都必须真的不在 index.ts 导出面 —— 否则说明它已被重新加回，
    //    本测试名单该删（并同步删 generate-dts.mjs 那份）
    // ② generate-dts.mjs 也必须记着同一批名字
    // ③ 撤回名单必须覆盖全部反向漂移·值，否则门禁会误报为「意外漂移」
    const indexSrc = fs.readFileSync(path.join(SDK_DIR, 'index.ts'), 'utf8');
    const genSrc = fs.readFileSync(path.join(SDK_DIR, 'generate-dts.mjs'), 'utf8');

    for (const name of WITHDRAWN_FROM_SDK) {
      expect(indexSrc, `${name} 仍在 index.ts 导出块里 —— 若已恢复导出，请同步移除两处撤回名单`).not.toMatch(
        new RegExp(`^\\s+${name},?$`, 'm'),
      );
      expect(genSrc, `generate-dts.mjs 的 WITHDRAWN_FROM_SDK 缺少 ${name}`).toContain(name);
    }
    expect(
      currentReverse.filter((n) => !WITHDRAWN_FROM_SDK.includes(n)),
      '反向漂移·值 里出现名单外的符号 —— 门禁会把它判为意外漂移',
    ).toEqual([]);
  });

  it('已修复的漂移应及时从基线移除（防止基线只增不减）', () => {
    const fixed = {
      成员级: resolved(
        baseline.memberDrift.map((m) => m.name),
        currentMemberNames,
      ),
      幽灵符号: resolved(baseline.ghostAll, currentGhost),
      '反向漂移(值)': resolved(baseline.reverseValues, currentReverse),
    };
    const total = Object.values(fixed).reduce((a, b) => a + b.length, 0);
    expect(
      total === 0 ? [] : fixed,
      '以下基线条目已修复，请重跑 `npx tsx scripts/sdk-drift-baseline.mts` 收敛基线',
    ).toEqual([]);
  });

  it('基线快照本身是最新的（CI 可用 --check 模式复用同一逻辑）', () => {
    // 快照里不应残留「实际已无漂移」的条目
    const stale = baseline.ghostAll.filter((n) => !report.ghost.some((g) => g.name === n));
    expect(stale, '快照中 ghostAll 含有已不存在的漂移项').toEqual([]);
  });
});
