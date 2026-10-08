/**
 * 插件进程的资源上限（L-2 之后新增，与 CPU 配额同属「资源治理」这一层）。
 *
 * ## 为什么先做内存而不是 CPU
 *
 * 两者的爆炸半径差一个量级：
 *
 * | | CPU 燃烧 | 内存失控 |
 * |---|---|---|
 * | 宿主影响 | 降速，可恢复 | 系统 OOM 可能**杀掉宿主进程** |
 * | 修法成本 | Windows 需 native addon（Job Objects） | **一个 V8 旗标，跨平台、零特权** |
 *
 * 实测（16 核宿主，8 个烧满 CPU 的插件子进程）：宿主吞吐仅降 23.6%，
 * 事件循环最大抖动 0.62ms —— **服务不会不可用**。而内存失控实测是：
 * 子进程 `--max-old-space-size=64` 时 SIGABRT，宿主 RSS 纹丝不动。
 *
 * 所以先补内存这条便宜且更危险的缺口，CPU 配额留作已知缺口。
 *
 * ## 为什么取 128MB
 *
 * 不是拍的：沿用 `worker_threads` 路径**既有的** `resourceLimits.maxOldGenerationSizeMb`
 * 值（见 `worker-manager.ts`），并把它抽成本文件的唯一真源，让两种隔离原语
 * 引用同一常量 —— 否则两边迟早漂移，而漂移的表现是「同一插件在 worker 模式
 * 正常、在 process 模式 OOM」，极难排查。
 *
 * 128MB 的余量经实测确认：`PLUGIN_SHARED_MODULES` 五个重型依赖
 * （uuid / exceljs / jspdf / react-markdown / recharts）全部加载后
 * `heapUsed=35MB`。加上本上限后仍全部加载成功。
 *
 * ## 覆盖不到的（必须说清）
 *
 * `--max-old-space-size` 只管 **V8 老生代**。以下不受约束：
 *
 * - Buffer / TypedArray / ArrayBuffer 等 **external 内存**
 * - 原生模块分配的内存
 * - V8 之外的（如 `SharedArrayBuffer`）
 *
 * 实测一个「持续往 stderr 写」的插件：POSIX 管道是非阻塞的，**不会死锁**
 * （我原以为会阻塞，实测否掉了），但数据被静默丢弃、并在子进程内排队占内存。
 * 那部分算 external，不受本上限约束。
 *
 * 要真正约束 external 内存需要 `--max-old-space-size` 之外的机制
 * （旧版 Node 有 `--max-old-space-size` 之外的 `max_old_space`，但同样不含 external）；
 * 进程级 RSS 上限只能靠容器/cgroup/Job Object —— 那是 CPU 配额那套工具的工作。
 */

/**
 * 插件可用 V8 老生代上限（MB）。
 *
 * 与 `worker_threads` 的 `resourceLimits.maxOldGenerationSizeMb` 同源 ——
 * 改这里会同时改变两种隔离原语的行为，这是**刻意**的。
 */
export const DEFAULT_MAX_OLD_GENERATION_MB = 128;

/** 环境变量名 */
export const MAX_HEAP_ENV = 'OPENLEARN_PLUGIN_MAX_HEAP_MB';

/**
 * 归一化堆上限取值。
 *
 * ## 方向性选择：非法值落到默认值，而不是「无限制」
 *
 * 与 `normalizePermissionPolicy` 同一个原则：**限制是更安全的那一侧**。
 * 把拼错的 `OPENLEARN_PLUGIN_MAX_HEAP_MB=128MB` 解析成「无限制」，
 * 等于让一次配置笔误静默关掉了防护；而落到默认值 128 最多让内存吃紧的插件失败。
 * 确实要关掉必须显式写 `0` 或 `off`。
 *
 * @returns MB 数；0 表示不设上限
 */
export function normalizeMaxHeapMb(raw: unknown): number {
  if (raw === undefined || raw === null || raw === '') return DEFAULT_MAX_OLD_GENERATION_MB;
  const s = String(raw).trim().toLowerCase();
  if (s === 'off' || s === 'none' || s === '0') return 0;

  // 只接受整数 MB。允许带单位的写法（'512mb'）纯属好意，但解析失败一律回落默认。
  const m = /^(\d+)\s*(?:mb)?$/.exec(s);
  if (!m) return DEFAULT_MAX_OLD_GENERATION_MB;
  const n = Number(m[1]);
  // 下限 32MB：低于此连 bootstrap 与共享模块都装不下，与其让插件神秘崩溃，
  // 不如让它明确报「配置错误」。上限不设 —— 由部署方自己决定给多少。
  if (n < 32) return DEFAULT_MAX_OLD_GENERATION_MB;
  return n;
}

/**
 * 构造子进程的堆上限旗标。
 *
 * ## 关于旗标位置 —— 一条我曾写错、现已实测更正的结论
 *
 * 我原以为该旗标**必须**放在脚本参数之前，并写下「放在 `--eval` 之后会被静默忽略」。
 * **那是错的。** 实测（2026-10-08）：
 *
 * ```
 * --max-old-space-size=64 在 --eval 之前 → FATAL ERROR，1361ms
 * --max-old-space-size=64 在 --eval 之后 → FATAL ERROR，1353ms
 * 完全不给上限                        → 存活，heapUsed=1236MB
 * ```
 *
 * 错误的来源是**探针测不了要测的东西**：当时那个探针只执行一句 `console.log`，
 * 不做任何分配，所以「生效」与「被忽略」两种情况都会正常打印 —— 从中读不出结论。
 *
 * 同样的探针缺陷也让我一度断言 `--permission` 有位置要求，一并更正：实测两个位置
 * 都返回 `ERR_ACCESS_DENIED`。位置按惯例统一放在脚本之前，但**不作为正确性依赖**；
 * 上限是否真的生效由 `plugin-heap-limit.test.ts` 的「吃内存插件被终止」一例守住。
 *
 * @param raw - 环境变量原始取值；不给则读 `OPENLEARN_PLUGIN_MAX_HEAP_MB`
 * @returns 旗标数组；不设上限时为空数组
 */
export function buildHeapLimitArgs(raw?: unknown): string[] {
  const mb = raw === undefined ? process.env[MAX_HEAP_ENV] : raw;
  const n = normalizeMaxHeapMb(mb);
  if (n === 0) return [];
  return [`--max-old-space-size=${n}`];
}

/** 诊断文本：把生效的堆上限说清楚，避免使用者面对 OOM 时不知道有这回事 */
export function describeHeapLimit(raw?: unknown): string {
  const mb = raw === undefined ? process.env[MAX_HEAP_ENV] : raw;
  const n = normalizeMaxHeapMb(mb);
  if (n === 0) return '堆上限：未设置（插件可无限增长，OOM 可能波及宿主进程）';
  return `堆上限：V8 老生代 ${n}MB（⚠ 仅老生代；Buffer 等 external 内存不受约束）`;
}