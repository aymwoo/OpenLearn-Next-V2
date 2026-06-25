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
        // 以下由 deploy.sh 从 .env 自动注入，请勿手动修改
        GEMINI_API_KEY: '',
        ENCRYPTION_KEY: '',
        ALLOWED_ORIGINS: '',
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
