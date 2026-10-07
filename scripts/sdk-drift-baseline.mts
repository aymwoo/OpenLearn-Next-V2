/**
 * 生成 SDK 契约漂移基线快照。
 *
 * 用法：npx tsx scripts/sdk-drift-baseline.mts [--check]
 *
 * - 默认：把当前漂移写入 `packages/plugin-sdk/__tests__/fixtures/sdk-drift-baseline.json`
 * - `--check`：只比对，不写入；快照与实际不符时以非零码退出（供 CI 用）
 *
 * 为什么用快照而不是在手写测试里列名字：漂移条目现已达 130+，
 * 手写清单必然与实际脱节，而脱节本身又是一种失真 —— 旧 parity 测试
 * 正是因为只断言 Token 名计数，才会「测试全绿而漂移依旧」。
 *
 * 快照的语义是「**已知**漂移集合」：
 * - 出现快照之外的新漂移 → 测试失败（防止新增漂移悄悄进来）
 * - 快照里的漂移被修复 → `--check` 失败（提示该重生成快照）
 */
import fs from 'node:fs';
import path from 'node:path';
import { analyzeSdkDrift } from '../packages/plugin-sdk/__tests__/helpers/sdk-drift-analyzer.ts';

const ROOT = path.resolve(import.meta.dirname, '..');
const SDK_DIR = path.join(ROOT, 'packages/plugin-sdk');
const OUT = path.join(SDK_DIR, '__tests__/fixtures/sdk-drift-baseline.json');

const report = analyzeSdkDrift(SDK_DIR);

const snapshot = {
  $comment:
    'SDK 契约漂移基线（由 scripts/sdk-drift-baseline.mts 生成，勿手工编辑）。' + '修完一批后重跑该脚本收敛基线。',
  ghostWithMembers: report.ghost
    .filter((g) => g.surface.members.length > 0)
    .map((g) => g.name)
    .sort(),
  ghostAll: report.ghost.map((g) => g.name).sort(),
  reverseValues: report.reverseValues.map((r) => r.name).sort(),
  reverseTypes: report.reverseTypes.map((r) => r.name).sort(),
  memberDrift: report.memberDrift.map((m) => ({
    name: m.name,
    onlyIndex: [...m.onlyIndex].sort(),
    onlyDts: [...m.onlyDts].sort(),
  })),
};

const serialized = JSON.stringify(snapshot, null, 2) + '\n';

if (process.argv.includes('--check')) {
  const current = fs.existsSync(OUT) ? fs.readFileSync(OUT, 'utf8') : '';
  if (current !== serialized) {
    console.error('❌ SDK 漂移基线与实际不符。');
    console.error('   若已修复一批漂移，请重跑：npx tsx scripts/sdk-drift-baseline.mts');
    const prev = current ? (JSON.parse(current) as typeof snapshot) : null;
    if (prev) {
      const diffNames = (a: string[], b: string[]) => ({
        消失: a.filter((x) => !b.includes(x)),
        新增: b.filter((x) => !a.includes(x)),
      });
      for (const key of ['ghostWithMembers', 'reverseValues'] as const) {
        const d = diffNames(prev[key] ?? [], snapshot[key]);
        if (d.消失.length) console.error(`   ${key} 已修复: ${d.消失.join(', ')}`);
        if (d.新增.length) console.error(`   ${key} 新增: ${d.新增.join(', ')}`);
      }
    }
    process.exit(1);
  }
  console.log('✅ SDK 漂移基线与实际一致');
} else {
  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.writeFileSync(OUT, serialized, 'utf8');
  console.log(`✅ 基线已写入 ${path.relative(ROOT, OUT)}`);
  console.log(`   幽灵符号(带成员): ${snapshot.ghostWithMembers.length}`);
  console.log(`   反向漂移(值):     ${snapshot.reverseValues.length}`);
  console.log(`   反向漂移(纯类型): ${snapshot.reverseTypes.length}`);
  console.log(`   成员级差异:       ${snapshot.memberDrift.length}`);
}
