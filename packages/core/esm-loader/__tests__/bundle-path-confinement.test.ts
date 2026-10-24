import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { bundlePlugin } from '../install-utils.js';

/**
 * 回归测试 —— 插件打包的目录归属约束（Issue #218）。
 *
 * 背景：`bundlePlugin()` 的 esbuild `onResolve` 此前只拒绝**绝对路径**导入，
 * 相对路径一律 `return undefined` 交回 esbuild 默认解析。esbuild 的相对解析
 * 不做目录归属限制，`../../` 可以逃出插件的临时解压目录，把宿主的任意文件
 * （.env / SQLite 库 / 宿主 package.json…）读进来并**内联进插件产物**。
 *
 * 读取发生在宿主进程的打包阶段，不在插件的 `--permission` 权限模型约束内，
 * 因此 `process` 隔离模式也拦不住。
 *
 * 这里覆盖修复后的行为：
 *   1. 相对导入向上穿越出插件目录 → 拒绝
 *   2. 相对导入指向插件目录内的文件 → 放行（不能误伤正常插件）
 *   3. 相对导入指向插件目录的兄弟目录 → 拒绝
 *   4. 插件目录内的符号链接指向目录外 → 拒绝
 */

describe('bundlePlugin — 相对导入的目录归属约束（#218）', () => {
  let root: string;
  let pluginDir: string;
  let siblingDir: string;

  beforeAll(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'openlearn-bundle-confinement-'));
    pluginDir = path.join(root, 'plugin');
    siblingDir = path.join(root, 'host');
    fs.mkdirSync(pluginDir, { recursive: true });
    fs.mkdirSync(siblingDir, { recursive: true });

    // 插件目录内的合法文件
    fs.writeFileSync(path.join(pluginDir, 'helper.ts'), 'export const helper = 42;\n', 'utf-8');
    // 插件目录外的「宿主文件」
    fs.writeFileSync(path.join(siblingDir, 'secret.txt'), 'HOST_SECRET_VALUE\n', 'utf-8');
    fs.writeFileSync(path.join(root, 'host-secret.txt'), 'HOST_SECRET_VALUE\n', 'utf-8');
  });

  afterAll(() => {
    fs.rmSync(root, { recursive: true, force: true });
  });

  it('拒绝向上穿越出插件目录的相对导入', async () => {
    const code = `import secret from "../host-secret.txt";
export const value = secret;`;
    await expect(bundlePlugin(code, pluginDir)).rejects.toThrow(/escapes the plugin directory/i);
  });

  it('拒绝指向插件目录兄弟目录的相对导入', async () => {
    const code = `import secret from "../host/secret.txt";
export const value = secret;`;
    await expect(bundlePlugin(code, pluginDir)).rejects.toThrow(/escapes the plugin directory/i);
  });

  it('拒绝多层穿越（../../..）', async () => {
    const code = `import secret from "../../host-secret.txt";
export const value = secret;`;
    await expect(bundlePlugin(code, pluginDir)).rejects.toThrow(/escapes the plugin directory/i);
  });

  it('放行插件目录内的相对导入（不能误伤正常插件）', async () => {
    const code = `import { helper } from "./helper.ts";
export const value = helper;`;
    const result = await bundlePlugin(code, pluginDir);
    expect(typeof result).toBe('string');
    expect(result).toContain('helper');
  });

  it('拒绝经符号链接指向插件目录外的相对导入', async () => {
    const linkPath = path.join(pluginDir, 'escape-link.txt');
    try {
      fs.symlinkSync(path.join(siblingDir, 'secret.txt'), linkPath);
    } catch {
      // 某些环境不允许创建符号链接 —— 跳过该用例
      return;
    }
    const code = `import secret from "./escape-link.txt";
export const value = secret;`;
    await expect(bundlePlugin(code, pluginDir)).rejects.toThrow(/outside the plugin directory/i);
  });

  it('被拒绝的导入不会把宿主文件内容写进产物', async () => {
    const code = `import secret from "../host-secret.txt";
export const value = secret;`;
    await expect(bundlePlugin(code, pluginDir)).rejects.toThrow();
    // 若实现退化为「打包成功但过滤内容」，这里会拿到宿主机密；此处确保根本不产出 bundle
    const out = await bundlePlugin('export const ok = 1;', pluginDir);
    expect(out).not.toContain('HOST_SECRET_VALUE');
  });

  it('无法把宿主仓库的真实 package.json 打包进插件产物', async () => {
    // 复现审计中的真实攻击面：插件用相对穿越读取宿主 package.json 并内联进产物
    const hostPackageJson = path.resolve(__dirname, '../../../../package.json');
    if (!fs.existsSync(hostPackageJson)) return; // 目录布局变化时跳过
    const relative = path.relative(pluginDir, hostPackageJson).split(path.sep).join('/');
    const code = `import pkg from "${relative}";
export const value = pkg;`;
    await expect(bundlePlugin(code, pluginDir)).rejects.toThrow(/escapes the plugin directory/i);
  });
});
