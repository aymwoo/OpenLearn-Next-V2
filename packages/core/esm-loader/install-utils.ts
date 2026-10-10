/**
 * install-utils.ts — esbuild 打包 + jszip 解压 + manifest 校验 + ZIP bomb 防护。
 *
 * ## 职责
 *
 * - bundlePlugin() — 将多文件插件（含相对导入）通过 esbuild 打包为单 ESM bundle
 * - validateAndBundleZip() — 从 ZIP Buffer 中解压、校验 manifest、esbuild 打包
 * - extractManifestFromBundle() — 从已打包的 bundle 中重新提取 manifest（备用）
 *
 * ## 设计决策
 *
 * - **纯函数**: 所有函数不依赖 Kernel 实例，便于单独导入和单元测试
 * - **D-07**: 使用 esbuild.build({ stdin, bundle, write:false }) 在内存中完成打包
 * - **D-08**: external: ['@openlearn/*'] 保留 Token 服务导入，平台无关导入被拒绝
 * - **D-10**: manifestSchema.parse() 运行时校验 manifest.json
 * - **D-12**: ZIP 原始字节 → 解压 → 校验 → 打包 → 返回 { manifest, bundledCode }
 * - **ZIP bomb 防护**: 解压前检查未压缩大小总和 ≤ 10MB
 * - **路径穿越防护**: 拒绝包含 ".." 或以 "/" 开头的 ZIP 条目名
 * - **临时目录清理**: try/finally 确保临时文件被删除
 */

import JSZip from 'jszip';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { v7 as uuidv7 } from 'uuid';
import { manifestSchema, type Manifest } from './manifest-schema.js';

/** ZIP 包中所有文件的未压缩大小上限（默认 300MB），用于 ZIP bomb 防护，支持环境变量 OPENLEARN_MAX_ZIP_SIZE 覆盖 */
export function getMaxUncompressedSize(): number {
  return Number(process.env.OPENLEARN_MAX_ZIP_SIZE) || 300 * 1024 * 1024;
}

/**
 * 插件 ZIP 上传的 HTTP body 上限（审计 R-4）。
 *
 * 此前路由层硬编码 `'400mb'`，与上面的解压上限（默认 300MB）是**两个各写各的
 * 口径**：400MB 的 body 若解压出 >300MB 仍会在后面被拒，上限形同虚设；
 * 反过来调小 OPENLEARN_MAX_ZIP_SIZE 也不会影响 body 接收。
 *
 * 压缩态大小 ≤ 未压缩总量是 ZIP 的物理性质，故 body 上限取解压上限同值即为
 * 单一口径：一个 env 同时管住「收多少」与「放多少」。
 */
export function getMaxUploadBodyBytes(): number {
  return getMaxUncompressedSize();
}

/**
 * 从磁盘读入 ZIP（R-4 路径化契约的单一读入口）。
 *
 * 安装链路全程只保留**一份** ZIP Buffer：路由层已把 body 流式落盘（原始字节
 * 不进内存），此处读盘后交给 JSZip。读盘是外部内存（Buffer 不在 V8 heap），
 * 且 `validateAndBundleZip` 返回后调用方不再持有它，可被 GC。
 *
 * JSZip 的 `loadAsync` **不接受 Node 流**（实测 "can't accept a stream"），
 * 所以「流式解压」在该库上不可达 —— 真正的杠杆是消除多余的副本（body Buffer
 * 与第二次 loadAsync），见 `validateAndBundleZip` 的 `package` 复用凭据。
 */
export function readZipBufferFromPath(zipPath: string): Buffer {
  if (!fs.existsSync(zipPath)) {
    throw new Error(`[install-utils] ZIP 文件不存在: ${zipPath}`);
  }
  return fs.readFileSync(zipPath);
}

/**
 * 把内存中的 ZIP Buffer 落成临时文件，返回路径（R-4）。
 *
 * 用于**天生就持有 Buffer** 的调用方：base64 上传（HTTP 已解析）、命令
 * handler（base64Data）、市场下载（改为流式落盘，见 community-registry）。
 * 落盘后调用方应立即丢弃 Buffer 引用，让安装链路只剩路径一份事实。
 */
