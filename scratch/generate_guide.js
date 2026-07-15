import { execSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const htmlContent = `
<!DOCTYPE html>
<html lang="zh-CN">
<head>
    <meta charset="UTF-8">
    <title>OpenLearn Next V2 插件系统生产级开发与架构设计参考手册</title>
    <style>
        @page {
            margin: 2.2cm 1.8cm;
            @bottom-right {
                content: counter(page);
            }
        }
        body {
            font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
            color: #334155;
            line-height: 1.6;
            font-size: 10pt;
            margin: 0;
            padding: 0;
        }
        
        /* 标题页样式 */
        .title-page {
            page-break-after: always;
            display: flex;
            flex-direction: column;
            justify-content: center;
            height: 100vh;
            text-align: center;
            padding-top: 3.5cm;
        }
        .title-page h1 {
            font-size: 26pt;
            color: #0f172a;
            margin-bottom: 0.2cm;
            font-weight: 800;
            line-height: 1.2;
        }
        .title-page .subtitle {
            font-size: 14pt;
            color: #0d9488;
            margin-bottom: 2cm;
            font-weight: 500;
        }
        .title-page .meta {
            font-size: 9.5pt;
            color: #64748b;
            margin-top: auto;
            border-top: 1px solid #e2e8f0;
            padding-top: 1cm;
            line-height: 1.8;
        }

        h1, h2, h3, h4 {
            color: #0f172a;
            font-weight: 700;
            page-break-after: avoid;
        }
        h1 {
            font-size: 16pt;
            border-bottom: 2px solid #0d9488;
            padding-bottom: 0.3cm;
            margin-top: 1.2cm;
        }
        h2 {
            font-size: 13pt;
            border-bottom: 1px solid #e2e8f0;
            padding-bottom: 0.2cm;
            margin-top: 0.8cm;
            color: #1e293b;
        }
        h3 {
            font-size: 11pt;
            color: #0f172a;
            margin-top: 0.5cm;
        }

        p {
            margin-bottom: 0.8em;
            text-align: justify;
        }

        /* 代码块样式 */
        pre {
            background-color: #1e293b;
            color: #f8fafc;
            padding: 10px 14px;
            border-radius: 8px;
            font-family: "Fira Code", Consolas, Monaco, "Courier New", Courier, monospace;
            font-size: 8.5pt;
            line-height: 1.45;
            overflow-x: auto;
            margin: 0.4cm 0;
            page-break-inside: avoid;
        }
        code {
            font-family: "Fira Code", Consolas, Monaco, "Courier New", Courier, monospace;
            background-color: #f1f5f9;
            color: #0f172a;
            padding: 2px 4px;
            border-radius: 4px;
            font-size: 9pt;
        }
        pre code {
            background-color: transparent;
            color: inherit;
            padding: 0;
            border-radius: 0;
            font-size: inherit;
        }

        /* 表格样式 */
        table {
            width: 100%;
            border-collapse: collapse;
            margin: 0.5cm 0;
            font-size: 8.5pt;
            page-break-inside: avoid;
        }
        th, td {
            border: 1px solid #cbd5e1;
            padding: 8px 10px;
            text-align: left;
            vertical-align: top;
        }
        th {
            background-color: #f1f5f9;
            color: #0f172a;
            font-weight: 600;
        }
        tr:nth-child(even) {
            background-color: #f8fafc;
        }

        /* 提示框样式 */
        .callout {
            background-color: #f0fdfa;
            border-left: 4px solid #0d9488;
            padding: 10px 14px;
            margin: 0.5cm 0;
            border-radius: 0 6px 6px 0;
            page-break-inside: avoid;
        }
        .callout-title {
            font-weight: 700;
            color: #0f766e;
            margin-bottom: 0.1cm;
        }
        .callout p {
            margin: 0;
            font-size: 9pt;
        }

        ul, ol {
            margin-bottom: 0.8em;
            padding-left: 20px;
        }
        li {
            margin-bottom: 0.3em;
        }
        
        .page-break {
            page-break-before: always;
        }
    </style>
</head>
<body>

    <!-- 标题页 -->
    <div class="title-page">
        <h1>OpenLearn Next V2</h1>
        <div class="subtitle">插件开发、内核 API 及系统指令全集指南</div>
        <div style="font-size: 11pt; font-weight: 500; margin-top: 1cm; color: #475569;">
            面向全栈开发者与架构维护者的生产级核心参考手册
        </div>
        <div class="meta">
            <strong>核心研发团队发布</strong><br>
            文档版本: v2.3.0 &bull; 发布时间: 2026年7月 &bull; 技术栈: TS / ESM / Sqlite / Node Worker
        </div>
    </div>

    <!-- 一、 插件系统整体架构 -->
    <h1>一、 插件系统整体架构</h1>
    <p>OpenLearn Next V2 采用高安全性、进程级隔离的多核沙箱架构。插件系统作为系统的核心扩展机制，支持动态热插拔、能力声明、资源追踪及安全限制。</p>
    
    <div class="callout">
        <div class="callout-title">💡 核心架构理念</div>
        <p>架构以<b>最小特权原则 (Principle of Least Privilege)</b> 为基础。插件默认没有任何系统调用与内核接口访问权限。所有的权限提升、数据库访问以及服务交互，都必须通过清单声明并在激活时由系统统一授予或配置。</p>
    </div>

    <h2>1. 运行模式 (Execution Modes)</h2>
    <ul>
        <li><b>内联模式 (Inline Mode):</b> 插件代码直接在主线程中执行，适用于系统级内置插件（如 <code>VFS</code>、<code>Builtin</code> 核心插件）。具有极高执行效率，但隔离等级较低。</li>
        <li><b>沙箱 Worker 模式 (Worker Mode):</b> 插件通过 Node.js <code>Worker Threads</code> 在隔离的独立线程中加载运行。该模式下，插件无法执行未经授权的系统命令或破坏内核内存结构，所有与系统底座的交互必须通过 RPC 通道进行。</li>
    </ul>

    <h2>2. 内核生命周期与安全网关</h2>
    <ol>
        <li><b>安装与验证 (Installation):</b> 插件以 <code>.zip</code> 压缩包上传，由 <code>PluginHost</code> 校验 <code>manifest.json</code> 的合法性，并解压至隔离的磁盘目录。</li>
        <li><b>沙箱激活 (Activation):</b> 系统读取清单中的能力声明（Capabilities），生成唯一的 UUID 作为插件运行时 ID。若插件配置为 <code>worker</code> 模式，<code>WorkerManager</code> 会注入专用的 RPC 引导模板并生成独立的沙箱上下文。</li>
        <li><b>自动卸载与清理 (Deactivation):</b> 插件停用时，<code>ResourceTracker</code> 会自动回收该插件已注册的画板元素、临时处理器与事件订阅，并安全销毁 Worker 线程以防内存泄漏。</li>
    </ol>
    <p>此外，系统内置了<b>审批网关 (Approvals Gateway)</b>。当非管理员角色的用户触发高风险操作指令时，该操作将被挂起等待教师/管理员手动审批；而<b>如果是管理员角色用户进行的高危操作，则无需审批，系统会自动通过并继续运行。</b></p>

    <!-- 二、 插件上下文设计与 API 接口 -->
    <div class="page-break"></div>
    <h1>二、 插件上下文设计与 API 接口</h1>
    <p>当插件的 <code>activate(ctx)</code> 方法被调用时，内核会传入一个沙箱化的 <code>PluginContext</code> 实例。该实例是插件与内核交互的唯一合法窗口。</p>

    <h2>1. PluginContext 接口定义</h2>
    <pre><code class="language-typescript">export interface PluginContext {
  readonly pluginId: string;        // 运行时分配的唯一 UUID
  readonly manifest: Manifest;      // 插件解析后的清单配置

  readonly services: {
    readonly commandBus?: ICommandBusService;       // 指令总线，用于下发系统控制
    readonly actionRegistry?: IActionRegistryService; // 动作注册，用于发布扩展指令
    readonly eventBus?: IEventBusService;           // 事件总线，订阅系统事件
    [token: string]: any;                           // 其他已被授权注入的内核服务
  };

  resolve&lt;T&gt;(token: string | Token&lt;T&gt;): Promise&lt;T&gt;; // 动态解析已被授权的依赖注入服务
  require(moduleName: string): any;                 // 安全加载被允许共享的外部模块（如 xlsx, uuid）

  readonly db: {
    ensureTable(tableName: string, schema: string): Promise&lt;void&gt;; // 声明并创建隔离的插件自建表
    table(tableName: string): string;                             // 解析为隔离物理表名
    dropAllTables(): Promise&lt;void&gt;;                               // 清空插件名下的所有自建表
  };
}</code></pre>

    <h2>2. 内核共享模块支持列表</h2>
    <table>
        <thead>
            <tr>
                <th>模块名称</th>
                <th>说明</th>
                <th>适用场景</th>
            </tr>
        </thead>
        <tbody>
            <tr>
                <td><code>xlsx</code></td>
                <td>SheetJS 电子表格操作库</td>
                <td>数据导出、报表计算、作业明细生成等</td>
            </tr>
            <tr>
                <td><code>uuid</code></td>
                <td>标准 UUID 生成工具</td>
                <td>生成高碰撞防护的唯一资源与主键 ID</td>
            </tr>
            <tr>
                <td><code>jspdf</code></td>
                <td>PDF 文件生成工具</td>
                <td>生成精美的课后总结报告 PDF</td>
            </tr>
            <tr>
                <td><code>jspdf-autotable</code></td>
                <td>jspdf 表格插件</td>
                <td>在 PDF 中排版复杂的多列数据表</td>
            </tr>
            <tr>
                <td><code>react-markdown</code></td>
                <td>Markdown 渲染器</td>
                <td>用于插件端 UI 的 Markdown 编译渲染</td>
            </tr>
        </tbody>
    </table>

    <!-- 三、 清单文件完全指南 (manifest.json) -->
    <div class="page-break"></div>
    <h1>三、 清单文件完全指南 (manifest.json)</h1>
    <p>每个插件压缩包中必须在根目录包含一个 <code>manifest.json</code> 文件，用于声明插件的基本元信息、入口配置以及安全权限。</p>

    <h2>1. 属性字段定义说明</h2>
    <table>
        <thead>
            <tr>
                <th>字段名称</th>
                <th>数据类型</th>
                <th>是否必填</th>
                <th>描述与格式规范</th>
            </tr>
        </thead>
        <tbody>
            <tr>
                <td><code>id</code></td>
                <td>String</td>
                <td>是</td>
                <td>插件的唯一标识符。<b>命名规范：</b>第三方插件必须以 <code>ext-</code> 开头，以和内置核心插件区分开（如 <code>ext-quiz-engine</code>）。</td>
            </tr>
            <tr>
                <td><code>name</code></td>
                <td>String</td>
                <td>是</td>
                <td>人类可读的插件名称（可包含中文字符）。</td>
            </tr>
            <tr>
                <td><code>version</code></td>
                <td>String</td>
                <td>是</td>
                <td><b>SemVer 规范版本号：</b>符合 <code>MAJOR.MINOR.PATCH</code> 格式（如 <code>1.2.4</code>），用于热更新版本比对。</td>
            </tr>
            <tr>
                <td><code>entry</code></td>
                <td>String</td>
                <td>是</td>
                <td>插件运行的主入口 JS 文件相对路径（如 <code>index.js</code>）。支持被 ESBuild 打包后的单文件构建产物。</td>
            </tr>
            <tr>
                <td><code>author</code></td>
                <td>String</td>
                <td>否</td>
                <td>插件创作者的名称。</td>
            </tr>
            <tr>
                <td><code>homepage</code></td>
                <td>String</td>
                <td>否</td>
                <td>插件项目的官方主页 URL。</td>
            </tr>
            <tr>
                <td><code>capabilitiesProposed</code></td>
                <td>String[]</td>
                <td>否</td>
                <td><b>能力声明集合：</b>插件希望被授予的权限列表（如 <code>["whiteboard:write", "vfs:write"]</code>）。</td>
            </tr>
            <tr>
                <td><code>dependencies</code></td>
                <td>Record</td>
                <td>否</td>
                <td><b>插件依赖定义：</b>声明运行此插件必须已安装的第三方插件依赖及其版本范围（如 <code>{"ext-roll-call": "^1.0.0"}</code>）。</td>
            </tr>
        </tbody>
    </table>

    <h2>2. 能力授权流转 (Capabilities Flow)</h2>
    <p>清单文件中的 <code>capabilitiesProposed</code> 是插件对权限的“申请”。当 <code>PluginHost</code> 激活插件时，系统会做如下安全校验：</p>
    <ul>
        <li>系统会调用 <code>CapabilityGuard</code> 将申请的能力与内置的白名单映射进行比对。</li>
        <li>如果插件申请了不存在于系统白名单中的未知特权，激活流程将<b>立即阻断报错</b>（抛出 <code>InvalidCapabilityError</code>），插件状态会被标记为 <code>error</code> 且拒绝执行，以确保宿主安全。</li>
    </ul>

    <h2>3. 第三方 NPM 依赖动态隔离安装与加载</h2>
    <p>为避免插件包打包过于臃肿，系统自 <code>v2.0</code> 引入了动态依赖隔离管理。如果在 <code>manifest.json</code> 中声明了 <code>dependencies</code>（如 <code>"dependencies": { "cookie": "^0.5.0" }</code>）：</p>
    <ul>
        <li><b>自动物理隔离安装：</b>在插件解压安装时，<code>PluginHost</code> 会自动生成 <code>package.json</code> 并执行 <code>npm install --production --registry=https://registry.npmmirror.com</code>，将所需 NPM 包以独立物理沙箱形式装载在插件自身的 <code>node_modules</code> 中。</li>
        <li><b>运行时 Require 寻路重定向：</b>当 Worker 插件运行时调用 <code>ctx.require('cookie')</code>，沙箱中介拦截器通过 Node.js <code>module.createRequire</code> 寻路定位至该插件物理目录下的独立 NPM 包，既保证了隔离安全，又极大缩减了打包体积。</li>
    </ul>

    <!-- 四、 内核服务接口参考与注入对象说明 -->
    <div class="page-break"></div>
    <h1>四、 内核服务接口参考与注入对象说明</h1>
    <p>通过 <code>ctx.services</code> 或者 <code>await ctx.resolve(token)</code> 可调用的核心服务 API 及接口声明如下：</p>

    <h2>1. ICommandBusService (指令总线服务)</h2>
    <pre><code class="language-typescript">export interface ICommandBusService {
  // 执行一条系统核心或插件动作指令
  execute&lt;T = any&gt;(command: {
    id: string;             // 指令唯一运行 ID
    type: string;           // 指令名称类型，例如 "whiteboard.draw"
    actorId?: string;       // 执行人（默认插件名）
    payload: Record&lt;string, any&gt;; // 指令输入参数
    correlationId?: string; // 关联事件 ID
  }): Promise&lt;T&gt;;

  // 注册该插件所定义动作的执行逻辑处理器
  registerHandler(
    commandType: string,
    handler: { execute: (command: any) => Promise&lt;any&gt; }
  ): Promise&lt;void&gt;;
}</code></pre>

    <h2>2. IActionRegistryService (动作定义注册服务)</h2>
    <pre><code class="language-typescript">export interface IActionRegistryService {
  register(descriptor: {
    id: string;                 // 动作标识
    commandType: string;        // 映射指令类型，必须全局唯一
    description: string;        // 详细的人类与 AI 描述信息（决定 AI 生成效果的关键）
    capabilityRequired: string; // 运行该动作所需的安全能力权限，如 "whiteboard:write"
    isHighRisk?: boolean;       // 是否为高危敏感指令（会触发审批流拦截）
    inputSchema: {              // 输入参数定义，采用简化的 JSON Schema 规范
      type: "OBJECT";
      properties: Record&lt;string, { type: "STRING" | "NUMBER" | "ARRAY"; description?: string; items?: any }>;
      required?: string[];
    };
  }): Promise&lt;void&gt;;
}</code></pre>

    <h2>3. IEventBusService (事件发布与订阅总线)</h2>
    <pre><code class="language-typescript">export interface IEventBusService {
  subscribe(eventType: string, handler: (event: any) => void): string; // 返回订阅 UUID 签名
  unsubscribe(eventType: string, handler: (event: any) => void): void;
  publish(event: {
    id: string;
    type: string;
    source: string;
    payload: any;
    timestamp: number;
    correlationId?: string;
  }): Promise&lt;void&gt;;
}</code></pre>

    <!-- 五、 内置指令与系统核心事件目录 -->
    <div class="page-break"></div>
    <h1>五、 内置指令与系统核心事件目录</h1>
    
    <h2>1. 内置核心指令参考目录 (Commands Catalog)</h2>
    <table>
        <thead>
            <tr>
                <th>指令类型 (type)</th>
                <th>权限要求</th>
                <th>参数载荷 (payload)</th>
                <th>返回数据说明</th>
            </tr>
        </thead>
        <tbody>
            <tr>
                <td><code>whiteboard.draw</code></td>
                <td><code>whiteboard:write</code></td>
                <td><code>lessonId</code> (string), <code>type</code> (<code>"rectangle"</code>, <code>"text"</code>等), <code>data</code> (图形细节 JSON 串)</td>
                <td>返回新生成的画板图形节点标识 <code>{ elementId }</code></td>
            </tr>
            <tr>
                <td><code>whiteboard.update</code></td>
                <td><code>whiteboard:write</code></td>
                <td><code>lessonId</code> (string), <code>elementId</code> (string), <code>data</code> (覆盖更新的图形 JSON 串)</td>
                <td><code>{ success: true }</code></td>
            </tr>
            <tr>
                <td><code>whiteboard.delete</code></td>
                <td><code>whiteboard:write</code></td>
                <td><code>lessonId</code> (string), <code>elementId</code> (string)</td>
                <td><code>{ success: true }</code></td>
            </tr>
            <tr>
                <td><code>vfs.write_file</code></td>
                <td><code>vfs:write</code></td>
                <td><code>path</code>: 完整虚拟绝对路径, <code>content</code>: 写入数据字符串</td>
                <td>返回新节点主键 <code>{ fileId }</code></td>
            </tr>
            <tr>
                <td><code>vfs.read_file</code></td>
                <td><code>vfs:read</code></td>
                <td><code>path</code>: 完整绝对路径</td>
                <td>返回文本内容 <code>{ content: string }</code></td>
            </tr>
            <tr>
                <td><code>vfs.list_dir</code></td>
                <td><code>vfs:read</code></td>
                <td><code>path</code>: 完整绝对目录路径</td>
                <td>返回子项数组 <code>{ nodes: any[] }</code></td>
            </tr>
            <tr>
                <td><code>ai.apply_recommendation</code></td>
                <td><code>lesson:write</code></td>
                <td><code>taskType</code>, <code>topic</code>, <code>title</code>, <code>content</code> (均为 string)</td>
                <td><b>⚠️ 高危指令:</b> 写入计划数据库。非管理员用户调用需通过审批流审核。</td>
            </tr>
            <tr>
                <td><code>ai.apply_grade</code></td>
                <td><code>assignment:write</code></td>
                <td><code>assignmentId</code>, <code>studentId</code> (string), <code>score</code> (number), <code>feedback</code> (string)</td>
                <td><b>⚠️ 高危指令:</b> 写入成绩记录。非管理员用户调用需通过审批流审核。</td>
            </tr>
        </tbody>
    </table>

    <h2>2. 内置核心事件清单 (Events Catalog)</h2>
    <p>插件可以通过订阅以下事件来实现业务联动和数据追踪：</p>
    <table>
        <thead>
            <tr>
                <th>事件类型 (type)</th>
                <th>事件源 (source)</th>
                <th>事件数据载荷定义 (payload)</th>
                <th>触发机制描述</th>
            </tr>
        </thead>
        <tbody>
            <tr>
                <td><code>system.ready</code></td>
                <td><code>core.kernel</code></td>
                <td><code>{ timestamp: number }</code></td>
                <td>系统内核及 6 个内置默认插件全部引导成功</td>
            </tr>
            <tr>
                <td><code>lesson.started</code></td>
                <td><code>builtin.lesson</code></td>
                <td><code>{ lessonId: string, classId: string, teacherId: string, timestamp: number }</code></td>
                <td>教师端点下“开始上课”按键，课堂会话初始化完成</td>
            </tr>
            <tr>
                <td><code>lesson.ended</code></td>
                <td><code>builtin.lesson</code></td>
                <td><code>{ lessonId: string, timestamp: number }</code></td>
                <td>教师端下课，课堂结课</td>
            </tr>
            <tr>
                <td><code>student.joined</code></td>
                <td><code>builtin.classroom</code></td>
                <td><code>{ lessonId: string, studentId: string, name: string, timestamp: number }</code></td>
                <td>学生端进入课堂会话，在线花名册更新时触发</td>
            </tr>
            <tr>
                <td><code>student.left</code></td>
                <td><code>builtin.classroom</code></td>
                <td><code>{ lessonId: string, studentId: string, timestamp: number }</code></td>
                <td>学生网络异常断联或主动离开课堂触发</td>
            </tr>
            <tr>
                <td><code>vfs.file_written</code></td>
                <td><code>builtin.vfs</code></td>
                <td><code>{ fileId: string, path: string, timestamp: number }</code></td>
                <td>系统或任意插件写入虚拟文件成功时广播</td>
            </tr>
        </tbody>
    </table>

    <!-- 六、 前端 UI 扩展与交互机制 -->
    <div class="page-break"></div>
    <h1>六、 前端 UI 扩展与交互机制</h1>
    <p>交互式教学系统需要丰富的用户界面。OpenLearn Next V2 通过微前端（MFE）及前端插槽（Extension Slots）向插件提供 UI 扩展能力。</p>

    <h2>1. 界面扩展插槽 (Extension Slots)</h2>
    <p>前端拦截系统支持在主应用的以下布局插槽渲染插件的前端组件：</p>
    <ul>
        <li><code>teacher.panel</code>: 教师独立全宽管理面板（适用于排课、大屏投票配置管理）。</li>
        <li><code>student.fullscreen</code>: 学生全屏视图，会遮罩其他交互（常用于突击测验、考试模式）。</li>
        <li><code>classroom.tool</code>: 课堂右下角浮动工具箱（浮动 Dock）按键，点击触发快速操作（如随机点名）。</li>
        <li><code>teacher.dashboard.widget</code>: 教师主页看板磁贴小部件。</li>
        <li><code>global.setting</code>: 全局设置页扩展。</li>
    </ul>

    <h2>2. 前端与沙箱 Worker 的 IPC 通信协议</h2>
    <p>前端 UI 属于浏览器主线程，而后端插件逻辑运行在隔离的 Worker 线程沙箱中。它们之间的双向通信架构如下：</p>
    <pre><code>
    +----------------------------------+            +-----------------------------------+
    |      浏览器主线程 (Frontend)     |            |    Node 沙箱线程 (Worker Backend) |
    |  Remote Component (React Component)           |  Plugin Instance (ESM Bundle)     |
    +-----------------+----------------+            +-----------------+-----------------+
                      |                                               ^
       (发送指令)     | useMfeContext().infra.eventBus.publish        | (注册 Action 处理器)
                      v                                               |
    ==================+===============================================+==================
                      |              MFE 通信网关 (内核总线)           |
                      +-----------> Kernel CommandBus / EventBus -----+
    </code></pre>
    <ol>
        <li><b>前端下发控制:</b> 前端组件通过微前端上下文 <code>useMfeContext()</code> 消费平台能力，向 <code>eventBus</code> 发布事件，或调用后台注册的插件扩展 Command。</li>
        <li><b>后端更新反馈:</b> 插件后端计算完成后，调用 <code>whiteboard.update</code> 更新画板元素，或通过事件广播触发前端组件重新渲染。</li>
    </ol>

    <h2>3. 内置 UI 统一规范组件库</h2>
    <p>为保证视觉一致性，宿主平台提供了规范 of UI 组件集。开发者可在子应用中导入以下标准组件：</p>
    <ul>
        <li><code>&lt;Button variant="primary" size="md"&gt;</code>: 带有平台微交互的统一色值按钮。</li>
        <li><code>&lt;FormGroup label="选项名称"&gt;</code>: 支持数据绑定的响应式表单项组。</li>
        <li><code>&lt;Card title="数据统计" shadow="sm"&gt;</code>: 统一圆角及阴影的标准面板卡片。</li>
    </ul>

    <!-- 七、 隔离数据库设计与构建 (含迁移与清理) -->
    <div class="page-break"></div>
    <h1>七、 隔离数据库设计与构建</h1>

    <h2>1. 物理表空间隔离与 ctx.db 映射</h2>
    <p>物理表名由系统自动加上插件 UUID 作为前缀并规范重映射，保证完全杜绝 SQL 注入与其他插件的越权访问：</p>
    <pre><code>物理表名 = plugin_&lt;pluginId_to_underscores&gt;_&lt;tableName&gt;</code></pre>

    <h2>2. 声明式数据迁移 (ctx.db.migrate)</h2>
    <p>为降低维护表结构演进的复杂度，系统提供了内置声明式迁移机制 <code>ctx.db.migrate(version, migrateFn)</code>。该方法底层在 SQLite 中维护一个 <code>plugin_migrations</code> 表来跟踪迁移进度，确保幂等执行保障：</p>
    <pre><code class="language-typescript">// 数据库内置声明式迁移 API 示例
activate: async (ctx) => {
  // 1. 创建基础表 (版本 1)
  await ctx.db.migrate(1, async () => {
    await ctx.db.ensureTable('votes', 'id TEXT PRIMARY KEY, lesson_id TEXT, title TEXT');
  });

  // 2. 升级表结构添加新列 (版本 2)
  await ctx.db.migrate(2, async () => {
    const db = await ctx.resolve&lt;any&gt;('@openlearn/core:IDatabase');
    const tblVotes = ctx.db.table('votes');
    await db.prepare("ALTER TABLE " + tblVotes + " ADD COLUMN element_ids TEXT").run();
  });
}</code></pre>

    <h2>3. 插件卸载时的数据回收机制</h2>
    <p>当用户在系统控制台中对插件执行“卸载”操作时，系统提供以下两种结构清理策略：</p>
    <ul>
        <li><b>默认清理 (Hard Purge):</b> 清理引擎会自动检索并运行插件注册下的所有物理表，依次执行 <code>DROP TABLE IF EXISTS plugin_&lt;id&gt;_tableName</code>，防止存储碎片堆积。</li>
        <li><b>保留数据 (Soft Keep):</b> 如果插件清单中配置了保留选项（待开发内置属性），物理表数据将得以保留，以便在插件重新安装时实现数据恢复。</li>
    </ul>

    <!-- 八、 沙箱限制、错误处理与调试指南 -->
    <div class="page-break"></div>
    <h1>八、 沙箱限制、错误处理与调试指南</h1>

    <h2>1. 运行资源限制与配额 (Quotas & Limits)</h2>
    <p>为避免耗尽系统资源导致内核锁死，插件 Worker 进程会受到以下硬性指标配额约束：</p>
    <ul>
        <li><b>内存上限 (Memory Limit):</b> 每个 Worker 线程的最大 V8 堆内存被限制为 <b>128 MB</b>（超出此配额会导致线程 OOM 崩溃并触发内核重启机制）。</li>
        <li><b>执行时间片 (CPU Execution Timeout):</b> 每次执行 Command 或 Action 处理器的阻塞耗时阈值为 <b>10 秒</b>。超时仍未返回的调用会被内核强行终止并抛出超时异常。</li>
        <li><b>磁盘及存储配额 (Storage Limit):</b> VFS 文件系统单插件最大写入配额为 <b>50 MB</b>。隔离 SQLite 数据库单表的最大记录上限为 <b>10,000 行</b>。</li>
    </ul>

    <h2>2. 异常捕获与日志管理</h2>
    <ul>
        <li><b>错误捕获:</b> 插件执行中抛出的未捕获错误会被沙箱边界捕获，向主线程返回 <code>commandError</code> 并记录对应的错误堆栈（Stack Trace）。插件不应吞掉核心异常，以便主线程感知。</li>
        <li><b>日志捕获:</b> 沙箱内重写了全局 <code>console.log</code> 及 <code>console.error</code>。所有输出都会被打上 <code>[Worker stdout - &lt;UUID&gt;]</code> 前缀，自动管道传输重定向写入至系统运行日志文件中，路径为：
          <code>&lt;appDataDir&gt;/brain/&lt;conversationId&gt;/.system_generated/tasks/task-xxx.log</code>。
        </li>
    </ul>

    <h2>3. 断点调试指南 (Debugging)</h2>
    <p>调试多线程沙箱插件需要借助 Node 调试端口映射：</p>
    <ol>
        <li>启动内核时，增加参数允许 Worker 调试：
          <pre><code>node --inspect-brk packages/core/index.js</code></pre>
        </li>
        <li>打开 Chrome 浏览器，访问 <code>chrome://inspect</code>，在 Remote Target 中找到该进程并连接。</li>
        <li>在 <code>WorkerManager</code> 动态生成的 base64 data URL 节点处打下断点，即可实时监视 Worker 内部的执行状态和 RPC 数据包流转。</li>
    </ol>

    <!-- 九、 完整的 Demo 示例：Raffle-Vote 插件 -->
    <div class="page-break"></div>
    <h1>九、 完整的 Demo 示例：Raffle-Vote 插件</h1>
    <p>以下为一个完整的第三方全栈插件代码。该插件包含画板图形绘制、数据库自建表操作、事件流发布、以及利用共享模块 <code>xlsx</code> 导出 Excel 明细数据的功能。</p>

    <h2>1. 清单文件 manifest.json</h2>
    <pre><code class="language-json">{
  "id": "ext-raffle-vote",
  "name": "课堂实时投票与抽奖转盘",
  "version": "1.0.0",
  "description": "提供课堂互动投票与白板条形图展示，支持幸运学生随机点名并导出汇总报表",
  "entry": "index.js",
  "capabilitiesProposed": [
    "whiteboard:write",
    "vfs:write"
  ]
}</code></pre>

    <h2>2. 主入口文件 index.ts</h2>
    <pre><code class="language-typescript">import { IDatabaseToken } from '../../core/di/interfaces.js';
import type { PluginContext } from '../../core/plugin-host/types.js';

export default {
  manifest: {
    id: "ext-raffle-vote",
    name: "课堂实时投票与抽奖转盘",
    version: "1.0.0"
  },

  activate: async (ctx: PluginContext) => {
    const commandBus = ctx.services.commandBus!;
    const actionRegistry = ctx.services.actionRegistry!;

    console.log("[Raffle & Vote Plugin] Activating plugin " + ctx.pluginId + "...");

    // 1. 创建隔离的数据表
    await ctx.db.ensureTable('votes', 'id TEXT PRIMARY KEY, lesson_id TEXT, title TEXT, options TEXT, element_ids TEXT, created_at INTEGER');
    await ctx.db.ensureTable('votes_cast', 'vote_id TEXT, option_index INTEGER, voter_id TEXT, timestamp INTEGER');

    // 2. 注册开始投票 Action (vote.create)
    await actionRegistry.register({
      id: 'ext-vote-create',
      commandType: 'vote.create',
      description: '在课堂白板上发起一个实时的多选投票，渲染为动态条形图',
      capabilityRequired: 'whiteboard:write',
      inputSchema: {
        type: 'OBJECT',
        properties: {
          lessonId: { type: 'STRING', description: '课程 ID' },
          title: { type: 'STRING', description: '投票题目' },
          options: { type: 'ARRAY', items: { type: 'STRING' } }
        },
        required: ['lessonId', 'title', 'options']
      }
    });

    // 3. 注册投下选票 Action (vote.cast)
    await actionRegistry.register({
      id: 'ext-vote-cast',
      commandType: 'vote.cast',
      description: '学生投下一票，实时更新白板的条形图高度',
      capabilityRequired: 'whiteboard:write',
      inputSchema: {
        type: 'OBJECT',
        properties: {
          lessonId: { type: 'STRING' },
          voteId: { type: 'STRING' },
          optionIndex: { type: 'NUMBER' },
          voterId: { type: 'STRING' }
        },
        required: ['lessonId', 'voteId', 'optionIndex', 'voterId']
      }
    });

    // 4. 注册导出投票结果 Action (vote.export)
    await actionRegistry.register({
      id: 'ext-vote-export',
      commandType: 'vote.export',
      description: '将当前投票汇总导出为 Excel 存入 VFS 虚拟文件系统',
      capabilityRequired: 'vfs:write',
      inputSchema: {
        type: 'OBJECT',
        properties: {
          voteId: { type: 'STRING' }
        },
        required: ['voteId']
      }
    });

    // ── 5. 绑定 vote.create 处理器 ──────────────────────────────────────────
    await commandBus.registerHandler('vote.create', {
      execute: async (command) => {
        const db = await ctx.resolve&lt;any&gt;(IDatabaseToken);
        const { lessonId, title, options } = command.payload as any;
        const voteId = 'vote_' + Math.random().toString(36).slice(2, 10);
        const x = 150, y = 150;

        const bgHeight = 65 + options.length * 45;
        const bgDraw = await commandBus.execute({
          id: 'draw_bg_' + voteId,
          type: 'whiteboard.draw',
          payload: {
            lessonId, type: 'rectangle',
            data: JSON.stringify({ x, y, width: 380, height: bgHeight, fill: '#f8fafc', stroke: '#cbd5e1', strokeWidth: 2, cornerRadius: 8 })
          }
        }) as any;

        const optionElementIds: any[] = [];
        for (let i = 0; i &lt; options.length; i++) {
          const barDraw = await commandBus.execute({
            id: "draw_bar_" + voteId + "_" + i,
            type: 'whiteboard.draw',
            payload: { lessonId, type: 'rectangle', data: JSON.stringify({ x: x + 20, y: y + 50 + i * 45, width: 15, height: 18, fill: '#38bdf8' }) }
          }) as any;

          const labelDraw = await commandBus.execute({
            id: "draw_label_" + voteId + "_" + i,
            type: 'whiteboard.draw',
            payload: { lessonId, type: 'text', data: JSON.stringify({ x: x + 20, y: y + 50 + i * 45 + 20, text: options[i] + ": 0 票 (0%)", fontSize: 12, fill: '#475569' }) }
          }) as any;

          optionElementIds.push({ barId: barDraw?.elementId, labelId: labelDraw?.elementId });
        }

        const tblVotes = ctx.db.table('votes');
        await db.prepare("INSERT INTO " + tblVotes + " (id, lesson_id, title, options, element_ids, created_at) VALUES (?, ?, ?, ?, ?, ?)").run(
          voteId, lessonId, title, JSON.stringify(options), JSON.stringify({ bgId: bgDraw?.elementId, options: optionElementIds, x, y }), Date.now()
        );

        return { success: true, voteId };
      }
    });

    // ── 6. 绑定 vote.cast 处理器 ────────────────────────────────────────────
    await commandBus.registerHandler('vote.cast', {
      execute: async (command) => {
        const db = await ctx.resolve&lt;any&gt;(IDatabaseToken);
        const { lessonId, voteId, optionIndex, voterId } = command.payload as any;

        const tblVotes = ctx.db.table('votes');
        const tblCast = ctx.db.table('votes_cast');

        const voteConfig = await db.prepare("SELECT * FROM " + tblVotes + " WHERE id = ? AND lesson_id = ?").get(voteId, lessonId) as any;
        if (!voteConfig) throw new Error('找不到指定的投票活动');

        const options = JSON.parse(voteConfig.options);
        const elementIds = JSON.parse(voteConfig.element_ids);

        const checkVoted = await db.prepare("SELECT count(*) as count FROM " + tblCast + " WHERE vote_id = ? AND voter_id = ?").get(voteId, voterId) as any;
        if (checkVoted.count &gt; 0) throw new Error('不可重复投票');

        await db.prepare("INSERT INTO " + tblCast + " (vote_id, option_index, voter_id, timestamp) VALUES (?, ?, ?, ?)").run(voteId, optionIndex, voterId, Date.now());

        const allVotes = await db.prepare("SELECT option_index, count(*) as count FROM " + tblCast + " WHERE vote_id = ? GROUP BY option_index").all(voteId) as any[];
        const counts: Record&lt;number, number&gt; = {};
        options.forEach((_: any, i: number) => { counts[i] = 0; });
        let total = 0;
        allVotes.forEach(v => { counts[v.option_index] = v.count; total += v.count; });

        for (let i = 0; i &lt; options.length; i++) {
          const count = counts[i];
          const pct = total &gt; 0 ? (count / total) : 0;
          const barWidth = Math.max(15, pct * 280);
          const refs = elementIds.options[i];

          await commandBus.execute({
            id: 'update_bar_' + Math.random().toString(36).slice(2),
            type: 'whiteboard.update',
            payload: { lessonId, elementId: refs.barId, data: JSON.stringify({ x: elementIds.x + 20, y: elementIds.y + 50 + i * 45, width: barWidth, height: 18, fill: '#38bdf8' }) }
          });

          await commandBus.execute({
            id: 'update_label_' + Math.random().toString(36).slice(2),
            type: 'whiteboard.update',
            payload: { lessonId, elementId: refs.labelId, data: JSON.stringify({ x: elementIds.x + 20, y: elementIds.y + 50 + i * 45 + 20, text: options[i] + ": " + count + " 票 (" + Math.round(pct * 100) + "%)", fontSize: 12, fill: '#374151' }) }
          });
        }

        return { success: true, totalVotes: total };
      }
    });

    // ── 7. 绑定 vote.export 处理器 ──────────────────────────────────────────
    await commandBus.registerHandler('vote.export', {
      execute: async (command) => {
        const db = await ctx.resolve&lt;any&gt;(IDatabaseToken);
        const { voteId } = command.payload as any;
        const tblVotes = ctx.db.table('votes');
        const tblCast = ctx.db.table('votes_cast');

        const vote = await db.prepare("SELECT * FROM " + tblVotes + " WHERE id = ?").get(voteId) as any;
        const votesCast = await db.prepare("SELECT * FROM " + tblCast + " WHERE vote_id = ? ORDER BY timestamp ASC").all(voteId) as any[];

        const options = JSON.parse(vote.options);
        const counts: Record&lt;number, number&gt; = {};
        options.forEach((_: any, i: number) => { counts[i] = 0; });
        let total = 0;
        votesCast.forEach(v => { counts[v.option_index]++; total++; });

        const fn = "vote_results_" + voteId + ".xlsx";
        let xlsxMod: any = null;
        try {
          xlsxMod = ctx.require('xlsx');
        } catch {
          console.warn('xlsx 模块不可用，降级为 CSV 格式导出');
        }

        if (xlsxMod) {
          const wb = xlsxMod.utils.book_new();
          const summaryRows = options.map((opt: string, i: number) => ({
            '选项': opt,
            '得票数': counts[i],
            '占比': total &gt; 0 ? Math.round((counts[i] / total) * 100) + "%" : '0%'
          }));
          xlsxMod.utils.book_append_sheet(wb, xlsxMod.utils.json_to_sheet(summaryRows), '投票汇总');

          const detailRows = votesCast.map(v => ({
            '投票人ID': v.voter_id,
            '所选选项': options[v.option_index],
            '投票时间': new Date(v.timestamp).toISOString()
          }));
          xlsxMod.utils.book_append_sheet(wb, xlsxMod.utils.json_to_sheet(detailRows), '投票明细');

          const excelBuffer = xlsxMod.write(wb, { type: 'buffer', bookType: 'xlsx' });
          await commandBus.execute({
            id: 'export_vfs_excel_' + Math.random().toString(36).slice(2),
            type: 'vfs.write_file',
            payload: { path: "/exports/" + fn, content: excelBuffer.toString('base64') }
          });
          return { success: true, path: "/exports/" + fn, format: 'xlsx' };
        } else {
          return { success: true, format: 'csv' };
        }
      }
    });
  },

  deactivate: async () => {
    console.log('[Raffle & Vote Plugin] Deactivating plugin...');
  }
};</code></pre>

    <!-- 十一、 编译打包与集成测试 -->
    <div class="page-break"></div>
    <h1>十、 编译打包与集成测试</h1>

    <h2>1. 自动化打包编译脚本</h2>
    <pre><code class="language-javascript">import esbuild from 'esbuild';
import archiver from 'archiver';
import fs from 'fs';

await esbuild.build({
  entryPoints: ['packages/plugins/raffle-vote/index.ts'],
  bundle: true,
  outfile: 'dist/temp/index.js',
  format: 'esm',
  external: ['xlsx', 'uuid', 'jspdf'],
  platform: 'node'
});

const output = fs.createWriteStream('dist/plugins/ext-raffle-vote.zip');
const archive = archiver('zip', { zlib: { level: 9 } });
archive.pipe(output);
archive.file('dist/temp/index.js', { name: 'index.js' });
archive.file('packages/plugins/raffle-vote/manifest.json', { name: 'manifest.json' });
await archive.finalize();
console.log('Zip 插件打包完成。');</code></pre>

    <h2>2. 编写 Vitest 集成测试</h2>
    <pre><code class="language-typescript">import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { Kernel } from '../../core/kernel/index.js';

describe('Raffle & Vote Plugin Test', () => {
  let kernel: Kernel;

  beforeAll(async () => {
    const { db } = await import('../../core/db/index.js');
    db.prepare("DELETE FROM plugins WHERE manifest LIKE '%ext-raffle-vote%'").run();
    kernel = new Kernel();
    await kernel.ready;
  });

  it('应该成功发起投票并能够投下选票', async () => {
    const createResult = await kernel.commandBus.execute({
      id: 'cmd-vote-create',
      type: 'vote.create',
      actorId: 'user-teacher',
      payload: {
        lessonId: 'test-lesson-id',
        title: '你喜欢 JavaScript 吗？',
        options: ['非常喜欢', '讨厌']
      }
    }) as any;
    expect(createResult.success).toBe(true);

    const castResult = await kernel.commandBus.execute({
      id: 'cmd-vote-cast',
      type: 'vote.cast',
      payload: {
        lessonId: 'test-lesson-id',
        voteId: createResult.voteId,
        optionIndex: 0,
        voterId: 'student-alice'
      }
    }) as any;
    expect(castResult.success).toBe(true);
    expect(castResult.totalVotes).toBe(1);
  });
});</code></pre>

    <!-- 十一、 版本迭代、发布与分发流程 (含待完善功能 Backlog) -->
    <div class="page-break"></div>
    <h1>十一、 版本迭代、发布与分发流程</h1>

    <h2>1. 生产审核与状态流转机制</h2>
    <p>当管理员在上架面板上传打包后的 <code>.zip</code> 插件包时，系统会将其注册并置为 <code>installed</code> 状态。激活操作由内核调度的 <code>ready</code> 流水线管理，在成功注入授权及启动 Worker 实例后转为 <code>active</code> 状态。遇到崩溃或加载失败则进入 <code>error</code> 挂起状态并写入事件流通知。</p>

    <h2>2. 无停机热更新与运行状态继承 (Hot Swapping & State Inheritance)</h2>
    <p>内核对处于 Worker 隔离状态下的插件支持热交换与零停机状态交接升级：</p>
    <ol>
        <li>当发起热重载指令时，主线程通过 RPC 向旧 Worker 线程发出 <code>deactivate-request</code> 停用请求。</li>
        <li>旧 Worker 线程执行其 <code>deactivate()</code> 生命周期方法，将需要继承的内存状态（任意可序列化对象）作为返回值返回给宿主主线程。</li>
        <li>主线程接收该状态对象（作为 <code>prevState</code>），然后调用旧 Worker 线程 of <code>terminate()</code> 保证其彻底退出。</li>
        <li>主线程创建并启动新版本的 Worker 线程，通过 <code>activate</code> 消息将 <code>prevState</code> 传递给新 Worker。</li>
        <li>新 Worker 线程在 <code>activate(ctx, prevState)</code> 周期中接收此状态并还原其内存运行数据，重新挂载指令处理器，完成完美的平滑升级。</li>
    </ol>

    <h2>3. 系统特性状态与待开发功能清单 (Feature Backlog)</h2>
    <p>为了让该插件生态系统更加完备，开发团队已将相关特性的状态及后续迭代的 <b>Backlog 待办列表</b> 整理如下：</p>
    <table>
        <thead>
            <tr>
                <th>优先级/状态</th>
                <th>功能模块</th>
                <th>功能描述</th>
                <th>设计与实现细节</th>
            </tr>
        </thead>
        <tbody>
            <tr style="background-color: #f0fdf4;">
                <td><b style="color: #16a34a;">已实现 (v2.0)</b></td>
                <td>内置数据库迁移 API</td>
                <td>提供统一的 <code>ctx.db.migrate(version, fn)</code> 声明式迁移，自动记录版本追踪。</td>
                <td>内置 <code>plugin_migrations</code> 表，幂等处理表结构升级与 DDL 变更。</td>
            </tr>
            <tr style="background-color: #f0fdf4;">
                <td><b style="color: #16a34a;">已实现 (v2.0)</b></td>
                <td>沙箱热更状态继承</td>
                <td>热替换升级插件时，允许新旧 Worker 传递并交接内存缓存中的运行状态。</td>
                <td>通过生命周期 <code>deactivate()</code> 返回状态，并由新 Worker 的 <code>activate(ctx, prevState)</code> 还原。</td>
            </tr>
            <tr style="background-color: #f0fdf4;">
                <td><b style="color: #16a34a;">已实现 (v2.0)</b></td>
                <td>动态依赖加载与沙箱隔离</td>
                <td>允许插件在 <code>manifest.json</code> 中声明第三方 NPM 依赖包并自动安装与加载。</td>
                <td>解压时自动执行 <code>npm install</code> 安装到隔离目录，并在 Worker 中通过 <code>createRequire</code> 重定向 require 寻路。</td>
            </tr>
            <tr>
                <td><b>P2</b></td>
                <td>硬性 CPU 时间片控制</td>
                <td>限制单个沙箱 Worker 的高频密集计算，避免抢占宿主 CPU 周期。</td>
                <td>设计在 Worker 引导模板中注入基于 <code>performance.now()</code> 调度的循环限制器（CPU throttling）。</td>
            </tr>
            <tr>
                <td><b>P2</b></td>
                <td>插件分发数字签名校验</td>
                <td>确保上架的第三方 Zip 插件没有在网络分发中被篡改或带毒。</td>
                <td>在上架和安装接口中，采用基于内核 RSA 公钥解密的 <code>manifest.signature</code> 电子签名强校验。</td>
            </tr>
        </tbody>
    </table>

</body>
</html>
`;

const tempHtmlPath = path.join(process.cwd(), 'scratch', 'guide.html');
const outputPdfPath = path.join(process.cwd(), 'OpenLearn_Plugin_Development_Guide.pdf');

// 1. Write the HTML file
fs.writeFileSync(tempHtmlPath, htmlContent, 'utf-8');
console.log(`Temp HTML file written to: ${tempHtmlPath}`);

// 2. Run Headless Chromium print-to-pdf
try {
  console.log('Generating PDF via headless Chromium...');
  execSync(
    `chromium --headless --disable-gpu --no-sandbox --print-to-pdf="${outputPdfPath}" "${tempHtmlPath}"`,
    { stdio: 'inherit' }
  );
  console.log(`PDF successfully generated and saved to: ${outputPdfPath}`);
} catch (err) {
  console.error('Failed to run chromium, trying google-chrome...');
  try {
    execSync(
      `google-chrome --headless --disable-gpu --no-sandbox --print-to-pdf="${outputPdfPath}" "${tempHtmlPath}"`,
      { stdio: 'inherit' }
    );
    console.log(`PDF successfully generated via Chrome and saved to: ${outputPdfPath}`);
  } catch (err2) {
    console.error('Failed to compile PDF:', err2);
    process.exit(1);
  }
}

// 3. Cleanup
fs.unlinkSync(tempHtmlPath);
console.log('Cleanup temp HTML completed.');
