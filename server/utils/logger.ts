import pino from 'pino';
import fs from 'node:fs';
import path from 'node:path';

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
        translateTime: 'SYS:HH:MM:ss.l',
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
