# 系统配置架构规范

OpenLearn V2 的配置子系统在 `packages/core/configuration/` 与 `packages/core/plugin-host/config-service.ts` 中实现，提供了类型安全、动态更新与版本校验的配置管理方案。

---

## 配置架构

平台配置划分为三个层级：
1. **系统级配置 (System Config)**: 包含 SQLite 数据库路径、服务端口、JWT Secret 及 Gemini API Key。
2. **内核级配置 (Kernel Config)**: Worker 线程池最大容量、插件运行沙箱上限及事件总线超时设置。
3. **插件级配置 (Plugin Config)**: 插件通过 Manifest 声明的配置属性表（Config Declarations）。

---

## 插件配置规范 (Config Declaration Schema)

每个插件可在 `manifest.json` 中配置声明：

```json
{
  "config": {
    "maxStudents": {
      "type": "number",
      "default": 50,
      "description": "单个互动组最大允许的学生人数"
    },
    "enableAutoSave": {
      "type": "boolean",
      "default": true,
      "description": "是否开启白板自动保存"
    }
  }
}
```

在插件运行时，可以通过 `IConfigService` 获取与监听配置变化：

```typescript
import type { IConfigService } from '@openlearn/plugin-sdk';

export async function activate(ctx: PluginContext) {
  const configService = ctx.config;
  const maxStudents = configService.get<number>('maxStudents');
  
  configService.onChange('maxStudents', (newValue) => {
    console.log(`maxStudents 配置更新为: ${newValue}`);
  });
}
```
