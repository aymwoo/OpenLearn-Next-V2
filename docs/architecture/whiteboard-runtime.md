# Whiteboard Runtime 白板引擎与 Canvas 对象模型

Whiteboard 引擎位于 `src/features/whiteboard/` 与 `packages/core/` 微前端适配模块中，提供高性能矢量画布渲染、Canvas 对象模型与跨终端实时协同绘制功能。

---

## Canvas 对象模型 (Canvas Object Model)

画布中的每一个渲染元素均继承自统一的 `CanvasObject` 基础结构：

```typescript
export interface CanvasObject<T = any> {
  id: string;
  type: string; // 'path' | 'text' | 'shape' | 'geogebra-widget' | 'html-applet' | 'image' | 'custom'
  position: { x: number; y: number };
  size: { width: number; height: number };
  rotation: number;
  zIndex: number;
  locked: boolean;
  payload: T;
}
```

---

## 渲染器注册体系 (Renderer Registry)

白板渲染采用插件化注册模式，任何新增的图形或富媒体组件均通过 `rendererRegistry` 动态扩充：

```typescript
import { rendererRegistry } from '../features/whiteboard/canvas-model';

// 注册渲染器
rendererRegistry.registerRenderer('geogebra-widget', GeoGebraRenderer);
```

---

## 协同渲染与增量同步

1. **增量事件**: 绘制路径或移动对象时，通过 Socket.IO 发送 `whiteboard.draw` / `whiteboard.object_transformed` 增量包。
2. **OT / CRDT 冲突解决**: 基于时间戳（uuidv7）与版本号控制，确保多端同屏协同不出现卡顿或乱序覆盖。

---

## 交互式 Web 课件 (html-applet)

在 V0.2.1 中，白板系统引入了对富交互 Web 课件（`html-applet`）的支持。

### 画布对象与渲染管线

当 `type === 'html-applet'` 时，白板将其渲染为一个嵌入的 Web 课件窗口：

- **沙箱隔离**: 课件在 `<iframe>` 内渲染，并强制添加 `sandbox="allow-scripts allow-forms allow-downloads"`（无 `allow-same-origin`）、`referrerPolicy="no-referrer"` 与 `credentialless`，以防止 XSS 与提权风险。
- **Bridge 注入**: 针对 URL 托管课件（通过 `/runtime/:uuid/` 下发），服务端会在 HTML 响应头自动注入 Bridge SDK。
- **统一组件**: 画布内嵌、全屏渲染器、默认兜底渲染器三处统一复用 `<HtmlAppletFrame>`（`src/features/whiteboard/components/HtmlAppletFrame.tsx`），按优先级解析四种内容源：`coursewareUuid` → `resourceId` → 插件自定义内容源（`coursewareSourceRegistry`）→ `code`（`srcDoc`）。
- **懒挂载与并发上限**: iframe 进入可视区（含 200px 预加载边距）才创建，同时挂载的 iframe 数不超过 4 个（`courseware-frame-limiter.ts`）。
- **双向通信**: `window.LMS` 支持 `submit`/`saveProgress`/`finish`/`log`/`setConfig`/`getProgress`/`on`/`off`；课件事件经前端 EventBus 转发到后端供 AI Agent 与插件订阅。
- **课件列表缓存与防抖**: 维护模块级 `globalCoursewareCache`（30 秒 TTL 与并发请求 Promise 复用），并通过 `lastSelectedCoursewareElementRef` 精确追踪图元选中态，避免白板图元心跳轮询触发高频重复请求。

### SrcDoc 模式与 wrapSrcDocWithBridge

对于纯文本/无后端的单体离线课件资源，使用 iframe 的 `srcdoc` 属性直接挂载 HTML 字符串。
为解决 `srcdoc` 同域沙箱代理问题，引擎提供了 `wrapSrcDocWithBridge(htmlString)` 函数，该模式下：

1. 会自动将 Bridge SDK 运行时逻辑打包为 IIFE 或 内联 `<script>` 注入到 `htmlString` 头部。
2. Bridge 内部同样采用 `Object.defineProperty` 与 `Proxy` 拦截 `window.parent` 和 `window.top`，并将跨域 `postMessage` 通信时 `targetOrigin === 'null'` 的消息规范化为 `'*'`。

### 工具栏入口

用户可以在主 **WhiteboardToolbar** 工具栏点击新增的 **Globe（地球仪）** 按钮。该操作将弹出资源选择器，允许讲师选择/上传 HTML 课件包或直接粘贴网页 URL，从而创建并同步挂载一个 `html-applet` 实例。

### 课件运行时脚本扩展点与成绩采集

