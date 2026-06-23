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
      },
      // Logs
      log_date_format: 'YYYY-MM-DD HH:mm:ss',
      error_file: 'logs/err.log',
      out_file: 'logs/out.log',
      merge_logs: true,
      // Restart on crash (max 10 restarts in 60s, then pause)
      max_restarts: 10,
      min_uptime: '10s',
      max_memory_restart: '512M',
    },
  ],
};
