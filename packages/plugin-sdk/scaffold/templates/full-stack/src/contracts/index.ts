/**
 * 类型契约目录（V3.2+）
 *
 * 将插件提供的服务接口和 Token 定义在此文件中。
 * 其他插件通过 import 获得编译期类型安全和运行时 Token。
 *
 * 使用方式（消费方）：
 *   import type { IMyService } from 'my-plugin/contracts';
 *   import { MyServiceToken } from 'my-plugin/contracts';
 *
 *   const service = await ctx.resolve(MyServiceToken);
 */

import { Token } from '@openlearn/plugin-sdk';

// ── 示例：定义一个可被其他插件消费的服务接口 ──────────────────────────

export interface IMyPluginService {
  /** 描述你的服务方法 */
  doSomething(input: string): Promise<string>;
}

export const MyPluginServiceToken = new Token<IMyPluginService>(
  'REPLACE_WITH_YOUR_PLUGIN_ID:IMyPluginService',
  '1.0.0',
);
