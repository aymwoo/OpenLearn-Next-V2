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
        // 必须配置的环境变量
        GEMINI_API_KEY: '',             // 填入 Gemini API Key，或通过第三方 AI Provider 管理面板配置
        ENCRYPTION_KEY: '',             // 填入 64 位 hex 密钥（node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"）
        LOG_LEVEL: 'info',
        ALLOWED_ORIGINS: '',            // 生产环境 CORS 白名单，如 'https://your-domain.com'（逗号分隔）
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
