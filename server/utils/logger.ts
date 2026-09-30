/**
 * 兼容 re-export：实现已下沉至 core 层（SEC/ARCH 分层整改，2026-09-30）。
 *
 * 此前 packages/core/worker-runtime 与 plugin-host 反向 import 本文件，
 * 违反「app → kernel，绝不反向」的分层规则。实现移至
 * `packages/core/observability/logger.ts`，本文件仅为既有导入路径保留 ——
 * server 侧新代码请直接 import core 的 observability/logger。
 */
export { logger, createLogger } from '../../packages/core/observability/logger.js';
