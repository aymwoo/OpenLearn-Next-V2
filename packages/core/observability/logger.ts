import pino from 'pino';
import fs from 'node:fs';
import path from 'node:path';

/**
 * 平台结构化日志（pino multistream）。
 *
 * 层级归属（SEC/ARCH）：本模块位于 **core 层** —— worker-runtime / plugin-host
 * 等内核子系统需要创建带组件标签的子 logger，此前它们反向 import
 * `server/utils/logger.js`（应用层），违反「app → kernel，绝不反向」的分层规则
 * （2026-09-25 审计 H-7 / 2026-09-30 审计架构高-1）。现下沉到 core，
 * `server/utils/logger.ts` 改为 re-export 保持既有导入路径兼容。
 */
const level = process.env.LOG_LEVEL || (process.env.NODE_ENV === 'production' ? 'info' : 'debug');

// Ensure logs directory exists
const logDir = path.resolve(process.cwd(), 'logs');
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

streams.push({
  level,
  stream: fs.createWriteStream(logFile, { flags: 'a' }),
});

export const logger = pino({ level }, pino.multistream(streams));

/** 创建带组件标签的子 logger */
export function createLogger(component: string): pino.Logger {
  return logger.child({ component });
}
