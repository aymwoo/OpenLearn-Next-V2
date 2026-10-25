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

  it('2b. packages/core/version.ts 的 FALLBACK_VERSION 字面量必须与 package.json.version 一致', () => {
    // 为什么断言 1 不够：PLATFORM_VERSION 是**运行时从 package.json 读出来的**，
    // 断言 1 拿它和 package.json 比 —— 两者本来就是同一个来源，**恒等**，
    // 无论 version.ts 里的 FALLBACK_VERSION 字面量写成什么都不会红。
    //
    // 但 FALLBACK_VERSION 不是装饰品：当无法定位平台 package.json 时
    // （发布包 dist/ 布局、只拷了 dist/ 的部署方式）它就是对外展示的版本号 ——
    // 漏改会让启动横幅显示旧版本，而且**没有任何门禁会拦住**。
    //
    // 这里直接读源码把字面量抠出来比对，堵住这个盲区。
    const versionSrcPath = resolve(__dirname, '../version.ts');
    const src = readFileSync(versionSrcPath, 'utf-8');
    const matched = src.match(/const\s+FALLBACK_VERSION\s*=\s*'([^']+)'/);

    expect(matched, `未能从 ${versionSrcPath} 解析出 FALLBACK_VERSION 字面量（写法可能变了？）`).not.toBeNull();
    expect(
      matched![1],
      `[版本漂移拦截] packages/core/version.ts 的 FALLBACK_VERSION (${matched![1]}) 与 package.json (${currentVersion}) 不一致！` +
        '该字面量在无法定位平台 package.json 时会被当作对外版本号，漏改会让启动横幅显示旧版本。',
    ).toBe(currentVersion);
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
      confContent.includes(`version = '${currentVersion}'`) || confContent.includes(`version = "${currentVersion}"`);

    expect(
      hasDynamicRead || hasStaticMatch,
      `[文档版本漂移拦截] docs/conf.py 未同步当前平台版本 (${currentVersion})，且未启用动态读取 package.json！`,
    ).toBe(true);
  });
});