互动课件运行在 `credentialless` + 无 `allow-same-origin` 的 iframe 中，是一条「看不到平台界面」的孤岛链路：分数必须在课件内部被抓到，再经 Bridge 送回平台。平台为此提供三件套，且**不再依赖任何第三方插件**：

1. **运行时脚本扩展点**：`packages/core/di/courseware-runtime-script-registry.ts` 实现 `ICoursewareRuntimeScriptRegistry`（Token `@openlearn/core:ICoursewareRuntimeScriptRegistry`），按 `${owner}::${id}` 登记待注入脚本，支持 `head` / `body-end` 两个插入位与优先级排序。`server/routes/shared.ts` 的 `collectCoursewareRuntimeScripts()` 在 `injectLmsSdk()` 注入 Bridge SDK 之后把这些脚本一并写进 HTML；任一环节异常都静默降级，不影响课件加载。
2. **分数变量监视器**：`packages/plugins/score-monitor-script.ts` 由内置插件注册到上述扩展点，运行在课件 iframe 内，用三层采集持续观察「疑似分数」变量 —— 显式声明（`window.__LMS_WATCH__`）→ 遍历 `window` 上的数值属性做启发式发现（键名命中 `score` / `point` / `grade` / `mark` / `correct` 等）→ DOM 可见文本兜底；静默窗口内不再变化即通过 `LMS.saveProgress({ score, watch })` 上报一次样本，并支持 `window.__LMS_WATCH__ === false` 退出。
3. **成绩策略归集**：`packages/plugins/courseware-score.ts` 是无 IO 的纯函数模块（`getNested` / `toNumber` / `parseScoreFields` / `extractScoreFromFields` / `collectScoreSamples` / `aggregateScores` / `clamp` / `round2`），被 `courseware.submit_attempt` 与 `POST /api/courseware/attempts/:attemptId/log` 共用同一口径：原始载荷先追加进 append-only 的 `submission_raw`，再按 `courseware_score_config` 表（迁移 `migrations/004_courseware_score_config.sql`）配置的 `LATEST` / `MAX` / `AVERAGE` / `FIRST` 策略与满分折算算出 `submission_result.score`。配置由 `courseware.get_score_config` / `courseware.save_score_config` / `courseware.list_score_configs` / `courseware.regrade_attempts` 四个原生命令管理，改策略后可重算历史成绩而无需学生重做。

> **为什么不把监视器直接写进服务端注入的 Bridge SDK 模板字符串**：模板字符串里的正则/转义极易出错（历史上 `\\d` 双重转义曾导致抓分正则全部失效），且无法按课件粒度裁剪、停用或单独测试。扩展点让「谁来监视什么」变成可注册、可撤销的插件能力。

---

## 白板防抖自动保存机制 (Debounced Auto-Save System)

为避免教师编辑教案或书写复杂板书时突发掉电或误关浏览器导致数据丢失，白板引擎提供了 `WhiteboardAutoSaveManager`（`src/features/whiteboard/services/whiteboard-autosave-manager.ts`）：

1. **脏数据深度检测 (Dirty Tracking)**：基于深比较算法对比当前画布元素集合与最后一次持久化快照，仅在画布真正变更时标记脏状态。
2. **动态防抖窗口 (Debounce Window)**：内置 1500ms（可配置）防抖时钟，在高频笔触书写或连续拖动过程中持续重置计时器，待停笔后平滑下发持久化网络请求，避免高频并发写冲击。
3. **安全卸载保护 (Unload Safeguard)**：监听浏览器的 `beforeunload` 与组件卸载生命周期，若检测到仍有未持久化的脏数据，毫秒级同步触发紧急保全，保障板书资产零丢失。
4. **插件拦截与观察者模式**：提供 `saveInterceptor` 扩展点，允许第三方插件在持久化前后执行加密、备份或审计。

---

## 智能随机抽问与分层轮盘 (Fair Tiered Random Picker)

为改变传统课堂提问扎堆或点名不均问题，引擎在 `src/features/whiteboard/services/fair-picker-engine.ts` 引入了公平分层抽取算法：

1. **历史频次降采样惩罚**：记录学生本堂课与本学期历史发言次数，动态计算被抽取权重 $W_i = \max(1, 100 - C_i \times 25)$，大幅降低高频发言者的连中概率，优先眷顾课堂静默学生。
2. **分层难度梯级匹配 (Tiered Mode)**：
   - **基础题梯度**：优先匹配学困生与待巩固学生，保护自信心；
   - **进阶题梯度**：面向班级中坚学生群体；
   - **拔高题梯度**：重点匹配学优生，激发高阶挑战欲。
3. **即时积分金币与声光特效**：抽问评价后，教师一键派发成长金币，学生机端实时展示声光徽章特效。

