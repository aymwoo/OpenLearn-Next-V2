/**
 * SDK 3.7.0 已发布形态的最小 manifest 必须继续通过当前 manifestSchema。
 *
 * 已撤回的 token 由 SDK 兼容测试锁定。这里锁定的是安装期 schema：一份第三方
 * 插件会写出的清单在 schema 收紧后仍应 parse 成功，且声明的 contributes
 * 不会被剥掉。插件 id 不用 @openlearn/ 前缀，也不声明 segment.gate_type。
 *
 * 若某个 contributes 键被 schema 拒绝，应改这份夹具，不要放宽 schema。
 */
import { describe, expect, it } from 'vitest';
import { manifestSchema } from '../manifest-schema.js';

/** 对齐 SDK 3.7.0 时期脚手架会写出的最小已发布形态。 */
const SDK_370_PUBLISHED_MANIFEST = {
  id: 'ext-compat-fixture',
  name: 'Compat Fixture',
  version: '1.0.0',
  main: 'index.js',
  description: 'Minimal published-shaped manifest frozen against schema tightening.',
  engines: { openlearn: '>=0.6.1' },
  contributes: {
    'classroom.tool': [
      {
        id: 'compat-tool',
        name: 'Compat Tool',
        icon: 'Sparkles',
        commandType: 'ext-compat-fixture.open',
      },
    ],
    'teacher.tab': [{ id: 'compat-tab', label: 'Compat', position: 10 }],
  },
};

describe('SDK 3.7.0 published manifest still parses', () => {
  it('accepts the minimal ext-compat-fixture manifest', () => {
    expect(SDK_370_PUBLISHED_MANIFEST.id.includes('@openlearn/')).toBe(false);
    expect(JSON.stringify(SDK_370_PUBLISHED_MANIFEST).includes('segment.gate_type')).toBe(false);

    const parsed = manifestSchema.safeParse(SDK_370_PUBLISHED_MANIFEST);
    const detail = parsed.success
      ? ''
      : parsed.error.issues.map((issue) => `${issue.path.join('.')}: ${issue.message}`).join('; ');
    expect(parsed.success, detail).toBe(true);
    if (!parsed.success) return;

    expect(parsed.data.id).toBe('ext-compat-fixture');
    expect(parsed.data.version).toBe('1.0.0');
    expect(parsed.data.main).toBe('index.js');
    expect(parsed.data.engines).toEqual({ openlearn: '>=0.6.1' });
    expect(parsed.data.contributes).toEqual(SDK_370_PUBLISHED_MANIFEST.contributes);
  });
});
