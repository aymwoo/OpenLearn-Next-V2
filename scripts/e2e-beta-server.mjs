import { spawn } from 'node:child_process';
import { mkdirSync, rmSync } from 'node:fs';
import path from 'node:path';

/**
 * 公测旅程专用进程。不设置 PLAYWRIGHT_TEST，因此强制改密门是开着的。
 * 数据放在临时目录，避免碰到开发库。
 */
const dir = path.resolve(process.env.OPENLEARN_BETA_E2E_DIR || '/tmp/openlearn-beta-e2e');
rmSync(dir, { recursive: true, force: true });
mkdirSync(dir, { recursive: true });

const env = { ...process.env };
delete env.PLAYWRIGHT_TEST;
Object.assign(env, {
  NODE_ENV: 'production',
  PORT: '9107',
  HOST: '127.0.0.1',
  OPENLEARN_DATA_DIR: dir,
  OPENLEARN_DB_PATH: path.join(dir, 'educational_os.db'),
  OPENLEARN_PLUGINS_DIR: path.join(dir, 'plugins'),
  BACKUP_DIR: path.join(dir, 'backups'),
  LOG_DIR: path.join(dir, 'logs'),
  LOG_LEVEL: 'info',
  OPENLEARN_ADMIN_PASSWORD: 'admin',
  OPENLEARN_TEACHER_PASSWORD: 'TeacherBeta#2026',
  ENCRYPTION_KEY: '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef',
  METRICS_TOKEN: 'beta-metrics-secret',
  SENTRY_DSN: '',
  OPENLEARN_ERROR_DSN: '',
});

const child = spawn('pnpm', ['exec', 'tsx', 'server.ts'], {
  env,
  stdio: 'inherit',
});

const stop = () => {
  if (!child.killed) child.kill('SIGTERM');
};
process.on('SIGTERM', stop);
process.on('SIGINT', stop);
child.on('exit', (code) => process.exit(code ?? 0));