export function writeBufferToTempZip(buffer: Buffer, prefix = 'plugin-upload-'): string {
  if (!Buffer.isBuffer(buffer) || buffer.length === 0) {
    throw new Error('[install-utils] 空的 ZIP Buffer');
  }
  const zipPath = path.join(os.tmpdir(), `${prefix}${uuidv7()}.zip`);
  fs.writeFileSync(zipPath, buffer);
  return zipPath;
}

/** 清理临时 ZIP 文件（幂等；不存在视为已清理） */
export function removeTempZip(zipPath: string | undefined): void {
  if (!zipPath) return;
  try {
    fs.rmSync(zipPath, { force: true });
  } catch {
    /* 清理失败不阻断主流程 */
  }
}

/**
 * 清理临时文件（bundle 产物等，语义同 removeTempZip；分开命名让调用点自描述） */
export function removeTempFile(filePath: string | undefined): void {
  if (!filePath) return;
  try {
    fs.rmSync(filePath, { force: true });
  } catch {
    /* best effort */
  }
}

/**
 * 静态门拒绝的原因码。用于让调用方与测试能区分「哪种违规」，
 * 避免所有失败都退化成一句无法定位的 "plugin code rejected"。
 */
export type PluginCodeViolation =
  | 'computed-import' // 计算式动态 import()：可绕过 esbuild onResolve
  | 'dynamic-require' // 运行时拼接的 require()
  | 'eval' // eval / new Function
  | 'absolute-path-import' // 绝对路径 import：可把宿主任意文件内联进产物
  | 'bare-specifier'; // 裸包名（第三方 npm 包）

export class PluginCodeSecurityError extends Error {
  public readonly violation: PluginCodeViolation;
  public readonly detail: string;

  constructor(violation: PluginCodeViolation, detail: string) {
    super(`[PluginSecurity] Plugin code rejected (${violation}): ${detail}`);
    this.name = 'PluginCodeSecurityError';
    this.violation = violation;
    this.detail = detail;
  }
}

/**
 * 计算式 import / 动态 require 的匹配规则。
 *
 * 为什么必须做这一步：`bundlePlugin()` 里的 `openlearn-token-enforcer` 插件通过
 * 一个「匹配全部路径」的 `build.onResolve` 过滤器拦截导入，而 **onResolve 只对 esbuild 能静态
 * 解析的字面量 specifier 触发**。`await import('node:' + 'child_process')` 这类计算式导入
 * esbuild 无法解析，只产生 warning 并**原样保留为运行时 `import()`**，
 * 因此完全绕过该插件 —— 而 Worker 与主进程共享地址空间，拿到它即等价于宿主 RCE。
 *
 * 同时覆盖：
 * - `new Function(...)` / `eval(...)`：动态代码执行；
 * - 绝对路径 import（`/etc/passwd`）：可把宿主文件内容内联进插件产物后回传。
 *
 * 这是**词法级**检查（正则），不是完整 AST 分析。词法级已能覆盖上述主要绕过手法，
 * 且无额外依赖；它的局限（注释内字符串、极端混淆）由「inline/worker 均非安全沙箱」
 * 这一前提兜底 —— 见 docs/plugin/plugin-lifecycle.md。
 */
/**
 * 词法扫描：产出「每个 import / export / require / eval 调用的参数起始片段」。
 *
 * 实现要点：必须**逐字符状态机**推进，不能简单地先剥字符串 —— 因为
 * `import('node:' + 'child_process')` 里紧跟 `(` 的是字符串字面量，而
 * `import('node:' + x)` 里是标识符，两者的区分依赖括号内的真实内容。
 *
 * 返回每处的 `{ kind, argStart, text }`：
 * - `kind` ∈ import | export-from | require | eval | new-function
 * - `argStart` 是 `(` 之后的偏移，供调用方自行判定字面量 / 计算式
 * - `text` 是从 `(` 起截取的原始片段（未剥离字符串），用于提取绝对路径
 */
interface LexicalHit {
  kind: 'import' | 'export-from' | 'require' | 'eval' | 'new-function';
  argStart: number;
  text: string;
  /** 是否为 `obj.require(...)` 形态（成员调用），用于放行 SDK 的 ctx.require */
  isMemberCall?: boolean;
}

