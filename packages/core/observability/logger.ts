import pino from 'pino';
import fs from 'node:fs';
import path from 'node:path';
import { buildRedactOptions } from './redaction.js';
import { RotatingFileStream, resolveRotationConfig } from './rotating-file-stream.js';

/**
 * 平台结构化日志（pino multistream + 脱敏兜底 + 按大小轮转）。
 *
 * 层级归属（SEC/ARCH）：本模块位于 **core 层** —— worker-runtime / plugin-host
 * 等内核子系统需要创建带组件标签的子 logger，此前它们反向 import
 * `server/utils/logger.ts`（应用层），违反「app → kernel，绝不反向」的分层规则
 * （2026-09-25 审计 H-7 / 2026-09-30 审计架构高-1）。现下沉到 core，
 * `server/utils/logger.ts` 改为 re-export 保持既有导入路径兼容。
 *
 * 环境变量：
 * - `LOG_LEVEL`      日志级别，默认 生产 info / 非生产 debug
 * - `LOG_REDACT`     脱敏开关，默认开启；设 `false` 关闭（⚠️ 生产环境不建议关闭）
 * - `LOG_DIR`        日志目录，默认 `<cwd>/logs`
 * - `LOG_MAX_SIZE_MB`单文件大小上限（MB），默认 10
 * - `LOG_MAX_FILES`  轮转保留份数，默认 5
 */
const level = process.env.LOG_LEVEL || (process.env.NODE_ENV === 'production' ? 'info' : 'debug');

// Ensure logs directory exists（LOG_DIR 允许部署与测试把日志写到别处）
const logDir = path.resolve(process.env.LOG_DIR || path.join(process.cwd(), 'logs'));
if (!fs.existsSync(logDir)) {
  fs.mkdirSync(logDir, { recursive: true });
}
const logFile = path.join(logDir, 'openlearn.log');

const streams = [];

if (process.env.NODE_ENV !== 'production') {
  streams.push({
    level,
    stream: pino.transport({
      target: 'pino-pretty',
      options: {
        colorize: true,
        translateTime: 'SYS:HH:mm:ss.l',
        ignore: 'pid,hostname',
      },
    }) as any,
  });
} else {
  streams.push({
    level,
    stream: process.stdout,
  });
}

// 轮转替代原先的 fs.createWriteStream(logFile, { flags: 'a' })：
// 此前是无限增长的单文件（实测已达 11.3 MB 且无上限、无切分）。
const rotation = resolveRotationConfig();
streams.push({
  level,
  stream: new RotatingFileStream({
    filePath: logFile,
    maxBytes: rotation.maxBytes,
    maxFiles: rotation.maxFiles,
  }),
});

// 脱敏在 logger 层生效：redact 发生在序列化阶段、早于 multistream 分发，
// 因此 stdout / pino-pretty / 文件三路拿到的都是已脱敏内容，不会出现
// 「控制台已脱敏、文件里却是明文」这种不一致。
export const logger = pino({ level, redact: buildRedactOptions() as any }, pino.multistream(streams as any));

/** 创建带组件标签的子 logger */
export function createLogger(component: string): pino.Logger {
  return logger.child({ component });
}
