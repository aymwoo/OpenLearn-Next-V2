import React, { useState, useEffect } from 'react';
import { HelpCircle, Terminal, Puzzle, BookOpen, FileText } from 'lucide-react';
import { useAppStore } from '../../store/appStore';
import { CommandBusPlayground } from './help/CommandBusPlayground';
import { SdkGuideViewer } from './help/SdkGuideViewer';
import { UserGuideViewer } from './help/UserGuideViewer';
import { PluginDocsViewer } from './help/PluginDocsViewer';

interface HelpViewProps {
  registeredCommands: any[];
  onRefresh: () => void;
}

export function HelpView({ registeredCommands, onRefresh }: HelpViewProps) {
  const lang = useAppStore((s) => s.lang);
  const [activeTab, setActiveTab] = useState<'commands' | 'sdk_guide' | 'user_guide' | 'plugin_docs'>('commands');
  const [copiedId, setCopiedId] = useState<string | null>(null);

  const [pluginGuideMd, setPluginGuideMd] = useState<string>('');
  const [loadingMd, setLoadingMd] = useState<boolean>(false);

  useEffect(() => {
    if (activeTab === 'sdk_guide' && !pluginGuideMd) {
      setLoadingMd(true);
      fetch('/api/docs/plugin-guide')
        .then(res => res.json())
        .then(data => {
          if (data.success) {
            setPluginGuideMd(data.content);
          } else {
            setPluginGuideMd('加载失败: ' + (data.error || '未知错误'));
          }
        })
        .catch(err => {
          setPluginGuideMd('加载出错: ' + err.message);
        })
        .finally(() => {
          setLoadingMd(false);
        });
    }
  }, [activeTab, pluginGuideMd]);

  const handleCopy = (id: string, text: string) => {
    navigator.clipboard.writeText(text);
    setCopiedId(id);
    setTimeout(() => setCopiedId(null), 1500);
  };

  const pluginBoilerplateCode = `# 快速开始：3 分钟创建插件

使用 \`@openlearn/plugin-sdk\` CLI 脚手架，一键生成完整项目：

\`\`\`bash
# 创建插件项目
npx @openlearn/plugin-sdk init --name hello-world

# 进入项目并构建
cd hello-world
npm install
npx @openlearn/plugin-sdk build

# 产物：hello-world.zip → 上传到插件中心
\`\`\`

## 三种模板

| 模板 | 说明 | 适用 |
|------|------|------|
| \`server-only\` | 纯后端（AI 工具 + 命令） | 数据处理 |
| \`full-stack\` | 后端 + React 前端 | 完整应用 |
| \`frontend-only\` | 纯 UI 扩展 | 白板工具 |

## 交互式创建

\`\`\`bash
npx @openlearn/plugin-sdk init
# CLI 逐步询问：名称 → 描述 → 作者 → 模板
\`\`\`

## 项目结构

\`\`\`
my-plugin/
├── src/index.ts      # 服务端入口（export default { manifest, activate }）
├── src/frontend.tsx   # 前端组件（可选）
└── package.json
\`\`\`
`;

  const pluginInteractiveCode = `# 完整插件示例（server-only 模板）

\`\`\`typescript
import type { PluginContext } from '@openlearn/plugin-sdk';
import {
  ICommandBusServiceToken,
  IActionRegistryServiceToken,
  IEventBusServiceToken,
  IDatabaseToken,
} from '@openlearn/plugin-sdk';

export default {
  manifest: {
    id: '@myorg/hello-plugin',
    name: '问候插件',
    version: '0.1.0',
    requires: [
      '@openlearn/core:ICommandBusService@^1.0.0',
      '@openlearn/core:IActionRegistryService@^1.0.0',
      '@openlearn/core:IEventBusService@^1.0.0',
      '@openlearn/core:IDatabase@^1.0.0',
    ],
    capabilitiesProposed: ['lesson:read'],
    engines: { openlearn: '^0.2.5' },
  },

  async activate(ctx: PluginContext) {
    const commandBus = ctx.services.commandBus;
    const actionRegistry = ctx.services.actionRegistry;
    const eventBus = ctx.services.eventBus;

    // 1. 注册 AI 工具
    await actionRegistry.register({
      id: 'hello-greet',
      commandType: 'hello.greet',
      description: '向指定的人打招呼，返回问候语',
      capabilityRequired: 'lesson:read',
      inputSchema: {
        type: 'OBJECT',
        properties: {
          name: { type: 'STRING', description: '姓名' },
        },
        required: ['name'],
      },
    });

    // 2. 注册命令处理器
    await commandBus.registerHandler('hello.greet', {
      async execute(command) {
        const payload = command.payload as any;
        const message = \`Hello, \${payload.name}!\`;

        // 3. 发布事件通知
        await eventBus.publish({
          id: crypto.randomUUID(),
          type: 'hello.greeted',
          source: 'plugin.hello',
          payload: { message },
          timestamp: Date.now(),
          correlationId: command.id,
        });

        return { message };
      },
    });

    ctx.log.info('问候插件已激活');
  },
};
\`\`\`

## 核心概念：Action → Command → Event

\`\`\`
AI Agent 调用 Action → CommandBus 执行 Handler → EventBus 广播事件
\`\`\`

1. **Action** — 用 \`actionRegistry.register()\` 注册 AI 工具，\`description\` 是 AI 理解的关键
2. **Command** — 用 \`commandBus.registerHandler()\` 执行业务逻辑
3. **Event** — 用 \`eventBus.publish()\` 通知其他系统
`;

  const pluginExamCode = `# 构建与发布

\`\`\`bash
# 开发模式（watch 自动重构建）
npx @openlearn/plugin-sdk build --watch

# 生产构建
npx @openlearn/plugin-sdk build

# 产物
dist/
├── index.js        # 服务端 bundle
├── frontend.js     # 前端 bundle（如有）
└── my-plugin.zip   # ★ 可上传到插件中心
\`\`\`

## 插件数据库

每个插件有独立的命名空间：

\`\`\`typescript
// 创建表
await ctx.db.ensureTable('polls', \`
  id TEXT PRIMARY KEY,
  question TEXT NOT NULL
\`);

// 获取带命名空间的表名
const tableName = ctx.db.table('polls');
// → plugin_@myorg_hello-plugin_polls

// 通过 DI 拿到 raw better-sqlite3
const db = await ctx.resolve(IDatabaseToken);
db.prepare(\`INSERT INTO \${tableName} ...\`).run(...);
\`\`\`

## 可用的 9 个 DI Token

通过 \`ctx.services\` 或 \`ctx.resolve(token)\` 访问：

| Token | 服务 |
|-------|------|
| ICommandBusServiceToken | 命令总线 |
| IEventBusServiceToken | 事件总线 |
| IActionRegistryServiceToken | AI 工具注册 |
| ICapabilityServiceToken | 权限守卫 |
| IProcessServiceToken | 后台进程 |
| IStorageServiceToken | K-V 存储 |
| IAIServiceToken | AI 文本生成 |
| IDatabaseToken | SQLite 数据库 |
| IPluginHostToken | 插件主机管理 |
`;

  return (
    <div className="flex-1 flex flex-col h-full bg-white text-gray-900 border border-gray-200 rounded-2xl shadow-sm overflow-hidden m-1">
      {/* 双通道渐变背景页头 */}
      <div className="px-6 py-5 bg-gradient-to-r from-indigo-50 via-purple-50 to-indigo-50/20 shrink-0 border-b border-gray-150 flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h2 className="text-xl font-bold text-gray-900 flex items-center gap-2">
            <HelpCircle className="text-indigo-600" size={24} />
            教育实验操作系统：内核帮助与开发中心 (Edu-OS Reference Hub)
          </h2>
          <p className="text-xs text-gray-500 mt-1">
            本页提供 OpenLearn 插件开发的快速入口：脚手架工具、交互式代码范例、完整的 API 参考文档。
          </p>
        </div>
        
        {/* 子标签页选项卡 */}
        <div className="flex bg-neutral-100 p-0.5 rounded-xl border border-neutral-200 self-start md:self-center shrink-0 shadow-inner">
          <button
            onClick={() => setActiveTab('commands')}
            className={`px-4 py-1.5 rounded-lg text-xs font-semibold tracking-wide transition-all flex items-center gap-1.5 ${
              activeTab === 'commands'
                ? 'bg-white text-indigo-700 shadow-sm font-bold border border-neutral-200/50'
                : 'text-gray-500 hover:text-gray-800'
            }`}
          >
            <Terminal size={14} />
            <span>指令调试 (Command Playground)</span>
          </button>

          <button
            onClick={() => setActiveTab('sdk_guide')}
            className={`px-4 py-1.5 rounded-lg text-xs font-semibold tracking-wide transition-all flex items-center gap-1.5 ${
              activeTab === 'sdk_guide'
                ? 'bg-white text-indigo-700 shadow-sm font-bold border border-neutral-200/50'
                : 'text-gray-500 hover:text-gray-800'
            }`}
          >
            <Puzzle size={14} />
            <span>插件开发指南 & API</span>
          </button>

          <button
            onClick={() => setActiveTab('user_guide')}
            className={`px-4 py-1.5 rounded-lg text-xs font-semibold tracking-wide transition-all flex items-center gap-1.5 ${
              activeTab === 'user_guide'
                ? 'bg-white text-indigo-700 shadow-sm font-bold border border-neutral-200/50'
                : 'text-gray-500 hover:text-gray-800'
            }`}
          >
            <BookOpen size={14} />
            <span>系统使用教程</span>
          </button>

          <button
            onClick={() => setActiveTab('plugin_docs')}
            className={`px-4 py-1.5 rounded-lg text-xs font-semibold tracking-wide transition-all flex items-center gap-1.5 ${
              activeTab === 'plugin_docs'
                ? 'bg-white text-indigo-700 shadow-sm font-bold border border-neutral-200/50'
                : 'text-gray-500 hover:text-gray-800'
            }`}
          >
            <FileText size={14} />
            <span>扩展文档</span>
          </button>
        </div>
      </div>

      {activeTab === 'commands' && (
        <CommandBusPlayground
          registeredCommands={registeredCommands}
          onRefresh={onRefresh}
        />
      )}

      {activeTab === 'sdk_guide' && (
        <SdkGuideViewer
          pluginGuideMd={pluginGuideMd}
          loadingMd={loadingMd}
          copiedId={copiedId}
          handleCopy={handleCopy}
          pluginBoilerplateCode={pluginBoilerplateCode}
          pluginInteractiveCode={pluginInteractiveCode}
          pluginExamCode={pluginExamCode}
        />
      )}

      {activeTab === 'user_guide' && (
        <UserGuideViewer
          copiedId={copiedId}
          handleCopy={handleCopy}
        />
      )}

      {activeTab === 'plugin_docs' && (
        <PluginDocsViewer />
      )}
    </div>
  );
}

export { generateTemplateContent } from './help/helpUtils2';