const LEX_SCAN_LIMIT = 2_000_000; // 防御性上限，超长源码直接交给 esbuild 报错

/**
 * 从 `export`/`import` 关键字之后开始，解析本条声明的模块 specifier。
 *
 * `import x from 'p'`、`import 'p'`、`export { a } from 'p'`、`export * from 'p'`
 * 四种形态都要覆盖。命中则产出 `export-from`（该 kind 的语义就是「静态模块路径」）。
 */
function scanImportSpecifier(src: string, from: number): LexicalHit[] {
  // 跳过本条 import 语句（遇语句结束或 import(...) 形态即停）
  let j = from;
  let depth = 0;
  while (j < src.length && j < from + 4000) {
    const ch = src[j];
    if (ch === '{' || ch === '(' || ch === '[') depth++;
    else if (ch === '}' || ch === ')' || ch === ']') {
      if (depth === 0) break; // 语句结束
      depth--;
    } else if (depth === 0 && (ch === '\n' || ch === ';')) {
      break;
    }
    // 注：`import('x')` 形态已在标识符分支处理；此处若遇到 depth===0 的 '('，
    // 说明语句里出现了非预期的顶层调用，交由后续 esbuild 报语法错即可。
    j++;
  }
  const stmtEnd = j;
  const out: LexicalHit[] = [];

  const fromIdx = src.indexOf('from', from);
  if (fromIdx !== -1 && fromIdx < stmtEnd) {
    const q = skipTriviaAt(src, fromIdx + 4);
    if (src[q] === "'" || src[q] === '"' || src[q] === '`') {
      out.push({ kind: 'export-from', argStart: q, text: src.slice(q, q + 300) });
      return out;
    }
  }

  // 裸侧 import：import '<path>' / import '<path>' assert { ... }
  // 注意必须排除 `import \`...\``（模板字符串里含 ${} 表达式 —— 那是计算式导入，
  // 模板的整体文本会被 skipTriviaAt 之前的位置判成静态 specifier，需在此拦掉）。
  const q = skipTriviaAt(src, from);
  if (src[q] === "'" || src[q] === '"' || src[q] === '`') {
    out.push({ kind: 'export-from', argStart: q, text: src.slice(q, q + 300) });
  }
  return out;
}

function scanExportSpecifier(src: string, from: number): LexicalHit[] {
  const out: LexicalHit[] = [];
  let j = from;
  let depth = 0;
  while (j < src.length && j < from + 4000) {
    const ch = src[j];
    if (ch === '{' || ch === '[') depth++;
    else if (ch === '}' || ch === ']') depth--;
    else if (ch === '\n' || ch === ';') break;
    j++;
  }
  const stmtEnd = j;
  const fromIdx = src.indexOf('from', from);
  if (fromIdx !== -1 && fromIdx < stmtEnd) {
    const q = skipTriviaAt(src, fromIdx + 4);
    if (src[q] === "'" || src[q] === '"' || src[q] === '`') {
      out.push({ kind: 'export-from', argStart: q, text: src.slice(q, q + 300) });
    }
  }
  return out;
}

/** 模块级跳过空白与注释 */
function skipTriviaAt(src: string, from: number): number {
  let j = from;
  for (;;) {
    while (j < src.length && /\s/.test(src[j])) j++;
    if (src[j] === '/' && src[j + 1] === '*') {
      const end = src.indexOf('*/', j + 2);
      j = end === -1 ? src.length : end + 2;
      continue;
    }
    if (src[j] === '/' && src[j + 1] === '/') {
      const end = src.indexOf('\n', j + 2);
      j = end === -1 ? src.length : end + 1;
      continue;
    }
    return j;
  }
}

