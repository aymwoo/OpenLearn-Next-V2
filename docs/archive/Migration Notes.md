# OpenLearn Server Bootstrap Migration Notes (服务器启动迁移说明)

## 1. Executive Summary (概述)

在 Platform Increment PI-005 中，通过引入 `ServerBootstrapAdapter`，成功将生产环境入口 `server.ts` 接轨至 Platform Kernel 启动流程。

---

## 2. Zero-Downtime Migration Verification (零中断迁移验证)

1. **业务逻辑零改写**: `kernelContainer` 实例化逻辑与 Express 路由定义未发生任何重写。
2. **底层子系统零变动**: Plugin Host, Lesson Engine, Whiteboard, Analytics Engine, AI Runtime, Provider Gateway, Student/Teacher Runtime 保持 100% 不变。
3. **入口适配性**: `startServer()` 内部优先通过 `ServerBootstrapAdapter.bootstrap(...)` 执行托管，确保以后运行期监控与生命周期审计能力就绪。
