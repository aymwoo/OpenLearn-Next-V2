import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import semver from 'semver';
import { PLATFORM_VERSION, OPENLEARN_VERSION } from '../version.js';
import { PLATFORM_VERSION as BOOTSTRAP_VERSION } from '../bootstrap/types/index.js';
import { PlatformBuilder } from '../bootstrap/builder/platform-builder.js';

import { BuiltinPlugin } from '../../plugins/builtin.js';
import { VfsPlugin } from '../../plugins/vfs.js';
import { ProcessPlugin } from '../../plugins/process.js';
import { ManagementPlugin } from '../../plugins/management.js';
import { AiPlannerPlugin } from '../../plugins/ai-planner.js';
import { AiSubmitInjectorPlugin } from '../../plugins/ai-submit-injector.js';
import { AssignmentEvalPlugin } from '../../plugins/assignment-eval.js';

describe('Version Consistency Gate (防版本漂移自动化质量门禁)', () => {
  const rootPkgPath = resolve(__dirname, '../../../package.json');
  const rootPkg = JSON.parse(readFileSync(rootPkgPath, 'utf-8'));
  const currentVersion = rootPkg.version;

  it('1. packages/core/version.ts 中的 PLATFORM_VERSION 必须与根目录 package.json.version 强一致', () => {
    expect(
      PLATFORM_VERSION,
      `[版本漂移拦截] packages/core/version.ts (${PLATFORM_VERSION}) 与 package.json (${currentVersion}) 不一致！发布前请同步升级。`,
    ).toBe(currentVersion);
  });

  it('2. OPENLEARN_VERSION 别名必须与 PLATFORM_VERSION 保持 100% 一致', () => {
    expect(OPENLEARN_VERSION).toBe(PLATFORM_VERSION);
  });

  it('3. Bootstrap 内核导出的 PLATFORM_VERSION 必须严格与核心版本一致', () => {
    expect(BOOTSTRAP_VERSION).toBe(PLATFORM_VERSION);
  });

  it('4. PlatformBuilder 构建元数据版本必须严格与核心版本一致', () => {
    const builder = PlatformBuilder.create();
    const result = builder.buildResult();
    expect(result.builderVersion).toBe(PLATFORM_VERSION);
    expect(result.platformContext.version).toBe(PLATFORM_VERSION);
    expect(result.platformContext.runtimeMetadata.buildVersion).toBe(PLATFORM_VERSION);
    builder.dispose();
  });

  it('5. 全量 7 个核心内置插件的 engines.openlearn 必须兼容当前平台版本', () => {
    const corePlugins = [
      BuiltinPlugin.manifest,
      VfsPlugin.manifest,
      ProcessPlugin.manifest,
      ManagementPlugin.manifest,
      AiPlannerPlugin.manifest,
      AiSubmitInjectorPlugin.manifest,
      AssignmentEvalPlugin.manifest,
    ];

    expect(corePlugins).toHaveLength(7);

    for (const manifest of corePlugins) {
      expect(manifest.engines?.openlearn).toBeDefined();
      const satisfies = semver.satisfies(PLATFORM_VERSION, manifest.engines!.openlearn!);
      expect(
        satisfies,
        `[插件互锁拦截] 内置核心插件 "${manifest.id}" 的 engines.openlearn 约束 ("${manifest.engines?.openlearn}") 无法被平台当前版本 ("${PLATFORM_VERSION}") 满足！`,
      ).toBe(true);
    }
  });

  it('6. docs/conf.py 必须动态或静态对齐 package.json.version', () => {
    const confPyPath = resolve(__dirname, '../../../docs/conf.py');
    const confContent = readFileSync(confPyPath, 'utf-8');
    const hasDynamicRead = confContent.includes('package.json');
    const hasStaticMatch =
      confContent.includes(`version = '${currentVersion}'`) ||
      confContent.includes(`version = "${currentVersion}"`);

    expect(
      hasDynamicRead || hasStaticMatch,
      `[文档版本漂移拦截] docs/conf.py 未同步当前平台版本 (${currentVersion})，且未启用动态读取 package.json！`,
    ).toBe(true);
  });
});
