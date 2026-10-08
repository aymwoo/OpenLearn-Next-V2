/**
 * G-4b 回归测试：静态路由冲突检测的归一化。
 *
 * ## 缺陷
 *
 * 冲突检测原先只做 `toLowerCase()`：
 *   `if (ownerId !== manifest.id && existingRoute.toLowerCase() === normalized)`
 *
 * 而 Express 把 `/foo` 与 `/foo/` 当作**同一个** mount point（先挂载者生效）。
 * 于是两个插件分别声明 `/assets` 与 `/assets/` 时：
 *   ① 冲突检测放行
 *   ② Express 静默让先挂载的赢
 *   ③ 后挂载插件的静态资源**永久 404，且没有任何日志或报错**
 *
 * 这类故障排查成本极高：现象是「资源 404」，病因在两个插件的 manifest 里，
 * 而且只在特定挂载顺序下出现。
 *
 * ## 第二个面：恢复路径完全绕过检测
 *
 * `setExpressApp()` 的重启恢复路径原先**既不归一化、也不查冲突**，
 * 直接 `expressApp.use(原始路由)`。于是安装期检出（或未检出）的冲突在重启后
 * 被完全绕过 —— 修安装路径而不修恢复路径，等于只在半数时间生效。
 */

import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { normalizeStaticRoute as normalize } from '../static-route.js';

const ROOT = path.resolve(process.cwd(), 'packages/core/plugin-host');
// L-2 阶段 2：PluginHost 已拆成抽象类继承链，SEC-ROUTE-02/03 的安装路径守卫在 install.ts，
// setExpressApp 的恢复挂载段在 core.ts。下面几段「源码文本断言」分别读对应文件。
const INSTALL_SRC = fs.readFileSync(path.join(ROOT, 'install.ts'), 'utf-8');
const CORE_SRC = fs.readFileSync(path.join(ROOT, 'core.ts'), 'utf-8');

/**
 * 直接 import 生产代码。
 *
 * 原先这里是 25 行字符串手术 —— 从 `plugin-host/index.ts` 的源码文本里按标记
 * `private static normalizeStaticRoute(...)` 切出函数体，再用 `new Function` 求值。
 * 之所以要这么绕：`private static` 既不能被类外 import，也无法被继承。
 *
 * L-2 阶段 2 把该纯函数抽成了独立模块（`static-route.ts`），类上的静态方法改为委托。
 * 于是测试可以直接测真货 —— 这比"执行从源码切出来的文本"更可靠：
 * 后者一遇到源码结构调整就报「源码结构变了？」，而那不是被测行为出错。
 */

describe('G-4b · 静态路由归一化', () => {
  it('末尾斜杠等价：/foo 与 /foo/ 归一到同一形式', () => {
    expect(normalize('/foo')).toBe(normalize('/foo/'));
    expect(normalize('/foo/')).toBe('/foo');
  });

  it('大小写等价（沿用既有行为）', () => {
    expect(normalize('/Foo')).toBe(normalize('/foo'));
  });

  it('重复斜杠等价：//a//b ≡ /a/b', () => {
    expect(normalize('//a//b')).toBe('/a/b');
  });

  it('缺少前导斜杠时补上', () => {
    expect(normalize('foo/bar')).toBe('/foo/bar');
  });

  it('根路径 / 保持为 /（不能被削成空串）', () => {
    expect(normalize('/')).toBe('/');
    // 幂等：反复归一化不改变结果
    expect(normalize(normalize('/'))).toBe('/');
  });

  it('首尾空白被裁掉', () => {
    expect(normalize('  /foo/  ')).toBe('/foo');
  });

  it('幂等：对已归一化的结果再归一化不产生变化', () => {
    for (const r of ['/foo', '/foo/', '/Foo/', '//a//b', '/', '/a/b/c']) {
      const once = normalize(r);
      expect(normalize(once), `对 "${r}" 归一化不幂等`).toBe(once);
    }
  });

  it('不同路由不被误合并', () => {
    // 归一化不能把两个语义不同的路由压成同一个 —— 那会误报冲突
    expect(normalize('/foo')).not.toBe(normalize('/foobar'));
    expect(normalize('/a')).not.toBe(normalize('/b'));
    expect(normalize('/a/b')).not.toBe(normalize('/a/c'));
  });
});

describe('G-4b · 安装路径与恢复路径都做归一化冲突检测', () => {
  /**
   * 定位安装路径的冲突检测段（SEC-ROUTE-03）。
   *
   * 用行首锚定的正则而非 `indexOf`：`SEC-ROUTE-02` 这个词我在
   * `normalizeStaticRoute` 的文档注释里也引用过一次，`indexOf` 会命中那里。
   * 这与本轮第三次踩到的坑同源：**同名字面量先出现在注释里，切片就切错地方。**
   */
  function installPathGuard(): string {
    const m = /^\s*\/\/ SEC-ROUTE-03:/m.exec(INSTALL_SRC);
    expect(m, '未找到 SEC-ROUTE-03 标记行').not.toBeNull();
    return INSTALL_SRC.slice(m!.index, m!.index + 1400);
  }

  /** 定位 setExpressApp 里的恢复挂载段 */
  function restorePathGuard(): string {
    const at = CORE_SRC.indexOf('Restored static route');
    expect(at, '未找到恢复挂载日志').toBeGreaterThan(-1);
    // 从「解 manifest」那行往前取，才能覆盖到冲突检测代码
    const start = CORE_SRC.lastIndexOf('if (m.deploy?.staticRoute', at);
    return CORE_SRC.slice(start, at + 200);
  }

  it('安装路径：冲突比较两侧都经归一化，且不再只是裸 toLowerCase', () => {
    const seg = installPathGuard();
    expect(seg, '比较时应对已注册路由再归一化一次（该 Map 也可能被恢复路径写入）').toMatch(
      /normalizeStaticRoute\(existingRoute\)\s*===\s*normalized/,
    );
    expect(seg, '仍存在裸 toLowerCase 比较 —— /foo 与 /foo/ 检不出冲突').not.toMatch(/existingRoute\.toLowerCase\(\)/);
  });

  it('安装路径：注册的是归一化形式', () => {
    const seg = installPathGuard();
    expect(seg, '存入 Map 的应是归一化形式，使后续比较不依赖调用方记得归一').toMatch(
      /_registeredRoutes\.set\(manifest\.id,\s*normalized\)/,
    );
  });

  it('安装路径：SEC-ROUTE-02 保留前缀比对也用归一化形式', () => {
    const m = /^\s*\/\/ SEC-ROUTE-02:/m.exec(INSTALL_SRC);
    expect(m, '未找到 SEC-ROUTE-02 标记行').not.toBeNull();
    const seg = INSTALL_SRC.slice(m!.index, m!.index + 400);
    expect(seg, '保留前缀比对应基于归一化形式 —— 否则 /API/ 可绕过 /api 的保留检查').toMatch(
      /const normalized = PluginHostCore\.normalizeStaticRoute\(route\)/,
    );
  });

  it('恢复路径：也做冲突检测（修复前完全绕过）', () => {
    const seg = restorePathGuard();
    expect(seg, '重启恢复路径不查冲突 ⇒ 安装期检出的冲突在重启后被绕过，等于只在半数时间生效').toMatch(
      /normalizeStaticRoute/,
    );
    expect(seg, '恢复路径应显式告警冲突，而不是静默遮蔽').toMatch(/Static route conflict on restore/);
  });

  it('恢复路径：冲突时不挂载（continue）', () => {
    const seg = restorePathGuard();
    expect(seg, '检出冲突后应跳过挂载').toMatch(/continue;/);
  });
});
