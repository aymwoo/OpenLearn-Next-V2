/**
 * 按大小轮转的日志文件流（零新增依赖）。
 *
 * 为什么不引第三方轮转库：
 * 仓库用 pnpm 锁依赖，任何新增 `pino-roll` / `rotating-file-stream` 都意味着
 * 一次供应链引入 + 锁文件变更，需要走依赖评审。本模块用 Node 标准库
 * （`fs` + `stream`）即可完整实现，不引任何新包。
 *
 * 为什么用**同步** `fs.writeSync` 而不是 `fs.createWriteStream`：
 * 异步 WriteStream 的轮转必须在 `end()` 回调里再 `reopen`，而
 * `end()` 与 reopen 之间存在时间窗口 —— 此刻写入的数据要么丢失要么报错；
 * 同时进程若在 reopen 前退出，句柄释放与 rename 的先后顺序不可控。
 * 同步写把「写盘 + 大小记账 + 轮转」压成一个不可分割的同步块：
 *   - 不存在中间态，进程在任何时刻被 kill 都不会留下半截轮转产物；
 *   - 句柄是我们自己持有的裸 fd，可以在 `close()` 里同步关闭，不依赖事件循环。
 * 代价是每次写日志有一次同步 IO。平台日志量级（日志调用点仅 11 处）下可接受，
 * 换来的是「退出即干净」的确定性。
 *
 * 跨平台注意：
 * - POSIX 的 `rename` 可以原子覆盖已存在的目标文件，**Windows 不行**（会 EPERM/EEXIST）。
 *   因此所有 rename 前先 `unlink` 目标，保证 Linux / macOS / Windows 行为一致。
 * - 轮转采用**先删最旧、再依次前移**的顺序，避免任何一步依赖覆盖语义。
 */

import fs from 'node:fs';
import path from 'node:path';
import { Writable } from 'node:stream';

export interface RotatingFileStreamOptions {
  /** 活动日志文件路径 */
  filePath: string;
  /** 单文件大小上限（字节）。写入前若「当前大小 + 本次写入」超限则先轮转。 */
  maxBytes: number;
  /** 保留的历史文件份数（openlearn.log.1 … openlearn.log.N） */
  maxFiles: number;
}

/** 目标文件存在时先删除 —— Windows rename 不能覆盖已存在文件 */
function removeIfExists(filePath: string): void {
  try {
    fs.unlinkSync(filePath);
  } catch {
    /* 文件不存在即无需处理；无权删除等错误在后续 rename 中再暴露 */
  }
}

/**
 * 活跃流登记表 + 进程退出钩子。
 *
 * 用模块级 Set 而非在构造函数里 `process.on('exit', ...)`，是为了保证
 * 整个进程最多只注册**一个** exit 监听器 —— 测试里会反复 new 出多个流，
 * 逐个注册会触发 Node 的 MaxListenersExceededWarning。
 * `exit` 回调是同步的，`closeSync` 在其中能可靠执行。
 */
const activeStreams = new Set<RotatingFileStream>();
let exitHookInstalled = false;

function registerStream(stream: RotatingFileStream): void {
  activeStreams.add(stream);
  if (exitHookInstalled) return;
  exitHookInstalled = true;
  process.on('exit', () => {
    for (const s of activeStreams) s.dispose();
    activeStreams.clear();
  });
}

function unregisterStream(stream: RotatingFileStream): void {
  activeStreams.delete(stream);
}

/** 跨平台安全重命名：先删目标再 rename */
function safeRename(from: string, to: string): boolean {
  try {
    removeIfExists(to);
    fs.renameSync(from, to);
    return true;
  } catch {
    // 轮转失败不应打断业务日志：放弃本次轮转，让写入继续落到原文件
    return false;
  }
}

/**
 * 按大小轮转的 Writable。
 *
 * 句柄在**首次写入时**才打开（而非构造时），避免「导入了 logger 却从不写日志」
 * 的场景白占一个 fd。`dispose()` 同步关闭 fd；进程退出时由模块级 exit 钩子兜底调用。
 */
export class RotatingFileStream extends Writable {
  private readonly filePath: string;
  private readonly maxBytes: number;
  private readonly maxFiles: number;
  private readonly dir: string;

  private fd: number | null = null;
  private currentSize = 0;
  /** 因 I/O 错误导致的降级标记：置位后不再尝试轮转/重开，只丢弃写入 */
  private broken = false;

  constructor(options: RotatingFileStreamOptions) {
    // 不设置 highWaterMark：落盘是同步的，背压语义在这里没有意义
    super();
    this.filePath = options.filePath;
    this.maxBytes = options.maxBytes;
    this.maxFiles = options.maxFiles;
    this.dir = path.dirname(this.filePath);
  }

