/**
 * 结构化日志器
 *
 * Phase 21 - OBS-LOG-01
 * 基于 pino 的结构化日志，开发环境美化输出，生产环境 JSON
 */
import pino from 'pino';

const level = process.env.LOG_LEVEL || (process.env.NODE_ENV === 'production' ? 'info' : 'debug');

export const logger = pino({
  level,
  ...(process.env.NODE_ENV !== 'production' && {
    transport: {
      target: 'pino-pretty',
      options: {
        colorize: true,
        translateTime: 'SYS:HH:MM:ss.l',
        ignore: 'pid,hostname',
      },
    },
  }),
});

/** 创建带组件标签的子 logger */
export function createLogger(component: string): pino.Logger {
  return logger.child({ component });
}
