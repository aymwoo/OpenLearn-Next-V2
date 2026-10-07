/**
 * G-2 / G-3 回归测试：`/api/plugins/*` 路由的鉴权与命令解析边界。
 *
 * 背景（审计 H-1 / M-5）：
 * - M-5：`/api/plugins/:id(*)` 与 `/api/plugins/by-manifest/:manifestId(*)`
 *   此前**完全没有 requireAuth()**，而同文件其余 15 个插件路由都有 →
 *   匿名可枚举全部插件 id / version / executionMode / capabilitiesProposed，
 *   即攻击面形状被完整测绘。
 * - H-1：`execute-command` 此前用 `key.endsWith(':' + type) || key.endsWith('.' + type)`
 *   做后缀模糊匹配 —— 调用方只需知道某个**裸**命令名，就能命中**任意插件**的 handler，
 *   把「我只能调我自己的命令」变成「我能调所有后缀匹配的」。
 */
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROUTES_FILE = path.resolve(__dirname, '../routes/plugins.ts');

const src = fs.readFileSync(ROUTES_FILE, 'utf-8');

/**
 * 抽取某个 `app.<method>('<path>'` 声明的**参数列表**（含 requireAuth 中间件）。
 *
 * 只匹配到引号结尾是不够的 —— requireAuth 作为第二个参数写在闭合引号之后，
 * 因此这里从路由路径处向后扫描到该 app 调用语句的右括号为止。
 */
function declaration(method: string, routePath: string): string {
  const re = new RegExp(`app\\.${method}\\(\\s*'${routePath.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}'`);
  const m = re.exec(src);
  if (!m) return '';
  // 从匹配位置起做括号配平，取出完整实参列表
  let depth = 0;
  for (let i = m.index; i < src.length; i++) {
    if (src[i] === '(') depth++;
    else if (src[i] === ')') {
      depth--;
      if (depth === 0) return src.slice(m.index, i + 1);
    }
  }
  return src.slice(m.index, m.index + 300);
}

describe('G-3：插件详情端点必须鉴权', () => {
  it('/api/plugins/:id(*) 带 requireAuth()', () => {
    const decl = declaration('get', '/api/plugins/:id(*)');
    expect(decl).toContain('requireAuth(');
  });

  it('/api/plugins/by-manifest/:manifestId(*) 带 requireAuth()', () => {
    const decl = declaration('get', '/api/plugins/by-manifest/:manifestId(*)');
    expect(decl).toContain('requireAuth(');
  });

  it('插件写操作（install / toggle / delete / config）仍限定 administrator', () => {
    for (const route of [
      '/api/plugins',
      '/api/plugins/upload-zip',
      '/api/plugins/:id(*)/toggle',
      '/api/plugins/:id(*)',
      '/api/plugins/install-from-url',
    ]) {
      const method = route === '/api/plugins/:id(*)' ? 'delete' : 'post';
      const decl = declaration(method, route);
      expect(decl, `${method.toUpperCase()} ${route}`).toContain("requireAuth('administrator')");
    }
  });
});

describe('G-2：execute-command 不做后缀模糊匹配', () => {
  it('路由仍保留 requireAuth()（本端点由学生端宿主共用，不得限制角色）', () => {
    const decl = declaration('post', '/api/plugins/execute-command');
    expect(decl).toContain('requireAuth(');
    expect(decl).not.toContain("requireAuth('teacher'");
  });

  it('不再存在 endsWith 后缀匹配逻辑', () => {
    // 该匹配会把请求重定向到其它插件的 handler key
    expect(src).not.toMatch(/endsWith\(\s*['"]:\s*['"]\s*\+\s*resolvedType/);
    expect(src).not.toMatch(/endsWith\(\s*['"]\.\s*['"]\s*\+\s*resolvedType/);
  });

  it('未命中 handler 时返回 404 且不做任何猜测', () => {
    const idx = src.indexOf("'/api/plugins/execute-command'");
    expect(idx).toBeGreaterThan(-1);
    const block = src.slice(idx, idx + 3000);
    expect(block).toContain('status(404)');
    expect(block).toMatch(/No handler registered for command type/);
    // resolvedType 现在是 type 的直接别名，不再被重新赋值
    expect(block).toMatch(/const resolvedType = type;/);
    expect(block).not.toMatch(/resolvedType = key/);
  });

  it('错误信息提示调用方应发送完整命名空间命令名', () => {
    const idx = src.indexOf("'/api/plugins/execute-command'");
    const block = src.slice(idx, idx + 3000);
    expect(block).toMatch(/fully-namespaced commandType/);
  });
});
