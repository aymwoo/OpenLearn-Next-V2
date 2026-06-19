# Phase 10: 基础设施配置与工程集成 - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-06-19
**Phase:** 10-infra-config
**Areas discussed:** 微前端子项目工程结构与端口规划, Module Federation 共享依赖控制策略, 动态 Base/Asset 资源路径解析方案, Tailwind CSS v4 样式扫描机制

---

## 微前端子项目工程结构与端口规划

### Q1: 微前端子项目 (Whiteboard, Courseware) 的源码文件在项目工程中应该存放在什么位置？
| Option | Description | Selected |
|--------|-------------|----------|
| `packages/mfe-[name]` | 作为独立的 pnpm workspace 放置在 packages 目录下，符合 monorepo 规范 | ✓ |
| `src/mfe-[name]` | 在主应用 src 目录中以子文件夹形式存在，工程边界相对模糊 | |
| You decide | 主导权交给 AI | |

**User's choice:** `packages/mfe-[name]`
**Notes:** 符合现有的 monorepo 工程模式。

### Q2: 在本地开发环境中，微前端远程子应用的端口分配策略是什么？
| Option | Description | Selected |
|--------|-------------|----------|
| 静态固定端口 | 例如 Whiteboard MFE 为 5174，Courseware MFE 为 5175，方便在 Host 中配置静态/动态 Remote | ✓ |
| 动态分配端口 | 每次启动开发服务器时自动寻找空闲端口，Host 需运行时检测并注册 | |
| You decide | 主导权交给 AI | |

**User's choice:** 静态固定端口
**Notes:** 端口固定有利于简化宿主应用对动态 Entry 的静态或初始解析配置。

### Q3: 子应用的依赖管理和版本同步应如何处理？
| Option | Description | Selected |
|--------|-------------|----------|
| pnpm workspace 共享工作区 | 在 pnpm-workspace.yaml 中注册包，并在根目录统一运行 pnpm install 统一版本 | ✓ |
| 完全隔离依赖 | 各子包独立维护 package.json 且不共享工作区，通过本地 npm link 或发布进行调试 | |
| You decide | 主导权交给 AI | |

**User's choice:** pnpm workspace 共享工作区
**Notes:** 减少主子应用依赖不同步的几率，保证开发环境的稳定。

### Q4: 子模块的 TypeScript 配置和编译目标 (Target) 应该如何确定？
| Option | Description | Selected |
|--------|-------------|----------|
| 根 TS 配置继承 + 统一编译到 esnext | 各远程模块继承根目录 tsconfig.json，保持 target: esnext 编译目标 | ✓ |
| 独立 TS 配置文件 | 每个子模块维护完全独立的 tsconfig.json，编译选项可定制 | |
| You decide | 主导权交给 AI | |

**User's choice:** 根 TS 配置继承 + 统一编译到 esnext
**Notes:** 对齐 Module Federation 2.0 对现代浏览器的要求。

---

## Module Federation 共享依赖控制策略

### Q1: 如何配置共享依赖 (React, React-DOM, Zustand) 的版本匹配严格度？
| Option | Description | Selected |
|--------|-------------|----------|
| 宽松版本校验 (strictVersion: false) | 允许主应用和子应用之间存在微小的 React/Zustand 版本差异，只要大版本兼容即可，降低加载失败率 | ✓ |
| 严格版本匹配 (strictVersion: true) | 版本不一致时直接拒绝加载，并在控制台报错，确保环境绝对一致，但开发中升级依赖难度较大 | |
| You decide | 主导权交给 AI | |

**User's choice:** 宽松版本校验 (strictVersion: false)
**Notes:** 兼顾加载容错度，避免小版本差异导致子应用直接崩溃。

### Q2: 如果共享单例依赖加载失败（或宿主未提供），子应用应如何处理？
| Option | Description | Selected |
|--------|-------------|----------|
| Fail-fast 拒绝加载 | 如果不满足 singleton 条件或加载失败，直接阻断该远程子应用的渲染，并在 Error Boundary 中展示友好提示，防止产生“双 React 实例”导致的 Hook 崩溃 | ✓ |
| 允许降级为独立副本 | 在缺少共享实例时尝试加载子应用自身的依赖副本，可能会导致 React 状态断裂，但在某些非 React 库中适用 | |
| You decide | 主导权交给 AI | |