  /** 当前活动文件路径（测试与排障用） */
  get activeFilePath(): string {
    return this.filePath;
  }

  /** 第 n 个历史文件路径，n 从 1 开始 */
  historyFilePath(n: number): string {
    return `${this.filePath}.${n}`;
  }

  override _write(chunk: unknown, _encoding: BufferEncoding, callback: (error?: Error | null) => void): void {
    // pino 写的是字符串，但 Writable 可能在其他调用路径传入 Buffer，统一归一化
    const buf = typeof chunk === 'string' ? Buffer.from(chunk, 'utf8') : (chunk as Buffer);
    try {
      if (this.broken) {
        callback();
        return;
      }
      this.ensureOpen();
      // 预判：本次写入会撑破阈值则先轮转，保证单文件不超过 maxBytes
      if (this.currentSize > 0 && this.currentSize + buf.length > this.maxBytes) {
        this.rotate();
      }
      const written = fs.writeSync(this.fd!, buf, 0, buf.length, null);
      this.currentSize += written;
      callback();
    } catch (err) {
      // 日志系统自身故障不能拖垮业务：标记降级并吞掉错误
      this.broken = true;
      this.closeFd();
      callback();
    }
  }

  override _final(callback: (error?: Error | null) => void): void {
    this.closeFd();
    callback();
  }

  /** 显式释放句柄（流未被 end() 收尾时使用） */
  dispose(): void {
    this.closeFd();
  }

  private closeFd(): void {
    if (this.fd !== null) {
      try {
        fs.closeSync(this.fd);
      } catch {
        /* 已关闭 */
      }
      this.fd = null;
      unregisterStream(this);
    }
  }

  private ensureOpen(): void {
    if (this.fd !== null) return;
    fs.mkdirSync(this.dir, { recursive: true });
    this.fd = fs.openSync(this.filePath, 'a');
    registerStream(this);
    // 以追加方式打开时写入总是落到文件尾，偏移量天然正确；
    // 但仍显式取一次 stat 作为基线，才能判断「启动时文件就已超限」。
    try {
      this.currentSize = fs.statSync(this.filePath).size;
    } catch {
      this.currentSize = 0;
    }
  }

  /**
   * 轮转：`N → N+1` 逐级前移 → 活动文件 → `.1` → 重新打开空文件。
   *
   * 顺序上必须从最旧的一份开始，否则前移会覆盖尚未移动的文件。
   */
  private rotate(): void {
    this.closeFd();
    // 最旧 → 往前挪一位；挪不动就跳过（权限/占用等），不阻断主流程
    for (let i = this.maxFiles - 1; i >= 1; i -= 1) {
      const from = this.historyFilePath(i);
      if (fs.existsSync(from)) {
        safeRename(from, this.historyFilePath(i + 1));
      }
    }
    safeRename(this.filePath, this.historyFilePath(1));
    this.currentSize = 0;
    this.fd = fs.openSync(this.filePath, 'a');
  }
}

/** 环境变量 -> 正整数，非法值回退到默认值（附一次性告警，避免刷屏） */
function readPositiveInt(raw: string | undefined, fallback: number, label: string): number {
  if (raw === undefined || String(raw).trim() === '') return fallback;
  const parsed = Number(String(raw).trim());
  if (!Number.isFinite(parsed) || parsed <= 0) {
    console.warn(`[Logger] ${label}="${raw}" 不是合法的正整数，回退到默认值 ${fallback}`);
    return fallback;
  }
  return parsed;
}

/**
 * 从环境变量解析轮转配置。
 *
 * - `LOG_MAX_SIZE_MB`：单文件上限，默认 **10 MB**。
 *   现状 `logs/openlearn.log` 已达 11.3 MB 且仍在增长，10 MB 能在磁盘占用
 *   与"一次排查能覆盖多长的历史"之间取平衡（5 份 ≈ 50 MB 上限）。
 * - `LOG_MAX_FILES`：保留历史份数，默认 **5**。
 *   5 份通常足够覆盖"上周某次故障"的回溯需求，代价可控。
 */
export function resolveRotationConfig(env: NodeJS.ProcessEnv = process.env): {
  maxBytes: number;
  maxFiles: number;
} {
  const maxSizeMb = readPositiveInt(env.LOG_MAX_SIZE_MB, 10, 'LOG_MAX_SIZE_MB');
  const maxFiles = Math.floor(readPositiveInt(env.LOG_MAX_FILES, 5, 'LOG_MAX_FILES'));
  return { maxBytes: Math.floor(maxSizeMb * 1024 * 1024), maxFiles };
}
