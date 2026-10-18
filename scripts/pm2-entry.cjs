/**
 * PM2 入口垫片。
 *
 * PM2 fork 模式经 ProcessContainerFork.js 加载应用，此时 process.argv[1] 指向
 * PM2 的包装器而非 dist/server.cjs，server.ts 末尾的「仅直接运行时自启动」守卫
 * （argv[1] 以 server.cjs / server.ts 结尾）不会命中 —— 结果是进程存活但服务
 * 永不监听（日志停在插件恢复完成）。这里在加载 bundle 前显式改写 argv[1]，
 * 使 PM2 部署与 `node dist/server.cjs` 语义一致。
 */
const path = require('node:path');

process.argv[1] = path.resolve(__dirname, '../dist/server.cjs');
require('../dist/server.cjs');