**User's choice:** Fail-fast 拒绝加载
**Notes:** 避免双 React 实例造成的重大运行时钩子逻辑错乱。

### Q3: 共享依赖的版本范围（requiredVersion）该如何维护？
| Option | Description | Selected |
|--------|-------------|----------|
| 与 package.json 自动同步 | 在 vite.config.ts 中通过 import pkg from './package.json' 动态读取共享库的版本范围，保证升级包时配置自动同步 | ✓ |
| 手动硬编码版本 | 在 Vite 配置文件中手动写死共享依赖的版本号，防止意外的代码升级引入版本兼容问题 | |
| You decide | 主导权交给 AI | |

**User's choice:** 与 package.json 自动同步
**Notes:** 极大降低后续包更新维护的工作量。

### Q4: 对于 Lucide-React、Recharts、Motion (Framer Motion) 等非核心第三方库，我们该如何共享？
| Option | Description | Selected |
|--------|-------------|----------|
| 按需独立打包 | 仅共享 React/Zustand 核心库，其他如 Recharts, Lucide-React 等库由子应用按需自带/动态导入，保持 Host 首屏极速加载 | ✓ |
| 全局强共享单例 | 将 Lucide-React, Recharts, Motion 等公共库全部加入 Module Federation 共享列表，减少子应用打包体积，但会增加宿主首屏打包负担 | |
| You decide | 主导权交给 AI | |

**User's choice:** 按需独立打包
**Notes:** 保持宿主容器的精简和极速启动。

---

## 动态 Base/Asset 资源路径解析方案

### Q1: 子应用的静态资源 (图片、字体、异步 Chunk) 基准 URL (Base Path) 应如何确定？
| Option | Description | Selected |
|--------|-------------|----------|
| 运行时动态解析 (Runtime Dynamic Base) | 在构建时使用 'auto'，并在加载远程模块时，根据真实的远程组件入口 URL 动态解析和补全静态资源相对路径，极具灵活性，支持各种复杂的动态插件部署模式 | ✓ |
| 构建时静态指定 (Build-time Static Base) | 子应用编译时写死静态 base 路径，如 '/plugins/mfe-whiteboard/'。简单直接，但部署子应用的位置或子域名被完全绑定 | |
| You decide | 主导权交给 AI | |

**User's choice:** 运行时动态解析 (Runtime Dynamic Base)
**Notes:** 满足平台热插拔及动态插件加载路径的需求。

### Q2: 子应用的 Entry 地址 (如 remoteEntry.js) 应该由哪里存储和下发？
| Option | Description | Selected |
|--------|-------------|----------|
| 数据库动态注册 | 在 SQLite 中添加/使用插件表注册微应用 Entry URL，宿主启动和渲染时通过 REST API 动态获取列表并加载，支持不重启和不重新打包即可启停、更新子应用 | ✓ |
| 配置文件/环境变量硬编码 | 在 Host 编译时通过 .env 写入子应用的 Entry 静态 URL，开发调试简单，但生产环境中更新 URL 必须重新部署宿主应用 | |
| You decide | 主导权交给 AI | |

**User's choice:** 数据库动态注册
**Notes:** 支持管理员在后台动态变更和扩展子应用挂载，无缝衔接现有插件平台。

### Q3: 在生产环境下，编译后的子应用构建产物在服务端应如何托管和隔离？
| Option | Description | Selected |
|--------|-------------|----------|
| 独立子目录静态托管 | 构建产物各自输出到对应的 dist 目录中，在 Node.js 服务端以 '/plugins/mfe-[name]/*' 为基础路径独立静态托管，物理上和逻辑上完美隔离 | ✓ |
| 宿主 dist 目录混合打包 | 将所有子应用打包产物输出合并到主应用的 dist 目录下，需要极力小心 Chunk 命名冲突，维护成本高 | |
| You decide | 主导权交给 AI | |

**User's choice:** 独立子目录静态托管
**Notes:** 各模块独立部署，逻辑清晰，不存在产物覆盖风险。

