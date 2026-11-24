/**
 * Gitee main → GitHub main 只快进。
 *
 * 行为夹具在 `.github/scripts/sync-github-from-gitee.test.sh`：
 * 本地裸仓库，不访问网络。这里把它挂进 `pnpm test`，避免脚本改完无人再跑。
 */
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, it } from 'vitest';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

describe('Gitee → GitHub main 快进', () => {
  it('对齐时空操作，分叉时失败，只有祖先关系才快进', () => {
    execFileSync('bash', [path.join(root, '.github/scripts/sync-github-from-gitee.test.sh')], {
      cwd: root,
      stdio: 'inherit',
      env: process.env,
    });
  });
});
