/**
 * scripts/sweep/cli-args.ts —— 巡检的命令行解析
 *
 * ## 为什么单独抽一个模块（Issue #247 review）
 *
 * `index.ts` 在模块加载时就会执行 `main()`（跑整场巡检）。因此**任何 import
 * 它的测试都会连带启动一次演示服务器** —— 端口占用、进程泄漏、CI 上更慢。
 *
 * 把 CLI 解析抽到这里，`index.ts` 负责编排、这里负责解析，
 * 单元测试可以只 import 这个**无副作用**的模块。
 *
 * @module
 */
import path from 'node:path';
import { SWEEP_ROLES } from './manifest.js';
import type { SweepRoleId } from './types.js';

/**
 * 全部合法的角色 id —— **从角色清单派生**，不再手写副本。
 *
 * 此前 `--roles` 的白名单是硬编码字面量：它重复了 `SweepRoleId` 联合类型，
 * 于是新增角色（`teacher-2`）时白名单被漏掉，`--roles teacher-2` 会被判
 * 「取值无效」，`--help` 的可选值列表也跟着少一项 —— 典型的「重复副本漂移」。
 */
export const SWEEP_ROLE_IDS: readonly SweepRoleId[] = SWEEP_ROLES.map((role) => role.id);

export interface CliOptions {
  port: number;
  baseUrl?: string;
  outDir: string;
  roles: SweepRoleId[];
  resetDb: boolean;
  failOnError: boolean;
  /** 跳过写流程剧本（只跑只读巡检）。 */
  skipScenarios: boolean;
}

/** 打印帮助。 */
export function printHelp(): void {
  console.log(`
功能巡检（sweep）—— 自动遍历全部角色的所有视图，收集运行时错误并出报告

用法：
  pnpm sweep [选项]

选项：
  --port <n>          一次性演示服务器端口（默认 9300）
  --base-url <url>   巡检已在运行的服务（给出后不再启动演示服务器，也不重建演示库）
  --out <dir>        产物目录（默认 artifacts/sweep）
  --roles <list>     参与巡检的角色，逗号分隔：${SWEEP_ROLE_IDS.join(',')}（默认全部）
  --keep-db          保留现有演示库，不重建（默认重建，保证数据干净）
  --skip-scenarios   跳过写流程剧本，只跑只读巡检
  --no-fail          即使发现错误也返回退出码 0
  -h, --help         显示本帮助
`);
}

/**
 * 解析命令行参数。
 *
 * 角色白名单从 {@link SWEEP_ROLE_IDS} 派生；**只要有一个非法值就报错并点名它** ——
 * 静默丢掉用户写的角色，会让人以为「只巡检 teacher」跑的其实是别的角色集。
 */
export function parseArgs(argv: string[]): CliOptions {
  const options: CliOptions = {
    port: 9300,
    outDir: path.resolve(process.cwd(), 'artifacts', 'sweep'),
    roles: [...SWEEP_ROLE_IDS],
    resetDb: true,
    failOnError: true,
    skipScenarios: false,
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    switch (arg) {
      case '--port':
        options.port = Number(argv[++i]!);
        break;
      case '--base-url':
        options.baseUrl = argv[++i]!;
        // 给出了外部服务地址就不再重建演示库
        options.resetDb = false;
        break;
      case '--out':
        options.outDir = path.resolve(process.cwd(), argv[++i]!);
        break;
      case '--roles': {
        const raw = (argv[++i] ?? '')
          .split(',')
          .map((item) => item.trim())
          .filter(Boolean);
        const valid = raw.filter((item): item is SweepRoleId => (SWEEP_ROLE_IDS as string[]).includes(item));
        if (valid.length !== raw.length) {
          const invalid = raw.filter((item) => !(SWEEP_ROLE_IDS as string[]).includes(item));
          throw new Error(`--roles 取值无效：「${invalid.join(',')}」。可选：${SWEEP_ROLE_IDS.join(',')}`);
        }
        options.roles = valid;
        break;
      }
      case '--keep-db':
        options.resetDb = false;
        break;
      case '--skip-scenarios':
        options.skipScenarios = true;
        break;
      case '--no-fail':
        options.failOnError = false;
        break;
      case '-h':
      case '--help':
        printHelp();
        process.exit(0);
        break;
      default:
        // 未知参数：警告后忽略（保持既有行为，不让 CI 的额外参数把巡检直接打挂）
        if (arg.startsWith('--')) {
          console.warn(`[sweep] 忽略未知参数：${arg}`);
        }
    }
  }

  return options;
}
