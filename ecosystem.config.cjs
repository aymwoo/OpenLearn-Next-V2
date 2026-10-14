const path = require('path');
const dotenv = require('dotenv');

// 从同目录 .env 文件动态加载环境变量，避免明文硬编码提交到版本库
dotenv.config({ path: path.resolve(__dirname, '.env') });

module.exports = {
  apps: [
    {
      name: 'openlearnv2',
      cwd: __dirname,
      script: 'dist/server.cjs',
      instances: 1,
      exec_mode: 'fork',
      env: {
        NODE_ENV: 'production',
        PORT: 9000,
        LOG_LEVEL: process.env.LOG_LEVEL || 'info',
        LOG_DIR: process.env.LOG_DIR || '',
        LOG_REDACT: process.env.LOG_REDACT || '',
        LOG_MAX_SIZE_MB: process.env.LOG_MAX_SIZE_MB || '',
        LOG_MAX_FILES: process.env.LOG_MAX_FILES || '',
        AUDIT_LOG_MAX_SIZE_MB: process.env.AUDIT_LOG_MAX_SIZE_MB || '',
        AUDIT_LOG_MAX_FILES: process.env.AUDIT_LOG_MAX_FILES || '',
        SENTRY_DSN: process.env.SENTRY_DSN || '',
        OPENLEARN_ERROR_DSN: process.env.OPENLEARN_ERROR_DSN || '',
        METRICS_TOKEN: process.env.METRICS_TOKEN || '',
        ENCRYPTION_KEY: process.env.ENCRYPTION_KEY || '',
        ALLOWED_ORIGINS: process.env.ALLOWED_ORIGINS || '',
        TRUST_PROXY: process.env.TRUST_PROXY || '',
        OPENLEARN_DATA_DIR: process.env.OPENLEARN_DATA_DIR || '',
        OPENLEARN_DB_PATH: process.env.OPENLEARN_DB_PATH || '',
        BACKUP_DIR: process.env.BACKUP_DIR || '',
        OPENLEARN_ADMIN_PASSWORD: process.env.OPENLEARN_ADMIN_PASSWORD || '',
        OPENLEARN_TEACHER_PASSWORD: process.env.OPENLEARN_TEACHER_PASSWORD || '',
      },
      log_date_format: 'YYYY-MM-DD HH:mm:ss',
      error_file: 'logs/err.log',
      out_file: 'logs/out.log',
      merge_logs: true,
      max_restarts: 10,
      min_uptime: '10s',
      max_memory_restart: '512M',
    },
  ],
};