function scanCode(code: string): LexicalHit[] {
  const src = code.length > LEX_SCAN_LIMIT ? code.slice(0, LEX_SCAN_LIMIT) : code;
  const hits: LexicalHit[] = [];
  let i = 0;

  /** 跳过 i 位置起的字符串字面量，返回其结束后的偏移；非字符串则返回 -1 */
  const skipString = (from: number): number => {
    const q = src[from];
    if (q !== "'" && q !== '"' && q !== '`') return -1;
    let j = from + 1;
    while (j < src.length) {
      const ch = src[j];
      if (ch === '\\') {
        j += 2;
        continue;
      }
      if (ch === q) return j + 1;
      // 模板字符串内的 ${} 可能嵌套字符串/模板，做一次粗略的嵌套计数
      if (q === '`') {
        let depth = 0;
        while (j < src.length) {
          const c2 = src[j];
          if (c2 === '\\') {
            j += 2;
            continue;
          }
          if (c2 === '$' && src[j + 1] === '{') {
            depth++;
            j += 2;
            continue;
          }
          if (c2 === '}' && depth > 0) {
            depth--;
            j++;
            continue;
          }
          if (c2 === '`' && depth === 0) return j + 1;
          j++;
        }
      }
      j++;
    }
    return src.length;
  };

  /** 从 from 起跳过空白与注释，返回首个有效字符偏移 */
  const skipTrivia = (from: number): number => {
    let j = from;
    for (;;) {
      while (j < src.length && /\s/.test(src[j])) j++;
      if (src[j] === '/' && src[j + 1] === '*') {
        const end = src.indexOf('*/', j + 2);
        j = end === -1 ? src.length : end + 2;
        continue;
      }
      if (src[j] === '/' && src[j + 1] === '/') {
        const end = src.indexOf('\n', j + 2);
        j = end === -1 ? src.length : end + 1;
        continue;
      }
      return j;
    }
  };

  const wordAt = (pos: number): string => {
    let j = pos;
    while (j < src.length && /[A-Za-z0-9_$]/.test(src[j])) j++;
    return src.slice(pos, j);
  };

  const isIdentBoundary = (pos: number): boolean => pos === 0 || !/[A-Za-z0-9_$]/.test(src[pos - 1]);

  while (i < src.length) {
    // 注释
    if (src[i] === '/' && src[i + 1] === '*') {
      const end = src.indexOf('*/', i + 2);
      i = end === -1 ? src.length : end + 2;
      continue;
    }
    if (src[i] === '/' && src[i + 1] === '/') {
      const end = src.indexOf('\n', i + 2);
      i = end === -1 ? src.length : end + 1;
      continue;
    }
    // 字符串：整体跳过（但保留 skipString 语义，供上面模板分支使用）
    if (src[i] === "'" || src[i] === '"') {
      i = skipString(i);
      continue;
    }
    if (src[i] === '`') {
      i = skipString(i);
      continue;
    }
    // 标识符
    if (/[A-Za-z_$]/.test(src[i]) && isIdentBoundary(i)) {
      const w = wordAt(i);
      const after = skipTrivia(i + w.length);

      if (w === 'import' && src[after] === '(') {
        hits.push({ kind: 'import', argStart: after + 1, text: src.slice(after + 1, after + 200) });
      } else if (w === 'require' && src[after] === '(') {
        // 接收者判定：`ctx.require(x)` / `a.b.require(x)` 是成员调用（SDK 白名单 API），
        // 裸 `require(x)` 才是 CJS 动态加载。向前回看紧邻的 `.` 即可区分 ——
        // 走到标识符分支时 i 必然是 require 的起始位置，前一个非空白字符若是 `.` 即成员调用。
        let k = i - 1;
        while (k >= 0 && /\s/.test(src[k])) k--;
        const isMemberCall = k >= 0 && src[k] === '.';
        hits.push({ kind: 'require', argStart: after + 1, text: src.slice(after + 1, after + 200), isMemberCall });
      } else if (w === 'eval' && src[after] === '(') {
        hits.push({ kind: 'eval', argStart: after + 1, text: src.slice(after + 1, after + 200) });
      } else if (w === 'new') {
        const kw = wordAt(after);
        const kwAfter = skipTrivia(after + kw.length);
        if (kw === 'Function' && src[kwAfter] === '(') {
          hits.push({ kind: 'new-function', argStart: kwAfter + 1, text: src.slice(kwAfter + 1, kwAfter + 200) });
        }
      } else if (w === 'export') {
        hits.push(...scanExportSpecifier(src, i + w.length));
      } else if (w === 'import') {
        hits.push(...scanImportSpecifier(src, i + w.length));
      }
      i += w.length;
      continue;
    }
    i++;
  }
  return hits;
}

