/**
 * Vite 构建配置守卫：**单 React 实例**。
 *
 * ## 为什么要有这条测试
 *
 * 2026-10-25 出现过一类只在特定环境复现的白屏/崩溃：学生端互动课堂挂载白板 `<Stage>` 时
 * 抛 `Cannot read properties of null (reading 'useRef')`，React 自己的诊断是
 * 「You might have more than one copy of React in the same app」。
 *
 * 根因在 Vite 的依赖预打包：linked worktree 把 node_modules 软链到主仓库，
 * 于是两个 Vite root 共用同一个预打包缓存目录，各自写盘互相覆盖；浏览器同一页面里
 * 同时加载两代产物，而 react 的 CJS 模块在两代里落在**不同 chunk 文件** → 同页两份 React。
 * react-konva 那份的 `ReactSharedInternals.H` 永远是 null，`<Stage>` 一挂载就崩。
 *
 * 这类故障在单仓库、单 dev server 下**测不出来**（永远是单实例），
 * 所以这里对**配置本身**设门槛：三条不变量任一被破坏，就是把崩溃放回来了。
 */
import { describe, expect, it } from 'vitest';
import path from 'node:path';
import viteConfig from '../../vite.config';

type ViteConfigLike = {
  cacheDir?: string;
  resolve?: { dedupe?: string[] };
  optimizeDeps?: { include?: string[] };
};

const config = viteConfig as ViteConfigLike;

describe('Vite 配置 · 单 React 实例', () => {
  it('cacheDir 不放在 node_modules 下（linked worktree 才不会与主仓库共用预打包缓存）', () => {
    expect(config.cacheDir, 'vite.config.ts 必须显式设置 cacheDir').toBeTruthy();

    const normalized = path.resolve(config.cacheDir as string).split(path.sep);
    expect(normalized, 'cacheDir 落在 node_modules 下会被软链 worktree 共享').not.toContain('node_modules');
  });

  it('resolve.dedupe 覆盖 react 与 react-dom', () => {
    const dedupe = config.resolve?.dedupe ?? [];
    expect(dedupe, '缺少 resolve.dedupe，react-dom 与 react-konva 可能解析到不同副本').toContain('react');
    expect(dedupe).toContain('react-dom');
  });

  it('optimizeDeps.include 显式纳入白板重依赖（避免运行时增量预打包复制 react）', () => {
    const include = config.optimizeDeps?.include ?? [];
    // 这些包一旦在运行时才被「发现」（React.lazy / Blob URL 动态导入，静态扫描扫不到），
    // 就会触发增量预打包；那次增量会把 react CJS 再打包一份。
    for (const dep of ['react', 'react-dom', 'react-konva', 'react-konva-utils', 'konva']) {
      expect(include, `optimizeDeps.include 缺少 ${dep}`).toContain(dep);
    }
  });
});
