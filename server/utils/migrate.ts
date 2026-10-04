/**
 * 数据库迁移运行器 (Server Proxy)
 *
 * @deprecated 核心迁移逻辑已沉淀到 `packages/core/db/migrator.ts` (SSOT)，
 * 本文件保留作为服务器端与既有测试的向后兼容导出入口。
 */
export * from '../../packages/core/db/migrator.js';