/**
 * 判断片段是否**恰好**是一个字符串字面量（后面紧跟 `)` 或 `,`，无任何拼接/运算）。
 *
 * 不能只检查「首字符是引号」—— `import('node:' + 'child_process')` 首字符就是引号，
 * 但它是字符串拼接，esbuild 不保证会静态折叠成字面量 specifier，因此仍属计算式导入。
 */
function isPureLiteralArg(text: string): boolean {
  const t = text.trimStart();
  const q = t[0];
  if (q !== "'" && q !== '"' && q !== '`') return false;
  const end = skipStringAt(t, 0);
  if (end >= t.length) return true; // 片段被截断，按字面量处理（后续语法错误交给 esbuild）
  // 模板字符串内含 ${expr} 即为计算式，静态导入不允许
  if (q === '`' && /\$\{/.test(t.slice(1, end - 1))) return false;
  const rest = t.slice(end).trimStart();
  return rest.startsWith(')') || rest.startsWith(',');
}

/** 从片段中取出字符串字面量的内容 */
function literalValue(text: string): string {
  const t = text.trimStart();
  const end = skipStringAt(t, 0);
  return t.slice(1, end - 1);
}

function skipStringAt(s: string, from: number): number {
  const q = s[from];
  let j = from + 1;
  while (j < s.length) {
    if (s[j] === '\\') {
      j += 2;
      continue;
    }
    if (s[j] === q) return j + 1;
    j++;
  }
  return s.length;
}

/**
 * 插件代码静态安全门（A-1）。
 *
 * 在 `bundlePlugin()` 之后、代码落盘之前调用。抛 `PluginCodeSecurityError` 即拒绝安装。
 */
export function assertPluginCodeSafe(code: string): void {
  const hits = scanCode(code);

  for (const h of hits) {
    if (h.kind === 'eval' || h.kind === 'new-function') {
      throw new PluginCodeSecurityError(
        'eval',
        `检测到 ${h.kind === 'eval' ? 'eval' : 'new Function'} 调用。插件不得在宿主进程内动态执行代码。`,
      );
    }

    // ── ctx.require(...) 例外 ────────────────────────────────────────────────────
    //
    // 插件 SDK 的 ctx.require(moduleName) 是**官方白名单加载 API**，其入参按设计就是
    // 变量（金丝雀 canary-src/index.ts:246-260 就用 `for (const m of REQUIRE_OK) ctx.require(m)`）。
    // 它本身已在 context-builder 中做过白名单校验，因此这里的词法扫描不能把它误判为
    // 「运行时拼接 require」。
    //
    // 判别方式：require 的接收者。裸 `require(x)` 才危险；`ctx.require(x)` / `a.b.require(x)`
    // 是方法调用，走 SDK 自己的白名单，不在本门管辖范围。
    if (h.kind === 'require' && !isPureLiteralArg(h.text) && !h.isMemberCall) {
      throw new PluginCodeSecurityError('dynamic-require', '检测到动态 require()。');
    }

    if (h.kind === 'import' && !isPureLiteralArg(h.text)) {
      throw new PluginCodeSecurityError(
        'computed-import',
        `检测到计算式 import()（参数片段 "${h.text.slice(0, 60).replace(/\s+/g, ' ')}"）。` +
          `动态 import 可绕过 esbuild 的静态导入白名单，插件只能 import 字面量路径或 @openlearn/* Token。`,
      );
    }

    if (h.kind === 'export-from') {
      const value = literalValue(h.text);
      if (value.startsWith('/')) {
        throw new PluginCodeSecurityError(
          'absolute-path-import',
          `检测到绝对路径 import "${value}"。绝对路径会被放行给 esbuild 解析，` +
            `等于允许把宿主任意文件内联进插件产物后回传。`,
        );
      }
    }
  }
}

/**
 * 将插件入口代码（含相对导入）通过 esbuild 打包为单 ESM bundle。
 *
 * D-07: esbuild 安装时打包 —— stdin API 接收代码字符串，bundle 选项
 * 解析所有相对导入并内联，write: false 在内存中完成打包。
 * D-08: external: ['@openlearn/*'] 保留 Token 服务导入，禁止第三方 npm 包导入。
 *
 * 用**重载**而非 `string | undefined` 表达两种模式（strict 门禁驱动）：
 * 无 outfile 时调用方拿到的必然是代码字符串；有 outfile 时产物已落盘、
 * 调用方无需（也不该）再持有内存副本。放宽成联合类型会让每个调用点
 * （含测试）都背上 undefined 收窄，是把 API 的模糊性转嫁给消费方。
 *
 * @param entryCode - 插件入口文件的源代码
 * @param resolveDir - 解析相对导入的基准目录（临时解压目录）
 * @param outfile - 可选：打包产物落盘路径（审计 R-4/L3）。给了就 `write: true`，
 *   bundle 不经过内存字符串；调用方自行 `fs.copyFileSync` 到最终位置。
 *   不给则维持 `write: false` 返回内存字符串（源码安装路径只做校验、产物丢弃）。
 */
export async function bundlePlugin(entryCode: string, resolveDir: string): Promise<string>;
export async function bundlePlugin(entryCode: string, resolveDir: string, outfile: string): Promise<void>;
export async function bundlePlugin(entryCode: string, resolveDir: string, outfile?: string): Promise<string | void> {
  const esbuild = await import('esbuild');
  const result = await esbuild.build({
    stdin: {
      contents: entryCode,
      resolveDir,
      loader: 'ts',
    },
    bundle: true,
    // R-4/L3：outfile 模式下 write: true，产物直接落盘 —— 大插件的 bundle
    // 不再以多 MB 字符串驻留内存。无 outfile 时维持内存返回（校验用途）。
    write: outfile !== undefined,
    ...(outfile !== undefined ? { outfile } : {}),
    format: 'esm',
    platform: 'neutral',
    target: 'es2022',
    external: ['@openlearn/*'],
    plugins: [
      {
        name: 'openlearn-token-enforcer',
        setup(build) {
          // 拦截所有非相对路径的导入解析
          build.onResolve({ filter: /.*/ }, (args) => {
            // 特殊情况：如果相对导入指向 core/di/interfaces，解析为 monorepo 的绝对路径以支持打包
            if (args.path.includes('core/di/interfaces')) {
              const tsPath = path.resolve(process.cwd(), 'packages/core/di/interfaces.ts');
              if (fs.existsSync(tsPath)) {
                return { path: tsPath };
              }
              const jsPath = path.resolve(process.cwd(), 'packages/core/di/interfaces.js');
              if (fs.existsSync(jsPath)) {
                return { path: jsPath };
              }
            }

            // 绝对路径：一律拒绝（A-3 / M-6）。
            // 此前放行绝对路径等于允许插件把宿主文件（如 /etc/passwd、宿主 package.json）
            // 内联进自身 bundle，再通过任意出网通道回传 —— 是真实的信息泄露面。
            if (args.path.startsWith('/')) {
              return {
                errors: [
                  {
                    text: `Import of absolute path "${args.path}" is not allowed. Plugins may only import relative paths or @openlearn/* Token services.`,
                  },
                ],
              };
            }
            // 相对路径由 esbuild 正常解析
            if (args.path.startsWith('.')) {
              return undefined;
            }
            // @openlearn Token 导入 — 标记为 external 保留
            if (args.path.startsWith('@openlearn')) {
              return { external: true, path: args.path };
            }
            // 其他裸 specifier（如 lodash）— 拒绝打包
            return {
              errors: [
                {
                  text: `Import of "${args.path}" is not allowed. Plugins may only use relative imports or @openlearn/* Token services.`,
                },
              ],
            };
          });
        },
      },
    ],
  });

  if (outfile !== undefined) {
    // write:true 模式：outputFiles 为空，从盘上读回同一道词法门。
    // 位置与严格度和内存模式完全一致 —— 都在打包产物落盘后、调用方使用前。
    assertPluginCodeSafe(fs.readFileSync(outfile, 'utf-8'));
    return undefined;
  }

  // 无 outfile 时 esbuild 保证 outputFiles 非空（write:false 模式）；strict 下仍需显式收窄，
  // 否则 "possibly undefined" 会挡住整条安装链路（CI 的 lint:strict 门禁）。
  const bundled = result.outputFiles?.[0]?.text;
  if (bundled === undefined) {
    throw new Error('[install-utils] esbuild produced no output (write:false mode)');
  }

  // A-1：esbuild 的 onResolve 只拦得住可静态解析的字面量 specifier，
  // 计算式 import() 会被原样保留为运行时 import()，故必须在打包后再过一道静态门。
  assertPluginCodeSafe(bundled);

  return bundled;
}

/**
 * 把 ZIP 条目写入目标目录，并按**实际解压出的字节**计量总量（审计 R-4）。
 *
 * ## 为什么不能只信 ZIP 头
 *
 * 原先的 bomb 检查读 `file._data.uncompressedSize` —— 那是中央目录里的
 * **自声明值**，攻击者可以声明 1KB 而实际解压出 500MB。头检查只能当
 * fast-fail 的预筛，唯一可信的计量点是「真的解压出了多少字节」。
 *
 * 在写盘循环里累计：一旦超过上限立即中断（此时已写出的文件由调用方的
 * finally 清理临时目录）。
 *
 * @param maxTotalBytes 实际解压字节总和上限。传 `Infinity` 可关闭计量（仅测试）。
 */
export async function extractZipEntries(zip: JSZip, destDir: string, maxTotalBytes: number): Promise<void> {
  let totalBytes = 0;

  for (const [name, file] of Object.entries(zip.files)) {
    if (file.dir) continue;
    const filePath = path.join(destDir, name);
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    const content = await file.async('nodebuffer');

    totalBytes += content.length;
    if (totalBytes > maxTotalBytes) {
      throw new Error(
        `ZIP bomb prevention: actual uncompressed size ${totalBytes} bytes exceeds limit of ${maxTotalBytes} bytes`,
      );
    }

    fs.writeFileSync(filePath, content);
  }
}

/**
 * 从磁盘 ZIP 解压、校验 manifest、esbuild 打包（审计 R-4：入参从 Buffer 改路径）。
 *
 * D-12: 完成：
 * 1. ZIP bomb 防护：头大小预筛 + 解压循环内按实际字节强制（见 extractZipEntries）
 * 2. 路径穿越防护：拒绝包含 ".." 或以 "/" 开头的条目名
 * 3. jszip.loadAsync() 解压（Buffer 来自 readZipBufferFromPath，全链路仅此一份）
 * 4. 读取并解析 manifest.json
 * 5. D-10: manifestSchema.parse() 运行时校验
 * 6. 根据 manifest.main 读取入口文件
 * 7. 将所有文件写入临时目录
 * 8. 调用 bundlePlugin() 打包（产物落盘，不占内存字符串）
 * 9. 清理临时目录
 *
 * @returns `package` 是**复用凭据**（R-4）：installPluginFromZip /
 *   updatePluginFromZip 还需要提取 frontend.js / deploy script / storage 资产，
 *   此前它们各自再 `JSZip.loadAsync(zipBuffer)` 一次 —— 400MB 的包就是
 *   又一份 ~400MB 的解析结构。返回同一份对象让调用方免除第二次解析。
 * @returns `bundledPath` 是 bundle 的**独立临时文件**路径（刻意不放 tmpDir：
 *   本函数的 finally 会递归删除 tmpDir，放里面等于返回一个悬空路径）。
 *   调用方 copyFileSync 到最终位置后必须 `removeTempFile` 归还。
 *
 * @param zipPath - ZIP 文件路径（路由层已流式落盘）
 * @throws {Error} ZIP bomb 检测、路径穿越、manifest 缺失/校验失败、入口文件缺失、esbuild 打包失败
 */
export async function validateAndBundleZip(zipPath: string): Promise<{
  manifest: Manifest;
  bundledPath: string;
  entryFileName: string;
  package: JSZip;
}> {
  // Step 1: 加载 ZIP（单一 Buffer 副本，读盘后即交给 JSZip）
  const zip = await JSZip.loadAsync(readZipBufferFromPath(zipPath));

  // Step 2: ZIP bomb 防护 — 检查所有文件的未压缩大小总和
  let totalUncompressed = 0;
  for (const file of Object.values(zip.files)) {
    if (!file.dir) {
      // jszip 的 _data.uncompressedSize 在 loadAsync 后可访问
      const uncompressedSize = (file as any)._data?.uncompressedSize ?? 0;
      totalUncompressed += uncompressedSize;
    }
  }

  const maxLimit = getMaxUncompressedSize();
  if (totalUncompressed > maxLimit) {
    throw new Error(
      `ZIP bomb prevention: total uncompressed size ${totalUncompressed} bytes exceeds limit of ${maxLimit} bytes`,
    );
  }

  // Step 3: 路径穿越检查 — 拒绝 ".." 或以 "/" 开头的路径
  for (const name of Object.keys(zip.files)) {
    if (name.includes('..') || name.startsWith('/')) {
      throw new Error(`Security: path traversal detected in ZIP entry: "${name}"`);
    }
  }

  // Step 4: 读取 manifest.json
  const manifestFile = zip.file('manifest.json');
  if (!manifestFile) {
    throw new Error('ZIP package is missing manifest.json');
  }
  const manifestJson = await manifestFile.async('string');
  const rawManifest = JSON.parse(manifestJson);

  // Step 5: D-10 — zod 运行时校验
  rawManifest.main ||= 'index.js';
  const manifest = manifestSchema.parse(rawManifest);

  // Step 6: 读取入口文件
  let entryFile = zip.file(manifest.main);
  let resolvedMain = manifest.main;

  if (!entryFile && manifest.main.startsWith('dist/')) {
    // 兼容老旧 build 脚本：manifest 写了 "dist/index.js" 但 ZIP 把文件平铺在根目录
    // （参见 openlearn-plugin-learnstar / openlearn-plugin-lti13 v1.0.0 旧 build）
    const fallback = manifest.main.slice('dist/'.length);
    const fallbackEntry = zip.file(fallback);
    if (fallbackEntry) {
      console.warn(
        `[install-utils] manifest.main "${manifest.main}" not found in ZIP; ` +
          `falling back to "${fallback}". Plugin author should update build script to drop the dist/ prefix.`,
      );
      entryFile = fallbackEntry;
      resolvedMain = fallback;
    }
  }

  if (!entryFile) {
    throw new Error(`Entry file "${manifest.main}" specified in manifest not found in ZIP package`);
  }
  const entryCode = await entryFile.async('string');

  // Step 7: 创建临时解压目录，写入所有文件以支持 esbuild 的 resolveDir
  const tmpDir = path.join(os.tmpdir(), `plugin-build-${uuidv7()}`);

  try {
    fs.mkdirSync(tmpDir, { recursive: true });

    // 写入所有 ZIP 文件到临时目录（按实际解压字节计量，防伪造头绕过 bomb 检查）
    await extractZipEntries(zip, tmpDir, getMaxUncompressedSize());

    // Step 8: esbuild 打包（产物落**独立的临时文件**——不放 tmpDir，
    // 因为下方 finally 会递归删除 tmpDir，放里面等于返回悬空路径）
    const bundledPath = path.join(os.tmpdir(), `plugin-bundle-${uuidv7()}.mjs`);
    await bundlePlugin(entryCode, tmpDir, bundledPath);

    return { manifest, bundledPath, entryFileName: resolvedMain, package: zip };
  } finally {
    // Step 9: 清理临时目录
    try {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    } catch {
      // 静默清理失败
    }
  }
}

/**
 * 从已打包的 bundle 代码中重新提取 manifest。
 *
 * 当前由 validateAndBundleZip() 一步完成 manifest 提取和打包，
 * 此函数保留为备用接口，用于未来无需 ZIP 的场景。
 *
 * @param _bundledCode - 打包后的 bundle 代码（当前未使用）
 * @returns Promise<Manifest> 当前实现抛出 "not implemented"
 */
export async function extractManifestFromBundle(_bundledCode: string): Promise<Manifest> {
  throw new Error('extractManifestFromBundle is not yet implemented');
}
