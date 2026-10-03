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
        LOG_LEVEL: 'info',
        ENCRYPTION_KEY: process.env.ENCRYPTION_KEY || '',
        ALLOWED_ORIGINS: process.env.ALLOWED_ORIGINS || '',
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