### Q4: 当子应用在加载过程中出现 Chunk 丢失或网络异常时，应该采用什么级别的恢复机制？
| Option | Description | Selected |
|--------|-------------|----------|
| 自动重试机制 | 捕获 import() 异常，自动进行最多 3 次指数退避重试加载，以应对弱网或临时的静态资源加载失败，最后失败再抛给 Error Boundary | ✓ |
| 立即报错 | 首加载失败即抛出异常，完全交给 UI 层级的 Error Boundary 报错，简化加载逻辑 | |
| You decide | 主导权交给 AI | |

**User's choice:** 自动重试机制
**Notes:** 提高了宿主应用加载的弹性和健壮性。

---

## Tailwind CSS v4 样式扫描机制

### Q1: 微前端架构下，子应用中编写的 Tailwind CSS 类应该在何处编译？
| Option | Description | Selected |
|--------|-------------|----------|
| 宿主侧集中扫描编译 | 在 Host 的 index.css 中通过 '@source "../packages/mfe-*/src/**/*.{ts,tsx}"' 指令扫描所有子应用的组件，在 Host 编译阶段生成单个高度优化的 CSS，简单高效，避免重复打包 | ✓ |
| 子应用独立编译与注入 | 各子应用独立打包自己的 Tailwind 样式文件，在被 Host 加载时通过样式表注入。可实现子应用样式独立，但会增加重复的 CSS 规则和运行时的注入开销 | |
| You decide | 主导权交给 AI | |

**User's choice:** 宿主侧集中扫描编译
**Notes:** 大幅度降低静态样式重合打包，并保持首屏加载无样式闪烁（FOUC）。

### Q2: 在共享样式的背景下，如何避免宿主与子应用（或子应用之间）的自定义 CSS 样式命名冲突？
| Option | Description | Selected |
|--------|-------------|----------|
| 规范命名空间与 CSS Modules 隔离 | 对自定义样式采用命名空间命名，或使用 React CSS Modules。对于 Tailwind 的 utility classes 则保持默认不隔离，以最大限度共享样式，减少代码体积 | ✓ |
| Tailwind 样式前缀隔离 | 为每个子应用配置不同的 Tailwind utility prefix，如 'wbt-'、'cws-'。隔离度高，但开发时编写样式类名会繁琐，且会增加编译出的 CSS 体积 | |
| You decide | 主导权交给 AI | |

**User's choice:** 规范命名空间与 CSS Modules 隔离
**Notes:** 保持原子工具类的绝对共用，对少量的自定义类进行本地化隔离。

### Q3: 主应用和子应用之间，样式设计系统（设计变量、主题色调）该如何共享和同步？
| Option | Description | Selected |
|--------|-------------|----------|
| Host :root 原生 CSS 变量共享 | 在宿主的 CSS 中定义全局设计系统变量，如 '--color-primary'，子应用在自己的 CSS 或 Tailwind 配置中直接继承并使用这些原生 CSS 变量，确保主题风格完全一致 | ✓ |
| 通过 JS 上下文动态传递主题配置 | 主应用利用 React Context / Zustand 将主题配色方案传递给子应用，子应用使用 JS 动态计算样式。灵活度最高，但有运行时的性能开销 | |
| You decide | 主导权交给 AI | |

**User's choice:** Host :root 原生 CSS 变量共享
**Notes:** 使用 Web 标准方式，零运行时 JS 损耗，且开箱即用。

### Q4: 子应用如果引入了额外的第三方 UI 组件库（自带 CSS），这些样式应该如何加载和隔离？
| Option | Description | Selected |
|--------|-------------|----------|
| 子应用生命周期挂载与清理 | 在子应用的 mount 钩子中动态插入特定第三方库的 CSS 样式表，并在 unmount 时自动移除，防止非活动期间样式污染宿主或其他子应用 | ✓ |
| 宿主全局打包引入 | 在宿主的 index.css 中提前引入所有可能用到的第三方 UI 组件库 CSS。实现最简单，但会使宿主 CSS 文件体积急剧增大，且可能造成全局样式覆盖 | |
| You decide | 主导权交给 AI | |

**User's choice:** 子应用生命周期挂载与清理
**Notes:** 完美做到了生命周期沙箱化，避免侧边库影响主应用视觉。

---

## Deferred Ideas

None — discussion stayed within phase scope.
